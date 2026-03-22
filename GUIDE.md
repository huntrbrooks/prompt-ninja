# PromptPlus — Comprehensive Feature Guide

## What Is PromptPlus?

PromptPlus is a macOS menu-bar app that acts as an AI co-pilot for anyone who writes prompts. It sits silently in the system tray and provides three distinct workflows: instantly rewriting highlighted text in any app via a global hotkey, generating new prompt templates from scratch, and analysing existing prompts for quality feedback. Everything routes through [OpenRouter](https://openrouter.ai), giving access to every major model (Claude, GPT-4o, Gemini, Llama, DeepSeek, and hundreds more) from a single API key.

---

## System Overview

```mermaid
graph TD
    subgraph macOS["macOS System"]
        AnyApp["Any Application\n(cursor, VS Code, browser…)"]
        Clipboard["System Clipboard"]
        AX["Accessibility API\n(AXSelectedText)"]
        SysHotkey["Global Hotkey\n⌃⌘E"]
    end

    subgraph PromptPlus["PromptPlus (Electron)"]
        Tray["Menu Bar Tray\n☆ sparkle icon"]
        Main["main.js\nMain Process"]
        Preload["preload.js\ncontextBridge"]
        Renderer["renderer/\nSettings UI"]

        subgraph Tabs["Settings Window Tabs"]
            Workshop["Workshop\n(Generate + Analyze)"]
            Settings["Settings\n(API Key + Hotkey)"]
        end
    end

    subgraph OpenRouter["OpenRouter API"]
        Models["GET /api/v1/models\n(catalogue, cached 1h)"]
        Chat["POST /api/v1/chat/completions\n(streaming SSE or blocking)"]
    end

    SysHotkey -->|triggers| Main
    Tray -->|click| Renderer
    Main -->|reads via| AX
    Main -->|fallback Cmd+C/V| Clipboard
    AnyApp -->|selected text| AX
    AnyApp -->|selected text| Clipboard
    Main <-->|IPC invoke/send| Preload
    Preload <-->|window.api| Renderer
    Renderer --> Tabs
    Main -->|fetch streaming| Chat
    Main -->|fetch| Models
```

---

## Feature 1 — Global Hotkey Enhancement

The core feature. Select any text in any macOS application, press the hotkey, and the text is replaced in-place with an AI-enhanced version.

### How It Works

```mermaid
sequenceDiagram
    actor User
    participant App as Active macOS App
    participant Main as main.js
    participant AX as Accessibility API (JXA)
    participant Helper as pp-keystroke (native C)
    participant Clipboard as System Clipboard
    participant OR as OpenRouter API

    User->>App: Select / highlight text
    User->>Main: Press ⌃⌘E (global hotkey)
    Main->>Main: Guard — already processing?
    Main->>Main: tray.setTitle(' ⏳')
    Main->>Main: Check API key present
    Main->>AX: AXUIElementCopyAttributeValue(AXSelectedText)
    alt AX succeeds
        AX-->>Main: selected text
    else AX fails (app doesn't expose AXSelectedText)
        Main->>Clipboard: Save current clipboard
        Main->>Clipboard: Clear clipboard
        Main->>Helper: Send Cmd+C (CGEvent)
        Helper-->>App: Key down/up events
        App-->>Clipboard: Selected text copied
        Main->>Clipboard: Read text (after 500ms wait)
    end
    Main->>OR: POST /chat/completions\n{model, SYSTEM_PROMPT + text}
    OR-->>Main: Enhanced text (blocking, 90s timeout)
    Main->>Clipboard: Write enhanced text
    Main->>Helper: Send Cmd+V (CGEvent)
    Helper-->>App: Paste keystroke
    App-->>App: Enhanced text replaces selection
    Main->>Clipboard: Restore original clipboard (after 500ms)
    Main->>Main: tray.setTitle('')
    Main->>User: macOS Notification "Prompt enhanced!"
```

### Key Details

| Aspect | Detail |
|--------|--------|
| Default hotkey | `⌃⌘E` (Control + Command + E) |
| Text extraction method 1 | `AXSelectedText` via JXA/osascript (no clipboard side-effect) |
| Text extraction method 2 | Simulate `Cmd+C`, read clipboard (fallback for apps that don't expose AX) |
| Clipboard safety | Original clipboard saved before and restored after |
| Keystroke method 1 | Native compiled C binary (`pp-keystroke`) using CoreGraphics `CGEventPost` |
| Keystroke method 2 | JXA CGEvent fallback if the C helper isn't compiled yet |
| Native helper | Compiled once on first use, cached in `~/Library/Application Support/promptplus/pp-keystroke` |
| API call type | Non-streaming (waits for full response before pasting) |
| Timeout | 90 seconds |
| Guard | Single-flight (`isProcessing` flag) — hotkey ignored while a request is in flight |

### SYSTEM_PROMPT Strategy

The enhance system prompt instructs the model to:
- Identify core intent
- Apply structure (Goal / Context / Instructions / Output Format / Examples)
- Sharpen language (replace vague with specific)
- Scale to complexity (light touch for simple questions, full restructure for complex tasks)
- Return **only** the enhanced prompt — no commentary, no wrappers

---

## Feature 2 — Workshop: Generate Tab

Type a description of what you want a prompt to do; the model streams back a complete, production-ready prompt template.

### Generate Flow

```mermaid
flowchart TD
    A([User types task description]) --> B{Quick-task chip\nor manual input?}
    B -->|chip clicked| C[Pre-fill input field]
    B -->|typed manually| D[Input ready]
    C --> D
    D --> E{Thinking mode\ntoggle on?}
    E -->|yes| F[Append chain-of-thought\nhint to input]
    E -->|no| G[Input unchanged]
    F --> G
    G --> H[Generate random reqId]
    H --> I[ipcRenderer.send stream-request\ntype=generate]
    I --> J[main.js: build messages\nGENERATE_PROMPT + task]
    J --> K[streamOpenRouter SSE loop]
    K -->|chunk| L[ipcMain sends stream-chunk to renderer]
    L --> M[Renderer appends to generateFull\nrenderStreamOutput as plain text]
    M --> K
    K -->|done| N[ipcMain sends stream-done]
    N --> O[finishGenerate]
    O --> P{Any {{VARIABLES}}\nin output?}
    P -->|yes| Q[Show variable tags panel]
    P -->|no| R[Hide variable panel]
    Q --> S([User can Copy or Refine])
    R --> S
    S -->|Refine clicked| T[Move output to Analyze tab\nauto-switch mode]
```

### Features Within Generate

- **Quick-task chips** — one-click starters like "Write a code review prompt", "Summarise a document", etc.
- **Thinking mode toggle** — appends a chain-of-thought instruction hint, designed for `o1`/`o3`/reasoning models
- **Variable detection** — after generation, any `{{VARIABLE_NAME}}` placeholders are extracted and shown as tags
- **Streaming output** — text appears token-by-token with a blinking cursor
- **Stop button** — aborts the in-flight stream mid-generation
- **Refine shortcut** — one click sends the generated prompt straight to the Analyze tab

---

## Feature 3 — Workshop: Analyze Tab

Paste any existing prompt and get structured AI feedback: assessment, strengths, key issues, specific recommendations, context gaps, and an optional rewritten version.

### Analyze Flow

```mermaid
flowchart TD
    A([User pastes prompt text]) --> B[Character count updates live]
    B --> C[User clicks Analyze]
    C --> D[Generate random reqId]
    D --> E[ipcRenderer.send stream-request\ntype=analyze]
    E --> F[main.js: build messages\nANALYZE_PROMPT + pasted text]
    F --> G[streamOpenRouter SSE loop]
    G -->|chunk| H[Renderer appends to analyzeFull\nrenderStreamOutput as MARKDOWN]
    H --> G
    G -->|done| I[finishAnalyze]
    I --> J[Final markdown render\nno cursor]
    J --> K([User can Copy analysis])
```

### ANALYZE_PROMPT Output Structure

The prompt instructs the model to return feedback in this exact XML-tagged structure, rendered as markdown in the UI:

```
<feedback>
  Overall Assessment
  Strengths
  Key Issues (ordered by importance)
  Specific Recommendations (numbered, with WHY)
  Context Gaps
  Enhanced Version (optional, if significant revision needed)
</feedback>
```

---

## Feature 4 — Model Picker

A full-featured modal for browsing and selecting from the entire OpenRouter model catalogue.

```mermaid
flowchart LR
    Badge[Model Badge\nclick to open] --> Modal[Model Picker Modal]

    Modal --> Search[Text search\nby name/id/description]
    Modal --> Filters[Filter chips]
    Filters --> F1[All]
    Filters --> F2[Featured\n14 curated models]
    Filters --> F3[Free\nprice = $0]
    Filters --> F4[Vision\nimage modality]
    Filters --> F5[Code\ncodestral / coder etc]
    Filters --> F6[Reasoning\no1/o3/r1/qwq/think]
    Filters --> F7[Long\n≥128k context]

    Modal --> Sections[List sections]
    Sections --> Favs[Favorites\n★ starred models]
    Sections --> Recent[Recently used\nlast 5]
    Sections --> AllList[All models\ncapped at 150 visible]

    Modal --> ProviderInput[Optional provider override\ne.g. anthropic]
    Modal --> SelectBtn[Select button\nsaves to store]
```

### Model List Details

Each model row shows:
- Display name + provider org
- Tags: `free` / `vision` / `reasoning` / `code`
- Context window (e.g. `200k`)
- Price per 1M tokens input/output (or `free`)
- Star button to toggle favourites

**Catalogue source:** `GET https://openrouter.ai/api/v1/models`
**Cache TTL:** 1 hour (persisted in config file)
**Refresh:** Manual via the refresh button in the settings header

---

## Feature 5 — Settings

```mermaid
flowchart TD
    S[Settings Tab] --> K[API Key field]
    K --> Toggle[Show/hide password toggle]
    K --> Connect[Connect & Load Models button]
    Connect --> Validate[Fetch models from OpenRouter\nvalidates key implicitly]
    Validate -->|success| Status[Show model count\nmark as connected]
    Validate -->|fail| Err[Show error message]

    S --> H[Hotkey section]
    H --> Record[Record button]
    Record --> Listen[Capture keydown events\nmodifier + key]
    Listen --> Preview[Live preview in input field]
    Preview --> Save2[Hotkey stored on stopRecording]

    S --> SaveBtn[Save Settings button]
    SaveBtn --> Persist[Writes apiKey + hotkey\nto config JSON]
    Persist --> Reregister[Re-registers global shortcut\nUpdates tray menu label]
```

### Hotkey Recording Mechanics

1. Clicking **Record** calls `ipcMain start-recording`, which **unregisters only the current hotkey** (never `unregisterAll()` — to avoid conflicting with apps like Alfred or Whispr)
2. The renderer captures `keydown` events directly
3. Any combination of `Control / Command / Alt / Shift` + a non-modifier key is valid
4. On confirmation, `ipcMain stop-recording` re-registers the new hotkey and updates the tray context menu label

---

## IPC Architecture

```mermaid
graph LR
    subgraph Renderer["renderer.js (sandboxed)"]
        WA["window.api\n(contextBridge)"]
    end

    subgraph Preload["preload.js"]
        CB["contextBridge\n.exposeInMainWorld"]
    end

    subgraph Main["main.js"]
        IPC["ipcMain\nhandlers"]
        Store["Store\n(config JSON)"]
        OR["OpenRouter\nfetch / SSE"]
        AXHelper["osascript / JXA\nAX + keystrokes"]
    end

    WA -->|invoke| CB
    CB -->|ipcRenderer.invoke| IPC
    WA -->|send stream-request| CB
    CB -->|ipcRenderer.send| IPC
    IPC -->|store.get/set| Store
    IPC -->|fetch| OR
    IPC -->|execFile osascript| AXHelper
    IPC -->|webContents.send stream-chunk| CB
    CB -->|ipcRenderer.on| WA
```

**Invoke (promise-based):** `get-settings`, `save-settings`, `get-models`, `set-active-model`, `toggle-favorite`, `start-recording`, `stop-recording`

**Fire-and-forget + event callbacks (streaming):** `stream-request` → replies via `stream-chunk` / `stream-done` / `stream-error` events; `stream-abort` cancels in-flight request

---

## Persistence & Configuration

```mermaid
erDiagram
    CONFIG_FILE {
        string apiKey "OpenRouter API key"
        string activeModel "e.g. anthropic/claude-3.5-sonnet"
        string activeProvider "optional provider override"
        string hotkey "e.g. Control+Command+E"
        array  favorites "model id strings"
        array  recentModels "objects with id + ts"
        array  cachedModels "full OpenRouter model objects"
        number cachedModelsAt "Unix ms timestamp"
    }
```

**Location:** `~/Library/Application Support/promptplus/promptplus-config.json`

**Debug log:** `~/Library/Application Support/promptplus/promptplus-debug.log`
- All log levels in dev (`npm start`)
- WARN + ERROR only in packaged builds

---

## Application Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Launch: npm start / open .app
    Launch --> SingleInstanceCheck: requestSingleInstanceLock()
    SingleInstanceCheck --> Quit: lock already held\n(show existing window)
    SingleInstanceCheck --> Init: lock acquired

    Init --> TrayReady: createTray()\nregisterHotkey()\napp.dock.hide()
    TrayReady --> Idle: API key exists
    TrayReady --> SettingsOpen: No API key\n(first launch)

    Idle --> Processing: Hotkey pressed
    Idle --> SettingsOpen: Tray click\nor tray menu → Settings
    Processing --> Idle: Enhancement complete\nor error
    SettingsOpen --> Idle: Window closed\n(app.dock.hide())

    Idle --> Quit: Tray menu → Quit
    Quit --> [*]: globalShortcut.unregister\napp.quit()
```

---

## Current Capabilities & Known Constraints

### What Works
| Capability | Status |
|------------|--------|
| Global hotkey enhancement (in-place text replacement) | Fully working |
| AXSelectedText extraction (no clipboard side-effect) | Working where app supports it |
| Cmd+C clipboard fallback | Working with Accessibility permission |
| Streaming Generate + Analyze in UI | Fully working |
| Model picker with search, filters, favourites, recents | Fully working |
| OpenRouter model catalogue (any model, 300+) | Fully working, 1h cache |
| Thinking mode hint for reasoning models | Working (appends instruction) |
| Variable extraction (`{{VAR}}`) from generated prompts | Working |
| Refine shortcut (Generate → Analyze) | Working |
| Custom hotkey recording | Working |
| Persistent settings (API key, model, hotkey) | Working |
| macOS dark mode, hiddenInset title bar | Working |

### Requirements & Constraints
| Item | Detail |
|------|--------|
| Platform | macOS only (Ventura 13+ tested) |
| Permission | Accessibility must be granted in System Settings |
| API | OpenRouter key required (not OpenAI directly) |
| Architecture | Universal binary (Apple Silicon + Intel) |
| No Dock icon | Hides when settings window is closed |
| Single instance | Second launch focuses existing window |
| No test suite | No automated tests exist |
| No lint | No ESLint or Prettier configuration |
| Hotkey conflict avoidance | Only unregisters its own hotkey, never `unregisterAll()` |
| Keystroke delivery | Native C helper compiled on first use; JXA fallback if unavailable |
| Model cache TTL | 1 hour (hardcoded) |
| DevTools | Only available in dev mode (`⌘⌥I` when settings window focused) |
| Model list cap | UI renders max 150 rows before "refine your search" prompt |

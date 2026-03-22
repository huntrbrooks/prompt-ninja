# PromptPlus — Master & System Prompt Builder: Design Specification

## Vision

Transform PromptPlus from a single-session prompt tool into a complete personal AI workspace. The new "Prompts & Systems" section gives users a persistent, reusable context layer — master prompts that encode who they are, system prompts that encode how the AI should behave, and a project structure that binds them together. Every existing feature (Generate, Enhance, Analyze, Workshop) can then draw on this context automatically.

---

## 1. How It Fits Into the Existing App

```mermaid
graph TD
    subgraph Current["Current PromptPlus"]
        Tab1["Workshop Tab\n(Generate / Analyze)"]
        Tab2["Settings Tab\n(API Key / Hotkey)"]
        Hotkey["Global Hotkey\n⌃⌘E — Enhance"]
    end

    subgraph New["New: Prompts & Systems Tab"]
        MP["Master Prompts\n(Role identity library)"]
        SP["System Prompts\n(Behaviour recipes)"]
        PJ["Projects\n(Initiative workspaces)"]
    end

    subgraph Context["Active Context Layer (new)"]
        Header["Header context bar\nActive master + system prompt"]
    end

    Tab1 -->|"Load context →"| Context
    New -->|"Populates"| Context
    Context -->|"Prepended to every\nGenerate / Analyze / stream request"| Tab1
    Context -->|"Prepended to\nhotkey enhancement"| Hotkey
```

The context bar sits between the tab bar and the model badge. It shows which master prompt and system prompt are currently active. Either can be cleared at any time. When present, both are automatically prepended to every API call.

---

## 2. Navigation Structure

```mermaid
graph LR
    TabBar["Tab Bar"]
    TabBar --> W["Workshop"]
    TabBar --> PS["Prompts & Systems  ← NEW"]
    TabBar --> Sett["Settings"]

    PS --> Sub1["Master Prompts"]
    PS --> Sub2["System Prompts"]
    PS --> Sub3["Projects"]

    Sub1 --> MPLib["Library list\n(table)"]
    Sub1 --> MPBuilder["Builder wizard\n(modal)"]

    Sub2 --> SPLib["Library list\n(table)"]
    Sub2 --> SPBuilder["Builder wizard\n(modal)"]

    Sub3 --> PJDash["Project dashboard"]
    Sub3 --> PJCreate["New project wizard"]
```

---

## 3. Data Model

All new data lives alongside the existing `promptplus-config.json` store, split into a dedicated directory:

```
~/Library/Application Support/promptplus/
├── promptplus-config.json          (existing — add activeContextId, activeSystemPromptId)
├── master-prompts/
│   └── {uuid}.json                 (one file per master prompt)
├── system-prompts/
│   └── {uuid}.json                 (one file per system prompt)
├── projects/
│   └── {uuid}/
│       ├── project.json            (metadata + linked prompt IDs)
│       └── files/                  (user-uploaded files: PDFs, markdown)
└── exports/
    └── {name}-{date}.md / .pdf     (exported documents)
```

### MasterPrompt schema

```mermaid
erDiagram
    MASTER_PROMPT {
        string  id          "uuid v4"
        string  name        "e.g. Entrepreneur"
        string  role        "full role description"
        string  company     "company / product context"
        string  audience    "target audience"
        string  tone        "tone and voice rules"
        array   offers      "products / services offered"
        array   constraints "what NOT to do"
        string  decisionCriteria "how decisions are made"
        string  team        "team structure"
        string  tools       "key tools used"
        string  kpis        "success metrics"
        string  fullDocument "the generated prompt text"
        string  model       "model used to build it"
        number  createdAt   "Unix ms"
        number  updatedAt   "Unix ms"
        string  version     "semver e.g. 1.0.0"
    }
```

### SystemPrompt schema

```mermaid
erDiagram
    SYSTEM_PROMPT {
        string  id          "uuid v4"
        string  name        "e.g. Marketing Copy Writer"
        string  category    "marketing | code | research | custom"
        string  content     "the full system prompt text"
        array   tags        "user-defined tags"
        string  linkedModel "preferred model id (optional)"
        string  linkedProvider "preferred provider (optional)"
        string  derivedFrom "Workshop output that inspired it (optional)"
        number  createdAt   "Unix ms"
        number  updatedAt   "Unix ms"
    }
```

### Project schema

```mermaid
erDiagram
    PROJECT {
        string  id              "uuid v4"
        string  name            "e.g. Q3 Product Launch"
        string  description     "brief summary"
        string  masterPromptId  "linked master prompt (optional)"
        array   systemPromptIds "linked system prompts"
        array   fileRefs        "relative paths to uploaded files"
        number  createdAt       "Unix ms"
        number  updatedAt       "Unix ms"
        string  lastActivityAt  "Unix ms"
    }
```

### Config additions (promptplus-config.json)

```json
{
  "activeContextId": null,
  "activeSystemPromptId": null,
  "activeProjectId": null
}
```

---

## 4. Feature Flows

### 4.1 Master Prompt Builder — Full Wizard Flow

```mermaid
sequenceDiagram
    actor User
    participant UI as Wizard Modal
    participant Main as main.js
    participant OR as OpenRouter

    User->>UI: Click "Create Master Prompt"
    UI->>UI: Show intro card\n(what is a master prompt?)
    User->>UI: Enter role name\ne.g. "Entrepreneur"
    User->>UI: Click "Start Interview"

    UI->>Main: ipc: stream-request\ntype=master-prompt-interview\ninput={role}
    Main->>OR: POST stream\nPROMPT: "Ask me everything needed\nto build a master prompt for [role].\nAsk one question at a time."
    OR-->>Main: Question 1 streamed
    Main-->>UI: stream-chunk → render question

    loop For each question
        User->>UI: Type or dictate answer
        UI->>Main: ipc: stream-request\ntype=master-prompt-continue\ninput={history + answer}
        Main->>OR: POST stream (conversation history)
        OR-->>Main: Next question or "I have enough"
        Main-->>UI: stream-chunk → render
    end

    OR-->>UI: "I have enough context"
    User->>UI: Click "Generate Master Prompt"
    UI->>Main: ipc: stream-request\ntype=master-prompt-generate\ninput={full Q&A transcript}
    Main->>OR: POST stream\n"Generate the master prompt document\nfrom this interview"
    OR-->>Main: Full document streamed
    Main-->>UI: Render live preview

    User->>UI: Review, optionally edit sections
    User->>UI: Click "Save"
    UI->>Main: ipc: save-master-prompt\ndata={name, role, fullDocument, ...}
    Main->>Main: Write {uuid}.json\nto master-prompts/
    Main-->>UI: {id, createdAt}
    UI->>UI: Close wizard\nRefresh library
```

### 4.2 Master Prompt Library — CRUD Actions

```mermaid
flowchart TD
    Lib["Master Prompts Library\n(table: Name | Role | Updated | Actions)"]

    Lib -->|Load| LoadCtx["Set activeContextId\nUpdate context bar\nToast: 'Master prompt loaded'"]
    Lib -->|Edit| Edit["Re-open wizard\nPre-fill Q&A from saved fields\nAsk only 'what changed?'"]
    Lib -->|Duplicate| Dup["Clone JSON with new uuid\nName: 'Copy of...'"]
    Lib -->|Export| Exp["Export modal\nChoose: Markdown / PDF / JSON"]
    Lib -->|Delete| Del["Confirm dialog\nRemove file\nClear activeContextId if matched"]
```

### 4.3 System Prompt Builder

```mermaid
sequenceDiagram
    actor User
    participant WS as Workshop Result
    participant UI as System Prompt Builder
    participant Main as main.js
    participant OR as OpenRouter

    Note over WS: User has a good Generate/Analyze result

    User->>WS: Click "Create System Prompt →"
    WS->>UI: Open builder modal\nPre-fill "source output" field

    User->>UI: Optionally adjust name + category
    User->>UI: Click "Interview Me"

    UI->>Main: ipc: stream-request\ntype=system-prompt-interview\ninput={source output}
    Main->>OR: "Act as an expert AI engineer.\nWrite a system prompt that produces output\nlike this. Ask me any clarifying questions\none at a time before you write it."
    OR-->>Main: Question 1
    Main-->>UI: Render question

    loop Until model has enough
        User->>UI: Answer question
        UI->>Main: Continue conversation
        Main->>OR: POST with history
        OR-->>Main: Next question / "ready"
    end

    User->>UI: Click "Generate System Prompt"
    UI->>Main: ipc: stream-request\ntype=system-prompt-generate
    Main->>OR: "Now write the system prompt"
    OR-->>Main: System prompt streamed
    Main-->>UI: Live preview

    User->>UI: Review, edit forbidden behaviours,\noutput format, tone
    User->>UI: Add tags, link model (optional)
    User->>UI: Click "Save"
    UI->>Main: ipc: save-system-prompt
    Main->>Main: Write {uuid}.json to system-prompts/
    Main-->>UI: {id}
    UI->>UI: Close modal\nRefresh library
```

### 4.4 Pull Prompting Mode (across Workshop)

```mermaid
flowchart TD
    Toggle["Pull Prompting toggle\n(in Generate / Analyze forms)"]

    Toggle -->|OFF default| Push["Standard push prompt:\nUser writes full request\n→ one-shot generation"]

    Toggle -->|ON| PullStart["User enters brief outcome\ne.g. 'I need a cold-lead sequence'"]

    PullStart --> Send1["stream-request type=pull-interview\nSystem: 'Ask me all questions you\nneed before you start, one at a time'"]
    Send1 --> Q1["Model streams Question 1"]
    Q1 --> A1["User answers"]
    A1 --> Q2["Model streams Question 2"]
    Q2 --> More{More questions?}
    More -->|yes| A2["User answers"] --> More
    More -->|no — model says ready| Final["User clicks 'Generate Now'"]
    Final --> GenReq["stream-request type=generate\nwith full Q&A context appended"]
    GenReq --> Result["Result rendered\n(same as standard generate)"]
```

### 4.5 Projects — Creation and Session Flow

```mermaid
flowchart TD
    PD["Projects Dashboard\n(cards: Name | Files | Prompts | Last activity)"]

    PD -->|New| Wizard["New Project Wizard\nName + Description\nPick master prompt (optional)\nPick system prompts (multi-select)"]
    Wizard --> Created["Project folder created\nproject.json written"]

    Created --> Open["Open Project View"]
    Open --> FileList["Files panel\nDrag-drop PDFs/markdown"]
    Open --> SPList["System Prompts panel\nAdd/remove linked system prompts"]
    Open --> Sessions["Workshop Sessions\n(saved conversation snapshots)"]

    Open --> Launch["Launch Workshop\nin project context"]
    Launch --> AutoCtx["Auto-load:\n1. Project master prompt as context\n2. User picks which system prompt\n3. Any attached files as context messages"]
    AutoCtx --> Normal["Normal Generate/Analyze/Workshop flow\nbut with pre-loaded context"]
```

---

## 5. Context Bar — Always-Visible Active Context

```mermaid
graph LR
    subgraph Header["App Header (between tab bar and model bar)"]
        CB["Context Bar"]
        CB --> MP_Badge["Master Prompt badge\n'Entrepreneur ✕'\nor '+ Add master prompt'"]
        CB --> SP_Badge["System Prompt badge\n'Marketing Copy ✕'\nor '+ Add system prompt'"]
        CB --> PJ_Badge["Project badge (optional)\n'Q3 Launch ✕'"]
    end

    MP_Badge -->|click ✕| ClearMP["activeContextId = null"]
    MP_Badge -->|click name| OpenMPPicker["Mini modal to switch master prompt"]
    SP_Badge -->|click ✕| ClearSP["activeSystemPromptId = null"]
    SP_Badge -->|click name| OpenSPPicker["Mini modal to switch system prompt"]
```

When any context is active, every `stream-request` and `callOpenRouter` call in `main.js` prepends the loaded documents to the `messages` array:

```
messages = [
  { role: 'system', content: <active system prompt content> },
  { role: 'user',   content: <active master prompt fullDocument> },
  { role: 'user',   content: <original task / prompt> }
]
```

For the global hotkey enhancement, if a master prompt is active it is prepended as a user context message before the text to be enhanced.

---

## 6. Export / Import Flows

```mermaid
flowchart LR
    ExportBtn["Export button (on any library item)"]
    ExportBtn --> Format{Choose format}
    Format --> MD["Markdown .md\nfull document text\nwith YAML frontmatter metadata"]
    Format --> PDF["PDF\ngenerated via electron print-to-PDF\nno external dependency"]
    Format --> JSON["JSON\ncomplete schema object\nfor re-import"]

    ImportBtn["Import button (library header)"]
    ImportBtn --> File["User picks .json / .md file"]
    File --> Parse["Parse + validate schema"]
    Parse -->|valid| Save["Assign new uuid\nWrite to library\nToast: 'Imported'"]
    Parse -->|invalid| Err["Show parse error\nOffer schema guide"]
```

---

## 7. Security Considerations

Consistent with CodeSignal's guidance that system prompts must be resistant to prompt-injection attacks:

```mermaid
flowchart TD
    Input["User input or imported file"]
    Input --> Sanitise["Strip common injection patterns\n e.g. 'Ignore previous instructions'\n'You are now DAN'\nbefore including in context messages"]
    Sanitise --> Warn{Injection pattern\ndetected?}
    Warn -->|yes| Alert["Show yellow warning:\n'This content contains patterns\nthat may override AI instructions.\nReview before loading.'"]
    Warn -->|no| UseCtx["Include in context safely"]
    Alert -->|User confirms| UseCtx
    Alert -->|User cancels| Discard["Do not load"]

    Export["On export of master prompts"]
    Export --> Reminder["Show notice:\n'Master prompts may contain\nconfidential role/business context.\nDo not share exported files publicly.'"]
```

---

## 8. New IPC Channels

The following IPC handlers must be added to `main.js` (invoke = promise-based; on = fire-and-forget with event replies):

| Channel | Type | Direction | Description |
|---------|------|-----------|-------------|
| `list-master-prompts` | invoke | R→M | Returns array of all master prompt metadata |
| `save-master-prompt` | invoke | R→M | Creates or updates a master prompt JSON file |
| `delete-master-prompt` | invoke | R→M | Removes file, clears active if matched |
| `list-system-prompts` | invoke | R→M | Returns array of all system prompt metadata |
| `save-system-prompt` | invoke | R→M | Creates or updates a system prompt JSON file |
| `delete-system-prompt` | invoke | R→M | Removes file, clears active if matched |
| `list-projects` | invoke | R→M | Returns array of project metadata |
| `save-project` | invoke | R→M | Creates or updates project.json |
| `delete-project` | invoke | R→M | Removes project folder |
| `set-active-context` | invoke | R→M | Sets activeContextId in store |
| `set-active-system-prompt` | invoke | R→M | Sets activeSystemPromptId in store |
| `export-document` | invoke | R→M | Writes .md / .json / PDF to exports/ dir |
| `import-document` | invoke | R→M | Reads and validates an external file |
| `stream-request` | on+events | R→M | **Extended** — new types: `master-prompt-interview`, `master-prompt-continue`, `master-prompt-generate`, `system-prompt-interview`, `system-prompt-generate`, `pull-interview` |

---

## 9. New System Prompt Constants (main.js)

Five new prompt constants are needed alongside the existing `SYSTEM_PROMPT`, `ANALYZE_PROMPT`, and `GENERATE_PROMPT`:

| Constant | Purpose |
|----------|---------|
| `MASTER_PROMPT_INTERVIEW` | Instructs model to interview user for master prompt fields, one question at a time |
| `MASTER_PROMPT_GENERATE` | Takes completed Q&A transcript and produces the full master prompt document |
| `SYSTEM_PROMPT_INTERVIEW` | Given a source output, asks the model to question the user before writing a system prompt |
| `SYSTEM_PROMPT_GENERATE` | Takes interview transcript and produces the system prompt |
| `PULL_INTERVIEW_PREAMBLE` | Prepended when Pull Prompting mode is on — instructs model to ask clarifying questions before starting |

---

## 10. Renderer Architecture Changes

```mermaid
graph TD
    subgraph renderer.js["renderer.js (additions)"]
        CTX["Context state\nactiveMasterPrompt\nactiveSystemPrompt\nactiveProject"]
        CTXBar["renderContextBar()\nupdates header badges"]
        PSTab["Prompts & Systems tab\ninitPromptSystems()"]

        MPLib["renderMasterPromptLibrary()"]
        MPWizard["MasterPromptWizard class\n- step state machine\n- Q&A history array\n- stream handlers"]

        SPLib["renderSystemPromptLibrary()"]
        SPWizard["SystemPromptWizard class\n- source output\n- Q&A history\n- stream handlers"]

        PJDash["renderProjectDashboard()"]

        PullToggle["pullPromptingEnabled flag\nmodifies stream-request type\ncollects Q&A before final generate"]
    end

    CTX --> CTXBar
    PSTab --> MPLib & SPLib & PJDash
    MPLib --> MPWizard
    SPLib --> SPWizard
    CTX --> PullToggle
```

The existing `setupStreamListeners()` function must be extended to route the new `reqId` types (`masterPromptReqId`, `systemPromptReqId`, `pullInterviewReqId`) to their respective wizard handlers.

---

## 11. Implementation Phases

```mermaid
gantt
    title PromptPlus — Prompts & Systems Build Phases
    dateFormat  YYYY-MM-DD
    axisFormat  Phase %s

    section Phase 1 — Foundation
    Data model + file I/O in main.js       :p1a, 2025-01-01, 3d
    New IPC handlers (CRUD)                :p1b, after p1a, 2d
    Prompts & Systems tab shell + sub-tabs :p1c, after p1b, 2d
    Context bar UI + store wiring          :p1d, after p1c, 2d

    section Phase 2 — Master Prompt Builder
    Interview stream type + prompt const   :p2a, after p1d, 2d
    Wizard modal UI + step state machine   :p2b, after p2a, 3d
    Library table + CRUD actions           :p2c, after p2b, 2d
    Context injection into existing calls  :p2d, after p2c, 2d

    section Phase 3 — System Prompt Builder
    System prompt interview + generate     :p3a, after p2d, 2d
    Builder modal + "Create from result"   :p3b, after p3a, 3d
    System prompt library                  :p3c, after p3b, 2d

    section Phase 4 — Pull Prompting & Projects
    Pull prompting toggle + flow           :p4a, after p3c, 2d
    Projects CRUD + dashboard              :p4b, after p4a, 3d
    File attachment (drag-drop)            :p4c, after p4b, 2d

    section Phase 5 — Export / Import / Polish
    Export (MD, JSON, PDF)                 :p5a, after p4c, 2d
    Import + injection detection           :p5b, after p5a, 2d
    Context bar polish + animations        :p5c, after p5b, 1d
    End-to-end testing                     :p5d, after p5c, 2d
```

---

## 12. UI Component Inventory

### New components needed in `index.html` / `styles.css`

| Component | Description |
|-----------|-------------|
| `#context-bar` | Sticky bar under tab bar; shows active master/system/project badges |
| `#tab-prompts` | New tab content pane |
| `#ps-subnav` | Sub-tab buttons: Master Prompts / System Prompts / Projects |
| `#master-prompt-library` | Table with columns Name, Role, Updated, Actions |
| `#master-prompt-wizard` | Full-screen modal with step indicator, chat-style Q&A area, preview pane |
| `#system-prompt-library` | Table with columns Name, Category, Tags, Updated, Actions |
| `#system-prompt-wizard` | Modal with source output display + Q&A + preview |
| `#project-dashboard` | Card grid, each card shows project name, file count, last activity |
| `#project-detail` | Panel showing files, linked system prompts, launch button |
| `.pull-toggle` | Checkbox + label added to Generate/Analyze forms |
| `.context-badge` | Reusable pill component (name + ✕ clear button) |
| `#export-modal` | Format picker + filename input + download button |
| `#import-modal` | File picker + validation feedback |

---

## 13. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Local file storage** (not in-memory config) | Master prompts can grow large (multi-page documents). Separate `.json` files per record avoids bloating `promptplus-config.json` and allows easy manual editing/backup. |
| **Conversation history array in wizard** | Pull prompting requires sending the full Q&A transcript on each turn. The wizard maintains `messages[]` in renderer state and passes it as `input` to the stream handler. |
| **Context injected in main.js, not renderer** | The main process is the single source of truth for the active context. Injecting there ensures the hotkey enhancement path also benefits from loaded context — the renderer cannot reach the hotkey flow directly. |
| **PDF via Electron print-to-PDF** | No external dependency. `BrowserWindow.webContents.printToPDF()` can render any loaded HTML to PDF, matching the app's zero-runtime-dependency principle. A hidden off-screen window renders the document. |
| **Injection detection on import only** | Scanning every keystroke is wasteful. Injection patterns are checked once when a file is imported or when a master/system prompt is loaded into context, not during live editing. |
| **Extend existing `stream-request` channel** | Adding `type` values keeps IPC surface minimal. The renderer always sends one channel; routing by type is handled in the existing `ipcMain.on('stream-request')` switch. |
| **No multi-window** | The settings window is single-instance. Wizards open as modals within the existing window, consistent with the current model picker pattern. |

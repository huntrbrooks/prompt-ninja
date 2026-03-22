# PromptPlus

A standalone macOS menu-bar app that enhances your prompts with AI. Highlight text anywhere, press a global hotkey, and the text is rewritten by OpenAI into a well-structured, optimized prompt — then pasted back in place.

## Features

- **Global hotkey** (default `⌃⌘E`) triggers enhancement from any app
- **Menu-bar app** — lives in the macOS status bar, no Dock icon when idle
- **Model selection** — choose from available OpenAI chat models (GPT-4o, o1, o3, etc.)
- **Configurable shortcut** — record any modifier + key combination
- **Clipboard-safe** — saves and restores your clipboard around each enhancement
- **Dark native UI** — modern dark theme with persistent settings
- **Zero runtime dependencies** — only Electron

## Install from DMG

1. Download `PromptPlus-1.0.0-universal.dmg` from the `dist/` folder (or wherever it was shared).
2. Open the DMG, drag **PromptPlus** to the **Applications** folder.
3. Launch PromptPlus from Applications.
4. On first launch, macOS may show a Gatekeeper warning — right-click the app and choose **Open** to bypass.

## Permissions

PromptPlus requires **Accessibility** permission to simulate copy/paste keystrokes in other apps.

On first use, macOS will prompt you:

> **System Settings → Privacy & Security → Accessibility**
>
> Enable **PromptPlus** in the list.

If the prompt doesn't appear automatically, add the app manually.

## Setup

1. **Paste your OpenAI API key** and click **Load & Verify Key**.
2. **Select a model** from the dropdown (e.g. `gpt-4o`). Selecting a model saves it automatically.
3. **Optionally change the hotkey** — click **Record**, press your key combination.
4. Click **Save Changes**.

The app now lives in your menu bar (sparkle icon). Click the icon to reopen settings or quit.

## Usage

1. **Select / highlight text** in any application.
2. Press the configured hotkey (default: `⌃⌘E`).
3. A brief ⏳ appears in the menu bar while processing.
4. The enhanced prompt **replaces the selected text** in-place.

## Configuration File

Settings are stored at:

```
~/Library/Application Support/promptplus/promptplus-config.json
```

Contains: API key, selected model, hotkey binding.

## Development

### Prerequisites

- **macOS** (tested on 13 Ventura and later)
- **Node.js 18+** and npm
- An **OpenAI API key** with access to chat models

### Run locally

```bash
cd promptplus
npm install
npm start
```

### Build distributable

```bash
npm run build          # builds both .dmg and .zip (universal binary)
npm run build:dmg      # DMG only
npm run build:dir      # unpacked .app (fastest, for testing)
```

Output goes to `dist/`.

## Troubleshooting

| Issue | Fix |
|---|---|
| Hotkey doesn't work | Check Accessibility permission is granted for PromptPlus |
| "No text selected" | Make sure text is highlighted before pressing the hotkey |
| API errors | Verify your API key and check your OpenAI account has credits |
| App not in menu bar | Look for the sparkle icon; try restarting the app |
| Gatekeeper blocks app | Right-click → Open, or: `xattr -cr /Applications/PromptPlus.app` |
| DevTools in dev mode | Press `⌘⌥I` when the settings window is focused |

## Architecture

```
main.js          → Electron main process: tray, hotkey, API calls, IPC
preload.js       → Secure bridge (contextBridge) between main ↔ renderer
renderer/
  index.html     → Settings UI structure
  styles.css     → Dark theme styling
  renderer.js    → UI logic, form handling, status updates
scripts/
  generate-icon.js → Generates the app icon at build time
build/
  entitlements.mac.plist → macOS entitlements for code signing
  icon.png              → Generated 1024×1024 app icon
```

## License

MIT

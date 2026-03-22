# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm start            # run in development (Electron dev mode, full logging)
npm run build        # generate icon + build universal .dmg and .zip → dist/
npm run build:dmg    # DMG only
npm run build:zip    # ZIP only
npm run build:dir    # unpacked .app (fastest for iteration)
```

There is no test suite. There are no lint scripts.

The app requires macOS and an OpenAI/OpenRouter API key to run.

## Architecture

**Single-process Electron app** with three files doing all the work:

- **`main.js`** — Electron main process. Owns everything: tray icon, global hotkey registration, `globalShortcut`, clipboard read/write, OpenRouter API calls (streaming via `https`), IPC handlers, and the persistent `Store` class that reads/writes `~/Library/Application Support/promptplus/promptplus-config.json`.
- **`preload.js`** — `contextBridge` bridge exposing a `window.api` object to the renderer. All IPC channels are declared here. Streaming responses use `ipcRenderer.send`/`ipcRenderer.on` (fire-and-forget with event callbacks); settings use `ipcRenderer.invoke` (promise-based).
- **`renderer/`** — Settings UI (HTML + CSS + JS). Communicates exclusively through `window.api`. Contains three tabs: **Enhance** (hotkey flow), **Analyze** (prompt analysis), **Generate** (prompt generation).

### Key flows

**Hotkey enhancement** (`⌃⌘E` default):
1. `globalShortcut` fires in main process
2. Main saves clipboard, simulates `Cmd+C` via `execFile('osascript', ...)`, waits for clipboard to update
3. Calls OpenRouter API (streaming) with `SYSTEM_PROMPT`
4. On completion, writes result to clipboard, simulates `Cmd+V`, then restores original clipboard

**Model list**: Fetched from OpenRouter `/api/v1/models`, cached in the store with a 24-hour TTL (`cachedModels` + `cachedModelsAt`). Default model is `anthropic/claude-3.5-sonnet`.

**System prompts**: Three hardcoded prompt constants in `main.js` — `SYSTEM_PROMPT` (enhance), `ANALYZE_PROMPT`, `GENERATE_PROMPT`.

**Streaming**: Main process makes raw HTTPS requests and forwards chunks to renderer via `stream-chunk`/`stream-done`/`stream-error` IPC events. The renderer can abort mid-stream via `stream-abort`.

### Config store defaults

```json
{
  "apiKey": "",
  "activeModel": "anthropic/claude-3.5-sonnet",
  "hotkey": "Control+Command+E",
  "favorites": [],
  "recentModels": [],
  "cachedModels": null,
  "cachedModelsAt": 0
}
```

### Build notes

- `scripts/generate-icon.js` generates `build/icon.png` at build time (no external dependencies — pure Node.js PNG generation)
- The tray icon is also generated at runtime in `main.js` via the same zero-dependency PNG approach
- No code signing with a Developer ID; Gatekeeper bypass via `xattr -cr` or right-click → Open
- Debug log written to `~/Library/Application Support/promptplus/promptplus-debug.log`; in dev (`!app.isPackaged`) logs also go to stdout

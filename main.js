// ═══════════════════════════════════════════════════════════════════════════
// PromptPlus — AI Prompt Enhancement for macOS
// A menu-bar app that enhances highlighted text via OpenAI on a global hotkey
// ═══════════════════════════════════════════════════════════════════════════

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  clipboard,
  ipcMain,
  nativeImage,
  Notification,
  systemPreferences,
} = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

// ─── Logging ────────────────────────────────────────────────────────────────
// In packaged builds, only log warnings and errors.
// In development (npm start), log everything for debugging.

const IS_DEV = !app.isPackaged;

// File-based logging so we can see output from the packaged app
const LOG_FILE = path.join(app.getPath('userData'), 'promptplus-debug.log');

function writeLog(level, args) {
  const ts = new Date().toISOString().slice(11, 23);
  const msg = `[${ts}] ${level}: ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, msg); } catch { /* ok */ }
}

function log(...args) {
  if (IS_DEV) console.log(...args);
  writeLog('INFO', args);
}

function logWarn(...args) {
  console.warn(...args);
  writeLog('WARN', args);
}

function logError(...args) {
  console.error(...args);
  writeLog('ERROR', args);
}

// ─── System Prompt ──────────────────────────────────────────────────────────

// ─── Analysis Prompt (for Analyze tab) ─────────────────────────────────────

const ANALYZE_PROMPT = `You are a prompt enhancement assistant that helps users write better prompts for AI systems like Claude. Your role is similar to Grammarly, but specifically designed for AI prompt writing. You will analyze prompts and provide actionable feedback on how to improve them based on best practices.

Here is the prompt to analyze:
<prompt>
{{PROMPT}}
</prompt>

Your task is to analyze this prompt and provide comprehensive feedback on how to enhance it. Consider the following aspects:

1. **Clarity and Specificity**: Is the prompt clear about what it's asking for? Are there ambiguous terms or vague instructions?
2. **Structure and Organization**: Is the prompt well-organized? Would XML tags, examples, or better formatting help?
3. **Context Completeness**: Are there context gaps? Is the AI given enough information to complete the task successfully?
4. **Best Practices**: Does the prompt follow AI prompting best practices such as:
   - Providing examples when appropriate
   - Specifying output format clearly
   - Using clear role assignment if needed
   - Breaking down complex tasks into steps
   - Including relevant constraints or guidelines
5. **Missing Elements**: What critical information or instructions might be missing?
6. **Potential Ambiguities**: Where might the AI misunderstand or need clarification?

Before providing your feedback, use the scratchpad below to systematically analyze the prompt:

<scratchpad>
- First, identify what the prompt is trying to accomplish
- Note any strengths in the current prompt
- Identify specific weaknesses or gaps
- Consider what best practices apply to this type of prompt
- Think about what additional information would help
- Plan your recommendations in order of importance
</scratchpad>

After your analysis, provide your feedback in the following format:

<feedback>
**Overall Assessment**:
[Provide a brief 2-3 sentence summary of the prompt's current state and main areas for improvement]

**Strengths**:
[List what the prompt does well, if anything]

**Key Issues**:
[List the main problems or gaps, ordered by importance]

**Specific Recommendations**:
[Provide numbered, actionable recommendations for improvement. For each recommendation, explain WHY it would help]

**Context Gaps**:
[Identify any missing context or information the AI would need to complete the task effectively]

**Enhanced Version** (optional):
[If the prompt needs significant revision, provide a rewritten version that incorporates your recommendations]
</feedback>

Your final output should contain only the content within the <feedback> tags. Do not include your scratchpad analysis in the final response.`;

// ─── Generate Prompt (for Generate tab) ─────────────────────────────────────

const GENERATE_PROMPT = `You are an expert prompt engineer. The user will describe a task they want to accomplish with an AI assistant. Your job is to generate a complete, well-structured prompt template that they can use.

Here is the user's task description:
<task>
{{TASK}}
</task>

Generate a comprehensive prompt that:
1. Assigns a clear, relevant role to the AI
2. Provides detailed instructions broken into logical steps
3. Specifies the expected output format
4. Includes relevant constraints and guidelines
5. Uses XML tags or markdown structure where appropriate
6. Adds placeholder variables in {{DOUBLE_BRACES}} for parts the user will fill in
7. Includes examples if they would help clarify the expected output

Output ONLY the generated prompt — no explanations, no commentary, no wrapper text.
Do NOT wrap the output in code blocks or quotes.
The prompt should be ready to copy and use immediately.`;

// ─── Enhance Prompt (for hotkey flow) ───────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert prompt engineer. Your sole task is to take the user's draft prompt and transform it into a highly effective, well-structured prompt optimized for AI interaction.

## Your Enhancement Process:

1. **Identify the Core Intent**: Determine exactly what the user wants to achieve.

2. **Apply Structure**: Organize with clear sections as appropriate:
   - **Goal**: What should the AI accomplish
   - **Context**: Background information and constraints
   - **Instructions**: Step-by-step guidance
   - **Output Format**: Expected response structure and format
   - **Examples**: If helpful, add brief examples

3. **Sharpen Language**:
   - Replace vague terms with specific, measurable criteria
   - Remove redundancy and filler
   - Add precision where the original was ambiguous
   - Use imperative, direct instructions

4. **Optimize for AI**:
   - Assign a clear role when beneficial
   - Include relevant constraints to prevent common failure modes
   - Add chain-of-thought guidance for complex reasoning tasks
   - Specify what NOT to do if common mistakes are likely

5. **Scale Appropriately**:
   - Simple questions → light enhancement, preserve brevity
   - Complex tasks → thorough restructuring with full sections
   - Creative requests → preserve creative freedom while adding useful structure

## Output Rules:
- Return ONLY the enhanced prompt — no explanations, no commentary
- Do NOT wrap in quotes, code blocks, or markdown formatting
- Do NOT add prefixes like "Enhanced:" or "Improved prompt:"
- Preserve the original language
- Preserve the original intent exactly — enhance execution, not direction`;

// ─── Master Prompt Builder — Interview Starter ──────────────────────────────

const MASTER_PROMPT_INTERVIEW = `You are helping a user build a comprehensive master prompt — a living document that encodes their professional identity, context, goals and constraints for reuse with any AI system.

A complete master prompt covers: role/title, company/product context, target audience, tone and voice, key offers/products/services, decision criteria, constraints (what NOT to do), team structure, tools used, and KPIs/success metrics.

Your task: Ask the user questions one at a time to gather all information needed. Keep questions conversational and specific. Do not ask multiple questions at once. After each answer, ask the next most important missing piece.

Begin by asking: "What is your primary role or title? (e.g. Founder, VP Marketing, Freelance Designer)"`;

// ─── Master Prompt Builder — Final Generation ────────────────────────────────

const MASTER_PROMPT_GENERATE = `You are an expert AI system architect. You have just completed an interview with a user to gather information about their professional identity and context.

Here is the complete interview transcript:
<interview>
{{TRANSCRIPT}}
</interview>

Write a comprehensive, well-structured master prompt document for this user. Requirements:
- Write in second person ("You are...", "Your audience is...")
- Cover all of: Role & Identity, Company/Product Context, Target Audience, Tone & Voice, Key Offers/Services, Decision Criteria, Constraints, Team Structure, Tools, KPIs
- Use clear ## section headers
- Be specific — use details from the interview, not generic placeholders
- Length: 400–800 words
- End with a brief "How to Use This Document" note

Output only the master prompt document — no preamble, no commentary.`;

// ─── System Prompt Builder — Interview Starter ──────────────────────────────

const SYSTEM_PROMPT_INTERVIEW = `You are an expert AI prompt engineer. A user wants to create a reusable system prompt based on a piece of output they liked.

Here is the source output to base the system prompt on:
<source_output>
{{SOURCE_OUTPUT}}
</source_output>

Your task: Ask clarifying questions — ONE at a time — to gather everything needed to write a system prompt that reliably reproduces this style and quality. Focus on: tone and persona, output format and structure, constraints and prohibitions, target audience, required knowledge domains.

Begin with your first question now.`;

// ─── System Prompt Builder — Final Generation ────────────────────────────────

const SYSTEM_PROMPT_GENERATE = `You are an expert AI prompt engineer. You have gathered information through an interview:

<interview>
{{TRANSCRIPT}}
</interview>

Write a complete, professional system prompt that reliably produces outputs matching the described style and quality. The system prompt must:
1. Open with a clear role assignment ("You are an expert...")
2. Define tone, voice and persona precisely
3. Specify output format and structure requirements
4. Include explicit constraints and prohibitions
5. Add chain-of-thought guidance where relevant
6. Be robust — do not include phrasing that could be easily overridden by user prompt injection

Output only the system prompt — no explanation, no wrapper text.`;

// ─── Pull Prompting — Interview Preamble ────────────────────────────────────

const PULL_INTERVIEW_PREAMBLE = `Before you begin working on this task, ask me all the questions you need to do it well. Ask ONE question at a time. Be specific about what you need to know. Once you have enough information, say exactly "I have what I need — generating now." and then produce the final output immediately.`;

// ─── Simple Persistent Store ────────────────────────────────────────────────

class Store {
  constructor(defaults = {}) {
    this.defaults = defaults;
    this.data = { ...defaults };
    this.filePath = null; // Set after app is ready
  }

  init() {
    this.filePath = path.join(app.getPath('userData'), 'promptplus-config.json');
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.data = { ...this.defaults, ...JSON.parse(raw) };
    } catch {
      this.data = { ...this.defaults };
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }

  setMultiple(obj) {
    Object.assign(this.data, obj);
    this._save();
  }

  getAll() {
    return { ...this.data };
  }

  _save() {
    if (!this.filePath) return;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      logError('Failed to save config:', err);
    }
  }
}

const store = new Store({
  apiKey: '',
  activeModel: 'anthropic/claude-3.5-sonnet',
  activeProvider: null,
  hotkey: 'Control+Command+E',
  favorites: [],
  recentModels: [],
  cachedModels: null,
  cachedModelsAt: 0,
  activeContextId: null,
  activeSystemPromptId: null,
  activeProjectId: null,
});

// ─── State ──────────────────────────────────────────────────────────────────

let tray = null;
let settingsWindow = null;
let isProcessing = false;

// ─── PNG Icon Generator (zero dependencies) ────────────────────────────────

function createPNG(width, height, pixels) {
  // CRC32 lookup table
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }

  function crc32(data) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      c = crcTable[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length);
    const body = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(body));
    return Buffer.concat([lenBuf, body, crcBuf]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const rowLen = 1 + width * 4;
  const raw = Buffer.alloc(height * rowLen);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * rowLen + 1 + x * 4;
      raw[di]     = pixels[si];
      raw[di + 1] = pixels[si + 1];
      raw[di + 2] = pixels[si + 2];
      raw[di + 3] = pixels[si + 3];
    }
  }

  const compressed = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createTrayIcon() {
  const size = 22;
  const px = new Uint8Array(size * size * 4);

  function set(x, y, a) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = a;
  }

  const c = 11; // center

  // Center dot
  set(c, c, 255);
  set(c - 1, c, 180); set(c + 1, c, 180);
  set(c, c - 1, 180); set(c, c + 1, 180);

  // Cardinal rays (N, S, E, W) with alpha taper
  for (let i = 2; i <= 8; i++) {
    const a = Math.round(240 * (1 - (i - 2) / 7));
    set(c, c - i, a);
    set(c, c + i, a);
    set(c + i, c, a);
    set(c - i, c, a);
  }

  // Diagonal rays (shorter)
  for (let i = 2; i <= 5; i++) {
    const a = Math.round(200 * (1 - (i - 2) / 4));
    set(c + i, c - i, a);
    set(c + i, c + i, a);
    set(c - i, c + i, a);
    set(c - i, c - i, a);
  }

  const pngBuf = createPNG(size, size, px);
  const image = nativeImage.createFromBuffer(pngBuf, { width: size, height: size });
  image.setTemplateImage(true);
  return image;
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  showSettingsWindow();
});

app.on('window-all-closed', (e) => {
  // Keep app running as menu-bar app
});

app.on('will-quit', () => {
  if (currentHotkey) {
    try { globalShortcut.unregister(currentHotkey); } catch { /* ok */ }
    currentHotkey = null;
  }
});

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  store.init();
  initDataDirs();
  createTray();
  registerHotkey(store.get('hotkey'));

  // Show settings on first launch (no API key)
  if (!store.get('apiKey')) {
    showSettingsWindow();
  }
});

// ─── Tray ───────────────────────────────────────────────────────────────────

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('PromptPlus — AI Prompt Enhancement');
  updateTrayMenu();
  tray.on('click', () => showSettingsWindow());
}

function updateTrayMenu() {
  const hotkey = store.get('hotkey') || 'Control+Command+E';
  const displayHotkey = hotkey
    .replace('Control', '⌃')
    .replace('Command', '⌘')
    .replace('Alt', '⌥')
    .replace('Shift', '⇧')
    .replace(/\+/g, '');

  const contextMenu = Menu.buildFromTemplate([
    { label: `Enhance Selected Text  ${displayHotkey}`, click: () => enhancePrompt() },
    { type: 'separator' },
    { label: 'Settings…', click: () => showSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit PromptPlus', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
}

// ─── Settings Window ────────────────────────────────────────────────────────

function showSettingsWindow() {
  if (process.platform === 'darwin') {
    app.dock.show();
  }

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 760,
    minWidth: 600,
    minHeight: 600,
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f10',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
    settingsWindow.focus();
  });

  // Cmd+Option+I opens DevTools in dev mode only
  if (IS_DEV) {
    settingsWindow.webContents.on('before-input-event', (event, input) => {
      if (input.meta && input.alt && input.key === 'i') {
        settingsWindow.webContents.toggleDevTools();
      }
    });
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    if (process.platform === 'darwin') {
      app.dock.hide();
    }
  });
}

function sendToRenderer(channel, ...args) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(channel, ...args);
  }
}

// ─── Global Shortcut ────────────────────────────────────────────────────────

let currentHotkey = null; // Track our registered hotkey to avoid unregisterAll()

function registerHotkey(accelerator) {
  // Only unregister OUR hotkey — never use unregisterAll() which can
  // interfere with other apps' global shortcuts (e.g. Whispr, Alfred)
  if (currentHotkey) {
    try {
      globalShortcut.unregister(currentHotkey);
    } catch {
      // ignore if it was already unregistered
    }
    currentHotkey = null;
  }

  if (!accelerator) return false;

  try {
    const ok = globalShortcut.register(accelerator, () => enhancePrompt());
    if (ok) {
      currentHotkey = accelerator;
      log('[Hotkey] Registered:', accelerator);
    } else {
      logError(`Failed to register hotkey: ${accelerator}`);
      showNotification('PromptPlus', `Could not register hotkey: ${accelerator}`);
    }
    return ok;
  } catch (err) {
    logError('Hotkey registration error:', err);
    showNotification('PromptPlus', `Invalid hotkey: ${accelerator}`);
    return false;
  }
}

// ─── Hotkey Handler (Core Flow) ─────────────────────────────────────────────

async function enhancePrompt() {
  if (isProcessing) {
    log('[Enhance] Already processing, skipping');
    return;
  }
  isProcessing = true;

  // Show processing indicator in menu bar
  if (tray) tray.setTitle(' ⏳');
  sendToRenderer('status-update', { type: 'processing', message: 'Enhancing prompt…' });

  let savedClipboard = '';

  try {
    const apiKey = store.get('apiKey');
    const model = store.get('activeModel');

    // Check Accessibility first
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    log('[Enhance] Starting — model:', model, '— apiKey present:', !!apiKey, '— Accessibility:', trusted);

    if (!apiKey) {
      log('[Enhance] No API key — aborting');
      showNotification('PromptPlus', 'No API key configured. Open Settings to add one.');
      sendToRenderer('status-update', { type: 'error', message: 'No API key configured' });
      showSettingsWindow();
      return;
    }

    if (!trusted) {
      log('[Enhance] Accessibility NOT granted — prompting');
      systemPreferences.isTrustedAccessibilityClient(true); // This opens the prompt
      showNotification(
        'PromptPlus',
        'Accessibility permission required. Add PromptPlus in System Settings → Privacy & Security → Accessibility, then try again.'
      );
      sendToRenderer('status-update', { type: 'error', message: 'Accessibility permission required' });
      return;
    }

    // Step 1: Get selected text — try Accessibility API first (most reliable),
    // fall back to Cmd+C clipboard approach
    let selectedText = '';

    // Method A: AXSelectedText (no clipboard manipulation needed)
    log('[Enhance] Step 1A — Reading selected text via Accessibility API...');
    try {
      selectedText = await getSelectedTextViaAX();
      log('[Enhance] Step 1A — AX got text, length:', selectedText?.length || 0);
    } catch (axErr) {
      log('[Enhance] Step 1A — AX failed:', axErr.message, '— falling back to Cmd+C');
    }

    // Method B: Cmd+C fallback (for apps that don't support AXSelectedText)
    if (!selectedText || selectedText.trim().length === 0) {
      log('[Enhance] Step 1B — Trying Cmd+C via native helper...');
      savedClipboard = clipboard.readText();
      clipboard.writeText(''); // clear to detect fresh copy

      await delay(100); // let system settle after hotkey

      try {
        await simulateKeystroke('c', '{command down}');
        log('[Enhance] Step 1B — Cmd+C sent');
      } catch (copyErr) {
        clipboard.writeText(savedClipboard);
        logError('[Enhance] Step 1B — Cmd+C failed:', copyErr.message);
        showNotification(
          'PromptPlus',
          'Cannot copy text. Ensure PromptPlus has Accessibility permission and restart.'
        );
        sendToRenderer('status-update', { type: 'error', message: 'Copy failed — check Accessibility' });
        return;
      }

      await delay(500); // wait for clipboard to update

      selectedText = clipboard.readText();
      log('[Enhance] Step 1B — Clipboard text length:', selectedText?.length || 0);
    }

    if (!selectedText || selectedText.trim().length === 0) {
      if (savedClipboard) clipboard.writeText(savedClipboard);
      log('[Enhance] No text found via AX or Cmd+C');
      showNotification('PromptPlus', 'No text selected — highlight text and try again.');
      sendToRenderer('status-update', { type: 'error', message: 'No text selected' });
      return;
    }

    // Step 2: Call OpenRouter API
    log('[Enhance] Step 2 — Calling OpenRouter — text length:', selectedText.length, '— model:', model);
    log('[Enhance] ── USER PROMPT (first 200) ──\n' + selectedText.substring(0, 200));

    const contextMessages = buildContextMessages();
    const enhanced = await callOpenRouter([
      ...contextMessages,
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: selectedText },
    ]);
    log('[Enhance] Step 2 — Response length:', enhanced?.length || 0);

    if (!enhanced) {
      if (savedClipboard) clipboard.writeText(savedClipboard);
      logWarn('[Enhance] Empty API response — aborting');
      showNotification('PromptPlus', 'Received empty response from API.');
      sendToRenderer('status-update', { type: 'error', message: 'Empty API response' });
      return;
    }

    // Step 3: Replace selected text with enhanced version
    log('[Enhance] Step 3 — Pasting enhanced text...');
    clipboard.writeText(enhanced);

    try {
      await simulateKeystroke('v', '{command down}');
      await delay(300);
      log('[Enhance] Step 3 — Paste sent');
    } catch (pasteErr) {
      logError('[Enhance] Step 3 — Paste failed:', pasteErr.message);
      // Text is still on clipboard — user can manually Cmd+V
      showNotification(
        'PromptPlus',
        'Enhanced text is on your clipboard — press Cmd+V to paste it manually.'
      );
      sendToRenderer('status-update', { type: 'success', message: 'Enhanced! Paste with Cmd+V' });
      return;
    }

    // Restore original clipboard after a brief delay
    await delay(500);
    if (savedClipboard) clipboard.writeText(savedClipboard);

    log('[Enhance] Done — text replaced');
    showNotification('PromptPlus', 'Prompt enhanced successfully!');
    sendToRenderer('status-update', { type: 'success', message: 'Prompt enhanced!' });
  } catch (err) {
    logError('[Enhance] ERROR:', err);
    showNotification('PromptPlus', `Error: ${err.message}`);
    sendToRenderer('status-update', { type: 'error', message: err.message });

    // Restore clipboard on error
    if (savedClipboard) {
      clipboard.writeText(savedClipboard);
    }
  } finally {
    isProcessing = false;
    if (tray) tray.setTitle('');
  }
}

// ─── OpenRouter API ──────────────────────────────────────────────────────────

const OR_BASE = 'https://openrouter.ai/api/v1';
const OR_HEADERS = {
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://promptplus.app',
  'X-Title': 'PromptPlus',
};

/** Non-streaming call — returns full content string */
async function callOpenRouter(messages, signal) {
  const apiKey = store.get('apiKey');
  const model = store.get('activeModel') || 'anthropic/claude-3.5-sonnet';
  const provider = store.get('activeProvider');

  const controller = signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), 90000) : null;

  const body = { model, messages };
  if (provider) body.provider = { order: [provider], allow_fallbacks: true };

  log('[OR] Request — model:', model, '— provider:', provider || 'auto');

  try {
    const response = await fetch(`${OR_BASE}/chat/completions`, {
      method: 'POST',
      headers: { ...OR_HEADERS, 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: signal || controller?.signal,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      logError('[OR] Error body:', JSON.stringify(errBody));
      throw new Error(errBody.error?.message || `API returned ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';
    log('[OR] Success — length:', content.length);
    return content;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Async generator — yields text chunks from SSE stream */
async function* streamOpenRouter(messages, signal) {
  const apiKey = store.get('apiKey');
  const model = store.get('activeModel') || 'anthropic/claude-3.5-sonnet';
  const provider = store.get('activeProvider');

  const body = { model, messages, stream: true };
  if (provider) body.provider = { order: [provider], allow_fallbacks: true };

  log('[OR/stream] Request — model:', model);

  const response = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: { ...OR_HEADERS, 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error?.message || `API returned ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const chunk = json.choices?.[0]?.delta?.content;
          if (chunk) yield chunk;
        } catch { /* ignore malformed SSE */ }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Fetch full model catalogue from OpenRouter */
async function fetchOpenRouterModels(apiKey) {
  const response = await fetch(`${OR_BASE}/models`, {
    headers: { ...OR_HEADERS, 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error?.message || `API returned ${response.status}`);
  }

  const data = await response.json();
  log('[OR/models] Total models:', data.data?.length);
  return data.data || [];
}

// ─── Utilities ──────────────────────────────────────────────────────────────

// macOS virtual key codes
const KEY_CODES = { c: 8, v: 9, a: 0, x: 7, z: 6 };

// Path for compiled native keystroke helper (compiled on first use)
const HELPER_DIR = app.getPath('userData');
const HELPER_PATH = path.join(HELPER_DIR, 'pp-keystroke');

/**
 * Get the selected text from the frontmost application using macOS Accessibility API.
 * This is far more reliable than simulating Cmd+C because it doesn't require
 * "send keystrokes" permission — only the basic Accessibility permission.
 */
function getSelectedTextViaAX() {
  return new Promise((resolve, reject) => {
    const jxa = `
ObjC.import('Cocoa');
ObjC.import('ApplicationServices');

// Get frontmost application
var ws = $.NSWorkspace.sharedWorkspace;
var frontApp = ws.frontmostApplication;
var pid = frontApp.processIdentifier;
var appName = ObjC.unwrap(frontApp.localizedName);

// Create AX element for the application
var axApp = $.AXUIElementCreateApplication(pid);

// Get focused UI element
var focusedRef = Ref();
var err = $.AXUIElementCopyAttributeValue(axApp, $('AXFocusedUIElement'), focusedRef);
if (err !== 0) {
  JSON.stringify({error: 'AX_FOCUS_ERR', code: err, app: appName});
} else {
  var focused = focusedRef[0];

  // Try to get AXSelectedText
  var textRef = Ref();
  err = $.AXUIElementCopyAttributeValue(focused, $('AXSelectedText'), textRef);
  if (err !== 0) {
    JSON.stringify({error: 'AX_TEXT_ERR', code: err, app: appName});
  } else {
    var text = ObjC.unwrap(textRef[0]);
    JSON.stringify({text: text, app: appName});
  }
}
`;

    execFile('osascript', ['-l', 'JavaScript', '-e', jxa], (err, stdout, stderr) => {
      if (err) {
        logError('[AX] Failed:', err.message, stderr);
        reject(new Error(`AX failed: ${err.message}`));
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) {
          log('[AX] Error from', result.app, ':', result.error, 'code:', result.code);
          reject(new Error(`AX error: ${result.error} (${result.code}) in ${result.app}`));
        } else {
          log('[AX] Got text from', result.app, '— length:', result.text?.length || 0);
          resolve(result.text || '');
        }
      } catch (parseErr) {
        logError('[AX] Parse error:', parseErr.message, 'stdout:', stdout);
        reject(new Error('Failed to parse AX response'));
      }
    });
  });
}

/**
 * Compile a native C helper that uses CGEvent to send keystrokes.
 * Being a direct child process of PromptPlus.app, it should inherit
 * the Accessibility permission granted to the parent app.
 * Compiled once and cached in the user data directory.
 */
function ensureNativeHelper() {
  return new Promise((resolve, reject) => {
    // Check if already compiled
    if (fs.existsSync(HELPER_PATH)) {
      resolve(HELPER_PATH);
      return;
    }

    const source = `
#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: pp-keystroke <keycode> [flags]\\n");
        return 1;
    }

    int keyCode = atoi(argv[1]);
    CGEventFlags flags = argc > 2 ? (CGEventFlags)strtoul(argv[2], NULL, 0) : 0;

    // Small delay to let system settle
    usleep(50000); // 50ms

    CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
    if (!src) {
        fprintf(stderr, "Failed to create event source\\n");
        return 2;
    }

    CGEventRef down = CGEventCreateKeyboardEvent(src, (CGKeyCode)keyCode, true);
    CGEventSetFlags(down, flags);
    CGEventPost(kCGHIDEventTap, down);
    CFRelease(down);

    usleep(30000); // 30ms between key down and up

    CGEventRef up = CGEventCreateKeyboardEvent(src, (CGKeyCode)keyCode, false);
    CGEventSetFlags(up, flags);
    CGEventPost(kCGHIDEventTap, up);
    CFRelease(up);

    CFRelease(src);
    return 0;
}
`;

    const srcPath = path.join(HELPER_DIR, 'pp-keystroke.c');
    fs.writeFileSync(srcPath, source);

    log('[Helper] Compiling native keystroke helper...');
    execFile('cc', ['-framework', 'CoreGraphics', '-framework', 'CoreFoundation', '-o', HELPER_PATH, srcPath], (err, stdout, stderr) => {
      if (err) {
        logError('[Helper] Compile failed:', err.message, stderr);
        reject(new Error(`Failed to compile helper: ${err.message}`));
      } else {
        log('[Helper] Compiled successfully:', HELPER_PATH);
        // Clean up source
        try { fs.unlinkSync(srcPath); } catch { /* ok */ }
        resolve(HELPER_PATH);
      }
    });
  });
}

/**
 * Send a keystroke using the native compiled helper.
 * Falls back to CGEvent via JXA if the helper isn't available.
 */
function simulateKeystroke(key, modifierStr) {
  return new Promise(async (resolve, reject) => {
    const keyCode = KEY_CODES[key.toLowerCase()];
    if (keyCode === undefined) {
      reject(new Error(`Unknown key: ${key}`));
      return;
    }

    // Parse modifier flags
    let flags = 0;
    if (modifierStr.includes('command')) flags |= 0x100000;
    if (modifierStr.includes('shift'))   flags |= 0x020000;
    if (modifierStr.includes('control')) flags |= 0x040000;
    if (modifierStr.includes('alt') || modifierStr.includes('option')) flags |= 0x080000;

    // Try native helper first (most reliable)
    try {
      const helperPath = await ensureNativeHelper();
      execFile(helperPath, [String(keyCode), String(flags)], (err, stdout, stderr) => {
        if (err) {
          logError('[Keystroke] Native helper failed:', err.message, stderr);
          // Fall back to JXA
          simulateKeystrokeJXA(keyCode, flags).then(resolve).catch(reject);
        } else {
          log('[Keystroke] Native helper sent: key=' + key + ' keyCode=' + keyCode + ' flags=0x' + flags.toString(16));
          resolve();
        }
      });
    } catch (helperErr) {
      logWarn('[Keystroke] No native helper, falling back to JXA:', helperErr.message);
      simulateKeystrokeJXA(keyCode, flags).then(resolve).catch(reject);
    }
  });
}

/**
 * Fallback: simulate keystroke via JXA CGEvent
 */
function simulateKeystrokeJXA(keyCode, flags) {
  return new Promise((resolve, reject) => {
    // Use literal numeric values — constants verified to resolve correctly
    const jxa = `
ObjC.import('CoreGraphics');
var src = $.CGEventSourceCreate(0);
var down = $.CGEventCreateKeyboardEvent(src, ${keyCode}, true);
$.CGEventSetFlags(down, ${flags});
$.CGEventPost(0, down);
delay(0.05);
var up = $.CGEventCreateKeyboardEvent(src, ${keyCode}, false);
$.CGEventSetFlags(up, ${flags});
$.CGEventPost(0, up);
"ok";
`;

    execFile('osascript', ['-l', 'JavaScript', '-e', jxa], (err, stdout, stderr) => {
      if (err) {
        logError('[Keystroke] JXA CGEvent FAILED:', err.message);
        reject(new Error(`Keystroke failed: ${err.message}`));
      } else {
        log('[Keystroke] JXA CGEvent sent: keyCode=' + keyCode + ' flags=0x' + flags.toString(16));
        resolve();
      }
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: true }).show();
  }
}

// ─── Data Directory Management ───────────────────────────────────────────────

function getDataDir(subdir) {
  return path.join(app.getPath('userData'), subdir);
}

function initDataDirs() {
  ['master-prompts', 'system-prompts', 'projects', 'exports'].forEach(subdir => {
    try { fs.mkdirSync(getDataDir(subdir), { recursive: true }); } catch { /* ok */ }
  });
  log('[DataDirs] Initialized');
}

function readJsonDir(subdir) {
  const dir = getDataDir(subdir);
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch { return []; }
}

function writeJsonFile(subdir, id, data) {
  const dir = getDataDir(subdir);
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(data, null, 2));
}

function deleteJsonFile(subdir, id) {
  const p = path.join(getDataDir(subdir), `${id}.json`);
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ok */ }
}

// ─── Active Context Injection ────────────────────────────────────────────────
// Returns extra messages to prepend to any API call when the user has an
// active master prompt and/or system prompt loaded.

function buildContextMessages() {
  const msgs = [];

  const sysId = store.get('activeSystemPromptId');
  if (sysId) {
    try {
      const sp = JSON.parse(fs.readFileSync(path.join(getDataDir('system-prompts'), `${sysId}.json`), 'utf-8'));
      if (sp?.content) msgs.push({ role: 'system', content: sp.content });
    } catch { /* file deleted or corrupt — silently skip */ }
  }

  const ctxId = store.get('activeContextId');
  if (ctxId) {
    try {
      const mp = JSON.parse(fs.readFileSync(path.join(getDataDir('master-prompts'), `${ctxId}.json`), 'utf-8'));
      if (mp?.fullDocument) {
        msgs.push({ role: 'user', content: `[Master Prompt Context — ${mp.name}]\n\n${mp.fullDocument}` });
        msgs.push({ role: 'assistant', content: 'Understood. I have your context and will apply it throughout our conversation.' });
      }
    } catch { /* file deleted or corrupt — silently skip */ }
  }

  return msgs;
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────

ipcMain.handle('get-settings', () => {
  log('[IPC] get-settings');
  return store.getAll();
});

ipcMain.handle('save-settings', (_event, settings) => {
  log('[IPC] save-settings — keys:', Object.keys(settings).join(', '));
  try {
    if (settings.apiKey !== undefined) store.set('apiKey', settings.apiKey);
    if (settings.hotkey !== undefined) {
      store.set('hotkey', settings.hotkey);
      registerHotkey(settings.hotkey);
      updateTrayMenu();
    }
    return { success: true };
  } catch (err) {
    logError('[IPC] save-settings ERROR:', err);
    throw err;
  }
});

ipcMain.handle('get-models', async (_event, forceRefresh) => {
  log('[IPC] get-models — forceRefresh:', forceRefresh);
  try {
    const apiKey = store.get('apiKey');
    if (!apiKey) throw new Error('No API key configured.');

    const cached = store.get('cachedModels');
    const cachedAt = store.get('cachedModelsAt') || 0;
    const age = Date.now() - cachedAt;
    const CACHE_TTL = 60 * 60 * 1000; // 1 hour

    if (!forceRefresh && cached && age < CACHE_TTL) {
      log('[IPC] get-models — returning cache, age:', Math.round(age / 1000), 's');
      return cached;
    }

    const models = await fetchOpenRouterModels(apiKey);
    store.set('cachedModels', models);
    store.set('cachedModelsAt', Date.now());
    log('[IPC] get-models — fetched', models.length, 'models');
    return models;
  } catch (err) {
    logError('[IPC] get-models ERROR:', err.message);
    throw err;
  }
});

ipcMain.handle('start-recording', () => {
  log('[IPC] start-recording');
  // Temporarily unregister only our hotkey so keystrokes reach the renderer
  if (currentHotkey) {
    try {
      globalShortcut.unregister(currentHotkey);
    } catch { /* ok */ }
  }
  return { ok: true };
});

ipcMain.handle('stop-recording', (_event, newHotkey) => {
  log('[IPC] stop-recording —', newHotkey);
  const hotkey = newHotkey || store.get('hotkey');
  currentHotkey = null; // clear before re-registering
  registerHotkey(hotkey);
  return { ok: true };
});

// ─── Streaming IPC ───────────────────────────────────────────────────────────

let activeStreamAbort = null;

ipcMain.on('stream-request', async (event, { reqId, type, input }) => {
  // Abort any in-flight stream
  if (activeStreamAbort) { activeStreamAbort.abort(); }
  const controller = new AbortController();
  activeStreamAbort = controller;

  const apiKey = store.get('apiKey');
  if (!apiKey) {
    event.sender.send('stream-error', { reqId, message: 'No API key configured. Go to Settings.' });
    return;
  }

  let messages;
  if (type === 'generate') {
    const ctx = buildContextMessages();
    messages = [
      ...ctx,
      { role: 'system', content: GENERATE_PROMPT.split('\n')[0] },
      { role: 'user', content: GENERATE_PROMPT.replace('{{TASK}}', input) },
    ];
  } else if (type === 'analyze') {
    const ctx = buildContextMessages();
    messages = [
      ...ctx,
      { role: 'user', content: ANALYZE_PROMPT.replace('{{PROMPT}}', input) },
    ];

  // ── Master Prompt Wizard ───────────────────────────────────────────────────
  } else if (type === 'master-prompt-interview') {
    // input = { role: string }
    messages = [{ role: 'user', content: MASTER_PROMPT_INTERVIEW }];

  } else if (type === 'master-prompt-continue') {
    // input = messages[] — full conversation history from renderer
    messages = input;

  } else if (type === 'master-prompt-generate') {
    // input = { transcript: string }
    messages = [{ role: 'user', content: MASTER_PROMPT_GENERATE.replace('{{TRANSCRIPT}}', input.transcript) }];

  // ── System Prompt Wizard ───────────────────────────────────────────────────
  } else if (type === 'system-prompt-interview') {
    // input = { sourceOutput: string }
    messages = [{ role: 'user', content: SYSTEM_PROMPT_INTERVIEW.replace('{{SOURCE_OUTPUT}}', input.sourceOutput || '') }];

  } else if (type === 'system-prompt-continue') {
    // input = messages[] — full conversation history
    messages = input;

  } else if (type === 'system-prompt-generate') {
    // input = { transcript: string }
    messages = [{ role: 'user', content: SYSTEM_PROMPT_GENERATE.replace('{{TRANSCRIPT}}', input.transcript) }];

  // ── Pull Prompting ─────────────────────────────────────────────────────────
  } else if (type === 'pull-interview') {
    // input = messages[] — conversation history; first message already has PULL_INTERVIEW_PREAMBLE prepended
    messages = input;

  } else if (type === 'pull-generate') {
    // input = messages[] — full context with all Q&A answers collected
    messages = input;

  } else {
    event.sender.send('stream-error', { reqId, message: `Unknown stream type: ${type}` });
    return;
  }

  log('[IPC] stream-request — type:', type, '— reqId:', reqId);

  try {
    for await (const chunk of streamOpenRouter(messages, controller.signal)) {
      if (controller.signal.aborted) break;
      event.sender.send('stream-chunk', { reqId, chunk });
    }
    event.sender.send('stream-done', { reqId });
  } catch (err) {
    if (err.name !== 'AbortError') {
      logError('[IPC] stream-request ERROR:', err.message);
      event.sender.send('stream-error', { reqId, message: err.message });
    } else {
      event.sender.send('stream-done', { reqId }); // aborted = done from UI perspective
    }
  } finally {
    if (activeStreamAbort === controller) activeStreamAbort = null;
  }
});

ipcMain.on('stream-abort', () => {
  log('[IPC] stream-abort');
  if (activeStreamAbort) {
    activeStreamAbort.abort();
    activeStreamAbort = null;
  }
});

// ─── Model & Favorites IPC ──────────────────────────────────────────────────

ipcMain.handle('set-active-model', (_event, { model, provider }) => {
  log('[IPC] set-active-model —', model, '| provider:', provider || 'auto');
  store.set('activeModel', model);
  store.set('activeProvider', provider || null);

  // Add to recents
  const recents = store.get('recentModels') || [];
  const filtered = recents.filter((r) => r.id !== model);
  filtered.unshift({ id: model, ts: Date.now() });
  store.set('recentModels', filtered.slice(0, 10)); // keep 10

  return { success: true };
});

ipcMain.handle('toggle-favorite', (_event, modelId) => {
  const favs = store.get('favorites') || [];
  const idx = favs.indexOf(modelId);
  if (idx === -1) {
    favs.push(modelId);
  } else {
    favs.splice(idx, 1);
  }
  store.set('favorites', favs);
  log('[IPC] toggle-favorite —', modelId, '—', idx === -1 ? 'added' : 'removed');
  return favs;
});

// ─── Master Prompts CRUD ─────────────────────────────────────────────────────

ipcMain.handle('list-master-prompts', () => {
  log('[IPC] list-master-prompts');
  return readJsonDir('master-prompts');
});

ipcMain.handle('save-master-prompt', (_event, data) => {
  const now = Date.now();
  const id = data.id || crypto.randomUUID();
  const record = { ...data, id, updatedAt: now, createdAt: data.createdAt || now };
  writeJsonFile('master-prompts', id, record);
  log('[IPC] save-master-prompt —', id, '—', record.name);
  return record;
});

ipcMain.handle('delete-master-prompt', (_event, id) => {
  deleteJsonFile('master-prompts', id);
  if (store.get('activeContextId') === id) store.set('activeContextId', null);
  log('[IPC] delete-master-prompt —', id);
  return { ok: true };
});

// ─── System Prompts CRUD ─────────────────────────────────────────────────────

ipcMain.handle('list-system-prompts', () => {
  log('[IPC] list-system-prompts');
  return readJsonDir('system-prompts');
});

ipcMain.handle('save-system-prompt', (_event, data) => {
  const now = Date.now();
  const id = data.id || crypto.randomUUID();
  const record = { ...data, id, updatedAt: now, createdAt: data.createdAt || now };
  writeJsonFile('system-prompts', id, record);
  log('[IPC] save-system-prompt —', id, '—', record.name);
  return record;
});

ipcMain.handle('delete-system-prompt', (_event, id) => {
  deleteJsonFile('system-prompts', id);
  if (store.get('activeSystemPromptId') === id) store.set('activeSystemPromptId', null);
  log('[IPC] delete-system-prompt —', id);
  return { ok: true };
});

// ─── Projects CRUD ───────────────────────────────────────────────────────────

ipcMain.handle('list-projects', () => {
  log('[IPC] list-projects');
  return readJsonDir('projects');
});

ipcMain.handle('save-project', (_event, data) => {
  const now = Date.now();
  const id = data.id || crypto.randomUUID();
  const record = { ...data, id, updatedAt: now, createdAt: data.createdAt || now, lastActivityAt: now };
  writeJsonFile('projects', id, record);
  log('[IPC] save-project —', id, '—', record.name);
  return record;
});

ipcMain.handle('delete-project', (_event, id) => {
  deleteJsonFile('projects', id);
  if (store.get('activeProjectId') === id) store.set('activeProjectId', null);
  log('[IPC] delete-project —', id);
  return { ok: true };
});

// ─── Active Context ──────────────────────────────────────────────────────────

ipcMain.handle('set-active-context', (_event, { contextId, systemPromptId, projectId } = {}) => {
  if (contextId !== undefined) store.set('activeContextId', contextId);
  if (systemPromptId !== undefined) store.set('activeSystemPromptId', systemPromptId);
  if (projectId !== undefined) store.set('activeProjectId', projectId);
  log('[IPC] set-active-context — ctx:', store.get('activeContextId'), 'sys:', store.get('activeSystemPromptId'));
  return { ok: true };
});

ipcMain.handle('get-active-context', () => {
  const ctxId = store.get('activeContextId');
  const sysId = store.get('activeSystemPromptId');
  const projId = store.get('activeProjectId');

  let masterPrompt = null;
  let systemPrompt = null;

  if (ctxId) {
    try { masterPrompt = JSON.parse(fs.readFileSync(path.join(getDataDir('master-prompts'), `${ctxId}.json`), 'utf-8')); }
    catch { store.set('activeContextId', null); } // stale reference — clear it
  }
  if (sysId) {
    try { systemPrompt = JSON.parse(fs.readFileSync(path.join(getDataDir('system-prompts'), `${sysId}.json`), 'utf-8')); }
    catch { store.set('activeSystemPromptId', null); }
  }

  return { masterPrompt, systemPrompt, projectId: projId };
});

// ─── Export ──────────────────────────────────────────────────────────────────

ipcMain.handle('export-document', (_event, { name, content, format }) => {
  const dir = getDataDir('exports');
  const date = new Date().toISOString().slice(0, 10);
  const safeName = (name || 'export').replace(/[^a-z0-9\-_]/gi, '_');
  const ext = format === 'json' ? 'json' : 'md';
  const filePath = path.join(dir, `${safeName}-${date}.${ext}`);
  fs.writeFileSync(filePath, content, 'utf-8');
  log('[IPC] export-document —', filePath);
  return { filePath };
});

// ─── Import ──────────────────────────────────────────────────────────────────

ipcMain.handle('import-document', (_event, { content, type }) => {
  try {
    const data = JSON.parse(content);
    if (!data.name) throw new Error('Missing required field: name');
    const subdir = type === 'system-prompt' ? 'system-prompts' : 'master-prompts';
    const newId = crypto.randomUUID();
    const record = { ...data, id: newId, createdAt: Date.now(), updatedAt: Date.now() };
    writeJsonFile(subdir, newId, record);
    log('[IPC] import-document — type:', type, '— id:', newId);
    return record;
  } catch (err) {
    logError('[IPC] import-document ERROR:', err.message);
    throw new Error('Import failed: ' + err.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PromptPlus — Renderer (OpenRouter edition)
// ═══════════════════════════════════════════════════════════════════════════

if (typeof api === 'undefined') {
  document.body.innerHTML = `<div style="padding:40px;color:#f85149;font-family:monospace">
    <h2>Preload bridge failed</h2><p>Run <code>npm start</code>.</p></div>`;
  throw new Error('window.api is undefined');
}

const $ = (id) => document.getElementById(id);

// ─── Featured model list (shown in Featured filter) ──────────────────────────
const FEATURED_IDS = new Set([
  'anthropic/claude-3.5-sonnet', 'anthropic/claude-3.5-haiku',
  'anthropic/claude-3-opus', 'anthropic/claude-3.7-sonnet',
  'openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/o3-mini', 'openai/o1',
  'google/gemini-2.0-flash-001', 'google/gemini-pro-1.5',
  'meta-llama/llama-3.3-70b-instruct', 'mistralai/mistral-large',
  'deepseek/deepseek-r1', 'qwen/qwq-32b',
]);

// ─── State ──────────────────────────────────────────────────────────────────
let allModels = [];        // raw OpenRouter model objects
let favorites = [];        // model id strings
let recentModels = [];     // {id, ts} objects
let activeModel = '';
let activeProvider = null;
let pendingModel = '';     // selection in progress inside modal
let pendingProvider = '';

let currentFilter = 'all';
let searchQuery = '';
let generateReqId = null;
let analyzeReqId  = null;
let generateFull  = '';   // accumulated streamed text for generate
let analyzeFull   = '';   // accumulated streamed text for analyze

const DEFAULT_HOTKEY = 'Control+Command+E';
let isRecording = false;

// ─── DOM refs ────────────────────────────────────────────────────────────────
const modelBadge       = $('modelBadge');
const modelBadgeName   = $('modelBadgeName');
const modelBadgeProvider = $('modelBadgeProvider');
const refreshModelsBtn = $('refreshModelsBtn');

const generateInput  = $('generateInput');
const generateBtn    = $('generateBtn');
const generateResult = $('generateResult');
const generateOutput = $('generateOutput');
const stopGenerate   = $('stopGenerate');
const copyGenerated  = $('copyGenerated');
const refineBtn      = $('refineGenerated');
const generateVars   = $('generateVariables');
const variableTags   = $('variableTags');
const thinkingToggle = $('thinkingToggle');

const analyzeInput   = $('analyzeInput');
const analyzeBtn     = $('analyzeBtn');
const analyzeResult  = $('analyzeResult');
const analyzeOutput  = $('analyzeOutput');
const stopAnalyze    = $('stopAnalyze');
const copyAnalysis   = $('copyAnalysis');
const charCount      = $('charCount');

const apiKeyInput  = $('apiKey');
const toggleKeyBtn = $('toggleKey');
const loadApiBtn   = $('loadApi');
const apiStatus    = $('apiStatus');
const hotkeyInput  = $('hotkey');
const recordBtn    = $('recordHotkey');
const saveBtn      = $('saveBtn');
const statusDot    = $('statusDot');
const statusText   = $('statusText');
const toastEl      = $('toast');

const modelModal     = $('modelModal');
const modalClose     = $('modalClose');
const modelSearch    = $('modelSearch');
const modelList      = $('modelList');
const favList        = $('favList');
const recentList     = $('recentList');
const favSection     = $('favSection');
const recentSection  = $('recentSection');
const allSectionLabel = $('allSectionLabel');
const modalSelModel  = $('modalSelModel');
const modalProvider  = $('modalProvider');
const modalSelectBtn = $('modalSelect');

// ─── Utility ────────────────────────────────────────────────────────────────

function showToast(msg, type = 'info', ms = 3000) {
  toastEl.textContent = msg;
  toastEl.className = `toast show ${type}`;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function updateStatus(type, msg) {
  statusDot.className = `dot ${type}`;
  statusText.textContent = msg;
}

function genReqId() {
  return Math.random().toString(36).slice(2);
}

// ─── Active model badge ──────────────────────────────────────────────────────

function updateModelBadge(modelId, provider) {
  activeModel  = modelId || '';
  activeProvider = provider || null;
  if (!modelId) {
    modelBadgeName.textContent = 'No model selected';
    modelBadgeProvider.textContent = '';
    return;
  }
  // Show short name: strip org prefix for display
  const parts = modelId.split('/');
  modelBadgeName.textContent = parts.length > 1 ? parts[1] : modelId;
  modelBadgeProvider.textContent = provider ? `via ${provider}` : parts[0];

  // Sync settings tab model badge
  const sName = $('settingsModelName');
  const sProv = $('settingsModelProvider');
  if (sName) {
    sName.textContent = parts.length > 1 ? parts[1] : modelId;
    sProv.textContent = provider ? `via ${provider}` : parts[0];
  }
}

// Settings model badge opens the model picker
const settingsModelBadge = $('settingsModelBadge');
if (settingsModelBadge) {
  settingsModelBadge.addEventListener('click', () => {
    modelModal.classList.remove('hidden');
    modelSearch.focus();
  });
}

// ─── Tab navigation ───────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    $(`tab-${tab.dataset.tab}`).classList.add('active');
    saveBtn.classList.toggle('hidden-in-workshop', tab.dataset.tab !== 'settings');
  });
});

// ─── Workshop mode toggle ─────────────────────────────────────────────────────

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.workshop-mode').forEach((m) => m.classList.remove('active'));
    $(`mode-${btn.dataset.mode}`).classList.add('active');
  });
});

// ─── Quick-task chips ─────────────────────────────────────────────────────────

document.querySelectorAll('.chip[data-task]').forEach((chip) => {
  chip.addEventListener('click', () => {
    generateInput.value = chip.dataset.task;
    generateInput.focus();
  });
});

// char count for analyze
analyzeInput.addEventListener('input', () => {
  charCount.textContent = analyzeInput.value.length;
});

// ─── Model badge → open modal ─────────────────────────────────────────────────

modelBadge.addEventListener('click', openModelModal);
refreshModelsBtn.addEventListener('click', async () => {
  refreshModelsBtn.disabled = true;
  await loadModels(true);
  refreshModelsBtn.disabled = false;
});

// ══════════════════════════════════════════════════════════════════════════════
//  MODEL PICKER MODAL
// ══════════════════════════════════════════════════════════════════════════════

function openModelModal() {
  pendingModel    = activeModel;
  pendingProvider = activeProvider || '';
  modalProvider.value  = pendingProvider;
  updateModalSelection(pendingModel);
  renderModal();
  modelModal.classList.remove('hidden');
  setTimeout(() => modelSearch.focus(), 50);
}

function closeModelModal() {
  modelModal.classList.add('hidden');
  modelSearch.value = '';
  searchQuery = '';
}

modalClose.addEventListener('click', closeModelModal);
modelModal.addEventListener('click', (e) => { if (e.target === modelModal) closeModelModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modelModal.classList.contains('hidden')) closeModelModal();
});

// Filters
document.querySelectorAll('.filter-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    renderModal();
  });
});

// Search
modelSearch.addEventListener('input', () => {
  searchQuery = modelSearch.value.toLowerCase().trim();
  renderModal();
});

// Provider input
modalProvider.addEventListener('input', () => {
  pendingProvider = modalProvider.value.trim();
});

// Select button
modalSelectBtn.addEventListener('click', async () => {
  if (!pendingModel) return;
  await api.setActiveModel(pendingModel, pendingProvider || null);
  updateModelBadge(pendingModel, pendingProvider || null);
  closeModelModal();
  showToast(`Model set: ${pendingModel}`, 'success', 2000);
  updateStatus('connected', `Active: ${pendingModel}`);
});

function updateModalSelection(modelId) {
  pendingModel = modelId;
  if (modelId) {
    modalSelModel.textContent = modelId;
    modalSelectBtn.disabled = false;
  } else {
    modalSelModel.textContent = 'No model selected';
    modalSelectBtn.disabled = true;
  }
}

// ── Model filtering logic ─────────────────────────────────────────────────────

function modelMatchesFilter(m) {
  if (currentFilter === 'all') return true;
  if (currentFilter === 'featured') return FEATURED_IDS.has(m.id);
  if (currentFilter === 'free') {
    const p = parseFloat(m.pricing?.prompt || '0');
    const c = parseFloat(m.pricing?.completion || '0');
    return p === 0 && c === 0;
  }
  if (currentFilter === 'vision') return (m.architecture?.modality || '').includes('image');
  if (currentFilter === 'code') return /code|coder|coding|starcoder|codestral/i.test(m.id + (m.name || ''));
  if (currentFilter === 'reasoning') return /think|o1|o3|r1|reason|qwq|deepseek-r/i.test(m.id + (m.name || ''));
  if (currentFilter === 'long') return (m.context_length || 0) >= 128000;
  return true;
}

function modelMatchesSearch(m) {
  if (!searchQuery) return true;
  const haystack = (m.id + ' ' + (m.name || '') + ' ' + (m.description || '')).toLowerCase();
  return searchQuery.split(' ').every((word) => haystack.includes(word));
}

// ── Model row builder ─────────────────────────────────────────────────────────

function formatPrice(str) {
  const n = parseFloat(str || '0');
  if (n === 0) return 'free';
  const per1M = n * 1_000_000;
  return per1M < 1 ? `$${per1M.toFixed(2)}` : `$${per1M.toFixed(0)}`;
}

function formatCtx(n) {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

function modelTags(m) {
  const tags = [];
  const isFree = parseFloat(m.pricing?.prompt || '0') === 0 && parseFloat(m.pricing?.completion || '0') === 0;
  if (isFree) tags.push('<span class="mtag mtag-free">free</span>');
  if ((m.architecture?.modality || '').includes('image')) tags.push('<span class="mtag mtag-vis">vision</span>');
  if (/think|o1|o3|r1|reason|qwq|deepseek-r/i.test(m.id + (m.name || ''))) tags.push('<span class="mtag mtag-reason">reasoning</span>');
  if (/code|coder|coding|starcoder|codestral/i.test(m.id + (m.name || ''))) tags.push('<span class="mtag mtag-code">code</span>');
  return tags.join('');
}

function buildModelRow(m, opts = {}) {
  const isFav = favorites.includes(m.id);
  const isSelected = m.id === pendingModel;
  const org = m.id.split('/')[0] || '';
  const displayName = m.name || m.id.split('/')[1] || m.id;
  const inPrice  = formatPrice(m.pricing?.prompt);
  const outPrice = formatPrice(m.pricing?.completion);
  const ctx = formatCtx(m.context_length);
  const priceStr = inPrice === 'free' ? '' : `${inPrice} / ${outPrice}`;

  const row = document.createElement('div');
  row.className = 'model-row' + (isSelected ? ' selected' : '');
  row.dataset.id = m.id;
  row.innerHTML = `
    <button class="star-btn ${isFav ? 'starred' : ''}" data-id="${m.id}" title="${isFav ? 'Remove favorite' : 'Add favorite'}">
      ${isFav ? '&#9733;' : '&#9734;'}
    </button>
    <div class="model-row-body">
      <div class="model-row-top">
        <span class="model-row-name">${escHtml(displayName)}</span>
        <span class="model-row-tags">${modelTags(m)}</span>
      </div>
      <div class="model-row-bottom">
        <span class="model-row-org">${escHtml(org)}</span>
        ${ctx ? `<span class="model-row-ctx">${ctx}</span>` : ''}
        ${priceStr ? `<span class="model-row-price">${escHtml(priceStr)}</span>` : '<span class="model-row-price free-label">free</span>'}
      </div>
    </div>
  `;

  row.addEventListener('click', (e) => {
    if (e.target.closest('.star-btn')) return;
    document.querySelectorAll('.model-row.selected').forEach((r) => r.classList.remove('selected'));
    row.classList.add('selected');
    updateModalSelection(m.id);
  });

  row.querySelector('.star-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    favorites = await api.toggleFavorite(m.id);
    renderModal(); // re-render to move row
  });

  return row;
}

// ── Render modal lists ────────────────────────────────────────────────────────

function renderModal() {
  const filtered = allModels.filter((m) => modelMatchesFilter(m) && modelMatchesSearch(m));
  const isDefaultView = !searchQuery && currentFilter === 'all';

  // Favorites section
  if (isDefaultView && favorites.length > 0) {
    const favModels = favorites.map((id) => allModels.find((m) => m.id === id)).filter(Boolean);
    favList.innerHTML = '';
    favModels.forEach((m) => favList.appendChild(buildModelRow(m)));
    favSection.classList.remove('hidden');
  } else {
    favSection.classList.add('hidden');
  }

  // Recent section
  if (isDefaultView && recentModels.length > 0) {
    const recentItems = recentModels
      .map(({ id }) => allModels.find((m) => m.id === id))
      .filter(Boolean)
      .slice(0, 5);
    recentList.innerHTML = '';
    recentItems.forEach((m) => recentList.appendChild(buildModelRow(m)));
    recentSection.classList.remove('hidden');
  } else {
    recentSection.classList.add('hidden');
  }

  // All models list
  const favSet = new Set(favorites);
  const recentSet = new Set(recentModels.map((r) => r.id));
  const mainModels = isDefaultView
    ? filtered.filter((m) => !favSet.has(m.id) && !recentSet.has(m.id))
    : filtered;

  allSectionLabel.textContent = searchQuery
    ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`
    : currentFilter === 'all' ? 'All models' : `${filtered.length} models`;

  modelList.innerHTML = '';
  if (mainModels.length === 0) {
    modelList.innerHTML = '<div class="model-empty">No models match your search.</div>';
  } else {
    const frag = document.createDocumentFragment();
    mainModels.slice(0, 150).forEach((m) => frag.appendChild(buildModelRow(m)));
    modelList.appendChild(frag);
    if (mainModels.length > 150) {
      const more = document.createElement('div');
      more.className = 'model-more';
      more.textContent = `+ ${mainModels.length - 150} more — refine your search`;
      modelList.appendChild(more);
    }
  }
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ══════════════════════════════════════════════════════════════════════════════
//  STREAMING
// ══════════════════════════════════════════════════════════════════════════════

// Register stream listeners once (cleanup functions returned)
let cleanChunk, cleanDone, cleanError;

function setupStreamListeners() {
  if (cleanChunk) cleanChunk();
  if (cleanDone)  cleanDone();
  if (cleanError) cleanError();

  cleanChunk = api.onStreamChunk(({ reqId, chunk }) => {
    if (reqId === generateReqId) {
      generateFull += chunk;
      renderStreamOutput(generateOutput, generateFull, false);
    } else if (reqId === analyzeReqId) {
      analyzeFull += chunk;
      renderStreamOutput(analyzeOutput, analyzeFull, true);
    }
  });

  cleanDone = api.onStreamDone(({ reqId }) => {
    if (reqId === generateReqId) {
      finishGenerate();
      generateReqId = null;
    } else if (reqId === analyzeReqId) {
      finishAnalyze();
      analyzeReqId = null;
    }
  });

  cleanError = api.onStreamError(({ reqId, message }) => {
    if (reqId === generateReqId || reqId === analyzeReqId) {
      const isGen = reqId === generateReqId;
      showToast(`Error: ${message}`, 'error', 5000);
      updateStatus('error', message);
      if (isGen) { setGenerateStreaming(false); generateReqId = null; }
      else        { setAnalyzeStreaming(false);  analyzeReqId  = null; }
    }
  });
}

function renderStreamOutput(el, text, isMarkdown) {
  if (isMarkdown) {
    el.innerHTML = renderMarkdown(text) + '<span class="cursor"></span>';
  } else {
    el.textContent = text;
    el.appendChild(Object.assign(document.createElement('span'), { className: 'cursor' }));
  }
  el.scrollTop = el.scrollHeight;
}

function removeCursor(el) {
  const c = el.querySelector('.cursor');
  if (c) c.remove();
}

// ── Generate ─────────────────────────────────────────────────────────────────

function setGenerateStreaming(on) {
  generateBtn.disabled = on;
  stopGenerate.classList.toggle('hidden', !on);
  copyGenerated.classList.toggle('hidden', on);
  refineBtn.classList.toggle('hidden', on);
}

generateBtn.addEventListener('click', () => {
  const input = generateInput.value.trim();
  if (!input) { showToast('Describe your task first', 'error'); return; }
  if (!activeModel) { showToast('Select a model first', 'error'); openModelModal(); return; }

  generateFull = '';
  generateOutput.innerHTML = '<span class="cursor"></span>';
  generateResult.classList.remove('hidden');
  generateVars.classList.add('hidden');
  setGenerateStreaming(true);
  updateStatus('loading', 'Generating...');

  let taskInput = input;
  if (thinkingToggle.checked) {
    taskInput += '\n\nNote: This prompt will be used with a model that has extended thinking enabled. Structure it to leverage chain-of-thought reasoning with explicit thinking sections.';
  }

  generateReqId = genReqId();
  api.streamRequest(generateReqId, 'generate', taskInput);
  generateResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

stopGenerate.addEventListener('click', () => {
  api.streamAbort();
  generateReqId = null;
  setGenerateStreaming(false);
  removeCursor(generateOutput);
  updateStatus('connected', 'Stopped');
});

function finishGenerate() {
  removeCursor(generateOutput);
  setGenerateStreaming(false);
  updateStatus('connected', 'Done');
  showToast('Prompt generated!', 'success', 2000);

  // Extract variables {{VAR}}
  const vars = extractVariables(generateFull);
  if (vars.length > 0) {
    variableTags.innerHTML = vars.map((v) => `<span class="variable-tag">${escHtml(v)}</span>`).join('');
    generateVars.classList.remove('hidden');
  }
}

copyGenerated.addEventListener('click', () => {
  if (!generateFull) return;
  navigator.clipboard.writeText(generateFull).then(() => {
    copyGenerated.textContent = 'Copied!';
    setTimeout(() => { copyGenerated.textContent = 'Copy'; }, 2000);
    showToast('Copied to clipboard', 'success', 1500);
  });
});

refineBtn.addEventListener('click', () => {
  analyzeInput.value = generateFull;
  charCount.textContent = generateFull.length;
  document.querySelector('.mode-btn[data-mode="analyze"]').click();
  showToast('Moved to Analyze — click Analyze to get feedback', 'info');
});

// ── Analyze ──────────────────────────────────────────────────────────────────

function setAnalyzeStreaming(on) {
  analyzeBtn.disabled = on;
  stopAnalyze.classList.toggle('hidden', !on);
  copyAnalysis.classList.toggle('hidden', on);
}

analyzeBtn.addEventListener('click', () => {
  const input = analyzeInput.value.trim();
  if (!input) { showToast('Paste a prompt to analyze', 'error'); return; }
  if (!activeModel) { showToast('Select a model first', 'error'); openModelModal(); return; }

  analyzeFull = '';
  analyzeOutput.innerHTML = '<span class="cursor"></span>';
  analyzeResult.classList.remove('hidden');
  setAnalyzeStreaming(true);
  updateStatus('loading', 'Analyzing...');

  analyzeReqId = genReqId();
  api.streamRequest(analyzeReqId, 'analyze', input);
  analyzeResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

stopAnalyze.addEventListener('click', () => {
  api.streamAbort();
  analyzeReqId = null;
  setAnalyzeStreaming(false);
  removeCursor(analyzeOutput);
  updateStatus('connected', 'Stopped');
});

function finishAnalyze() {
  removeCursor(analyzeOutput);
  // Final markdown render without cursor
  analyzeOutput.innerHTML = renderMarkdown(analyzeFull);
  setAnalyzeStreaming(false);
  updateStatus('connected', 'Analysis complete');
  showToast('Analysis complete!', 'success', 2000);
}

copyAnalysis.addEventListener('click', () => {
  if (!analyzeFull) return;
  navigator.clipboard.writeText(analyzeFull).then(() => {
    copyAnalysis.textContent = 'Copied!';
    setTimeout(() => { copyAnalysis.textContent = 'Copy'; }, 2000);
    showToast('Copied to clipboard', 'success', 1500);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  SETTINGS TAB
// ══════════════════════════════════════════════════════════════════════════════

toggleKeyBtn.addEventListener('click', () => {
  const show = apiKeyInput.type === 'password';
  apiKeyInput.type = show ? 'text' : 'password';
  toggleKeyBtn.innerHTML = show ? '&#128274;' : '&#128065;';
});

loadApiBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) { showToast('Enter your OpenRouter API key', 'error'); return; }

  loadApiBtn.disabled = true;
  loadApiBtn.textContent = 'Connecting...';
  updateStatus('loading', 'Connecting to OpenRouter...');

  try {
    await api.saveSettings({ apiKey: key });
    await loadModels(true);
    showToast('Connected! Models loaded.', 'success');
    updateStatus('connected', 'OpenRouter connected');
    showApiStatus(`Connected — ${allModels.length} models available`, 'success');
  } catch (err) {
    showToast(`Connection failed: ${err.message}`, 'error', 5000);
    updateStatus('error', err.message);
    showApiStatus(err.message, 'error');
  } finally {
    loadApiBtn.disabled = false;
    loadApiBtn.textContent = 'Connect & Load Models';
  }
});

function showApiStatus(msg, type) {
  apiStatus.textContent = msg;
  apiStatus.className = `api-status ${type}`;
  apiStatus.classList.remove('hidden');
}

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  try {
    await api.saveSettings({
      apiKey: apiKeyInput.value.trim(),
      hotkey: hotkeyInput.dataset.accelerator || DEFAULT_HOTKEY,
    });
    saveBtn.textContent = '\u2713 Saved!';
    saveBtn.classList.add('saved');
    showToast('Settings saved!', 'success');
    setTimeout(() => {
      saveBtn.textContent = 'Save Settings';
      saveBtn.disabled = false;
      saveBtn.classList.remove('saved');
    }, 2000);
  } catch (err) {
    saveBtn.textContent = 'Failed';
    showToast(`Save failed: ${err.message}`, 'error', 5000);
    setTimeout(() => { saveBtn.textContent = 'Save Settings'; saveBtn.disabled = false; }, 2000);
  }
});

// ─── Hotkey recording ─────────────────────────────────────────────────────────

recordBtn.addEventListener('click', () => { isRecording ? stopRecording() : startRecording(); });

function startRecording() {
  isRecording = true;
  recordBtn.textContent = 'Press Keys...';
  recordBtn.classList.add('recording-active');
  hotkeyInput.value = 'Waiting...';
  hotkeyInput.classList.add('recording');
  showToast('Hold \u2303/\u2318/\u2325 then press a letter', 'info', 8000);
  api.startRecording();
  document.addEventListener('keydown', onRecordKey, true);
}

function stopRecording(accelerator) {
  isRecording = false;
  recordBtn.textContent = 'Record';
  recordBtn.classList.remove('recording-active');
  hotkeyInput.classList.remove('recording');
  document.removeEventListener('keydown', onRecordKey, true);
  const final = accelerator || hotkeyInput.dataset.accelerator || DEFAULT_HOTKEY;
  hotkeyInput.value = fmtHotkey(final);
  hotkeyInput.dataset.accelerator = final;
  api.stopRecording(final);
  if (accelerator) showToast(`Hotkey: ${fmtHotkey(accelerator)}`, 'success');
}

function onRecordKey(e) {
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  const mods = [];
  if (e.ctrlKey)  mods.push('Control');
  if (e.metaKey)  mods.push('Command');
  if (e.altKey)   mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const skip = new Set(['Control','Meta','Alt','Shift','CapsLock','Tab','Escape']);
  if (skip.has(e.key)) { if (mods.length) hotkeyInput.value = mods.map(fmtMod).join(' ') + ' + ...'; return; }
  if (!mods.length) { hotkeyInput.value = 'Need modifier + key'; return; }
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const map = { ArrowUp:'Up', ArrowDown:'Down', ArrowLeft:'Left', ArrowRight:'Right', Enter:'Return', ' ':'Space' };
  if (map[e.key]) key = map[e.key];
  if (e.code.startsWith('Key'))   key = e.code.slice(3);
  if (e.code.startsWith('Digit')) key = e.code.slice(5);
  stopRecording([...mods, key].join('+'));
}

function fmtHotkey(a) {
  return (a||'').replace(/Control/g,'\u2303').replace(/Command/g,'\u2318').replace(/Alt/g,'\u2325').replace(/Shift/g,'\u21E7').replace(/\+/g,' ');
}
function fmtMod(m) {
  return {Control:'\u2303',Command:'\u2318',Alt:'\u2325',Shift:'\u21E7'}[m]||m;
}

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function extractVariables(text) {
  const matches = text.match(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g);
  return matches ? [...new Set(matches.map((m) => m.slice(2, -2)))] : [];
}

function renderMarkdown(text) {
  // Minimal markdown: bold, code, headers, lists, paragraphs
  return escHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li class="ol">$1</li>')
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(<[^/])/, '<p>$1')
    .replace(/([^>])$/, '$1</p>');
}

// ─── Status from main process ─────────────────────────────────────────────────
api.onStatus((d) => {
  if (d.type === 'processing') updateStatus('loading', d.message);
  if (d.type === 'success')    updateStatus('connected', d.message);
  if (d.type === 'error')      updateStatus('error', d.message);
});

// ══════════════════════════════════════════════════════════════════════════════
//  CONTEXT BAR
// ══════════════════════════════════════════════════════════════════════════════

const ctxMasterBadge = $('ctxMasterBadge');
const ctxSystemBadge = $('ctxSystemBadge');
const ctxMasterName  = $('ctxMasterName');
const ctxSystemName  = $('ctxSystemName');

let activeContextRecord    = null; // full master prompt object or null
let activeSystemRecord     = null; // full system prompt object or null

function renderContextBar() {
  if (activeContextRecord) {
    ctxMasterBadge.className = 'context-badge context-badge--active';
    ctxMasterName.textContent = activeContextRecord.name || 'Master Prompt';
    // Add clear button if not already there
    let clearBtn = ctxMasterBadge.querySelector('.context-badge-clear');
    if (!clearBtn) {
      clearBtn = document.createElement('button');
      clearBtn.className = 'context-badge-clear';
      clearBtn.textContent = '✕';
      clearBtn.title = 'Clear master prompt';
      clearBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await api.setActiveContext({ contextId: null });
        activeContextRecord = null;
        renderContextBar();
        showToast('Master prompt cleared', 'info', 1500);
      });
      ctxMasterBadge.appendChild(clearBtn);
    }
  } else {
    ctxMasterBadge.className = 'context-badge context-badge--empty';
    ctxMasterName.textContent = 'No master prompt';
    const clearBtn = ctxMasterBadge.querySelector('.context-badge-clear');
    if (clearBtn) clearBtn.remove();
  }

  if (activeSystemRecord) {
    ctxSystemBadge.className = 'context-badge context-badge--active';
    ctxSystemName.textContent = activeSystemRecord.name || 'System Prompt';
    let clearBtn = ctxSystemBadge.querySelector('.context-badge-clear');
    if (!clearBtn) {
      clearBtn = document.createElement('button');
      clearBtn.className = 'context-badge-clear';
      clearBtn.textContent = '✕';
      clearBtn.title = 'Clear system prompt';
      clearBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await api.setActiveContext({ systemPromptId: null });
        activeSystemRecord = null;
        renderContextBar();
        showToast('System prompt cleared', 'info', 1500);
      });
      ctxSystemBadge.appendChild(clearBtn);
    }
  } else {
    ctxSystemBadge.className = 'context-badge context-badge--empty';
    ctxSystemName.textContent = 'No system prompt';
    const clearBtn = ctxSystemBadge.querySelector('.context-badge-clear');
    if (clearBtn) clearBtn.remove();
  }
}

// Context badge clicks → open picker
ctxMasterBadge.addEventListener('click', (e) => {
  if (e.target.classList.contains('context-badge-clear')) return;
  openCtxPicker('master');
});
ctxSystemBadge.addEventListener('click', (e) => {
  if (e.target.classList.contains('context-badge-clear')) return;
  openCtxPicker('system');
});

// ── Context Picker Modal ──────────────────────────────────────────────────────

const ctxPickerModal  = $('ctxPickerModal');
const ctxPickerTitle  = $('ctxPickerTitle');
const ctxPickerList   = $('ctxPickerList');
const ctxPickerClose  = $('ctxPickerClose');
const ctxPickerClear  = $('ctxPickerClear');
const ctxPickerSelect = $('ctxPickerSelect');

let ctxPickerMode       = 'master'; // 'master' | 'system'
let ctxPickerSelectedId = null;
let ctxPickerLabImport  = false; // true when picker is used to import into Improvement Lab

async function openCtxPicker(mode) {
  ctxPickerMode = mode;
  ctxPickerSelectedId = null;
  ctxPickerSelect.disabled = true;
  ctxPickerTitle.textContent = mode === 'master' ? 'Load Master Prompt' : 'Load System Prompt';
  ctxPickerList.innerHTML = '<div class="ps-empty">Loading...</div>';
  ctxPickerModal.classList.remove('hidden');

  try {
    const items = mode === 'master'
      ? await api.listMasterPrompts()
      : await api.listSystemPrompts();

    ctxPickerList.innerHTML = '';
    if (items.length === 0) {
      ctxPickerList.innerHTML = '<div class="ps-empty">None saved yet.</div>';
      return;
    }
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'ctx-picker-item';
      el.dataset.id = item.id;
      const updated = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '';
      el.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div class="ctx-picker-item-name">${escHtml(item.name)}</div>
          <div class="ctx-picker-item-meta">${escHtml(item.role || item.category || '')}${updated ? ' · ' + updated : ''}</div>
        </div>`;
      el.addEventListener('click', () => {
        document.querySelectorAll('.ctx-picker-item').forEach(r => r.classList.remove('selected'));
        el.classList.add('selected');
        ctxPickerSelectedId = item.id;
        ctxPickerSelect.disabled = false;
      });
      ctxPickerList.appendChild(el);
    });
  } catch (err) {
    ctxPickerList.innerHTML = `<div class="ps-empty" style="color:var(--error)">${escHtml(err.message)}</div>`;
  }
}

ctxPickerClose.addEventListener('click', () => { ctxPickerLabImport = false; ctxPickerModal.classList.add('hidden'); });
ctxPickerModal.addEventListener('click', (e) => { if (e.target === ctxPickerModal) { ctxPickerLabImport = false; ctxPickerModal.classList.add('hidden'); } });

ctxPickerClear.addEventListener('click', async () => {
  if (ctxPickerMode === 'master') {
    await api.setActiveContext({ contextId: null });
    activeContextRecord = null;
  } else {
    await api.setActiveContext({ systemPromptId: null });
    activeSystemRecord = null;
  }
  renderContextBar();
  ctxPickerModal.classList.add('hidden');
  showToast('Context cleared', 'info', 1500);
});

ctxPickerSelect.addEventListener('click', async () => {
  if (!ctxPickerSelectedId) return;
  if (ctxPickerLabImport) return; // handled by lab import listener
  if (ctxPickerMode === 'master') {
    const items = await api.listMasterPrompts();
    activeContextRecord = items.find(i => i.id === ctxPickerSelectedId) || null;
    await api.setActiveContext({ contextId: ctxPickerSelectedId });
    showToast(`Master prompt loaded: ${activeContextRecord?.name || ''}`, 'success', 2000);
  } else {
    const items = await api.listSystemPrompts();
    activeSystemRecord = items.find(i => i.id === ctxPickerSelectedId) || null;
    await api.setActiveContext({ systemPromptId: ctxPickerSelectedId });
    showToast(`System prompt loaded: ${activeSystemRecord?.name || ''}`, 'success', 2000);
  }
  renderContextBar();
  ctxPickerModal.classList.add('hidden');
});

// ══════════════════════════════════════════════════════════════════════════════
//  PROMPTS & SYSTEMS TAB — SUB-NAV
// ══════════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.ps-subnav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ps-subnav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.ps-tab-content').forEach(c => c.classList.remove('active'));
    $(`pstab-${btn.dataset.pstab}`).classList.add('active');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  MASTER PROMPT LIBRARY
// ══════════════════════════════════════════════════════════════════════════════

async function loadMasterPromptLibrary() {
  const list = $('masterPromptList');
  list.innerHTML = '<div class="ps-empty">Loading...</div>';
  try {
    const items = await api.listMasterPrompts();
    renderMasterPromptLibrary(items);
  } catch (err) {
    list.innerHTML = `<div class="ps-empty" style="color:var(--error)">${escHtml(err.message)}</div>`;
  }
}

function renderMasterPromptLibrary(items) {
  const list = $('masterPromptList');
  if (items.length === 0) {
    list.innerHTML = '<div class="ps-empty">No master prompts yet. Create one to get started.</div>';
    return;
  }
  list.innerHTML = '';
  items.forEach(item => {
    const isActive = activeContextRecord?.id === item.id;
    const updated = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '';
    const card = document.createElement('div');
    card.className = 'ps-card' + (isActive ? ' ps-card--active' : '');
    card.innerHTML = `
      <div class="ps-card-body">
        <div class="ps-card-name">${escHtml(item.name)}</div>
        <div class="ps-card-meta">
          <span>${escHtml(item.role || 'No role set')}</span>
          ${updated ? `<span>Updated ${updated}</span>` : ''}
        </div>
      </div>
      <div class="ps-card-actions">
        <button class="ps-card-btn load-btn" data-id="${item.id}">${isActive ? '✓ Loaded' : 'Load'}</button>
        <button class="ps-card-btn edit-btn" data-id="${item.id}">Edit</button>
        <button class="ps-card-btn export-btn" data-id="${item.id}">Export</button>
        <button class="ps-card-btn del-btn" data-id="${item.id}">Delete</button>
      </div>`;

    card.querySelector('.load-btn').addEventListener('click', async () => {
      if (isActive) {
        await api.setActiveContext({ contextId: null });
        activeContextRecord = null;
      } else {
        await api.setActiveContext({ contextId: item.id });
        activeContextRecord = item;
      }
      renderContextBar();
      loadMasterPromptLibrary();
      showToast(isActive ? 'Master prompt unloaded' : `Loaded: ${item.name}`, 'success', 2000);
    });

    card.querySelector('.edit-btn').addEventListener('click', () => openMasterWizard(item));

    card.querySelector('.export-btn').addEventListener('click', async () => {
      try {
        const content = `---\nname: ${item.name}\nrole: ${item.role || ''}\nupdated: ${new Date(item.updatedAt).toISOString()}\n---\n\n${item.fullDocument || ''}`;
        const result = await api.exportDocument({ name: item.name, content, format: 'md' });
        showToast(`Exported to ${result.filePath}`, 'success', 4000);
      } catch (err) {
        showToast(`Export failed: ${err.message}`, 'error', 4000);
      }
    });

    card.querySelector('.del-btn').addEventListener('click', () => {
      openConfirm(`Delete "${item.name}"? This cannot be undone.`, async () => {
        await api.deleteMasterPrompt(item.id);
        if (activeContextRecord?.id === item.id) {
          activeContextRecord = null;
          renderContextBar();
        }
        loadMasterPromptLibrary();
        showToast('Deleted', 'info', 1500);
      });
    });

    list.appendChild(card);
  });
}

$('newMasterBtn').addEventListener('click', () => openMasterWizard(null));

// ══════════════════════════════════════════════════════════════════════════════
//  MASTER PROMPT WIZARD
// ══════════════════════════════════════════════════════════════════════════════

const masterWizardModal  = $('masterWizardModal');
const masterWizardClose  = $('masterWizardClose');
const masterChat         = $('masterChat');
const masterAnswerInput  = $('masterAnswerInput');
const masterSendBtn      = $('masterSendBtn');
const masterSkipBtn      = $('masterSkipBtn');
const masterInputRow     = $('masterInputRow');
const masterStep0Actions = $('masterStep0Actions');
const masterStartBtn     = $('masterStartInterviewBtn');
const masterGenFromInterviewBtn = $('masterGenerateFromInterviewBtn');
const masterPreviewEdit  = $('masterPreviewEdit');
const masterRegenerateBtn = $('masterRegenerateBtn');
const masterNameInput    = $('masterNameInput');
const masterRoleSaveInput = $('masterRoleSaveInput');
const masterSaveBtn      = $('masterSaveBtn');
const masterExportMdBtn  = $('masterExportMdBtn');

let masterWizardStep     = 0;
let masterConversation   = []; // [{role, content}]
let masterEditingId      = null;
let masterInterviewDone  = false;
let masterWizardReqId    = null;

function setMasterWizardStep(step) {
  masterWizardStep = step;
  document.querySelectorAll('#masterWizardModal .wizard-step-content').forEach((el, i) => {
    el.classList.toggle('active', i === step);
  });
  document.querySelectorAll('#masterWizardModal .wizard-step').forEach((el) => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle('active', s === step);
    el.classList.toggle('done', s < step);
  });
}

function openMasterWizard(existing) {
  masterEditingId = existing?.id || null;
  masterConversation = [];
  masterInterviewDone = false;
  masterWizardReqId = null;
  masterChat.innerHTML = '';
  masterAnswerInput.value = '';
  masterInputRow.style.display = 'none';
  masterGenFromInterviewBtn.classList.add('hidden');
  masterPreviewEdit.value = existing?.fullDocument || '';
  masterNameInput.value = existing?.name || '';
  masterRoleSaveInput.value = existing?.role || '';
  $('masterRoleInput').value = existing?.role || '';
  setMasterWizardStep(existing ? 2 : 0);
  masterWizardModal.classList.remove('hidden');
}

masterWizardClose.addEventListener('click', () => {
  masterWizardModal.classList.add('hidden');
  if (masterWizardReqId) { api.streamAbort(); masterWizardReqId = null; }
});
masterWizardModal.addEventListener('click', (e) => {
  if (e.target === masterWizardModal) {
    masterWizardModal.classList.add('hidden');
    if (masterWizardReqId) { api.streamAbort(); masterWizardReqId = null; }
  }
});

masterStartBtn.addEventListener('click', () => {
  const role = $('masterRoleInput').value.trim() || 'professional';
  masterConversation = [];
  masterChat.innerHTML = '';
  masterInputRow.style.display = 'none';
  masterStartBtn.disabled = true;
  masterStartBtn.textContent = 'Interviewing...';

  masterWizardReqId = genReqId();
  api.streamRequest(masterWizardReqId, 'master-prompt-interview', { role });
});

function appendChatBubble(role, text) {
  const div = document.createElement('div');
  div.className = `chat-bubble ${role === 'assistant' ? 'ai' : 'user'}`;
  const label = document.createElement('div');
  label.className = 'chat-label';
  label.textContent = role === 'assistant' ? 'AI' : 'You';
  div.appendChild(label);
  const body = document.createElement('div');
  body.textContent = text;
  div.appendChild(body);
  masterChat.appendChild(div);
  masterChat.scrollTop = masterChat.scrollHeight;
  return body;
}

function appendSystemChatBubble(chat, role, text) {
  const div = document.createElement('div');
  div.className = `chat-bubble ${role === 'assistant' ? 'ai' : 'user'}`;
  const label = document.createElement('div');
  label.className = 'chat-label';
  label.textContent = role === 'assistant' ? 'AI' : 'You';
  div.appendChild(label);
  const body = document.createElement('div');
  body.textContent = text;
  div.appendChild(body);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return body;
}

// Streaming for master wizard
let masterStreamBuffer = '';
let masterStreamBubbleBody = null;

function onMasterChunk(chunk) {
  masterStreamBuffer += chunk;
  if (masterStreamBubbleBody) {
    masterStreamBubbleBody.textContent = masterStreamBuffer;
    masterChat.scrollTop = masterChat.scrollHeight;
  }
}

function onMasterDone() {
  if (masterStreamBuffer) {
    masterConversation.push({ role: 'assistant', content: masterStreamBuffer });
    if (!masterStreamBubbleBody) appendChatBubble('assistant', masterStreamBuffer);
  }
  masterStreamBuffer = '';
  masterStreamBubbleBody = null;
  masterWizardReqId = null;

  masterStartBtn.disabled = false;
  masterStartBtn.textContent = 'Start Interview';
  masterInputRow.style.display = 'flex';
  masterInterviewDone = false; // allow more questions

  if (!masterGenFromInterviewBtn.classList.contains('hidden') || masterConversation.length >= 3) {
    masterGenFromInterviewBtn.classList.remove('hidden');
  }
  masterAnswerInput.focus();
}

masterSendBtn.addEventListener('click', sendMasterAnswer);
masterAnswerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMasterAnswer(); }
});
masterSkipBtn.addEventListener('click', sendMasterAnswer); // send empty = skip

function sendMasterAnswer() {
  const answer = masterAnswerInput.value.trim();
  if (answer) {
    appendChatBubble('user', answer);
    masterConversation.push({ role: 'user', content: answer });
  }
  masterAnswerInput.value = '';

  // Build updated conversation and continue
  const messages = masterConversation.slice();
  masterStreamBuffer = '';
  masterStreamBubbleBody = appendChatBubble('assistant', '');
  masterSendBtn.disabled = true;

  masterWizardReqId = genReqId();
  api.streamRequest(masterWizardReqId, 'master-prompt-continue', messages);

  setTimeout(() => {
    masterSendBtn.disabled = false;
    masterGenFromInterviewBtn.classList.remove('hidden');
  }, 500);
}

masterGenFromInterviewBtn.addEventListener('click', () => {
  if (masterConversation.length < 2) {
    showToast('Have at least one exchange before generating', 'error');
    return;
  }
  // Build transcript
  const transcript = masterConversation
    .map(m => `${m.role === 'assistant' ? 'AI' : 'User'}: ${m.content}`)
    .join('\n\n');

  setMasterWizardStep(1);
  masterPreviewEdit.value = '';
  masterStreamBuffer = '';
  masterWizardReqId = genReqId();
  api.streamRequest(masterWizardReqId, 'master-prompt-generate', { transcript });
});

masterRegenerateBtn.addEventListener('click', () => {
  if (masterConversation.length < 2) {
    showToast('Go back and complete the interview first', 'error');
    return;
  }
  const transcript = masterConversation
    .map(m => `${m.role === 'assistant' ? 'AI' : 'User'}: ${m.content}`)
    .join('\n\n');
  masterPreviewEdit.value = '';
  masterStreamBuffer = '';
  masterWizardReqId = genReqId();
  api.streamRequest(masterWizardReqId, 'master-prompt-generate', { transcript });
});

// Streaming into preview
function onMasterPreviewChunk(chunk) {
  masterStreamBuffer += chunk;
  masterPreviewEdit.value = masterStreamBuffer;
}

function onMasterPreviewDone() {
  masterStreamBuffer = '';
  masterWizardReqId = null;
  if (masterWizardStep === 1) {
    // Auto-advance to save step when we have content
  }
}

// Save step
document.querySelectorAll('#mwStep1 .btn-primary, #masterWizardModal .wizard-step-content:nth-child(2) button').forEach(() => {});

// "Next: Save" button on review step — we use a separate approach: clicking Regenerate stays on step 1,
// user advances by clicking "Next →" which we add programmatically via the review step footer
// Actually let's add a "Next →" button directly in the review step footer area
// We handle this by listening to step navigation in the streaming done handler.
// Instead, expose a "Next →" via the footer of the review step:

masterPreviewEdit.addEventListener('input', () => {
  // When user edits preview, show step-2 nav
});

// Advance from review → save
const mwReviewNext = document.createElement('button');
mwReviewNext.className = 'btn btn-primary';
mwReviewNext.textContent = 'Next: Save →';
mwReviewNext.addEventListener('click', () => {
  if (!masterPreviewEdit.value.trim()) { showToast('Generate a master prompt first', 'error'); return; }
  setMasterWizardStep(2);
  // Pre-fill name from role input
  if (!masterNameInput.value) masterNameInput.value = $('masterRoleInput').value || '';
  if (!masterRoleSaveInput.value) masterRoleSaveInput.value = $('masterRoleInput').value || '';
});
$('mwStep1').querySelector('.wizard-preview-header').appendChild(mwReviewNext);

masterSaveBtn.addEventListener('click', async () => {
  const name = masterNameInput.value.trim();
  if (!name) { showToast('Enter a name for this master prompt', 'error'); return; }
  masterSaveBtn.disabled = true;
  masterSaveBtn.textContent = 'Saving...';
  try {
    const record = await api.saveMasterPrompt({
      id: masterEditingId || undefined,
      name,
      role: masterRoleSaveInput.value.trim(),
      fullDocument: masterPreviewEdit.value,
    });
    masterWizardModal.classList.add('hidden');
    loadMasterPromptLibrary();
    showToast(`Saved: ${record.name}`, 'success', 2000);
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error', 4000);
  } finally {
    masterSaveBtn.disabled = false;
    masterSaveBtn.textContent = 'Save Master Prompt';
  }
});

masterExportMdBtn.addEventListener('click', async () => {
  const content = masterPreviewEdit.value;
  if (!content) { showToast('Nothing to export yet', 'error'); return; }
  try {
    const name = masterNameInput.value || 'master-prompt';
    const result = await api.exportDocument({ name, content, format: 'md' });
    showToast(`Exported to ${result.filePath}`, 'success', 4000);
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error', 4000);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  SYSTEM PROMPT LIBRARY
// ══════════════════════════════════════════════════════════════════════════════

async function loadSystemPromptLibrary() {
  const list = $('systemPromptList');
  list.innerHTML = '<div class="ps-empty">Loading...</div>';
  try {
    const items = await api.listSystemPrompts();
    renderSystemPromptLibrary(items);
  } catch (err) {
    list.innerHTML = `<div class="ps-empty" style="color:var(--error)">${escHtml(err.message)}</div>`;
  }
}

function renderSystemPromptLibrary(items) {
  const list = $('systemPromptList');
  if (items.length === 0) {
    list.innerHTML = '<div class="ps-empty">No system prompts yet. Create one from any Workshop result.</div>';
    return;
  }
  list.innerHTML = '';
  items.forEach(item => {
    const isActive = activeSystemRecord?.id === item.id;
    const updated = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '';
    const card = document.createElement('div');
    card.className = 'ps-card' + (isActive ? ' ps-card--active' : '');
    card.innerHTML = `
      <div class="ps-card-body">
        <div class="ps-card-name">${escHtml(item.name)}</div>
        <div class="ps-card-meta">
          ${item.category ? `<span class="ps-card-tag">${escHtml(item.category)}</span>` : ''}
          ${updated ? `<span>Updated ${updated}</span>` : ''}
        </div>
      </div>
      <div class="ps-card-actions">
        <button class="ps-card-btn load-btn" data-id="${item.id}">${isActive ? '✓ Loaded' : 'Load'}</button>
        <button class="ps-card-btn edit-btn" data-id="${item.id}">Edit</button>
        <button class="ps-card-btn export-btn" data-id="${item.id}">Export</button>
        <button class="ps-card-btn del-btn" data-id="${item.id}">Delete</button>
      </div>`;

    card.querySelector('.load-btn').addEventListener('click', async () => {
      if (isActive) {
        await api.setActiveContext({ systemPromptId: null });
        activeSystemRecord = null;
      } else {
        await api.setActiveContext({ systemPromptId: item.id });
        activeSystemRecord = item;
      }
      renderContextBar();
      loadSystemPromptLibrary();
      showToast(isActive ? 'System prompt unloaded' : `Loaded: ${item.name}`, 'success', 2000);
    });

    card.querySelector('.edit-btn').addEventListener('click', () => openSystemWizard(null, item));

    card.querySelector('.export-btn').addEventListener('click', async () => {
      try {
        const content = `---\nname: ${item.name}\ncategory: ${item.category || ''}\nupdated: ${new Date(item.updatedAt).toISOString()}\n---\n\n${item.content || ''}`;
        const result = await api.exportDocument({ name: item.name, content, format: 'md' });
        showToast(`Exported to ${result.filePath}`, 'success', 4000);
      } catch (err) {
        showToast(`Export failed: ${err.message}`, 'error', 4000);
      }
    });

    card.querySelector('.del-btn').addEventListener('click', () => {
      openConfirm(`Delete "${item.name}"? This cannot be undone.`, async () => {
        await api.deleteSystemPrompt(item.id);
        if (activeSystemRecord?.id === item.id) {
          activeSystemRecord = null;
          renderContextBar();
        }
        loadSystemPromptLibrary();
        showToast('Deleted', 'info', 1500);
      });
    });

    list.appendChild(card);
  });
}

$('newSystemBtn').addEventListener('click', () => openSystemWizard(null, null));

// "Create System Prompt" button on Workshop generate result
$('createSysPrompt').addEventListener('click', () => {
  const sourceOutput = generateFull;
  if (!sourceOutput) { showToast('Generate something first', 'error'); return; }
  document.querySelector('.tab[data-tab="prompts"]').click();
  document.querySelector('.ps-subnav-btn[data-pstab="system"]').click();
  openSystemWizard(sourceOutput, null);
});

// ══════════════════════════════════════════════════════════════════════════════
//  SYSTEM PROMPT WIZARD
// ══════════════════════════════════════════════════════════════════════════════

const systemWizardModal   = $('systemWizardModal');
const systemWizardClose   = $('systemWizardClose');
const sysSourceInput      = $('sysSourceInput');
const sysStartInterviewBtn = $('sysStartInterviewBtn');
const systemChat          = $('systemChat');
const sysAnswerInput      = $('sysAnswerInput');
const sysSendBtn          = $('sysSendBtn');
const sysSkipBtn          = $('sysSkipBtn');
const sysGenerateBtn      = $('sysGenerateBtn');
const sysPreviewEdit      = $('sysPreviewEdit');
const sysRegenerateBtn    = $('sysRegenerateBtn');
const sysNameInput        = $('sysNameInput');
const sysCategoryInput    = $('sysCategoryInput');
const sysSaveBtn          = $('sysSaveBtn');
const sysExportMdBtn      = $('sysExportMdBtn');

let sysWizardStep         = 0;
let sysConversation       = [];
let sysEditingId          = null;
let sysWizardReqId        = null;
let sysStreamBuffer       = '';
let sysStreamBubbleBody   = null;

function setSystemWizardStep(step) {
  sysWizardStep = step;
  document.querySelectorAll('#systemWizardModal .wizard-step-content').forEach((el, i) => {
    el.classList.toggle('active', i === step);
  });
  document.querySelectorAll('#systemWizardModal .wizard-step').forEach((el) => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle('active', s === step);
    el.classList.toggle('done', s < step);
  });
}

function openSystemWizard(sourceOutput, existing) {
  sysEditingId = existing?.id || null;
  sysConversation = [];
  sysWizardReqId = null;
  sysStreamBuffer = '';
  sysStreamBubbleBody = null;
  systemChat.innerHTML = '';
  sysAnswerInput.value = '';
  sysGenerateBtn.classList.add('hidden');
  sysPreviewEdit.value = existing?.content || '';
  sysSourceInput.value = sourceOutput || '';
  sysNameInput.value = existing?.name || '';
  sysCategoryInput.value = existing?.category || 'general';
  setSystemWizardStep(existing ? 2 : 0);
  systemWizardModal.classList.remove('hidden');
}

systemWizardClose.addEventListener('click', () => {
  systemWizardModal.classList.add('hidden');
  if (sysWizardReqId) { api.streamAbort(); sysWizardReqId = null; }
});
systemWizardModal.addEventListener('click', (e) => {
  if (e.target === systemWizardModal) {
    systemWizardModal.classList.add('hidden');
    if (sysWizardReqId) { api.streamAbort(); sysWizardReqId = null; }
  }
});

sysStartInterviewBtn.addEventListener('click', () => {
  const source = sysSourceInput.value.trim();
  if (!source) { showToast('Paste a source output first', 'error'); return; }
  setSystemWizardStep(1);
  sysConversation = [];
  sysStreamBuffer = '';
  sysStreamBubbleBody = appendSystemChatBubble(systemChat, 'assistant', '');

  sysWizardReqId = genReqId();
  api.streamRequest(sysWizardReqId, 'system-prompt-interview', { sourceOutput: source });
});

sysSendBtn.addEventListener('click', sendSysAnswer);
sysAnswerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSysAnswer(); }
});
sysSkipBtn.addEventListener('click', sendSysAnswer);

function sendSysAnswer() {
  const answer = sysAnswerInput.value.trim();
  if (answer) {
    appendSystemChatBubble(systemChat, 'user', answer);
    sysConversation.push({ role: 'user', content: answer });
  }
  sysAnswerInput.value = '';
  sysStreamBuffer = '';
  sysStreamBubbleBody = appendSystemChatBubble(systemChat, 'assistant', '');
  sysSendBtn.disabled = true;

  sysWizardReqId = genReqId();
  api.streamRequest(sysWizardReqId, 'system-prompt-continue', sysConversation.slice());
  setTimeout(() => { sysSendBtn.disabled = false; sysGenerateBtn.classList.remove('hidden'); }, 500);
}

sysGenerateBtn.addEventListener('click', () => {
  const transcript = sysConversation.map(m => `${m.role === 'assistant' ? 'AI' : 'User'}: ${m.content}`).join('\n\n');
  const source = sysSourceInput.value.trim();
  const fullTranscript = `Source output:\n${source}\n\nInterview:\n${transcript}`;
  setSystemWizardStep(2);
  sysPreviewEdit.value = '';
  sysStreamBuffer = '';
  sysWizardReqId = genReqId();
  api.streamRequest(sysWizardReqId, 'system-prompt-generate', { transcript: fullTranscript });
});

sysRegenerateBtn.addEventListener('click', () => {
  const transcript = sysConversation.map(m => `${m.role === 'assistant' ? 'AI' : 'User'}: ${m.content}`).join('\n\n');
  const source = sysSourceInput.value.trim();
  const fullTranscript = `Source output:\n${source}\n\nInterview:\n${transcript}`;
  sysPreviewEdit.value = '';
  sysStreamBuffer = '';
  sysWizardReqId = genReqId();
  api.streamRequest(sysWizardReqId, 'system-prompt-generate', { transcript: fullTranscript });
});

// "Next: Save" for system prompt review step
const swReviewNext = document.createElement('button');
swReviewNext.className = 'btn btn-primary';
swReviewNext.textContent = 'Next: Save →';
swReviewNext.addEventListener('click', () => {
  if (!sysPreviewEdit.value.trim()) { showToast('Generate a system prompt first', 'error'); return; }
  setSystemWizardStep(3);
});
$('swStep2').querySelector('.wizard-preview-header').appendChild(swReviewNext);

sysSaveBtn.addEventListener('click', async () => {
  const name = sysNameInput.value.trim();
  if (!name) { showToast('Enter a name for this system prompt', 'error'); return; }
  sysSaveBtn.disabled = true;
  sysSaveBtn.textContent = 'Saving...';
  try {
    const record = await api.saveSystemPrompt({
      id: sysEditingId || undefined,
      name,
      category: sysCategoryInput.value,
      content: sysPreviewEdit.value,
    });
    systemWizardModal.classList.add('hidden');
    loadSystemPromptLibrary();
    showToast(`Saved: ${record.name}`, 'success', 2000);
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error', 4000);
  } finally {
    sysSaveBtn.disabled = false;
    sysSaveBtn.textContent = 'Save System Prompt';
  }
});

sysExportMdBtn.addEventListener('click', async () => {
  const content = sysPreviewEdit.value;
  if (!content) { showToast('Nothing to export yet', 'error'); return; }
  try {
    const result = await api.exportDocument({ name: sysNameInput.value || 'system-prompt', content, format: 'md' });
    showToast(`Exported to ${result.filePath}`, 'success', 4000);
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error', 4000);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PROJECTS
// ══════════════════════════════════════════════════════════════════════════════

async function loadProjectLibrary() {
  const list = $('projectList');
  list.innerHTML = '<div class="ps-empty">Loading...</div>';
  try {
    const items = await api.listProjects();
    renderProjectLibrary(items);
  } catch (err) {
    list.innerHTML = `<div class="ps-empty" style="color:var(--error)">${escHtml(err.message)}</div>`;
  }
}

function renderProjectLibrary(items) {
  const list = $('projectList');
  if (items.length === 0) {
    list.innerHTML = '<div class="ps-empty">No projects yet.</div>';
    return;
  }
  list.innerHTML = '';
  items.forEach(item => {
    const activity = item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleDateString() : '';
    const card = document.createElement('div');
    card.className = 'ps-project-card';
    card.innerHTML = `
      <div class="ps-project-title">${escHtml(item.name)}</div>
      ${item.description ? `<div class="ps-project-desc">${escHtml(item.description)}</div>` : ''}
      <div class="ps-project-footer">
        <span class="ps-project-stats">Last activity: ${activity || 'never'}</span>
        <div class="ps-project-actions">
          <button class="ps-card-btn del-btn" data-id="${item.id}">Delete</button>
        </div>
      </div>`;

    card.querySelector('.del-btn').addEventListener('click', () => {
      openConfirm(`Delete project "${item.name}"? This cannot be undone.`, async () => {
        await api.deleteProject(item.id);
        loadProjectLibrary();
        showToast('Project deleted', 'info', 1500);
      });
    });
    list.appendChild(card);
  });
}

const projectModal       = $('projectModal');
const projectModalClose  = $('projectModalClose');
const projectNameInput   = $('projectNameInput');
const projectDescInput   = $('projectDescInput');
const projectMasterSelect = $('projectMasterSelect');
const projectSaveBtn     = $('projectSaveBtn');

$('newProjectBtn').addEventListener('click', async () => {
  projectNameInput.value = '';
  projectDescInput.value = '';
  // populate master prompt options
  const masters = await api.listMasterPrompts();
  projectMasterSelect.innerHTML = '<option value="">— None —</option>';
  masters.forEach(m => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.name;
    projectMasterSelect.appendChild(o);
  });
  projectModal.classList.remove('hidden');
});

projectModalClose.addEventListener('click', () => projectModal.classList.add('hidden'));
projectModal.addEventListener('click', (e) => { if (e.target === projectModal) projectModal.classList.add('hidden'); });

projectSaveBtn.addEventListener('click', async () => {
  const name = projectNameInput.value.trim();
  if (!name) { showToast('Enter a project name', 'error'); return; }
  projectSaveBtn.disabled = true;
  try {
    await api.saveProject({
      name,
      description: projectDescInput.value.trim(),
      masterPromptId: projectMasterSelect.value || null,
      systemPromptIds: [],
      fileRefs: [],
    });
    projectModal.classList.add('hidden');
    loadProjectLibrary();
    showToast(`Project created: ${name}`, 'success', 2000);
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error', 4000);
  } finally {
    projectSaveBtn.disabled = false;
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  CONFIRM MODAL
// ══════════════════════════════════════════════════════════════════════════════

const confirmModal       = $('confirmModal');
const confirmModalClose  = $('confirmModalClose');
const confirmModalCancel = $('confirmModalCancel');
const confirmModalOk     = $('confirmModalOk');
const confirmModalMsg    = $('confirmModalMsg');
let confirmCallback      = null;

function openConfirm(message, onOk) {
  confirmModalMsg.textContent = message;
  confirmCallback = onOk;
  confirmModal.classList.remove('hidden');
}

confirmModalClose.addEventListener('click', () => confirmModal.classList.add('hidden'));
confirmModalCancel.addEventListener('click', () => confirmModal.classList.add('hidden'));
confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) confirmModal.classList.add('hidden'); });
confirmModalOk.addEventListener('click', async () => {
  confirmModal.classList.add('hidden');
  if (confirmCallback) { await confirmCallback(); confirmCallback = null; }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PULL PROMPTING MODE
// ══════════════════════════════════════════════════════════════════════════════

const pullToggle = $('pullToggle');
let pullModeActive = false;
let pullConversation = [];
let pullReqId = null;
let pullPhase = 'interview'; // 'interview' | 'generating'
const PULL_READY_SIGNAL = 'I have what I need — generating now.';

pullToggle.addEventListener('change', () => {
  pullModeActive = pullToggle.checked;
  const card = generateInput.closest('.workshop-card');
  if (card) card.classList.toggle('pull-mode-active', pullModeActive);
  if (pullModeActive) {
    generateBtn.textContent = 'Start Interview';
    showToast('Pull mode: AI will interview you before generating', 'info', 3000);
  } else {
    generateBtn.textContent = 'Generate';
    pullConversation = [];
    pullPhase = 'interview';
  }
});

// We override the generate button click when pull mode is active.
// The original listener calls api.streamRequest('generate').
// We intercept by checking pullModeActive at the top of that listener.
// This is handled inside the existing generateBtn click listener by prepending a check.
// We patch it by wrapping: see below.

const _origGenerateBtnHandler = generateBtn.onclick;

// We re-attach the generate button listener to handle pull mode:
generateBtn.addEventListener('click', (e) => {
  if (!pullModeActive) return; // let original handler run
  e.stopImmediatePropagation();

  const input = generateInput.value.trim();
  if (!input) { showToast('Describe your task first', 'error'); return; }
  if (!activeModel) { showToast('Select a model first', 'error'); openModelModal(); return; }

  if (pullPhase === 'interview' && pullConversation.length === 0) {
    // Start interview
    pullConversation = [];
    generateFull = '';
    generateOutput.innerHTML = '<span class="cursor"></span>';
    generateResult.classList.remove('hidden');
    setGenerateStreaming(true);
    updateStatus('loading', 'Pull interview...');

    const preamble = `${input}\n\n---\n${PULL_INTERVIEW_PREAMBLE}`;
    pullConversation.push({ role: 'user', content: preamble });
    pullReqId = genReqId();
    generateReqId = pullReqId;
    api.streamRequest(pullReqId, 'pull-interview', pullConversation.slice());
    generateBtn.textContent = 'Send Answer';
    pullPhase = 'interview';
  } else if (pullPhase === 'interview') {
    // Send user's answer
    const answer = generateInput.value.trim();
    if (!answer) { showToast('Type your answer first', 'error'); return; }
    pullConversation.push({ role: 'user', content: answer });
    generateInput.value = '';

    generateFull = '';
    generateOutput.innerHTML = '<span class="cursor"></span>';
    setGenerateStreaming(true);
    updateStatus('loading', 'Thinking...');

    pullReqId = genReqId();
    generateReqId = pullReqId;
    api.streamRequest(pullReqId, 'pull-interview', pullConversation.slice());
  }
}, true); // capture phase so it runs before existing listener

// After stream done in pull mode, check if AI said ready
const _origFinishGenerate = window.finishGenerate;
function checkPullDone(output) {
  if (!pullModeActive) return;
  if (output.includes(PULL_READY_SIGNAL) || output.toLowerCase().includes('generating now')) {
    pullPhase = 'generating';
    generateBtn.textContent = 'Generating...';
    generateBtn.disabled = true;
    // The AI said it's generating — the rest of its output IS the result
    // Reset for next use
    setTimeout(() => {
      pullConversation = [];
      pullPhase = 'interview';
      generateBtn.textContent = 'Start Interview';
      generateBtn.disabled = false;
    }, 1000);
  } else {
    // Still interviewing — add AI response to conversation
    pullConversation.push({ role: 'assistant', content: output });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  EXTENDED STREAM ROUTING (master + system prompt wizard streams)
// ══════════════════════════════════════════════════════════════════════════════

// We extend setupStreamListeners to also route to wizard handlers.
// We re-run setup after init to pick up the new routing.
const _origSetupStreamListeners = setupStreamListeners;
function setupStreamListeners() {
  if (cleanChunk) cleanChunk();
  if (cleanDone)  cleanDone();
  if (cleanError) cleanError();

  cleanChunk = api.onStreamChunk(({ reqId, chunk }) => {
    if (reqId === generateReqId) {
      generateFull += chunk;
      renderStreamOutput(generateOutput, generateFull, false);
      if (pullModeActive) checkPullDone(generateFull);
    } else if (reqId === analyzeReqId) {
      analyzeFull += chunk;
      renderStreamOutput(analyzeOutput, analyzeFull, true);

    // Master prompt wizard routing
    } else if (reqId === masterWizardReqId) {
      if (masterWizardStep === 0) {
        masterStreamBuffer += chunk;
        if (masterStreamBubbleBody) {
          masterStreamBubbleBody.textContent = masterStreamBuffer;
          masterChat.scrollTop = masterChat.scrollHeight;
        }
      } else if (masterWizardStep === 1) {
        masterStreamBuffer += chunk;
        masterPreviewEdit.value = masterStreamBuffer;
      }

    // System prompt wizard routing
    } else if (reqId === sysWizardReqId) {
      if (sysWizardStep === 1) {
        sysStreamBuffer += chunk;
        if (sysStreamBubbleBody) {
          sysStreamBubbleBody.textContent = sysStreamBuffer;
          systemChat.scrollTop = systemChat.scrollHeight;
        }
      } else if (sysWizardStep === 2) {
        sysStreamBuffer += chunk;
        sysPreviewEdit.value = sysStreamBuffer;
      }
    }
  });

  cleanDone = api.onStreamDone(({ reqId }) => {
    if (reqId === generateReqId) {
      finishGenerate();
      generateReqId = null;
    } else if (reqId === analyzeReqId) {
      finishAnalyze();
      analyzeReqId = null;

    // Master wizard done
    } else if (reqId === masterWizardReqId) {
      if (masterWizardStep === 0) {
        onMasterDone();
      } else if (masterWizardStep === 1) {
        masterStreamBuffer = '';
        masterWizardReqId = null;
      }

    // System wizard done
    } else if (reqId === sysWizardReqId) {
      if (sysWizardStep === 1) {
        if (sysStreamBuffer) {
          sysConversation.push({ role: 'assistant', content: sysStreamBuffer });
          if (!sysStreamBubbleBody) appendSystemChatBubble(systemChat, 'assistant', sysStreamBuffer);
          else sysStreamBubbleBody.textContent = sysStreamBuffer;
        }
        sysStreamBuffer = '';
        sysStreamBubbleBody = null;
        sysWizardReqId = null;
        sysSendBtn.disabled = false;
        sysGenerateBtn.classList.remove('hidden');
        sysAnswerInput.focus();
      } else if (sysWizardStep === 2) {
        sysStreamBuffer = '';
        sysWizardReqId = null;
      }
    }
  });

  cleanError = api.onStreamError(({ reqId, message }) => {
    const isGen  = reqId === generateReqId;
    const isAna  = reqId === analyzeReqId;
    const isMaster = reqId === masterWizardReqId;
    const isSys  = reqId === sysWizardReqId;

    if (isGen || isAna) {
      showToast(`Error: ${message}`, 'error', 5000);
      updateStatus('error', message);
      if (isGen) { setGenerateStreaming(false); generateReqId = null; }
      else        { setAnalyzeStreaming(false);  analyzeReqId  = null; }
    } else if (isMaster) {
      showToast(`Interview error: ${message}`, 'error', 5000);
      masterWizardReqId = null;
      masterStreamBuffer = '';
    } else if (isSys) {
      showToast(`Interview error: ${message}`, 'error', 5000);
      sysWizardReqId = null;
      sysStreamBuffer = '';
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════════════

async function loadModels(forceRefresh) {
  try {
    const models = await api.getModels(forceRefresh);
    allModels = models;
    if (forceRefresh) showToast(`${models.length} models loaded`, 'success', 2000);
  } catch (err) {
    console.warn('[Models]', err.message);
    if (forceRefresh) showToast(`Model load failed: ${err.message}`, 'error', 4000);
  }
}

async function init() {
  setupStreamListeners();

  try {
    const s = await api.getSettings();

    // API key
    apiKeyInput.value = s.apiKey || '';

    // Hotkey
    const hotkey = s.hotkey || DEFAULT_HOTKEY;
    hotkeyInput.value = fmtHotkey(hotkey);
    hotkeyInput.dataset.accelerator = hotkey;

    // Active model + favorites + recents
    favorites    = s.favorites    || [];
    recentModels = s.recentModels || [];
    updateModelBadge(s.activeModel || '', s.activeProvider || null);

    // Restore active context (master + system prompt)
    try {
      const ctx = await api.getActiveContext();
      activeContextRecord = ctx.masterPrompt || null;
      activeSystemRecord  = ctx.systemPrompt || null;
      renderContextBar();
    } catch { /* non-fatal */ }

    if (s.apiKey) {
      updateStatus('loading', 'Loading models...');
      await loadModels(false);
      updateStatus('connected', s.activeModel ? `Active: ${s.activeModel}` : 'Ready');
    } else {
      // No key — push user to settings
      document.querySelector('.tab[data-tab="settings"]').click();
      updateStatus('error', 'Add your OpenRouter API key in Settings');
    }
  } catch (err) {
    console.error('[Init]', err);
    updateStatus('error', 'Init failed');
    showToast(`Init error: ${err.message}`, 'error', 5000);
  }
}

// Load Prompts & Systems libraries when that tab is first opened
let psTabLoaded = false;
document.querySelector('.tab[data-tab="prompts"]').addEventListener('click', () => {
  if (!psTabLoaded) {
    psTabLoaded = true;
    loadMasterPromptLibrary();
    loadSystemPromptLibrary();
    loadProjectLibrary();
  }
});

init();

// ═══════════════════════════════════════════════════════════════════════════
// IMPROVEMENT LAB
// ═══════════════════════════════════════════════════════════════════════════

(function initImprovementLab() {
  // ─── DOM refs ──────────────────────────────────────────────────────────
  const labTitle         = $('labTitle');
  const labSavedInfo     = $('labSavedInfo');
  const labSaveBtn       = $('labSaveBtn');
  const labModelBadge    = $('labModelBadge');
  const labModelNameEl   = $('labModelName');
  const labSystemPrompt  = $('labSystemPrompt');
  const labImportSysPrompt = $('labImportSysPrompt');
  const labSysCollapse   = $('labSysCollapse');
  const labSysBody       = $('labSysBody');
  const labMessagesEl    = $('labMessages');
  const labAddPair       = $('labAddPair');
  const labTemplatize    = $('labTemplatize');
  const labVariablesPanel = $('labVariablesPanel');
  const labVariablesList = $('labVariablesList');
  const labPromptPanel   = $('labPromptPanel');
  const labEvaluatePanel = $('labEvaluatePanel');
  const labRunBtn        = $('labRunBtn');
  const labStopEval      = $('labStopEval');
  const labEvalOutput    = $('labEvalOutput');
  const labEvalMeta      = $('labEvalMeta');
  const labEvalTokens    = $('labEvalTokens');

  // Modals
  const labGenerateModal     = $('labGenerateModal');
  const labGenerateModalClose = $('labGenerateModalClose');
  const labGenTaskInput      = $('labGenTaskInput');
  const labGenCancelBtn      = $('labGenCancelBtn');
  const labGenViewBtn        = $('labGenViewBtn');
  const labThinkingCheck     = $('labThinkingCheck');
  const labPreviewModal      = $('labPreviewModal');
  const labPreviewModalClose = $('labPreviewModalClose');
  const labPreviewOutput     = $('labPreviewOutput');
  const labPreviewVarTags    = $('labPreviewVarTags');
  const labPreviewBackBtn    = $('labPreviewBackBtn');
  const labPreviewContinueBtn = $('labPreviewContinueBtn');

  // ─── State ─────────────────────────────────────────────────────────────
  let labState = {
    title: 'Untitled',
    systemPrompt: '',
    messages: [{ role: 'user', content: '', label: 'User' }],
    variables: [],
    mode: 'prompt',         // 'prompt' | 'evaluate'
    templatize: false,
    savedAt: null,
  };

  let labEvalReqId = null;
  let labEvalFull  = '';
  let labGenReqId  = null;
  let labGenFull   = '';
  let labTargetMsgIndex = 0;  // which message row triggered Generate Prompt

  // ─── Helpers ───────────────────────────────────────────────────────────

  function labExtractVariables(text) {
    const matches = text.match(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.slice(2, -2)))];
  }

  function labUpdateVariables() {
    const allText = labState.systemPrompt + ' ' + labState.messages.map(m => m.content).join(' ');
    labState.variables = labExtractVariables(allText);
    renderLabVariables();
  }

  function renderLabVariables() {
    if (!labState.templatize || labState.variables.length === 0) {
      labVariablesList.innerHTML = '<span class="lab-variables-empty">Enable Templatize and use {{VARIABLE_NAME}} syntax in your messages.</span>';
      return;
    }
    labVariablesList.innerHTML = labState.variables.map(v =>
      `<span class="lab-var-chip" data-var="${v}" title="Click to rename">{{${v}}}</span>`
    ).join('');

    labVariablesList.querySelectorAll('.lab-var-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const oldName = chip.dataset.var;
        const newName = prompt(`Rename variable "${oldName}" to:`, oldName);
        if (!newName || newName === oldName || !/^[A-Z_][A-Z0-9_]*$/.test(newName)) return;
        // Replace in all messages and system prompt
        const pattern = new RegExp(`\\{\\{${oldName}\\}\\}`, 'g');
        labState.systemPrompt = labState.systemPrompt.replace(pattern, `{{${newName}}}`);
        labState.messages.forEach(m => {
          m.content = m.content.replace(pattern, `{{${newName}}}`);
        });
        labSystemPrompt.value = labState.systemPrompt;
        renderLabMessages();
        labUpdateVariables();
      });
    });
  }

  // ─── Render Messages ───────────────────────────────────────────────────

  function renderLabMessages() {
    labMessagesEl.innerHTML = '';
    labState.messages.forEach((msg, i) => {
      const row = document.createElement('div');
      row.className = 'lab-msg-row';
      row.dataset.index = i;

      const isUser = msg.role === 'user';
      const label = msg.label || (isUser ? 'User' : 'Assistant');

      let headerHTML = `
        <div class="lab-msg-header">
          <span class="lab-msg-label" data-role="${msg.role}">${label}</span>
          <button class="lab-rename-btn" title="Rename role">&#9998;</button>`;

      if (isUser) {
        headerHTML += `<button class="btn btn-ghost btn-sm lab-generate-prompt-btn">Generate Prompt</button>`;
      }

      // Allow removing pairs (but keep at least the first user message)
      if (i > 0) {
        headerHTML += `<button class="lab-msg-remove" title="Remove">&#10005;</button>`;
      }

      headerHTML += `</div>`;

      row.innerHTML = headerHTML +
        `<textarea class="workshop-textarea lab-msg-input" rows="4" placeholder="${isUser ? 'Type your message or instructions...' : 'Assistant response will appear here after evaluation...'}" data-role="${msg.role}">${msg.content}</textarea>`;

      labMessagesEl.appendChild(row);

      // Event: textarea input
      const textarea = row.querySelector('.lab-msg-input');
      textarea.addEventListener('input', () => {
        labState.messages[i].content = textarea.value;
        if (labState.templatize) labUpdateVariables();
      });

      // Event: rename label
      row.querySelector('.lab-rename-btn').addEventListener('click', () => {
        const newLabel = prompt(`Rename "${label}" to:`, label);
        if (newLabel && newLabel.trim()) {
          labState.messages[i].label = newLabel.trim();
          renderLabMessages();
        }
      });

      // Event: Generate Prompt (only on user rows)
      const genBtn = row.querySelector('.lab-generate-prompt-btn');
      if (genBtn) {
        genBtn.addEventListener('click', () => {
          labTargetMsgIndex = i;
          labGenerateModal.classList.remove('hidden');
        });
      }

      // Event: remove message
      const removeBtn = row.querySelector('.lab-msg-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          labState.messages.splice(i, 1);
          renderLabMessages();
          labUpdateVariables();
        });
      }
    });
  }

  // ─── Mode Toggle (Prompt / Evaluate) ───────────────────────────────────

  document.querySelectorAll('.lab-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lab-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      labState.mode = btn.dataset.labmode;

      if (labState.mode === 'evaluate') {
        labEvaluatePanel.classList.remove('hidden');
      } else {
        labEvaluatePanel.classList.add('hidden');
      }
    });
  });

  // ─── System Prompt Collapse ────────────────────────────────────────────

  labSysCollapse.addEventListener('click', () => {
    labSysBody.classList.toggle('collapsed');
    labSysCollapse.classList.toggle('collapsed');
  });

  labSystemPrompt.addEventListener('input', () => {
    labState.systemPrompt = labSystemPrompt.value;
    if (labState.templatize) labUpdateVariables();
  });

  // ─── Import System Prompt into Lab ──────────────────────────────────
  // Reuses the context picker modal, but on select loads the prompt
  // content directly into the lab system prompt textarea.

  labImportSysPrompt.addEventListener('click', async () => {
    ctxPickerLabImport = true;
    ctxPickerMode = 'system';
    ctxPickerSelectedId = null;
    ctxPickerSelect.disabled = true;
    ctxPickerTitle.textContent = 'Import System Prompt';
    ctxPickerList.innerHTML = '<div class="ps-empty">Loading...</div>';
    ctxPickerModal.classList.remove('hidden');

    try {
      const items = await api.listSystemPrompts();
      ctxPickerList.innerHTML = '';
      if (items.length === 0) {
        ctxPickerList.innerHTML = '<div class="ps-empty">No system prompts saved yet. Create one in Prompts & Systems.</div>';
        return;
      }
      items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'ctx-picker-item';
        el.dataset.id = item.id;
        const updated = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '';
        el.innerHTML = `
          <div style="flex:1;min-width:0;">
            <div class="ctx-picker-item-name">${escHtml(item.name)}</div>
            <div class="ctx-picker-item-meta">${escHtml(item.category || '')}${updated ? ' \u00b7 ' + updated : ''}</div>
          </div>`;
        el.addEventListener('click', () => {
          document.querySelectorAll('.ctx-picker-item').forEach(r => r.classList.remove('selected'));
          el.classList.add('selected');
          ctxPickerSelectedId = item.id;
          ctxPickerSelect.disabled = false;
        });
        ctxPickerList.appendChild(el);
      });
    } catch (err) {
      ctxPickerList.innerHTML = `<div class="ps-empty" style="color:var(--color-error)">${escHtml(err.message)}</div>`;
    }
  });

  // Intercept the picker "Load" button when in lab import mode
  ctxPickerSelect.addEventListener('click', async () => {
    if (!ctxPickerLabImport || !ctxPickerSelectedId) return;
    ctxPickerLabImport = false;

    const items = await api.listSystemPrompts();
    const selected = items.find(i => i.id === ctxPickerSelectedId);
    if (selected && selected.content) {
      // Expand the system prompt section if collapsed
      labSysBody.classList.remove('collapsed');
      labSysCollapse.classList.remove('collapsed');

      labSystemPrompt.value = selected.content;
      labState.systemPrompt = selected.content;
      if (labState.templatize) labUpdateVariables();
      showToast(`Imported: ${selected.name}`, 'success', 2000);
    }
    ctxPickerModal.classList.add('hidden');
  });

  // ─── Templatize Toggle ─────────────────────────────────────────────────

  labTemplatize.addEventListener('change', () => {
    labState.templatize = labTemplatize.checked;
    labVariablesPanel.classList.toggle('hidden', !labState.templatize);
    if (labState.templatize) labUpdateVariables();
  });

  // ─── Add Message Pair ──────────────────────────────────────────────────

  labAddPair.addEventListener('click', () => {
    labState.messages.push(
      { role: 'assistant', content: '', label: 'Assistant' },
      { role: 'user', content: '', label: 'User' }
    );
    renderLabMessages();
  });

  // ─── Model Badge ──────────────────────────────────────────────────────

  function labUpdateModelBadge() {
    const parts = (activeModel || '').split('/');
    labModelNameEl.textContent = parts.length > 1 ? parts[1] : (activeModel || 'No model');
  }

  labModelBadge.addEventListener('click', () => {
    // Reuse the existing model picker modal
    modelModal.classList.remove('hidden');
    modelSearch.focus();
  });

  // Keep lab badge in sync when model changes
  const origUpdateModelBadge = window.updateModelBadge || updateModelBadge;
  // Monkey-patch to also update lab badge (the function is already defined above)
  const _origSetActiveModel = api.setActiveModel;
  // Instead, just observe via a MutationObserver on the main badge
  const labBadgeObserver = new MutationObserver(() => labUpdateModelBadge());
  labBadgeObserver.observe(modelBadgeName, { childList: true, characterData: true, subtree: true });

  // ─── Save / Load ──────────────────────────────────────────────────────

  labSaveBtn.addEventListener('click', async () => {
    labState.title = labTitle.value || 'Untitled';
    labState.savedAt = Date.now();
    try {
      await api.saveLabState(labState);
      labSavedInfo.textContent = 'Saved ' + new Date(labState.savedAt).toLocaleTimeString();
      showToast('Lab state saved', 'success');
    } catch (err) {
      showToast('Save failed: ' + err.message, 'error');
    }
  });

  async function labLoad() {
    try {
      const saved = await api.loadLabState();
      if (saved) {
        labState = { ...labState, ...saved };
        labTitle.value = labState.title || 'Untitled';
        labSystemPrompt.value = labState.systemPrompt || '';
        labTemplatize.checked = !!labState.templatize;
        labVariablesPanel.classList.toggle('hidden', !labState.templatize);
        if (labState.savedAt) {
          labSavedInfo.textContent = 'Saved ' + new Date(labState.savedAt).toLocaleTimeString();
        }
        renderLabMessages();
        if (labState.templatize) labUpdateVariables();
      }
    } catch { /* no saved state */ }
  }

  // ─── Generate Prompt Modal ─────────────────────────────────────────────

  // Quick task chips
  document.querySelectorAll('.lab-quick-task').forEach(chip => {
    chip.addEventListener('click', () => {
      labGenTaskInput.value = chip.dataset.task;
    });
  });

  function closeLabGenModal() {
    labGenerateModal.classList.add('hidden');
    labGenTaskInput.value = '';
  }

  labGenerateModalClose.addEventListener('click', closeLabGenModal);
  labGenCancelBtn.addEventListener('click', closeLabGenModal);

  labGenViewBtn.addEventListener('click', () => {
    const task = labGenTaskInput.value.trim();
    if (!task) { showToast('Describe a task first', 'warning'); return; }

    // Show loading state
    labGenViewBtn.disabled = true;
    labGenViewBtn.innerHTML = '<span class="lab-spinner"></span>Generating...';

    // Open preview modal, close generate modal
    labGenerateModal.classList.add('hidden');
    labPreviewModal.classList.remove('hidden');
    labPreviewOutput.innerHTML = '<span class="cursor"></span>';
    labPreviewVarTags.innerHTML = '';
    labGenFull = '';

    // Start streaming
    labGenReqId = genReqId();
    api.streamRequest(labGenReqId, 'lab-generate', {
      task,
      thinking: labThinkingCheck.checked,
    });
  });

  // ─── Your Prompt Preview Modal ─────────────────────────────────────────

  labPreviewModalClose.addEventListener('click', () => {
    labPreviewModal.classList.add('hidden');
    labGenViewBtn.disabled = false;
    labGenViewBtn.textContent = 'View Prompt';
    if (labGenReqId) { api.streamAbort(); labGenReqId = null; }
  });

  labPreviewBackBtn.addEventListener('click', () => {
    labPreviewModal.classList.add('hidden');
    labGenerateModal.classList.remove('hidden');
    labGenViewBtn.disabled = false;
    labGenViewBtn.textContent = 'View Prompt';
    if (labGenReqId) { api.streamAbort(); labGenReqId = null; }
  });

  labPreviewContinueBtn.addEventListener('click', () => {
    // Insert generated prompt into the target user message
    if (labGenFull && labState.messages[labTargetMsgIndex]) {
      labState.messages[labTargetMsgIndex].content = labGenFull;
      renderLabMessages();
      if (labState.templatize) labUpdateVariables();
    }
    labPreviewModal.classList.add('hidden');
    labGenViewBtn.disabled = false;
    labGenViewBtn.textContent = 'View Prompt';
    labGenReqId = null;
    showToast('Prompt inserted', 'success');
  });

  // ─── Evaluate Mode ────────────────────────────────────────────────────

  labRunBtn.addEventListener('click', () => {
    // Collect messages that have content
    const msgs = labState.messages.filter(m => m.content.trim());
    if (msgs.length === 0) { showToast('Add at least one message', 'warning'); return; }

    labEvalFull = '';
    labEvalOutput.innerHTML = '<span class="cursor"></span>';
    labEvalMeta.classList.add('hidden');
    labStopEval.classList.remove('hidden');
    labRunBtn.disabled = true;

    labEvalReqId = genReqId();
    api.streamRequest(labEvalReqId, 'lab-evaluate', {
      systemPrompt: labState.systemPrompt,
      messages: msgs.map(m => ({ role: m.role, content: m.content })),
    });
  });

  labStopEval.addEventListener('click', () => {
    api.streamAbort();
    labStopEval.classList.add('hidden');
    labRunBtn.disabled = false;
  });

  // ─── Stream Handlers (shared with existing system) ─────────────────────

  api.onStreamChunk((data) => {
    // Handle lab-generate chunks
    if (data.reqId === labGenReqId) {
      labGenFull += data.chunk;
      labPreviewOutput.innerHTML = labGenFull.replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // Update preview variables
      const vars = labExtractVariables(labGenFull);
      labPreviewVarTags.innerHTML = vars.map(v =>
        `<span class="lab-var-chip" data-var="${v}">{{${v}}}</span>`
      ).join('');
    }

    // Handle lab-evaluate chunks
    if (data.reqId === labEvalReqId) {
      labEvalFull += data.chunk;
      labEvalOutput.textContent = labEvalFull;
      labEvalOutput.scrollTop = labEvalOutput.scrollHeight;
    }
  });

  api.onStreamDone((data) => {
    if (data.reqId === labGenReqId) {
      labGenReqId = null;
      labGenViewBtn.disabled = false;
      labGenViewBtn.textContent = 'View Prompt';
    }
    if (data.reqId === labEvalReqId) {
      labEvalReqId = null;
      labStopEval.classList.add('hidden');
      labRunBtn.disabled = false;

      // Show token count if we can estimate
      const chars = labEvalFull.length;
      const approxTokens = Math.round(chars / 4);
      labEvalTokens.textContent = `~${approxTokens} tokens (${chars} chars)`;
      labEvalMeta.classList.remove('hidden');
    }
  });

  api.onStreamError((data) => {
    if (data.reqId === labGenReqId) {
      labGenReqId = null;
      labGenViewBtn.disabled = false;
      labGenViewBtn.textContent = 'View Prompt';
      labPreviewOutput.innerHTML = `<span style="color:var(--error)">Error: ${data.message}</span>`;
    }
    if (data.reqId === labEvalReqId) {
      labEvalReqId = null;
      labStopEval.classList.add('hidden');
      labRunBtn.disabled = false;
      labEvalOutput.innerHTML = `<span style="color:var(--error)">Error: ${data.message}</span>`;
    }
  });

  // ─── Initialize ───────────────────────────────────────────────────────

  renderLabMessages();
  labUpdateModelBadge();

  // Lazy-load saved state when lab tab is first clicked
  let labLoaded = false;
  document.querySelector('.tab[data-tab="lab"]').addEventListener('click', () => {
    if (!labLoaded) {
      labLoaded = true;
      labLoad();
      labUpdateModelBadge();
    }
  });

})();

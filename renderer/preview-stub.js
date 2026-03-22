/* Stub window.api for static preview — no Electron preload bridge */
window.api = new Proxy({
  getSettings: () => Promise.resolve({
    apiKey: '', activeModel: 'anthropic/claude-sonnet-4.6',
    hotkey: 'Control+Command+E', favorites: [], recentModels: [],
  }),
  saveSettings: () => Promise.resolve(),
  getModels: () => Promise.resolve([]),
  setActiveModel: () => Promise.resolve(),
  toggleFavorite: () => Promise.resolve([]),
  onStreamChunk: () => () => {},
  onStreamDone:  () => () => {},
  onStreamError: () => () => {},
  onStatus: () => {},
  streamRequest: () => {},
  streamAbort: () => {},
  startRecording: () => {},
  stopRecording: () => {},
  startGenerate: () => {},
  startAnalyze: () => {},
  abortStream: () => {},
  onStreamEvent: () => {},
  listMasterPrompts: () => Promise.resolve([]),
  saveMasterPrompt: () => Promise.resolve(),
  deleteMasterPrompt: () => Promise.resolve(),
  listSystemPrompts: () => Promise.resolve([
    { id: 'sp1', name: 'Code Reviewer', content: 'You are an expert code reviewer. Analyze code for bugs, security issues, and best practices. Provide clear, actionable feedback.', category: 'code', updatedAt: Date.now() },
    { id: 'sp2', name: 'Marketing Copywriter', content: 'You are a marketing copywriter specializing in conversion-focused content. Write compelling copy that drives action.', category: 'marketing', updatedAt: Date.now() - 86400000 },
  ]),
  saveSystemPrompt: () => Promise.resolve(),
  deleteSystemPrompt: () => Promise.resolve(),
  listProjects: () => Promise.resolve([]),
  saveProject: () => Promise.resolve(),
  deleteProject: () => Promise.resolve(),
  saveLabState: () => Promise.resolve(),
  loadLabState: () => Promise.resolve(null),
  getActiveContext: () => Promise.resolve({}),
  setActiveContext: () => Promise.resolve(),
  exportDocument: () => Promise.resolve({ ok: true }),
}, {
  /* Proxy: return a no-op for any missing method so the renderer never crashes */
  get(target, prop) {
    if (prop in target) return target[prop];
    return () => Promise.resolve();
  }
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // OpenRouter models
  getModels: (forceRefresh) => ipcRenderer.invoke('get-models', forceRefresh),

  // Active model + favorites
  setActiveModel: (model, provider) => ipcRenderer.invoke('set-active-model', { model, provider }),
  toggleFavorite: (modelId) => ipcRenderer.invoke('toggle-favorite', modelId),

  // Hotkey recording
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: (hotkey) => ipcRenderer.invoke('stop-recording', hotkey),

  // Streaming (fire-and-forget send; responses come back on events)
  streamRequest: (reqId, type, input) => ipcRenderer.send('stream-request', { reqId, type, input }),
  streamAbort: () => ipcRenderer.send('stream-abort'),
  onStreamChunk: (cb) => {
    const handler = (_e, d) => cb(d);
    ipcRenderer.on('stream-chunk', handler);
    return () => ipcRenderer.removeListener('stream-chunk', handler);
  },
  onStreamDone: (cb) => {
    const handler = (_e, d) => cb(d);
    ipcRenderer.on('stream-done', handler);
    return () => ipcRenderer.removeListener('stream-done', handler);
  },
  onStreamError: (cb) => {
    const handler = (_e, d) => cb(d);
    ipcRenderer.on('stream-error', handler);
    return () => ipcRenderer.removeListener('stream-error', handler);
  },

  // Status updates from main process
  onStatus: (callback) => {
    ipcRenderer.on('status-update', (_event, data) => callback(data));
  },

  // Master Prompts
  listMasterPrompts: () => ipcRenderer.invoke('list-master-prompts'),
  saveMasterPrompt: (data) => ipcRenderer.invoke('save-master-prompt', data),
  deleteMasterPrompt: (id) => ipcRenderer.invoke('delete-master-prompt', id),

  // System Prompts
  listSystemPrompts: () => ipcRenderer.invoke('list-system-prompts'),
  saveSystemPrompt: (data) => ipcRenderer.invoke('save-system-prompt', data),
  deleteSystemPrompt: (id) => ipcRenderer.invoke('delete-system-prompt', id),

  // Projects
  listProjects: () => ipcRenderer.invoke('list-projects'),
  saveProject: (data) => ipcRenderer.invoke('save-project', data),
  deleteProject: (id) => ipcRenderer.invoke('delete-project', id),

  // Active context
  setActiveContext: (opts) => ipcRenderer.invoke('set-active-context', opts),
  getActiveContext: () => ipcRenderer.invoke('get-active-context'),

  // Export / Import
  exportDocument: (opts) => ipcRenderer.invoke('export-document', opts),
  importDocument: (opts) => ipcRenderer.invoke('import-document', opts),

  // Improvement Lab
  saveLabState: (data) => ipcRenderer.invoke('save-lab-state', data),
  loadLabState: () => ipcRenderer.invoke('load-lab-state'),
});

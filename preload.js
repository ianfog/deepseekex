'use strict'
/**
 * Preload for the chrome renderer (the local shell page that hosts the dsh
 * webview and the update UI). Exposes a minimal, promise-based API surface.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('deepseekex', {
  getState: () => ipcRenderer.invoke('desktop:get-state'),
  getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('desktop:save-settings', patch),
  refreshBalance: () => ipcRenderer.invoke('desktop:refresh-balance'),
  pickWorkspace: () => ipcRenderer.invoke('desktop:pick-workspace'),
  checkUpdate: () => ipcRenderer.invoke('desktop:check-update'),
  applyUpdate: () => ipcRenderer.invoke('desktop:apply-update'),
  restartBackend: () => ipcRenderer.invoke('desktop:restart-backend'),
  retryBoot: () => ipcRenderer.invoke('desktop:retry-boot'),
  onEvent: (cb) => {
    ipcRenderer.on('desktop:event', (_event, payload) => cb(payload))
  },
  onProgress: (cb) => {
    ipcRenderer.on('desktop:progress', (_event, payload) => cb(payload))
  },
})

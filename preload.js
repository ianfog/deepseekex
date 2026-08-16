'use strict'
/**
 * Preload for the chrome renderer (the local shell page that hosts the dsh
 * webview and the update UI). Exposes a minimal, promise-based API surface.
 *
 * NOTE: this file must stay plain CommonJS `.js` — Electron's sandboxed
 * preload runs in a restricted V8 bundle that does NOT support TypeScript
 * type stripping, so a `.ts` preload fails to load in packaged builds.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('deepseekex', {
  getState: () => ipcRenderer.invoke('desktop:get-state'),
  getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('desktop:save-settings', patch),
  refreshBalance: () => ipcRenderer.invoke('desktop:refresh-balance'),
  shellUpdateCheck: () => ipcRenderer.invoke('desktop:shell-update-check'),
  shellUpdateApply: () => ipcRenderer.invoke('desktop:shell-update-apply'),
  shellUpdateReveal: () => ipcRenderer.invoke('desktop:shell-update-reveal'),
  checkUpdate: () => ipcRenderer.invoke('desktop:check-update'),
  applyUpdate: () => ipcRenderer.invoke('desktop:apply-update'),
  restartBackend: () => ipcRenderer.invoke('desktop:restart-backend'),
  retryBoot: () => ipcRenderer.invoke('desktop:retry-boot'),
  windowMinimize: () => ipcRenderer.invoke('desktop:window-minimize'),
  windowClose: () => ipcRenderer.invoke('desktop:window-close'),
  onEvent: (cb) => {
    ipcRenderer.on('desktop:event', (_event, payload) => cb(payload))
  },
  onProgress: (cb) => {
    ipcRenderer.on('desktop:progress', (_event, payload) => cb(payload))
  },
  platform: process.platform,
})

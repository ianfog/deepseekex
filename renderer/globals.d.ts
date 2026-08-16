/**
 * Global types for the chrome renderer (browser script, no modules).
 * Declares the preload-exposed `window.deepseekex` API so JSDoc-checked
 * renderer code type-checks. Mirrors preload.ts.
 */

interface DeepseekexApi {
  getState(): Promise<unknown>
  getSettings(): Promise<{ dshHome?: string; npmRegistry?: string; autoCheck?: boolean }>
  saveSettings(patch: { dshHome?: string; npmRegistry?: string; autoCheck?: boolean }): Promise<unknown>
  refreshBalance(): Promise<unknown>
  shellUpdateCheck(): Promise<unknown>
  shellUpdateApply(): Promise<unknown>
  shellUpdateReveal(): Promise<unknown>
  checkUpdate(): Promise<unknown>
  applyUpdate(): Promise<unknown>
  restartBackend(): Promise<unknown>
  retryBoot(): Promise<unknown>
  windowMinimize(): Promise<unknown>
  windowClose(): Promise<unknown>
  onEvent(cb: (ev: { type: string; state: unknown }) => void): void
  onProgress(cb: (p: { pct: number; label: string }) => void): void
}

interface Window {
  deepseekex: DeepseekexApi
}

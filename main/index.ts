'use strict'
/**
 * Electron main entry. Owns the window, the boot orchestration (npm CLI ->
 * kernel -> backend), the update flow, backend crash handling with one-shot
 * kernel rollback, and the IPC surface exposed to the chrome renderer.
 * @module deepseekex/main
 */

const { app, BrowserWindow, ipcMain, nativeTheme, screen } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const semver = require('semver')
const jsyaml = require('js-yaml')
const paths = require('./paths.ts')
const log = require('./log.ts')
const npm = require('./npm.ts')
const kernel = require('./kernel.ts')
const updater = require('./updater.ts')
const { Backend } = require('./backend.ts')
const uiPatch = require('./ui-patch.ts')

/**
 * Resolve the Node runtime for backend/kernel processes. Prefers a real Node
 * on PATH: native addons (koffi directory picker, node-addon-require-builtin)
 * load only under plain-Node ABIs — under Electron-as-Node they crash or fail
 * to load. Falls back to Electron-as-Node so the packaged app still works
 * without a system Node.
 * @returns {Promise<{ nodeBin: string, electronAsNode: boolean, nodeVersion: string }>}
 */
async function resolveNodeBin() {
  const candidates = []
  if (process.env.DSH_DESKTOP_NODE) candidates.push(process.env.DSH_DESKTOP_NODE)
  else candidates.push('node')
  const { execFile } = require('node:child_process')
  for (const candidate of candidates) {
    try {
      const version = await new Promise((resolve: (v: string) => void, reject: (e: Error) => void) => {
        execFile(candidate, ['--version'], { timeout: 5000 }, (err: Error | null, stdout: string) => {
          if (err) return reject(err)
          resolve(String(stdout).trim())
        })
      })
      const v = semver.valid(version)
      if (v && (semver.gte(v, '22.19.0') || semver.major(v) >= 24)) {
        log.info(`backend runtime: ${candidate} (node ${v})`)
        return { nodeBin: candidate, electronAsNode: false, nodeVersion: v }
      }
    } catch {
      /* candidate unavailable; try the next */
    }
  }
  log.info('backend runtime: Electron-as-Node (no usable system Node found)')
  return { nodeBin: process.execPath, electronAsNode: true, nodeVersion: process.versions.node }
}

let userData = ''
let settings: { dshHome?: string; npmRegistry?: string; autoCheck?: boolean } = {}
let win: import('electron').BrowserWindow | null = null
/** Structural type of the Backend class. The CJS `module.exports = {Backend}`
 *  shape can't be introspected via `typeof import()` under type stripping,
 *  so index.ts declares the members it uses. */
interface BackendLike {
  start(
    kernelRoot: string,
    opts?: {
      port?: number
      dshHome?: string
      trustedHosts?: string[]
      bootTimeoutMs?: number
      probeTimeoutMs?: number
    },
  ): Promise<string>
  getUrl(): string | null
  isRunning(): boolean
  stop(): Promise<void>
}
let backend: BackendLike | null = null
let npmCli: string | null = null
let exitCount = 0
let rollbackAttempted = false
let nodeBin = process.execPath
let electronAsNode = true
/** Shape of the shell-update telemetry mirrored into state. */
interface ShellUpdateState {
  available: boolean
  version: string | null
  downloading: boolean
  downloaded: boolean
  status?: string
  progress?: number
  message?: string
  manual?: boolean
  path?: string
}

const state: {
  phase: string
  kernelVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  backendUrl: string | null
  source: { sha: string; date: string | null } | null
  message: string
  logsTail: string[]
  settings: Record<string, unknown>
  themePreference: string
  balance: unknown
  shellUpdate: ShellUpdateState | null
  nodeRuntime: string
  nodeVersion: string
  backendStartedAt: number | null
  usageMs: number
} = {
  phase: 'starting', // starting | ready | updating | error | quitting
  kernelVersion: null,
  latestVersion: null,
  updateAvailable: false,
  backendUrl: null,
  source: null,
  message: '',
  logsTail: [],
  settings: {},
  themePreference: 'system', // 'light' | 'dark' | 'system' (dsh UI's own setting)
  balance: null, // DeepSeek platform balance telemetry ({ok,...} | null)
  shellUpdate: null, // shell self-update telemetry ({available,version,progress,...} | null)
  nodeRuntime: 'electron-as-node', // 'system-node' | 'electron-as-node' (backend runtime)
  nodeVersion: process.versions.node,
  backendStartedAt: null, // epoch ms when the current backend was started
  usageMs: 0, // accumulated app usage time across sessions (ms)
}

/* ---- total usage telemetry: accumulate app-open time across sessions ---- */
/** Persisted total (ms) before this session started. */
let usageBaseMs = 0
/** Epoch ms when this session's counting started. */
let sessionStartedAt = 0
/** Periodic persist/broadcast timer. */
let usageTimer: ReturnType<typeof setInterval> | null = null

/** Total accumulated usage in ms (persisted base + this session's elapsed). */
function currentUsageMs(): number {
  const elapsed = sessionStartedAt > 0 ? Math.max(0, Date.now() - sessionStartedAt) : 0
  return usageBaseMs + elapsed
}

/** Load the persisted total from `<userData>/usage.json` (0 on first run). */
function loadUsage() {
  try {
    const raw = JSON.parse(fs.readFileSync(paths.usageFile(userData), 'utf8').replace(/^\uFEFF/, ''))
    usageBaseMs = typeof raw.totalMs === 'number' && raw.totalMs >= 0 ? raw.totalMs : 0
  } catch {
    usageBaseMs = 0
  }
}

/** Write the current total to disk (best-effort; loses at most one tick). */
function persistUsage() {
  try {
    fs.writeFileSync(paths.usageFile(userData), JSON.stringify({ totalMs: currentUsageMs() }))
  } catch (err) {
    log.warn(`usage persist failed: ${(err as Error).message}`)
  }
}

/** Start the 30s ticker that keeps the readout live and the total durable. */
function startUsageTicker() {
  stopUsageTicker()
  usageTimer = setInterval(() => {
    state.usageMs = currentUsageMs()
    broadcast()
    persistUsage()
  }, 30_000)
  usageTimer.unref?.()
}

function stopUsageTicker() {
  if (usageTimer) {
    clearInterval(usageTimer)
    usageTimer = null
  }
}

/** Structural type of the shell updater object (CJS exports can't be
 *  introspected via typeof import() under type stripping). */
interface ShellUpdaterLike {
  check(): Promise<{ ok: boolean; available: boolean; version: string | null; message?: string }>
  apply(): Promise<{ ok: boolean; message?: string }>
  reveal(): Promise<{ ok: boolean; message?: string; path?: string }>
}
let shellUpdater: ShellUpdaterLike | null = null

function broadcast() {
  state.logsTail = log.tail()
  state.settings = { ...settings }
  state.usageMs = currentUsageMs()
  if (win && !win.isDestroyed()) win.webContents.send('desktop:event', { type: 'state', state })
}

/** Push a check/update progress event to the chrome (0-100, uppercase label). */
function sendProgress(pct: number, label: string) {
  if (!win || win.isDestroyed()) return
  win.webContents.send('desktop:progress', { pct, label })
}

/** Refresh platform balance telemetry into state and broadcast (best-effort). */
async function refreshBalance() {
  const balance = require('./balance.ts')
  const home = dshHomeDir()
  state.balance = await balance.fetchBalance(home)
  broadcast()
}

/** Initialize the shell self-updater and mirror its events into state. */
function initShellUpdater() {
  if (shellUpdater) return
  const { createShellUpdater } = require('./shell-updater.ts')
  shellUpdater = createShellUpdater({
    onState: (s: ShellUpdateState) => {
      state.shellUpdate = s
      broadcast()
      // reuse the top-bar progress bar for shell download progress
      if (s.status === 'downloading' && typeof s.progress === 'number') {
        sendProgress(s.progress, 'SHELL UPDATE')
      } else if (s.status === 'downloaded') {
        sendProgress(100, 'SHELL READY')
      } else if (s.status === 'dmg-ready') {
        sendProgress(100, 'MANUAL INSTALL')
      } else if (s.status === 'installing') {
        sendProgress(100, 'INSTALLING')
      }
    },
  })
}

/** Best-effort shell update check (auto-updater tolerates dev mode). */
async function checkShellUpdate() {
  try {
    initShellUpdater()
    await shellUpdater!.check()
  } catch (err) {
    log.warn(`shell update check failed: ${(err as Error).message}`)
  }
}

/** Main boot pipeline; retryable from the UI. */
async function boot() {
  state.phase = 'starting'
  state.message = 'starting…'
  broadcast()
  try {
    settings = paths.readSettings(userData)
    log.info(`deepseekex boot (node ${process.versions.node}, ${process.platform}/${process.arch})`)
    log.info(`settings: ${JSON.stringify(settings)}`)
    const runtime = await resolveNodeBin()
    nodeBin = runtime.nodeBin
    electronAsNode = runtime.electronAsNode
    state.nodeRuntime = runtime.electronAsNode ? 'electron-as-node' : 'system-node'
    state.nodeVersion = runtime.nodeVersion

    state.message = 'preparing npm CLI…'
    broadcast()
    const cli = await npm.ensureNpmCli(userData, settings, (m: string) => {
      state.message = m
      broadcast()
    })
    npmCli = cli.cli

    let latest = null
    try {
      latest = await updater.latestVersion(settings)
    } catch (err) {
      log.warn(`registry unreachable at boot (${(err as Error).message}); continuing with local kernel if present`)
    }
    const active = await kernel.ensureActive(userData, {
      latest,
      nodeBin,
      npmCli: cli.cli,
      electronAsNode,
      settings,
      onProgress: (m: string) => {
        state.message = m
        broadcast()
      },
    })
    state.kernelVersion = active
    state.latestVersion = latest

    await startBackend()
    state.phase = 'ready'
    state.message = 'ready'
    refreshThemePreference()
    armThemeWatcher()
    broadcast()

    // Platform balance telemetry: silent, non-blocking, refreshed on demand.
    void refreshBalance().catch(() => {})
    setInterval(() => {
      if (state.phase === 'ready') void refreshBalance().catch(() => {})
    }, 5 * 60_000).unref?.()

    // Shell self-update check (GitHub Releases), silent and non-blocking.
    void checkShellUpdate().catch(() => {})

    if (settings.autoCheck) {
      try {
        const check = await updater.check({ settings, current: active })
        state.latestVersion = check.latest
        state.updateAvailable = check.updateAvailable
        state.source = check.source
        log.info(`update check: current=${check.current} latest=${check.latest} available=${check.updateAvailable}`)
        broadcast()
      } catch (err) {
        log.warn(`update check failed: ${(err as Error).message}`)
      }
    }
  } catch (err) {
    state.phase = 'error'
    state.message = err instanceof Error ? (err as Error).message : String(err)
    log.error(`boot failed: ${state.message}`)
    broadcast()
  }
}

/** Stop the old backend (if any) and start the active kernel. */
async function startBackend() {
  if (backend) await backend.stop().catch(() => {})
  const dir = kernel.dirFor(userData, state.kernelVersion)
  backend = new Backend({ nodeBin, electronAsNode, onExit: handleBackendExit })
  const url = await backend!.start(dir, {
    dshHome: settings.dshHome || undefined,
    bootTimeoutMs: 120_000,
    probeTimeoutMs: 20_000,
  })
  exitCount = 0
  state.backendUrl = url
  state.backendStartedAt = Date.now()
  armThemeWatcher()
  broadcast()
}

/** Backend died: restart, then one-shot rollback to the previous kernel. */
async function handleBackendExit(code: number | null, signal: string | null) {
  if (state.phase === 'quitting' || state.phase === 'updating') return
  log.warn(`backend exited unexpectedly (code ${code}, ${signal}); exit#${exitCount + 1}`)
  exitCount += 1
  state.phase = 'error'
  state.message = '内核进程退出，正在恢复…'
  broadcast()
  await new Promise((r) => setTimeout(r, 500))
  try {
    if (exitCount <= 3 && !rollbackAttempted) {
      await startBackend()
      state.phase = 'ready'
      state.message = '内核已恢复'
    } else if (!rollbackAttempted) {
      rollbackAttempted = true
      const previous = kernel
        .listInstalled(userData)
        .filter((v: string) => v !== state.kernelVersion)
        .sort(semver.rcompare)[0]
      if (previous) {
        log.warn(`crash loop detected; rolling back kernel to ${previous}`)
        kernel.setActive(userData, previous)
        state.kernelVersion = previous
        state.message = `内核异常，已回滚到 ${previous}`
        await startBackend()
        state.phase = 'ready'
      } else {
        state.message = '内核进程反复崩溃，且没有可回滚的旧版本'
      }
    } else {
      state.message = '内核进程反复崩溃，已停止自动恢复'
    }
  } catch (err) {
    state.phase = 'error'
    state.message = `恢复失败: ${(err as Error).message}`
    log.error(`recovery failed: ${(err as Error).message}`)
  }
  broadcast()
}

function createWindow() {
  // Fit the primary display's work area so the window never opens clipped or
  // squeezed on small/scaled screens; then maximize to fill the screen. The
  // default width is generous so the docked OPS sidebar has room to expand.
  const work = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1440, Math.max(1120, work.width - 32))
  const height = Math.min(880, Math.max(640, work.height - 48))
  win = new BrowserWindow({
    width,
    height,
    minWidth: 960,
    minHeight: 620,
    title: 'Deepseekex',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#191919',
    // Frameless-but-native-chrome: hide the system title bar and let the
    // shell paint the topbar. Windows keeps OS buttons (min/max/close) as a
    // titleBarOverlay tinted with the Endfield ink. macOS keeps the native
    // traffic lights (titleBarStyle hidden) instead of hand-drawn controls;
    // Linux stays fully frameless.
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#191919',
            symbolColor: '#f2f2f0',
            height: 52,
          },
        }
      : process.platform === 'darwin'
        ? {
            titleBarStyle: 'hidden',
            trafficLightPosition: { x: 16, y: 20 },
          }
        : {
            frame: false,
          }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // Dev-mode window icons: packaged apps get build/icon.ico / icon.icns from
  // electron-builder; in `npm start` Electron would otherwise show its default
  // icon. build/ is not packaged (existsSync guard keeps this a no-op there).
  const icon = path.join(__dirname, '..', 'build', 'icon.ico')
  if (process.platform === 'win32' && fs.existsSync(icon)) win!.setIcon(icon)
  if (process.platform === 'darwin') {
    const png = path.join(__dirname, '..', 'build', 'icon.png')
    if (fs.existsSync(png)) app.dock?.setIcon(png)
  }
  // Open as a normal (non-maximized) window: size fits the work area without
  // covering the whole screen. Show once the page is paintable.
  win!.once('ready-to-show', () => {
    win!.show()
  })
  // The dsh UI lives in an in-page `<iframe>` (a plain DOM element: size
  // always follows the CSS box and the chrome DOM stacks above it, unlike a
  // native WebContentsView or a webview guest). External links from the dsh
  // UI open in the system browser.
  win!.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) require('electron').shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  // Apply the UI patch layer (Endfield styling) whenever the dsh iframe
  // finishes loading. Re-applied a couple of times because the ui-theme
  // plugin injects its stylesheets lazily after load.
  win!.webContents.on('did-frame-finish-load', (_e: Electron.Event, isMainFrame: boolean, frameProcessId: number, frameRoutingId: number) => {
    if (isMainFrame) return
    let frame = null
    try {
      frame = require('electron').webFrameMain.fromId(frameProcessId, frameRoutingId)
    } catch {
      return
    }
    if (!frame || !/^https?:\/\/127\.0\.0\.1:\d+/.test(frame.url)) return
    if (state.phase !== 'ready') return
    // The Endfield industrial look is dark by design: force the carbon shell
    // unless the user explicitly picked a light 配色.
    const forceDark = readThemePreference() !== 'light'
    // Re-applied on a spread of delays because the dsh app injects its module
    // stylesheets lazily (some chunks land long after load) — the patch must
    // stay last among equal-specificity rules to win.
    for (const delay of [0, 1000, 4000, 8000, 16000]) {
      setTimeout(() => {
        if (win && !win!.isDestroyed()) void uiPatch.applyUiPatches(win, { forceDark })
      }, delay)
    }
  })
  win!.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  win!.on('closed', () => {
    win = null
  })
  if (process.env.DSH_DESKTOP_DEVTOOLS) win!.webContents.openDevTools({ mode: 'detach' })
}

/** The dsh home directory the backend actually uses (settings override or default). */
function dshHomeDir() {
  return settings.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** Read the persisted ui-theme preference from the hot-reloaded settings document. */
function readThemePreference() {
  try {
    const file = path.join(dshHomeDir(), 'settings.yaml')
    if (!fs.existsSync(file)) return 'system'
    const doc = jsyaml.load(fs.readFileSync(file, 'utf8'))
    const pref = doc && typeof doc === 'object' ? doc['ui-theme']?.preference : undefined
    return pref === 'light' || pref === 'dark' ? pref : 'system'
  } catch (err) {
    log.warn(`theme preference read failed: ${(err as Error).message}`)
    return 'system'
  }
}

/** Sync the 配色 preference into state (the dsh UI owns light/dark). */
function refreshThemePreference() {
  const pref = readThemePreference()
  if (state.themePreference !== pref) {
    state.themePreference = pref
    broadcast()
  }
  applyTitleBarOverlay()
}

/** Whether the shell should use the dark palette (resolves 'system' through
 *  the OS color scheme via nativeTheme). */
function resolveShellDark(): boolean {
  const pref = state.themePreference
  if (pref === 'light') return false
  if (pref === 'dark') return true
  return nativeTheme.shouldUseDarkColors
}

/**
 * Repaint the Windows titleBarOverlay window controls (min/max/close) to
 * match the shell theme. The overlay is painted by the OS over the frameless
 * chrome, so it must be re-colored whenever the theme preference changes.
 * While the boot/update/error overlay is visible the chrome is carbon-ink, so
 * the window controls stay dark too (no white flash on light systems).
 */
function applyTitleBarOverlay() {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return
  if (state.phase !== 'ready') return
  try {
    const dark = resolveShellDark()
    win.setTitleBarOverlay({
      color: dark ? '#191919' : '#f4f4f1',
      symbolColor: dark ? '#f2f2f0' : '#1c1c1a',
      height: 52,
    })
  } catch (err) {
    log.warn(`titleBarOverlay update failed: ${(err as Error).message}`)
  }
}

/** Active watcher on the dsh home directory for `settings.yaml` writes. */
let themeWatcher: import('node:fs').FSWatcher | null = null

/**
 * Watch the dsh home directory so the chrome theme follows the in-app
 * 设置 → 外观 change immediately (the dsh UI hot-reloads the same document).
 * Debounced; re-armed whenever the backend (re)starts in case dshHome moved.
 */
function armThemeWatcher() {
  try {
    if (themeWatcher) {
      themeWatcher.close()
      themeWatcher = null
    }
    const dir = dshHomeDir()
    if (!fs.existsSync(dir)) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const watcher = fs.watch(dir, (_event: string, filename: string | null) => {
      if (filename !== 'settings.yaml') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => refreshThemePreference(), 250)
    })
    watcher.on('error', () => {
      /* watcher is best-effort; theme falls back to boot-time value */
    })
    themeWatcher = watcher
  } catch (err) {
    log.warn(`theme watcher arm failed: ${(err as Error).message}`)
  }
}

// ---- IPC ----

ipcMain.handle('desktop:get-state', () => state)
ipcMain.handle('desktop:get-settings', () => ({ ...settings }))

// Frameless window controls (used on macOS, where the traffic lights are gone).
ipcMain.handle('desktop:window-minimize', () => {
  win?.minimize()
})
ipcMain.handle('desktop:window-close', () => {
  win?.close()
})

// Manual balance refresh (click the SYS/BALANCE cell).
ipcMain.handle('desktop:refresh-balance', async () => {
  await refreshBalance()
  return state.balance
})

// Shell self-update: check / apply. Dev-mode and network failures degrade
// gracefully (autoUpdater throws and the module reports {ok:false}).
ipcMain.handle('desktop:shell-update-check', async () => {
  initShellUpdater()
  return shellUpdater!.check()
})
ipcMain.handle('desktop:shell-update-apply', async () => {
  initShellUpdater()
  return shellUpdater!.apply()
})
ipcMain.handle('desktop:shell-update-reveal', async () => {
  initShellUpdater()
  return shellUpdater!.reveal()
})

ipcMain.handle('desktop:save-settings', async (_e: Electron.IpcMainInvokeEvent, patch: { dshHome?: string; npmRegistry?: string; autoCheck?: boolean }) => {
  settings = {
    dshHome: typeof patch.dshHome === 'string' ? patch.dshHome.trim() : settings.dshHome,
    npmRegistry: typeof patch.npmRegistry === 'string' ? patch.npmRegistry.trim() : settings.npmRegistry,
    autoCheck: typeof patch.autoCheck === 'boolean' ? patch.autoCheck : settings.autoCheck,
  }
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(paths.settingsFile(userData), JSON.stringify(settings, null, 2))
  log.info(`settings saved: ${JSON.stringify(settings)}`)
  if (state.phase === 'ready') {
    state.message = '设置已保存，正在重启内核…'
    broadcast()
    try {
      await startBackend()
      state.phase = 'ready'
      state.message = '设置已生效'
      broadcast()
    } catch (err) {
      state.phase = 'error'
      state.message = `应用设置失败: ${(err as Error).message}`
      broadcast()
    }
  }
  return { ...settings }
})

ipcMain.handle('desktop:check-update', async () => {
  if (!state.kernelVersion) return { ok: false, message: '内核尚未就绪' }
  state.message = '正在检查更新…'
  broadcast()
  try {
    const check = await updater.check({
      settings,
      current: state.kernelVersion,
      onProgress: (pct: number, label: string) => sendProgress(pct, label),
    })
    state.latestVersion = check.latest
    state.updateAvailable = check.updateAvailable
    state.source = check.source
    state.message = check.updateAvailable
      ? `发现新内核 ${check.latest}`
      : `已是最新内核 (${check.current})`
    broadcast()
    return { ok: true, ...check }
  } catch (err) {
    state.message = `检查更新失败: ${(err as Error).message}`
    broadcast()
    return { ok: false, message: (err as Error).message }
  }
})

ipcMain.handle('desktop:apply-update', async () => {
  if (state.phase === 'updating') return { ok: false, message: '正在更新中' }
  if (!state.latestVersion || !state.updateAvailable) {
    return { ok: false, message: '没有可用的更新' }
  }
  state.phase = 'updating'
  state.message = '更新内核中…'
  broadcast()
  // Map updater stage strings to percentages on the telemetry bar.
  const stagePct = {
    'downloading & installing new kernel': 15,
    'verifying new kernel boots': 85,
  }
  let installTick = 0
  try {
    const res = await updater.apply({
      userData,
      settings,
      current: state.kernelVersion,
      nodeBin,
      npmCli,
      electronAsNode,
      onProgress: (m: string) => {
        state.message = m
        broadcast()
        const pct = (stagePct as Record<string, number>)[m]
        if (pct != null) {
          sendProgress(pct, m.slice(0, 32).toUpperCase())
        } else if (/installing kernel|npm install/.test(m)) {
          // npm output lines: creep from 20% toward the verify stage.
          installTick += 1
          sendProgress(Math.min(80, 20 + installTick), 'INSTALLING KERNEL')
        }
      },
    })
    if (res.updated) {
      state.kernelVersion = res.version
      state.latestVersion = res.version
      state.updateAvailable = false
      await startBackend()
      state.phase = 'ready'
      state.message = `内核已更新到 ${res.version}`
      sendProgress(100, 'UPDATE DONE')
    } else {
      state.phase = 'ready'
      state.message = `当前已是最新内核 (${res.version})`
      sendProgress(100, 'CHECK DONE')
    }
  } catch (err) {
    state.phase = 'ready'
    state.message = `更新失败: ${(err as Error).message}`
    log.error(`update failed: ${(err as Error).message}`)
    sendProgress(100, 'UPDATE FAILED')
  }
  broadcast()
  return { ok: true, phase: state.phase, message: state.message }
})

ipcMain.handle('desktop:restart-backend', async () => {
  if (state.phase !== 'ready' && state.phase !== 'error') return { ok: false, message: state.phase }
  state.message = '正在重启内核…'
  broadcast()
  try {
    await startBackend()
    state.phase = 'ready'
    state.message = '内核已重启'
    broadcast()
    return { ok: true }
  } catch (err) {
    state.phase = 'error'
    state.message = `重启失败: ${(err as Error).message}`
    broadcast()
    return { ok: false, message: (err as Error).message }
  }
})

ipcMain.handle('desktop:retry-boot', async () => {
  await boot()
  return { ok: state.phase !== 'error' }
})

// ---- lifecycle ----

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    userData = paths.userDataDir()
    fs.mkdirSync(userData, { recursive: true })
    log.init(userData)
    createWindow()
    // Total usage telemetry: load the persisted total, start counting this
    // session, and tick every 30s to keep the readout live + durable.
    loadUsage()
    sessionStartedAt = Date.now()
    startUsageTicker()
    // Title-bar window controls follow the OS color scheme in 'system' mode.
    nativeTheme.on('updated', () => {
      if (state.themePreference === 'system') applyTitleBarOverlay()
    })
    boot()
  })

  let quitting = false
  app.on('before-quit', (e: Electron.Event) => {
    // Final usage persist so the accumulated total survives the quit.
    persistUsage()
    stopUsageTicker()
    if (backend && backend.isRunning() && !quitting) {
      e.preventDefault()
      quitting = true
      state.phase = 'quitting'
      backend.stop().finally(() => app.quit())
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}

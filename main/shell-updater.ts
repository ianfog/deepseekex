'use strict'
/**
 * Shell (app) updater: self-update for the Electron shell itself, distinct
 * from the kernel updater (`updater.js` which swaps the dsh kernel). Uses
 * `electron-updater` against the GitHub Releases channel configured in
 * `package.json` `build.publish` (ianfog/deepseekex). The NSIS target emits
 * `latest.yml`; `autoUpdater` downloads the new installer and, on apply,
 * quits and installs (restarting the app automatically).
 *
 * Events are pushed to the chrome renderer through a callback so the top bar
 * can show shell-update availability and download progress.
 * @module deepseekex/shell-updater
 */

const log = require('./log.ts')

/** Snapshot pushed to the renderer through the `onState` callback. */
type ShellUpdateState = {
  available: boolean
  version: string | null
  downloading: boolean
  downloaded: boolean
  status: string
  message?: string
  progress?: number
}

/** Per-event fields merged into the base snapshot by `emit`. */
type ShellUpdatePatch = {
  status: string
  message?: string
  progress?: number
  version?: string
}

/**
 * Wrap autoUpdater and wire events. Safe in dev mode (no app-update.yml) and
 * when the package is not signed/published: every failure degrades to a
 * `{ ok:false }` check result instead of throwing.
 * @param {object} opts - `{ onState }`. `onState(update)` receives
 *   `{ available, version, progress, status, message }` snapshots.
 * @returns {{ check: () => Promise<object>, apply: () => Promise<object> }}
 */
function createShellUpdater({ onState = () => {} }: { onState?: (state: ShellUpdateState) => void }) {
  const { autoUpdater } = require('electron-updater')

  let latestVersion: string | null = null
  let available = false
  let downloading = false
  let downloaded = false

  const emit = (patch: ShellUpdatePatch) => onState({
    available,
    version: latestVersion,
    downloading,
    downloaded,
    ...patch,
  })

  autoUpdater.autoDownload = false // we prompt before downloading
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking', message: '正在检查壳更新…' }))
  autoUpdater.on('update-available', (info: { version: string }) => {
    latestVersion = info.version
    available = true
    emit({ status: 'available', message: `发现新版本 ${info.version}` })
  })
  autoUpdater.on('update-not-available', () => {
    emit({ status: 'up-to-date', message: '壳已是最新版本' })
  })
  autoUpdater.on('download-progress', (p: { percent: number }) => {
    emit({ status: 'downloading', progress: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    downloaded = true
    downloading = false
    emit({ status: 'downloaded', version: info.version, progress: 100 })
  })
  autoUpdater.on('error', (err: Error) => {
    log.warn(`shell updater error: ${err.message}`)
    emit({ status: 'error', message: err.message })
  })

  /** Check for a new shell version. Never throws. */
  async function check() {
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true, available, version: latestVersion }
    } catch (err: any) {
      log.warn(`shell update check failed: ${err.message}`)
      emit({ status: 'error', message: err.message })
      return { ok: false, available: false, message: err.message }
    }
  }

  /** Download (if needed) then quit-and-install. */
  async function apply() {
    try {
      if (!downloaded) {
        downloading = true
        emit({ status: 'downloading', progress: 0 })
        await autoUpdater.downloadUpdate()
      }
      emit({ status: 'installing', message: '正在安装并重启…' })
      autoUpdater.quitAndInstall(false, true)
      return { ok: true }
    } catch (err: any) {
      downloading = false
      log.warn(`shell update apply failed: ${err.message}`)
      emit({ status: 'error', message: err.message })
      return { ok: false, message: err.message }
    }
  }

  return { check, apply }
}

module.exports = { createShellUpdater }

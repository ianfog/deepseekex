'use strict'
/**
 * Path resolution for app data. Works identically under plain Node (smoke
 * tests) and inside Electron (GUI): the userData root is always
 * `<platform appData>/deepseekex`, unless `DSH_DESKTOP_USERDATA` overrides it.
 * @module deepseekex/paths
 */

const os = require('node:os')
const path = require('node:path')

/** Platform app-data root: %APPDATA% / ~/Library/Application Support / $XDG_CONFIG_HOME. */
function appDataRoot() {
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support')
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
}

/** The app's own data directory. */
function userDataDir() {
  if (process.env.DSH_DESKTOP_USERDATA) return path.resolve(process.env.DSH_DESKTOP_USERDATA)
  return path.join(appDataRoot(), 'deepseekex')
}

/** Versioned kernel roots: `<userData>/kernels/<version>/`. */
function kernelsDir(userData: string) {
  return path.join(userData, 'kernels')
}

/** The active-version pointer file. */
function activeFile(userData: string) {
  return path.join(kernelsDir(userData), 'active.json')
}

/** One kernel version's install directory. */
function kernelDir(userData: string, version: string) {
  return path.join(kernelsDir(userData), version)
}

/** The installed `@deepseek-ai/dsh` package root inside a kernel dir. */
function kernelDshDir(kernelRoot: string) {
  return path.join(kernelRoot, 'node_modules', '@deepseek-ai', 'dsh')
}

/** The npm CLI cache used by kernel installs. */
function npmCacheDir(userData: string) {
  return path.join(userData, 'npm-cache')
}

/** Root that holds the bootstrapped npm CLI: `<userData>/npm/<version>/node_modules/npm`. */
function npmDir(userData: string) {
  return path.join(userData, 'npm')
}

function mainLogFile(userData: string) {
  return path.join(userData, 'logs', 'main.log')
}

function settingsFile(userData: string) {
  return path.join(userData, 'settings.json')
}

/** Settings singleton, freshly read from disk. */
function readSettings(userData: string) {
  try {
    const raw = JSON.parse(require('node:fs').readFileSync(settingsFile(userData), 'utf8').replace(/^\uFEFF/, ''))
    return {
      dshHome: typeof raw.dshHome === 'string' ? raw.dshHome : '',
      npmRegistry: typeof raw.npmRegistry === 'string' ? raw.npmRegistry : '',
      autoCheck: raw.autoCheck !== false,
    }
  } catch {
    return { dshHome: '', npmRegistry: '', autoCheck: true }
  }
}

module.exports = {
  appDataRoot,
  userDataDir,
  kernelsDir,
  activeFile,
  kernelDir,
  kernelDshDir,
  npmCacheDir,
  npmDir,
  mainLogFile,
  settingsFile,
  readSettings,
}

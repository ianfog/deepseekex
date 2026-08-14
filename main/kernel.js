'use strict'
/**
 * Kernel manager: versioned dsh installs under `<userData>/kernels/<version>/`,
 * an atomic `active.json` pointer, install/verify/cleanup/rollback.
 * A "kernel" is a minimal package dir whose only dependency is
 * `@deepseek-ai/dsh` — npm resolves the whole web-app dependency chain
 * (including the built frontend dist) from the registry, which is the
 * official artifact channel of the upstream GitHub source.
 * @module deepseekex/kernel
 */

const fs = require('node:fs')
const path = require('node:path')
const semver = require('semver')
const { kernelsDir, activeFile, kernelDir, kernelDshDir, npmCacheDir } = require('./paths.js')
const { mirrorRegistry } = require('./npm.js')
const log = require('./log.js')

/** Read the active kernel version (null when unset/corrupt). */
function readActive(userData) {
  try {
    const v = JSON.parse(fs.readFileSync(activeFile(userData), 'utf8')).version
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

/** Atomically set the active kernel version (tmp file + rename). */
function setActive(userData, version) {
  const file = activeFile(userData)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ version }, null, 2))
  fs.renameSync(tmp, file)
}

/** Absolute kernel install dir for a version. */
function dirFor(userData, version) {
  return kernelDir(userData, version)
}

/** The `@deepseek-ai/dsh` version actually installed in a kernel dir. */
function installedVersion(kernelRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(kernelDshDir(kernelRoot), 'package.json'), 'utf8')).version
  } catch {
    return null
  }
}

/** Whether a kernel dir has a launchable dsh CLI. */
function isUsable(kernelRoot) {
  return fs.existsSync(path.join(kernelDshDir(kernelRoot), 'lib', 'bin.js'))
}

/** Semver-sorted list of installed kernel versions (ascending). */
function listInstalled(userData) {
  const root = kernelsDir(userData)
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && semver.valid(e.name))
    .map((e) => e.name)
    .sort(semver.compare)
}

/**
 * Install a kernel version from the registry (primary, then mirror on failure).
 * @returns {Promise<string>} the kernel dir.
 */
async function install(userData, version, { nodeBin, npmCli, electronAsNode, settings, onProgress = () => {} }) {
  const dir = dirFor(userData, version)
  if (isUsable(dir)) return dir
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'dsh-kernel', private: true, dependencies: { '@deepseek-ai/dsh': version } }, null, 2),
  )

  const registry = (settings.npmRegistry || 'https://registry.npmjs.org/').replace(/\/$/, '')
  const base = {
    npmCli,
    nodeBin,
    cwd: dir,
    cacheDir: npmCacheDir(userData),
    electronAsNode,
    onOutput: (line) => {
      log.info(`[npm ${version}] ${line}`)
      onProgress(`installing kernel ${version}: ${line}`)
    },
  }
  onProgress(`installing dsh kernel ${version} (npm install)`)
  try {
    await require('./npm.js').runNpmInstall({ ...base, registry })
  } catch (err) {
    if (registry !== mirrorRegistry().replace(/\/$/, '')) {
      onProgress('primary registry failed; retrying via npmmirror')
      log.warn(`kernel install via ${registry} failed (${err.message}); retrying via mirror`)
      await require('./npm.js').runNpmInstall({ ...base, registry: mirrorRegistry().replace(/\/$/, '') })
    } else {
      throw err
    }
  }

  if (!isUsable(dir)) {
    throw new Error(`kernel install finished but @deepseek-ai/dsh is missing in ${dir}`)
  }
  const got = installedVersion(dir)
  log.info(`kernel ${version} installed (dsh ${got}) at ${dir}`)
  return dir
}

/** Remove a kernel version's directory. */
function remove(userData, version) {
  fs.rmSync(dirFor(userData, version), { recursive: true, force: true })
}

/** Delete old versions beyond `keep` (active always kept). */
function cleanup(userData, keep = 3) {
  const active = readActive(userData)
  const versions = listInstalled(userData).filter((v) => v !== active).sort(semver.rcompare)
  for (const v of versions.slice(keep - 1)) {
    log.info(`cleaning up old kernel ${v}`)
    remove(userData, v)
  }
}

/**
 * Ensure an active, usable kernel exists; installs `latest` when needed.
 * @returns {Promise<string>} the active version.
 */
async function ensureActive(userData, { latest, nodeBin, npmCli, electronAsNode, settings, onProgress }) {
  const active = readActive(userData)
  if (active && isUsable(dirFor(userData, active))) return active
  if (!latest) throw new Error('no active kernel and no latest version to install')
  const dir = await install(userData, latest, { nodeBin, npmCli, electronAsNode, settings, onProgress })
  setActive(userData, installedVersion(dir) || latest)
  cleanup(userData, 3)
  return readActive(userData)
}

module.exports = {
  readActive,
  setActive,
  dirFor,
  installedVersion,
  isUsable,
  listInstalled,
  install,
  remove,
  cleanup,
  ensureActive,
}

'use strict'
/**
 * npm CLI bootstrap: downloads the npm tarball from the registry once,
 * extracts it into `<userData>/npm/<version>/node_modules/npm`, and runs
 * `npm install` for kernels with that CLI. npm is pure JS, so it runs under
 * any Node the app already has (Electron-as-Node in the GUI, plain Node in
 * smoke tests) — the app never depends on a system npm.
 * @module deepseekex/npm
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { npmDir, npmCacheDir } = require('./paths.js')
const { httpGetJson, download } = require('./net.js')
const { extractTgz } = require('./tar-extract.js')
const log = require('./log.js')

/** Fallback when the registry cannot answer `npm/latest`. */
const FALLBACK_NPM_VERSION = '11.6.2'
/** Secondary registry tried when the primary one fails. */
const MIRROR_REGISTRY = 'https://registry.npmmirror.com/'

/** The effective npm registry base URL (trailing slash). */
function registryBase(settings) {
  const r = (settings.npmRegistry || 'https://registry.npmjs.org/').trim()
  return r.endsWith('/') ? r : `${r}/`
}

/**
 * Ensure the npm CLI is available locally.
 * @param {string} userData - app data dir.
 * @param {object} settings - `{ npmRegistry }`.
 * @param {(msg: string) => void} onProgress
 * @returns {Promise<{ cli: string, version: string }>} npm-cli.js path and version.
 */
async function ensureNpmCli(userData, settings, onProgress = () => {}) {
  const registry = registryBase(settings)
  let version
  try {
    version = (await httpGetJson(`${registry}npm/latest`)).version
  } catch (err) {
    log.warn(`npm/latest unreachable (${err.message}); using fallback ${FALLBACK_NPM_VERSION}`)
    version = FALLBACK_NPM_VERSION
  }
  const cli = path.join(npmDir(userData), version, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (fs.existsSync(cli)) return { cli, version }

  const dir = path.join(npmDir(userData), version)
  const tgz = path.join(dir, `npm-${version}.tgz`)
  onProgress(`downloading npm CLI ${version}`)
  try {
    await download(`${registry}npm/-/npm-${version}.tgz`, tgz)
  } catch (err) {
    if (registry !== MIRROR_REGISTRY) {
      onProgress('primary registry unreachable; retrying via npmmirror')
      await download(`${MIRROR_REGISTRY}npm/-/npm-${version}.tgz`, tgz)
    } else {
      throw err
    }
  }

  const tmp = path.join(dir, `tmp-${version}`)
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  await extractTgz(tgz, tmp)
  // The extractor strips the tarball's single `package/` prefix, so the npm
  // CLI files land directly in tmp/ — expect bin/npm-cli.js there.
  if (!fs.existsSync(path.join(tmp, 'bin', 'npm-cli.js'))) {
    throw new Error(`npm tarball had no bin/npm-cli.js (${version})`)
  }
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true })
  fs.renameSync(tmp, path.join(dir, 'node_modules', 'npm'))
  fs.rmSync(tgz, { force: true })
  log.info(`npm CLI ${version} bootstrapped`)
  return { cli, version }
}

/**
 * Run `npm install` in a kernel dir.
 * @param {object} opts - `{ npmCli, nodeBin, cwd, registry, cacheDir, electronAsNode, onOutput }`.
 * @returns {Promise<void>} resolves when npm exits 0.
 */
async function runNpmInstall({ npmCli, nodeBin, cwd, registry, cacheDir, electronAsNode, onOutput = () => {} }) {
  return new Promise((resolve, reject) => {
    const args = [
      npmCli,
      'install',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      '--cache',
      cacheDir,
      '--registry',
      registry,
    ]
    const env = { ...process.env }
    if (electronAsNode) env.ELECTRON_RUN_AS_NODE = '1'
    const child = spawn(nodeBin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const onChunk = (chunk) => {
      output += chunk.toString()
      const line = chunk.toString().trim()
      if (line) onOutput(line)
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`npm install exited ${code ?? signal}\n${output.slice(-3000)}`))
    })
  })
}

/** The mirror registry constant, for kernel-install fallback. */
const mirrorRegistry = () => MIRROR_REGISTRY
module.exports = {
  registryBase,
  mirrorRegistry,
  ensureNpmCli,
  runNpmInstall,
}

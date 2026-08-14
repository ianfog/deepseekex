'use strict'
/**
 * Updater: discovers new kernel versions from the npm registry (the official
 * artifact channel of the upstream deepseek-ai/deepseek-harness GitHub
 * source), shows the upstream source commit for transparency, installs a new
 * kernel, boot-verifies it against a scratch backend, and atomically switches
 * the active version. Old versions are kept for rollback.
 * @module deepseekex/updater
 */

const semver = require('semver')
const path = require('node:path')
const { httpGetJson } = require('./net.js')
const kernel = require('./kernel.js')
const { Backend } = require('./backend.js')
const log = require('./log.js')

/** npm registry `latest` dist-tag of the dsh package. */
async function latestVersion(settings) {
  const registry = (settings.npmRegistry || 'https://registry.npmjs.org/').replace(/\/$/, '')
  const info = await httpGetJson(`${registry}/@deepseek-ai/dsh/latest`)
  if (typeof info.version !== 'string') throw new Error(`registry returned no version: ${JSON.stringify(info)}`)
  return info.version
}

/** Latest upstream commit of the GitHub source (best-effort; null when offline). */
async function githubSourceInfo() {
  try {
    const j = await httpGetJson('https://api.github.com/repos/deepseek-ai/deepseek-harness/commits/master')
    return { sha: j.sha.slice(0, 7), date: j.commit?.committer?.date || null }
  } catch (err) {
    log.warn(`github source info unavailable: ${err.message}`)
    return null
  }
}

/**
 * Compare current vs latest.
 * @param {object} opts - `{ settings, current, onProgress }`. `onProgress(pct, label)`
 *   fires at 0% (registry), 50% (upstream) and 100% (done).
 * @returns {Promise<{current: string, latest: string|null, updateAvailable: boolean, source: object|null}>}
 */
async function check({ settings, current, onProgress = () => {} }) {
  onProgress(0, 'QUERY REGISTRY')
  let latest = null
  try {
    latest = await latestVersion(settings)
  } catch (err) {
    log.warn(`update check failed: ${err.message}`)
  }
  onProgress(50, 'FETCH UPSTREAM')
  const source = await githubSourceInfo()
  onProgress(100, 'CHECK DONE')
  return {
    current,
    latest,
    updateAvailable: !!latest && !!current && semver.gt(latest, current),
    source,
  }
}

/**
 * Install the newest kernel, verify it boots, and switch the active version.
 * @returns {Promise<{updated: boolean, version: string}>}
 */
async function apply({ userData, settings, current, nodeBin, npmCli, electronAsNode, onProgress = () => {} }) {
  const latest = await latestVersion(settings)
  if (current && latest === current) return { updated: false, version: current }

  onProgress('downloading & installing new kernel')
  const dir = await kernel.install(userData, latest, {
    nodeBin,
    npmCli,
    electronAsNode,
    settings,
    onProgress,
  })

  // Boot-verify the new kernel on a scratch backend before switching. The
  // scratch DSH_HOME keeps the probe instance away from the live backend's
  // data; an empty home proves the kernel boots on its own.
  onProgress('verifying new kernel boots')
  const verify = new Backend({ nodeBin, electronAsNode })
  const scratchHome = path.join(userData, 'verify-home')
  try {
    await verify.start(dir, { dshHome: scratchHome, bootTimeoutMs: 120_000, probeTimeoutMs: 20_000 })
  } finally {
    await verify.stop().catch(() => {})
  }

  kernel.setActive(userData, latest)
  kernel.cleanup(userData, 3)
  log.info(`kernel switched ${current || '(none)'} -> ${latest}`)
  return { updated: true, version: latest }
}

module.exports = { latestVersion, githubSourceInfo, check, apply }

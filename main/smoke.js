'use strict'
/**
 * Headless end-to-end smoke test (no Electron GUI): boots the npm CLI, installs
 * the latest dsh kernel from the registry, starts the backend on a random port,
 * probes it, runs an update check, and reports. Uses an isolated userData dir
 * and an isolated DSH_HOME so it never touches the real app data or the
 * running dsh instance's home.
 *
 * Usage: node main/smoke.js
 * Env:   DSH_DESKTOP_USERDATA, DSH_DESKTOP_SMOKE_HOME, DSH_DESKTOP_NPM_REGISTRY
 */

const os = require('node:os')
const path = require('node:path')

const userData =
  process.env.DSH_DESKTOP_USERDATA || path.join(os.tmpdir(), 'deepseekex-smoke')
const smokeHome =
  process.env.DSH_DESKTOP_SMOKE_HOME || path.join(os.tmpdir(), 'deepseekex-smoke-dsh-home')

const paths = require('./paths.ts')
const log = require('./log.ts')
log.init(userData)
process.env.DSH_DESKTOP_USERDATA = userData

const npm = require('./npm.ts')
const kernel = require('./kernel.ts')
const updater = require('./updater.ts')
const { Backend } = require('./backend.ts')

async function main() {
  const settings = { npmRegistry: process.env.DSH_DESKTOP_NPM_REGISTRY || '', autoCheck: true }
  const nodeBin = process.execPath // plain Node for the smoke run

  log.info('=== smoke: ensure npm CLI ===')
  const npmCli = await npm.ensureNpmCli(userData, settings, (m) => log.info(`  ${m}`))

  log.info('=== smoke: resolve latest kernel ===')
  const latest = await updater.latestVersion(settings)
  log.info(`  latest dsh: ${latest}`)

  log.info('=== smoke: ensure active kernel ===')
  const active = await kernel.ensureActive(userData, {
    latest,
    nodeBin,
    npmCli: npmCli.cli,
    electronAsNode: false,
    settings,
    onProgress: (m) => log.info(`  ${m}`),
  })
  log.info(`  active kernel: ${active}`)

  log.info('=== smoke: start backend ===')
  const backend = new Backend({ nodeBin })
  const url = await backend.start(kernel.dirFor(userData, active), {
    dshHome: smokeHome,
    bootTimeoutMs: 120_000,
    probeTimeoutMs: 20_000,
  })
  log.info(`  backend URL: ${url}`)

  log.info('=== smoke: update check ===')
  const check = await updater.check({ settings, current: active })
  log.info(`  ${JSON.stringify(check)}`)

  log.info('=== smoke: source info ===')
  const source = await updater.githubSourceInfo()
  log.info(`  upstream: ${JSON.stringify(source)}`)

  log.info('=== smoke: stop backend ===')
  await backend.stop()

  log.info(`SMOKE PASS (kernel=${active}, url=${url})`)
}

main().catch((err) => {
  log.error(`SMOKE FAIL: ${err.stack || err}`)
  process.exitCode = 1
})

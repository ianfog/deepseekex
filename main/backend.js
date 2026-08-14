'use strict'
/**
 * Backend process manager: spawns the dsh kernel as a child process
 * (`<node> <kernel>/node_modules/@deepseek-ai/dsh/lib/bin.js web --port 0`),
 * parses the printed listen URL, probes the served SPA, and supports restart.
 * Under Electron the child runs as Electron-as-Node so no extra Node runtime
 * is bundled; under plain Node (smoke tests) it runs with the current node.
 * @module deepseekex/backend
 */

const { spawn } = require('node:child_process')
const path = require('node:path')
const log = require('./log.js')

/** The webserver prints its URL to stdout (web-runtime `printUrl: true`). */
const URL_RE = /(https?:\/\/127\.0\.0\.1:\d+)/

class Backend {
  /**
   * @param {object} opts - `{ nodeBin, electronAsNode, onExit }`. `onExit`
   *   receives `(code, signal)` when the child exits after startup settled.
   */
  constructor({ nodeBin, electronAsNode, onExit }) {
    this.nodeBin = nodeBin
    this.electronAsNode = !!electronAsNode
    this.onExit = onExit
    this.child = null
    this.url = null
    this.stdoutTail = ''
    this.stderrTail = ''
  }

  /**
   * Start the backend and wait until it is serving.
   * @param {string} kernelRoot - kernel install dir.
   * @param {object} [opts] - `{ port, dshHome, trustedHosts, bootTimeoutMs, probeTimeoutMs }`.
   * @returns {Promise<string>} the base URL (http://127.0.0.1:<port>).
   */
  start(kernelRoot, { port = 0, dshHome, trustedHosts = [], bootTimeoutMs = 90_000, probeTimeoutMs = 15_000 } = {}) {
    const bin = path.join(kernelRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    // `--expose-internals` lets the vendored Loader reach Node's internal ESM
    // loader for HMR. Plain Node usually covers this via the
    // node-addon-require-builtin addon, but that addon's ABI does not match
    // Electron's bundled Node, so the flag is the portable path on both.
    const args = ['--expose-internals', bin, 'web', '--port', String(port)]
    for (const host of trustedHosts) args.push('--trusted-host', host)
    const env = { ...process.env }
    if (this.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1'
    if (dshHome) env.DSH_HOME = dshHome
    this.url = null
    this.stdoutTail = ''
    this.stderrTail = ''

    log.info(`backend spawn: ${this.nodeBin} ${args.join(' ')}`)
    const child = spawn(this.nodeBin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child

    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error(`backend did not become ready in ${bootTimeoutMs}ms\nstdout: ${this.stdoutTail.slice(-2000)}\nstderr: ${this.stderrTail.slice(-2000)}`))
        }
      }, bootTimeoutMs)

      const onStdout = (chunk) => {
        const text = chunk.toString()
        this.stdoutTail += text
        if (this.stdoutTail.length > 64_000) this.stdoutTail = this.stdoutTail.slice(-64_000)
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) continue
          log.info(`[backend] ${line}`)
          const match = line.match(URL_RE)
          if (match && !settled) {
            settled = true
            clearTimeout(timer)
            const url = match[1]
            probe(url)
              .then(() => {
                this.url = url
                log.info(`backend ready at ${url}`)
                resolve(url)
              })
              .catch((err) => reject(err))
          }
        }
      }
      const onStderr = (chunk) => {
        this.stderrTail += chunk.toString()
        if (this.stderrTail.length > 64_000) this.stderrTail = this.stderrTail.slice(-64_000)
        for (const line of this.stderrTail.split(/\r?\n/)) {
          if (!line.trim()) continue
          log.info(`[backend:err] ${line}`)
          const match = line.match(URL_RE)
          if (match && !settled) {
            settled = true
            clearTimeout(timer)
            probe(match[1])
              .then(() => {
                this.url = match[1]
                log.info(`backend ready at ${match[1]}`)
                resolve(match[1])
              })
              .catch((err) => reject(err))
          }
        }
      }
      const onExit = (code, signal) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error(`backend exited early (code ${code}${signal ? `, ${signal}` : ''})\nstdout: ${this.stdoutTail.slice(-2000)}\nstderr: ${this.stderrTail.slice(-2000)}`))
        } else {
          log.warn(`backend exited (code ${code}${signal ? `, ${signal}` : ''})`)
          if (this.onExit) this.onExit(code, signal)
        }
      }
      child.stdout.on('data', onStdout)
      child.stderr.on('data', onStderr)
      child.on('exit', onExit)
      child.on('error', (err) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(err)
        }
      })

      /**
       * Poll the root route until the SPA is servable. In the full web
       * composition the frontend-static fallback answers every path, so
       * readiness means: HTTP 200 AND the served index.html carries the
       * injected `__DSH_BOOT__` graph (webserver up + frontend serving +
       * boot graph composed).
       */
      async function probe(url) {
        const deadline = Date.now() + probeTimeoutMs
        let lastErr = null
        while (Date.now() < deadline) {
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
            const body = await res.text()
            if (res.ok && body.includes('__DSH_BOOT__')) return
            lastErr = new Error(`root route responded ${res.status} without __DSH_BOOT__`)
          } catch (err) {
            lastErr = err
          }
          await new Promise((r) => setTimeout(r, 400))
        }
        throw lastErr || new Error(`readiness probe timed out after ${probeTimeoutMs}ms`)
      }
    })
  }

  /** The current base URL, when running. */
  getUrl() {
    return this.url
  }

  /** Whether the child process is still alive. */
  isRunning() {
    return !!this.child && this.child.exitCode === null && !this.child.killed
  }

  /** Ask the child to stop; SIGKILL after 5s. */
  async stop() {
    const child = this.child
    if (!child || child.exitCode !== null) return
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    const winner = await Promise.race([
      exited.then(() => 'exited'),
      new Promise((r) => setTimeout(() => r('timeout'), 5000)),
    ])
    if (winner === 'timeout' && child.exitCode === null) {
      log.warn('backend did not exit on SIGTERM; killing')
      child.kill('SIGKILL')
      await exited
    }
    this.child = null
  }
}

module.exports = { Backend }

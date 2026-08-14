'use strict'
/**
 * Minimal file logger: mirrors every line to stdout and appends to
 * `<userData>/logs/main.log`. Also keeps an in-memory tail for the UI.
 * @module deepseekex/log
 */

const fs = require('node:fs')
const path = require('node:path')
const { mainLogFile } = require('./paths.ts')

let logFile: string | null = null
const tail: string[] = []

/** Point the logger at a userData dir (idempotent; call once at boot). */
function init(userData: string) {
  logFile = mainLogFile(userData)
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
}

function write(level: string, msg: string) {
  const line = `${new Date().toISOString()} [${level}] ${msg}`
  // eslint-disable-next-line no-console
  console.log(line)
  tail.push(line)
  if (tail.length > 200) tail.splice(0, tail.length - 200)
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line + '\n')
    } catch {
      /* logging must never take the app down */
    }
  }
}

module.exports = {
  init,
  info: (m: string) => write('info', m),
  warn: (m: string) => write('warn', m),
  error: (m: string) => write('error', m),
  /** Recent log lines for the UI log panel. */
  tail: () => [...tail],
}

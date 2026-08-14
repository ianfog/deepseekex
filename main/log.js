'use strict'
/**
 * Minimal file logger: mirrors every line to stdout and appends to
 * `<userData>/logs/main.log`. Also keeps an in-memory tail for the UI.
 * @module deepseekex/log
 */

const fs = require('node:fs')
const path = require('node:path')
const { mainLogFile } = require('./paths.js')

let logFile = null
const tail = []

/** Point the logger at a userData dir (idempotent; call once at boot). */
function init(userData) {
  logFile = mainLogFile(userData)
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
}

function write(level, msg) {
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
  info: (m) => write('info', m),
  warn: (m) => write('warn', m),
  error: (m) => write('error', m),
  /** Recent log lines for the UI log panel. */
  tail: () => [...tail],
}

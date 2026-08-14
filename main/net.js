'use strict'
/**
 * Shared HTTP helpers built on the global fetch (Node >= 22 / Electron >= 43).
 * @module deepseekex/net
 */

const fs = require('node:fs')

/** GET a JSON document with a timeout. */
async function httpGetJson(url, { timeoutMs = 20_000, headers = {} } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'deepseekex/0.1.0', accept: 'application/json', ...headers },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Download a URL to a file, returning the byte count. */
async function download(url, dest, { timeoutMs = 300_000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'deepseekex/0.1.0' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    fs.mkdirSync(require('node:path').dirname(dest), { recursive: true })
    fs.writeFileSync(dest, buf)
    return buf.length
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { httpGetJson, download }

'use strict'
/**
 * Shared HTTP helpers built on the global fetch (Node >= 22 / Electron >= 43).
 * @module deepseekex/net
 */

const fs = require('node:fs')

/** GET a JSON document with a timeout. */
async function httpGetJson(url: string, { timeoutMs = 20_000, headers = {} }: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<any> {
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
async function download(
  url: string,
  dest: string,
  { timeoutMs = 300_000, onProgress }: { timeoutMs?: number; onProgress?: (pct: number) => void } = {},
): Promise<number> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'deepseekex/0.1.0' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    fs.mkdirSync(require('node:path').dirname(dest), { recursive: true })
    const file = fs.createWriteStream(dest)
    let received = 0
    try {
      // Node >= 22 web streams are async-iterable; write chunk-by-chunk so a
      // 120MB dmg never sits fully in memory and progress is reported.
      for await (const chunk of res.body as AsyncIterable<Buffer>) {
        received += chunk.length
        if (total && onProgress) onProgress(Math.min(100, Math.round((received / total) * 100)))
        if (!file.write(chunk)) await new Promise((r) => file.once('drain', r))
      }
      file.end()
      await new Promise<void>((resolve, reject) => {
        file.on('finish', resolve)
        file.on('error', reject)
      })
    } finally {
      file.destroy()
    }
    return received
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { httpGetJson, download }

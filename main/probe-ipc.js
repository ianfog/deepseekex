'use strict'
// Test the renderer IPC invokes directly.
const http = require('node:http')
const port = Number(process.argv[2] || 9222)

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (r) => {
      let d = ''
      r.on('data', (c) => (d += c))
      r.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

async function main() {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`)
  const chrome = targets.find((t) => t.type === 'page' && t.url.startsWith('file:'))
  if (!chrome) { console.log('no chrome'); return }
  const ws = new WebSocket(chrome.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const ev = (expression) =>
    new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1e9)
      const h = (m) => {
        const msg = JSON.parse(m.data)
        if (msg.id === id) { ws.removeEventListener('message', h); resolve(msg) }
      }
      ws.addEventListener('message', h)
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })

  for (const expr of [
    'window.deepseekex.getSettings()',
    'window.deepseekex.getState()',
  ]) {
    const r = await ev(`(async () => {
      try { return { ok: true, value: await ${expr} }; }
      catch (e) { return { ok: false, err: String(e) }; }
    })()`)
    console.log(expr.slice(0, 40), '=>', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails).slice(0, 200))
  }
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

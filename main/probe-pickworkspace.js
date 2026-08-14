'use strict'
// Trigger the shell workspace dialog via the preload bridge.
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
  console.log('calling pickWorkspace (dialog should appear; promise pending until closed)')
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression: 'window.deepseekex.pickWorkspace()', awaitPromise: true, returnByValue: true },
  }))
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id === 1) {
      console.log('resolved:', JSON.stringify(msg.result?.result?.value ?? msg.result?.exceptionDetails?.text))
      ws.close()
    }
  }
  // Keep the socket open; the dialog is modal so this pends until the user closes it.
  setTimeout(() => { ws.close(); }, 60000)
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

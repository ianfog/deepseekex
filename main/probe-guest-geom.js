'use strict'
// Deeper diagnostic on the webview guest geometry.
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
  const guest = targets.find((t) => (t.type === 'page' || t.type === 'webview') && /127\.0\.0\.1:\d+/.test(t.url))
  if (!guest) { console.log('no guest'); return }
  const ws = new WebSocket(guest.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const ev = (expression) =>
    new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1e9)
      const h = (m) => {
        const msg = JSON.parse(m.data)
        if (msg.id === id) { ws.removeEventListener('message', h); resolve(msg.result?.result?.value) }
      }
      ws.addEventListener('message', h)
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    })
  const r = await ev(`({
    innerW: window.innerWidth, innerH: window.innerHeight,
    outerW: window.outerWidth, outerH: window.outerHeight,
    screenX: window.screenX, screenY: window.screenY,
    docClientH: document.documentElement.clientHeight,
    docScrollH: document.documentElement.scrollHeight,
    bodyClientH: document.body.clientHeight,
    visualH: (window.visualViewport ? window.visualViewport.height : null),
    devicePixelRatio: window.devicePixelRatio,
    inIframe: window.self !== window.top
  })`)
  console.log(JSON.stringify(r, null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

'use strict'
// Empirically test whether the iframe 'load' event fires with listeners.
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
  const ws = new WebSocket(chrome.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const ev = (expression, awaitPromise = false) =>
    new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1e9)
      const h = (m) => {
        const msg = JSON.parse(m.data)
        if (msg.id === id) { ws.removeEventListener('message', h); resolve(msg.result?.result?.value) }
      }
      ws.addEventListener('message', h)
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise } }))
    })

  const before = await ev(`(() => {
    const iframe = document.getElementById('surface');
    window.__probeLoads = 0;
    iframe.addEventListener('load', () => { window.__probeLoads++; });
    return { src: iframe.src };
  })()`)
  console.log('listener attached, src:', JSON.stringify(before))

  await ev(`(async () => {
    const iframe = document.getElementById('surface');
    iframe.src = iframe.src; // reload
    await new Promise(r => setTimeout(r, 2500));
    return window.__probeLoads;
  })()`, true).then((n) => console.log('load events after reload:', n))

  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

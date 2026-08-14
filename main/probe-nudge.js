'use strict'
// Try a resize nudge on the webview element and see if the guest viewport follows.
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

async function cdp(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const result = await new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9)
    const h = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id === id) { ws.removeEventListener('message', h); resolve(msg.result?.result?.value) }
    }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
  ws.close()
  return result
}

async function main() {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`)
  const chrome = targets.find((t) => t.type === 'page' && t.url.startsWith('file:'))
  const guest = targets.find((t) => (t.type === 'page' || t.type === 'webview') && /127\.0\.0\.1:\d+/.test(t.url))
  if (!chrome || !guest) { console.log('missing targets'); return }

  const before = await cdp(guest, `({ innerW: window.innerWidth, innerH: window.innerHeight, outerH: window.outerHeight })`)
  console.log('before:', JSON.stringify(before))

  // Nudge 1: force element reflow by toggling height.
  await cdp(chrome, `(() => {
    const wv = document.getElementById('surface');
    wv.style.height = (wv.getBoundingClientRect().height - 1) + 'px';
    return new Promise(r => setTimeout(() => { wv.style.height = ''; setTimeout(r, 600); }, 50));
  })()`)
  const afterNudge1 = await cdp(guest, `({ innerW: window.innerWidth, innerH: window.innerHeight })`)
  console.log('after height nudge:', JSON.stringify(afterNudge1))

  // Nudge 2: reload the guest.
  if (afterNudge1.innerH < 700) {
    await cdp(chrome, `(() => {
      const wv = document.getElementById('surface');
      return new Promise(r => { wv.reload(); setTimeout(r, 2500); });
    })()`)
    const afterReload = await cdp(guest, `({ innerW: window.innerWidth, innerH: window.innerHeight })`)
    console.log('after reload:', JSON.stringify(afterReload))
  }
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

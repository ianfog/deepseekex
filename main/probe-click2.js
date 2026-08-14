'use strict'
// Precise: count real clicks on settingsBtn, then inspect.
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

async function cdp(target, method, params) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const result = await new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9)
    const h = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id === id) { ws.removeEventListener('message', h); resolve(msg.result) }
    }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id, method, params }))
  })
  ws.close()
  return result
}

async function main() {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`)
  const chrome = targets.find((t) => t.type === 'page' && t.url.startsWith('file:'))
  if (!chrome) { console.log('no chrome'); return }

  await cdp(chrome, 'Runtime.evaluate', {
    expression: `(() => {
      const btn = document.getElementById('settingsBtn');
      window.__btnClicks = 0;
      btn.addEventListener('click', () => { window.__btnClicks++; });
      const r = btn.getBoundingClientRect();
      return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2), rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    })()`,
    returnByValue: true,
  }).then((v) => (console.log('target:', JSON.stringify(v?.result?.value))))

  // Use the exact coordinates from the previous step via re-query
  const info = await cdp(chrome, 'Runtime.evaluate', {
    expression: `(() => { const r = document.getElementById('settingsBtn').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    returnByValue: true,
  })
  const { x, y } = info?.result?.value || { x: 1179, y: 24 }
  console.log('clicking at', Math.round(x), Math.round(y))

  await cdp(chrome, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await cdp(chrome, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp(chrome, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await new Promise((r) => setTimeout(r, 700))

  const st = await cdp(chrome, 'Runtime.evaluate', {
    expression: `({ clicks: window.__btnClicks, dialogOpen: document.getElementById('settingsDialog').open, activeEl: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null })`,
    returnByValue: true,
  })
  console.log('result:', JSON.stringify(st?.result?.value))
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

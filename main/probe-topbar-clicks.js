'use strict'
// Real-input click test on the topbar buttons (settings/logs/update).
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

  const info = await cdp(chrome, 'Runtime.evaluate', {
    expression: `(() => {
      const els = {};
      for (const id of ['settingsBtn', 'logsBtn', 'updateBtn']) {
        const el = document.getElementById(id);
        if (!el) { els[id] = { missing: true }; continue; }
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        els[id] = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, appRegion: cs.webkitAppRegion, hidden: el.hidden, pointerEvents: cs.pointerEvents };
      }
      return els;
    })()`,
    returnByValue: true,
  })
  console.log('buttons:', JSON.stringify(info?.result?.value, null, 1))

  // Real click on settings
  const s = info?.result?.value?.settingsBtn
  if (s && s.display !== 'none') {
    await cdp(chrome, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y })
    await cdp(chrome, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1 })
    await cdp(chrome, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1 })
    await new Promise((r) => setTimeout(r, 600))
    const st = await cdp(chrome, 'Runtime.evaluate', { expression: `document.getElementById('settingsDialog').open`, returnByValue: true })
    console.log('settings dialog open after REAL click:', st?.result?.value)
  }
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

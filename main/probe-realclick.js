'use strict'
// Real-mouse click (CDP Input) on the workspace row, then scan for native dialog.
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
  const frame = targets.find((t) => t.type === 'iframe' && /127\.0\.0\.1:\d+/.test(t.url))
  if (!frame) { console.log('no iframe'); return }

  const pos = await cdp(frame, 'Runtime.evaluate', {
    expression: `(() => {
      const candidates = [...document.querySelectorAll('button, [role="button"], [class*="workspace"]')]
        .filter((el) => el.getBoundingClientRect().width > 0 && /IdeaProjects|选择工作区|工作区/.test(el.textContent || ''));
      const el = candidates.find((x) => x.tagName === 'BUTTON') || candidates[0];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (el.textContent || '').trim().slice(0, 16), cls: (typeof el.className === 'string' ? el.className : '').split(' ').slice(0, 2).join(' ') };
    })()`,
    returnByValue: true,
  })
  const info = pos?.result?.value
  console.log('target:', JSON.stringify(info))
  if (!info) return

  await cdp(frame, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.x, y: info.y })
  await cdp(frame, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 })
  await cdp(frame, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 })
  console.log('real click dispatched at', info.x, info.y)
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

'use strict'
// Click the workspace selector and observe what happens.
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
  const frame = targets.find((t) => t.type === 'iframe' && /127\.0\.0\.1:\d+/.test(t.url))
  if (!frame) { console.log('no iframe; targets:', targets.map((t) => t.type + ' ' + t.url)); return }
  const ws = new WebSocket(frame.webSocketDebuggerUrl)
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

  // Attach console capture
  const errors = []
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data)
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('EXC: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text))
    }
  })
  ws.send(JSON.stringify({ id: 999, method: 'Runtime.enable' }))

  const before = await ev(`(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('选择工作区') || b.textContent.includes('工作区'));
    return btns.map(b => ({ cls: b.className, text: b.textContent.trim().slice(0, 20), rect: (() => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(), pointer: getComputedStyle(b).pointerEvents, z: getComputedStyle(b).zIndex, clip: getComputedStyle(b).clipPath, parentOverflow: getComputedStyle(b.parentElement).overflow }));
  })()`)
  console.log('workspace buttons:', JSON.stringify(before, null, 1))

  const after = await ev(`(async () => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('工作区'));
    if (!btns.length) return { clicked: false };
    const btn = btns[0];
    // what's at the button center? (any overlay covering it?)
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    btn.click();
    await new Promise(res => setTimeout(res, 1200));
    const modals = [...document.querySelectorAll('[role="dialog"], [class*="dialog"], [class*="modal"], [class*="overlay"], [class*="picker"], [class*="browse"]')].filter(el => el.getBoundingClientRect().width > 50).map(el => (el.className || el.tagName).toString().slice(0, 60));
    return { clicked: true, hitIsBtn: hit === btn, hitTag: hit ? hit.tagName : null, hitCls: hit ? (typeof hit.className === 'string' ? hit.className.slice(0, 50) : '') : null, modals };
  })()`, true)
  console.log('after click:', JSON.stringify(after, null, 1))
  console.log('console errors:', JSON.stringify(errors.slice(0, 8)))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

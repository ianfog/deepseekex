'use strict'
// Manually run the patch script inside the iframe to surface the real error.
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
  if (!frame) { console.log('no iframe'); return }
  const ws = new WebSocket(frame.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const ev = (expression) =>
    new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1e9)
      const h = (m) => {
        const msg = JSON.parse(m.data)
        if (msg.id === id) { ws.removeEventListener('message', h); resolve(msg) }
      }
      ws.addEventListener('message', h)
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    })

  const t1 = await ev('({ hasBody: !!document.body, hasHead: !!document.head, hasHtml: !!document.documentElement, dark: document.body ? document.body.hasAttribute("data-ds-dark-theme") : null })')
  console.log('state:', JSON.stringify(t1.result?.result?.value ?? t1.result?.exceptionDetails ?? t1.error))

  const script = `(() => { if (true) { document.body.toggleAttribute('data-ds-dark-theme', true); document.documentElement.style.colorScheme = 'dark'; } return true; })()
(() => { const id = '__dsh_patch__'; let s = document.getElementById(id); if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s); } s.textContent = 'body{}'; return true; })()`
  const t2 = await ev(script)
  console.log('run:', JSON.stringify(t2.result ?? t2.result?.exceptionDetails ?? t2).slice(0, 500))

  const t3 = await ev('({ patch: !!document.getElementById("__dsh_patch__"), dark: document.body.hasAttribute("data-ds-dark-theme") })')
  console.log('after:', JSON.stringify(t3.result?.result?.value))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

'use strict'
// Real click while capturing renderer exceptions and console errors.
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

  const issues = []
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data)
    if (msg.method === 'Runtime.exceptionThrown') {
      issues.push('EXC: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 400))
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      issues.push('ERR: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300))
    }
  })
  ws.send(JSON.stringify({ id: 990, method: 'Runtime.enable' }))
  await new Promise((r) => setTimeout(r, 300))

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

  const pos = await ev(`(() => { const r = document.getElementById('settingsBtn').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`)
  const { x, y } = pos || { x: 1179, y: 23 }
  ws.send(JSON.stringify({ id: 1, method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x, y } }))
  ws.send(JSON.stringify({ id: 2, method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x, y, button: 'left', clickCount: 1 } }))
  ws.send(JSON.stringify({ id: 3, method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 } }))
  await new Promise((r) => setTimeout(r, 1000))

  const st = await ev(`({ dialogOpen: document.getElementById('settingsDialog').open })`)
  console.log('dialogOpen:', st)
  console.log('issues:', JSON.stringify(issues.slice(0, 5), null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

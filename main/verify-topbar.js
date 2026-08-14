'use strict'
// Verify topbar readout values and structure.
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
    kernel: document.getElementById('kernelChip').textContent,
    source: document.getElementById('sourceChip').textContent,
    phase: document.getElementById('phaseChip').textContent,
    emblem: !!document.querySelector('.emblem'),
    cells: document.querySelectorAll('.cell').length,
    idxs: document.querySelectorAll('.idx').length,
    rail: getComputedStyle(document.getElementById('topbar'), '::after').backgroundImage.slice(0, 30),
    grid: getComputedStyle(document.getElementById('topbar')).backgroundImage.includes('linear-gradient'),
    readoutVisible: document.querySelector('.readout').getBoundingClientRect().width > 0
  })`)
  console.log(JSON.stringify(r, null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

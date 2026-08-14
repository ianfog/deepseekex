'use strict'
// Verify skin/theme injection in the running app via CDP.
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
  const page = targets.find((t) => ['page', 'webview', 'iframe'].includes(t.type) && /127\.0\.0\.1:\d+/.test(t.url))
  if (!page) { console.log('no surface page; targets:', targets.map((t) => t.url)); return }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
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
  const result = await ev(`({
    rootBrand: getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-brand-primary').trim(),
    bodyBrand: getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary').trim(),
    bodySidebar: getComputedStyle(document.body).getPropertyValue('--dsw-specific-sidebar-fill').trim(),
    darkAttr: document.body.hasAttribute('data-ds-dark-theme'),
    colorScheme: document.documentElement.style.colorScheme
  })`)
  console.log('surface tokens:', JSON.stringify(result))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

'use strict'
/**
 * CDP probe: connect to the running app's remote debugging port and report the
 * dsh surface page's actual viewport vs the window content size. Run with:
 *   node main/probe-viewport.js [port]
 */
const http = require('node:http')

const port = Number(process.argv[2] || 9222)

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (err) {
            reject(err)
          }
        })
      })
      .on('error', reject)
  })
}

async function main() {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`)
  const page = targets.find((t) => ['page', 'webview', 'iframe'].includes(t.type) && /127\.0\.0\.1:\d+/.test(t.url))
  if (!page) {
    console.log('no dsh surface page target found; targets:')
    for (const t of targets) console.log(`  ${t.type} ${t.url}`)
    return
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const evaluate = (expression) =>
    new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1e9)
      const onMessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.id === id) {
          ws.removeEventListener('message', onMessage)
          resolve(msg.result?.result?.value ?? msg.result?.result?.description ?? msg)
        }
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    })
  const viewport = await evaluate('({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio, bodyW: document.body ? document.body.scrollWidth : 0, bodyH: document.body ? document.body.scrollHeight : 0 })')
  const url = await evaluate('location.href')
  console.log('surface page:', JSON.stringify(url))
  console.log('viewport:', JSON.stringify(viewport))
  ws.close()
}

main().catch((err) => {
  console.error('probe failed:', err.message)
  process.exitCode = 1
})

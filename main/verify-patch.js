'use strict'
// Verify the UI patch layer is applied in the dsh iframe document.
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
  const r = await ev(`(() => {
    const style = document.getElementById('__dsh_patch__');
    const body = document.body;
    return {
      patchPresent: !!style,
      patchLen: style ? style.textContent.length : 0,
      patchHead: style ? style.textContent.slice(0, 60) : null,
      dark: body.hasAttribute('data-ds-dark-theme'),
      bgBase: getComputedStyle(body).getPropertyValue('--dsw-alias-bg-base').trim(),
      brand: getComputedStyle(body).getPropertyValue('--dsw-alias-brand-primary').trim(),
      sidebar: getComputedStyle(body).getPropertyValue('--dsw-specific-sidebar-fill').trim(),
      borderL2: getComputedStyle(body).getPropertyValue('--dsw-alias-border-l2').trim()
    };
  })()`)
  console.log(JSON.stringify(r, null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

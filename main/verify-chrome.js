'use strict'
// Verify the Endfield-styled chrome: tokens, motif classes, no theme UI left.
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
  if (!chrome) { console.log('no chrome page'); return }
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
  const r = await ev(`(() => {
    const cs = (el) => el ? getComputedStyle(el) : null;
    const topbar = document.getElementById('topbar');
    const btn = document.querySelector('.btn');
    const dialog = document.getElementById('settingsDialog');
    return {
      topbarBg: cs(topbar)?.backgroundColor,
      rail: cs(topbar, '::after')?.height,
      hasSkinBtn: !!document.getElementById('skinBtn'),
      hasSkinMenu: !!document.getElementById('skinMenu'),
      hasSkinSelect: !!document.getElementById('setSkin'),
      hasThemeSelect: !!document.getElementById('setTheme'),
      kernelChip: document.getElementById('kernelChip')?.textContent,
      kicker: document.querySelector('.kicker')?.textContent,
      btnClipPath: cs(btn)?.clipPath,
      btnRadius: cs(btn)?.borderRadius,
      btnFocusOutline: cs(btn)?.outlineColor === 'rgb(255, 250, 0)' ? 'signal' : cs(btn)?.outlineColor,
      dialogBeforeBg: cs(dialog, '::before')?.backgroundColor,
      bodyBg: cs(document.body)?.backgroundColor,
      bodyFont: cs(document.body)?.fontFamily.slice(0, 40)
    };
  })()`)
  console.log(JSON.stringify(r, null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

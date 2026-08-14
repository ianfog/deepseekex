'use strict'
// Verify: (1) the theme menu floats above the dsh iframe (elementFromPoint),
// (2) the starry wallpaper overlay is present in the iframe document.
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

async function cdp(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const result = await new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9)
    const h = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id === id) { ws.removeEventListener('message', h); resolve(msg.result?.result?.value) }
    }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
  ws.close()
  return result
}

async function main() {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`)
  const chrome = targets.find((t) => t.type === 'page' && t.url.startsWith('file:'))
  const iframe = targets.find((t) => t.type === 'iframe' && /127\.0\.0\.1:\d+/.test(t.url))
  if (!chrome || !iframe) { console.log('missing targets', targets.map((t) => t.type + ' ' + t.url)); return }

  const menuCheck = await cdp(chrome, `(async () => {
    const btn = document.getElementById('skinBtn');
    const btnRect = btn.getBoundingClientRect();
    btn.click();
    await new Promise(r => setTimeout(r, 250));
    const menu = document.getElementById('skinMenu');
    const items = [...menu.querySelectorAll('button')];
    const first = items[0];
    const fr = first.getBoundingClientRect();
    const hit = document.elementFromPoint(fr.x + fr.width / 2, fr.y + fr.height / 2);
    const iframeEl = document.getElementById('surface');
    return {
      menuOpen: !menu.hidden,
      itemCount: items.length,
      hitIsMenuItem: hit === first,
      hitIsIframe: hit === iframeEl,
      hitTag: hit ? hit.tagName : null,
      menuRect: { x: Math.round(fr.x), y: Math.round(fr.y) },
      btnRect: { x: Math.round(btnRect.x), y: Math.round(btnRect.y) }
    };
  })()`)
  console.log('menu over iframe:', JSON.stringify(menuCheck))

  const wallpaper = await cdp(iframe, `(() => {
    const after = getComputedStyle(document.body, '::after');
    const sidebar = document.querySelector('[class*="sidebarCol"]');
    const sidebarBg = sidebar ? getComputedStyle(sidebar).backgroundImage : null;
    return {
      hasOverlay: after && after.backgroundImage.includes('data:image/svg'),
      overlayZ: after ? after.zIndex : null,
      sidebarHasImage: !!sidebarBg && sidebarBg.includes('data:image/svg'),
      sidebarImageHead: sidebarBg ? sidebarBg.slice(0, 60) : null
    };
  })()`)
  console.log('wallpaper:', JSON.stringify(wallpaper))
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

'use strict'
// Verify the skin quick-switch menu: click the skin button, switch skin to
// 'ocean' via the menu, and confirm the dsh page tokens + chrome accent change.
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
  const surface = targets.find((t) => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url))
  const cdp = async (page, expression) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl)
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

  const menuState = await cdp(chrome, `(async () => {
    const btn = document.getElementById('skinBtn');
    btn.click();
    await new Promise(r => setTimeout(r, 300));
    const menu = document.getElementById('skinMenu');
    const items = [...menu.querySelectorAll('button')].map(b => b.textContent.trim() + (b.getAttribute('aria-checked') === 'true' ? '*' : ''));
    return { menuOpen: !menu.hidden, items };
  })()`)
  console.log('menu:', JSON.stringify(menuState))

  const switchResult = await cdp(chrome, `(async () => {
    const menu = document.getElementById('skinMenu');
    const ocean = [...menu.querySelectorAll('button')].find(b => b.textContent.includes('海洋'));
    if (!ocean) return { ok: false, reason: 'no ocean item' };
    ocean.click();
    await new Promise(r => setTimeout(r, 2500));
    return { ok: true, saved: await window.deepseekex.getSettings() };
  })()`)
  console.log('switch:', JSON.stringify(switchResult))

  const surfaceTokens = await cdp(surface, `({
    brand: getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary').trim(),
    darkAttr: document.body.hasAttribute('data-ds-dark-theme')
  })`)
  console.log('surface after switch:', JSON.stringify(surfaceTokens))

  const chromeAccent = await cdp(chrome, `getComputedStyle(document.documentElement).getPropertyValue('--skin-accent').trim()`)
  console.log('chrome accent after switch:', chromeAccent)
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

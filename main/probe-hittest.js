'use strict'
// elementFromPoint at the topbar button coordinates.
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
  const r = await ev(`(() => {
    const btn = document.getElementById('settingsBtn');
    const r = btn.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    // Walk up from the button to see stacking/overlap
    const chain = [];
    let el = hit;
    while (el && chain.length < 6) {
      chain.push({ tag: el.tagName, id: el.id || null, cls: (typeof el.className === 'string' ? el.className : '').split(' ').slice(0, 2).join(' ') || null, region: getComputedStyle(el).webkitAppRegion });
      el = el.parentElement;
    }
    // Is anything with a higher z-index / overlay present?
    const overlays = [...document.querySelectorAll('body > *')].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.position !== 'static' && (parseInt(cs.zIndex) || 0) > 0;
    }).map((el) => ({ tag: el.tagName, id: el.id || null, z: getComputedStyle(el).zIndex, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y) }));
    return { btnRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, hit: hit ? { tag: hit.tagName, id: hit.id || null, cls: (typeof hit.className === 'string' ? hit.className : '').split(' ').slice(0, 2).join(' ') || null } : null, chain, overlays };
  })()`)
  console.log(JSON.stringify(r, null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

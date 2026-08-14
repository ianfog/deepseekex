'use strict'
// Test re-attach and explicit-pixel approaches for webview guest sizing.
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

async function cdp(target, expression, awaitPromise = true) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const result = await new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9)
    const h = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id === id) { ws.removeEventListener('message', h); resolve(msg.result?.result?.value) }
    }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise } }))
  })
  ws.close()
  return result
}

async function main() {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`)
  const chrome = targets.find((t) => t.type === 'page' && t.url.startsWith('file:'))

  // Approach A: re-append the webview element (fresh attach at current size).
  await cdp(chrome, `(async () => {
    const wv = document.getElementById('surface');
    const stage = document.getElementById('stage');
    stage.removeChild(wv);
    wv.removeAttribute('src');
    stage.appendChild(wv);
    wv.classList.add('visible');
    await new Promise(r => setTimeout(r, 1500));
    wv.src = wv.src; // no-op guard
    await new Promise(r => setTimeout(r, 1500));
    return { elH: Math.round(wv.getBoundingClientRect().height) };
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
  let targets2 = await getJson(`http://127.0.0.1:${port}/json/list`)
  let guest = targets2.find((t) => (t.type === 'page' || t.type === 'webview') && /127\.0\.0\.1:\d+/.test(t.url))
  let vp = guest ? await cdp(guest, `({ innerW: window.innerWidth, innerH: window.innerHeight })`) : null
  console.log('after re-append:', JSON.stringify(vp))

  // Approach B: explicit pixel width/height on the element.
  if (vp && vp.innerH < 700) {
    await cdp(chrome, `(async () => {
      const wv = document.getElementById('surface');
      const rect = wv.getBoundingClientRect();
      wv.style.width = rect.width + 'px';
      wv.style.height = rect.height + 'px';
      await new Promise(r => setTimeout(r, 800));
      wv.style.width = '';
      wv.style.height = '';
      await new Promise(r => setTimeout(r, 800));
      return true;
    })()`)
    targets2 = await getJson(`http://127.0.0.1:${port}/json/list`)
    guest = targets2.find((t) => (t.type === 'page' || t.type === 'webview') && /127\.0\.0\.1:\d+/.test(t.url))
    vp = guest ? await cdp(guest, `({ innerW: window.innerWidth, innerH: window.innerHeight })`) : null
    console.log('after explicit px:', JSON.stringify(vp))
  }
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

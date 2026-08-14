'use strict'
// Broad probe: page state + any element mentioning 工作区.
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
  const r = await ev(`(() => {
    const hits = [];
    for (const el of document.querySelectorAll('*')) {
      const t = (el.textContent || '').trim();
      if (t && t.length < 40 && t.includes('工作区')) {
        hits.push({ tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').split(' ').slice(0, 2).join(' '), text: t.slice(0, 30), visible: el.getBoundingClientRect().width > 0 });
      }
    }
    const allBtns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim().slice(0, 12)).filter(Boolean);
    return {
      url: location.href,
      bodyText: document.body.innerText.slice(0, 200),
      hits: hits.slice(0, 12),
      visibleButtons: allBtns.slice(0, 15),
      rootChildren: [...document.getElementById('root').children].map(c => c.tagName + (typeof c.className === 'string' ? '.' + c.className.split(' ')[0] : ''))
    };
  })()`)
  console.log(JSON.stringify(r, null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

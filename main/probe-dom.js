'use strict'
// Inspect the dsh UI DOM to find real selectors for theme CSS.
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
  const page = targets.find((t) => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url))
  if (!page) { console.log('no surface page'); return }
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
  const r = await ev(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const c = el.className;
      if (typeof c === 'string' && /sidebar|conversation|composer|message|input|layout|shell|scroll/i.test(c)) {
        const cls = c.split(' ').filter(Boolean).slice(0, 6).join(' ');
        out.push({ tag: el.tagName.toLowerCase(), cls });
      }
      if (out.length >= 25) break;
    }
    const rootKids = [...document.getElementById('root').children].map((c) =>
      c.tagName.toLowerCase() + (typeof c.className === 'string' ? '.' + c.className.split(' ')[0] : ''));
    return { rootKids, sample: out };
  })()`)
  console.log(JSON.stringify(r, null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

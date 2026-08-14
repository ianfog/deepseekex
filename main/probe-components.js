'use strict'
// Inspect dsh UI buttons, headings, and body text styles for the patch.
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
  if (!frame) { console.log('no iframe; targets:', targets.map((t) => t.type)); return }
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
    const out = { buttons: [], headings: [], bodyFont: null };
    out.bodyFont = getComputedStyle(document.body).fontFamily;
    let i = 0;
    for (const b of document.querySelectorAll('button')) {
      if (i >= 10) break;
      const cs = getComputedStyle(b);
      const rect = b.getBoundingClientRect();
      if (rect.width < 8) continue;
      out.buttons.push({
        cls: (typeof b.className === 'string' ? b.className : '').split(' ').slice(0, 3).join(' '),
        text: (b.textContent || '').trim().slice(0, 16),
        radius: cs.borderRadius,
        bg: cs.backgroundColor,
        color: cs.color,
        font: cs.fontFamily.split(',')[0],
        fontWeight: cs.fontWeight,
        fontSize: cs.fontSize,
        w: Math.round(rect.width), h: Math.round(rect.height)
      });
      i++;
    }
    let j = 0;
    for (const h of document.querySelectorAll('h1,h2,h3,h4,[class*="title"]')) {
      if (j >= 6) break;
      const cs = getComputedStyle(h);
      if (!h.textContent.trim()) continue;
      out.headings.push({ tag: h.tagName, cls: (typeof h.className === 'string' ? h.className : '').split(' ')[0], text: h.textContent.trim().slice(0, 20), font: cs.fontFamily.split(',')[0], size: cs.fontSize, weight: cs.fontWeight, ls: cs.letterSpacing });
      j++;
    }
    return out;
  })()`)
  console.log(JSON.stringify(r, null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

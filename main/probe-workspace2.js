'use strict'
// Click the workspace row (whatever label) and inspect the picker result.
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
  if (!frame) { console.log('no iframe'); return }
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
  const r = await ev(`(async () => {
    const candidates = [...document.querySelectorAll('button, [role="button"], [class*="workspace"], [class*="sectionLabel"]')]
      .filter((el) => el.getBoundingClientRect().width > 0 && /工作区|IdeaProjects|选择/.test(el.textContent || ''));
    const target = candidates.find((el) => el.tagName === 'BUTTON') || candidates[0];
    if (!target) return { clicked: false };
    target.click();
    await new Promise((res) => setTimeout(res, 1600));
    const overlay = [...document.querySelectorAll('[class*="overlayLayer"], [class*="picker"], [class*="dialog"]')]
      .filter((el) => el.getBoundingClientRect().width > 50).pop();
    let overlayInfo = null;
    if (overlay) {
      const items = [...overlay.querySelectorAll('*')]
        .filter((el) => (el.textContent || '').trim() && (el.textContent || '').trim().length < 80)
        .slice(0, 10)
        .map((el) => ({ tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').split(' ').slice(0, 2).join(' '), text: el.textContent.trim().slice(0, 40) }));
      overlayInfo = { w: Math.round(overlay.getBoundingClientRect().width), h: Math.round(overlay.getBoundingClientRect().height), items };
    }
    return { clicked: true, hitLabel: (target.textContent || '').trim().slice(0, 20), overlayOpen: !!overlay, overlayInfo };
  })()`, true)
  console.log(JSON.stringify(r, null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

'use strict'
// Hook fetch in the dsh iframe, click the workspace row, and log API responses.
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
    window.__apiCalls = [];
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0].url;
      const method = (args[1] && args[1].method) || 'GET';
      let body = null;
      try { body = args[1] && args[1].body ? String(args[1].body).slice(0, 300) : null; } catch {}
      const res = await origFetch(...args);
      if (url.includes('/api')) {
        let text = '';
        try { text = await res.clone().text(); } catch {}
        window.__apiCalls.push({ url: url.slice(0, 120), method, status: res.status, resp: text.slice(0, 300) });
      }
      return res;
    };
    const rows = [...document.querySelectorAll('button')].filter((b) => /IdeaProjects|选择工作区|工作区/.test(b.textContent || ''));
    if (rows.length) { rows[0].click(); }
    await new Promise((res) => setTimeout(res, 2500));
    const overlay = [...document.querySelectorAll('[class*="overlayLayer"]')].filter((el) => el.getBoundingClientRect().width > 50).pop();
    return {
      overlayHasContent: overlay ? overlay.querySelectorAll('*').length : 0,
      apiCalls: window.__apiCalls.slice(0, 10)
    };
  })()`, true)
  console.log(JSON.stringify(r, null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

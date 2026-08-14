'use strict'
// Deep-inspect the picker overlay: structure, error states, and client console.
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
  const errors = []
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data)
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('EXC: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 300))
    }
  })
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
  await ev('true', true).catch(() => {}) // handshake
  ws.send(JSON.stringify({ id: 900, method: 'Runtime.enable' }))
  await new Promise((r) => setTimeout(r, 200))

  const r = await ev(`(async () => {
    // Ensure overlay is open
    const rows = [...document.querySelectorAll('button')].filter((b) => /IdeaProjects|工作区|选择/.test(b.textContent || ''));
    if (rows.length) { rows[0].click(); await new Promise((res) => setTimeout(res, 1800)); }
    const overlay = [...document.querySelectorAll('[class*="overlayLayer"]')].filter((el) => el.getBoundingClientRect().width > 50).pop();
    if (!overlay) return { overlay: null };
    const direct = [...overlay.children].map((c) => ({ tag: c.tagName, cls: (typeof c.className === 'string' ? c.className : '').split(' ').slice(0, 3).join(' '), childCount: c.children.length, text: (c.textContent || '').trim().slice(0, 60) }));
    const emptyStates = [...overlay.querySelectorAll('[class*="empty"], [class*="error"], [class*="loading"], [class*="spinner"]')].map((el) => ({ cls: (typeof el.className === 'string' ? el.className : '').split(' ').slice(0, 2).join(' '), text: (el.textContent || '').trim().slice(0, 60) }));
    return { overlayDirect: direct.slice(0, 6), emptyStates: emptyStates.slice(0, 6), overlayHtml: overlay.innerHTML.slice(0, 300) };
  })()`, true)
  console.log('overlay:', JSON.stringify(r, null, 1))
  await new Promise((r) => setTimeout(r, 500))
  console.log('client errors:', JSON.stringify(errors.slice(0, 6), null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

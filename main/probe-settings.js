'use strict'
// Open the chrome settings dialog in the running app and report what's in it.
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
  if (!chrome) { console.log('no chrome page; targets:', targets.map((t) => t.url)); return }
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
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })

  // Click the settings button, then inspect the dialog's selects.
  const result = await ev(`(async () => {
    const errs = [];
    window.__errs = [];
    const orig = console.error; console.error = (...a) => { window.__errs.push(a.map(String).join(' ')); orig(...a); };
    document.getElementById('settingsBtn').click();
    await new Promise(r => setTimeout(r, 400));
    const dlg = document.getElementById('settingsDialog');
    const skin = document.getElementById('setSkin');
    const theme = document.getElementById('setTheme');
    return {
      dialogOpen: dlg.open,
      themeOptions: theme ? [...theme.options].map(o => o.value + '=' + o.selected) : null,
      skinOptions: skin ? [...skin.options].map(o => o.value + '=' + o.selected) : null,
      jsErrors: window.__errs.slice(0, 5)
    };
  })()`)
  console.log(JSON.stringify(result, null, 2))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

'use strict'
// Inspect the opened directory-picker overlay content.
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

  // Ensure the picker is open first.
  await ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('工作区'));
    if (btn) btn.click();
    return true;
  })()`)
  await new Promise((r) => setTimeout(r, 1000))

  const r = await ev(`(() => {
    const overlay = [...document.querySelectorAll('[class*="overlayLayer"]')].filter(el => el.getBoundingClientRect().width > 50).pop();
    if (!overlay) return { overlay: null };
    const kids = [];
    for (const el of overlay.querySelectorAll('*')) {
      const c = typeof el.className === 'string' ? el.className : '';
      const text = (el.textContent || '').trim();
      if (text && text.length < 60 && /目录|文件夹|选择|工作区|取消|新建|folder|directory|browse|cancel/i.test(text)) {
        kids.push({ tag: el.tagName, cls: c.split(' ').slice(0, 3).join(' '), text });
      }
    }
    const buttons = [...overlay.querySelectorAll('button')].map(b => ({
      cls: (typeof b.className === 'string' ? b.className : '').split(' ').slice(0, 3).join(' '),
      text: (b.textContent || '').trim().slice(0, 30),
      disabled: b.disabled,
      radius: getComputedStyle(b).borderRadius,
      pointer: getComputedStyle(b).pointerEvents
    }));
    const rect = overlay.getBoundingClientRect();
    return {
      overlaySize: { w: Math.round(rect.width), h: Math.round(rect.height) },
      overlayCls: (overlay.className || '').slice(0, 60),
      textNodes: kids.slice(0, 20),
      buttons: buttons.slice(0, 12),
      iframeCount: overlay.querySelectorAll('iframe').length
    };
  })()`)
  console.log(JSON.stringify(r, null, 1))
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })

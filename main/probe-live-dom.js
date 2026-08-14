'use strict'
/**
 * Self-contained live-DOM probe (no CDP needed): starts a private dsh backend
 * on a random port with an isolated DSH_HOME, loads it in an offscreen
 * BrowserWindow, waits for the app to render, then dumps the element tree with
 * class names, the layout regions (sidebar/conversation/composer/messages) and
 * the effective token values. Prints JSON and exits.
 *
 * Usage: npx electron main/probe-live-dom.js
 * Env:   DSH_PROBE_KERNEL (kernel root; defaults to the active installed kernel)
 *        DSH_PROBE_HOME   (isolated DSH_HOME; defaults to %TEMP%/deepseekex-probe-home)
 */
'use strict'

const { app, BrowserWindow } = require('electron')
const os = require('node:os')
const path = require('node:path')

const kernelRoot =
  process.env.DSH_PROBE_KERNEL ||
  path.join(process.env.APPDATA, 'deepseekex', 'kernels', '0.1.0-rc.6')
const probeHome = process.env.DSH_PROBE_HOME || path.join(os.tmpdir(), 'deepseekex-probe-home')
const { Backend } = require('./backend.js')

async function waitFor(fn, timeoutMs, stepMs = 300) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > deadline) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, stepMs))
  }
}

async function main() {
  console.log('kernel:', kernelRoot)
  console.log('probe home:', probeHome)
  const backend = new Backend({ nodeBin: process.execPath, electronAsNode: true })
  const url = await backend.start(kernelRoot, {
    dshHome: probeHome,
    bootTimeoutMs: 120_000,
    probeTimeoutMs: 20_000,
  })
  console.log('backend:', url)

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { offscreen: true, sandbox: true },
  })
  await win.loadURL(url)

  const dump = await waitFor(
    () =>
      win.webContents
        .executeJavaScript(`(() => {
          const root = document.getElementById('root');
          if (!root || root.children.length === 0) return null;
          const classes = new Set();
          const seen = new Set();
          for (const el of document.querySelectorAll('*')) {
            const c = typeof el.className === 'string' ? el.className : '';
            if (c) for (const k of c.split(/\\s+/)) if (k && !seen.has(k)) { seen.add(k); classes.add(k); }
          }
          const all = [...document.querySelectorAll('div,aside,main,header,section,textarea,button,input')];
          const byCls = (re) => all.filter((el) => typeof el.className === 'string' && re.test(el.className));
          const biggest = (els, n = 3) => els.map((el) => {
            const r = el.getBoundingClientRect();
            return { cls: (typeof el.className === 'string' ? el.className.split(' ')[0] : '').slice(0, 44), tag: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 24) };
          }).filter((x) => x.w > 40 && x.h > 12).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, n);
          const cs = getComputedStyle(document.body);
          const tokens = {};
          for (const name of ['--dsw-alias-bg-base','--dsw-alias-bg-layer-1','--dsw-alias-bg-layer-2','--dsw-alias-bg-layer-3','--dsw-alias-brand-primary','--dsw-alias-brand-text','--dsw-alias-label-primary','--dsw-alias-label-secondary','--dsw-specific-sidebar-fill','--dsw-specific-sidebar-nav-item-active','--dsw-alias-button-primary-fill','--dsw-alias-button-primary-hover','--dsw-alias-state-success-primary','--dsw-alias-border-l1','--dsw-alias-border-l2']) {
            tokens[name] = cs.getPropertyValue(name).trim();
          }
          return {
            title: document.title,
            classCount: classes.size,
            classes: [...classes].sort().slice(0, 200),
            regions: {
              sidebarLike: biggest(byCls(/sidebar|nav|rail|tree|list|history|workspace/i)),
              mainLike: biggest(byCls(/main|panel|canvas|stage|content|chat|conversation/i)),
              composerLike: biggest(byCls(/compose|input|editor|prompt|send|footer/i)),
              messageLike: biggest(byCls(/message|bubble|agent|user/i)),
            },
            tokens,
            darkAttr: document.body.hasAttribute('data-ds-dark-theme'),
          };
        })()`),
        90_000
      )
  console.log(JSON.stringify(dump, null, 1))
  win.destroy()
  await backend.stop()
  app.exit(0)
}

main().catch((err) => {
  console.error('PROBE FAIL:', err.stack || err)
  app.exit(1)
})

'use strict'
/**
 * Probe v2: precise computed-style dump of the dsh settings modal.
 * Selects real HTMLElements (className is a string) whose hashed class token
 * ends with the module key (panel/mask/overlay/nav/header/options/close),
 * then reports their Endfield-critical properties and scans the whole modal
 * for any element with border-radius > 8px (the stock look has 24px corners).
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const uiPatch = require('./ui-patch.ts')

const kernelRoot =
  process.env.DSH_PROBE_KERNEL ||
  path.join(process.env.APPDATA, 'deepseekex', 'kernels', '0.1.0-rc.6')
const verifyHome = process.env.DSH_VERIFY_HOME || path.join(os.tmpdir(), 'deepseekex-verify-home')
const outDir = process.env.DSH_VERIFY_OUT || path.join(os.tmpdir(), 'deepseekex-verify')
const { Backend } = require('./backend.ts')

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
async function waitFor(fn, timeoutMs, stepMs = 300) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > deadline) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, stepMs))
  }
}

const STUB_PRELOAD = `
const { contextBridge } = require('electron');
const pending = [];
let state = {
  phase: 'starting', kernelVersion: null, latestVersion: null, updateAvailable: false,
  backendUrl: null, source: null, message: '', logsTail: [], themePreference: 'dark',
};
contextBridge.exposeInMainWorld('deepseekex', {
  getState: () => Promise.resolve(state),
  getSettings: () => Promise.resolve({ dshHome: '', npmRegistry: '', autoCheck: true }),
  saveSettings: () => Promise.resolve({ ok: true }),
  checkUpdate: () => Promise.resolve({ ok: true }),
  applyUpdate: () => Promise.resolve({ ok: true }),
  retryBoot: () => Promise.resolve({ ok: true }),
  windowMinimize: () => Promise.resolve({ ok: true }),
  windowClose: () => Promise.resolve({ ok: true }),
  onEvent: (cb) => pending.push(cb),
  onProgress: () => {},
  refreshBalance: () => Promise.resolve({ ok: true }),
  shellUpdateCheck: () => Promise.resolve({ ok: true, available: false }),
  shellUpdateApply: () => Promise.resolve({ ok: true }),
  shellUpdateReveal: () => Promise.resolve({ ok: true }),
  __setState: (s) => { state = s; for (const cb of pending) cb({ type: 'state', state }); },
  platform: process.platform,
});
`

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const backend = new Backend({ nodeBin: process.execPath, electronAsNode: true })
  const url = await backend.start(kernelRoot, {
    dshHome: verifyHome,
    bootTimeoutMs: 120_000,
    probeTimeoutMs: 20_000,
  })
  console.log('backend:', url)

  const preload = path.join(os.tmpdir(), 'deepseekex-stub-preload.js')
  fs.writeFileSync(preload, STUB_PRELOAD)

  const chrome = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { offscreen: true, sandbox: true, preload },
  })
  await chrome.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  await chrome.webContents.executeJavaScript(
    `window.deepseekex.__setState({ phase:'ready', kernelVersion:'0.1.0-rc.6',
      latestVersion:'0.1.0-rc.6', updateAvailable:false, backendUrl:${JSON.stringify(url)},
      source:{sha:'live',date:''}, message:'ready', logsTail:[], themePreference:'dark' })`
  )
  await sleep(5000)

  const frame = await waitFor(() => {
    try {
      return chrome.webContents.mainFrame.frames.find((f) => /^https?:\/\/127\.0\.0\.1:\d+/.test(f.url))
    } catch { return null }
  }, 30_000)
  console.log('surface frame:', frame && frame.url)

  const script = `${uiPatch.patchJs(true)};\n(() => {
    const id = '__dsh_patch__';
    let s = document.getElementById(id);
    if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s); }
    s.textContent = ${JSON.stringify(uiPatch.buildUiPatchCss())};
    return true;
  })()`
  for (const delay of [0, 1000, 4000]) {
    await sleep(delay)
    await frame.executeJavaScript(script)
  }
  await sleep(800)

  const opened = await frame.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const all = [...document.querySelectorAll('button')];
    const rail = all.find(b => typeof b.className === 'string' && /trigger/.test(b.className) && /rail/.test(b.className));
    const anyTrig = all.find(b => typeof b.className === 'string' && /trigger/.test(b.className));
    const btn = rail || anyTrig;
    if (!btn) return { ok: false, why: 'no trigger', count: all.length };
    btn.click();
    await sleep(900);
    const panel = [...document.querySelectorAll('[class*="panel"]')].find(e => typeof e.className === 'string');
    return { ok: !!panel, clicked: String(btn.className).slice(0, 50) };
  })()`)
  console.log('OPEN:', JSON.stringify(opened))
  await sleep(500)

  const styles = await frame.executeJavaScript(`(() => {
    const byKey = (key) => [...document.querySelectorAll('[class*="' + key + '"]')].find(e => typeof e.className === 'string');
    const cs = (el, prop) => { const s = el ? getComputedStyle(el) : null; return s ? s[prop] : null; };
    const cv = (el, name) => { const s = el ? getComputedStyle(el) : null; return s ? s.getPropertyValue(name).trim() : null; };
    const panel = byKey('panel'), mask = byKey('mask'), overlay = byKey('overlay'),
          nav = byKey('nav'), header = byKey('header'), options = byKey('options'), close = byKey('close');
    // scan the modal subtree for stock rounded corners
    const big = [];
    if (panel) {
      for (const el of panel.querySelectorAll('*')) {
        const r = cs(el, 'borderRadius');
        if (r && parseFloat(r) > 8) big.push({ cls: String(el.className).slice(0, 40), r });
      }
    }
    return {
      darkAttr: document.body.hasAttribute('data-ds-dark-theme'),
      panel: panel ? {
        cls: String(panel.className).slice(0, 50),
        bg: cv(panel, 'background-color'), color: cv(panel, 'color'),
        radius: cs(panel, 'borderRadius'), border: cv(panel, 'border-top-width') + ' ' + cv(panel, 'border-top-style') + ' ' + cv(panel, 'border-top-color'),
        shadow: cv(panel, 'box-shadow').slice(0, 60),
      } : null,
      mask: mask ? { bg: cv(mask, 'background-color'), blur: cv(mask, 'backdrop-filter') } : null,
      nav: nav ? { bg: cv(nav, 'background-color') } : null,
      header: header ? { bg: cv(header, 'background-color') } : null,
      options: options ? { bg: cv(options, 'background-color') } : null,
      close: close ? { radius: cs(close, 'borderRadius'), bg: cv(close, 'background-color') } : null,
      navCell: (() => { const c = byKey('navCell'); return c ? { bg: cv(c, 'background-color'), radius: cs(c, 'borderRadius') } : null })(),
      input: (() => { const i = byKey('input'); return i ? { bg: cv(i, 'background-color'), radius: cs(i, 'borderRadius'), border: cv(i, 'border-color') } : null })(),
      bigRadiusCount: big.length,
      bigRadiusSamples: big.slice(0, 10),
      patchApplied: !!document.getElementById('__dsh_patch__'),
      patchLen: document.getElementById('__dsh_patch__') ? document.getElementById('__dsh_patch__').textContent.length : 0,
    };
  })()`)
  console.log('STYLES:', JSON.stringify(styles, null, 2))

  const img = await chrome.webContents.capturePage()
  const out = path.join(outDir, 'probe-settings-modal.png')
  fs.writeFileSync(out, img.toPNG())
  console.log('screenshot:', out)

  await backend.stop().catch(() => {})
  app.quit()
}

main().catch((e) => {
  console.error('ERR', e)
  app.exit(1)
})

'use strict'
/**
 * Probe: simulate the "bad" CSS order — settings module stylesheet injected
 * AFTER the patch — and verify the patch's !important rules still win
 * (Endfield shapes preserved). Also dumps the live panel styles.
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

  // open the settings modal
  await frame.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const all = [...document.querySelectorAll('button')];
    const rail = all.find(b => typeof b.className === 'string' && /trigger/.test(b.className) && /rail/.test(b.className));
    const anyTrig = all.find(b => typeof b.className === 'string' && /trigger/.test(b.className));
    const btn = rail || anyTrig;
    if (!btn) return false;
    btn.click();
    await sleep(900);
    return true;
  })()`)
  await sleep(400)

  const before = await frame.executeJavaScript(`(() => {
    const panel = [...document.querySelectorAll('[class*="panel"]')].find(e => typeof e.className === 'string');
    return panel ? { radius: getComputedStyle(panel).borderRadius, bg: getComputedStyle(panel).backgroundColor } : null;
  })()`)
  console.log('BEFORE late-css:', JSON.stringify(before))

  // BAD CASE: duplicate the settings module CSS AFTER the patch element
  const sim = await frame.executeJavaScript(`(() => {
    const patch = document.getElementById('__dsh_patch__');
    const mod = [...document.head.querySelectorAll('style[data-plugin-css]')].find(s => (s.dataset.pluginCss || '').includes('SettingsRoot'));
    if (!patch || !mod) return { simulated: false, hasPatch: !!patch, hasModule: !!mod };
    const dup = document.createElement('style');
    dup.id = '__late_module__';
    dup.textContent = mod.textContent;
    document.head.appendChild(dup); // now AFTER the patch
    const panel = [...document.querySelectorAll('[class*="panel"]')].find(e => typeof e.className === 'string');
    const navCell = [...document.querySelectorAll('[class*="navCell"]')].find(e => typeof e.className === 'string');
    const trigger = [...document.querySelectorAll('[class*="trigger"]')].find(e => typeof e.className === 'string');
    const cs = (el) => el ? getComputedStyle(el).borderRadius : null;
    return {
      simulated: true,
      patchBeforeLateModule: patch.compareDocumentPosition(dup) & Node.DOCUMENT_POSITION_FOLLOWING,
      panelRadius: cs(panel),
      navCellRadius: cs(navCell),
      triggerRadius: cs(trigger),
    };
  })()`)
  console.log('AFTER late-css (sim):', JSON.stringify(sim, null, 1))

  const img = await chrome.webContents.capturePage()
  const out = path.join(outDir, 'probe-settings-sim.png')
  fs.writeFileSync(out, img.toPNG())
  console.log('screenshot:', out)

  await backend.stop().catch(() => {})
  app.quit()
}

main().catch((e) => {
  console.error('ERR', e)
  app.exit(1)
})

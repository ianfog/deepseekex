'use strict'
/**
 * Endfield UI verification harness. Starts a private dsh backend, loads the
 * shell chrome with a stubbed preload (so the chrome renders in the "ready"
 * state against the real backend URL), injects the kernel UI patch through
 * the same webFrameMain path the main process uses, then:
 *   1. checks the shell chrome geometry/colors,
 *   2. checks the patch token remap + component rules on the live dsh DOM,
 *   3. captures PNG screenshots of chrome and dsh surface.
 *
 * Usage: npx electron main/verify-endfield.js
 * Env:   DSH_VERIFY_OUT   screenshot dir (default %TEMP%/deepseekex-verify)
 */
'use strict'

const { app, BrowserWindow, webFrameMain } = require('electron')
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

/** Stub preload: gives the chrome renderer a fake-but-live API in "ready" state. */
const STUB_PRELOAD = `
const { contextBridge } = require('electron');
const pending = [];
const pendingProgress = [];
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
  onProgress: (cb) => pendingProgress.push(cb),
  refreshBalance: () => Promise.resolve({ ok: true, total: 1.94, granted: 0, toppedUp: 1.94, currency: 'CNY', isAvailable: true, low: true }),
  shellUpdateCheck: () => Promise.resolve({ ok: true, available: false }),
  shellUpdateApply: () => Promise.resolve({ ok: true }),
  shellUpdateReveal: () => Promise.resolve({ ok: true }),
  __setState: (s) => { state = s; for (const cb of pending) cb({ type: 'state', state }); },
  __progress: (pct, label) => { for (const cb of pendingProgress) cb({ pct, label }); },
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

  // ---- chrome window (the shell) with stub preload ----
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
  // let the iframe load the surface
  await sleep(5000)

  const shellChecks = await chrome.webContents.executeJavaScript(`(() => {
    const cs = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
    return {
      topbarH: cs('#topbar', 'height'),
      topbarBg: cs('#topbar', 'backgroundColor'),
      topbarRail: getComputedStyle(document.getElementById('topbar'), '::after').backgroundImage.slice(0, 60),
      dotClass: document.getElementById('statusDot').className,
      phaseChip: document.getElementById('phaseChip').textContent,
      kernelChip: document.getElementById('kernelChip').textContent,
      rulerTicks: document.querySelectorAll('.ruler b').length,
      rulerLabels: document.querySelectorAll('.ruler span').length,
      corners: document.querySelectorAll('.corner').length,
      emblemTransform: cs('.emblem', 'transform'),
      surfaceVisible: document.getElementById('surface').classList.contains('visible'),
      surfaceSrc: document.getElementById('surface').src.slice(0, 40),
      overlayHidden: document.getElementById('overlay').hidden,
      btnRadius: cs('.btn', 'borderRadius'),
      updateHidden: document.getElementById('updateBtn').hidden,
      progressHidden: document.getElementById('updateProgress').hidden,
      progressTrackH: cs('.progress-track', 'height'),
      progressFillClip: cs('.progress-track i', 'clipPath').slice(0, 40),
    };
  })()`)
  console.log('SHELL:', JSON.stringify(shellChecks, null, 1))

  // boot scene: force the overlay into 'starting' state and inspect the
  // generative canvas + phase numeral + calibration ticks
  const bootCheck = await chrome.webContents.executeJavaScript(`(async () => {
    window.deepseekex.__setState({ phase:'starting', kernelVersion:null,
      latestVersion:null, updateAvailable:false, backendUrl:null,
      source:null, message:'preparing npm CLI…', logsTail:[], themePreference:'dark',
      balance:null, shellUpdate:null });
    await new Promise(r => setTimeout(r, 600));
    const cv = document.getElementById('bootCanvas');
    return {
      overlayShown: !document.getElementById('overlay').hidden,
      canvasPresent: !!cv,
      canvasW: cv ? cv.width : 0,
      canvasH: cv ? cv.height : 0,
      phaseText: document.getElementById('bootPhase').textContent,
      kicker: document.getElementById('overlayKicker').textContent,
      title: document.getElementById('overlayTitle').textContent,
      ticksLit: document.querySelectorAll('.overlay-scale i.on').length,
      ticksTotal: document.querySelectorAll('.overlay-scale i').length,
      canvasPixelNonEmpty: (() => {
        if (!cv) return false;
        const c = cv.getContext('2d');
        const d = c.getImageData(0, 0, Math.min(80, cv.width), Math.min(80, cv.height)).data;
        let nz = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) nz++;
        return nz > 0;
      })(),
    };
  })()`)
  console.log('BOOT SCENE:', JSON.stringify(bootCheck, null, 1))

  // exercise the progress bar: show via the stubbed API, then read it back
  const progressCheck = await chrome.webContents.executeJavaScript(`(async () => {
    window.deepseekex.__progress(42, 'FETCH UPSTREAM');
    await new Promise(r => setTimeout(r, 350));
    const bar = document.getElementById('updateProgress');
    const fill = document.getElementById('updateProgressFill');
    const label = document.getElementById('updateProgressLabel');
    return {
      hidden: bar.hidden,
      width: fill.style.width,
      label: label.textContent,
      ariaNow: bar.getAttribute('aria-valuenow'),
      cls: bar.className,
    };
  })()`)
  console.log('PROGRESS:', JSON.stringify(progressCheck, null, 1))

  // balance telemetry: push a state with balance and read the cell back
  const balanceCheck = await chrome.webContents.executeJavaScript(`(async () => {
    window.deepseekex.__setState({ phase:'ready', kernelVersion:'0.1.0-rc.6',
      latestVersion:'0.1.0-rc.6', updateAvailable:false, backendUrl:${JSON.stringify(url)},
      source:null, message:'ready', logsTail:[], themePreference:'dark',
      balance:{ ok:true, total:1.94, granted:0, toppedUp:1.94, currency:'CNY', isAvailable:true, low:true, at:new Date().toISOString() } });
    await new Promise(r => setTimeout(r, 250));
    const chip = document.getElementById('balanceChip');
    const cs = getComputedStyle(chip);
    return {
      text: chip.textContent,
      cls: chip.className,
      color: cs.color,
      title: chip.title.slice(0, 30),
      cells: document.querySelectorAll('.readout .cell').length,
    };
  })()`)
  console.log('BALANCE:', JSON.stringify(balanceCheck, null, 1))

  // shell update telemetry: availability flips the update button
  const shellCheck = await chrome.webContents.executeJavaScript(`(async () => {
    window.deepseekex.__setState({ phase:'ready', kernelVersion:'0.1.0-rc.6',
      latestVersion:'0.1.0-rc.6', updateAvailable:false, backendUrl:${JSON.stringify(url)},
      source:null, message:'ready', logsTail:[], themePreference:'dark', balance:null,
      shellUpdate:{ available:true, version:'0.2.0', status:'available', progress:null } });
    await new Promise(r => setTimeout(r, 250));
    const btn = document.getElementById('updateBtn');
    return {
      btnText: btn.textContent,
      btnCls: btn.className,
      btnHidden: btn.hidden,
    };
  })()`)
  console.log('SHELL UPDATE:', JSON.stringify(shellCheck, null, 1))

  // ---- patch the dsh surface via the webFrameMain path (same as main) ----
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
  // Mirror main/index.js: the ui-theme plugin injects its stylesheets lazily,
  // so the patch is re-applied on a spread of delays to stay last.
  for (const delay of [0, 1000, 4000, 8000, 16000]) {
    await sleep(delay)
    const patchResult = await frame.executeJavaScript(script)
    console.log(`patch injected (delay ${delay}ms):`, patchResult)
  }
  await sleep(800) // settle after final injection

  const surfaceChecks = await frame.executeJavaScript(`(() => {
    const cs = getComputedStyle(document.body);
    const v = (n) => cs.getPropertyValue(n).trim();
    const find = (re) => { for (const el of document.querySelectorAll('*')) { if (typeof el.className === 'string' && re.test(el.className)) return el; } return null; };
    const ns = find(/newSession/);
    const seat = find(/composerSeat/);
    const side = find(/sidebarCol/);
    const nsInfo = [];
    if (ns) {
      const m = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules } catch { continue }
        for (const r of rules) {
          if (r.selectorText && ns.matches(r.selectorText)) {
            m.push({ sheet: (sheet.ownerNode && sheet.ownerNode.id) || 'app', sel: r.selectorText.slice(0, 44), bg: r.style.backgroundColor, imp: r.style.getPropertyPriority('background-color') });
          }
        }
      }
      nsInfo.push({ cls: ns.className.slice(0, 40), bg: getComputedStyle(ns).backgroundColor, color: getComputedStyle(ns).color, clip: getComputedStyle(ns).clipPath.slice(0, 34), matched: m.slice(0, 8) });
    }
    return {
      darkAttr: document.body.hasAttribute('data-ds-dark-theme'),
      bgBase: v('--dsw-alias-bg-base'),
      layer1: v('--dsw-alias-bg-layer-1'),
      brand: v('--dsw-alias-brand-primary'),
      brandText: v('--dsw-alias-brand-text'),
      labelPrimary: v('--dsw-alias-label-primary'),
      labelSecondary: v('--dsw-alias-label-secondary'),
      sidebarFill: v('--dsw-specific-sidebar-fill'),
      sidebarActive: v('--dsw-specific-sidebar-nav-item-active'),
      success: v('--dsw-alias-state-success-primary'),
      btnPrimaryFill: v('--dsw-alias-button-primary-fill'),
      borderL2: v('--dsw-alias-border-l2'),
      scrollHover: v('--dsw-alias-scrollbar-hover-l1'),
      newSession: nsInfo,
      composerBorderTop: seat ? getComputedStyle(seat).borderTopWidth : null,
      sidebarBorderRight: side ? getComputedStyle(side).borderRightWidth : null,
      patchStyleLen: document.getElementById('__dsh_patch__') ? document.getElementById('__dsh_patch__').textContent.length : 0,
    };
  })()`)
  console.log('SURFACE:', JSON.stringify(surfaceChecks, null, 1))

  // ---- screenshots ----
  await sleep(1500) // let the 900ms wipe finish
  const shot = await chrome.webContents.capturePage()
  fs.writeFileSync(path.join(outDir, 'chrome-ready.png'), shot.toPNG())
  console.log('shot: chrome-ready.png')

  chrome.destroy()
  await backend.stop()
  app.exit(0)
}

main().catch((err) => {
  console.error('VERIFY FAIL:', err.stack || err)
  app.exit(1)
})

'use strict'
/**
 * Headless verification for the SYS/OPS sidebar (no kernel, no network).
 * Loads the REAL renderer page with the REAL preload.js, stubs the main-side
 * IPC handlers with canned data, and asserts:
 *   - the sidebar defaults to COLLAPSED and the toggle persists the choice
 *   - the kernel gauge sits on top with a large uptime readout + strip ticks
 *   - the sidebar is gauge-only (balance trace, ops actions, clock and news
 *     feed all removed)
 *   - the chrome theme follows 设置 → 外观 (light/dark via state broadcasts)
 *   - the boot overlay stays carbon-black in both themes
 *
 * Usage: npx electron main/verify-ops-sidebar.js
 * Exit:  0 = PASS, 1 = FAIL
 */

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const os = require('node:os')

// Isolate this run: a fresh userData per launch, so the renderer's
// localStorage (collapse choice) and any cached state never leak between
// runs — "first run" is deterministic.
app.setPath('userData', path.join(os.tmpdir(), `deepseekex-verify-${process.pid}`))

const now = Date.now()
const cannedState = {
  phase: 'ready',
  kernelVersion: '0.1.0-rc.6',
  latestVersion: '0.1.0-rc.6',
  updateAvailable: false,
  backendUrl: 'http://127.0.0.1:43123',
  source: { sha: 'abc1234', date: '2026-01-01T00:00:00Z' },
  message: 'ready',
  logsTail: ['[info] boot ok', '[info] backend ready'],
  settings: {},
  themePreference: 'dark',
  balance: { ok: true, total: 23.45, granted: 3.45, toppedUp: 20, currency: 'CNY', isAvailable: true, low: false, at: new Date().toISOString() },
  shellUpdate: null,
  nodeRuntime: 'system-node',
  nodeVersion: 'v24.9.0',
  backendStartedAt: now - 10_000, // 10s uptime
}

/** Register every channel the renderer may invoke during the test. */
function stubIpc() {
  const handlers = {
    'desktop:get-state': () => cannedState,
    'desktop:get-settings': () => ({ dshHome: '', npmRegistry: '', autoCheck: true }),
    'desktop:refresh-balance': () => cannedState.balance,
    'desktop:shell-update-check': () => ({ ok: true, available: false }),
    'desktop:check-update': () => ({ ok: true, updateAvailable: false }),
  }
  for (const [channel, fn] of Object.entries(handlers)) ipcMain.handle(channel, fn)
}

/** @type {{pass:string[], fail:string[], errors:string[]}} */
const results = { pass: [], fail: [], errors: [] }

function assert(name, cond, detail) {
  if (cond) results.pass.push(name)
  else results.fail.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

/** @param {import('electron').BrowserWindow} win */
async function run(win, js) {
  return win.webContents.executeJavaScript(js, true)
}

async function main() {
  stubIpc()
  await app.whenReady()
  const win = new BrowserWindow({
    width: 1440,
    height: 880,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) results.errors.push(message) // error level
  })
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  // The hidden test window never ticks CSS transitions (they'd stay frozen at
  // their start value), so collapse/expand would never complete. Zero the
  // motion duration to make every width change instant and deterministic.
  await run(win, `document.documentElement.style.setProperty('--ef-fast', '0s')`)
  // let the async initial render settle
  await new Promise((r) => setTimeout(r, 600))

  // ---- step 1: defaults (sidebar collapsed on first run) ----
  const init = await run(win, `(() => ({
    defaultCollapsed: document.getElementById('stage').classList.contains('side-collapsed'),
    opsPressed: document.getElementById('opsBtn').getAttribute('aria-pressed'),
    panelHidden: document.getElementById('sidePanel').hidden,
    shellTheme: document.documentElement.dataset.shellTheme,
  }))()`)
  assert('sidebar defaults to collapsed', init.defaultCollapsed === true)
  assert('ops toggle mirrors collapsed state', init.opsPressed === 'false', `got ${init.opsPressed}`)
  assert('sidebar hidden only by collapse, not phase', init.panelHidden === false)

  // ---- step 2: expand and inspect the full panel ----
  await run(win, `document.getElementById('opsBtn').click()`)
  await new Promise((r) => setTimeout(r, 400)) // let refreshSpark draw
  const o = await run(win, `(() => {
    const $ = (id) => document.getElementById(id)
    const out = {}
    const panel = $('sidePanel')
    out.expanded = !$('stage').classList.contains('side-collapsed')
    out.storedExpanded = localStorage.getItem('deepseekex.ops.collapsed')
    out.panelWidth = panel.getBoundingClientRect().width
    const blocks = Array.from(panel.querySelectorAll('.side-block'))
    out.blockClasses = blocks.map((b) => b.className)
    out.gaugeFirst = blocks[0] ? blocks[0].classList.contains('side-gauge') : false
    out.uptime = $('sideUptime').textContent
    out.gaugeFontSize = getComputedStyle($('sideUptime')).fontSize
    out.stripTicks = document.querySelectorAll('#gaugeStrip i').length
    out.stripLit = document.querySelectorAll('#gaugeStrip i.on').length
    out.kernel = $('sideKernel').textContent
    out.node = $('sideNode').textContent
    out.runtime = $('sideRuntime').textContent
    out.url = $('sideUrl').textContent
    out.balanceValueGone = $('sideBalanceValue') === null
    out.balanceNoteGone = $('sideBalanceNote') === null
    out.opsButtonsGone = $('opsRestart') === null && $('opsOpenDir') === null && $('opsCopyLogs') === null
    out.sparkGone = $('balanceSpark') === null && $('sparkScale') === null
    out.clockGone = $('clockTime') === null && $('clockDate') === null && $('quoteLine') === null
    out.feedsGone = $('feedBody') === null && $('feedRefresh') === null
    out.inkDark = getComputedStyle(document.documentElement).getPropertyValue('--ef-ink').trim()
    return out
  })()`)

  assert('expand toggle works', o.expanded === true)
  assert('expanded choice persisted', o.storedExpanded === '0', `got ${o.storedExpanded}`)
  assert('sidebar docked at 300px when open', o.panelWidth === 300, `got ${o.panelWidth}`)
  assert('gauge block is first', o.gaugeFirst === true, `blocks: ${o.blockClasses}`)
  assert('uptime shows mm:ss', /^\d+:\d{2}$/.test(o.uptime), `got ${o.uptime}`)
  assert('uptime rendered large (>=28px)', parseFloat(o.gaugeFontSize) >= 28, `got ${o.gaugeFontSize}`)
  assert('gauge strip has 8 ticks', o.stripTicks === 8, `got ${o.stripTicks}`)
  assert('gauge strip lit by uptime', o.stripLit > 0, `got ${o.stripLit}`)
  assert('kernel version shown', o.kernel === '0.1.0-rc.6', `got ${o.kernel}`)
  assert('node version shown', o.node === 'v24.9.0', `got ${o.node}`)
  assert('runtime label shown', o.runtime === 'SYSTEM NODE', `got ${o.runtime}`)
  assert('backend url shown', o.url.includes('43123'), `got ${o.url}`)
  assert('balance number removed', o.balanceValueGone === true)
  assert('balance note removed', o.balanceNoteGone === true)
  assert('ops action buttons removed', o.opsButtonsGone === true)
  assert('balance trace removed', o.sparkGone === true)
  assert('clock removed', o.clockGone === true)
  assert('news feed removed', o.feedsGone === true)
  assert('initial shell theme is dark', init.shellTheme === 'dark', `got ${init.shellTheme}`)
  assert('dark palette applied', o.inkDark === '#191919', `got ${o.inkDark}`)

  // ---- step 3: collapse again -> persisted ----
  const coll = await run(win, `(() => {
    document.getElementById('opsBtn').click()
    return {
      collapsed: document.getElementById('stage').classList.contains('side-collapsed'),
      stored: localStorage.getItem('deepseekex.ops.collapsed'),
    }
  })()`)
  assert('collapse works', coll.collapsed === true)
  assert('collapsed choice persisted', coll.stored === '1', `got ${coll.stored}`)

  // ---- step 4: light theme flips chrome but NOT the boot overlay ----
  win.webContents.send('desktop:event', {
    type: 'state',
    state: { ...cannedState, themePreference: 'light' },
  })
  await new Promise((r) => setTimeout(r, 300))
  const t = await run(win, `(() => ({
    shellTheme: document.documentElement.dataset.shellTheme,
    ink: getComputedStyle(document.documentElement).getPropertyValue('--ef-ink').trim(),
    signal: getComputedStyle(document.documentElement).getPropertyValue('--ef-signal').trim(),
    panelBg: getComputedStyle(document.getElementById('sidePanel')).backgroundColor,
    overlayBg: getComputedStyle(document.getElementById('overlay')).backgroundColor,
    overlayTitle: getComputedStyle(document.querySelector('.overlay-title')).color,
    overlayKicker: getComputedStyle(document.querySelector('.overlay-kicker')).color,
  }))()`)
  assert('light preference flips chrome', t.shellTheme === 'light', `got ${t.shellTheme}`)
  assert('light palette tokens applied', t.ink === '#f4f4f1', `got ${t.ink}`)
  assert('light signal token deepened', t.signal === '#d9d200', `got ${t.signal}`)
  assert('sidebar bg flips to light', t.panelBg === 'rgb(244, 244, 241)', `got ${t.panelBg}`)
  assert('boot overlay stays carbon black in light mode', t.overlayBg === 'rgb(25, 25, 25)', `got ${t.overlayBg}`)
  assert('boot title stays paper white in light mode', t.overlayTitle === 'rgb(242, 242, 240)', `got ${t.overlayTitle}`)
  assert('boot kicker stays signal yellow in light mode', t.overlayKicker === 'rgb(255, 250, 0)', `got ${t.overlayKicker}`)

  // ---- step 5: back to dark ----
  win.webContents.send('desktop:event', {
    type: 'state',
    state: { ...cannedState, themePreference: 'dark' },
  })
  await new Promise((r) => setTimeout(r, 300))
  const t2 = await run(win, `document.documentElement.dataset.shellTheme`)
  assert('dark preference flips chrome back', t2 === 'dark', `got ${t2}`)

  // ---- step 6: boot/overlay phases pin the chrome dark, even under a light
  // preference (no white flash at startup on light systems) ----
  win.webContents.send('desktop:event', {
    type: 'state',
    state: { ...cannedState, phase: 'starting', themePreference: 'light' },
  })
  await new Promise((r) => setTimeout(r, 300))
  const bootTheme = await run(win, `document.documentElement.dataset.shellTheme`)
  assert('chrome pinned dark while booting under light pref', bootTheme === 'dark', `got ${bootTheme}`)
  const bootTopbar = await run(
    win,
    `getComputedStyle(document.getElementById('topbar')).backgroundColor`,
  )
  assert('topbar stays carbon-ink during boot', bootTopbar === 'rgb(25, 25, 25)', `got ${bootTopbar}`)

  // back to ready + light: chrome follows the preference again
  win.webContents.send('desktop:event', {
    type: 'state',
    state: { ...cannedState, themePreference: 'light' },
  })
  await new Promise((r) => setTimeout(r, 300))
  const readyTheme = await run(win, `document.documentElement.dataset.shellTheme`)
  assert('chrome follows light pref once ready', readyTheme === 'light', `got ${readyTheme}`)

  assert('no renderer console errors', results.errors.length === 0, results.errors.join(' | '))

  win.destroy()
  const failed = results.fail.length
  console.log(`\n=== SYS/OPS SIDEBAR VERIFY: ${results.pass.length} passed, ${failed} failed ===`)
  for (const f of results.fail) console.log(`  FAIL: ${f}`)
  app.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('VERIFY CRASH:', err)
  app.exit(1)
})

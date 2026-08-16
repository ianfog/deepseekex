// @ts-check
'use strict'
/**
 * Chrome renderer logic: reflects main-process state onto the top bar,
 * drives the dsh webview, and wires the update/settings/log UI.
 * Type-checked via JSDoc (tsconfig covers this file with allowJs).
 */

/** @typedef {{
 *   phase: string,
 *   kernelVersion: string|null,
 *   latestVersion: string|null,
 *   updateAvailable: boolean,
 *   backendUrl: string|null,
 *   source: {sha:string, date:string|null}|null,
 *   message: string,
 *   logsTail: string[],
 *   themePreference: string,
 *   balance: ({ok:true, total:number, currency:string, isAvailable:boolean, low:boolean, toppedUp:number, granted:number}|{ok:false, reason?:string, message?:string})|null,
 *   shellUpdate: {available:boolean, version:string|null, status?:string, progress?:number, manual?:boolean, path?:string}|null,
 *   nodeRuntime?: string,
 *   nodeVersion?: string,
 *   backendStartedAt?: number|null,
 *   usageMs?: number
 * }} AppState */

/** @typedef {{
 *   getState(): Promise<AppState>,
 *   getSettings(): Promise<{dshHome?:string, npmRegistry?:string, autoCheck?:boolean}>,
 *   saveSettings(p: {dshHome?:string, npmRegistry?:string, autoCheck?:boolean}): Promise<unknown>,
 *   refreshBalance(): Promise<{ok:boolean, total?:number, currency?:string, isAvailable?:boolean, low?:boolean, reason?:string} | null>,
 *   shellUpdateCheck(): Promise<{ok:boolean, available?:boolean, version?:string|null} | null>,
 *   shellUpdateApply(): Promise<{ok:boolean, message?:string} | null>,
 *   shellUpdateReveal(): Promise<{ok:boolean, message?:string} | null>,
 *   checkUpdate(): Promise<unknown>,
 *   applyUpdate(): Promise<unknown>,
 *   restartBackend(): Promise<unknown>,
 *   retryBoot(): Promise<unknown>,
 *   platform: string,
 *   onEvent(cb: (ev: {type:string, state:AppState}) => void): void,
 *   onProgress(cb: (p: {pct:number, label:string}) => void): void
 * }} Api */

/** @type {Api} */
const api = /** @type {Api} */ (window.deepseekex)
/** @param {string} id @returns {any} */
const $ = (id) => document.getElementById(id)

const els = {
  statusDot: $('statusDot'),
  kernelChip: $('kernelChip'),
  sourceChip: $('sourceChip'),
  phaseChip: $('phaseChip'),
  balanceCell: $('balanceCell'),
  balanceChip: $('balanceChip'),
  usageCell: $('usageCell'),
  usageChip: $('usageChip'),
  opsBtn: $('opsBtn'),
  sidePanel: $('sidePanel'),
  sideClose: $('sideClose'),
  gaugeDot: $('gaugeDot'),
  gaugeStrip: $('gaugeStrip'),
  sideKernel: $('sideKernel'),
  sideNode: $('sideNode'),
  sideRuntime: $('sideRuntime'),
  sideUrl: $('sideUrl'),
  sideUptime: $('sideUptime'),
  updateBtn: $('updateBtn'),
  updateProgress: $('updateProgress'),
  updateProgressFill: $('updateProgressFill'),
  updateProgressLabel: $('updateProgressLabel'),
  settingsBtn: $('settingsBtn'),
  logsBtn: $('logsBtn'),
  logsClose: $('logsClose'),
  overlay: $('overlay'),
  overlayKicker: $('overlayKicker'),
  bootCanvas: $('bootCanvas'),
  bootPhase: $('bootPhase'),
  bootScale: $('bootScale'),
  spinner: $('spinner'),
  overlayTitle: $('overlayTitle'),
  overlayMessage: $('overlayMessage'),
  retryBtn: $('retryBtn'),
  surface: $('surface'),
  logPanel: $('logPanel'),
  logBody: $('logBody'),
  settingsDialog: $('settingsDialog'),
  setDshHome: $('setDshHome'),
  setRegistry: $('setRegistry'),
  setAutoCheck: $('setAutoCheck'),
  settingsSave: $('settingsSave'),
  settingsCancel: $('settingsCancel'),
}

/** @type {AppState|null} */
let state = null
/** @type {string|null} */
let loadedUrl = null

/* ============================================================
 * Boot scene: generative Endfield canvas (diamond particles,
 * signal sweep, calibration grid). Runs only while the overlay is
 * visible; pauses under prefers-reduced-motion. Pure Canvas 2D,
 * no external assets.
 * ============================================================ */
const boot = (() => {
  /** @type {HTMLCanvasElement|null} */
  const canvasEl = els.bootCanvas
  if (!canvasEl) return { start: () => {}, stop: () => {}, setPhase: () => {}, setProgress: () => {} }
  /** @type {HTMLCanvasElement} */
  const canvas = canvasEl
  /** @type {CanvasRenderingContext2D|null} */
  const ctx = canvas.getContext('2d')
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /** @type {{x:number,y:number,vx:number,vy:number,s:number,sp:number}[]} */
  let parts = []
  let raf = 0
  let running = false
  let t = 0
  let phase = 0 // 0 boot · 1 kernel · 2 ready-ish · 3 fault
  let progress = 0 // 0..1
  let w = 0
  let h = 0

  const SIGNAL = '#fffa00'
  const MUTED = 'rgba(136,136,136,'
  const GRID = 'rgba(255,255,255,0.05)'

  function resize() {
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    seed()
  }

  function seed() {
    const n = Math.max(30, Math.min(110, Math.round((w * h) / 16000)))
    parts = []
    for (let i = 0; i < n; i++) {
      parts.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        s: 2 + Math.random() * 5,
        sp: 0.4 + Math.random() * 0.6,
      })
    }
  }

  /** Draw one Endfield diamond at (x,y) with size s. */
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} s
   * @param {number} alpha
   */
  function diamond(x, y, s, alpha) {
    if (!ctx) return
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(Math.PI / 4)
    ctx.strokeStyle = SIGNAL
    ctx.globalAlpha = alpha
    ctx.lineWidth = 1
    ctx.strokeRect(-s / 2, -s / 2, s, s)
    ctx.restore()
  }

  function frame() {
    if (!ctx) return
    t += 1
    ctx.clearRect(0, 0, w, h)

    // calibration grid
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1
    const step = 44
    for (let x = (t * 0.1) % step; x < w; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
    }
    for (let y = (t * 0.1) % step; y < h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }

    // drifting diamond particles; converge toward center as progress rises
    const cx = w / 2
    const cy = h / 2
    const converge = 0.02 + progress * 0.06
    for (const p of parts) {
      p.x += (cx - p.x) * converge * 0.01 + p.vx
      p.y += (cy - p.y) * converge * 0.01 + p.vy
      if (p.x < -20) p.x = w + 20; if (p.x > w + 20) p.x = -20
      if (p.y < -20) p.y = h + 20; if (p.y > h + 20) p.y = -20
      const a = 0.08 + Math.abs(Math.sin(t * 0.01 * p.sp)) * 0.25
      diamond(p.x, p.y, p.s, phase === 3 ? 0.3 : a)
    }

    // central core diamond that brightens as boot completes
    const core = 26 + progress * 60 + Math.sin(t * 0.03) * 4
    diamond(cx, cy, core, 0.25 + progress * 0.5)

    // signal sweep: a vertical scan line moving left→right
    const sx = (t * 1.6) % (w + 240) - 120
    const grad = ctx.createLinearGradient(sx - 90, 0, sx + 20, 0)
    grad.addColorStop(0, 'rgba(255,250,0,0)')
    grad.addColorStop(0.8, 'rgba(255,250,0,0.14)')
    grad.addColorStop(1, 'rgba(255,250,0,0.5)')
    ctx.fillStyle = grad
    ctx.fillRect(sx - 90, 0, 110, h)

    // faint center guide line
    ctx.strokeStyle = 'rgba(255,250,0,0.10)'
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke()

    if (running) raf = requestAnimationFrame(frame)
  }

  function start() {
    if (!canvas || !ctx) return
    // idempotent: resize/seed once per show, one resize listener, one loop
    if (!running && !reduce) {
      resize()
      window.removeEventListener('resize', resize)
      window.addEventListener('resize', resize)
      running = true
      raf = requestAnimationFrame(frame)
    } else if (reduce) {
      resize()
      window.removeEventListener('resize', resize)
      window.addEventListener('resize', resize)
      // static render: grid + one centered diamond
      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = GRID
      const step = 44
      for (let x = 0; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
      for (let y = 0; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
      diamond(w / 2, h / 2, 40, 0.4)
    }
  }

  function stop() {
    if (running) {
      cancelAnimationFrame(raf)
      running = false
    }
    window.removeEventListener('resize', resize)
  }

  /** @param {number} p 0..1 */
  function setProgress(p) {
    progress = Math.max(0, Math.min(1, p))
    // light up the calibration ticks proportionally
    /** @type {Element[]} */
    const ticks = els.bootScale ? Array.from(els.bootScale.querySelectorAll('i')) : []
    ticks.forEach((tick, i) => {
      tick.classList.toggle('on', i / ticks.length <= progress)
      tick.classList.toggle('fault', phase === 3)
    })
  }

  /** @param {number|string} ph - 0/1/2/3 or 'fault' */
  function setPhase(ph) {
    phase = ph === 'fault' ? 3 : Number(ph) || 0
    if (els.bootPhase) {
      els.bootPhase.textContent = phase === 3 ? '!!' : String(phase + 1).padStart(2, '0')
    }
  }

  return { start, stop, setPhase, setProgress }
})()

/** @param {string} phase */
function setDot(phase) {
  els.statusDot.className = 'dot ' + (phase === 'ready' ? 'ok' : phase === 'error' ? 'err' : 'busy')
}

/** @param {AppState} s */
function render(s) {
  state = s
  applyShellTheme()
  setDot(s.phase)

  els.kernelChip.textContent = s.kernelVersion || '-'
  els.sourceChip.textContent = s.source && s.source.sha ? `${s.source.sha}${s.source.date ? ' · ' + s.source.date.slice(0, 10) : ''}` : 'LOCAL'
  els.phaseChip.textContent =
    s.phase === 'ready' ? 'READY' : s.phase === 'error' ? 'FAULT' : s.phase === 'updating' ? 'UPDATE' : 'BOOT'

  // Balance telemetry: amount, currency symbol, low/offline/no-key states.
  const b = s.balance
  if (b && b.ok) {
    const symbol = b.currency === 'USD' ? '$' : '¥'
    els.balanceChip.textContent = `${symbol}${b.total.toFixed(2)}`
    els.balanceChip.className = 'cell-value' + (b.isAvailable ? '' : ' fault') + (b.low ? ' low' : '')
    els.balanceChip.title = b.low ? `余额不足 (¥${b.total.toFixed(2)})` : `可用 ¥${b.total.toFixed(2)} · 充值 ¥${b.toppedUp.toFixed(2)} · 赠送 ¥${b.granted.toFixed(2)}`
  } else if (b) {
    els.balanceChip.textContent = b.reason === 'no-key' ? 'NO KEY' : 'OFFLINE'
    els.balanceChip.className = 'cell-value fault'
    els.balanceChip.title = b.reason === 'no-key' ? '未配置 DEEPSEEK_API_KEY' : b.message || '余额查询失败'
  } else {
    els.balanceChip.textContent = '--'
    els.balanceChip.className = 'cell-value'
    els.balanceChip.title = 'DeepSeek 平台余额'
  }

  // Total usage time: accumulated app-open hours across sessions.
  els.usageChip.textContent = typeof s.usageMs === 'number' ? formatUsageHours(s.usageMs) : '--'

  // The dsh UI iframe: assign src once per backend URL.
  if (s.phase === 'ready' || s.phase === 'updating') {
    els.overlay.hidden = true
    boot.stop()
    if (s.phase === 'ready' && s.backendUrl) {
      if (loadedUrl !== s.backendUrl) {
        loadedUrl = s.backendUrl
        els.surface.classList.add('visible')
        els.surface.src = s.backendUrl
      } else {
        els.surface.classList.add('visible')
      }
    }
  } else {
    els.surface.classList.remove('visible')
    els.overlay.hidden = false
    els.overlayKicker.textContent =
      s.phase === 'error' ? 'FAULT DETECTED' : s.phase === 'updating' ? 'KERNEL UPDATE' : 'BOOT SEQUENCE'
    els.overlayTitle.textContent =
      s.phase === 'error' ? '出错了' : s.phase === 'updating' ? '更新中…' : '启动中…'
    els.overlayMessage.textContent = s.message || ''
    els.retryBtn.hidden = s.phase !== 'error'
    els.spinner.style.display = s.phase === 'updating' || s.phase === 'starting' ? '' : 'none'
    // drive the generative boot scene
    boot.setPhase(s.phase === 'error' ? 'fault' : s.phase === 'updating' ? 1 : 0)
    boot.start()
    // progress heuristic: boot stages walk the calibration scale
    const pct = s.phase === 'error' ? 0 : s.phase === 'updating' ? 0.35 : 0.12
    boot.setProgress(pct)
  }

  // Update button: shell self-update takes priority over kernel update.
  const shell = s.shellUpdate
  const shellAction =
    shell &&
    (shell.available ||
      shell.status === 'downloading' ||
      shell.status === 'downloaded' ||
      shell.status === 'installing' ||
      shell.status === 'dmg-ready')
  if (s.phase === 'updating') {
    els.updateBtn.hidden = true
  } else if (shellAction && shell.status === 'downloading') {
    els.updateBtn.hidden = false
    els.updateBtn.textContent = `下载壳 ${shell.version || ''} ${shell.progress != null ? shell.progress + '%' : ''}`
    els.updateBtn.className = 'btn ghost'
    els.updateBtn.disabled = true
  } else if (shellAction && shell.status === 'dmg-ready') {
    // macOS manual flow: dmg downloaded — reopen it for the drag-into-Apps step.
    els.updateBtn.hidden = false
    els.updateBtn.textContent = `手动安装 ${shell.version || ''}（已下载）`
    els.updateBtn.className = 'btn warn'
    els.updateBtn.disabled = false
  } else if (shellAction && (shell.status === 'downloaded' || shell.status === 'installing')) {
    els.updateBtn.hidden = false
    els.updateBtn.textContent = '重启完成更新'
    els.updateBtn.className = 'btn warn'
    els.updateBtn.disabled = false
  } else if (shellAction && shell.available) {
    els.updateBtn.hidden = false
    els.updateBtn.textContent = `更新壳到 ${shell.version}`
    els.updateBtn.className = 'btn warn'
    els.updateBtn.disabled = false
  } else if (s.updateAvailable) {
    els.updateBtn.hidden = false
    els.updateBtn.textContent = `更新到 ${s.latestVersion}`
    els.updateBtn.className = 'btn warn'
    els.updateBtn.disabled = false
  } else if (s.phase === 'ready' || s.phase === 'error') {
    els.updateBtn.hidden = false
    els.updateBtn.textContent = s.kernelVersion ? '检查更新' : '检查更新'
    els.updateBtn.className = 'btn ghost'
    els.updateBtn.disabled = false
  } else {
    els.updateBtn.hidden = true
  }

  // OPS sidebar: visible only while the kernel is ready; the dsh iframe
  // shrinks (dock), so the panel never covers the kernel UI.
  const ready = s.phase === 'ready'
  els.sidePanel.hidden = !ready
  if (ready) {
    els.sideKernel.textContent = s.kernelVersion || '-'
    els.sideNode.textContent = s.nodeVersion || '-'
    els.sideRuntime.textContent = s.nodeRuntime === 'system-node' ? 'SYSTEM NODE' : 'ELECTRON-AS-NODE'
    els.sideUrl.textContent = s.backendUrl || '-'
    els.sideUptime.textContent = s.backendStartedAt ? formatUptime((Date.now() - s.backendStartedAt) / 1000) : '--'
    // status lamp + gauge strip track the kernel state
    els.gaugeDot.className = 'dot ' + (s.phase === 'ready' ? 'ok' : 'err')
    updateGaugeStrip(s.backendStartedAt ? (Date.now() - s.backendStartedAt) / 1000 : 0)
  }

  els.logBody.textContent = (s.logsTail || []).join('\n')
  els.logBody.scrollTop = els.logBody.scrollHeight
}

api.onEvent((ev) => {
  if (ev.type === 'state') render(ev.state)
})

/** Update the telemetry progress bar; auto-hide shortly after 100%. */
/** @type {ReturnType<typeof setTimeout>|null} */
let progressHideTimer = null
/**
 * @param {number} pct
 * @param {string} label
 * @param {string|null} [cls]
 */
function showProgress(pct, label, cls) {
  els.updateProgress.hidden = false
  els.updateProgress.classList.remove('done', 'fault')
  if (cls) els.updateProgress.classList.add(cls)
  els.updateProgressFill.style.width = pct + '%'
  els.updateProgressLabel.textContent = `${label} ${pct}%`
  els.updateProgress.setAttribute('aria-valuenow', String(pct))
  if (pct >= 100) {
    if (progressHideTimer) clearTimeout(progressHideTimer)
    progressHideTimer = setTimeout(() => {
      els.updateProgress.hidden = true
      els.updateProgressFill.style.width = '0%'
    }, 1600)
  }
}

api.onProgress(({ pct, label }) => {
  const cls = /FAILED|ERROR/.test(label) ? 'fault' : /DONE/.test(label) ? 'done' : null
  showProgress(Math.round(pct), (label || 'WORKING').slice(0, 20), cls)
})

els.updateBtn.addEventListener('click', async () => {
  const shell = state && state.shellUpdate
  // Shell update: macOS downloads the dmg for a manual drag-into-Apps install;
  // Windows/Linux download then restart to install.
  if (shell && (shell.available || shell.status === 'downloaded' || shell.status === 'downloading' || shell.status === 'dmg-ready')) {
    if (shell.status === 'dmg-ready') {
      // dmg already downloaded: reopen it in Finder (reveal).
      await api.shellUpdateReveal()
      return
    }
    if (shell.status === 'downloaded') {
      if (!window.confirm('壳更新已下载，确定现在重启并安装吗？')) return
    } else if (api.platform === 'darwin') {
      if (!window.confirm(`确定下载壳 ${shell.version} 吗？下载后请在 Finder 中把 Deepseekex 拖入 Applications 完成安装。`)) return
    } else if (!window.confirm(`确定要更新壳到 ${shell.version} 吗？`)) {
      return
    }
    els.updateBtn.disabled = true
    showProgress(0, 'SHELL QUEUED')
    await api.shellUpdateApply()
    return
  }
  // Kernel update.
  if (state && state.updateAvailable) {
    if (!window.confirm(`确定要更新内核到 ${state.latestVersion} 吗？更新后会自动重启。`)) return
    els.updateBtn.disabled = true
    showProgress(0, 'UPDATE QUEUED')
    await api.applyUpdate()
  } else {
    els.updateBtn.disabled = true
    showProgress(0, 'CHECK QUEUED')
    await api.checkUpdate()
    // also refresh the shell update check in the same pass
    await api.shellUpdateCheck()
    els.updateBtn.disabled = false
  }
})

// Click the balance cell to refresh it live (button-like affordance).
els.balanceCell.addEventListener('click', async () => {
  els.balanceChip.textContent = '…'
  /** @type {{ok:boolean, total?:number, currency?:string, isAvailable?:boolean, low?:boolean, reason?:string}|null} */
  const b = await api.refreshBalance()
  if (b && b.ok && typeof b.total === 'number') {
    const symbol = b.currency === 'USD' ? '$' : '¥'
    els.balanceChip.textContent = `${symbol}${b.total.toFixed(2)}`
    els.balanceChip.className = 'cell-value' + (b.isAvailable ? '' : ' fault') + (b.low ? ' low' : '')
  } else if (b) {
    els.balanceChip.textContent = b.reason === 'no-key' ? 'NO KEY' : 'OFFLINE'
    els.balanceChip.className = 'cell-value fault'
  }
})

/* ============================================================
 * SYS/OPS station: kernel instrument gauge
 * ============================================================ */

/** Total usage in hours ("xx.x h"), per the "record xx h" requirement. */
/** @param {number} ms */
function formatUsageHours(ms) {
  const h = Math.max(0, ms) / 3_600_000
  return `${h.toFixed(1)} h`
}

/** @param {number} sec */
function formatUptime(sec) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  /** @param {number} n */
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`
}

/** Light up the gauge strip ticks as the kernel runs: one tick immediately,
 *  one more every 30s, then wrap so the strip keeps breathing forever.
 *  @param {number} sec - uptime in seconds. */
function updateGaugeStrip(sec) {
  if (!els.gaugeStrip) return
  const ticks = Array.from(els.gaugeStrip.children)
  const n = ticks.length
  if (n === 0) return
  const lit = 1 + (Math.floor(sec / 30) % n)
  ticks.forEach((tick, i) => {
    tick.classList.toggle('on', i < lit)
  })
}

// Kernel uptime ticker (1s while the panel is visible and ready).
setInterval(() => {
  if (!state || state.phase !== 'ready' || els.sidePanel.hidden || !state.backendStartedAt) return
  const sec = (Date.now() - state.backendStartedAt) / 1000
  els.sideUptime.textContent = formatUptime(sec)
  updateGaugeStrip(sec)
}, 1000)

/* ---- chrome theme: follows the dsh UI's 设置 → 外观 preference ---- */
/** @param {string|undefined} pref - 'light' | 'dark' | 'system' */
function resolveShellTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}
/** Apply the resolved theme to the chrome token set (light/dark palettes).
 *  The boot/update/error overlay is always carbon-ink, so the whole chrome is
 *  pinned dark while it is visible (no white flash on light systems); once
 *  ready, the chrome follows the 设置 → 外观 preference. */
function applyShellTheme() {
  const t = state && state.phase === 'ready' ? resolveShellTheme(state.themePreference) : 'dark'
  document.documentElement.dataset.shellTheme = t
}
// Follow OS color scheme changes while the preference is 'system'.
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (!state || state.themePreference === 'system') applyShellTheme()
})

// Collapse/expand: persist across launches, mirror state onto the OPS toggle.
const SIDE_KEY = 'deepseekex.ops.collapsed'
/** @param {boolean} collapsed */
function applySideCollapsed(collapsed) {
  const stage = $('stage')
  stage.classList.toggle('side-collapsed', collapsed)
  els.opsBtn.setAttribute('aria-pressed', String(!collapsed))
  try {
    localStorage.setItem(SIDE_KEY, collapsed ? '1' : '0')
  } catch {
    /* storage unavailable — collapse just won't persist */
  }
}
els.opsBtn.addEventListener('click', () => {
  applySideCollapsed(!$('stage').classList.contains('side-collapsed'))
})
els.sideClose.addEventListener('click', () => applySideCollapsed(true))
// Default to collapsed on first run; remember the user's choice afterwards
// ('1' = collapsed, '0' = expanded).
try {
  const stored = localStorage.getItem(SIDE_KEY)
  applySideCollapsed(stored === null ? true : stored === '1')
} catch {
  applySideCollapsed(true)
}

els.retryBtn.addEventListener('click', () => api.retryBoot())

els.logsBtn.addEventListener('click', () => {
  els.logPanel.hidden = !els.logPanel.hidden
  els.logBody.scrollTop = els.logBody.scrollHeight
})
els.logsClose.addEventListener('click', () => {
  els.logPanel.hidden = true
})

els.settingsBtn.addEventListener('click', async () => {
  const s = await api.getSettings()
  els.setDshHome.value = s.dshHome || ''
  els.setRegistry.value = s.npmRegistry || ''
  els.setAutoCheck.checked = s.autoCheck !== false
  els.settingsDialog.showModal()
})
els.settingsCancel.addEventListener('click', () => els.settingsDialog.close())
els.settingsSave.addEventListener('click', async () => {
  await api.saveSettings({
    dshHome: els.setDshHome.value.trim(),
    npmRegistry: els.setRegistry.value.trim(),
    autoCheck: els.setAutoCheck.checked,
  })
  els.settingsDialog.close()
})

// initial state
api.getState().then(render)

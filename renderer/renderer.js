'use strict'
/**
 * Chrome renderer logic: reflects main-process state onto the top bar,
 * drives the dsh webview, and wires the update/settings/log UI.
 */

const api = window.deepseekex
const $ = (id) => document.getElementById(id)

const els = {
  statusDot: $('statusDot'),
  kernelChip: $('kernelChip'),
  sourceChip: $('sourceChip'),
  phaseChip: $('phaseChip'),
  balanceCell: $('balanceCell'),
  balanceChip: $('balanceChip'),
  updateBtn: $('updateBtn'),
  updateProgress: $('updateProgress'),
  updateProgressFill: $('updateProgressFill'),
  updateProgressLabel: $('updateProgressLabel'),
  workspaceBtn: $('workspaceBtn'),
  settingsBtn: $('settingsBtn'),
  logsBtn: $('logsBtn'),
  logsClose: $('logsClose'),
  overlay: $('overlay'),
  overlayKicker: $('overlayKicker'),
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

let state = null
let loadedUrl = null

function setDot(phase) {
  els.statusDot.className = 'dot ' + (phase === 'ready' ? 'ok' : phase === 'error' ? 'err' : 'busy')
}

function render(s) {
  state = s
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

  // The dsh UI iframe: assign src once per backend URL.
  if (s.phase === 'ready' || s.phase === 'updating') {
    els.overlay.hidden = true
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
  }

  // Update button
  if (s.phase === 'updating') {
    els.updateBtn.hidden = true
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

  els.logBody.textContent = (s.logsTail || []).join('\n')
  els.logBody.scrollTop = els.logBody.scrollHeight
}

api.onEvent((ev) => {
  if (ev.type === 'state') render(ev.state)
})

/** Update the telemetry progress bar; auto-hide shortly after 100%. */
function showProgress(pct, label, cls) {
  els.updateProgress.hidden = false
  els.updateProgress.classList.remove('done', 'fault')
  if (cls) els.updateProgress.classList.add(cls)
  els.updateProgressFill.style.width = pct + '%'
  els.updateProgressLabel.textContent = `${label} ${pct}%`
  els.updateProgress.setAttribute('aria-valuenow', String(pct))
  if (pct >= 100) {
    clearTimeout(showProgress._hide)
    showProgress._hide = setTimeout(() => {
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
  if (state && state.updateAvailable) {
    if (!window.confirm(`确定要更新内核到 ${state.latestVersion} 吗？更新后会自动重启。`)) return
    els.updateBtn.disabled = true
    showProgress(0, 'UPDATE QUEUED')
    await api.applyUpdate()
  } else {
    els.updateBtn.disabled = true
    showProgress(0, 'CHECK QUEUED')
    await api.checkUpdate()
    els.updateBtn.disabled = false
  }
})

els.workspaceBtn.addEventListener('click', async () => {
  els.workspaceBtn.disabled = true
  await api.pickWorkspace()
  els.workspaceBtn.disabled = false
})

// Click the balance cell to refresh it live (button-like affordance).
els.balanceCell.addEventListener('click', async () => {
  els.balanceChip.textContent = '…'
  const b = await api.refreshBalance()
  if (b && b.ok) {
    const symbol = b.currency === 'USD' ? '$' : '¥'
    els.balanceChip.textContent = `${symbol}${b.total.toFixed(2)}`
    els.balanceChip.className = 'cell-value' + (b.isAvailable ? '' : ' fault') + (b.low ? ' low' : '')
  } else if (b) {
    els.balanceChip.textContent = b.reason === 'no-key' ? 'NO KEY' : 'OFFLINE'
    els.balanceChip.className = 'cell-value fault'
  }
})

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

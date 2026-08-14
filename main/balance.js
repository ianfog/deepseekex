'use strict'
/**
 * DeepSeek platform balance telemetry. Reads the API key from the kernel's
 * own credentials store (`$DSH_HOME/.credentials.yaml`, the same document the
 * Models page writes) and queries the official balance endpoint. The key is
 * used in the main process only and is never sent to the renderer or logged.
 * @module deepseekex/balance
 */

const fs = require('node:fs')
const path = require('node:path')
const jsyaml = require('js-yaml')
const { httpGetJson } = require('./net.js')
const log = require('./log.js')

/** Official balance endpoint (Bearer auth). */
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
/** Balance is considered low below this amount. */
const LOW_BALANCE = 10

/** Read `DEEPSEEK_API_KEY` from the credentials document (null when absent). */
function readApiKey(dshHome) {
  try {
    const file = path.join(dshHome, '.credentials.yaml')
    if (!fs.existsSync(file)) return null
    const doc = jsyaml.load(fs.readFileSync(file, 'utf8'))
    const key = doc && typeof doc === 'object' ? doc.DEEPSEEK_API_KEY : undefined
    return typeof key === 'string' && key.trim() ? key.trim() : null
  } catch (err) {
    log.warn(`balance: credentials read failed: ${err.message}`)
    return null
  }
}

/**
 * Fetch and normalize the account balance.
 * @param {string} dshHome - the harness home the backend uses.
 * @returns {Promise<object>} a stable telemetry shape (never throws):
 *   - `{ ok: true, total, granted, toppedUp, currency, isAvailable, low, at }`
 *   - `{ ok: false, reason: 'no-key' | 'error', message, at }`
 */
async function fetchBalance(dshHome) {
  const at = new Date().toISOString()
  const key = readApiKey(dshHome)
  if (!key) return { ok: false, reason: 'no-key', message: '未配置 DEEPSEEK_API_KEY', at }

  try {
    const data = await httpGetJson(BALANCE_URL, {
      timeoutMs: 15_000,
      headers: { authorization: `Bearer ${key}` },
    })
    const info = Array.isArray(data.balance_infos) ? data.balance_infos[0] : null
    if (!info) return { ok: false, reason: 'error', message: '余额接口无数据', at }
    const total = Number(info.total_balance)
    return {
      ok: true,
      total,
      granted: Number(info.granted_balance) || 0,
      toppedUp: Number(info.topped_up_balance) || 0,
      currency: info.currency || 'CNY',
      isAvailable: data.is_available !== false,
      low: total < LOW_BALANCE,
      at,
    }
  } catch (err) {
    log.warn(`balance: query failed: ${err.message}`)
    return { ok: false, reason: 'error', message: err.message, at }
  }
}

module.exports = { readApiKey, fetchBalance, BALANCE_URL, LOW_BALANCE }

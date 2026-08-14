'use strict'
/**
 * Minimal tar extractor for npm registry tarballs. npm tarballs are gzip'd
 * ustar archives with a single top-level `package/` prefix. Handles GNU
 * long-name (`L`) entries and skips pax headers (`x`/`g`); long paths beyond
 * 100 chars are split across `prefix`+`name` per ustar. Zero runtime deps so
 * the app never needs a tar package inside the asar.
 * @module deepseekex/tar-extract
 */

const zlib = require('node:zlib')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Extract a .tgz into `destDir`.
 * @param {string} tgzPath - path to the gzip'd tar file.
 * @param {string} destDir - destination directory (created if missing).
 * @returns {Promise<string>} the archive's top-level directory name.
 */
function extractTgz(tgzPath, destDir) {
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip()
    const stream = fs.createReadStream(tgzPath).pipe(gunzip)
    let buffer = Buffer.alloc(0)
    let topLevel = null
    let longName = null

    stream.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      try {
        processBuffer()
      } catch (err) {
        reject(err)
        stream.destroy()
      }
    })
    stream.on('error', reject)
    stream.on('end', () => {
      try {
        if (buffer.length > 0) throw new Error(`tar: ${buffer.length} trailing bytes`)
        resolve(topLevel)
      } catch (err) {
        reject(err)
      }
    })

    function processBuffer() {
      for (;;) {
        if (buffer.length < 512) return
        const header = buffer.subarray(0, 512)
        // All-zero block marks the end of the archive.
        const checksumField = header.toString('ascii', 148, 156).replace(/[^0-9]/g, '')
        if (!checksumField) {
          buffer = buffer.subarray(512)
          continue
        }
        const nameField = header.toString('utf8', 0, 100).replace(/\0.*$/, '')
        const size = parseInt(header.toString('ascii', 124, 136).replace(/[^0-9]/g, ''), 8) || 0
        const typeflag = String.fromCharCode(header[156])
        const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '')
        const padded = Math.ceil(size / 512) * 512
        if (buffer.length < 512 + padded) return
        const data = buffer.subarray(512, 512 + size)
        buffer = buffer.subarray(512 + padded)

        if (typeflag === 'L') {
          longName = data.toString('utf8').replace(/\0.*$/, '')
          continue
        }
        const full = (prefix ? `${prefix}/` : '') + (longName || nameField)
        longName = null
        // Skip pax global/per-file headers and directory entries.
        if (typeflag === 'x' || typeflag === 'g' || typeflag === '5') continue
        // Regular files only ('0', '\0' legacy, '7' contiguous).
        if (typeflag !== '0' && typeflag !== '\0' && typeflag !== '7') continue
        const rel = full.replace(/^package(?:\/|$)/, '')
        if (!rel) continue
        if (!topLevel) topLevel = full.split('/')[0] || 'package'
        const out = path.join(destDir, rel)
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, data)
      }
    }
  })
}

module.exports = { extractTgz }

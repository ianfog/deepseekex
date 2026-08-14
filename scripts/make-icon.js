'use strict'
/**
 * Generate build/icon.ico (multi-size 16/24/32/48/64/128/256) for
 * electron-builder.
 *
 * Endfield-style mark: ink square, signal-yellow diamond (rotated square),
 * inner ink diamond, small yellow core — the same "calibration target"
 * language as the shell emblem. Pure Node: hand-rolled 32-bpp BMP-in-ICO
 * encoder (BITMAPINFOHEADER + bottom-up BGRA + AND mask), the classic
 * format every icon parser reads; no native image libraries needed.
 * Geometry is recomputed per size (exact, not resampled), so every size
 * stays crisp.
 *
 * Usage: node scripts/make-icon.js [out.ico]
 */

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const PNG_SIZE = 512

// ---- palette ----
const INK = [0x19, 0x19, 0x19] // #191919
const SIGNAL = [0xff, 0xfa, 0x00] // #fffa00
const PAPER = [0xf2, 0xf2, 0xf0] // #f2f2f0 (hairline accents)

/** True when (x,y) is inside the diamond |dx|+|dy| <= r centered at (cx,cy). */
function inDiamond(x, y, cx, cy, r) {
  return Math.abs(x - cx) + Math.abs(y - cy) <= r
}

/** Render one size into a top-left-origin BGRA buffer. */
function draw(size) {
  const buf = Buffer.alloc(size * size * 4)
  const c = size / 2
  const put = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4
    buf[i] = b // BGRA order for the BMP encoder
    buf[i + 1] = g
    buf[i + 2] = r
    buf[i + 3] = 255
  }

  // background: ink square
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, INK)

  // hairline corner brackets
  const bracket = size >= 48 ? 5 : size >= 24 ? 3 : 2
  const line = Math.max(1, Math.round(size / 64))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nearTL = x <= bracket && y <= bracket && (x <= line || y <= line)
      const nearTR = x >= size - 1 - bracket && y <= bracket && (x >= size - 1 - line || y <= line)
      const nearBL = x <= bracket && y >= size - 1 - bracket && (x <= line || y >= size - 1 - line)
      const nearBR = x >= size - 1 - bracket && y >= size - 1 - bracket && (x >= size - 1 - line || y >= size - 1 - line)
      if (nearTL || nearTR || nearBL || nearBR) put(x, y, PAPER)
    }
  }

  // main signal diamond, inner ink diamond, core signal diamond
  const rOuter = size * 0.42
  const rInner = size * 0.26
  const rCore = size * 0.07
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inDiamond(x, y, c, c, rOuter)) put(x, y, SIGNAL)
      if (inDiamond(x, y, c, c, rInner)) put(x, y, INK)
      if (inDiamond(x, y, c, c, rCore)) put(x, y, SIGNAL)
    }
  }

  // signal rail along the top (the shell's yellow wipe)
  if (size >= 24) {
    const railH = Math.max(1, Math.round(size / 64))
    for (let y = 0; y < railH; y++) for (let x = Math.round(size * 0.06); x < Math.round(size * 0.47); x++) put(x, y, SIGNAL)
  }

  return buf
}

/**
 * Encode a 32-bpp icon entry: BITMAPINFOHEADER + bottom-up BGRA pixels
 * (doubled height: XOR surface + AND mask) — the classic ICO format.
 */
function encodeBmpEntry(size, bgra) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0) // biSize
  header.writeInt32LE(size, 4) // biWidth
  header.writeInt32LE(size * 2, 8) // biHeight (XOR + AND)
  header.writeUInt16LE(1, 12) // biPlanes
  header.writeUInt16LE(32, 14) // biBitCount
  header.writeUInt32LE(0, 16) // biCompression (BI_RGB)
  header.writeUInt32LE(size * size * 4, 20) // biSizeImage (XOR only)
  // bottom-up rows
  const xor = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    bgra.copy(xor, y * size * 4, (size - 1 - y) * size * 4, (size - y) * size * 4)
  }
  // AND mask: 1 bit per pixel, all opaque -> 0
  const maskRowBytes = Math.ceil(size / 32) * 4
  const and = Buffer.alloc(maskRowBytes * size)
  return Buffer.concat([header, xor, and])
}

/** ICO container with classic BMP entries. */
function encodeIco(sizes, drawFn) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(sizes.length, 4) // count

  const entries = []
  const payloads = []
  let offset = 6 + 16 * sizes.length
  for (const size of sizes) {
    const bmp = encodeBmpEntry(size, drawFn(size))
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0 // colors
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bit count
    entry.writeUInt32LE(bmp.length, 8) // bytes in resource
    entry.writeUInt32LE(offset, 12) // image offset
    offset += bmp.length
    entries.push(entry)
    payloads.push(bmp)
  }
  return Buffer.concat([header, ...entries, ...payloads])
}

// ---- PNG encoder (32-bpp RGBA, color type 6) — feeds macOS icns ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

/** Encode one size as an RGBA PNG (draw() yields BGRA). */
function encodePng(size, drawFn) {
  const bgra = drawFn(size)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0) // width
  ihdr.writeUInt32BE(size, 4) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4
      const di = row + 1 + x * 4
      raw[di] = bgra[si + 2]
      raw[di + 1] = bgra[si + 1]
      raw[di + 2] = bgra[si]
      raw[di + 3] = bgra[si + 3]
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const out = process.argv[2] || path.join(__dirname, '..', 'build', 'icon.ico')
fs.mkdirSync(path.dirname(out), { recursive: true })
const ico = encodeIco(SIZES, draw)
fs.writeFileSync(out, ico)
console.log(`icon written: ${out} (${ico.length} bytes, ${SIZES.join('/')}px)`)
const pngOut = path.join(path.dirname(out), 'icon.png')
const png = encodePng(PNG_SIZE, draw)
fs.writeFileSync(pngOut, png)
console.log(`png written: ${pngOut} (${png.length} bytes, ${PNG_SIZE}px — macOS icns source)`)

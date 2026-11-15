// PR 237 review P1: whole PNG files built chunk by chunk, so a spec can place private text in any
// metadata chunk, compressed or not, and break the structure the public evidence requires.
import zlib from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** One chunk: length, type, data and the CRC of type and data. */
export function chunk(type, data = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length - 4)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A 1x1 RGB IHDR and one IDAT of its pixel row. */
export const IHDR = chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]))
export const IDAT = chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255])))
export const IEND = chunk('IEND')

/**
 * The metadata real screenshots carry (run 43746880534 shard 3 audit-failure-preparing.png from
 * XCUITest, its native-ios-*.png from simctl, and run 43741547435's native-android-*.png from
 * adb): sRGB and a 68-byte eXIf on iOS, sRGB and sBIT on Android, no text chunk on either.
 */
export const REAL_IOS_METADATA = [
  chunk('sRGB', Buffer.from([0])),
  chunk(
    'eXIf',
    Buffer.from(
      '4d4d002a000000080002011200030000000100010000876900040000000100000026000000000002a002000400000001000004b6a00300040000000100000a3e00000000',
      'hex'
    )
  ),
]
export const REAL_ANDROID_METADATA = [
  chunk('sRGB', Buffer.from([0])),
  chunk('sBIT', Buffer.from([8, 8, 8, 8])),
]

/** A whole PNG: the signature, IHDR, then `metadata`, one IDAT and IEND. */
export function pngFile(metadata = []) {
  return Buffer.concat([SIGNATURE, IHDR, ...metadata, IDAT, IEND])
}

export const tEXt = (keyword, text) =>
  chunk(
    'tEXt',
    Buffer.concat([Buffer.from(`${keyword}\0`, 'latin1'), Buffer.from(text, 'latin1')])
  )
export const zTXt = (keyword, text) =>
  chunk(
    'zTXt',
    Buffer.concat([
      Buffer.from(`${keyword}\0\0`, 'latin1'),
      zlib.deflateSync(Buffer.from(text, 'latin1')),
    ])
  )
export const iTXt = (keyword, text, { compressed = false } = {}) =>
  chunk(
    'iTXt',
    Buffer.concat([
      Buffer.from(`${keyword}\0`, 'latin1'),
      Buffer.from([compressed ? 1 : 0, 0]),
      Buffer.from('en\0\0', 'latin1'),
      compressed
        ? zlib.deflateSync(Buffer.from(text, 'utf8'))
        : Buffer.from(text, 'utf8'),
    ])
  )

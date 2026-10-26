import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodeShareCardBase64, validateShareCardPng } from '../src/share-card-png'
function chunk(name: string, data: Buffer) {
  const buffer = Buffer.alloc(data.length + 12)
  buffer.writeUInt32BE(data.length)
  buffer.write(name, 4)
  data.copy(buffer, 8)
  let crc = 0xffffffff
  for (const byte of buffer.subarray(4, -4)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  buffer.writeUInt32BE((crc ^ 0xffffffff) >>> 0, buffer.length - 4)
  return buffer
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ihdr = Buffer.from([0, 0, 4, 56, 0, 0, 5, 70, 8, 2, 0, 0, 0])
const data = chunk('IDAT', deflateSync(Buffer.alloc((1080 * 3 + 1) * 1350)))
const header = chunk('IHDR', ihdr)
const end = chunk('IEND', Buffer.alloc(0))
const png = Buffer.concat([signature, header, data, end])
describe('share card portable PNG boundary', () => {
  it('U-METADATA: accepts RGB critical-only image bytes and all base64 padding lengths', () => {
    expect(decodeShareCardBase64(png.toString('base64'))).toEqual(new Uint8Array(png))
    validateShareCardPng(png)
    for (let extra = 0; extra < 3; extra++) {
      const next = Buffer.concat([
        signature,
        header,
        chunk('IDAT', Buffer.alloc(extra + 1)),
        end,
      ])
      expect(decodeShareCardBase64(next.toString('base64'))).toEqual(new Uint8Array(next))
    }
  })
  it('U-MEDIA: rejects metadata, corrupt CRC, missing/truncated framing, disallowed dimensions and byte bounds', () => {
    const invalidCrc = Buffer.from(png)
    invalidCrc[50] = invalidCrc[50]! ^ 1
    const wrongHeader = Buffer.from(ihdr)
    wrongHeader[3] = 1
    const rgbaHeader = Buffer.from(ihdr)
    rgbaHeader[9] = 6
    const wrongDepth = Buffer.from(ihdr)
    wrongDepth[8] = 16
    const interlaced = Buffer.from(ihdr)
    interlaced[12] = 1
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.alloc(3 * 1024 * 1024 + 1),
      invalidCrc,
      png.subarray(0, -1),
      png.subarray(0, -12),
      Buffer.concat([png, Buffer.from([1])]),
      Buffer.concat([signature, data, end]),
      Buffer.concat([signature, header, header, data, end]),
      Buffer.concat([
        signature,
        header,
        chunk('tEXt', Buffer.from('private')),
        data,
        end,
      ]),
      Buffer.concat([signature, header, end]),
      Buffer.concat([signature, header, chunk('IDAT', Buffer.alloc(0)), end]),
      Buffer.concat([
        signature,
        Buffer.from([255, 255, 255, 255, 1, 2, 3, 4, 1, 2, 3, 4]),
      ]),
      ...[wrongHeader, rgbaHeader, wrongDepth, interlaced].map((h) =>
        Buffer.concat([signature, chunk('IHDR', h), data, end])
      ),
    ])
      expect(() => validateShareCardPng(bytes)).toThrow('invalid_png')
    for (const encoded of ['', '?', 'A'.repeat(4 * 1024 * 1024 + 4), 'AAA=AAAA'])
      expect(() => decodeShareCardBase64(encoded)).toThrow('invalid_png')
  })
})

import { SHARE_CARD_MAX_BYTES } from './contracts/http/share-cards'

const signature = [137, 80, 78, 71, 13, 10, 26, 10]
function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function assertHeader(bytes: Uint8Array, offset: number) {
  if (
    uint32(bytes, offset + 8) !== 1080 ||
    uint32(bytes, offset + 12) !== 1350 ||
    bytes[offset + 16] !== 8 ||
    bytes[offset + 17] !== 2 ||
    bytes.subarray(offset + 18, offset + 21).some((v) => v !== 0)
  )
    throw new Error('invalid_png')
}
function isTerminalChunk(
  name: string,
  state: string,
  seen: boolean,
  size: number,
  end: number,
  length: number
) {
  return name === 'IEND' && state === 'data' && seen && size === 0 && end === length
}
/** Full bounded PNG framing and CRC validation. Ancillary chunks are forbidden. */
export function validateShareCardPng(bytes: Uint8Array): void {
  if (
    bytes.length > SHARE_CARD_MAX_BYTES ||
    signature.some((byte, i) => bytes[i] !== byte)
  )
    throw new Error('invalid_png')
  let offset = 8
  let state: 'header' | 'data' | 'end' = 'header'
  let dataSeen = false
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('invalid_png')
    const size = uint32(bytes, offset)
    const end = offset + 12 + size
    if (end > bytes.length) throw new Error('invalid_png')
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== uint32(bytes, end - 4))
      throw new Error('invalid_png')
    if (name === 'IHDR' && state === 'header' && size === 13) {
      assertHeader(bytes, offset)
      state = 'data'
    } else if (name === 'IDAT' && state === 'data' && size > 0) dataSeen = true
    else if (isTerminalChunk(name, state, dataSeen, size, end, bytes.length))
      state = 'end'
    else throw new Error('invalid_png')
    offset = end
  }
  if (state !== 'end') throw new Error('invalid_png')
}

/** Portable bounded base64 decoder, including Hermes runtimes without atob. */
export function decodeShareCardBase64(base64: string): Uint8Array<ArrayBuffer> {
  if (
    !base64.length ||
    base64.length > 4 * Math.ceil(SHARE_CARD_MAX_BYTES / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  )
    throw new Error('invalid_png')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const output = new Uint8Array((base64.length / 4) * 3 - padding)
  let at = 0
  for (let i = 0; i < base64.length; i += 4) {
    const block =
      (alphabet.indexOf(base64[i]!) << 18) |
      (alphabet.indexOf(base64[i + 1]!) << 12) |
      (Math.max(0, alphabet.indexOf(base64[i + 2]!)) << 6) |
      Math.max(0, alphabet.indexOf(base64[i + 3]!))
    for (const shift of [16, 8, 0])
      if (at < output.length) output[at++] = (block >>> shift) & 255
  }
  validateShareCardPng(output)
  return output
}

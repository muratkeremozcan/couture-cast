// Story 6.8 Task 2 step 4 owner: rebuild the PNG from allowed chunks in `apps/api/src/modules/share-cards/share-card-png.ts`
import { validateShareCardPng } from '@couture/api-client'
/** Rebuild the encoder output using only the three permitted critical chunks. */
export function stripShareCardMetadata(encoded: Buffer): Buffer {
  const chunks: Buffer[] = [encoded.subarray(0, 8)]
  for (let at = 8; at < encoded.length; ) {
    if (at + 12 > encoded.length) throw new Error('invalid_png')
    const end = at + 12 + encoded.readUInt32BE(at)
    if (end > encoded.length) throw new Error('invalid_png')
    if (['IHDR', 'IDAT', 'IEND'].includes(encoded.toString('ascii', at + 4, at + 8)))
      chunks.push(encoded.subarray(at, end))
    at = end
  }
  const result = Buffer.concat(chunks)
  validateShareCardPng(result)
  return result
}

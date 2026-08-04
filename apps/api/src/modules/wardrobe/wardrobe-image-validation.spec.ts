import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  GarmentImageValidationError,
  verifyGarmentImage,
} from './wardrobe-image-validation'

describe('verifyGarmentImage', () => {
  let image: Buffer
  let sha256: string

  beforeAll(async () => {
    image = await sharp({
      create: {
        width: 300,
        height: 400,
        channels: 4,
        background: { r: 24, g: 96, b: 160, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    sha256 = createHash('sha256').update(image).digest('hex')
  })

  it('accepts a decodable image that exactly matches the server declaration', async () => {
    await expect(
      verifyGarmentImage(image, {
        fileSizeBytes: image.length,
        mimeType: 'image/png',
        sha256,
        widthPx: 300,
        heightPx: 400,
      })
    ).resolves.toMatchObject({ format: 'png', widthPx: 300, heightPx: 400 })
  })

  it.each([
    ['IMAGE_SIZE_MISMATCH', () => ({ fileSizeBytes: image.length + 1 })],
    ['UNSUPPORTED_IMAGE_TYPE', () => ({ mimeType: 'image/jpeg' as const })],
    ['IMAGE_CHECKSUM_MISMATCH', () => ({ sha256: '0'.repeat(64) })],
    ['IMAGE_DIMENSIONS_INVALID', () => ({ widthPx: 301 })],
  ])('rejects %s before persistence', async (code, buildOverride) => {
    await expect(
      verifyGarmentImage(image, {
        fileSizeBytes: image.length,
        mimeType: 'image/png',
        sha256,
        widthPx: 300,
        heightPx: 400,
        ...buildOverride(),
      })
    ).rejects.toEqual(new GarmentImageValidationError(code))
  })
})

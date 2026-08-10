import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { GarmentImageValidationError } from './wardrobe-image-validation'
import { verifySilhouettePhoto } from './wardrobe-silhouette-image-validation'

describe('verifySilhouettePhoto', () => {
  let portrait: Buffer
  let portraitSha256: string
  let landscape: Buffer
  let landscapeSha256: string

  beforeAll(async () => {
    portrait = await sharp({
      create: {
        width: 300,
        height: 800,
        channels: 4,
        background: { r: 24, g: 96, b: 160, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    portraitSha256 = createHash('sha256').update(portrait).digest('hex')

    landscape = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 4,
        background: { r: 24, g: 96, b: 160, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    landscapeSha256 = createHash('sha256').update(landscape).digest('hex')
  })

  it('4.4-UNIT-02 accepts a decodable, portrait-framed image that matches the declaration', async () => {
    await expect(
      verifySilhouettePhoto(portrait, {
        fileSizeBytes: portrait.length,
        mimeType: 'image/png',
        sha256: portraitSha256,
        widthPx: 300,
        heightPx: 800,
      })
    ).resolves.toMatchObject({ format: 'png', widthPx: 300, heightPx: 800 })
  })

  it('4.4-UNIT-02 rejects a landscape-framed photo (heightPx < widthPx * 1.2)', async () => {
    await expect(
      verifySilhouettePhoto(landscape, {
        fileSizeBytes: landscape.length,
        mimeType: 'image/png',
        sha256: landscapeSha256,
        widthPx: 800,
        heightPx: 400,
      })
    ).rejects.toEqual(new GarmentImageValidationError('IMAGE_NOT_PORTRAIT_FRAMED'))
  })

  it.each([
    ['IMAGE_SIZE_MISMATCH', () => ({ fileSizeBytes: portrait.length + 1 })],
    ['UNSUPPORTED_IMAGE_TYPE', () => ({ mimeType: 'image/jpeg' as const })],
    ['IMAGE_CHECKSUM_MISMATCH', () => ({ sha256: '0'.repeat(64) })],
    ['IMAGE_DIMENSIONS_INVALID', () => ({ widthPx: 301 })],
  ])('4.4-UNIT-02 rejects %s before persistence', async (code, buildOverride) => {
    await expect(
      verifySilhouettePhoto(portrait, {
        fileSizeBytes: portrait.length,
        mimeType: 'image/png',
        sha256: portraitSha256,
        widthPx: 300,
        heightPx: 800,
        ...buildOverride(),
      })
    ).rejects.toEqual(new GarmentImageValidationError(code))
  })
})

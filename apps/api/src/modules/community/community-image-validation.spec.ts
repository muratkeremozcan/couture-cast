// Learning path Step 38: Community feed by climate band.
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  CommunityImageValidationError,
  verifyAndNormalizeCommunityImage,
} from './community-image-validation'

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

describe('verifyAndNormalizeCommunityImage', () => {
  let jpeg: Buffer
  let png: Buffer
  let tinyJpeg: Buffer

  beforeAll(async () => {
    const canvas = (width: number, height: number) =>
      sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 120, g: 140, b: 160 },
        },
      })

    jpeg = await canvas(512, 640).jpeg({ quality: 100 }).toBuffer()
    png = await canvas(512, 640).png().toBuffer()
    tinyJpeg = await canvas(64, 64).jpeg().toBuffer()
  })

  it('accepts bytes that match the declaration and returns the re-encoded object', async () => {
    const result = await verifyAndNormalizeCommunityImage(jpeg, {
      byteSize: jpeg.length,
      mimeType: 'image/jpeg',
      sha256: sha256(jpeg),
    })

    expect(result.mimeType).toBe('image/jpeg')
    expect(result.widthPx).toBe(512)
    expect(result.heightPx).toBe(640)
    // The returned checksum describes the RE-ENCODED bytes, which is what must be
    // persisted: the client's declaration describes bytes that no longer exist.
    expect(result.sha256).toBe(sha256(result.bytes))
    expect(result.byteSize).toBe(result.bytes.length)
  })

  it('rejects a byte size that does not match the declaration', async () => {
    await expect(
      verifyAndNormalizeCommunityImage(jpeg, {
        byteSize: jpeg.length + 1,
        mimeType: 'image/jpeg',
        sha256: sha256(jpeg),
      })
    ).rejects.toThrow(expect.objectContaining({ code: 'IMAGE_SIZE_MISMATCH' }) as Error)
  })

  it('rejects PNG bytes declared as a JPEG', async () => {
    // The MIME is sniffed from the bytes, so a declaration cannot lie about it.
    await expect(
      verifyAndNormalizeCommunityImage(png, {
        byteSize: png.length,
        mimeType: 'image/jpeg',
        sha256: sha256(png),
      })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_IMAGE_TYPE' }) as Error
    )
  })

  it('rejects a checksum that does not describe the uploaded bytes', async () => {
    await expect(
      verifyAndNormalizeCommunityImage(jpeg, {
        byteSize: jpeg.length,
        mimeType: 'image/jpeg',
        sha256: 'a'.repeat(64),
      })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'IMAGE_CHECKSUM_MISMATCH' }) as Error
    )
  })

  it('rejects an image below the minimum dimension', async () => {
    await expect(
      verifyAndNormalizeCommunityImage(tinyJpeg, {
        byteSize: tinyJpeg.length,
        mimeType: 'image/jpeg',
        sha256: sha256(tinyJpeg),
      })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'IMAGE_DIMENSIONS_INVALID' }) as Error
    )
  })

  it('rejects bytes that sniff as an image but do not decode', async () => {
    const truncated = jpeg.subarray(0, 64)
    await expect(
      verifyAndNormalizeCommunityImage(truncated, {
        byteSize: truncated.length,
        mimeType: 'image/jpeg',
        sha256: sha256(truncated),
      })
    ).rejects.toBeInstanceOf(CommunityImageValidationError)
  })

  it('rejects an empty upload', async () => {
    const empty = Buffer.alloc(0)
    await expect(
      verifyAndNormalizeCommunityImage(empty, {
        byteSize: 0,
        mimeType: 'image/jpeg',
        sha256: sha256(empty),
      })
    ).rejects.toThrow(expect.objectContaining({ code: 'IMAGE_SIZE_MISMATCH' }) as Error)
  })

  it('accepts a PNG declared as a PNG and keeps the format', async () => {
    const result = await verifyAndNormalizeCommunityImage(png, {
      byteSize: png.length,
      mimeType: 'image/png',
      sha256: sha256(png),
    })

    expect(result.mimeType).toBe('image/png')
    expect(result.widthPx).toBe(512)
  })
})

// Learning path Step 38: Community feed by climate band.
import { createHash } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import {
  CommunityImageValidationError,
  verifyAndNormalizeCommunityImage,
  verifyCommunityImage,
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
  it('U-MEDIA rejects an actual decoded two-frame WebP with a matching MIME and checksum', async () => {
    const frames = Buffer.alloc(256 * 512 * 3, 200)
    frames.fill(20, 256 * 256 * 3)
    const bytes = await sharp(frames, {
      raw: { width: 256, height: 512, channels: 3, pageHeight: 256 },
    })
      .webp({ loop: 0 })
      .toBuffer()
    expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(2)
    await expect(
      verifyAndNormalizeCommunityImage(bytes, {
        byteSize: bytes.length,
        mimeType: 'image/webp',
        sha256: sha256(bytes),
      })
    ).rejects.toBeInstanceOf(CommunityImageValidationError)
  })
})

describe('verifyCommunityImage', () => {
  let complete: Buffer

  const declarationOf = (bytes: Buffer) => ({
    byteSize: bytes.length,
    mimeType: 'image/jpeg' as const,
    sha256: sha256(bytes),
  })
  const encoders = ['toFormat', 'jpeg', 'png', 'webp'] as const
  const encodes = () => {
    const prototype = sharp.prototype as Record<(typeof encoders)[number], () => unknown>
    return encoders.map((encoder) => vi.spyOn(prototype, encoder))
  }
  const expectNoEncode = (spies: ReturnType<typeof encodes>) => {
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  }

  beforeAll(async () => {
    const pixels = Buffer.from(
      Array.from({ length: 512 * 640 * 3 }, (_, index) => (index * 2654435761) % 251)
    )
    complete = await sharp(pixels, { raw: { width: 512, height: 640, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts a complete image and encodes nothing', async () => {
    const spy = encodes()
    await expect(
      verifyCommunityImage(complete, declarationOf(complete))
    ).resolves.toEqual({ mimeType: 'image/jpeg' })
    expectNoEncode(spy)
  })

  it.each([
    ['a quarter', 0.25],
    ['half', 0.5],
    ['nearly all', 0.98],
  ])(
    'refuses a matching declaration when only %s of the bytes arrived, though the header reads',
    async (_label, fraction) => {
      const truncated = complete.subarray(0, Math.floor(complete.length * fraction))
      const metadata = await sharp(truncated).metadata()
      expect(metadata.width, 'the fixture must keep a readable header').toBe(512)

      const spy = encodes()
      await expect(
        verifyCommunityImage(truncated, declarationOf(truncated))
      ).rejects.toMatchObject({ code: 'IMAGE_DECODE_FAILED' })
      expectNoEncode(spy)
    }
  )
})

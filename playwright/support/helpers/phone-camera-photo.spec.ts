import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writePhoneJpegWithin } from './phone-camera-photo'
import { VERCEL_FUNCTION_MAX_BODY_BYTES } from './vercel-function-body-limit'

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'phone-photo-spec-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writePhoneJpegWithin', () => {
  it('writes a 12 MP portrait JPEG whose size is over the Vercel function body cap but under 6.5 MB', async () => {
    const file = path.join(dir, 'over-cap.jpg')
    const minBytes = VERCEL_FUNCTION_MAX_BODY_BYTES + 150_000
    const written = await writePhoneJpegWithin(file, {
      width: 3024,
      height: 4032,
      minBytes,
      maxBytes: 6_500_000,
    })

    expect(written).toBeGreaterThanOrEqual(minBytes)
    expect(written).toBeLessThanOrEqual(6_500_000)
    expect((await stat(file)).size).toBe(written)
    const metadata = await sharp(file).metadata()
    expect({
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
    }).toEqual({ format: 'jpeg', width: 3024, height: 4032 })
  }, 120_000)

  it('throws, naming what it tried, when no quality gives the window', async () => {
    await expect(
      writePhoneJpegWithin(path.join(dir, 'never.jpg'), {
        width: 256,
        height: 256,
        minBytes: 500_000_000,
        maxBytes: 600_000_000,
      })
    ).rejects.toThrow(
      /No JPEG quality gives 500000000 to 600000000 bytes at 256x256 \(q70=/
    )
  })
})

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const moderationFixtures = path.resolve(
  __dirname,
  '../../../apps/api/test/fixtures/community-moderation/v1'
)

/** A 12 MP phone camera frame, as an Android camera app saves it (4:3 landscape sensor). */
export const PHONE_CAMERA_FRAME = { width: 4032, height: 3024 } as const

export type PhonePhotoOptions = {
  width: number
  height: number
  format: 'jpeg' | 'png'
  /**
   * The picture under the grain. Default: a denim garment laid on a linen sheet, filling half
   * the frame. Any image path is stretched to the full frame instead.
   */
  subjectPath?: string
  /** The most each channel moves by sensor grain, in levels. */
  grain?: number
}

async function garmentOnSheet(width: number, height: number): Promise<Buffer> {
  const garmentWidth = Math.round(width * 0.5)
  const garmentHeight = Math.round(height * 0.7)
  const [sheet, garment] = await Promise.all([
    sharp(path.join(moderationFixtures, 'safe-linen-oat-768x512.jpg'))
      .resize(width, height, { fit: 'fill' })
      .toBuffer(),
    sharp(path.join(moderationFixtures, 'safe-denim-indigo-512x512.jpg'))
      .resize(garmentWidth, garmentHeight, { fit: 'fill' })
      .toBuffer(),
  ])
  return sharp(sheet)
    .composite([
      {
        input: garment,
        left: Math.round((width - garmentWidth) / 2),
        top: Math.round((height - garmentHeight) / 2),
      },
    ])
    .toBuffer()
}

/** The frame's pixels with sensor grain applied; deterministic, so every run sees the same. */
async function grainedPixels(
  options: Pick<PhonePhotoOptions, 'width' | 'height' | 'subjectPath' | 'grain'>
) {
  const { width, height, subjectPath, grain = 8 } = options
  const subject = subjectPath
    ? await sharp(subjectPath).resize(width, height, { fit: 'fill' }).toBuffer()
    : await garmentOnSheet(width, height)
  const { data, info } = await sharp(subject)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  // mulberry32: a seeded generator with no short period, so PNG finds no pattern to fold.
  const levels = grain * 2 + 1
  let state = 0x9e3779b9
  for (let index = 0; index < data.length; index++) {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    const random = ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
    const shift = Math.floor(random * levels) - grain
    data[index] = Math.max(0, Math.min(255, data[index]! + shift))
  }
  return { data, info }
}

/**
 * Writes an image shaped like a photo straight off a phone, at a phone's pixel size, with
 * sensor grain. The grain matters: a phone photo carries noise that PNG cannot compress, and
 * a smooth upscale would understate the prepared upload several times over. The output is
 * deterministic, so every run uploads the same bytes. Returns the file's size in bytes.
 */
export async function writePhonePhoto(
  outputPath: string,
  { width, height, format, subjectPath, grain = 8 }: PhonePhotoOptions
): Promise<number> {
  const { data, info } = await grainedPixels({ width, height, subjectPath, grain })
  const encoded = sharp(data, { raw: info })
  const bytes =
    format === 'jpeg'
      ? await encoded.jpeg({ quality: 90 }).toBuffer()
      : await encoded.png().toBuffer()
  await writeFile(outputPath, bytes)
  return bytes.length
}

/**
 * A phone photo as a JPEG whose size lies in `[minBytes, maxBytes]`, found by searching the
 * encoder quality over one grained frame. A test that must prove a request body is over a
 * platform cap, without sending more than it needs to, asks for a size and gets it, whatever
 * the encoder's output size does between versions. Throws when no quality lands in the window,
 * so a drifted encoder fails the test that depends on the size instead of weakening it.
 * Returns the file's size in bytes.
 */
export async function writePhoneJpegWithin(
  outputPath: string,
  options: {
    width: number
    height: number
    minBytes: number
    maxBytes: number
    grain?: number
  }
): Promise<number> {
  const { width, height, minBytes, maxBytes, grain } = options
  const { data, info } = await grainedPixels({ width, height, grain })
  let low = 40
  let high = 100
  const tried: string[] = []
  while (low <= high) {
    const quality = Math.floor((low + high) / 2)
    const bytes = await sharp(data, { raw: info }).jpeg({ quality }).toBuffer()
    tried.push(`q${quality}=${bytes.length}`)
    if (bytes.length >= minBytes && bytes.length <= maxBytes) {
      await writeFile(outputPath, bytes)
      return bytes.length
    }
    if (bytes.length < minBytes) low = quality + 1
    else high = quality - 1
  }
  throw new Error(
    `No JPEG quality gives ${minBytes} to ${maxBytes} bytes at ${width}x${height} (${tried.join(', ')}).`
  )
}

/** A 12 MP garment photo as the phone's camera app saves it: JPEG, light grain. */
export function writePhoneCameraPhoto(outputPath: string): Promise<number> {
  return writePhonePhoto(outputPath, { ...PHONE_CAMERA_FRAME, format: 'jpeg' })
}

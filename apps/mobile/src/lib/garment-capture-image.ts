import { maskGarmentBackground } from '@couture/utils'
import { File } from 'expo-file-system'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { decode, encode } from 'fast-png'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
// Keep the native pixel analysis and PNG encoding bounded on the JS thread.
const MAX_CUTOUT_EDGE = 1024
const MAX_ORIGINAL_EDGE = 2048

export type GarmentCropRatio = '1:1' | '4:3'
export type GarmentCaptureSource = { uri: string; width: number; height: number }

export type PreparedGarmentImage = {
  file: File
  width: number
  height: number
  mimeType: 'image/jpeg' | 'image/png'
  backgroundRemoved: boolean
}

export function releaseGarmentCaptureFile(file: File) {
  try {
    if (file.exists) file.delete()
  } catch {
    // The cache file can also be evicted by the device.
  }
}

function cropForAspect(image: GarmentCaptureSource, aspectRatio: GarmentCropRatio) {
  const targetRatio = aspectRatio === '1:1' ? 1 : 3 / 4
  const sourceRatio = image.width / image.height
  const width = sourceRatio > targetRatio ? image.height * targetRatio : image.width
  const height = sourceRatio > targetRatio ? image.height : image.width / targetRatio
  return {
    originX: Math.round((image.width - width) / 2),
    originY: Math.round((image.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  }
}

async function cropImage(
  source: GarmentCaptureSource,
  aspectRatio: GarmentCropRatio,
  format: SaveFormat.PNG | SaveFormat.JPEG,
  maxEdge: number
): Promise<PreparedGarmentImage> {
  const crop = cropForAspect(source, aspectRatio)
  const scale = Math.min(1, maxEdge / Math.max(crop.width, crop.height))
  const resize = {
    width: Math.round(crop.width * scale),
    height: Math.round(crop.height * scale),
  }
  if (resize.width < 256 || resize.height < 256) throw new Error('Crop is too small')
  const image = await manipulateAsync(source.uri, [{ crop }, { resize }], {
    compress: 0.9,
    format,
  })
  return {
    file: new File(image.uri),
    width: image.width,
    height: image.height,
    mimeType: format === SaveFormat.PNG ? 'image/png' : 'image/jpeg',
    backgroundRemoved: false,
  }
}

function toRgba(png: ReturnType<typeof decode>): Uint8Array | Uint8ClampedArray | null {
  const { channels, data, depth, transparency, palette, width, height } = png
  if (depth !== 8 || data instanceof Uint16Array || transparency || palette) return null
  if (channels === 4) return data
  if (channels !== 3) return null
  const rgba = new Uint8Array(width * height * 4)
  for (let from = 0, to = 0; to < rgba.length; from += 3, to += 4) {
    rgba[to] = data[from]!
    rgba[to + 1] = data[from + 1]!
    rgba[to + 2] = data[from + 2]!
    rgba[to + 3] = 255
  }
  return rgba
}

async function applyCutout(prepared: PreparedGarmentImage, signal: AbortSignal) {
  // The decoder sees only bounded PNGs re-encoded by the platform image manipulator.
  const bytes = await prepared.file.bytes()
  if (signal.aborted || bytes.byteLength > MAX_IMAGE_BYTES) return false
  const png = decode(bytes)
  if (png.width !== prepared.width || png.height !== prepared.height) return false
  const data = toRgba(png)
  if (!data) return false

  const removed = maskGarmentBackground(data, png.width, png.height)
  if (!removed) return false
  // Fully transparent pixels can still contain RGB in a PNG. Remove the hidden backdrop.
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) data.fill(0, offset, offset + 3)
  }
  const cutout = encode(
    { width: png.width, height: png.height, data },
    { zlib: { level: 3 } }
  )
  if (cutout.byteLength > MAX_IMAGE_BYTES) return false
  prepared.file.write(cutout)
  prepared.backgroundRemoved = true
  return true
}

export async function prepareGarmentCaptureImage(
  source: GarmentCaptureSource,
  aspectRatio: GarmentCropRatio,
  useBgCleanup: boolean,
  signal: AbortSignal
): Promise<PreparedGarmentImage | null> {
  if (useBgCleanup && !signal.aborted) {
    let cutout: PreparedGarmentImage | undefined
    try {
      cutout = await cropImage(source, aspectRatio, SaveFormat.PNG, MAX_CUTOUT_EDGE)
      if (!signal.aborted && (await applyCutout(cutout, signal))) return cutout
    } catch {
      // A failed cutout falls back to a regular crop.
    }
    if (cutout) releaseGarmentCaptureFile(cutout.file)
  }
  if (signal.aborted) return null
  const original = await cropImage(
    source,
    aspectRatio,
    SaveFormat.JPEG,
    MAX_ORIGINAL_EDGE
  )
  if (!signal.aborted) return original
  releaseGarmentCaptureFile(original.file)
  return null
}

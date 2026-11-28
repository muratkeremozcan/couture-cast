import { maskGarmentBackground } from '@couture/utils'
import { Buffer } from 'buffer'
import { File, Paths } from 'expo-file-system'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { PNG } from 'pngjs/browser'

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

/** Expo ImagePicker copies assets into its own app cache directory on iOS and Android. */
export function releaseImagePickerCopy(uri: string) {
  try {
    const cache = Paths.cache
    const cacheUri = typeof cache === 'string' ? cache : cache?.uri
    if (!cacheUri) return
    const prefix = `${cacheUri.replace(/\/$/, '')}/ImagePicker/`
    if (
      uri.startsWith(prefix) &&
      /^[a-z0-9][a-z0-9_.-]*$/i.test(uri.slice(prefix.length))
    ) {
      releaseGarmentCaptureFile(new File(uri))
    }
  } catch {
    // Some runtimes cannot resolve the native cache directory.
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

async function applyCutout(prepared: PreparedGarmentImage, signal: AbortSignal) {
  // The decoder sees only bounded PNGs re-encoded by the platform image manipulator.
  const bytes = await prepared.file.bytes()
  if (signal.aborted || bytes.byteLength > MAX_IMAGE_BYTES) return false
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (!matchesCutoutHeader(input, prepared)) return false
  const { width, height, data } = PNG.sync.read(input)

  const removed = maskGarmentBackground(data, width, height)
  if (!removed) return false
  // Fully transparent pixels can still contain RGB in a PNG. Remove the hidden backdrop.
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) data.fill(0, offset, offset + 3)
  }
  const cutout = PNG.sync.write({ width, height, data }, { deflateLevel: 3 })
  if (cutout.byteLength > MAX_IMAGE_BYTES) return false
  prepared.file.write(cutout)
  prepared.backgroundRemoved = true
  return true
}

function matchesCutoutHeader(input: Buffer, prepared: PreparedGarmentImage) {
  // Read the fixed IHDR fields before invoking the decoder. Only decode the expected,
  // non-interlaced crop. pngjs checks the signature and CRCs.
  return (
    input.length >= 33 &&
    input.readUInt32BE(8) === 13 &&
    input.toString('ascii', 12, 16) === 'IHDR' &&
    input.readUInt32BE(16) === prepared.width &&
    input.readUInt32BE(20) === prepared.height &&
    Math.max(prepared.width, prepared.height) <= MAX_CUTOUT_EDGE &&
    input[28] === 0
  )
}

async function prepareCrop(
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

// Expo cannot cancel an in-flight decode. Drain it before starting the newest preview,
// including when the previous capture sheet closed. Superseded requests skip preparation.
let preparationQueue = Promise.resolve()

export function prepareGarmentCaptureImage(
  source: GarmentCaptureSource,
  aspectRatio: GarmentCropRatio,
  useBgCleanup: boolean,
  signal: AbortSignal
): Promise<PreparedGarmentImage | null> {
  const prepared = preparationQueue.then(() =>
    prepareCrop(source, aspectRatio, useBgCleanup, signal)
  )
  preparationQueue = prepared.then(
    () => undefined,
    () => undefined
  )
  return prepared
}

import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { OnnxValue } from 'onnxruntime-node'
import sharp from 'sharp'
import {
  FLAT_LAY_MAX_MASK_BYTES,
  FLAT_LAY_MAX_PHOTO_BYTES,
  FLAT_LAY_MAX_PIECES,
  type GarmentCategory,
} from '@couture/api-client/contracts/http'
import { findFlatLayComponents } from '@couture/utils'

const MODEL_URL =
  'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx'
const MODEL_SHA256 = '427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7'
const MODEL_BYTE_LIMIT = 20 * 1024 * 1024
const MODEL_EDGE = 416
const MODEL_OUTPUT_ROWS = 3549
const MODEL_OUTPUT_COLUMNS = 85
const PERSON_THRESHOLD = 0.15
// The CPU sigmoid can undershoot zero by one float32 rounding step.
const PROBABILITY_ROUNDING = 2 ** -23
const ANALYSIS_EDGE = 640
const DETECTION_LIMIT = 2

type Raster = { data: Buffer; width: number; height: number }
type Components = NonNullable<ReturnType<typeof findFlatLayComponents>>
export type FlatLayDetection =
  | { kind: 'person' }
  | { kind: 'uncertain' }
  | { kind: 'accepted'; items: { bytes: Buffer; category: GarmentCategory | null }[] }

async function loadModel() {
  const [runtime, response] = await Promise.all([
    import('onnxruntime-node'),
    fetch(MODEL_URL, { signal: AbortSignal.timeout(8_000) }),
  ])
  if (!response.ok || !response.body) throw new Error('Flat-lay model unavailable')
  const reader = response.body.getReader()
  const bytes = Buffer.alloc(MODEL_BYTE_LIMIT)
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (length + value.length > bytes.length)
        throw new Error('Flat-lay model too large')
      bytes.set(value, length)
      length += value.length
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const weights = bytes.subarray(0, length)
  if (createHash('sha256').update(weights).digest('hex') !== MODEL_SHA256) {
    throw new Error('Flat-lay model checksum mismatch')
  }
  const session = await runtime.InferenceSession.create(weights, {
    executionProviders: ['cpu'],
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  })
  return { session, Tensor: runtime.Tensor }
}

async function decodePhoto(photo: Buffer): Promise<Raster | null> {
  if (photo.length === 0 || photo.length > FLAT_LAY_MAX_PHOTO_BYTES) return null
  const image = sharp(photo, { failOn: 'warning', limitInputPixels: 4096 ** 2 })
  const metadata = await image.metadata()
  if (
    !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
    (metadata.pages ?? 1) !== 1 ||
    Math.min(metadata.width, metadata.height) < 256
  )
    return null
  const { data, info } = await image
    .autoOrient()
    .resize(ANALYSIS_EDGE, ANALYSIS_EDGE, { fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

async function modelInput({ data, width, height }: Raster) {
  const scale = MODEL_EDGE / Math.max(width, height)
  const { data: rgb, info } = await sharp(data, { raw: { width, height, channels: 4 } })
    .resize(
      Math.max(1, Math.floor(width * scale)),
      Math.max(1, Math.floor(height * scale)),
      {
        fit: 'fill',
        kernel: 'linear',
      }
    )
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const plane = MODEL_EDGE ** 2
  const bgr = new Float32Array(plane * 3).fill(114)
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const source = (y * info.width + x) * 3
      const target = y * MODEL_EDGE + x
      bgr[target] = rgb[source + 2]!
      bgr[target + plane] = rgb[source + 1]!
      bgr[target + 2 * plane] = rgb[source]!
    }
  }
  return bgr
}

function classifyPeople(value: OnnxValue | undefined) {
  if (
    !value ||
    value.type !== 'float32' ||
    value.dims.length !== 3 ||
    value.dims[0] !== 1 ||
    value.dims[1] !== MODEL_OUTPUT_ROWS ||
    value.dims[2] !== MODEL_OUTPUT_COLUMNS ||
    !(value.data instanceof Float32Array) ||
    value.data.length !== MODEL_OUTPUT_ROWS * MODEL_OUTPUT_COLUMNS
  )
    throw new Error('Invalid flat-lay model output')

  const scores = value.data
  let detected = false
  for (let row = 0; row < MODEL_OUTPUT_ROWS; row++) {
    const offset = row * MODEL_OUTPUT_COLUMNS
    const objectness = scores[offset + 4]!
    const person = scores[offset + 5]!
    if (modelProbability(objectness) * modelProbability(person) >= PERSON_THRESHOLD) {
      detected = true
    }
  }
  return detected
}

function modelProbability(value: number) {
  if (!(value >= -PROBABILITY_ROUNDING && value <= 1 + PROBABILITY_ROUNDING)) {
    throw new Error('Invalid flat-lay model score')
  }
  return Math.max(0, Math.min(1, value))
}

async function encodeMask(
  raster: Raster,
  labels: Uint8Array,
  piece: Components['pieces'][number]
) {
  const padding = Math.max(3, Math.round(Math.max(piece.width, piece.height) * 0.035))
  const width = Math.max(256, piece.width + 2 * padding)
  const height = Math.max(256, piece.height + 2 * padding)
  const left = Math.floor((width - piece.width) / 2)
  const top = Math.floor((height - piece.height) / 2)
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < piece.height; y++) {
    for (let x = 0; x < piece.width; x++) {
      const source = (piece.top + y) * raster.width + piece.left + x
      if (labels[source] !== piece.label) continue
      const target = ((top + y) * width + left + x) * 4
      raster.data.copy(pixels, target, source * 4, source * 4 + 4)
    }
  }
  const image = sharp(pixels, { raw: { width, height, channels: 4 } })
  for (const quality of [86, 72]) {
    const bytes = await image.webp({ quality, alphaQuality: 100 }).toBuffer()
    if (bytes.length <= FLAT_LAY_MAX_MASK_BYTES) return bytes
  }
  return null
}

@Injectable()
export class FlatLayDetector {
  private model?: ReturnType<typeof loadModel>
  private retryModelAfter = 0
  private active = 0

  protected loadModel() {
    return loadModel()
  }

  private getModel() {
    if (!this.model && Date.now() >= this.retryModelAfter) {
      this.model = this.loadModel().catch((error: unknown) => {
        this.retryModelAfter = Date.now() + 30_000
        this.model = undefined
        throw error
      })
    }
    return this.model
  }

  async detect(photo: Buffer): Promise<FlatLayDetection> {
    if (this.active >= DETECTION_LIMIT) return { kind: 'uncertain' }
    this.active++
    try {
      const raster = await decodePhoto(photo)
      if (!raster) return { kind: 'uncertain' }
      const model = await this.getModel()
      if (!model) return { kind: 'uncertain' }
      const tensor = new model.Tensor('float32', await modelInput(raster), [
        1,
        3,
        MODEL_EDGE,
        MODEL_EDGE,
      ])
      try {
        const output = await model.session.run({ images: tensor })
        try {
          if (classifyPeople(output.output)) return { kind: 'person' }
        } finally {
          for (const value of Object.values(output)) value.dispose()
        }
      } finally {
        tensor.dispose()
      }
      const shape = findFlatLayComponents(
        raster.data,
        raster.width,
        raster.height,
        FLAT_LAY_MAX_PIECES
      )
      if (!shape) return { kind: 'uncertain' }
      const items: Extract<FlatLayDetection, { kind: 'accepted' }>['items'] = []
      for (const piece of shape.pieces) {
        const bytes = await encodeMask(raster, shape.labels, piece)
        if (!bytes) return { kind: 'uncertain' }
        items.push({ bytes, category: null })
      }
      return { kind: 'accepted', items }
    } catch {
      return { kind: 'uncertain' }
    } finally {
      this.active--
    }
  }
}

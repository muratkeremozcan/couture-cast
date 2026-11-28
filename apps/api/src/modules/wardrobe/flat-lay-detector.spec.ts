// Learning path Step 86: Several garments from one flat-lay photo.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-86-several-garments-from-one-flat-lay-photo
import { Tensor, type InferenceSession } from 'onnxruntime-node'
import sharp from 'sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { FlatLayDetector } from './flat-lay-detector'

const edge = 416
const rows = 3549
const columns = 85
const lastRow = (rows - 1) * columns
const sourceWidth = 320
const sourceHeight = 256

function flatLayPhoto() {
  const svg =
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="256">
    <rect width="320" height="256" fill="#f1e9e5"/>
    <rect x="32" y="42" width="80" height="84" fill="#aa2233"/>
    <rect x="166" y="90" width="104" height="104" fill="#2244aa"/>
  </svg>`)
  return sharp(svg)
    .withExif({ IFD0: { Artist: 'synthetic-private-artist' } })
    .png()
    .toBuffer()
}

function output(objectness = 0, person = 0, otherClass = 0) {
  const data = new Float32Array(rows * columns)
  data[lastRow + 4] = objectness
  data[lastRow + 5] = person
  data[lastRow + 6] = otherClass
  return new Tensor('float32', data, [1, rows, columns])
}

function detector(result: Tensor) {
  let shape: readonly number[] | undefined
  let backdrop: number[] | undefined
  let padding: number[] | undefined
  const run = vi.fn((feeds: InferenceSession.FeedsType) => {
    const images = feeds.images as Tensor
    shape = [...images.dims]
    const values = images.data as Float32Array
    const plane = edge * edge
    const lastPixel = plane - 1
    backdrop = [values[0]!, values[plane]!, values[plane * 2]!]
    padding = [
      values[lastPixel]!,
      values[plane + lastPixel]!,
      values[plane * 2 + lastPixel]!,
    ]
    return Promise.resolve({ output: result })
  })
  const session: InferenceSession = {
    run,
    release: vi.fn().mockResolvedValue(undefined),
    startProfiling: vi.fn(),
    endProfiling: vi.fn(),
    inputNames: ['images'],
    outputNames: ['output'],
  }
  class TestDetector extends FlatLayDetector {
    protected override loadModel() {
      return Promise.resolve({ session, Tensor })
    }
  }
  return {
    instance: new TestDetector(),
    run,
    input: () => ({ shape, backdrop, padding }),
  }
}

async function observedMask(bytes: Buffer) {
  const image = sharp(bytes)
  const metadata = await image.metadata()
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  let opaquePixels = 0
  for (let offset = 3; offset < data.length; offset += 4) {
    opaquePixels += Number(data[offset] === 255)
  }
  return { metadata, info, opaquePixels, cornerAlpha: data[3] }
}

describe('CC-7.29 local flat-lay detector', () => {
  let photo: Buffer

  beforeAll(async () => {
    photo = await flatLayPhoto()
  })

  it('[P0] [7.29-REJECT] returns person when the weighted person score crosses the threshold', async () => {
    const { instance, run } = detector(output(0.5, 0.5))

    expect(await instance.detect(photo)).toEqual({ kind: 'person' })
    expect(run).toHaveBeenCalledOnce()
  })

  it('[P0] [7.29-PRIVATE] emits two isolated WebP masks when the person score is low', async () => {
    const { instance, input } = detector(output(0.9, 0.05, 0.95))

    const result = await instance.detect(photo)

    expect(input()).toEqual({
      shape: [1, 3, edge, edge],
      backdrop: [229, 233, 241],
      padding: [114, 114, 114],
    })
    const source = await sharp(photo).metadata()
    expect(source).toMatchObject({ width: sourceWidth, height: sourceHeight })
    expect(source.exif).toBeInstanceOf(Buffer)
    expect(result.kind).toBe('accepted')
    if (result.kind !== 'accepted') throw new Error('Expected isolated flat-lay masks')
    expect(result.items.map(({ category }) => category)).toEqual([null, null])
    const masks = await Promise.all(result.items.map(({ bytes }) => observedMask(bytes)))
    expect(masks.map(({ opaquePixels }) => opaquePixels)).toEqual([80 * 84, 104 * 104])
    for (const { metadata, info, cornerAlpha } of masks) {
      expect(metadata.format).toBe('webp')
      expect(metadata.exif).toBeUndefined()
      expect(metadata.xmp).toBeUndefined()
      expect(info.channels).toBe(4)
      expect(cornerAlpha).toBe(0)
    }
  })

  it.each([
    {
      case: 'missing rows',
      tensor: () => new Tensor('float32', new Float32Array(columns), [1, 1, columns]),
    },
    { case: 'NaN objectness', tensor: () => output(NaN, 0.5) },
    { case: 'out-of-range probabilities', tensor: () => output(-0.5, -0.5) },
  ])('[P0] [7.29-REJECT] abstains on $case from the model', async ({ tensor }) => {
    const { instance, run } = detector(tensor())

    expect(await instance.detect(photo)).toEqual({ kind: 'uncertain' })
    expect(run).toHaveBeenCalledOnce()
  })

  it('[P0] [7.29-REJECT] abstains when the pinned model cannot load', async () => {
    class UnavailableDetector extends FlatLayDetector {
      protected override loadModel() {
        return Promise.reject(new Error('Synthetic model load failure'))
      }
    }

    expect(await new UnavailableDetector().detect(photo)).toEqual({ kind: 'uncertain' })
  })

  it('[P0] [7.29-REJECT] rejects an undersized source before model inference', async () => {
    const { instance, run } = detector(output())
    const undersized = await sharp(photo).resize(255, 255).png().toBuffer()

    expect(await instance.detect(undersized)).toEqual({ kind: 'uncertain' })
    expect(run).not.toHaveBeenCalled()
  })
})

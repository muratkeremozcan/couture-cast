// Learning path Step 83: Clean garment cutouts.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-83-clean-garment-cutouts
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { maskGarmentBackground } from './garment-background'

const fixtures = path.resolve(__dirname, '../test/fixtures/garment-cutouts')

type Rgb = [red: number, green: number, blue: number]

const backdrop: Rgb = [245, 245, 245]
const garment: Rgb = [36, 92, 161]
const size = 80

function raster(colorAt: (x: number, y: number) => Rgb) {
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      pixels.set([...colorAt(x, y), 255], (y * size + x) * 4)
    }
  }
  return pixels
}

function insideGarment(x: number, y: number) {
  return x >= 20 && x < 60 && y >= 20 && y < 60
}

async function labeledPhoto(scene: string) {
  const [{ data: photo, info }, { data: labels, info: labelInfo }] = await Promise.all([
    sharp(path.join(fixtures, `${scene}.jpg`))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(path.join(fixtures, `${scene}-mask.png`))
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ])
  return { photo, info, labels, labelInfo }
}

describe('garment cutout acceptance', () => {
  it.each(['plain', 'pattern'])(
    'meets both pixel thresholds on the %s photo',
    async (scene) => {
      const { photo, info, labels, labelInfo } = await labeledPhoto(scene)
      expect(labelInfo).toMatchObject({
        width: info.width,
        height: info.height,
        channels: 1,
      })
      expect(new Set(labels)).toEqual(new Set([0, 255]))

      const pixels = Buffer.from(photo)
      expect(maskGarmentBackground(pixels, info.width, info.height)).toBe(true)

      let garmentPixels = 0
      let keptGarment = 0
      let backgroundPixels = 0
      let removedBackground = 0
      let changedColor = false
      for (const [index, label] of labels.entries()) {
        const offset = index * 4
        changedColor ||= photo.readUIntBE(offset, 3) !== pixels.readUIntBE(offset, 3)
        const alpha = pixels[offset + 3]
        if (label === 255) {
          garmentPixels++
          keptGarment += Number(alpha === 255)
        } else {
          backgroundPixels++
          removedBackground += Number(alpha === 0)
        }
      }
      expect(changedColor, 'retaining original RGB').toBe(false)
      expect(
        keptGarment / garmentPixels,
        'labeled garment pixels kept'
      ).toBeGreaterThanOrEqual(0.95)
      expect(
        removedBackground / backgroundPixels,
        'labeled background pixels removed'
      ).toBeGreaterThanOrEqual(0.9)
    }
  )

  it.each(['clutter', 'pale'])(
    'keeps the original pixels on the %s photo',
    async (scene) => {
      const { photo, info, labels, labelInfo } = await labeledPhoto(scene)
      expect(labelInfo).toMatchObject({
        width: info.width,
        height: info.height,
        channels: 1,
      })
      expect(new Set(labels)).toEqual(new Set([0, 255]))

      const pixels = Buffer.from(photo)
      expect(maskGarmentBackground(pixels, info.width, info.height)).toBe(false)
      expect(pixels.equals(photo), 'unmasked crop pixels').toBe(true)
    }
  )

  it.each([
    { width: 80.5, height: 80 },
    { width: 80, height: 80.5 },
    { width: 2, height: 80 },
    { width: 80, height: 2 },
    { width: 40, height: 80 },
  ])(
    'keeps the raster when the dimensions are $width by $height',
    ({ width, height }) => {
      const pixels = raster((x, y) => (insideGarment(x, y) ? garment : backdrop))
      const before = pixels.slice()
      expect(maskGarmentBackground(pixels, width, height)).toBe(false)
      expect(pixels).toEqual(before)
    }
  )

  it('keeps an existing transparent image', () => {
    const pixels = raster((x, y) => (insideGarment(x, y) ? garment : backdrop))
    pixels[3] = 0
    const before = pixels.slice()
    expect(maskGarmentBackground(pixels, size, size)).toBe(false)
    expect(pixels).toEqual(before)
  })

  it.each<{ scene: string; colorAt: (x: number, y: number) => Rgb }>([
    {
      scene: 'an empty backdrop',
      colorAt: () => backdrop,
    },
    {
      scene: 'a close-up with too little backdrop',
      colorAt: (x, y) => (x > 0 && x < 79 && y > 0 && y < 79 ? garment : backdrop),
    },
    {
      scene: 'a mismatched corner',
      colorAt: (x, y) =>
        (x === 0 && y === 0) || insideGarment(x, y) ? garment : backdrop,
    },
    {
      scene: 'a fragmented border',
      colorAt: (x, y) =>
        (y === 0 && x > 10 && x < 30) || insideGarment(x, y) ? garment : backdrop,
    },
    {
      scene: 'a garment with an incompletely framed edge',
      colorAt: (x, y) =>
        (x === 40 && y < 20) || insideGarment(x, y) ? garment : backdrop,
    },
    {
      scene: 'a detached object near the garment',
      colorAt: (x, y) =>
        (x > 64 && x < 76 && y > 40 && y < 58) || insideGarment(x, y)
          ? garment
          : backdrop,
    },
    {
      scene: 'a weakly distinguished foreground',
      colorAt: (x, y) => (insideGarment(x, y) ? [223, 223, 223] : backdrop),
    },
    {
      scene: 'a garment with a coherent pale panel',
      colorAt: (x, y) => {
        if (insideGarment(x, y)) return garment
        return x >= 8 && x < 20 && y >= 25 && y < 55 ? [241, 241, 241] : backdrop
      },
    },
    {
      scene: 'a coherent panel three RGB levels darker than the backdrop',
      colorAt: (x, y) => {
        if (insideGarment(x, y)) return garment
        return x >= 8 && x < 20 && y >= 25 && y < 55 ? [242, 242, 242] : backdrop
      },
    },
  ])('keeps all pixels for $scene', ({ colorAt }) => {
    const pixels = raster(colorAt)
    const before = pixels.slice()
    expect(maskGarmentBackground(pixels, size, size)).toBe(false)
    expect(pixels).toEqual(before)
  })

  it('keeps a backdrop-colored interior pattern inside a high-contrast border', () => {
    const pixels = raster((x, y) => {
      if (!insideGarment(x, y)) return backdrop
      return x >= 26 && x < 54 && y >= 26 && y < 54 && x % 4 < 2 ? backdrop : garment
    })
    expect(maskGarmentBackground(pixels, size, size)).toBe(true)
    expect(pixels[3]).toBe(0)
    expect(pixels[(40 * size + 40) * 4 + 3]).toBe(255)
  })
})

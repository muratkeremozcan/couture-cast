import { describe, expect, it, vi } from 'vitest'
import { removePlainGarmentBackground } from './garment-background'

const size = 80

function canvasFixture(colorAt: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      data.set([...colorAt(x, y), 255], (y * size + x) * 4)
    }
  }
  const putImageData = vi.fn()
  return {
    context: {
      canvas: { width: size, height: size },
      getImageData: () => ({ data }),
      putImageData,
    } as unknown as CanvasRenderingContext2D,
    putImageData,
    alphaAt: (x: number, y: number) => data[(y * size + x) * 4 + 3],
  }
}

describe('plain garment background', () => {
  it('cuts a plain backdrop with a darker corner and scattered sensor grain', () => {
    const { context, alphaAt } = canvasFixture((x, y) => {
      if (x >= 20 && x < 60 && y >= 20 && y < 60) return [36, 92, 161]
      if (x === 0 && y === 0) return [235, 235, 235]
      const grain = x % 4 === 1 && y % 4 === 1
      const tone = grain || (x === 1 && y === 24) ? 240 : 245
      return [tone, tone, tone]
    })

    expect(removePlainGarmentBackground(context)).toEqual({
      removed: true,
      hasTransparency: true,
    })
    expect(alphaAt(0, 0)).toBe(0)
    expect(alphaAt(1, 24)).toBe(0)
    expect(alphaAt(40, 40)).toBe(255)
  })

  it('keeps a pale sleeve that looks coherent and distinct across both axes', () => {
    const { context, putImageData, alphaAt } = canvasFixture((x, y) => {
      if (x >= 24 && x < 56 && y >= 20 && y < 60) return [36, 92, 161]
      if (x >= 9 && x < 24 && y >= 27 && y < 50) return [245, 245, 245]
      return [250, 250, 250]
    })

    expect(removePlainGarmentBackground(context)).toEqual({
      removed: false,
      hasTransparency: false,
    })
    expect(putImageData).not.toHaveBeenCalled()
    expect(alphaAt(18, 36)).toBe(255)
  })
})

// Story 5.4 Task 6: the real Sharp-backed selfie pipeline, exercised against
// synthesized test images (sharp `create` + `composite`) rather than real
// photographs -- exactly the "explicitly untested" boundary the story states:
// this proves the deterministic pipeline mechanics, not real-world accuracy.
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { HeuristicPaletteAnalysisEngine } from './heuristic-palette-analysis.engine.js'

const FRAME_SIZE = 256

/** A representative light skin tone, comfortably inside the Chai-Ngan YCbCr gate. */
const SKIN_RGB = { r: 224, g: 172, b: 131 }
/** Saturated blue: far outside the skin-chroma gate. */
const NON_SKIN_RGB = { r: 20, g: 40, b: 210 }

async function solidImage(rgb: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: {
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      channels: 3,
      background: rgb,
    },
  })
    .png()
    .toBuffer()
}

/** A skin-toned square centered on a non-skin background, simulating a framed face. */
async function framedFaceImage(): Promise<Buffer> {
  const faceSize = 140
  const faceBuffer = await sharp({
    create: { width: faceSize, height: faceSize, channels: 3, background: SKIN_RGB },
  })
    .png()
    .toBuffer()

  return sharp({
    create: {
      width: FRAME_SIZE,
      height: FRAME_SIZE,
      channels: 3,
      background: NON_SKIN_RGB,
    },
  })
    .composite([
      {
        input: faceBuffer,
        top: Math.round((FRAME_SIZE - faceSize) / 2),
        left: Math.round((FRAME_SIZE - faceSize) / 2),
      },
    ])
    .png()
    .toBuffer()
}

describe('HeuristicPaletteAnalysisEngine', () => {
  const engine = new HeuristicPaletteAnalysisEngine()

  it('5.4-API-032 emits no_face when too little of the centre crop is skin-chromatic', async () => {
    const image = await solidImage(NON_SKIN_RGB)
    const verdict = await engine.analyzeSelfie(image)
    expect(verdict.outcome).toBe('no_face')
  })

  it('emits privacy_violation when the FULL frame is overwhelmingly skin-chromatic', async () => {
    // A solid skin-tone frame with no background at all -- the full-frame
    // skin fraction is ~100%, over the PRIVACY_FULL_FRAME_SKIN_FRACTION_MAX
    // safety-net threshold, and this check runs BEFORE the centre-crop
    // no_face/low_quality path.
    const image = await solidImage(SKIN_RGB)
    const verdict = await engine.analyzeSelfie(image)
    expect(verdict.outcome).toBe('privacy_violation')
  })

  it('5.4-API-031 classifies a framed face (skin center, non-skin border) as ready with a sane confidence and enum values', async () => {
    const image = await framedFaceImage()
    const verdict = await engine.analyzeSelfie(image)

    expect(verdict.outcome).toBe('ready')
    if (verdict.outcome === 'ready') {
      expect(['warm', 'cool', 'neutral', 'olive']).toContain(verdict.undertone)
      expect(['fair', 'light', 'medium', 'tan', 'deep']).toContain(verdict.depth)
      expect(verdict.confidence).toBeGreaterThanOrEqual(0)
      expect(verdict.confidence).toBeLessThanOrEqual(1)
      // A uniform skin-coloured square gives every surviving pixel an
      // identical hue angle (IQR 0), so confidence should be high.
      expect(verdict.confidence).toBeGreaterThan(0.5)
    }
  })

  it('is deterministic: the same input always yields the same output', async () => {
    const image = await framedFaceImage()
    const first = await engine.analyzeSelfie(image)
    const second = await engine.analyzeSelfie(image)
    expect(first).toEqual(second)
  })
})

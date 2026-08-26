// Story 5.4 Task 6: the deterministic fixture engine, mirroring
// fixture-silhouette-photo-moderation.engine.ts's gated-construction pattern.
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildFixturePaletteSelfie,
  FixturePaletteAnalysisEngine,
} from './fixture-palette-analysis.engine.js'

describe('FixturePaletteAnalysisEngine', () => {
  const originalEngineEnv = process.env.PALETTE_ANALYSIS_ENGINE
  const originalNodeEnv = process.env.NODE_ENV
  const originalTestEnv = process.env.TEST_ENV

  afterEach(() => {
    process.env.PALETTE_ANALYSIS_ENGINE = originalEngineEnv
    process.env.NODE_ENV = originalNodeEnv
    process.env.TEST_ENV = originalTestEnv
  })

  it('is strictly forbidden outside an allowed test environment', () => {
    process.env.PALETTE_ANALYSIS_ENGINE = undefined
    process.env.NODE_ENV = 'production'
    process.env.TEST_ENV = undefined

    expect(() => new FixturePaletteAnalysisEngine()).toThrow(
      'FixturePaletteAnalysisEngine is strictly forbidden outside an allowed test environment'
    )
  })

  it('is forbidden even in a test environment when the engine env var is not set to fixture', () => {
    process.env.PALETTE_ANALYSIS_ENGINE = undefined
    process.env.NODE_ENV = 'test'

    expect(() => new FixturePaletteAnalysisEngine()).toThrow()
  })

  describe('once constructed under the gate', () => {
    process.env.PALETTE_ANALYSIS_ENGINE = 'fixture'
    process.env.NODE_ENV = 'test'
    const engine = new FixturePaletteAnalysisEngine()

    it('reads a ready outcome from the fixture marker', async () => {
      const buffer = buildFixturePaletteSelfie('ready', {
        undertone: 'cool',
        depth: 'fair',
        confidence: 0.91,
      })
      await expect(engine.analyzeSelfie(buffer)).resolves.toEqual({
        outcome: 'ready',
        undertone: 'cool',
        depth: 'fair',
        confidence: 0.91,
      })
    })

    it.each(['no_face', 'low_quality', 'privacy_violation'] as const)(
      'reads a %s outcome from the fixture marker',
      async (outcome) => {
        const buffer = buildFixturePaletteSelfie(outcome)
        await expect(engine.analyzeSelfie(buffer)).resolves.toEqual({ outcome })
      }
    )

    it('defaults to a ready warm/medium/0.82 result for an unmarked buffer', async () => {
      await expect(engine.analyzeSelfie(Buffer.from('plain-bytes'))).resolves.toEqual({
        outcome: 'ready',
        undertone: 'warm',
        depth: 'medium',
        confidence: 0.82,
      })
    })

    it('defaults ready fixtures with a partial override to warm/medium/0.82', async () => {
      const buffer = buildFixturePaletteSelfie('ready')
      await expect(engine.analyzeSelfie(buffer)).resolves.toEqual({
        outcome: 'ready',
        undertone: 'warm',
        depth: 'medium',
        confidence: 0.82,
      })
    })
  })
})

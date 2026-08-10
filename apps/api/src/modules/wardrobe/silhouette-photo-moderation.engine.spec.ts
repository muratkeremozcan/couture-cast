import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildFixtureSilhouettePhoto,
  FixtureSilhouettePhotoModerationEngine,
} from './fixture-silhouette-photo-moderation.engine'
import { HeuristicSilhouettePhotoModerationEngine } from './heuristic-silhouette-photo-moderation.engine'

/**
 * 4.4-R03: the contrast/bare-skin heuristic is a conservative safety net,
 * not a real classifier (decision 9). These cases cover both
 * false-positive and false-negative boundary behavior the risk register
 * calls out, plus the deterministic fixture engine used elsewhere in tests.
 */
describe('HeuristicSilhouettePhotoModerationEngine', () => {
  const engine = new HeuristicSilhouettePhotoModerationEngine()

  it('4.4-UNIT-03 flags low border/center contrast as contrast', async () => {
    const image = await sharp({
      create: {
        width: 400,
        height: 500,
        channels: 3,
        background: { r: 120, g: 120, b: 120 },
      },
    })
      .png()
      .toBuffer()

    const verdict = await engine.moderate(image)
    expect(verdict.outcome).toBe('contrast')
  })

  it('4.4-UNIT-03 accepts a non-skin subject against a contrasting background as ready', async () => {
    const image = await sharp({
      create: {
        width: 400,
        height: 500,
        channels: 3,
        background: { r: 245, g: 245, b: 245 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 200,
              height: 300,
              channels: 3,
              background: { r: 20, g: 30, b: 140 },
            },
          })
            .png()
            .toBuffer(),
          left: 100,
          top: 100,
        },
      ])
      .png()
      .toBuffer()

    const verdict = await engine.moderate(image)
    expect(verdict.outcome).toBe('ready')
  })

  it('4.4-UNIT-03 flags a dominant skin-toned center region as privacy_violation', async () => {
    const image = await sharp({
      create: {
        width: 400,
        height: 500,
        channels: 3,
        background: { r: 245, g: 245, b: 245 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 260,
              height: 360,
              channels: 3,
              // A canonical mid skin tone under the heuristic thresholds.
              background: { r: 200, g: 150, b: 120 },
            },
          })
            .png()
            .toBuffer(),
          left: 70,
          top: 70,
        },
      ])
      .png()
      .toBuffer()

    const verdict = await engine.moderate(image)
    expect(verdict.outcome).toBe('privacy_violation')
  })
})

describe('FixtureSilhouettePhotoModerationEngine', () => {
  const originalEngine = process.env.SILHOUETTE_MODERATION_ENGINE
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.SILHOUETTE_MODERATION_ENGINE = 'fixture'
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    // Direct assignment is not a safe restore: `process.env.X = undefined`
    // coerces to the *string* `"undefined"` rather than deleting the key, so
    // a test that starts from an unset variable must delete it explicitly to
    // avoid leaking a truthy-but-bogus value into later tests/files.
    if (originalEngine === undefined) delete process.env.SILHOUETTE_MODERATION_ENGINE
    else process.env.SILHOUETTE_MODERATION_ENGINE = originalEngine
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
  })

  it('4.4-UNIT-04 refuses to construct outside an allowed test environment', () => {
    delete process.env.SILHOUETTE_MODERATION_ENGINE
    expect(() => new FixtureSilhouettePhotoModerationEngine()).toThrow()
  })

  it.each(['ready', 'contrast', 'privacy_violation'] as const)(
    '4.4-UNIT-04 returns the %s outcome encoded in the fixture buffer',
    async (outcome) => {
      const engine = new FixtureSilhouettePhotoModerationEngine()
      const verdict = await engine.moderate(buildFixtureSilhouettePhoto(outcome))
      expect(verdict.outcome).toBe(outcome)
    }
  )

  it('4.4-UNIT-04 defaults to ready for an unmarked buffer', async () => {
    const engine = new FixtureSilhouettePhotoModerationEngine()
    const verdict = await engine.moderate(Buffer.from('not-a-fixture-marker'))
    expect(verdict.outcome).toBe('ready')
  })
})

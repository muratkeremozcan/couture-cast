// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FixtureSilhouettePhotoModerationEngine } from '../modules/wardrobe/fixture-silhouette-photo-moderation.engine'
import { HeuristicSilhouettePhotoModerationEngine } from '../modules/wardrobe/heuristic-silhouette-photo-moderation.engine'
import {
  classifySilhouetteProcessingFailure,
  createSilhouetteModerationEngine,
} from './wardrobe.bootstrap'

/**
 * Risk 4.4-R01. BullMQ distributes a queue's jobs across every Worker
 * subscribed to that queue name, in any process. Two bootstraps subscribing to
 * `moderation-review` therefore split the jobs between them, and the process
 * that has no silhouette processor "succeeds" its share without ever running
 * moderation -- silently, with no failed job to alert on.
 *
 * A runtime test cannot observe this: each bootstrap only registers its worker
 * inside `require.main === module`, and standing up both process groups against
 * real Redis to count consumers would be far more fragile than the invariant is
 * worth. The invariant is structural, so it is asserted structurally.
 */
describe('moderation-review consumer registration', () => {
  it('4.4-UNIT-15 is registered by exactly one worker bootstrap', () => {
    const workersDir = path.resolve(__dirname)
    const registrations = readdirSync(workersDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .filter((file) =>
        /createWorker\(\s*'moderation-review'/.test(
          readFileSync(path.join(workersDir, file), 'utf8')
        )
      )

    expect(registrations).toEqual(['wardrobe.bootstrap.ts'])
  })
})

describe('classifySilhouetteProcessingFailure', () => {
  it.each([
    [new Error('Request timeout after 30s'), 'timeout'],
    [new Error('operation timed out'), 'timeout'],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'timeout'],
    [Object.assign(new Error('slow'), { name: 'TimeoutError' }), 'timeout'],
    [new Error('connection reset'), 'storage_error'],
    ['not-an-error', 'storage_error'],
    [undefined, 'storage_error'],
  ])('4.4-UNIT-16 classifies %o as %s', (error, expected) => {
    expect(classifySilhouetteProcessingFailure(error)).toBe(expected)
  })
})

describe('createSilhouetteModerationEngine', () => {
  const originalEngine = process.env.SILHOUETTE_MODERATION_ENGINE
  const originalNodeEnv = process.env.NODE_ENV
  const originalTestEnv = process.env.TEST_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    if (originalEngine === undefined) delete process.env.SILHOUETTE_MODERATION_ENGINE
    else process.env.SILHOUETTE_MODERATION_ENGINE = originalEngine
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (originalTestEnv === undefined) delete process.env.TEST_ENV
    else process.env.TEST_ENV = originalTestEnv
  })

  it('4.4-UNIT-16 defaults to the heuristic engine', () => {
    delete process.env.SILHOUETTE_MODERATION_ENGINE
    expect(createSilhouetteModerationEngine()).toBeInstanceOf(
      HeuristicSilhouettePhotoModerationEngine
    )
  })

  it('4.4-UNIT-16 builds the fixture engine only inside an allowed test environment', () => {
    process.env.SILHOUETTE_MODERATION_ENGINE = 'fixture'
    expect(createSilhouetteModerationEngine()).toBeInstanceOf(
      FixtureSilhouettePhotoModerationEngine
    )

    delete process.env.NODE_ENV
    delete process.env.TEST_ENV
    expect(() => createSilhouetteModerationEngine()).toThrow(
      'forbidden outside test environments'
    )
  })

  it('4.4-UNIT-16 refuses an unrecognized engine name rather than falling back', () => {
    process.env.SILHOUETTE_MODERATION_ENGINE = 'gpt-vision'
    expect(() => createSilhouetteModerationEngine()).toThrow(
      'Unsupported SILHOUETTE_MODERATION_ENGINE value: gpt-vision'
    )
  })
})

// Learning path Step 38: Community feed by climate band.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  COMMUNITY_NSFW_SCREENER_ENV,
  COMMUNITY_NSFW_SCREENER_FIXTURE,
  FixtureNsfwImageScreener,
} from './fixture-nsfw-image-screener'
import { createNsfwImageScreener } from './community-worker-runtime'
import {
  IMAGE_SCREENING_UNAVAILABLE_VERSION,
  SCREENING_UNAVAILABLE_REASON,
} from './community-moderation.engine'

describe('community NSFW screener selection', () => {
  const originalScreener = process.env[COMMUNITY_NSFW_SCREENER_ENV]
  const originalNodeEnv = process.env.NODE_ENV
  const originalTestEnv = process.env.TEST_ENV

  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    restore(COMMUNITY_NSFW_SCREENER_ENV, originalScreener)
    restore('NODE_ENV', originalNodeEnv)
    restore('TEST_ENV', originalTestEnv)
  })

  it('defaults to the real screener, which today fails closed', async () => {
    // An absent variable can only ever make screening stricter, never laxer.
    delete process.env[COMMUNITY_NSFW_SCREENER_ENV]

    const screener = createNsfwImageScreener()

    expect(screener.engineVersion).toBe(IMAGE_SCREENING_UNAVAILABLE_VERSION)
    await expect(screener.screen(Buffer.from('bytes'))).resolves.toMatchObject({
      passed: false,
      reasons: [SCREENING_UNAVAILABLE_REASON],
    })
  })

  it('rejects an unknown value rather than falling back silently', () => {
    // A typo in a deployment must not quietly select something nobody asked for.
    process.env[COMMUNITY_NSFW_SCREENER_ENV] = 'nsfwjs'

    expect(() => createNsfwImageScreener()).toThrow(
      /Unsupported COMMUNITY_NSFW_SCREENER value: nsfwjs/
    )
  })

  it('selects the fixture in a test environment', async () => {
    process.env[COMMUNITY_NSFW_SCREENER_ENV] = COMMUNITY_NSFW_SCREENER_FIXTURE

    const screener = createNsfwImageScreener()

    await expect(screener.screen(Buffer.from('bytes'))).resolves.toMatchObject({
      passed: true,
      reasons: [],
    })
    // The version says `fixture` out loud, so a persisted
    // `moderation_engine_version` never claims a real model ran.
    expect(screener.engineVersion).toContain('fixture')
  })

  it('refuses to select the fixture outside a test environment', () => {
    process.env[COMMUNITY_NSFW_SCREENER_ENV] = COMMUNITY_NSFW_SCREENER_FIXTURE
    process.env.NODE_ENV = 'production'
    delete process.env.TEST_ENV

    expect(() => createNsfwImageScreener()).toThrow(
      /strictly forbidden outside an allowed test environment/
    )
  })

  it('refuses to construct directly when the variable does not select it', () => {
    // The second half of the double gate: selecting it is not enough, and
    // neither is the environment on its own.
    delete process.env[COMMUNITY_NSFW_SCREENER_ENV]

    expect(() => new FixtureNsfwImageScreener()).toThrow(
      /strictly forbidden outside an allowed test environment/
    )
  })

  it('refuses to construct directly outside a test environment', () => {
    process.env[COMMUNITY_NSFW_SCREENER_ENV] = COMMUNITY_NSFW_SCREENER_FIXTURE
    process.env.NODE_ENV = 'production'
    delete process.env.TEST_ENV

    expect(() => new FixtureNsfwImageScreener()).toThrow(
      /strictly forbidden outside an allowed test environment/
    )
  })
})

// Learning path Step 38: Community feed by climate band.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_NSFW_SCREENER_ENV,
  COMMUNITY_NSFW_SCREENER_FIXTURE,
  FixtureNsfwImageScreener,
} from './fixture-nsfw-image-screener'
import {
  COMMUNITY_NSFW_INCIDENT_MODE_ENV,
  COMMUNITY_NSFW_INCIDENT_REFERENCE_ENV,
  COMMUNITY_NSFW_SCREENER_UNAVAILABLE,
  createNsfwImageScreener,
  resolveCommunityNsfwSelector,
  resolveNsfwInferenceTimeoutMs,
} from './community-worker-runtime'
import {
  COMMUNITY_NSFW_INFERENCE_TIMEOUT_ENV,
  COMMUNITY_NSFW_SCREENER_TENSORFLOW,
  NSFW_INFERENCE_TIMEOUT_MS,
} from './tensorflow-nsfw-image-screener'
import {
  IMAGE_SCREENING_UNAVAILABLE_VERSION,
  SCREENING_UNAVAILABLE_REASON,
} from './community-moderation.engine'
import type { CommunityModerationMeter } from './community-moderation.telemetry'

/**
 * Selection is where a deployment decides what a passing verdict is worth, so
 * every branch here is about refusing to guess. Nothing in this file may reach
 * the real model: `resolveCommunityNsfwSelector` is exercised as a pure
 * function for the `tensorflow` case, and `createNsfwImageScreener` is only
 * ever called with a selector that constructs no model.
 */
describe('community NSFW screener selection', () => {
  const originalScreener = process.env[COMMUNITY_NSFW_SCREENER_ENV]
  const originalIncidentMode = process.env[COMMUNITY_NSFW_INCIDENT_MODE_ENV]
  const originalIncidentRef = process.env[COMMUNITY_NSFW_INCIDENT_REFERENCE_ENV]
  const originalNodeEnv = process.env.NODE_ENV
  const originalTestEnv = process.env.TEST_ENV

  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  const recordScreenerReadiness = vi.fn()
  const meter = (): CommunityModerationMeter => ({
    recordScreenerReadiness,
    recordScreening: vi.fn(),
    recordAttemptFailure: vi.fn(),
    recordModelHealth: vi.fn(),
  })

  beforeEach(() => {
    recordScreenerReadiness.mockReset()
    process.env.NODE_ENV = 'test'
    delete process.env[COMMUNITY_NSFW_INCIDENT_MODE_ENV]
    delete process.env[COMMUNITY_NSFW_INCIDENT_REFERENCE_ENV]
  })

  afterEach(() => {
    restore(COMMUNITY_NSFW_SCREENER_ENV, originalScreener)
    restore(COMMUNITY_NSFW_INCIDENT_MODE_ENV, originalIncidentMode)
    restore(COMMUNITY_NSFW_INCIDENT_REFERENCE_ENV, originalIncidentRef)
    restore('NODE_ENV', originalNodeEnv)
    restore('TEST_ENV', originalTestEnv)
  })

  describe('selector vocabulary', () => {
    it('accepts exactly the three documented values', () => {
      for (const value of [
        COMMUNITY_NSFW_SCREENER_TENSORFLOW,
        COMMUNITY_NSFW_SCREENER_FIXTURE,
        COMMUNITY_NSFW_SCREENER_UNAVAILABLE,
      ]) {
        expect(
          resolveCommunityNsfwSelector({ [COMMUNITY_NSFW_SCREENER_ENV]: value })
        ).toBe(value)
      }
    })

    it('refuses an absent selector instead of choosing one', async () => {
      // This used to return the unavailable adapter, which made "nobody set the
      // variable" and "we decided to run degraded" the same running process.
      delete process.env[COMMUNITY_NSFW_SCREENER_ENV]

      expect(() => resolveCommunityNsfwSelector({})).toThrow(
        /COMMUNITY_NSFW_SCREENER is required/
      )
      await expect(createNsfwImageScreener(meter())).rejects.toThrow(
        /COMMUNITY_NSFW_SCREENER is required/
      )
    })

    it('rejects an unknown value rather than falling back silently', async () => {
      // A typo in a deployment must not quietly select something nobody asked for.
      process.env[COMMUNITY_NSFW_SCREENER_ENV] = 'nsfwjs'

      await expect(createNsfwImageScreener(meter())).rejects.toThrow(
        /Unsupported COMMUNITY_NSFW_SCREENER value: nsfwjs/
      )
    })

    it('records a failed readiness measurement when startup refuses', async () => {
      process.env[COMMUNITY_NSFW_SCREENER_ENV] = COMMUNITY_NSFW_SCREENER_UNAVAILABLE
      process.env.NODE_ENV = 'production'
      delete process.env.TEST_ENV
      await expect(createNsfwImageScreener(meter())).rejects.toThrow()

      expect(recordScreenerReadiness).toHaveBeenCalledWith(
        COMMUNITY_NSFW_SCREENER_UNAVAILABLE,
        'failed',
        expect.any(Number)
      )
    })
  })

  describe('inference timeout', () => {
    it('defaults to ten seconds', () => {
      expect(resolveNsfwInferenceTimeoutMs({})).toBe(NSFW_INFERENCE_TIMEOUT_MS)
    })

    it('accepts an explicit value below the outer screening ceiling', () => {
      expect(
        resolveNsfwInferenceTimeoutMs({ [COMMUNITY_NSFW_INFERENCE_TIMEOUT_ENV]: '4000' })
      ).toBe(4000)
    })

    it('refuses a value at or above the outer ceiling', () => {
      // The outer race would always win, so the inner termination that stops a
      // wedged inference burning a core would never run.
      expect(() =>
        resolveNsfwInferenceTimeoutMs({ [COMMUNITY_NSFW_INFERENCE_TIMEOUT_ENV]: '30000' })
      ).toThrow(/must be below the 30000ms outer screening ceiling/)
    })

    it('refuses a value that is not a positive integer', () => {
      for (const value of ['0', '-1', '1.5', 'soon']) {
        expect(() =>
          resolveNsfwInferenceTimeoutMs({
            [COMMUNITY_NSFW_INFERENCE_TIMEOUT_ENV]: value,
          })
        ).toThrow(/must be a positive integer of milliseconds/)
      }
    })
  })

  describe('unavailable', () => {
    it('fails closed and routes to human review', async () => {
      process.env[COMMUNITY_NSFW_SCREENER_ENV] = COMMUNITY_NSFW_SCREENER_UNAVAILABLE

      const { screener, readiness } = await createNsfwImageScreener(meter())

      expect(screener.engineVersion).toBe(IMAGE_SCREENING_UNAVAILABLE_VERSION)
      expect(readiness.selector).toBe(COMMUNITY_NSFW_SCREENER_UNAVAILABLE)
      await expect(screener.screen(Buffer.from('bytes'))).resolves.toMatchObject({
        passed: false,
        reasons: [SCREENING_UNAVAILABLE_REASON],
        disposition: 'review',
      })
    })

    it('refuses production incident mode without the explicit switch', async () => {
      process.env[COMMUNITY_NSFW_SCREENER_ENV] = COMMUNITY_NSFW_SCREENER_UNAVAILABLE
      process.env.NODE_ENV = 'production'
      delete process.env.TEST_ENV

      await expect(createNsfwImageScreener(meter())).rejects.toThrow(
        /requires COMMUNITY_NSFW_INCIDENT_MODE=unavailable in production/
      )
    })

    it('refuses production incident mode with no incident reference', async () => {
      process.env[COMMUNITY_NSFW_SCREENER_ENV] = COMMUNITY_NSFW_SCREENER_UNAVAILABLE
      process.env[COMMUNITY_NSFW_INCIDENT_MODE_ENV] = 'unavailable'
      process.env[COMMUNITY_NSFW_INCIDENT_REFERENCE_ENV] = '   '
      process.env.NODE_ENV = 'production'
      delete process.env.TEST_ENV

      await expect(createNsfwImageScreener(meter())).rejects.toThrow(
        /COMMUNITY_NSFW_INCIDENT_REFERENCE must name the authorizing incident/
      )
    })

    it('starts in production when the incident is authorized and referenced', async () => {
      process.env[COMMUNITY_NSFW_SCREENER_ENV] = COMMUNITY_NSFW_SCREENER_UNAVAILABLE
      process.env[COMMUNITY_NSFW_INCIDENT_MODE_ENV] = 'unavailable'
      process.env[COMMUNITY_NSFW_INCIDENT_REFERENCE_ENV] = 'INC-4711'
      process.env.NODE_ENV = 'production'
      delete process.env.TEST_ENV

      const { screener, readiness } = await createNsfwImageScreener(meter())

      // Consumption starts, and every submission is refused deterministically.
      expect(readiness.incidentReference).toBe('INC-4711')
      expect(readiness.policyVersion).toBeUndefined()
      expect(readiness.modelHash).toBeUndefined()
      await expect(screener.screen(Buffer.from('bytes'))).resolves.toMatchObject({
        passed: false,
        disposition: 'review',
      })
    })
  })

  describe('fixture', () => {
    it('selects the fixture in a test environment', async () => {
      process.env[COMMUNITY_NSFW_SCREENER_ENV] = COMMUNITY_NSFW_SCREENER_FIXTURE

      const { screener, readiness } = await createNsfwImageScreener(meter())

      await expect(screener.screen(Buffer.from('bytes'))).resolves.toMatchObject({
        passed: true,
        reasons: [],
        disposition: 'pass',
      })
      // The version says `fixture` out loud, so a persisted
      // `moderation_engine_version` never claims a real model ran, and the
      // readiness payload carries no policy or model hash to borrow.
      expect(screener.engineVersion).toContain('fixture')
      expect(readiness.policyVersion).toBeUndefined()
      expect(readiness.modelHash).toBeUndefined()
    })

    it('refuses to select the fixture outside a test environment', async () => {
      process.env[COMMUNITY_NSFW_SCREENER_ENV] = COMMUNITY_NSFW_SCREENER_FIXTURE
      process.env.NODE_ENV = 'production'
      delete process.env.TEST_ENV

      await expect(createNsfwImageScreener(meter())).rejects.toThrow(
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
})

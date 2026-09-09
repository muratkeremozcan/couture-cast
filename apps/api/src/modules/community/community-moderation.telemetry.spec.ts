// Learning path Step 39: Production content-screening readiness.
// Story 6.2: Community moderation telemetry unit tests.
import { describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_MODERATION_LOG_EVENTS,
  createOpenTelemetryCommunityModerationMeter,
  createSafeCommunityModerationMeter,
} from './community-moderation.telemetry'
import type { CommunityModerationMeter } from './community-moderation.telemetry'

// Each fake is handed back in the order the module asks for its instruments, so the
// `mockReturnValueOnce` chains below follow creation order.
function createMeterHarness() {
  const readinessAdd = vi.fn()
  const screeningAdd = vi.fn()
  const attemptFailureAdd = vi.fn()
  const modelHealthAdd = vi.fn()
  const startupDurationRecord = vi.fn()
  const screeningDurationRecord = vi.fn()
  const createCounter = vi
    .fn()
    .mockReturnValueOnce({ add: readinessAdd })
    .mockReturnValueOnce({ add: screeningAdd })
    .mockReturnValueOnce({ add: attemptFailureAdd })
    .mockReturnValueOnce({ add: modelHealthAdd })
  const createHistogram = vi
    .fn()
    .mockReturnValueOnce({ record: startupDurationRecord })
    .mockReturnValueOnce({ record: screeningDurationRecord })

  const meter = createOpenTelemetryCommunityModerationMeter({
    createCounter,
    createHistogram,
  } as never)

  return {
    meter,
    createCounter,
    createHistogram,
    readinessAdd,
    screeningAdd,
    attemptFailureAdd,
    modelHealthAdd,
    startupDurationRecord,
    screeningDurationRecord,
  }
}

describe('community moderation telemetry', () => {
  describe('createOpenTelemetryCommunityModerationMeter', () => {
    it('registers every instrument under its metric name', () => {
      const { createCounter, createHistogram } = createMeterHarness()

      expect(createCounter).toHaveBeenNthCalledWith(
        1,
        'community_moderation_screener_readiness_total',
        expect.any(Object)
      )
      expect(createCounter).toHaveBeenNthCalledWith(
        2,
        'community_moderation_screenings_total',
        expect.any(Object)
      )
      expect(createCounter).toHaveBeenNthCalledWith(
        3,
        'community_moderation_screening_attempt_failures_total',
        expect.any(Object)
      )
      expect(createCounter).toHaveBeenNthCalledWith(
        4,
        'community_moderation_model_health_total',
        expect.any(Object)
      )
      expect(createHistogram).toHaveBeenNthCalledWith(
        1,
        'community_moderation_screener_startup_duration_ms',
        expect.any(Object)
      )
      expect(createHistogram).toHaveBeenNthCalledWith(
        2,
        'community_moderation_screening_duration_ms',
        expect.any(Object)
      )
    })

    it('records screener readiness by selector and outcome', () => {
      const { meter, readinessAdd, startupDurationRecord } = createMeterHarness()

      meter.recordScreenerReadiness('tensorflow', 'ready', 842)
      meter.recordScreenerReadiness('unavailable', 'failed', 17)

      expect(readinessAdd).toHaveBeenNthCalledWith(1, 1, {
        selector: 'tensorflow',
        outcome: 'ready',
      })
      expect(readinessAdd).toHaveBeenNthCalledWith(2, 1, {
        selector: 'unavailable',
        outcome: 'failed',
      })
      expect(startupDurationRecord).toHaveBeenNthCalledWith(1, 842, {
        selector: 'tensorflow',
      })
      expect(startupDurationRecord).toHaveBeenNthCalledWith(2, 17, {
        selector: 'unavailable',
      })
    })

    it('records screenings by disposition, outcome and attempt', () => {
      const { meter, screeningAdd, screeningDurationRecord } = createMeterHarness()

      meter.recordScreening('review', 'flagged', 1_240, 2)
      meter.recordScreening('unavailable', 'review_failed', 90, 3)

      expect(screeningAdd).toHaveBeenNthCalledWith(1, 1, {
        disposition: 'review',
        outcome: 'flagged',
        attempt: 2,
      })
      expect(screeningAdd).toHaveBeenNthCalledWith(2, 1, {
        disposition: 'unavailable',
        outcome: 'review_failed',
        attempt: 3,
      })
      expect(screeningDurationRecord).toHaveBeenNthCalledWith(1, 1_240, {
        disposition: 'review',
        outcome: 'flagged',
      })
      expect(screeningDurationRecord).toHaveBeenNthCalledWith(2, 90, {
        disposition: 'unavailable',
        outcome: 'review_failed',
      })
    })

    it('records attempt failures by outcome and attempt', () => {
      const { meter, attemptFailureAdd } = createMeterHarness()

      meter.recordAttemptFailure('error', 1)
      meter.recordAttemptFailure('review_failed', 3)

      expect(attemptFailureAdd).toHaveBeenNthCalledWith(1, 1, {
        outcome: 'error',
        attempt: 1,
      })
      expect(attemptFailureAdd).toHaveBeenNthCalledWith(2, 1, {
        outcome: 'review_failed',
        attempt: 3,
      })
    })

    it('records every model health transition', () => {
      const { meter, modelHealthAdd } = createMeterHarness()

      meter.recordModelHealth('ready')
      meter.recordModelHealth('timeout_terminated')
      meter.recordModelHealth('crashed')
      meter.recordModelHealth('respawned')

      expect(modelHealthAdd).toHaveBeenNthCalledWith(1, 1, { state: 'ready' })
      expect(modelHealthAdd).toHaveBeenNthCalledWith(2, 1, {
        state: 'timeout_terminated',
      })
      expect(modelHealthAdd).toHaveBeenNthCalledWith(3, 1, { state: 'crashed' })
      expect(modelHealthAdd).toHaveBeenNthCalledWith(4, 1, { state: 'respawned' })
    })

    // The attempt number lands on the exporter as a label. A miscounted, fractional
    // or non-finite value passed straight through would mint one time series per
    // distinct value, so the clamp is what keeps this label bounded.
    it('clamps out-of-range and non-finite attempts to a bounded integer', () => {
      const { meter, screeningAdd, attemptFailureAdd } = createMeterHarness()

      const attempts = [-3, Number.NaN, Number.POSITIVE_INFINITY, 2.9, 42]
      for (const attempt of attempts) {
        meter.recordScreening('pass', 'published', 10, attempt)
        meter.recordAttemptFailure('error', attempt)
      }

      const screened = (attempt: number) => ({
        disposition: 'pass',
        outcome: 'published',
        attempt,
      })
      expect(screeningAdd).toHaveBeenNthCalledWith(1, 1, screened(0))
      expect(screeningAdd).toHaveBeenNthCalledWith(2, 1, screened(0))
      expect(screeningAdd).toHaveBeenNthCalledWith(3, 1, screened(0))
      expect(screeningAdd).toHaveBeenNthCalledWith(4, 1, screened(2))
      expect(screeningAdd).toHaveBeenNthCalledWith(5, 1, screened(10))

      const failed = (attempt: number) => ({ outcome: 'error', attempt })
      expect(attemptFailureAdd).toHaveBeenNthCalledWith(1, 1, failed(0))
      expect(attemptFailureAdd).toHaveBeenNthCalledWith(2, 1, failed(0))
      expect(attemptFailureAdd).toHaveBeenNthCalledWith(3, 1, failed(0))
      expect(attemptFailureAdd).toHaveBeenNthCalledWith(4, 1, failed(2))
      expect(attemptFailureAdd).toHaveBeenNthCalledWith(5, 1, failed(10))
    })

    it('records zero for negative and non-finite durations', () => {
      const { meter, startupDurationRecord, screeningDurationRecord } =
        createMeterHarness()

      meter.recordScreenerReadiness('fixture', 'failed', -1)
      meter.recordScreenerReadiness('fixture', 'failed', Number.NaN)
      meter.recordScreening('block', 'flagged', -5, 1)
      meter.recordScreening('block', 'flagged', Number.POSITIVE_INFINITY, 1)

      expect(startupDurationRecord).toHaveBeenNthCalledWith(1, 0, { selector: 'fixture' })
      expect(startupDurationRecord).toHaveBeenNthCalledWith(2, 0, { selector: 'fixture' })
      expect(screeningDurationRecord).toHaveBeenNthCalledWith(1, 0, {
        disposition: 'block',
        outcome: 'flagged',
      })
      expect(screeningDurationRecord).toHaveBeenNthCalledWith(2, 0, {
        disposition: 'block',
        outcome: 'flagged',
      })
    })
  })

  describe('createSafeCommunityModerationMeter', () => {
    // An unreachable exporter must stay an exporter problem. If a throw escaped any
    // of these, a healthy screening job would fail and send its post to review_failed.
    it('swallows a throw from every recorder method', () => {
      const boom = () => {
        throw new Error('metrics exporter unreachable')
      }
      const safeMeter = createSafeCommunityModerationMeter({
        recordScreenerReadiness: boom,
        recordScreening: boom,
        recordAttemptFailure: boom,
        recordModelHealth: boom,
      })

      expect(() =>
        safeMeter.recordScreenerReadiness('tensorflow', 'ready', 10)
      ).not.toThrow()
      expect(() => safeMeter.recordScreening('pass', 'published', 10, 1)).not.toThrow()
      expect(() => safeMeter.recordAttemptFailure('error', 1)).not.toThrow()
      expect(() => safeMeter.recordModelHealth('crashed')).not.toThrow()
    })

    it('forwards arguments unchanged to a healthy meter', () => {
      const recordScreenerReadiness = vi.fn()
      const recordScreening = vi.fn()
      const recordAttemptFailure = vi.fn()
      const recordModelHealth = vi.fn()
      const inner: CommunityModerationMeter = {
        recordScreenerReadiness,
        recordScreening,
        recordAttemptFailure,
        recordModelHealth,
      }

      const safeMeter = createSafeCommunityModerationMeter(inner)

      safeMeter.recordScreenerReadiness('fixture', 'failed', 51)
      safeMeter.recordScreening('review', 'flagged', 990, 3)
      safeMeter.recordAttemptFailure('review_failed', 2)
      safeMeter.recordModelHealth('respawned')

      expect(recordScreenerReadiness).toHaveBeenCalledWith('fixture', 'failed', 51)
      expect(recordScreening).toHaveBeenCalledWith('review', 'flagged', 990, 3)
      expect(recordAttemptFailure).toHaveBeenCalledWith('review_failed', 2)
      expect(recordModelHealth).toHaveBeenCalledWith('respawned')
    })
  })

  describe('COMMUNITY_MODERATION_LOG_EVENTS', () => {
    // Dashboards and alert rules match on these literals, so a rename has to show up
    // as a diff here rather than as a query that silently returns nothing.
    it('pins the log event vocabulary', () => {
      expect(COMMUNITY_MODERATION_LOG_EVENTS).toEqual({
        screenerReady: 'community_moderation_screener_ready',
        screenerIncidentMode: 'community_moderation_screener_incident_mode',
        screenerStartupFailed: 'community_moderation_screener_startup_failed',
        screeningCompleted: 'community_moderation_screening_completed',
        screeningAttemptFailed: 'community_moderation_screening_attempt_failed',
        modelTerminated: 'community_moderation_model_terminated',
      })
    })

    it('names every event in snake_case under the shared prefix', () => {
      for (const value of Object.values(COMMUNITY_MODERATION_LOG_EVENTS)) {
        expect(value).toMatch(/^community_moderation_[a-z0-9]+(?:_[a-z0-9]+)*$/)
      }
    })
  })
})

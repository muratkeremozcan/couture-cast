// Story 5.5 AC 6: both events use `TelemetryService`, strict property
// allowlists, HMAC subject ids, and registry set-equality checks. Until this
// file existed, `trackPremiumPlannerViewed` and
// `trackPremiumPlannerDayReshuffled` were called from `apps/api` and never
// exercised directly in this package.
import { describe, expect, it } from 'vitest'

import {
  premiumPlannerDayReshuffledPropertiesSchema,
  premiumPlannerViewedPropertiesSchema,
  trackPremiumPlannerDayReshuffled,
  trackPremiumPlannerViewed,
} from '../src/types/analytics-events'

describe('5.5 premium planner analytics wrappers', () => {
  it('5.5-CON-020 builds premium_planner_viewed on the HMAC subject with platform and daysReady', () => {
    const payload = trackPremiumPlannerViewed({
      analyticsSubjectId: 'hmac-subject-1',
      platform: 'web',
      daysReady: 7,
    })

    expect(payload).toEqual({
      distinctId: 'hmac-subject-1',
      event: 'premium_planner_viewed',
      properties: { platform: 'web', days_ready: 7 },
    })
    expect(() =>
      premiumPlannerViewedPropertiesSchema.parse(payload.properties)
    ).not.toThrow()
  })

  it('5.5-CON-021 builds premium_planner_viewed for mobile with a partial-week daysReady', () => {
    const payload = trackPremiumPlannerViewed({
      analyticsSubjectId: 'hmac-subject-2',
      platform: 'mobile',
      daysReady: 3,
    })

    expect(payload.properties).toEqual({ platform: 'mobile', days_ready: 3 })
  })

  it('5.5-CON-022 rejects a daysReady outside the 0-7 contract range', () => {
    expect(() =>
      trackPremiumPlannerViewed({
        analyticsSubjectId: 'hmac-subject-3',
        platform: 'web',
        daysReady: 8,
      })
    ).toThrow()
  })

  it('5.5-CON-023 rejects a raw property beyond the strict premium_planner_viewed allowlist', () => {
    // The properties schema is `.strict()`, the PostHog-facing half of AC 6's
    // "strict property allowlists" claim: a raw user id or any other field
    // the builder did not construct itself must never reach PostHog.
    expect(() =>
      premiumPlannerViewedPropertiesSchema.parse({
        platform: 'web',
        days_ready: 7,
        user_id: 'user-1',
      })
    ).toThrow()
  })

  it('5.5-CON-024 builds premium_planner_day_reshuffled on the HMAC subject with dayOffset and unchanged', () => {
    const payload = trackPremiumPlannerDayReshuffled({
      analyticsSubjectId: 'hmac-subject-5',
      platform: 'mobile',
      dayOffset: 3,
      unchanged: false,
    })

    expect(payload).toEqual({
      distinctId: 'hmac-subject-5',
      event: 'premium_planner_day_reshuffled',
      properties: { platform: 'mobile', day_offset: 3, unchanged: false },
    })
    expect(() =>
      premiumPlannerDayReshuffledPropertiesSchema.parse(payload.properties)
    ).not.toThrow()
  })

  it('5.5-CON-025 builds premium_planner_day_reshuffled with unchanged: true', () => {
    const payload = trackPremiumPlannerDayReshuffled({
      analyticsSubjectId: 'hmac-subject-6',
      platform: 'web',
      dayOffset: 0,
      unchanged: true,
    })

    expect(payload.properties).toEqual({
      platform: 'web',
      day_offset: 0,
      unchanged: true,
    })
  })

  it('5.5-CON-026 rejects a dayOffset outside the 0-6 contract range', () => {
    expect(() =>
      trackPremiumPlannerDayReshuffled({
        analyticsSubjectId: 'hmac-subject-7',
        platform: 'web',
        dayOffset: 7,
        unchanged: false,
      })
    ).toThrow()
  })

  it('5.5-CON-027a rejects a raw property beyond the strict premium_planner_day_reshuffled allowlist', () => {
    expect(() =>
      premiumPlannerDayReshuffledPropertiesSchema.parse({
        platform: 'mobile',
        day_offset: 3,
        unchanged: false,
        user_id: 'user-1',
      })
    ).toThrow()
  })

  it('5.5-CON-027 keeps premium_planner_day_reshuffled properties to exactly platform, day_offset, unchanged', () => {
    const payload = trackPremiumPlannerDayReshuffled({
      analyticsSubjectId: 'hmac-subject-8',
      platform: 'mobile',
      dayOffset: 6,
      unchanged: false,
    })

    expect(Object.keys(payload.properties).sort()).toEqual([
      'day_offset',
      'platform',
      'unchanged',
    ])
  })
})

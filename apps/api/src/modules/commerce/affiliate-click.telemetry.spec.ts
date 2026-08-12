// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { createHmac } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsClient } from '../../analytics/analytics.service.js'
import { createMockPrisma, type MockPrisma } from '../../testing/prisma-mock.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import { AffiliateClickTelemetry } from './affiliate-click.telemetry.js'

const INPUT = {
  userId: 'user-1',
  partnerId: 'sample-partner',
  offerId: 'offer-1',
  scenario: 'morning',
  surface: 'mobile_hero',
  localeRegion: 'US',
  recommendationId: 'rec-1',
} as const

/** Mirrors the fallback in `requireAnalyticsIdSecret` under NODE_ENV=test. */
const TEST_ANALYTICS_SECRET = 'test-only-analytics-id-secret-at-least-32-bytes'

describe('AffiliateClickTelemetry', () => {
  let prisma: MockPrisma
  let analytics: { capture: ReturnType<typeof vi.fn> }
  let telemetry: AffiliateClickTelemetry

  beforeEach(() => {
    prisma = createMockPrisma()
    analytics = { capture: vi.fn() }
    // A REAL TelemetryService over mocked sinks, not a mocked TelemetryService.
    // Every assertion below is about end behaviour: which subject reaches
    // PostHog, that the persisted row carries user_id: null, that no raw user id
    // or URL leaks. Substituting a mock here would reduce all of that to "we
    // called captureEvent", which is exactly the assertion that would keep
    // passing if decision 12's pseudonymous branch regressed.
    telemetry = new AffiliateClickTelemetry(
      new TelemetryService(
        prisma as unknown as PrismaClient,
        analytics as unknown as AnalyticsClient
      )
    )
  })

  it('forwards a pseudonymous subject rather than the raw user id', async () => {
    await telemetry.recordCtaClicked(INPUT)

    const expectedSubject = createHmac('sha256', TEST_ANALYTICS_SECRET)
      .update('user-1')
      .digest('base64url')
    expect(analytics.capture).toHaveBeenCalledWith({
      distinctId: expectedSubject,
      event: 'affiliate_cta_clicked',
      properties: {
        partner_id: 'sample-partner',
        offer_id: 'offer-1',
        scenario: 'morning',
        surface: 'mobile_hero',
        locale_region: 'US',
        recommendation_id: 'rec-1',
        $ip: null,
      },
    })
    expect(JSON.stringify(analytics.capture.mock.calls)).not.toContain('user-1')
  })

  it('persists the row with a null user_id and no $ip', async () => {
    await telemetry.recordCtaClicked(INPUT)

    expect(prisma.telemetryEvent.create).toHaveBeenCalledWith({
      data: {
        user_id: null,
        event_type: 'affiliate_cta_clicked',
        properties: {
          partner_id: 'sample-partner',
          offer_id: 'offer-1',
          scenario: 'morning',
          surface: 'mobile_hero',
          locale_region: 'US',
          recommendation_id: 'rec-1',
        },
      },
    })
  })

  it('carries no URL, product title, or garment id', async () => {
    await telemetry.recordCtaClicked(INPUT)

    const emitted = JSON.stringify(analytics.capture.mock.calls)
    expect(emitted).not.toContain('http')
    expect(emitted).not.toContain('garment')
  })

  it('still forwards to PostHog when the database write fails', async () => {
    prisma.telemetryEvent.create.mockRejectedValue(new Error('table unavailable'))

    await expect(telemetry.recordCtaClicked(INPUT)).resolves.toBeUndefined()
    expect(analytics.capture).toHaveBeenCalledTimes(1)
  })

  it('never throws when PostHog is degraded', async () => {
    analytics.capture.mockImplementation(() => {
      throw new Error('posthog unreachable')
    })

    await expect(telemetry.recordCtaClicked(INPUT)).resolves.toBeUndefined()
  })

  it('never throws when the event fails its own property allowlist', async () => {
    await expect(
      telemetry.recordCtaClicked({ ...INPUT, partnerId: '' })
    ).resolves.toBeUndefined()
    expect(analytics.capture).not.toHaveBeenCalled()
    expect(prisma.telemetryEvent.create).not.toHaveBeenCalled()
  })
})

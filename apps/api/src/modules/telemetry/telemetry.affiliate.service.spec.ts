// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
// Learning path Step 47: Sponsored community highlights.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-47-sponsored-community-highlights
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { type AnalyticsClient } from '../../analytics/analytics.service'
import { TelemetryService } from './telemetry.service'

// Story 5.1 affiliate conversion and click events, and the Story 6.7b community
// click member, split out of telemetry.service.spec.ts to keep both files
// under the size limit.
type CapturedEvent = {
  distinctId: string
  event: string
  properties: Record<string, unknown>
}

describe('TelemetryService affiliate events', () => {
  let service: TelemetryService
  let telemetryCreate: ReturnType<typeof vi.fn>
  let analyticsCapture: ReturnType<typeof vi.fn>

  // The same mocked sinks as telemetry.service.spec.ts, so these cases run
  // exactly as they did before the split.
  beforeEach(() => {
    process.env.ANALYTICS_ID_SECRET = 'telemetry-test-secret-at-least-32-bytes'
    telemetryCreate = vi.fn()
    analyticsCapture = vi.fn()

    const mockPrisma = {
      telemetryEvent: {
        create: telemetryCreate,
        deleteMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      outfitRecommendation: { count: vi.fn() },
      $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    }

    service = new TelemetryService(
      mockPrisma as unknown as PrismaClient,
      { capture: analyticsCapture } as unknown as AnalyticsClient
    )
  })

  describe('story 5.1 affiliate server events', () => {
    beforeEach(() => {
      telemetryCreate.mockResolvedValue({ id: 'event-1' })
    })

    const subjectFor = (userId: string) =>
      createHmac('sha256', 'telemetry-test-secret-at-least-32-bytes')
        .update(userId)
        .digest('base64url')

    const conversionProperties = {
      partnerId: 'sample-partner',
      status: 'confirmed' as const,
      currency: 'USD',
      orderValueMinorUnits: 12_900,
    }

    it('emits a matched conversion under the click owner pseudonym', async () => {
      await service.captureEvent('raw-user-1', 'affiliate_conversion_recorded', {
        ...conversionProperties,
        matched: true,
      })

      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: subjectFor('raw-user-1'),
        event: 'affiliate_conversion_recorded',
        properties: {
          partner_id: 'sample-partner',
          status: 'confirmed',
          currency: 'USD',
          order_value_minor_units: 12_900,
          matched: true,
          $ip: null,
        },
      })
      expect(telemetryCreate).toHaveBeenCalledWith({
        data: {
          user_id: null,
          event_type: 'affiliate_conversion_recorded',
          properties: {
            partner_id: 'sample-partner',
            status: 'confirmed',
            currency: 'USD',
            order_value_minor_units: 12_900,
            matched: true,
          },
        },
      })
    })

    it('emits an unmatched conversion with no user on any path', async () => {
      // The webhook is unauthenticated and an unknown click token yields no user
      // at all, so the partner slug is the only subject available. This is the
      // one server event `captureEvent(null, ...)` must accept.
      await service.captureEvent(null, 'affiliate_conversion_recorded', {
        ...conversionProperties,
        matched: false,
      })

      const captured = analyticsCapture.mock.calls[0]?.[0] as CapturedEvent
      expect(captured.distinctId).toBe('sample-partner')
      expect(captured.properties).toMatchObject({ matched: false, $ip: null })

      const persisted = telemetryCreate.mock.calls[0]?.[0] as {
        data: { user_id: string | null }
      }
      expect(persisted.data.user_id).toBeNull()
    })

    it('refuses to emit a matched conversion with no click owner', async () => {
      // Publishing the partner slug as if it were a person's pseudonym would
      // quietly corrupt every per-user conversion metric.
      await expect(
        service.captureEvent(null, 'affiliate_conversion_recorded', {
          ...conversionProperties,
          matched: true,
        })
      ).rejects.toThrow(
        'Affiliate conversion telemetry marked matched must carry the matched click owner'
      )
      expect(telemetryCreate).not.toHaveBeenCalled()
      expect(analyticsCapture).not.toHaveBeenCalled()
    })

    it('emits an affiliate click under the acting user pseudonym', async () => {
      await service.captureEvent('raw-user-1', 'affiliate_cta_clicked', {
        partnerId: 'sample-partner',
        offerId: 'offer-1',
        scenario: 'morning',
        surface: 'mobile_hero',
        localeRegion: 'US',
        recommendationId: 'outfit-1',
      })

      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: subjectFor('raw-user-1'),
        event: 'affiliate_cta_clicked',
        properties: {
          partner_id: 'sample-partner',
          offer_id: 'offer-1',
          scenario: 'morning',
          surface: 'mobile_hero',
          locale_region: 'US',
          recommendation_id: 'outfit-1',
          $ip: null,
        },
      })
      const persisted = telemetryCreate.mock.calls[0]?.[0] as {
        data: { user_id: string | null }
      }
      expect(persisted.data.user_id).toBeNull()
    })

    it('6.7b-UNIT-040 emits a community click with only partner, offer, surface and region', async () => {
      await service.captureEvent('raw-user-1', 'affiliate_cta_clicked', {
        partnerId: 'sample-partner',
        offerId: 'offer-1',
        surface: 'home_teaser',
        localeRegion: '*',
      })

      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: subjectFor('raw-user-1'),
        event: 'affiliate_cta_clicked',
        properties: {
          partner_id: 'sample-partner',
          offer_id: 'offer-1',
          surface: 'home_teaser',
          locale_region: '*',
          $ip: null,
        },
      })
    })

    it.each([
      { name: 'a recommendation id', extra: { recommendationId: 'post-1' } },
      { name: 'a scenario', extra: { scenario: 'morning' } },
      { name: 'a post id', extra: { postId: 'post-1' } },
      { name: 'an author id', extra: { authorId: 'user-2' } },
    ])(
      '6.7b-UNIT-041 refuses a community click carrying $name before anything is written',
      async ({ extra }) => {
        await expect(
          service.captureEvent('raw-user-1', 'affiliate_cta_clicked', {
            partnerId: 'sample-partner',
            offerId: 'offer-1',
            surface: 'community_feed',
            localeRegion: 'US',
            ...extra,
          } as never)
        ).rejects.toThrow()
        expect(telemetryCreate).not.toHaveBeenCalled()
        expect(analyticsCapture).not.toHaveBeenCalled()
      }
    )

    it('refuses to emit a click with no authenticated user', async () => {
      await expect(
        service.captureEvent(null, 'affiliate_cta_clicked', {
          partnerId: 'sample-partner',
          offerId: 'offer-1',
          scenario: 'morning',
          surface: 'mobile_hero',
          localeRegion: 'US',
          recommendationId: 'outfit-1',
        })
      ).rejects.toThrow('Affiliate click telemetry requires an authenticated user')
      expect(telemetryCreate).not.toHaveBeenCalled()
    })

    it.each([
      {
        name: 'a partner URL',
        extra: { deepLinkUrl: 'https://partner.couturecast.test/shop' },
      },
      { name: 'a product title', extra: { offerTitle: 'Merino Crew' } },
      { name: 'a garment id', extra: { garmentId: 'garment-1' } },
      { name: 'a raw user id', extra: { userId: 'raw-user-1' } },
    ])(
      'rejects a conversion carrying $name before anything is written',
      async ({ extra }) => {
        // The allowlist is `.strict()` at the validator, so a disallowed property
        // fails the capture instead of leaking into PostHog.
        await expect(
          service.captureEvent('raw-user-1', 'affiliate_conversion_recorded', {
            ...conversionProperties,
            matched: true,
            ...extra,
          } as never)
        ).rejects.toThrow()
        expect(telemetryCreate).not.toHaveBeenCalled()
        expect(analyticsCapture).not.toHaveBeenCalled()
      }
    )

    it('keeps both sinks independent for a conversion event', async () => {
      // The fail-open guarantee is not garment-specific and must survive the
      // generalization to a set plus a builder table.
      telemetryCreate.mockRejectedValue(new Error('DB connection failed'))

      await service.captureEvent(null, 'affiliate_conversion_recorded', {
        ...conversionProperties,
        matched: false,
      })

      expect(analyticsCapture).toHaveBeenCalled()
    })
  })
})

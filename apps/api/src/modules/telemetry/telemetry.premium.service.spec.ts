// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { type AnalyticsClient } from '../../analytics/analytics.service'
import { TelemetryService } from './telemetry.service'

// Story 5.3 theme, 5.4 palette advisor and 5.5 planner server events, split out
// of telemetry.service.spec.ts to keep both files under the size limit.
type CapturedEvent = {
  distinctId: string
  event: string
  properties: Record<string, unknown>
}

describe('TelemetryService premium events', () => {
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

  describe('story 5.3 premium theme server event', () => {
    beforeEach(() => {
      telemetryCreate.mockResolvedValue({ id: 'event-1' })
    })

    const subjectFor = (userId: string) =>
      createHmac('sha256', 'telemetry-test-secret-at-least-32-bytes')
        .update(userId)
        .digest('base64url')

    it('emits a palette selection under the acting user pseudonym', async () => {
      await service.captureEvent('raw-user-1', 'premium_theme_selected', {
        theme: 'jewel_radiance',
      })

      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: subjectFor('raw-user-1'),
        event: 'premium_theme_selected',
        properties: { theme: 'jewel_radiance', $ip: null },
      })
      expect(telemetryCreate).toHaveBeenCalledWith({
        data: {
          user_id: null,
          event_type: 'premium_theme_selected',
          properties: { theme: 'jewel_radiance' },
        },
      })
    })

    it('records a reset to Default as a null theme rather than skipping the event', async () => {
      // Null is the single spelling of Default across the schema, the wire, and
      // here. Dropping the event would make adoption look monotonic.
      await service.captureEvent('raw-user-1', 'premium_theme_selected', { theme: null })

      const captured = analyticsCapture.mock.calls[0]?.[0] as CapturedEvent
      expect(captured.properties).toEqual({ theme: null, $ip: null })
    })

    it('refuses to emit a theme selection with no authenticated user', async () => {
      // Membership in PSEUDONYMOUS_EVENT_TYPES persists user_id as null, so an
      // unauthenticated emission would publish an event nobody can attribute.
      await expect(
        service.captureEvent(null, 'premium_theme_selected', { theme: 'autumn_umber' })
      ).rejects.toThrow('Premium telemetry requires an authenticated user')
      expect(telemetryCreate).not.toHaveBeenCalled()
      expect(analyticsCapture).not.toHaveBeenCalled()
    })

    it.each([
      { name: 'a raw user id', extra: { userId: 'raw-user-1' } },
      { name: 'a palette hex value', extra: { cardBg: '#E9EDF6' } },
      { name: 'the previous palette', extra: { previousTheme: 'winter_metallic' } },
      { name: 'a surface', extra: { surface: 'web_settings' } },
    ])(
      'rejects a selection carrying $name before anything is written',
      async ({ extra }) => {
        // The allowlist is `.strict()` at the validator, so a disallowed property
        // fails the capture instead of leaking into PostHog.
        await expect(
          service.captureEvent('raw-user-1', 'premium_theme_selected', {
            theme: 'autumn_umber',
            ...extra,
          } as never)
        ).rejects.toThrow()
        expect(telemetryCreate).not.toHaveBeenCalled()
        expect(analyticsCapture).not.toHaveBeenCalled()
      }
    )

    it('rejects a palette the contract does not ship', async () => {
      await expect(
        service.captureEvent('raw-user-1', 'premium_theme_selected', {
          theme: 'spring_bloom',
        } as never)
      ).rejects.toThrow()
      expect(analyticsCapture).not.toHaveBeenCalled()
    })
  })

  describe('story 5.4 palette advisor server events', () => {
    beforeEach(() => {
      telemetryCreate.mockResolvedValue({ id: 'event-1' })
    })

    const subjectFor = (userId: string) =>
      createHmac('sha256', 'telemetry-test-secret-at-least-32-bytes')
        .update(userId)
        .digest('base64url')

    it('emits palette_analysis_completed under the acting user pseudonym, exactly once', async () => {
      await service.captureEvent('raw-user-1', 'palette_analysis_completed', {
        source: 'selfie',
        undertone: 'warm',
        depth: 'medium',
        outcome: 'ready',
      })

      expect(analyticsCapture).toHaveBeenCalledTimes(1)
      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: subjectFor('raw-user-1'),
        event: 'palette_analysis_completed',
        properties: {
          source: 'selfie',
          undertone: 'warm',
          depth: 'medium',
          outcome: 'ready',
          $ip: null,
        },
      })
      expect(telemetryCreate).toHaveBeenCalledWith({
        data: {
          user_id: null,
          event_type: 'palette_analysis_completed',
          properties: {
            source: 'selfie',
            undertone: 'warm',
            depth: 'medium',
            outcome: 'ready',
          },
        },
      })
    })

    it('records a failed analysis outcome with null undertone/depth rather than skipping the event', async () => {
      await service.captureEvent('raw-user-1', 'palette_analysis_completed', {
        source: 'selfie',
        undertone: null,
        depth: null,
        outcome: 'no_face',
      })

      const captured = analyticsCapture.mock.calls[0]?.[0] as CapturedEvent
      expect(captured.properties).toEqual({
        source: 'selfie',
        undertone: null,
        depth: null,
        outcome: 'no_face',
        $ip: null,
      })
    })

    it('emits advisor_offer_clicked with the advisor slot and platform', async () => {
      await service.captureEvent('raw-user-1', 'advisor_offer_clicked', {
        partnerId: 'sample-partner',
        offerId: 'offer-1',
        advisorSlot: 'foundation',
        platform: 'web',
      })

      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: subjectFor('raw-user-1'),
        event: 'advisor_offer_clicked',
        properties: {
          partner_id: 'sample-partner',
          offer_id: 'offer-1',
          advisor_slot: 'foundation',
          platform: 'web',
          $ip: null,
        },
      })
    })

    it('emits advisor_recommendation_acted for a save and a dismiss', async () => {
      await service.captureEvent('raw-user-1', 'advisor_recommendation_acted', {
        slot: 'blush',
        action: 'saved',
      })
      expect(analyticsCapture).toHaveBeenLastCalledWith({
        distinctId: subjectFor('raw-user-1'),
        event: 'advisor_recommendation_acted',
        properties: { slot: 'blush', action: 'saved', $ip: null },
      })

      await service.captureEvent('raw-user-1', 'advisor_recommendation_acted', {
        slot: 'blush',
        action: 'dismissed',
      })
      expect(analyticsCapture).toHaveBeenLastCalledWith({
        distinctId: subjectFor('raw-user-1'),
        event: 'advisor_recommendation_acted',
        properties: { slot: 'blush', action: 'dismissed', $ip: null },
      })
    })

    it.each([
      'palette_analysis_completed',
      'advisor_offer_clicked',
      'advisor_recommendation_acted',
    ] as const)('refuses to emit %s with no authenticated user', async (eventType) => {
      const props =
        eventType === 'palette_analysis_completed'
          ? { source: 'selfie', undertone: 'warm', depth: 'medium', outcome: 'ready' }
          : eventType === 'advisor_offer_clicked'
            ? {
                partnerId: 'sample-partner',
                offerId: 'offer-1',
                advisorSlot: 'foundation',
                platform: 'web',
              }
            : { slot: 'foundation', action: 'saved' }

      await expect(service.captureEvent(null, eventType, props as never)).rejects.toThrow(
        'Palette advisor telemetry requires an authenticated user'
      )
      expect(telemetryCreate).not.toHaveBeenCalled()
      expect(analyticsCapture).not.toHaveBeenCalled()
    })

    it.each([
      { name: 'a raw hex value', extra: { hex: '#C9A14A' } },
      { name: 'a confidence score', extra: { confidence: 0.82 } },
      { name: 'a raw user id', extra: { userId: 'raw-user-1' } },
      { name: 'an image path', extra: { objectPath: 'palette-selfies/u/s.jpg' } },
    ])(
      'rejects a palette_analysis_completed capture carrying $name before anything is written',
      async ({ extra }) => {
        await expect(
          service.captureEvent('raw-user-1', 'palette_analysis_completed', {
            source: 'selfie',
            undertone: 'warm',
            depth: 'medium',
            outcome: 'ready',
            ...extra,
          } as never)
        ).rejects.toThrow()
        expect(telemetryCreate).not.toHaveBeenCalled()
        expect(analyticsCapture).not.toHaveBeenCalled()
      }
    )

    it('rejects an out-of-enum outcome the contract does not ship', async () => {
      await expect(
        service.captureEvent('raw-user-1', 'palette_analysis_completed', {
          source: 'selfie',
          undertone: 'warm',
          depth: 'medium',
          outcome: 'not_a_real_outcome',
        } as never)
      ).rejects.toThrow()
      expect(analyticsCapture).not.toHaveBeenCalled()
    })
  })

  describe('story 5.5 planner server events', () => {
    beforeEach(() => {
      telemetryCreate.mockResolvedValue({ id: 'event-1' })
    })

    const subjectFor = (userId: string) =>
      createHmac('sha256', 'telemetry-test-secret-at-least-32-bytes')
        .update(userId)
        .digest('base64url')

    it('emits premium_planner_viewed with the platform and days ready', async () => {
      await service.captureEvent('raw-user-1', 'premium_planner_viewed', {
        platform: 'mobile',
        daysReady: 5,
      })

      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: subjectFor('raw-user-1'),
        event: 'premium_planner_viewed',
        properties: { platform: 'mobile', days_ready: 5, $ip: null },
      })
      expect(telemetryCreate).toHaveBeenCalledWith({
        data: {
          user_id: null,
          event_type: 'premium_planner_viewed',
          properties: { platform: 'mobile', days_ready: 5 },
        },
      })
    })

    it('emits premium_planner_day_reshuffled for a changed and an unchanged reshuffle', async () => {
      await service.captureEvent('raw-user-1', 'premium_planner_day_reshuffled', {
        platform: 'web',
        dayOffset: 0,
        unchanged: false,
      })
      expect(analyticsCapture).toHaveBeenLastCalledWith({
        distinctId: subjectFor('raw-user-1'),
        event: 'premium_planner_day_reshuffled',
        properties: { platform: 'web', day_offset: 0, unchanged: false, $ip: null },
      })

      await service.captureEvent('raw-user-1', 'premium_planner_day_reshuffled', {
        platform: 'web',
        dayOffset: 6,
        unchanged: true,
      })
      expect(analyticsCapture).toHaveBeenLastCalledWith({
        distinctId: subjectFor('raw-user-1'),
        event: 'premium_planner_day_reshuffled',
        properties: { platform: 'web', day_offset: 6, unchanged: true, $ip: null },
      })
    })

    it.each(['premium_planner_viewed', 'premium_planner_day_reshuffled'] as const)(
      'refuses to emit %s with no authenticated user',
      async (eventType) => {
        const props =
          eventType === 'premium_planner_viewed'
            ? { platform: 'web', daysReady: 7 }
            : { platform: 'web', dayOffset: 0, unchanged: false }

        await expect(
          service.captureEvent(null, eventType, props as never)
        ).rejects.toThrow('Premium planner telemetry requires an authenticated user')
        expect(telemetryCreate).not.toHaveBeenCalled()
        expect(analyticsCapture).not.toHaveBeenCalled()
      }
    )

    it.each([
      { name: 'a location id', extra: { locationId: 'saved-location-1' } },
      { name: 'wardrobe garment ids', extra: { garmentIds: ['garment-1'] } },
      { name: 'a raw user id', extra: { userId: 'raw-user-1' } },
    ])(
      'rejects a premium_planner_viewed capture carrying $name before anything is written',
      async ({ extra }) => {
        await expect(
          service.captureEvent('raw-user-1', 'premium_planner_viewed', {
            platform: 'web',
            daysReady: 7,
            ...extra,
          } as never)
        ).rejects.toThrow()
        expect(telemetryCreate).not.toHaveBeenCalled()
        expect(analyticsCapture).not.toHaveBeenCalled()
      }
    )

    it('rejects a dayOffset outside 0 through 6', async () => {
      await expect(
        service.captureEvent('raw-user-1', 'premium_planner_day_reshuffled', {
          platform: 'web',
          dayOffset: 7,
          unchanged: false,
        } as never)
      ).rejects.toThrow()
      expect(analyticsCapture).not.toHaveBeenCalled()
    })

    it('rejects an out-of-enum platform the contract does not ship', async () => {
      await expect(
        service.captureEvent('raw-user-1', 'premium_planner_viewed', {
          platform: 'desktop',
          daysReady: 7,
        } as never)
      ).rejects.toThrow()
      expect(analyticsCapture).not.toHaveBeenCalled()
    })
  })
})

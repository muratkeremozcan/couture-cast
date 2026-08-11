import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { TelemetryService } from './telemetry.service'
import type { PrismaClient } from '@prisma/client'
import { type AnalyticsClient } from '../../analytics/analytics.service'

type CapturedEvent = {
  distinctId: string
  event: string
  properties: Record<string, unknown>
}

describe('TelemetryService', () => {
  let service: TelemetryService
  let telemetryCreate: ReturnType<typeof vi.fn>
  let telemetryDeleteMany: ReturnType<typeof vi.fn>
  let telemetryFindFirst: ReturnType<typeof vi.fn>
  let outfitCount: ReturnType<typeof vi.fn>
  let analyticsCapture: ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env.ANALYTICS_ID_SECRET = 'telemetry-test-secret-at-least-32-bytes'
    telemetryCreate = vi.fn()
    telemetryDeleteMany = vi.fn()
    telemetryFindFirst = vi.fn().mockResolvedValue(null)
    outfitCount = vi.fn()
    analyticsCapture = vi.fn()

    const mockPrisma = {
      telemetryEvent: {
        create: telemetryCreate,
        deleteMany: telemetryDeleteMany,
        findFirst: telemetryFindFirst,
      },
      outfitRecommendation: {
        count: outfitCount,
      },
      $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    }

    const mockAnalyticsClient: AnalyticsClient = {
      capture: analyticsCapture,
    } as unknown as AnalyticsClient

    service = new TelemetryService(
      mockPrisma as unknown as PrismaClient,
      mockAnalyticsClient
    )
  })

  it('persists events to database and dispatches to PostHog', async () => {
    telemetryCreate.mockResolvedValue({ id: 'event-1' })

    await service.captureEvent('user-1', 'profile_completed', {
      age: 25,
      guardianConsentRequired: false,
    })

    expect(telemetryCreate).toHaveBeenCalledWith({
      data: {
        user_id: 'user-1',
        event_type: 'profile_completed',
        properties: {
          age: 25,
          guardianConsentRequired: false,
        },
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    expect(analyticsCapture).toHaveBeenCalledWith({
      distinctId: 'user-1',
      event: 'profile_completed',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      properties: expect.objectContaining({
        user_id: 'user-1',
        age: 25,
        guardian_consent_required: false,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        timestamp: expect.any(String),
      }),
    })
  })

  it('handles database failure without failing PostHog delivery', async () => {
    telemetryCreate.mockRejectedValue(new Error('DB connection failed'))

    await service.captureEvent('user-1', 'profile_completed', {
      age: 25,
      guardianConsentRequired: false,
    })

    expect(telemetryCreate).toHaveBeenCalled()
    expect(analyticsCapture).toHaveBeenCalled()
  })

  it('handles PostHog failure without failing database persistence', async () => {
    telemetryCreate.mockResolvedValue({ id: 'event-1' })
    analyticsCapture.mockImplementation(() => {
      throw new Error('PostHog rate limit')
    })

    await service.captureEvent('user-1', 'profile_completed', {
      age: 25,
      guardianConsentRequired: false,
    })

    expect(telemetryCreate).toHaveBeenCalled()
    expect(analyticsCapture).toHaveBeenCalled()
  })

  it('emits strict pseudonymous garment completion telemetry without IP capture', async () => {
    telemetryCreate.mockResolvedValue({ id: 'event-1' })

    await service.captureEvent('raw-user-1', 'garment_upload_completed', {
      garmentId: 'garment-1',
      fileSizeBytes: 2048,
      mimeType: 'image/png',
      hasCropping: true,
      hasBgCleanup: false,
      durationMs: 1200,
    })

    const subject = createHmac('sha256', 'telemetry-test-secret-at-least-32-bytes')
      .update('raw-user-1')
      .digest('base64url')
    const productProperties = {
      garment_id: 'garment-1',
      file_size_bytes: 2048,
      mime_type: 'image/png',
      has_cropping: true,
      has_bg_cleanup: false,
      duration_ms: 1200,
    }

    expect(telemetryCreate).toHaveBeenCalledWith({
      data: {
        user_id: null,
        event_type: 'garment_upload_completed',
        properties: productProperties,
      },
    })
    expect(analyticsCapture).toHaveBeenCalledWith({
      distinctId: subject,
      event: 'garment_upload_completed',
      properties: { ...productProperties, $ip: null },
    })
  })

  it('rejects incomplete or unknown garment completion properties', async () => {
    await expect(
      service.captureEvent('raw-user-1', 'garment_upload_completed', {
        garmentId: 'garment-1',
        fileSizeBytes: 2048,
        mimeType: 'image/png',
        hasCropping: true,
        hasBgCleanup: false,
        durationMs: 1200,
        userId: 'raw-user-1',
      } as never)
    ).rejects.toThrow()
    expect(telemetryCreate).not.toHaveBeenCalled()
    expect(analyticsCapture).not.toHaveBeenCalled()
  })

  it('prunes old telemetry events older than 24 hours', async () => {
    telemetryDeleteMany.mockResolvedValue({ count: 5 })

    await service.pruneOldTelemetryEvents()

    expect(telemetryDeleteMany).toHaveBeenCalledWith({
      where: {
        created_at: {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          lt: expect.any(Date),
        },
      },
    })
  })

  it('triggers first_outfit_generated when it is indeed the first outfit recommendation', async () => {
    outfitCount.mockResolvedValue(1)
    telemetryCreate.mockResolvedValue({ id: 'event-1' })

    await service.trackOutfitGenerated('user-1', 'loc-1')

    expect(outfitCount).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
    })
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    expect(telemetryCreate).toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          user_id: 'user-1',
          event_type: 'first_outfit_generated',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          properties: expect.objectContaining({
            locationId: 'loc-1',
            isFirstOutfit: true,
          }),
        }),
      })
    )
  })

  it('does not trigger first_outfit_generated when it is not the first recommendation', async () => {
    outfitCount.mockResolvedValue(3)

    await service.trackOutfitGenerated('user-1', 'loc-1')

    expect(outfitCount).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
    })
    expect(telemetryCreate).not.toHaveBeenCalled()
  })

  describe('analytics subject pseudonymization secret', () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalTestEnv = process.env.TEST_ENV

    const buildService = () =>
      new TelemetryService(
        {
          telemetryEvent: { create: telemetryCreate },
        } as unknown as PrismaClient,
        { capture: analyticsCapture } as unknown as AnalyticsClient
      )

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv
      if (originalTestEnv === undefined) {
        delete process.env.TEST_ENV
      } else {
        process.env.TEST_ENV = originalTestEnv
      }
    })

    it('falls back to the test-only secret when none is configured under test', async () => {
      delete process.env.ANALYTICS_ID_SECRET
      telemetryCreate.mockResolvedValue({ id: 'event-1' })

      await buildService().captureEvent('raw-user-1', 'garment_upload_completed', {
        garmentId: 'garment-1',
        fileSizeBytes: 2048,
        mimeType: 'image/png',
        hasCropping: false,
        hasBgCleanup: false,
        durationMs: 10,
      })

      const captured = analyticsCapture.mock.calls[0]?.[0] as CapturedEvent
      expect(captured.distinctId).toBe(
        createHmac('sha256', 'test-only-analytics-id-secret-at-least-32-bytes')
          .update('raw-user-1')
          .digest('base64url')
      )
    })

    it('ignores a configured secret that is too short to be safe', async () => {
      // A weak secret would make the analytics subject id trivially reversible,
      // so it must be rejected rather than silently used.
      process.env.ANALYTICS_ID_SECRET = 'too-short'
      telemetryCreate.mockResolvedValue({ id: 'event-1' })

      await buildService().captureEvent('raw-user-1', 'garment_upload_completed', {
        garmentId: 'garment-1',
        fileSizeBytes: 2048,
        mimeType: 'image/png',
        hasCropping: false,
        hasBgCleanup: false,
        durationMs: 10,
      })

      const captured = analyticsCapture.mock.calls[0]?.[0] as CapturedEvent
      expect(captured.distinctId).not.toBe(
        createHmac('sha256', 'too-short').update('raw-user-1').digest('base64url')
      )
    })

    it('refuses to construct outside test environments without a strong secret', () => {
      // Fail closed: production must never pseudonymize with a shared default.
      delete process.env.ANALYTICS_ID_SECRET
      process.env.NODE_ENV = 'production'
      delete process.env.TEST_ENV

      expect(() => buildService()).toThrow(
        'ANALYTICS_ID_SECRET must contain at least 32 characters'
      )
    })
  })

  describe('event payload mapping', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'))
      telemetryCreate.mockResolvedValue({ id: 'event-1' })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('accepts snake_case forecast properties from callers', async () => {
      await service.captureEvent('user-1', 'forecast_viewed', {
        location_key: 'chicago-il',
        status: 'stale',
      })

      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: 'user-1',
        event: 'forecast_viewed',
        properties: {
          user_id: 'user-1',
          location_key: 'chicago-il',
          status: 'stale',
          timestamp: '2026-07-16T12:00:00.000Z',
        },
      })
    })

    it('maps an alert into the canonical alert_sent payload', async () => {
      await service.captureEvent('user-1', 'alert_sent', {
        alert_type: 'severe_weather',
        severity: 'critical',
        channel: 'push',
      })

      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: 'user-1',
        event: 'alert_sent',
        properties: {
          user_id: 'user-1',
          alert_type: 'severe_weather',
          severity: 'critical',
          channel: 'push',
          timestamp: '2026-07-16T12:00:00.000Z',
        },
      })
    })

    it('preserves a null previous location on the first location switch', async () => {
      await service.captureEvent('user-1', 'location_switched', {
        fromLocation: null,
        toLocation: 'austin-tx',
      })

      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: 'user-1',
        event: 'location_switched',
        properties: {
          user_id: 'user-1',
          from_location: null,
          to_location: 'austin-tx',
          timestamp: '2026-07-16T12:00:00.000Z',
        },
      })
    })

    it('honors an explicit isFirstOutfit override', async () => {
      await service.captureEvent('user-1', 'first_outfit_generated', {
        location_id: 'loc-9',
        is_first_outfit: false,
      })

      const captured = analyticsCapture.mock.calls[0]?.[0] as CapturedEvent
      expect(captured.properties).toMatchObject({
        location_id: 'loc-9',
        is_first_outfit: false,
      })
    })

    it('recovers the user id from the event properties when none is passed', async () => {
      await service.captureEvent(null, 'api_error_occurred', {
        user_id: 'user-7',
        endpoint: '/api/v1/ritual',
        method: 'GET',
        status_code: 503,
        error_message: 'weather provider unavailable',
      })

      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: 'user-7',
        event: 'api_error_occurred',
        properties: {
          user_id: 'user-7',
          route: '/api/v1/ritual',
          method: 'GET',
          status_code: 503,
          error_code: 'weather provider unavailable',
          timestamp: '2026-07-16T12:00:00.000Z',
        },
      })
    })

    it('substitutes safe defaults for an unattributed API error', async () => {
      // Error telemetry from unauthenticated routes still has to be emitted; the
      // contract schema rejects empty strings, so the fallbacks matter.
      await service.captureEvent(null, 'api_error_occurred', {
        method: '',
        statusCode: 500,
      })

      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: 'anonymous',
        event: 'api_error_occurred',
        properties: {
          user_id: null,
          route: 'unknown',
          method: 'unknown',
          status_code: 500,
          error_code: 'INTERNAL_ERROR',
          timestamp: '2026-07-16T12:00:00.000Z',
        },
      })
    })

    it('emits pseudonymous garment tagging telemetry without a raw user id', async () => {
      await service.captureEvent('raw-user-1', 'garment_tagging_completed', {
        analyticsSubjectId: 'ignored-client-supplied-subject',
        garmentId: 'garment-1',
        suggestedCategory: 'top',
        confirmedCategory: 'outerwear',
        suggestedMaterial: 'cotton',
        confirmedMaterial: 'wool',
        suggestedComfortRange: 'mild',
        confirmedComfortRange: 'cold',
        suggestionAvailable: true,
        analysisVersion: 'v2',
        wasOverridden: true,
        overrideFields: ['category', 'material'],
      })

      const subject = createHmac('sha256', 'telemetry-test-secret-at-least-32-bytes')
        .update('raw-user-1')
        .digest('base64url')
      const captured = analyticsCapture.mock.calls[0]?.[0] as CapturedEvent

      expect(captured.distinctId).toBe(subject)
      expect(captured.properties).toEqual({
        garment_id: 'garment-1',
        suggested_category: 'top',
        confirmed_category: 'outerwear',
        suggested_material: 'cotton',
        confirmed_material: 'wool',
        suggested_comfort_range: 'mild',
        confirmed_comfort_range: 'cold',
        suggestion_available: true,
        analysis_version: 'v2',
        was_overridden: true,
        override_fields: ['category', 'material'],
        $ip: null,
      })
      const persisted = telemetryCreate.mock.calls[0]?.[0] as {
        data: { user_id: string | null }
      }
      expect(persisted.data.user_id).toBeNull()
    })

    it('refuses to emit garment telemetry for an unauthenticated caller', async () => {
      // Without a user there is no stable subject to hash, so emitting anyway
      // would either leak an empty subject or corrupt the funnel.
      await expect(
        service.captureEvent(null, 'garment_upload_completed', {
          garmentId: 'garment-1',
          fileSizeBytes: 2048,
          mimeType: 'image/png',
          hasCropping: false,
          hasBgCleanup: false,
          durationMs: 10,
        })
      ).rejects.toThrow('Garment telemetry requires an authenticated user')
      expect(telemetryCreate).not.toHaveBeenCalled()
    })

    it('persists an event type with no PostHog mapping without dispatching it', async () => {
      // Guards against a new event type silently throwing before the audit row
      // is written when its builder has not been registered yet.
      await service.captureEvent(
        'user-1',
        'wardrobe_capsule_created' as never,
        {
          capsuleId: 'capsule-1',
        } as never
      )

      const persisted = telemetryCreate.mock.calls[0]?.[0] as {
        data: { user_id: string | null; event_type: string }
      }
      expect(persisted.data).toMatchObject({
        user_id: 'user-1',
        event_type: 'wardrobe_capsule_created',
      })
      expect(analyticsCapture).not.toHaveBeenCalled()
    })
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

  describe('trackOutfitGenerated', () => {
    it('does not re-emit first_outfit_generated when one was already recorded', async () => {
      // Retried ritual generation must not duplicate the funnel event.
      outfitCount.mockResolvedValue(1)
      telemetryFindFirst.mockResolvedValue({ id: 'existing-event' })

      await service.trackOutfitGenerated('user-1', 'loc-1')

      expect(telemetryCreate).not.toHaveBeenCalled()
      expect(analyticsCapture).not.toHaveBeenCalled()
    })

    it('still evaluates the first-outfit check when advisory locks are unavailable', async () => {
      // Databases without pg_advisory_xact_lock must degrade, not fail the ritual.
      const executeRawUnsafe = vi.fn().mockRejectedValue(new Error('unsupported'))
      const prisma = {
        telemetryEvent: { create: telemetryCreate, findFirst: telemetryFindFirst },
        outfitRecommendation: { count: outfitCount },
        $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
        $executeRawUnsafe: executeRawUnsafe,
      }
      outfitCount.mockResolvedValue(1)
      telemetryCreate.mockResolvedValue({ id: 'event-1' })
      const lockFreeService = new TelemetryService(
        prisma as unknown as PrismaClient,
        { capture: analyticsCapture } as unknown as AnalyticsClient
      )

      await lockFreeService.trackOutfitGenerated('user-1', 'loc-1')

      expect(executeRawUnsafe).toHaveBeenCalled()
      expect(telemetryCreate).toHaveBeenCalled()
    })

    it('swallows transaction failures so outfit generation still succeeds', async () => {
      // Telemetry is best-effort; it must never surface as a ritual failure.
      const prisma = {
        telemetryEvent: { create: telemetryCreate, findFirst: telemetryFindFirst },
        outfitRecommendation: { count: outfitCount },
        $transaction: vi.fn().mockRejectedValue(new Error('deadlock detected')),
        $executeRawUnsafe: vi.fn(),
      }
      const failingService = new TelemetryService(
        prisma as unknown as PrismaClient,
        { capture: analyticsCapture } as unknown as AnalyticsClient
      )

      await expect(
        failingService.trackOutfitGenerated('user-1', 'loc-1')
      ).resolves.toBeUndefined()
      expect(telemetryCreate).not.toHaveBeenCalled()
    })

    describe('without transaction support', () => {
      const buildService = () =>
        new TelemetryService(
          {
            telemetryEvent: { create: telemetryCreate, findFirst: telemetryFindFirst },
            outfitRecommendation: { count: outfitCount },
          } as unknown as PrismaClient,
          { capture: analyticsCapture } as unknown as AnalyticsClient
        )

      it('captures the first outfit through the non-transactional path', async () => {
        outfitCount.mockResolvedValue(1)
        telemetryCreate.mockResolvedValue({ id: 'event-1' })

        await buildService().trackOutfitGenerated('user-1', 'loc-1')

        const persisted = telemetryCreate.mock.calls[0]?.[0] as {
          data: { event_type: string }
        }
        expect(persisted.data.event_type).toBe('first_outfit_generated')
      })

      it('stays silent on later outfits through the non-transactional path', async () => {
        outfitCount.mockResolvedValue(4)

        await buildService().trackOutfitGenerated('user-1', 'loc-1')

        expect(telemetryCreate).not.toHaveBeenCalled()
      })
    })
  })

  describe('pruneOldTelemetryEvents', () => {
    it('uses a cutoff exactly 24 hours in the past', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'))
      try {
        telemetryDeleteMany.mockResolvedValue({ count: 2 })

        await service.pruneOldTelemetryEvents()

        const args = telemetryDeleteMany.mock.calls[0]?.[0] as {
          where: { created_at: { lt: Date } }
        }
        expect(args.where.created_at.lt.toISOString()).toBe('2026-07-15T12:00:00.000Z')
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not throw when the prune query fails', async () => {
      // The hourly cron must survive a database hiccup and retry next hour.
      telemetryDeleteMany.mockRejectedValue(new Error('connection reset'))

      await expect(service.pruneOldTelemetryEvents()).resolves.toBeUndefined()
    })
  })
})

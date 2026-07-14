import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TelemetryService } from './telemetry.service'
import type { PrismaClient } from '@prisma/client'
import { type AnalyticsClient } from '../../analytics/analytics.service'

describe('TelemetryService', () => {
  let service: TelemetryService
  let telemetryCreate: ReturnType<typeof vi.fn>
  let telemetryDeleteMany: ReturnType<typeof vi.fn>
  let outfitCount: ReturnType<typeof vi.fn>
  let analyticsCapture: ReturnType<typeof vi.fn>

  beforeEach(() => {
    telemetryCreate = vi.fn()
    telemetryDeleteMany = vi.fn()
    outfitCount = vi.fn()
    analyticsCapture = vi.fn()

    const mockPrisma = {
      telemetryEvent: {
        create: telemetryCreate,
        deleteMany: telemetryDeleteMany,
      },
      outfitRecommendation: {
        count: outfitCount,
      },
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
})

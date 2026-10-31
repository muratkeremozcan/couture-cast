// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { type AnalyticsClient } from '../../analytics/analytics.service'
import { TelemetryService } from './telemetry.service'

// Story 1.2b: location events are pseudonymous. The raw member id never
// reaches PostHog or the persisted row, and no place property survives.
const ANALYTICS_ID_SECRET = 'telemetry-test-secret-at-least-32-bytes'
const subjectFor = (userId: string) =>
  createHmac('sha256', ANALYTICS_ID_SECRET).update(userId).digest('base64url')

describe('TelemetryService location events', () => {
  let service: TelemetryService
  let telemetryCreate: ReturnType<typeof vi.fn>
  let analyticsCapture: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubEnv('ANALYTICS_ID_SECRET', ANALYTICS_ID_SECRET)
    telemetryCreate = vi.fn().mockResolvedValue({ id: 'event-1' })
    analyticsCapture = vi.fn()
    service = new TelemetryService(
      { telemetryEvent: { create: telemetryCreate } } as unknown as PrismaClient,
      { capture: analyticsCapture } as unknown as AnalyticsClient
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('captures location_switched under the HMAC subject with no properties', async () => {
    await service.captureEvent('user-1', 'location_switched', {})

    expect(analyticsCapture).toHaveBeenCalledWith({
      distinctId: subjectFor('user-1'),
      event: 'location_switched',
      properties: { $ip: null },
    })
    expect(telemetryCreate).toHaveBeenCalledWith({
      data: { user_id: null, event_type: 'location_switched', properties: {} },
    })
  })

  it('refuses place keys on location_switched', async () => {
    await expect(
      service.captureEvent('user-1', 'location_switched', {
        toLocation: 'austin-tx',
      } as never)
    ).rejects.toThrow()
    expect(analyticsCapture).not.toHaveBeenCalled()
  })

  it.each([
    [
      'location_saved',
      { platform: 'web', outcome: 'saved', resultCount: 2 },
      { platform: 'web', outcome: 'saved', result_count: 2 },
    ],
    [
      'location_search_failed',
      { platform: 'mobile', outcome: 'no_results', resultCount: 0 },
      { platform: 'mobile', outcome: 'no_results', result_count: 0 },
    ],
  ] as const)(
    'captures %s under the HMAC subject with closed properties',
    async (event, input, expected) => {
      await service.captureEvent('user-1', event, input)

      expect(analyticsCapture).toHaveBeenCalledWith({
        distinctId: subjectFor('user-1'),
        event,
        properties: { ...expected, $ip: null },
      })
      expect(telemetryCreate).toHaveBeenCalledWith({
        data: { user_id: null, event_type: event, properties: expected },
      })
    }
  )
})

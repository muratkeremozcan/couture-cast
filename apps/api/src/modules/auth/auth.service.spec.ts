import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGuardianProfileFixture,
  createTeenProfileFixture,
  resetCleanupRegistry,
} from '../../../test/factories.js'
import type { AnalyticsClient } from '../../analytics/analytics.service'
import { AuthService } from './auth.service'

const createService = () => {
  const capture = vi.fn()
  const analyticsClient = {
    capture,
  } as unknown as AnalyticsClient

  return { service: new AuthService(analyticsClient), capture }
}

describe('AuthService', () => {
  afterEach(() => {
    resetCleanupRegistry()
  })

  it('tracks guardian_consent_granted with normalized properties', () => {
    const guardian = createGuardianProfileFixture()
    const teen = createTeenProfileFixture()
    const { service, capture } = createService()

    const result = service.grantGuardianConsent({
      guardianId: guardian.id,
      teenId: teen.id,
      consentLevel: 'full',
      timestamp: '2026-03-04T10:00:00.000Z',
    })

    expect(capture).toHaveBeenCalledWith({
      distinctId: guardian.id,
      event: 'guardian_consent_granted',
      properties: {
        guardian_id: guardian.id,
        teen_id: teen.id,
        consent_level: 'full',
        timestamp: '2026-03-04T10:00:00.000Z',
        consent_timestamp: '2026-03-04T10:00:00.000Z',
      },
    })
    expect(result).toEqual({ tracked: true })
  })
})

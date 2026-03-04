import { describe, expect, it, vi } from 'vitest'
import type { PostHogService } from '../../posthog/posthog.service'
import { AuthService } from './auth.service'

const createService = () => {
  const capture = vi.fn()
  const posthog = {
    capture,
  } as unknown as PostHogService

  return { service: new AuthService(posthog), capture }
}

describe('AuthService', () => {
  it('tracks guardian_consent_granted with normalized properties', () => {
    const { service, capture } = createService()

    const result = service.grantGuardianConsent({
      guardianId: 'guardian-7',
      teenId: 'teen-4',
      consentLevel: 'full',
      timestamp: '2026-03-04T10:00:00.000Z',
    })

    expect(capture).toHaveBeenCalledWith({
      distinctId: 'guardian-7',
      event: 'guardian_consent_granted',
      properties: {
        guardian_id: 'guardian-7',
        teen_id: 'teen-4',
        consent_level: 'full',
        timestamp: '2026-03-04T10:00:00.000Z',
        consent_timestamp: '2026-03-04T10:00:00.000Z',
      },
    })
    expect(result).toEqual({ tracked: true })
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  GuardianConsentRevokeResponse,
  UserProfileResponse,
} from '@couture/api-client/contracts/http'
import { GuardianDashboardView } from './guardian-dashboard-view'

describe('GuardianDashboardView', () => {
  it('shows linked teens and lets a guardian revoke consent', async () => {
    const profile: UserProfileResponse = {
      user: {
        id: 'guardian-7',
        email: 'guardian7@example.com',
        displayName: 'Alex Rivera',
        birthdate: '1987-03-04T00:00:00.000Z',
        role: 'guardian',
      },
      linkedGuardians: [],
      linkedTeens: [
        {
          teenId: 'teen-4',
          status: 'granted',
          consentGrantedAt: '2026-04-17T06:00:00.000Z',
        },
      ],
    }
    const revokeResponse: GuardianConsentRevokeResponse = {
      guardianId: 'guardian-7',
      teenId: 'teen-4',
      revokedAt: '2026-04-21T13:00:00.000Z',
      remainingActiveGuardians: 0,
      sessionInvalidated: true,
      notificationQueued: true,
    }
    const revokeConsent = vi.fn().mockResolvedValue(revokeResponse)

    render(
      <GuardianDashboardView
        loadProfile={() => Promise.resolve(profile)}
        revokeConsent={revokeConsent}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('teen-4')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Revoke consent for teen-4' }))

    await waitFor(() => {
      expect(revokeConsent).toHaveBeenCalledWith({
        guardianId: 'guardian-7',
        teenId: 'teen-4',
      })
    })
    expect(screen.getByTestId('guardian-dashboard-message')).toHaveTextContent(
      'Consent revoked for teen-4'
    )
    expect(screen.getByTestId('linked-teen-teen-4')).toHaveTextContent('revoked')
  })
})

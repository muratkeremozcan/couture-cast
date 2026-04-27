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

  it('shows an error when revoking consent fails', async () => {
    const profile: UserProfileResponse = {
      user: {
        id: 'guardian-8',
        email: 'guardian8@example.com',
        displayName: 'Morgan Chen',
        birthdate: '1984-09-11T00:00:00.000Z',
        role: 'guardian',
      },
      linkedGuardians: [],
      linkedTeens: [
        {
          teenId: 'teen-8',
          status: 'granted',
          consentGrantedAt: '2026-04-18T06:00:00.000Z',
        },
      ],
    }
    const revokeConsent = vi.fn().mockRejectedValue(new Error('Unable to revoke now'))

    render(
      <GuardianDashboardView
        loadProfile={() => Promise.resolve(profile)}
        revokeConsent={revokeConsent}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('teen-8')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Revoke consent for teen-8' }))

    await waitFor(() => {
      expect(revokeConsent).toHaveBeenCalledWith({
        guardianId: 'guardian-8',
        teenId: 'teen-8',
      })
      expect(screen.getByTestId('guardian-dashboard-error')).toHaveTextContent(
        'Unable to revoke now'
      )
    })
    expect(screen.getByTestId('linked-teen-teen-8')).toHaveTextContent('granted')
  })

  it('shows a profile loading error on mount', async () => {
    const loadProfile = vi.fn().mockRejectedValue(new Error('Profile unavailable'))

    render(<GuardianDashboardView loadProfile={loadProfile} />)

    expect(screen.getByText('Loading linked teens...')).toBeInTheDocument()
    await waitFor(() => {
      expect(loadProfile).toHaveBeenCalled()
      expect(screen.getByTestId('guardian-dashboard-error')).toHaveTextContent(
        'Profile unavailable'
      )
    })
  })

  it('revokes only the selected teen when multiple teens are linked', async () => {
    const profile: UserProfileResponse = {
      user: {
        id: 'guardian-9',
        email: 'guardian9@example.com',
        displayName: 'Jordan Park',
        birthdate: '1981-12-02T00:00:00.000Z',
        role: 'guardian',
      },
      linkedGuardians: [],
      linkedTeens: [
        {
          teenId: 'teen-9a',
          status: 'granted',
          consentGrantedAt: '2026-04-17T06:00:00.000Z',
        },
        {
          teenId: 'teen-9b',
          status: 'granted',
          consentGrantedAt: '2026-04-18T06:00:00.000Z',
        },
      ],
    }
    const revokeResponse: GuardianConsentRevokeResponse = {
      guardianId: 'guardian-9',
      teenId: 'teen-9b',
      revokedAt: '2026-04-21T13:00:00.000Z',
      remainingActiveGuardians: 1,
      sessionInvalidated: false,
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
      expect(screen.getByTestId('linked-teen-teen-9a')).toHaveTextContent('granted')
      expect(screen.getByTestId('linked-teen-teen-9b')).toHaveTextContent('granted')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Revoke consent for teen-9b' }))

    await waitFor(() => {
      expect(revokeConsent).toHaveBeenCalledWith({
        guardianId: 'guardian-9',
        teenId: 'teen-9b',
      })
      expect(screen.getByTestId('guardian-dashboard-message')).toHaveTextContent(
        'Consent revoked for teen-9b'
      )
      expect(screen.getByTestId('linked-teen-teen-9b')).toHaveTextContent('revoked')
    })
    expect(screen.getByTestId('linked-teen-teen-9a')).toHaveTextContent('granted')
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  GuardianConsentRevokeResponse,
  UserProfileResponse,
} from '@couture/api-client/contracts/http'
import { GuardianDashboardScreen } from './guardian-dashboard-screen'

function guardianProfile(overrides: Partial<UserProfileResponse> = {}) {
  return {
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
        status: 'granted' as const,
        consentGrantedAt: '2026-04-17T06:00:00.000Z',
      },
    ],
    ...overrides,
  } satisfies UserProfileResponse
}

describe('GuardianDashboardScreen', () => {
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
      <GuardianDashboardScreen
        loadProfile={() => Promise.resolve(profile)}
        revokeConsent={revokeConsent}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('teen-4')).toBeTruthy()
    })

    // React Native Pressable is rendered through the mobile DOM test setup here;
    // user-event is not available in this workspace, so fireEvent exercises it.
    fireEvent.click(screen.getByRole('button', { name: 'Revoke consent for teen-4' }))

    await waitFor(() => {
      expect(revokeConsent).toHaveBeenCalledWith({
        guardianId: 'guardian-7',
        teenId: 'teen-4',
      })
    })
    expect(screen.getByTestId('guardian-dashboard-message').textContent).toContain(
      'Consent revoked for teen-4'
    )
    expect(screen.getByTestId('linked-teen-teen-4').textContent).toContain('revoked')
  })

  it('revokes only the selected teen and reports a session that survived', async () => {
    // Revoking must not touch the guardian's other teens, and the guardian
    // needs to know when the teen's session was *not* invalidated because that
    // means the teen may still be signed in on a device.
    const profile = guardianProfile({
      linkedTeens: [
        {
          teenId: 'teen-4',
          status: 'granted',
          consentGrantedAt: '2026-04-17T06:00:00.000Z',
        },
        { teenId: 'teen-8', status: 'granted', consentGrantedAt: null },
      ],
    })
    const revokeConsent = vi.fn().mockResolvedValue({
      guardianId: 'guardian-7',
      teenId: 'teen-4',
      revokedAt: '2026-04-21T13:00:00.000Z',
      remainingActiveGuardians: 1,
      sessionInvalidated: false,
      notificationQueued: true,
    } satisfies GuardianConsentRevokeResponse)

    render(
      <GuardianDashboardScreen
        loadProfile={() => Promise.resolve(profile)}
        revokeConsent={revokeConsent}
      />
    )

    await waitFor(() => screen.getByTestId('linked-teen-teen-8'))
    // teen-8 has never accepted, so it has no consent date to format.
    expect(screen.getByTestId('linked-teen-teen-8').textContent).toContain(
      'Awaiting consent'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Revoke consent for teen-4' }))

    await waitFor(() => {
      expect(screen.getByTestId('guardian-dashboard-message').textContent).toContain(
        'Teen session invalidated: no.'
      )
    })
    expect(screen.getByTestId('linked-teen-teen-4').textContent).toContain('revoked')
    expect(screen.getByTestId('linked-teen-teen-8').textContent).toContain('granted')
  })

  it('keeps the teen list usable and explains why when revoking is rejected', async () => {
    const revokeConsent = vi
      .fn()
      .mockRejectedValue(new Error('Consent record is locked by an audit hold'))

    render(
      <GuardianDashboardScreen
        loadProfile={() => Promise.resolve(guardianProfile())}
        revokeConsent={revokeConsent}
      />
    )

    await waitFor(() => screen.getByTestId('linked-teen-teen-4'))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke consent for teen-4' }))

    await waitFor(() => {
      expect(screen.getByTestId('guardian-dashboard-error').textContent).toBe(
        'Consent record is locked by an audit hold'
      )
    })
    // A failed revoke must leave consent as it was, not optimistically revoked.
    expect(screen.getByTestId('linked-teen-teen-4').textContent).toContain('granted')
    expect(
      screen.getByRole('button', { name: 'Revoke consent for teen-4' })
    ).toBeEnabled()
  })

  it('falls back to a generic revoke message for a non-Error rejection', async () => {
    const revokeConsent = vi.fn().mockRejectedValue('network down')

    render(
      <GuardianDashboardScreen
        loadProfile={() => Promise.resolve(guardianProfile())}
        revokeConsent={revokeConsent}
      />
    )

    await waitFor(() => screen.getByTestId('linked-teen-teen-4'))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke consent for teen-4' }))

    await waitFor(() => {
      expect(screen.getByTestId('guardian-dashboard-error').textContent).toBe(
        'Unable to revoke consent'
      )
    })
  })

  it('falls back to the guardian email and says when no teens are linked', async () => {
    const profile = guardianProfile({
      user: {
        id: 'guardian-9',
        email: 'guardian9@example.com',
        displayName: null,
        birthdate: '1987-03-04T00:00:00.000Z',
        role: 'guardian',
      },
      linkedTeens: [],
    })

    render(<GuardianDashboardScreen loadProfile={() => Promise.resolve(profile)} />)

    await waitFor(() => {
      expect(screen.getByText('No linked teen accounts yet.')).toBeInTheDocument()
    })
    expect(
      screen.getByRole('heading', { name: 'guardian9@example.com' })
    ).toBeInTheDocument()
  })

  it('shows a standalone error screen when the profile itself cannot load', async () => {
    // With no profile there is no list to annotate, so the error replaces the
    // whole screen rather than sitting above a permanent loading message.
    render(
      <GuardianDashboardScreen
        loadProfile={() => Promise.reject(new Error('Profile service unavailable'))}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('guardian-dashboard-error').textContent).toBe(
        'Profile service unavailable'
      )
    })
    expect(screen.queryByText('Loading linked teens...')).not.toBeInTheDocument()
  })

  it('falls back to a generic message when the profile rejection is not an Error', async () => {
    render(<GuardianDashboardScreen loadProfile={vi.fn().mockRejectedValue('offline')} />)

    await waitFor(() => {
      expect(screen.getByTestId('guardian-dashboard-error').textContent).toBe(
        'Unable to load dashboard'
      )
    })
  })
})

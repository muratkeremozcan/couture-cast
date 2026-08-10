import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UserProfileResponse } from '@couture/api-client/contracts/http'
import { TeenDashboardScreen } from './teen-dashboard-screen'

function profileFixture(overrides: Partial<UserProfileResponse> = {}) {
  return {
    user: {
      id: 'teen-4',
      email: 'teen4@example.com',
      displayName: 'Taylor Brooks',
      birthdate: '2011-04-15T00:00:00.000Z',
      role: 'teen',
    },
    linkedGuardians: [],
    linkedTeens: [],
    ...overrides,
  } satisfies UserProfileResponse
}

describe('TeenDashboardScreen', () => {
  it('shows guardian consent status and linked guardians for a teen account', async () => {
    const profile: UserProfileResponse = {
      user: {
        id: 'teen-4',
        email: 'teen4@example.com',
        displayName: 'Taylor Brooks',
        birthdate: '2011-04-15T00:00:00.000Z',
        role: 'teen',
      },
      linkedGuardians: [
        {
          guardianId: 'guardian-7',
          status: 'granted',
          consentGrantedAt: '2026-04-17T06:00:00.000Z',
        },
      ],
      linkedTeens: [],
    }

    render(<TeenDashboardScreen loadProfile={() => Promise.resolve(profile)} />)

    await waitFor(() => {
      expect(screen.getByTestId('teen-consent-status').textContent).toBe(
        'Guardian consent granted'
      )
    })
    expect(screen.getByText('guardian-7')).toBeTruthy()
    expect(screen.getByText('granted')).toBeTruthy()
  })

  it('reports revoked consent and an unconfirmed grant date', async () => {
    // A revoked guardian still appears in the list, so the teen can see that
    // access was withdrawn rather than never granted; `consentGrantedAt` is
    // null for a guardian that never accepted.
    const profile = profileFixture({
      linkedGuardians: [
        { guardianId: 'guardian-9', status: 'revoked', consentGrantedAt: null },
      ],
    })

    render(<TeenDashboardScreen loadProfile={() => Promise.resolve(profile)} />)

    await waitFor(() => {
      expect(screen.getByTestId('teen-consent-status').textContent).toBe(
        'Guardian consent revoked'
      )
    })
    expect(screen.getByText('Awaiting consent')).toBeInTheDocument()
  })

  it('falls back to the email and an empty-guardian message when nothing is linked yet', async () => {
    // A freshly created teen account has no display name and no guardians; the
    // header must still identify the account and the section must say why it
    // is empty instead of rendering nothing.
    const profile = profileFixture({
      user: {
        id: 'teen-5',
        email: 'teen5@example.com',
        displayName: null,
        birthdate: '2011-04-15T00:00:00.000Z',
        role: 'teen',
      },
    })

    render(<TeenDashboardScreen loadProfile={() => Promise.resolve(profile)} />)

    await waitFor(() => {
      expect(screen.getByTestId('teen-consent-status').textContent).toBe(
        'Guardian consent pending'
      )
    })
    expect(screen.getByRole('heading', { name: 'teen5@example.com' })).toBeInTheDocument()
    expect(screen.getByText('No guardian has accepted consent yet.')).toBeInTheDocument()
  })

  it('surfaces the load failure instead of spinning on the loading copy', async () => {
    render(
      <TeenDashboardScreen
        loadProfile={() => Promise.reject(new Error('Profile service unavailable'))}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('teen-dashboard-error').textContent).toBe(
        'Profile service unavailable'
      )
    })
    expect(
      screen.queryByText('Loading guardian consent status...')
    ).not.toBeInTheDocument()
  })

  it('falls back to a generic message when the rejection is not an Error', async () => {
    // Rejections that cross the network boundary are not guaranteed to be
    // `Error` instances; a raw value must not render as "undefined".
    render(<TeenDashboardScreen loadProfile={vi.fn().mockRejectedValue('offline')} />)

    await waitFor(() => {
      expect(screen.getByTestId('teen-dashboard-error').textContent).toBe(
        'Unable to load dashboard'
      )
    })
  })

  it('does not set state after the screen unmounts mid-load', async () => {
    // The load resolves after the screen is gone; without the isMounted guard
    // React logs an update-on-unmounted-component error.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let resolveProfile: (value: UserProfileResponse) => void = () => undefined
    const loadProfile = () =>
      new Promise<UserProfileResponse>((resolve) => {
        resolveProfile = resolve
      })

    const { unmount } = render(<TeenDashboardScreen loadProfile={loadProfile} />)
    unmount()
    resolveProfile(profileFixture())
    await Promise.resolve()

    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

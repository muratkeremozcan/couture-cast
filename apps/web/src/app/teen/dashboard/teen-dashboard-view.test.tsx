import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { UserProfileResponse } from '@couture/api-client/contracts/http'
import { TeenDashboardView } from './teen-dashboard-view'

describe('TeenDashboardView', () => {
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

    render(<TeenDashboardView loadProfile={() => Promise.resolve(profile)} />)

    await waitFor(() => {
      expect(screen.getByTestId('teen-consent-status')).toHaveTextContent(
        'Guardian consent granted'
      )
    })
    expect(screen.getByText('guardian-7')).toBeInTheDocument()
    expect(screen.getByText('granted')).toBeInTheDocument()
  })

  it('shows pending guardian consent status', async () => {
    const profile: UserProfileResponse = {
      user: {
        id: 'teen-5',
        email: 'teen5@example.com',
        displayName: 'Riley Stone',
        birthdate: '2012-07-10T00:00:00.000Z',
        role: 'teen',
      },
      linkedGuardians: [
        {
          guardianId: 'guardian-8',
          status: 'pending',
          consentGrantedAt: null,
        },
      ],
      linkedTeens: [],
    }

    render(<TeenDashboardView loadProfile={() => Promise.resolve(profile)} />)

    await waitFor(() => {
      expect(screen.getByTestId('teen-consent-status')).toHaveTextContent(
        'Guardian consent pending'
      )
    })
    expect(screen.getByText('guardian-8')).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.getByText('Awaiting consent')).toBeInTheDocument()
  })

  it('shows revoked guardian consent status', async () => {
    const profile: UserProfileResponse = {
      user: {
        id: 'teen-6',
        email: 'teen6@example.com',
        displayName: 'Casey Nguyen',
        birthdate: '2011-11-19T00:00:00.000Z',
        role: 'teen',
      },
      linkedGuardians: [
        {
          guardianId: 'guardian-9',
          status: 'revoked',
          consentGrantedAt: '2026-04-17T06:00:00.000Z',
        },
      ],
      linkedTeens: [],
    }

    render(<TeenDashboardView loadProfile={() => Promise.resolve(profile)} />)

    await waitFor(() => {
      expect(screen.getByTestId('teen-consent-status')).toHaveTextContent(
        'Guardian consent revoked'
      )
    })
    expect(screen.getByText('guardian-9')).toBeInTheDocument()
    expect(screen.getByText('revoked')).toBeInTheDocument()
  })

  it('shows the no linked guardians state', async () => {
    const profile: UserProfileResponse = {
      user: {
        id: 'teen-7',
        email: 'teen7@example.com',
        displayName: 'Jamie Rivera',
        birthdate: '2013-02-22T00:00:00.000Z',
        role: 'teen',
      },
      linkedGuardians: [],
      linkedTeens: [],
    }

    render(<TeenDashboardView loadProfile={() => Promise.resolve(profile)} />)

    await waitFor(() => {
      expect(screen.getByTestId('teen-consent-status')).toHaveTextContent(
        'Guardian consent pending'
      )
    })
    expect(screen.getByText('No guardian has accepted consent yet.')).toBeInTheDocument()
  })

  it('shows a profile loading error', async () => {
    const loadProfile = () => Promise.reject(new Error('Unable to load teen profile'))

    render(<TeenDashboardView loadProfile={loadProfile} />)

    await waitFor(() => {
      expect(screen.getByTestId('teen-dashboard-error')).toHaveTextContent(
        'Unable to load teen profile'
      )
    })
  })
})

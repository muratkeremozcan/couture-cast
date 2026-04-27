import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { UserProfileResponse } from '@couture/api-client/contracts/http'
import { TeenDashboardScreen } from './teen-dashboard-screen'

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
})

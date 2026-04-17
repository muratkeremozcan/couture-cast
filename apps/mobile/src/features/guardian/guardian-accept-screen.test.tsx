import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuardianAcceptScreen } from './guardian-accept-screen'

describe('GuardianAcceptScreen', () => {
  it('accepts invitations when a token is present', async () => {
    const acceptInvitation = vi.fn().mockResolvedValue({
      teenId: 'teen-1',
      teenEmail: 'teen1@example.com',
      guardianId: 'guardian-1',
      guardianEmail: 'guardian1@example.com',
      consentLevel: 'read_only',
      grantedAt: '2026-04-17T06:00:00.000Z',
    })

    render(
      <GuardianAcceptScreen token="signed-token" acceptInvitation={acceptInvitation} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith({ token: 'signed-token' })
    })
    expect(screen.getByTestId('guardian-accept-success').textContent).toContain(
      'Consent recorded for teen1@example.com.'
    )
  })

  it('shows an error when the token is missing', async () => {
    render(<GuardianAcceptScreen token={null} acceptInvitation={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(() => {
      expect(screen.getByTestId('guardian-accept-error').textContent).toBe(
        'Invitation token is missing from this link.'
      )
    })
  })
})

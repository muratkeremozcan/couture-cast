import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n, { initI18n } from '@/src/lib/i18n'
import deDE from '@/assets/locales/de-DE.json'
import { GuardianAcceptScreen } from './guardian-accept-screen'

describe('GuardianAcceptScreen', () => {
  // Story CC-7.9 D9: the screen's copy comes from the locale catalog.
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  afterEach(async () => {
    await i18n.changeLanguage('en-US')
  })

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

  it('CC-7.9 D9: renders its copy and the missing-token error from the de-DE catalog', async () => {
    await i18n.changeLanguage('de-DE')
    const acceptInvitation = vi.fn()

    render(<GuardianAcceptScreen token={null} acceptInvitation={acceptInvitation} />)

    expect(
      screen.getByRole('heading', { name: deDE.guardian.accept.heading })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: deDE.guardian.accept.accept }))

    await waitFor(() => {
      expect(screen.getByTestId('guardian-accept-error').textContent).toBe(
        deDE.guardian.accept.tokenMissing
      )
    })
    expect(acceptInvitation).not.toHaveBeenCalled()
  })

  it('shows an error when the token is missing', async () => {
    const acceptInvitation = vi.fn()

    render(<GuardianAcceptScreen token={null} acceptInvitation={acceptInvitation} />)

    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))

    await waitFor(() => {
      expect(screen.getByTestId('guardian-accept-error').textContent).toBe(
        'Invitation token is missing from this link.'
      )
    })
    expect(acceptInvitation).not.toHaveBeenCalled()
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignupScreen } from './signup-screen'

describe('SignupScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the under-13 message before submitting', () => {
    render(<SignupScreen submitSignup={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2016-04-16' },
    })

    expect(screen.getByTestId('signup-inline-message').textContent).toBe(
      'You must be 13 or older'
    )
  })

  it('shows the guardian consent message for ages thirteen through fifteen', () => {
    render(<SignupScreen submitSignup={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2011-04-15' },
    })

    expect(screen.getByTestId('signup-inline-message').textContent).toBe(
      'Guardian consent required'
    )
  })

  it('submits eligible signups and shows the success state', async () => {
    const submitSignup = vi.fn().mockResolvedValue({
      userId: 'user-123',
      age: 16,
      accountStatus: 'active',
      guardianConsentRequired: false,
    })

    render(<SignupScreen submitSignup={submitSignup} />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'eligible@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2010-04-15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(submitSignup).toHaveBeenCalledWith({
        email: 'eligible@example.com',
        birthdate: '2010-04-15',
      })
    })
    expect(screen.getByTestId('signup-success-message').textContent).toBe(
      'Account created. You can continue to onboarding.'
    )
  })

  it('shows the guardian invitation step after teen signup and sends the invite', async () => {
    const submitSignup = vi.fn().mockResolvedValue({
      userId: 'teen-guardian-step',
      age: 15,
      accountStatus: 'pending_guardian_consent',
      guardianConsentRequired: true,
    })
    const inviteGuardian = vi.fn().mockResolvedValue({
      invitationId: 'invitation-1',
      teenId: 'teen-guardian-step',
      guardianEmail: 'guardian@example.com',
      consentLevel: 'full_access',
      expiresAt: '2026-04-24T00:00:00.000Z',
      invitationLink: 'https://app.couturecast.test/guardian/accept?token=abc',
      deliveryQueued: true,
    })

    render(<SignupScreen submitSignup={submitSignup} inviteGuardian={inviteGuardian} />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'teen@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2011-04-15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.queryByText('Guardian invitation')).toBeNull()

    await waitFor(() => {
      expect(submitSignup).toHaveBeenCalledWith({
        email: 'teen@example.com',
        birthdate: '2011-04-15',
      })
      expect(screen.getByText('Guardian invitation')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('Guardian email'), {
      target: { value: 'guardian@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Full access consent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send guardian invite' }))

    await waitFor(() => {
      expect(inviteGuardian).toHaveBeenCalledWith({
        teenId: 'teen-guardian-step',
        guardianEmail: 'guardian@example.com',
        consentLevel: 'full_access',
      })
    })
    expect(screen.getByTestId('guardian-invite-link').textContent).toBe(
      'https://app.couturecast.test/guardian/accept?token=abc'
    )
  })
})

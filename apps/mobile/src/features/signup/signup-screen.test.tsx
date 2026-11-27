import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n, { initI18n } from '@/src/lib/i18n'
import { SignupScreen } from './signup-screen'

describe('SignupScreen', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Story 6.17 D5 (Antigravity P1-1): a cold OAuth callback returns a signup-door round trip
  // here with a fixed outcome name, shown as the in-process path shows it.
  it('shows the fixed Google outcome a cold callback hands back', () => {
    render(<SignupScreen submitSignup={vi.fn()} googleOutcome="cancelled" />)
    expect(screen.getByText('Google sign-in was cancelled.')).toBeTruthy()
    // The Maestro door step asserts this root id positively.
    expect(screen.getByTestId('signup-screen')).toBeTruthy()
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

  // Guardian consent is off (owner ruling 2026-11-16): a teen birthdate shows no guardian message.
  it('shows no guardian consent message for ages thirteen through fifteen', () => {
    render(<SignupScreen submitSignup={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2011-04-15' },
    })

    expect(screen.queryByTestId('signup-inline-message')).toBeNull()
    expect(screen.queryByText(/guardian/i)).toBeNull()
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
      'Account created. Sign in with your email to continue.'
    )
    // TEA sign-off N-3: the next step is a button to sign-in, and Create account is gone.
    expect(screen.getByTestId('signup-sign-in-to-continue').textContent).toBe('Sign in')
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull()
  })

  it('N-3 leaves for sign-in from the created state', async () => {
    const onPreviewNavigate = vi.fn()
    render(
      <SignupScreen
        submitSignup={vi.fn().mockResolvedValue({
          userId: 'user-9',
          age: 14,
          accountStatus: 'active',
          guardianConsentRequired: false,
        })}
        onPreviewNavigate={onPreviewNavigate}
      />
    )
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'teen@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2012-04-15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    fireEvent.click(await screen.findByTestId('signup-sign-in-to-continue'))
    expect(onPreviewNavigate).toHaveBeenCalledExactlyOnceWith('/signin')
  })

  // TEA sign-off N-1 (parity with web): the screen follows the app language.
  it('renders in the active language (fr-FR)', async () => {
    await i18n.changeLanguage('fr-FR')
    try {
      render(<SignupScreen submitSignup={vi.fn()} />)
      expect(screen.getByText('Vérification de l’âge')).toBeTruthy()
      expect(screen.getByLabelText('Adresse e-mail')).toBeTruthy()
      expect(screen.getByLabelText('Date de naissance')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Créer le compte' })).toBeTruthy()
    } finally {
      await i18n.changeLanguage('en-US')
    }
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

    expect(screen.queryByText('Invite a guardian')).toBeNull()

    await waitFor(() => {
      expect(submitSignup).toHaveBeenCalledWith({
        email: 'teen@example.com',
        birthdate: '2011-04-15',
      })
      expect(screen.getByText('Invite a guardian')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('Guardian email'), {
      target: { value: 'guardian@example.com' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Full access consent' }))
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

  it('refuses to submit an unparseable birthdate', async () => {
    const submitSignup = vi.fn()
    render(<SignupScreen submitSignup={submitSignup} />)

    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '16-04-2010' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(screen.getByTestId('signup-error-message').textContent).toBe(
        'Enter your birthdate as YYYY-MM-DD'
      )
    })
    // The age gate is a compliance control: a malformed date must never reach
    // the signup endpoint where it could be interpreted differently.
    expect(submitSignup).not.toHaveBeenCalled()
  })

  it('blocks an under-13 signup at submit time, not just inline', async () => {
    const submitSignup = vi.fn()
    render(<SignupScreen submitSignup={submitSignup} />)

    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2016-04-16' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(screen.getByTestId('signup-error-message').textContent).toBe(
        'You must be 13 or older'
      )
    })
    expect(submitSignup).not.toHaveBeenCalled()
  })

  it('surfaces the signup rejection reason and re-enables the button', async () => {
    const submitSignup = vi
      .fn()
      .mockRejectedValue(new Error('That email is already registered'))
    render(<SignupScreen submitSignup={submitSignup} />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'taken@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2010-04-15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(screen.getByTestId('signup-error-message').textContent).toBe(
        'That email is already registered'
      )
    })
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
  })

  it.each([
    ['is not an Error', 'offline'],
    // A network failure is a TypeError whose message is the platform's, never shown.
    ['is a network failure', new TypeError('Network request failed')],
  ])(
    'falls back to a generic message when the signup rejection %s',
    async (_label, reason) => {
      render(<SignupScreen submitSignup={vi.fn().mockRejectedValue(reason)} />)

      fireEvent.change(screen.getByLabelText('Birthdate'), {
        target: { value: '2010-04-15' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

      await waitFor(() => {
        expect(screen.getByTestId('signup-error-message').textContent).toBe(
          'Your account could not be created right now. Try again in a moment.'
        )
      })
    }
  )

  it('rejects a malformed guardian email before spending an invitation', async () => {
    const submitSignup = vi.fn().mockResolvedValue({
      userId: 'teen-invite-validation',
      age: 14,
      accountStatus: 'pending_guardian_consent',
      guardianConsentRequired: true,
    })
    const inviteGuardian = vi.fn()
    render(<SignupScreen submitSignup={submitSignup} inviteGuardian={inviteGuardian} />)

    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2011-04-15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => screen.getByLabelText('Guardian email'))

    fireEvent.change(screen.getByLabelText('Guardian email'), {
      target: { value: 'guardian-at-example' },
    })
    // Selecting read-only consent is the default, but re-selecting it must not
    // change what gets validated.
    fireEvent.click(screen.getByRole('radio', { name: 'Read only consent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send guardian invite' }))

    await waitFor(() => {
      expect(screen.getByTestId('signup-error-message').textContent).toBe(
        'Enter a valid guardian email address.'
      )
    })
    // An invitation email to a bad address is unrecoverable for the teen, so
    // the address is validated client-side before the call is made.
    expect(inviteGuardian).not.toHaveBeenCalled()
    expect(screen.queryByTestId('guardian-invite-link')).not.toBeInTheDocument()
  })

  it('reports a failed guardian invitation and shows no invitation link', async () => {
    const submitSignup = vi.fn().mockResolvedValue({
      userId: 'teen-invite-failure',
      age: 14,
      accountStatus: 'pending_guardian_consent',
      guardianConsentRequired: true,
    })
    const inviteGuardian = vi
      .fn()
      .mockRejectedValue(new Error('Guardian mailbox rejected the invitation'))
    render(<SignupScreen submitSignup={submitSignup} inviteGuardian={inviteGuardian} />)

    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2011-04-15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => screen.getByLabelText('Guardian email'))

    fireEvent.change(screen.getByLabelText('Guardian email'), {
      target: { value: 'guardian@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send guardian invite' }))

    await waitFor(() => {
      expect(screen.getByTestId('signup-error-message').textContent).toBe(
        'Guardian mailbox rejected the invitation'
      )
    })
    expect(screen.queryByTestId('guardian-invite-link')).not.toBeInTheDocument()
  })

  it('falls back to a generic message when the invitation rejection is not an Error', async () => {
    const submitSignup = vi.fn().mockResolvedValue({
      userId: 'teen-invite-non-error',
      age: 14,
      accountStatus: 'pending_guardian_consent',
      guardianConsentRequired: true,
    })
    render(
      <SignupScreen
        submitSignup={submitSignup}
        inviteGuardian={vi.fn().mockRejectedValue('offline')}
      />
    )

    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2011-04-15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => screen.getByLabelText('Guardian email'))

    fireEvent.change(screen.getByLabelText('Guardian email'), {
      target: { value: 'guardian@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send guardian invite' }))

    await waitFor(() => {
      expect(screen.getByTestId('signup-error-message').textContent).toBe(
        'The guardian invitation could not be sent. Try again.'
      )
    })
  })
})

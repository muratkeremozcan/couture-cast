import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getI18n } from '../../i18n'
import { SignupForm } from './signup-form'

describe('SignupForm', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the under-13 message before submitting', () => {
    render(<SignupForm submitSignup={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2016-04-16' },
    })

    expect(screen.getByTestId('signup-inline-message')).toHaveTextContent(
      'You must be 13 or older'
    )
  })

  // Guardian consent is off (owner ruling 2026-11-16): a teen birthdate shows no guardian message.
  it('shows no guardian consent message for ages thirteen through fifteen', () => {
    render(<SignupForm submitSignup={vi.fn()} />)

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

    render(<SignupForm submitSignup={submitSignup} />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'eligible@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2010-04-15' },
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }))

    // Both assertions live inside one waitFor, the same way the guardian test
    // below does it. Splitting them raced: `submitSignup` is recorded as called
    // the moment the submit handler invokes it, which is before the awaited
    // response resolves and React commits the success state, so a bare
    // `getByTestId` after the wait only passed when the microtask happened to
    // flush first. It lost that race under `--coverage` in a full parallel run
    // (instrumentation shifts the timing) and rendered the still-pending
    // "Creating account…" button. The expectation is unchanged; only what the
    // test waits for is.
    await waitFor(() => {
      expect(submitSignup).toHaveBeenCalledWith({
        email: 'eligible@example.com',
        birthdate: '2010-04-15',
      })
      expect(screen.getByTestId('signup-success-message')).toHaveTextContent(
        'Account created. Sign in with your email to continue.'
      )
    })
    // TEA sign-off N-3: the page names the next step and links to it; the form is done, so
    // Create account is gone instead of inviting a second signup with the same address.
    const next = screen.getByTestId('signup-sign-in-to-continue')
    expect(next.textContent).toBe('Sign in to continue')
    expect(next.getAttribute('href')).toBe('/signin')
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull()
  })

  // TEA sign-off N-1: the page follows the browser language like the finish step does.
  it('renders the form in the active language (fr-FR)', async () => {
    await getI18n().changeLanguage('fr-FR')
    try {
      const submitSignup = vi.fn().mockResolvedValue({
        userId: 'user-fr',
        age: 30,
        accountStatus: 'active',
        guardianConsentRequired: false,
      })
      render(<SignupForm submitSignup={submitSignup} />)
      expect(screen.getByTestId('google-sign-in')).toHaveTextContent(
        'Continuer avec Google'
      )
      expect(screen.getByRole('separator')).toHaveAttribute('aria-label', 'ou')
      fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
        target: { value: 'adulte@example.com' },
      })
      fireEvent.change(screen.getByLabelText('Date de naissance'), {
        target: { value: '1996-04-15' },
      })
      fireEvent.submit(screen.getByRole('button', { name: 'Créer le compte' }))
      expect(await screen.findByTestId('signup-success-message')).toHaveTextContent(
        'Compte créé. Connectez-vous avec votre adresse e-mail pour continuer.'
      )
      expect(screen.getByTestId('signup-sign-in-to-continue').textContent).toBe(
        'Se connecter pour continuer'
      )
    } finally {
      await getI18n().changeLanguage('en-US')
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

    render(<SignupForm submitSignup={submitSignup} inviteGuardian={inviteGuardian} />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'teen@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2011-04-15' },
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.queryByText('Guardian invitation')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(submitSignup).toHaveBeenCalledWith({
        email: 'teen@example.com',
        birthdate: '2011-04-15',
      })
      expect(screen.getByText('Guardian invitation')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Guardian email'), {
      target: { value: 'guardian@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Consent level'), {
      target: { value: 'full_access' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send guardian invite' }))

    await waitFor(() => {
      expect(inviteGuardian).toHaveBeenCalledWith({
        teenId: 'teen-guardian-step',
        guardianEmail: 'guardian@example.com',
        consentLevel: 'full_access',
      })
    })

    // The request resolving does not mean React has committed the result, so
    // this must await the element. A synchronous getByTestId here failed
    // intermittently under a loaded full-monorepo run.
    expect(await screen.findByTestId('guardian-invite-link')).toHaveTextContent(
      'https://app.couturecast.test/guardian/accept?token=abc'
    )
  })
})

describe('SignupForm validation and failure paths', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects a submit with no usable birthdate', async () => {
    const submitSignup = vi.fn()
    render(<SignupForm submitSignup={submitSignup} />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'someone@example.com' },
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error-message')).toBeInTheDocument()
    )
    // Age gating is a legal requirement, so an unparseable birthdate must never
    // reach the signup endpoint.
    expect(submitSignup).not.toHaveBeenCalled()
  })

  it('blocks an under-13 signup at submit, not only inline', async () => {
    const submitSignup = vi.fn()
    render(<SignupForm submitSignup={submitSignup} />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'kid@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2016-04-16' },
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error-message')).toHaveTextContent(
        'You must be 13 or older'
      )
    )
    expect(submitSignup).not.toHaveBeenCalled()
  })

  it.each([
    ['an Error', new Error('Email already registered'), 'Email already registered'],
    // The fallback is the localized create-unavailable copy (TEA sign-off N-1).
    [
      'a non-Error',
      'socket hang up',
      'Your account could not be created right now. Try again in a moment.',
    ],
    // A network failure is a TypeError whose message is the browser's, never shown.
    [
      'a network failure',
      new TypeError('Failed to fetch'),
      'Your account could not be created right now. Try again in a moment.',
    ],
  ])('surfaces a signup rejection that is %s', async (_label, reason, expected) => {
    const submitSignup = vi.fn().mockRejectedValue(reason)
    render(<SignupForm submitSignup={submitSignup} />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'adult@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2000-04-15' },
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error-message')).toHaveTextContent(expected)
    )
    // The button must come back so the user can correct and retry.
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
  })
})

type InviteGuardianFn = NonNullable<Parameters<typeof SignupForm>[0]['inviteGuardian']>

describe('SignupForm guardian invitation failures', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function renderTeenSignupWithGuardianStep(inviteGuardian: InviteGuardianFn) {
    const submitSignup = vi.fn().mockResolvedValue({
      userId: 'teen-1',
      age: 14,
      accountStatus: 'pending_guardian_consent',
      guardianConsentRequired: true,
    })
    render(<SignupForm submitSignup={submitSignup} inviteGuardian={inviteGuardian} />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'teen@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2011-04-15' },
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }))
    await screen.findByText('Guardian invitation')
  }

  it('rejects a malformed guardian email before sending anything', async () => {
    const inviteGuardian = vi.fn<InviteGuardianFn>()
    await renderTeenSignupWithGuardianStep(inviteGuardian)

    fireEvent.change(screen.getByLabelText('Guardian email'), {
      target: { value: 'not-an-email' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send guardian invite' }))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error-message')).toHaveTextContent(
        'Enter a valid guardian email address.'
      )
    )
    // An invitation link is a credential; it must not be minted for a typo.
    expect(inviteGuardian).not.toHaveBeenCalled()
    expect(screen.queryByTestId('guardian-invite-link')).not.toBeInTheDocument()
  })

  it.each([
    ['an Error', new Error('Guardian already invited'), 'Guardian already invited'],
    [
      'a non-Error',
      'socket hang up',
      'The guardian invitation could not be sent. Try again.',
    ],
  ])(
    'surfaces a guardian invitation rejection that is %s',
    async (_l, reason, expected) => {
      const inviteGuardian = vi.fn<InviteGuardianFn>().mockRejectedValue(reason)
      await renderTeenSignupWithGuardianStep(inviteGuardian)

      fireEvent.change(screen.getByLabelText('Guardian email'), {
        target: { value: 'guardian@example.com' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Send guardian invite' }))

      await waitFor(() =>
        expect(screen.getByTestId('signup-error-message')).toHaveTextContent(expected)
      )
      expect(screen.queryByTestId('guardian-invite-link')).not.toBeInTheDocument()
    }
  )
})

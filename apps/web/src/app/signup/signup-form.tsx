'use client'

import { useState, type FormEvent } from 'react'
import type {
  GuardianInvitationInput,
  GuardianInvitationResponse,
  SignupInput,
  SignupResponse,
} from '@couture/api-client/contracts/http'
import { guardianInvitationInputSchema } from '@couture/api-client/contracts/http'
import {
  AGE_GATE_MESSAGES,
  evaluateBirthdateInput,
  INVALID_BIRTHDATE_MESSAGE,
} from '@couture/utils'
import { inviteGuardianFromWeb } from '../../lib/guardian'
import { submitWebSignup } from '../../lib/signup'

type SignupFormProps = {
  submitSignup?: (input: SignupInput) => Promise<SignupResponse>
  inviteGuardian?: (input: GuardianInvitationInput) => Promise<GuardianInvitationResponse>
}

export function SignupForm({
  submitSignup = submitWebSignup,
  inviteGuardian = inviteGuardianFromWeb,
}: SignupFormProps) {
  const [email, setEmail] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [guardianEmail, setGuardianEmail] = useState('')
  const [consentLevel, setConsentLevel] =
    useState<GuardianInvitationInput['consentLevel']>('read_only')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [pendingTeenId, setPendingTeenId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isInviting, setIsInviting] = useState(false)

  const birthdateEvaluation = evaluateBirthdateInput(birthdate)
  const inlineMessage = birthdateEvaluation.message

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)
    setInviteLink(null)

    if (birthdateEvaluation.kind !== 'valid') {
      setErrorMessage(INVALID_BIRTHDATE_MESSAGE)
      return
    }

    const { gate } = birthdateEvaluation

    if (!gate.allowed) {
      setErrorMessage(AGE_GATE_MESSAGES.underage)
      return
    }

    setIsSubmitting(true)

    try {
      const response = await submitSignup({ email, birthdate })
      if (response.guardianConsentRequired) {
        setPendingTeenId(response.userId)
        setSuccessMessage(
          'Account created. Guardian consent is required before wardrobe access is enabled.'
        )
        return
      }

      setPendingTeenId(null)
      setSuccessMessage('Account created. You can continue to onboarding.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Signup failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleGuardianInvite() {
    if (!pendingTeenId) {
      setErrorMessage('Create the teen account first before inviting a guardian.')
      return
    }

    const guardianEmailValidation =
      guardianInvitationInputSchema.shape.guardianEmail.safeParse(guardianEmail)
    if (!guardianEmailValidation.success) {
      setErrorMessage('Enter a valid guardian email address.')
      setSuccessMessage(null)
      setInviteLink(null)
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setInviteLink(null)
    setIsInviting(true)

    try {
      const response = await inviteGuardian({
        teenId: pendingTeenId,
        guardianEmail,
        consentLevel,
      })
      setInviteLink(response.invitationLink)
      setSuccessMessage(
        `Guardian invitation sent to ${response.guardianEmail}. Share the link below if they do not see the email.`
      )
    } catch (error) {
      setInviteLink(null)
      setErrorMessage(
        error instanceof Error ? error.message : 'Guardian invitation failed'
      )
    } finally {
      setIsInviting(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    void handleSubmit(event)
  }

  return (
    <form
      className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8"
      onSubmit={onSubmit}
    >
      <div className="space-y-2">
        <label htmlFor="signup-email" className="text-sm font-medium text-neutral-100">
          Email
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-amber-300"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="signup-birthdate"
          className="text-sm font-medium text-neutral-100"
        >
          Birthdate
        </label>
        <input
          id="signup-birthdate"
          name="birthdate"
          type="date"
          required
          value={birthdate}
          onChange={(event) => setBirthdate(event.target.value)}
          className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-amber-300"
        />
        {inlineMessage ? (
          <p
            data-testid="signup-inline-message"
            className="text-sm text-amber-200"
            aria-live="polite"
          >
            {inlineMessage}
          </p>
        ) : null}
      </div>

      {errorMessage ? (
        <p
          data-testid="signup-error-message"
          className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          aria-live="assertive"
        >
          {errorMessage}
        </p>
      ) : null}

      {successMessage ? (
        <p
          data-testid="signup-success-message"
          className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          aria-live="polite"
        >
          {successMessage}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? 'Creating account…' : 'Create account'}
      </button>

      {pendingTeenId ? (
        <div className="space-y-4 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-5">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-200">
              Guardian invitation
            </h2>
            <p className="text-sm text-neutral-200">
              Invite a guardian to approve access for this teen account.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="guardian-email"
                className="text-sm font-medium text-neutral-100"
              >
                Guardian email
              </label>
              <input
                id="guardian-email"
                name="guardianEmail"
                type="email"
                required
                autoComplete="email"
                value={guardianEmail}
                onChange={(event) => setGuardianEmail(event.target.value)}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-amber-300"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="guardian-consent-level"
                className="text-sm font-medium text-neutral-100"
              >
                Consent level
              </label>
              <select
                id="guardian-consent-level"
                name="consentLevel"
                value={consentLevel}
                onChange={(event) =>
                  setConsentLevel(
                    event.target.value as GuardianInvitationInput['consentLevel']
                  )
                }
                className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-amber-300"
              >
                <option value="read_only">Read only</option>
                <option value="full_access">Full access</option>
              </select>
            </div>

            <button
              type="button"
              disabled={isInviting}
              onClick={() => {
                void handleGuardianInvite()
              }}
              className="w-full rounded-full border border-amber-300/60 px-5 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isInviting ? 'Sending invite…' : 'Send guardian invite'}
            </button>
          </div>

          {inviteLink ? (
            <p
              data-testid="guardian-invite-link"
              className="break-all rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-neutral-200"
            >
              {inviteLink}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}

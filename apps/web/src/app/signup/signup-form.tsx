'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type GuardianInvitationInput,
  type GuardianInvitationResponse,
  type SignupInput,
  type SignupResponse,
  guardianInvitationInputSchema,
} from '@couture/api-client/contracts/http'
import {
  evaluateBirthdateInput,
  getFederatedSignInStrings,
  getGuestPreviewStrings,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { webGuestPreviewStore } from '../../lib/guest-preview'
import { inviteGuardianFromWeb } from '../../lib/guardian'
import { GoogleSignInButton, SignInDivider } from '../components/google-sign-in-button'
import { SignupRefusedError, submitWebSignup } from '../../lib/signup'

type SignupFormProps = {
  submitSignup?: (input: SignupInput) => Promise<SignupResponse>
  inviteGuardian?: (input: GuardianInvitationInput) => Promise<GuardianInvitationResponse>
  /** Story 6.16 D8: the visitor came from the guest preview (`?from=preview`). */
  fromPreview?: boolean
  /** Story 6.17 D5: a Google round trip from this page that signed nobody in. */
  googleOutcome?: 'cancelled' | 'unavailable' | 'refused' | null
}

export function SignupForm({
  submitSignup = submitWebSignup,
  inviteGuardian = inviteGuardianFromWeb,
  fromPreview = false,
  googleOutcome = null,
}: SignupFormProps) {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const previewStrings = getGuestPreviewStrings(i18n.language).conversionDetail
  const strings = getFederatedSignInStrings(i18n.language)
  const googleMessage = googleOutcome ? strings[googleOutcome] : null
  const [accountCreated, setAccountCreated] = useState(false)
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
  const inlineMessage =
    birthdateEvaluation.gate?.accountStatus === 'blocked_underage'
      ? strings.underage
      : birthdateEvaluation.message

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)
    setInviteLink(null)

    if (birthdateEvaluation.kind !== 'valid') {
      setErrorMessage(strings.invalidBirthdate)
      return
    }

    const { gate } = birthdateEvaluation

    if (!gate.allowed) {
      setErrorMessage(strings.underage)
      // Story 6.16 D2: an age refusal outranks the preview's self-reported gate.
      if (fromPreview) webGuestPreviewStore().clear()
      return
    }

    setIsSubmitting(true)

    try {
      const response = await submitSignup({ email, birthdate })
      if (response.guardianConsentRequired) {
        setAccountCreated(true)
        setPendingTeenId(response.userId)
        setSuccessMessage(strings.createdGuardianPending)
        return
      }

      setPendingTeenId(null)
      setSuccessMessage(strings.signupCreated)
      setAccountCreated(true)
    } catch (error) {
      setErrorMessage(failureText(error, strings.createUnavailable))
      // D2: the server's refusal outranks the preview gate, as the client's does.
      if (fromPreview && error instanceof SignupRefusedError)
        webGuestPreviewStore().clear()
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleGuardianInvite() {
    if (!pendingTeenId) {
      setErrorMessage(strings.inviteFailed)
      return
    }

    const guardianEmailValidation =
      guardianInvitationInputSchema.shape.guardianEmail.safeParse(guardianEmail)
    if (!guardianEmailValidation.success) {
      setErrorMessage(strings.invalidGuardianEmail)
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
      setSuccessMessage(strings.inviteSent.replace('{email}', response.guardianEmail))
    } catch (error) {
      setInviteLink(null)
      setErrorMessage(failureText(error, strings.inviteFailed))
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
      {/* Story 6.17 D2: Google first; the email form below is unchanged. */}
      <GoogleSignInButton
        from={fromPreview ? 'preview' : null}
        door="signup"
        theme="dark"
        onUnavailable={setErrorMessage}
      />
      {googleMessage && !errorMessage ? (
        <p
          data-testid="google-sign-in-status"
          role="alert"
          className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {googleMessage}
        </p>
      ) : null}
      <SignInDivider tone="dark" />
      <div className="space-y-2">
        <label htmlFor="signup-email" className="text-sm font-medium text-neutral-100">
          {strings.email}
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
          {strings.birthdate}
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

      <SignupNextStep
        accountCreated={accountCreated}
        fromPreview={fromPreview}
        isSubmitting={isSubmitting}
        submitLabel={isSubmitting ? strings.creating : strings.create}
        signInLabel={previewStrings.signInToContinue}
      />

      {pendingTeenId ? (
        <div className="space-y-4 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-5">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-200">
              {strings.guardianTitle}
            </h2>
            <p className="text-sm text-neutral-200">{strings.guardianIntro}</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="guardian-email"
                className="text-sm font-medium text-neutral-100"
              >
                {strings.guardianEmail}
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
                {strings.consentLevel}
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
                <option value="read_only">{strings.readOnly}</option>
                <option value="full_access">{strings.fullAccess}</option>
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
              {isInviting ? strings.sendingInvite : strings.sendInvite}
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

      {fromPreview ? (
        <Link
          href="/preview"
          data-testid="signup-back-to-preview"
          className="inline-flex min-h-11 items-center text-sm text-neutral-200 underline underline-offset-4"
        >
          {previewStrings.backToPreview}
        </Link>
      ) : null}
    </form>
  )
}

/**
 * The server's own message for a refusal it explained; the localized fallback for anything
 * else, a network failure ("Failed to fetch") included.
 */
function failureText(error: unknown, fallback: string) {
  return error instanceof Error && !(error instanceof TypeError)
    ? error.message
    : fallback
}

/**
 * TEA sign-off N-3: Create account until the account exists, then the way to sign in, so a
 * finished form never invites a second signup with the same address.
 */
function SignupNextStep({
  accountCreated,
  fromPreview,
  isSubmitting,
  submitLabel,
  signInLabel,
}: {
  accountCreated: boolean
  fromPreview: boolean
  isSubmitting: boolean
  submitLabel: string
  signInLabel: string
}) {
  if (accountCreated)
    return (
      <Link
        href={fromPreview ? '/signin?from=preview' : '/signin'}
        data-testid="signup-sign-in-to-continue"
        className="inline-flex min-h-11 items-center rounded-full border border-amber-300 px-5 text-sm font-semibold text-amber-200"
      >
        {signInLabel}
      </Link>
    )
  return (
    <button
      type="submit"
      disabled={isSubmitting}
      className="w-full rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {submitLabel}
    </button>
  )
}

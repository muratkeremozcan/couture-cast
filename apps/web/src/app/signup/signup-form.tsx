'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
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
  getBirthdateNotice,
  getFederatedSignInStrings,
  getGuestPreviewStrings,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { webGuestPreviewStore } from '../../lib/guest-preview'
import { webGuestPreviewBirthdate } from '../../lib/guest-preview-birthdate'
import { inviteGuardianFromWeb } from '../../lib/guardian'
import { GoogleSignInButton, SignInDivider } from '../components/google-sign-in-button'
import { SignupRefusedError, submitWebSignup } from '../../lib/signup'

// Story CC-7.9 D2: fields sit on the page surface inside the form card; the global focus ring
// marks the focused field, so no per-field focus color.
const FIELD_CLASS =
  'w-full rounded-lg border border-line-strong bg-page px-4 py-3 text-ink transition'
const ERROR_CLASS =
  'rounded-lg border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger-ink'

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
  const { conversionDetail: previewStrings, firstRun } = getGuestPreviewStrings(
    i18n.language
  )
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

  useEffect(() => {
    if (!fromPreview) return
    const date = webGuestPreviewBirthdate.read()
    if (date) setBirthdate((draft) => draft || date)
  }, [fromPreview])

  const birthdateEvaluation = evaluateBirthdateInput(birthdate)
  const inlineMessage = getBirthdateNotice(birthdateEvaluation, strings)

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
      webGuestPreviewBirthdate.clear()
      setBirthdate('')
      // Story 6.16 D2: an age refusal outranks the preview's self-reported gate.
      if (fromPreview) webGuestPreviewStore().clear()
      return
    }

    setIsSubmitting(true)

    try {
      const response = await submitSignup({ email, birthdate })
      webGuestPreviewBirthdate.clear()
      setBirthdate('')
      if (response.guardianConsentRequired) {
        setAccountCreated(true)
        setPendingTeenId(response.userId)
        setSuccessMessage(
          fromPreview ? firstRun.guardianPending : strings.createdGuardianPending
        )
        return
      }

      setPendingTeenId(null)
      setSuccessMessage(strings.signupCreated)
      setAccountCreated(true)
    } catch (error) {
      setErrorMessage(failureText(error, strings.createUnavailable))
      // D2: the server's refusal outranks the preview gate, as the client's does.
      if (error instanceof SignupRefusedError) {
        webGuestPreviewBirthdate.clear()
        setBirthdate('')
        if (fromPreview) webGuestPreviewStore().clear()
      }
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
      data-surface="card"
      className="space-y-6 rounded-xl border border-line bg-card p-8"
      onSubmit={onSubmit}
    >
      {/* Story 6.17 D2: Google first; the email form below is unchanged. */}
      <GoogleSignInButton
        from={fromPreview ? 'preview' : null}
        door="signup"
        onUnavailable={setErrorMessage}
      />
      {googleMessage && !errorMessage ? (
        <p data-testid="google-sign-in-status" role="alert" className={ERROR_CLASS}>
          {googleMessage}
        </p>
      ) : null}
      <SignInDivider />
      <div className="space-y-2">
        <label htmlFor="signup-email" className="text-sm font-medium text-ink">
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
          className={FIELD_CLASS}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="signup-birthdate" className="text-sm font-medium text-ink">
          {strings.birthdate}
        </label>
        <input
          id="signup-birthdate"
          name="birthdate"
          type="date"
          required
          value={birthdate}
          onChange={(event) => setBirthdate(event.target.value)}
          className={FIELD_CLASS}
        />
        {inlineMessage ? (
          <p
            data-testid="signup-inline-message"
            className="text-sm text-notice-ink"
            aria-live="polite"
          >
            {inlineMessage}
          </p>
        ) : null}
      </div>

      {errorMessage ? (
        <p
          data-testid="signup-error-message"
          className={ERROR_CLASS}
          aria-live="assertive"
        >
          {errorMessage}
        </p>
      ) : null}

      {successMessage ? (
        <p
          data-testid="signup-success-message"
          className="rounded-lg border border-line px-4 py-3 text-sm text-success-ink"
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
        // Story CC-7.9 D7: a plain section of the form card, never a card inside it.
        <div className="space-y-4 border-t border-line pt-6">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink-muted">
              {strings.guardianTitle}
            </h2>
            <p className="text-sm text-ink-soft">
              {fromPreview ? firstRun.guardianInvite : strings.guardianIntro}
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="guardian-email" className="text-sm font-medium text-ink">
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
                className={FIELD_CLASS}
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="guardian-consent-level"
                className="text-sm font-medium text-ink"
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
                className={FIELD_CLASS}
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
              className="w-full rounded-full border border-line-strong bg-page px-5 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-ink transition hover:bg-card-muted disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isInviting ? strings.sendingInvite : strings.sendInvite}
            </button>
          </div>

          {inviteLink ? (
            <p
              data-testid="guardian-invite-link"
              className="break-all rounded-lg border border-line bg-page px-4 py-3 text-sm text-ink-soft"
            >
              {inviteLink}
            </p>
          ) : null}
        </div>
      ) : null}

      {fromPreview ? (
        <Link
          href="/preview"
          replace
          data-testid="signup-back-to-preview"
          className="inline-flex min-h-11 items-center text-sm text-ink underline underline-offset-4"
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
        replace={fromPreview}
        data-testid="signup-sign-in-to-continue"
        data-gold="primary"
        className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-on-primary"
      >
        {signInLabel}
      </Link>
    )
  return (
    <button
      type="submit"
      disabled={isSubmitting}
      data-gold="primary"
      className="w-full rounded-full bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-on-primary transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {submitLabel}
    </button>
  )
}

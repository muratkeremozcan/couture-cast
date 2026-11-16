'use client'
// Story 6.17 D3: "Finish creating your account". The Google identity is already verified;
// the only question is the birthdate, and the server's age gate decides.
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  guardianInvitationInputSchema,
  type GuardianInvitationInput,
  type SignupResponse,
} from '@couture/api-client/contracts/http'
import {
  evaluateBirthdateInput,
  getFederatedSignInStrings,
  type SignInDoor,
} from '@couture/utils'
import { getI18n } from '../../../i18n'
import { inviteGuardianFromWeb } from '../../../lib/guardian'
import { webGuestPreviewStore } from '../../../lib/guest-preview'
import { destinationAfterSignIn } from '../../../lib/post-signin-destination'
import {
  cancelWebFederatedSignup,
  fetchWebAwaitingGuardianAccount,
  finishWebFederatedSignup,
  readWebFederatedIdentity,
  signOutWebSession,
} from '../../../lib/web-session'

type Phase =
  | { kind: 'loading' }
  | { kind: 'no_session' }
  | { kind: 'form'; email: string | null }
  | { kind: 'refused' }
  | { kind: 'underage' }
  | { kind: 'created'; account: SignupResponse }
  // A returning teen whose guardian has not approved (or has revoked): the invitation again.
  | { kind: 'awaiting_guardian'; accountId: string }

type GuardianPhase = Extract<Phase, { kind: 'created' | 'awaiting_guardian' }>

const onGuardianStep = (phase: Phase): phase is GuardianPhase =>
  phase.kind === 'created' || phase.kind === 'awaiting_guardian'

// Every signed-in request refuses a teen until a guardian approves, so the session would
// only read as signed out on the next page; end it here and say so on the step.
async function leaveUntilApproved() {
  await signOutWebSession().catch(() => undefined)
  window.location.replace('/')
}

const fieldClass =
  'w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-amber-300'

export function FinishSignupForm({
  fromPreview,
  door,
}: {
  fromPreview: boolean
  /** D5: Cancel and every ending without an account go back to the page that started. */
  door: SignInDoor
}) {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getFederatedSignInStrings(i18n.language)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [birthdate, setBirthdate] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<'create' | 'cancel' | null>(null)
  const birthdateRef = useRef<HTMLInputElement>(null)
  const doorHref = `/${door}${fromPreview ? '?from=preview' : ''}`
  // D3: the email signup's inline birthdate messages, as signup-form.tsx shows them.
  const inlineMessage = evaluateBirthdateInput(birthdate).message

  useEffect(() => {
    let active = true
    void readWebFederatedIdentity()
      .then(async (identity) => {
        if (!identity) {
          if (active) setPhase({ kind: 'no_session' })
          return
        }
        const accountId = await fetchWebAwaitingGuardianAccount(identity.accessToken)
        if (active)
          setPhase(
            accountId
              ? { kind: 'awaiting_guardian', accountId }
              : { kind: 'form', email: identity.email }
          )
      })
      .catch(() => {
        if (active) setPhase({ kind: 'no_session' })
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (phase.kind === 'form') birthdateRef.current?.focus()
  }, [phase.kind])

  async function continueToApp() {
    window.location.replace(await destinationAfterSignIn(fromPreview))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    if (evaluateBirthdateInput(birthdate).kind !== 'valid') {
      setMessage(strings.invalidBirthdate)
      return
    }
    setBusy('create')
    try {
      // An under-13 birthdate still goes to the server, which deletes the Google identity.
      const result = await finishWebFederatedSignup(birthdate)
      switch (result.kind) {
        case 'created':
          if (result.account.guardianConsentRequired)
            setPhase({ kind: 'created', account: result.account })
          else await continueToApp()
          return
        case 'signed_in':
          setMessage(strings.alreadyRegistered)
          await continueToApp()
          return
        case 'underage':
          // The age refusal outranks the preview's self-reported gate (6.16 D2), and any guest
          // preview stored on this device goes with it, whichever door started (D3).
          webGuestPreviewStore().clear()
          setPhase({ kind: 'underage' })
          return
        case 'guardian_minor':
          setMessage(strings.guardianMinor)
          return
        case 'refused':
          setPhase({ kind: 'refused' })
          return
        case 'no_session':
          setPhase({ kind: 'no_session' })
          return
        default:
          setMessage(strings.createUnavailable)
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleCancel() {
    setBusy('cancel')
    await cancelWebFederatedSignup()
    window.location.replace(doorHref)
  }

  if (phase.kind === 'loading')
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold">{strings.finishTitle}</h1>
        <p role="status" aria-live="polite">
          {strings.finishing}
        </p>
      </section>
    )

  if (phase.kind !== 'form' && !onGuardianStep(phase)) {
    const text =
      phase.kind === 'underage'
        ? strings.underage
        : phase.kind === 'refused'
          ? strings.refused
          : strings.noSession
    return (
      <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-3xl font-semibold">{strings.finishTitle}</h1>
        <p
          data-testid="finish-signup-outcome"
          role="alert"
          className="text-base text-neutral-100"
        >
          {text}
        </p>
        <Link
          href={phase.kind === 'underage' ? '/' : doorHref}
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {strings.continue}
        </Link>
      </section>
    )
  }

  if (onGuardianStep(phase)) return <GuardianStep phase={phase} />

  return (
    <form
      className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8"
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
      aria-labelledby="finish-signup-title"
    >
      <h1 id="finish-signup-title" className="text-3xl font-semibold">
        {strings.finishTitle}
      </h1>
      <p className="text-neutral-300">{strings.finishIntro}</p>
      {phase.email ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-neutral-100">{strings.googleAccount}</p>
          <p data-testid="finish-signup-email" className="break-all text-neutral-200">
            {phase.email}
          </p>
        </div>
      ) : null}
      <div className="space-y-2">
        <label
          htmlFor="finish-signup-birthdate"
          className="text-sm font-medium text-neutral-100"
        >
          {strings.birthdate}
        </label>
        <input
          ref={birthdateRef}
          id="finish-signup-birthdate"
          name="birthdate"
          type="date"
          required
          aria-describedby="finish-signup-birthdate-hint"
          value={birthdate}
          onChange={(event) => setBirthdate(event.target.value)}
          className={fieldClass}
        />
        <p id="finish-signup-birthdate-hint" className="text-sm text-neutral-400">
          {strings.birthdateHint}
        </p>
        {inlineMessage ? (
          <p
            data-testid="finish-signup-inline-message"
            className="text-sm text-amber-200"
            aria-live="polite"
          >
            {inlineMessage}
          </p>
        ) : null}
      </div>
      <p
        data-testid="finish-signup-message"
        role="alert"
        className="min-h-6 text-sm text-amber-200"
      >
        {message ?? ''}
      </p>
      <button
        type="submit"
        disabled={busy !== null}
        className="min-h-12 w-full rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-70"
      >
        {busy === 'create' ? strings.creating : strings.create}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => {
          void handleCancel()
        }}
        className="min-h-12 w-full rounded-full border border-white/30 px-5 py-3 text-sm font-semibold text-neutral-100 disabled:opacity-70"
      >
        {busy === 'cancel' ? strings.cancelling : strings.cancel}
      </button>
    </form>
  )
}

/** The email signup's guardian invitation step, for a teen created through Google. */
/**
 * The teen's guardian step: a new account (`created`) or a returning teen still waiting
 * (`awaiting_guardian`). Continue ends the session.
 */
function GuardianStep({ phase }: { phase: GuardianPhase }) {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getFederatedSignInStrings(i18n.language)
  const created = phase.kind === 'created'
  return (
    <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8">
      <h1 className="text-3xl font-semibold">{strings.finishTitle}</h1>
      <p data-testid="finish-signup-outcome" role="status" className="text-emerald-200">
        {created ? strings.createdGuardianPending : strings.awaitingGuardian}
      </p>
      <GuardianInvitePanel teenId={created ? phase.account.userId : phase.accountId} />
      <button
        type="button"
        onClick={() => {
          void leaveUntilApproved()
        }}
        className="min-h-12 w-full rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold text-black"
      >
        {strings.continue}
      </button>
    </section>
  )
}

function GuardianInvitePanel({ teenId }: { teenId: string }) {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getFederatedSignInStrings(i18n.language)
  const [guardianEmail, setGuardianEmail] = useState('')
  const [consentLevel, setConsentLevel] =
    useState<GuardianInvitationInput['consentLevel']>('read_only')
  const [message, setMessage] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  async function invite() {
    setMessage(null)
    setInviteLink(null)
    if (
      !guardianInvitationInputSchema.shape.guardianEmail.safeParse(guardianEmail).success
    ) {
      setMessage(strings.invalidGuardianEmail)
      return
    }
    setInviting(true)
    try {
      const response = await inviteGuardianFromWeb({
        teenId,
        guardianEmail,
        consentLevel,
      })
      setInviteLink(response.invitationLink)
      setMessage(strings.inviteSent.replace('{email}', response.guardianEmail))
    } catch {
      setMessage(strings.inviteFailed)
    } finally {
      setInviting(false)
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-200">
        {strings.guardianTitle}
      </h2>
      <p className="text-sm text-neutral-200">{strings.guardianIntro}</p>
      <label htmlFor="finish-guardian-email" className="block text-sm text-neutral-100">
        {strings.guardianEmail}
      </label>
      <input
        id="finish-guardian-email"
        type="email"
        autoComplete="email"
        value={guardianEmail}
        onChange={(event) => setGuardianEmail(event.target.value)}
        className={fieldClass}
      />
      <label htmlFor="finish-guardian-consent" className="block text-sm text-neutral-100">
        {strings.consentLevel}
      </label>
      <select
        id="finish-guardian-consent"
        value={consentLevel}
        onChange={(event) =>
          setConsentLevel(event.target.value as GuardianInvitationInput['consentLevel'])
        }
        className={fieldClass}
      >
        <option value="read_only">{strings.readOnly}</option>
        <option value="full_access">{strings.fullAccess}</option>
      </select>
      <button
        type="button"
        disabled={inviting}
        onClick={() => {
          void invite()
        }}
        className="min-h-12 w-full rounded-full border border-amber-300/60 px-5 py-3 text-sm font-semibold text-amber-100 disabled:opacity-70"
      >
        {inviting ? strings.sendingInvite : strings.sendInvite}
      </button>
      <p role="status" aria-live="polite" className="text-sm text-neutral-200">
        {message ?? ''}
      </p>
      {inviteLink ? (
        <p
          data-testid="guardian-invite-link"
          className="break-all rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-neutral-200"
        >
          {inviteLink}
        </p>
      ) : null}
    </div>
  )
}

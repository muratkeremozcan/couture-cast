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
  getBirthdateNotice,
  getFederatedSignInStrings,
  getGuestPreviewStrings,
  GUEST_PREVIEW_SAVE_INTENT,
  type SignInDoor,
} from '@couture/utils'
import { getI18n } from '../../../i18n'
import { AppTopBar } from '../../components/app-top-bar'
import { inviteGuardianFromWeb } from '../../../lib/guardian'
import { webGuestPreviewStore } from '../../../lib/guest-preview'
import { webGuestPreviewBirthdate } from '../../../lib/guest-preview-birthdate'
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

// Story CC-7.9 D2: fields on the page surface inside the one card; the global ring marks focus.
const fieldClass =
  'w-full rounded-lg border border-line-strong bg-page px-4 py-3 text-ink transition'
const CARD_CLASS = 'space-y-6 rounded-xl border border-line bg-card p-8'

/**
 * Story CC-7.9 D6: the finish step's top bar, titled in the browser's language. A client
 * component, so the server page can render it above the form.
 */
export function FinishSignupTopBar({ fromPreview = false }: { fromPreview?: boolean }) {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  return (
    <AppTopBar
      title={getFederatedSignInStrings(i18n.language).finishTitle}
      parentHref={fromPreview ? undefined : '/'}
    />
  )
}

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
  const [savingLook, setSavingLook] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<'create' | 'cancel' | null>(null)
  const birthdateRef = useRef<HTMLInputElement>(null)
  const doorHref = `/${door}${fromPreview ? '?from=preview' : ''}`
  // D3: the email signup's inline birthdate messages, as signup-form.tsx shows them.
  const inlineMessage = getBirthdateNotice(evaluateBirthdateInput(birthdate), strings)

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
    if (!fromPreview) return
    let active = true
    void webGuestPreviewStore()
      .load()
      .then(({ state }) => {
        if (!active || state?.conversion?.intent !== GUEST_PREVIEW_SAVE_INTENT) return
        setSavingLook(true)
        const date = webGuestPreviewBirthdate.read()
        if (date) setBirthdate((current) => current || date)
      })
    return () => {
      active = false
    }
  }, [fromPreview])

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
      const result = savingLook
        ? await finishWebFederatedSignup(birthdate, true)
        : await finishWebFederatedSignup(birthdate)
      if (result.kind !== 'unavailable') {
        webGuestPreviewBirthdate.clear()
        setBirthdate('')
      }
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
        case 'awaiting_guardian':
          setPhase({ kind: 'awaiting_guardian', accountId: result.accountId })
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
    window.location.replace(savingLook ? '/preview' : doorHref)
  }

  if (phase.kind === 'loading')
    return (
      // Story CC-7.9 D6: the top bar shows the title (FinishSignupTopBar), so no in-body copy.
      <section className="space-y-4">
        <p role="status" aria-live="polite" className="text-ink-soft">
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
      <section data-surface="card" className={CARD_CLASS}>
        <p
          data-testid="finish-signup-outcome"
          role="alert"
          className="text-base text-ink"
        >
          {text}
        </p>
        <Link
          href={phase.kind === 'underage' ? '/' : doorHref}
          className="inline-flex min-h-11 items-center text-ink underline underline-offset-4"
        >
          {strings.continue}
        </Link>
      </section>
    )
  }

  if (onGuardianStep(phase)) {
    return (
      <GuardianStep
        phase={phase}
        continueToLook={savingLook ? continueToApp : undefined}
      />
    )
  }

  return (
    <form
      data-surface="card"
      className={CARD_CLASS}
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
      aria-label={strings.finishTitle}
    >
      <p className="text-ink-soft">{strings.finishIntro}</p>
      {phase.email ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">{strings.googleAccount}</p>
          <p data-testid="finish-signup-email" className="break-all text-ink-soft">
            {phase.email}
          </p>
        </div>
      ) : null}
      <div className="space-y-2">
        <label htmlFor="finish-signup-birthdate" className="text-sm font-medium text-ink">
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
        <p id="finish-signup-birthdate-hint" className="text-sm text-ink-muted">
          {strings.birthdateHint}
        </p>
        {inlineMessage ? (
          <p
            data-testid="finish-signup-inline-message"
            className="text-sm text-notice-ink"
            aria-live="polite"
          >
            {inlineMessage}
          </p>
        ) : null}
      </div>
      {/* An empty alert stays in the tree for its announcement and costs no gap (TEA N-2). */}
      <p
        data-testid="finish-signup-message"
        role="alert"
        className="text-sm text-notice-ink empty:!mt-0"
      >
        {message ?? ''}
      </p>
      <button
        type="submit"
        disabled={busy !== null}
        data-gold="primary"
        className="min-h-12 w-full rounded-full bg-primary px-5 py-3 text-sm font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-70"
      >
        {busy === 'create' ? strings.creating : strings.create}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => {
          void handleCancel()
        }}
        className="min-h-12 w-full rounded-full border border-line-strong bg-page px-5 py-3 text-sm font-semibold text-ink disabled:opacity-70"
      >
        {busy === 'cancel' ? strings.cancelling : strings.cancel}
      </button>
    </form>
  )
}

/**
 * The teen's guardian step: a new account (`created`) or a returning teen still waiting
 * (`awaiting_guardian`). Continue ends the session.
 */
function GuardianStep({
  phase,
  continueToLook,
}: {
  phase: GuardianPhase
  continueToLook?: () => Promise<void>
}) {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getFederatedSignInStrings(i18n.language)
  const firstRun = getGuestPreviewStrings(i18n.language).firstRun
  const created = phase.kind === 'created'
  return (
    <section data-surface="card" className={CARD_CLASS}>
      <h2 className="text-2xl font-semibold text-ink">{strings.guardianStepTitle}</h2>
      <p data-testid="finish-signup-outcome" role="status" className="text-success-ink">
        {continueToLook
          ? firstRun.guardianPending
          : created
            ? strings.createdGuardianPending
            : strings.awaitingGuardian}
      </p>
      <GuardianInvitePanel
        teenId={created ? phase.account.userId : phase.accountId}
        intro={continueToLook ? firstRun.guardianInvite : strings.guardianIntro}
      />
      <button
        type="button"
        onClick={() => {
          void (continueToLook ?? leaveUntilApproved)()
        }}
        data-gold="primary"
        className="min-h-12 w-full rounded-full bg-primary px-5 py-3 text-sm font-semibold text-on-primary"
      >
        {continueToLook ? strings.continue : strings.guardianStepLeave}
      </button>
    </section>
  )
}

function GuardianInvitePanel({ teenId, intro }: { teenId: string; intro: string }) {
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
    // D7: a plain section of the guardian step card, never a card inside it.
    <div className="space-y-4 border-t border-line pt-6">
      <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink-muted">
        {strings.guardianTitle}
      </h3>
      <p className="text-sm text-ink-soft">{intro}</p>
      <label htmlFor="finish-guardian-email" className="block text-sm text-ink">
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
      <label htmlFor="finish-guardian-consent" className="block text-sm text-ink">
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
        className="min-h-12 w-full rounded-full border border-line-strong bg-page px-5 py-3 text-sm font-semibold text-ink disabled:opacity-70"
      >
        {inviting ? strings.sendingInvite : strings.sendInvite}
      </button>
      <p role="status" aria-live="polite" className="text-sm text-ink-soft">
        {message ?? ''}
      </p>
      {inviteLink ? (
        <p
          data-testid="guardian-invite-link"
          className="break-all rounded-lg border border-line bg-page px-4 py-3 text-sm text-ink-soft"
        >
          {inviteLink}
        </p>
      ) : null}
    </div>
  )
}

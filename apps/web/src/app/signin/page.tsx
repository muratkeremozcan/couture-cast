'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  finishStepHref,
  getFederatedSignInStrings,
  getGuestPreviewStrings,
  parsePreviewFrom,
  type FederatedSignInStrings,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { AppPage, APP_MAIN_CLASS } from '../components/app-page'
import { AppTopBar } from '../components/app-top-bar'
import { destinationAfterSignIn } from '../../lib/post-signin-destination'
import { GoogleSignInButton, SignInDivider } from '../components/google-sign-in-button'
import { LegalLinks } from '../components/legal-page'
import {
  requestWebOtp,
  verifyWebOtp,
  WebSignInError,
  type WebSignInFailure,
} from '../../lib/web-session'
const FAILURE_KEYS: Record<Exclude<WebSignInFailure, 'awaiting_guardian'>, string> = {
  denied: 'community.notifications.signinDenied',
  code_invalid: 'community.notifications.signinCodeInvalid',
  unavailable: 'community.notifications.signinUnavailable',
}
/**
 * Story 6.17 D5: the callback sends a Google round trip that did not sign anyone in back
 * here with one fixed outcome name; provider text from the URL is never rendered.
 */
const GOOGLE_OUTCOME_KEYS = {
  cancelled: 'cancelled',
  unavailable: 'unavailable',
  refused: 'refused',
} as const satisfies Record<string, keyof FederatedSignInStrings>

function googleOutcomeKey(value: string | null) {
  return value && Object.hasOwn(GOOGLE_OUTCOME_KEYS, value)
    ? GOOGLE_OUTCOME_KEYS[value as keyof typeof GOOGLE_OUTCOME_KEYS]
    : null
}

export default function SignInPage() {
  const { t, i18n } = useTranslation('translation', { i18n: getI18n() })
  const [fromPreview, setFromPreview] = useState(false)
  const [googleMessage, setGoogleMessage] = useState<string | null>(null)
  const googleStrings = getFederatedSignInStrings(i18n.language)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setFromPreview(parsePreviewFrom(params.get('from')) !== null)
    const outcome = googleOutcomeKey(params.get('google'))
    if (outcome) setGoogleMessage(outcome)
  }, [])
  const previewStrings = getGuestPreviewStrings(i18n.language)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const fieldClass =
    'min-h-12 rounded-md border border-line-strong bg-page p-3 text-base text-ink'
  return (
    // Story CC-7.9 D6, D7: the shared top bar owns the page's only heading; the form is one card.
    <AppPage>
      <AppTopBar title={t('community.notifications.signin')} parentHref="/" />
      <main id="main-content" tabIndex={-1} className={APP_MAIN_CLASS}>
        <div className="mx-auto flex w-full max-w-md flex-col gap-5">
          <div
            data-surface="card"
            className="flex flex-col gap-5 rounded-xl border border-line bg-card p-6"
          >
            <GoogleSignInButton
              from={fromPreview ? 'preview' : null}
              shape="rect"
              onUnavailable={() => setGoogleMessage('unavailable')}
            />
            {googleMessage ? (
              <p
                role="alert"
                data-testid="google-sign-in-status"
                className="rounded-lg border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger-ink"
              >
                {googleStrings[googleMessage as keyof FederatedSignInStrings]}
              </p>
            ) : null}
            <SignInDivider />
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                setBusy(true)
                setMessage(null)
                const action = sent
                  ? verifyWebOtp(email, code, fromPreview)
                  : requestWebOtp(email)
                void action
                  .then(async () => {
                    if (sent)
                      window.location.assign(
                        await destinationAfterSignIn(
                          parsePreviewFrom(
                            new URLSearchParams(window.location.search).get('from')
                          ) !== null
                        )
                      )
                    else {
                      setSent(true)
                      setMessage('community.notifications.codeSent')
                    }
                  })
                  .catch((error: unknown) => {
                    const reason =
                      error instanceof WebSignInError ? error.reason : 'unavailable'
                    // A teen waiting on a guardian goes to the guardian invitation, not a refusal.
                    if (reason === 'awaiting_guardian')
                      window.location.assign(
                        finishStepHref(fromPreview ? 'preview' : null, 'signin')
                      )
                    // Anything unclassified is treated as temporary, so the person retries.
                    else setMessage(FAILURE_KEYS[reason])
                  })
                  .finally(() => setBusy(false))
              }}
            >
              <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                {t('community.notifications.email')}
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  disabled={sent || busy}
                  onChange={(event) => setEmail(event.target.value)}
                  className={fieldClass}
                />
              </label>
              {sent && (
                <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                  {t('community.notifications.code')}
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className={fieldClass}
                  />
                </label>
              )}
              <button
                type="submit"
                disabled={busy}
                data-gold="primary"
                className="min-h-12 rounded-md bg-primary px-4 py-3 font-semibold text-on-primary disabled:opacity-70"
              >
                {t(
                  sent
                    ? 'community.notifications.verify'
                    : 'community.notifications.sendCode'
                )}
              </button>
            </form>
            <p role="status" aria-live="polite" className="text-sm text-ink-soft">
              {message ? t(message) : ''}
            </p>
            {fromPreview ? (
              <Link
                href="/preview"
                replace
                data-testid="signin-back-to-preview"
                className="inline-flex min-h-11 items-center text-ink underline underline-offset-4"
              >
                {previewStrings.conversionDetail.backToPreview}
              </Link>
            ) : null}
          </div>
          <LegalLinks />
        </div>
      </main>
    </AppPage>
  )
}

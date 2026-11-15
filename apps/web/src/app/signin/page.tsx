'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getFederatedSignInStrings,
  getGuestPreviewStrings,
  parsePreviewFrom,
  type FederatedSignInStrings,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { destinationAfterSignIn } from '../../lib/post-signin-destination'
import { GoogleSignInButton, SignInDivider } from '../components/google-sign-in-button'
import {
  requestWebOtp,
  verifyWebOtp,
  WebSignInError,
  type WebSignInFailure,
} from '../../lib/web-session'
const FAILURE_KEYS: Record<WebSignInFailure, string> = {
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
  return (
    <main id="main-content" className="mx-auto flex max-w-md flex-col gap-5 p-6">
      <h1 className="text-3xl font-semibold">{t('community.notifications.signin')}</h1>
      <GoogleSignInButton
        from={fromPreview ? 'preview' : null}
        shape="rect"
        onUnavailable={() => setGoogleMessage('unavailable')}
      />
      {googleMessage ? (
        <p role="alert" data-testid="google-sign-in-status">
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
          const action = sent ? verifyWebOtp(email, code) : requestWebOtp(email)
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
            .catch((error: unknown) =>
              // Anything unclassified is treated as temporary, so the person retries.
              setMessage(
                FAILURE_KEYS[
                  error instanceof WebSignInError ? error.reason : 'unavailable'
                ]
              )
            )
            .finally(() => setBusy(false))
        }}
      >
        <label className="flex flex-col gap-2">
          {t('community.notifications.email')}
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={sent || busy}
            onChange={(event) => setEmail(event.target.value)}
            className="min-h-12 rounded border p-3"
          />
        </label>
        {sent && (
          <label className="flex flex-col gap-2">
            {t('community.notifications.code')}
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="min-h-12 rounded border p-3"
            />
          </label>
        )}
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 rounded bg-[#C9A14A] px-4 py-3 text-black focus-visible:outline focus-visible:outline-2"
        >
          {t(
            sent ? 'community.notifications.verify' : 'community.notifications.sendCode'
          )}
        </button>
      </form>
      <p role="status" aria-live="polite">
        {message ? t(message) : ''}
      </p>
      {fromPreview ? (
        <Link
          href="/preview"
          data-testid="signin-back-to-preview"
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {previewStrings.conversionDetail.backToPreview}
        </Link>
      ) : null}
    </main>
  )
}

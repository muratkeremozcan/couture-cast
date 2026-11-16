'use client'
// Story 6.17 D5: where Google returns. Takes the one-time code out of the address bar before its
// own effects run, exchanges it once, then sends the person to the one place their outcome
// allows. PostHog may already be loaded (instrumentation-client.ts); its page views reduce this
// route to its template and its stored entry URL masks `code`.
import { useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  finishStepHref,
  getFederatedSignInStrings,
  parsePreviewFrom,
  parseSignInDoor,
  type SignInDoor,
} from '@couture/utils'
import { getI18n } from '../../../i18n'
import { takeOAuthCallbackParams } from '../../../lib/oauth-callback-url'
import { destinationAfterSignIn } from '../../../lib/post-signin-destination'
import { completeWebOAuth, type WebOAuthOutcome } from '../../../lib/web-session'

async function destinationFor(
  outcome: WebOAuthOutcome,
  fromPreview: boolean,
  door: SignInDoor
): Promise<string> {
  switch (outcome.kind) {
    case 'member':
      return destinationAfterSignIn(fromPreview)
    case 'no_account':
    case 'awaiting_guardian':
      // The finish step asks the status itself: the birthdate, or the guardian invitation.
      return finishStepHref(fromPreview ? 'preview' : null, door)
    default:
      return `/${door}?google=${outcome.kind}${fromPreview ? '&from=preview' : ''}`
  }
}

/**
 * Taken once per page load: a second effect run (React StrictMode) finds the URL already
 * clean and must reuse what the first run took.
 */
let takenParams: URLSearchParams | undefined

export default function OAuthCallbackPage() {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getFederatedSignInStrings(i18n.language)
  const [failed, setFailed] = useState(false)
  useLayoutEffect(() => {
    takenParams ??= takeOAuthCallbackParams()
    const params = takenParams
    const fromPreview = parsePreviewFrom(params.get('from')) !== null
    const door = parseSignInDoor(params.get('door'))
    let active = true
    void completeWebOAuth(params)
      .then((outcome) => destinationFor(outcome, fromPreview, door))
      .then((destination) => {
        if (active) window.location.replace(destination)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [])
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-[50vh] max-w-md flex-col justify-center gap-4 p-6"
    >
      <h1 className="text-2xl font-semibold">{strings.continueWithGoogle}</h1>
      <p role="status" aria-live="polite" data-testid="oauth-callback-status">
        {failed ? strings.unavailable : strings.finishing}
      </p>
    </main>
  )
}

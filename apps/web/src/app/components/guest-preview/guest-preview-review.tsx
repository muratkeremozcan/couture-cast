'use client'
// Story 6.16 D8: after a verified sign-in that started in the preview, one review step
// offers the preview's comfort settings. Nothing is written without explicit consent,
// success is shown only after a read-back, and a member change discards the proposal.
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  applyComfortCarryover,
  GUEST_PREVIEW_GARMENT_INTENT,
  getGuestPreviewStrings,
  type GuestPreviewStrings,
  type SampleComfort,
} from '@couture/utils'
import { getI18n } from '../../../i18n'
import {
  isConsentRejection,
  resolveWebNextStep,
  verifiedComfortClient,
  webGuestPreviewStore,
  type WebComfortClient,
} from '../../../lib/guest-preview'
import { resolveWebSessionToken, webSessionIdentity } from '../../../lib/web-session'

type ReviewStatus =
  | { kind: 'loading' }
  | { kind: 'load-failed' }
  | { kind: 'ready'; account: SampleComfort; proposal: SampleComfort }
  | { kind: 'saving'; account: SampleComfort; proposal: SampleComfort }
  | { kind: 'failed'; account: SampleComfort; proposal: SampleComfort }
  | { kind: 'saved' }
  | { kind: 'kept' }
  | { kind: 'rejected' }

function ComfortColumn({
  heading,
  values,
  strings,
  testId,
}: {
  heading: string
  values: SampleComfort
  strings: GuestPreviewStrings
  testId: string
}) {
  const v = strings.values
  return (
    <div
      data-testid={testId}
      className="space-y-2 rounded-[8px] border border-[#E6E6ED] p-4"
    >
      <h2 className="text-sm font-semibold text-[#111111]">{heading}</h2>
      <dl className="space-y-1 text-sm">
        <dt className="text-[#5C5C66]">{strings.preferences.thermal}</dt>
        <dd>{v.runsColdWarm[values.runsColdWarm]}</dd>
        <dt className="text-[#5C5C66]">{strings.preferences.wind}</dt>
        <dd>{v.windTolerance[values.windTolerance]}</dd>
        <dt className="text-[#5C5C66]">{strings.preferences.rain}</dt>
        <dd>{v.precipPreparedness[values.precipPreparedness]}</dd>
      </dl>
    </div>
  )
}

/**
 * D8: who is signed in once session verification settles. Re-verification can set the
 * member to null and back, so a mismatch seen mid-flight decides nothing until this
 * answers: 'same', 'other' (a different member or signed out), or 'unknown' when the
 * session cannot be read.
 */
async function settledIdentity(memberId: string): Promise<'same' | 'other' | 'unknown'> {
  try {
    const token = await resolveWebSessionToken()
    return token && webSessionIdentity() === memberId ? 'same' : 'other'
  } catch {
    return 'unknown'
  }
}

export function GuestPreviewReview() {
  const router = useRouter()
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getGuestPreviewStrings(i18n.language)
  const store = webGuestPreviewStore()
  const [status, setStatus] = useState<ReviewStatus>({ kind: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const client = useRef<WebComfortClient | null>(null)
  const inFlight = useRef(false)
  const garmentIntent = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    let active = true
    const discard = () => {
      client.current = null
      store.clear()
      router.replace('/')
    }
    void (async () => {
      const snapshot = await store.load()
      const conversion = snapshot.state?.conversion
      const proposal = conversion ? snapshot.state?.comfort : null
      garmentIntent.current = conversion?.intent === GUEST_PREVIEW_GARMENT_INTENT
      if (!proposal) {
        router.replace('/')
        return
      }
      try {
        const verified = await verifiedComfortClient()
        if (!active) return
        if (!verified) {
          router.replace('/signin?from=preview')
          return
        }
        client.current = verified
        const account = await verified.read()
        if (!active) return
        // W2: the member may have changed while the read was in flight.
        if (webSessionIdentity() !== verified.memberId) {
          const identity = await settledIdentity(verified.memberId)
          if (!active || client.current !== verified) return
          if (identity === 'other') return discard()
          if (identity === 'unknown') return setStatus({ kind: 'load-failed' })
        }
        setStatus({ kind: 'ready', account, proposal })
      } catch {
        if (active) setStatus({ kind: 'load-failed' })
      }
    })()
    // D8: a different member discards the proposal; a new account needs a new review.
    const onSession = () => {
      const verified = client.current
      if (!verified || webSessionIdentity() === verified.memberId) return
      void settledIdentity(verified.memberId).then((identity) => {
        if (active && client.current === verified && identity === 'other') discard()
      })
    }
    window.addEventListener('couture:session', onSession)
    return () => {
      active = false
      mounted.current = false
      window.removeEventListener('couture:session', onSession)
    }
  }, [router, store, loadAttempt])

  async function applyProposal(account: SampleComfort, proposal: SampleComfort) {
    const verified = client.current
    if (!verified || inFlight.current) return
    inFlight.current = true
    setStatus({ kind: 'saving', account, proposal })
    const carryover = () =>
      applyComfortCarryover({
        proposal,
        read: verified.read,
        write: verified.write,
        isRejection: isConsentRejection,
        isCurrent: () =>
          mounted.current &&
          client.current === verified &&
          webSessionIdentity() === verified.memberId,
      })
    let outcome = await carryover()
    if (outcome.status === 'stale' && mounted.current && client.current === verified) {
      // A mid-flight identity flip; the carryover reads first, so running it again for
      // the same settled member never writes twice.
      const identity = await settledIdentity(verified.memberId)
      if (identity === 'same' && client.current === verified) outcome = await carryover()
      else if (identity === 'unknown') outcome = { status: 'failed' }
      else if (client.current === verified) {
        inFlight.current = false
        client.current = null
        store.clear()
        router.replace('/')
        return
      }
    }
    inFlight.current = false
    // Any other stale result still on this screen ends in a retry.
    if (outcome.status === 'stale') {
      if (mounted.current && client.current === verified)
        setStatus({ kind: 'failed', account, proposal })
      return
    }
    if (outcome.status === 'saved') {
      store.clear()
      setStatus({ kind: 'saved' })
    } else if (outcome.status === 'rejected') {
      store.clear()
      setStatus({ kind: 'rejected' })
    } else {
      setStatus({ kind: 'failed', account, proposal })
    }
  }

  function keepAccount() {
    store.clear()
    setStatus({ kind: 'kept' })
  }

  async function continueToNextStep() {
    const token = await resolveWebSessionToken().catch(() => undefined)
    if (!token) {
      if (mounted.current) router.push('/signin')
      return
    }
    const verified = client.current
    if (!verified || webSessionIdentity() !== verified.memberId) return
    const next = garmentIntent.current
      ? await resolveWebNextStep(token, true)
      : await resolveWebNextStep(token)
    if (mounted.current && webSessionIdentity() === verified.memberId) router.push(next)
  }

  return (
    <div className="lookbook-body min-h-screen bg-[#FAFAFB] text-[#111111]">
      <main
        id="main-content"
        tabIndex={-1}
        data-testid="guest-preview-review"
        className="mx-auto max-w-2xl space-y-6 px-4 py-10 outline-none sm:px-6"
      >
        <h1 className="lookbook-display text-3xl font-semibold">
          {strings.review.heading}
        </h1>
        {status.kind === 'loading' ? (
          <p role="status">{strings.chrome.checkingSession}</p>
        ) : null}
        {status.kind === 'load-failed' ? (
          <div className="space-y-3">
            <p role="alert">{strings.review.loadFailed}</p>
            <button
              type="button"
              onClick={() => {
                setStatus({ kind: 'loading' })
                setLoadAttempt((attempt) => attempt + 1)
              }}
              className="min-h-11 rounded-lg bg-[#111111] px-4 text-sm font-semibold text-[#FFFFFF]"
            >
              {strings.chrome.retry}
            </button>
          </div>
        ) : null}
        {status.kind === 'ready' ||
        status.kind === 'saving' ||
        status.kind === 'failed' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <ComfortColumn
                heading={strings.review.account}
                values={status.account}
                strings={strings}
                testId="guest-preview-review-account"
              />
              <ComfortColumn
                heading={strings.review.proposed}
                values={status.proposal}
                strings={strings}
                testId="guest-preview-review-proposed"
              />
            </div>
            {status.kind === 'failed' ? (
              <p role="alert" data-testid="guest-preview-review-failed">
                {strings.review.failed}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={status.kind === 'saving'}
                aria-busy={status.kind === 'saving'}
                onClick={() => void applyProposal(status.account, status.proposal)}
                data-testid="guest-preview-review-use"
                className="min-h-11 rounded-lg bg-[#111111] px-4 text-sm font-semibold text-[#FFFFFF] disabled:opacity-60"
              >
                {status.kind === 'saving' ? strings.review.saving : strings.review.use}
              </button>
              <button
                type="button"
                disabled={status.kind === 'saving'}
                onClick={keepAccount}
                data-testid="guest-preview-review-keep"
                className="min-h-11 rounded-lg border border-[#111111] px-4 text-sm font-semibold disabled:opacity-60"
              >
                {strings.review.keep}
              </button>
            </div>
          </>
        ) : null}
        {status.kind === 'saved' ||
        status.kind === 'kept' ||
        status.kind === 'rejected' ? (
          <div className="space-y-4">
            <p role="status" data-testid="guest-preview-review-result">
              {status.kind === 'saved'
                ? strings.review.saved
                : status.kind === 'kept'
                  ? strings.review.kept
                  : strings.review.rejected}
            </p>
            <button
              type="button"
              onClick={() => void continueToNextStep()}
              data-testid="guest-preview-review-continue"
              className="min-h-11 rounded-lg bg-[#111111] px-4 text-sm font-semibold text-[#FFFFFF]"
            >
              {strings.review.continue}
            </button>
          </div>
        ) : null}
      </main>
    </div>
  )
}

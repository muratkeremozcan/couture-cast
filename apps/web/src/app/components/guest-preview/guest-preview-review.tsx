'use client'
// Story 6.16 D8: after a verified sign-in that started in the preview, one review step
// offers the preview's comfort settings. Nothing is written without explicit consent,
// success is shown only after a read-back, and a member change discards the proposal.
import { useRouter } from 'next/navigation'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  applyComfortCarryover,
  completeGuestLookSave,
  GUEST_PREVIEW_GARMENT_INTENT,
  GUEST_PREVIEW_SAVE_INTENT,
  getGuestPreviewStrings,
  guestLookStyleRows,
  guestPreviewReviewProposal,
  type GuestLookSaveIntent,
  type GuestPreviewStrings,
  type GuestPreviewStore,
  type SampleComfort,
  type StyleProfileAnswers,
} from '@couture/utils'
import { getI18n } from '../../../i18n'
import { AppPage, APP_MAIN_BASE_CLASS } from '../app-page'
import { AppTopBar } from '../app-top-bar'
import { savedLookHref, savedLooksHref } from '../looks/looks-address'
import { useStatusBar } from '../save-feedback'
import { verifiedGuestLookClient } from '../../../lib/guest-look-review'
import { notifySavedLooksChanged } from '../../../lib/saved-looks'
import {
  isConsentRejection,
  resolveWebNextStep,
  verifiedComfortClient,
  webGuestPreviewStore,
  type WebComfortClient,
} from '../../../lib/guest-preview'
import { subscribeWebStyleScope } from '../../../lib/use-web-session'
import { resolveWebSessionToken, webSessionIdentity } from '../../../lib/web-session'

type ReviewStatus =
  | { kind: 'loading' }
  | { kind: 'load-failed' }
  | ActiveReview
  | { kind: 'saved' }
  | { kind: 'kept' }
  | { kind: 'rejected' }

type ActiveReview = {
  kind: 'ready' | 'saving' | 'failed'
  account: SampleComfort
  proposal: SampleComfort
}

type LookReview = {
  intent: GuestLookSaveIntent
  accountStyle: StyleProfileAnswers | null
  client: Awaited<ReturnType<typeof verifiedGuestLookClient>>
}

async function loadAccountReview(
  verified: WebComfortClient,
  intent: GuestLookSaveIntent | null
) {
  const client = intent ? await verifiedGuestLookClient(verified.memberId) : null
  const [account, accountStyle] = await Promise.all([
    verified.read(),
    client?.readStyle() ?? null,
  ])
  return {
    account,
    lookReview: intent && client ? { intent, accountStyle, client } : null,
  }
}

async function claimLookSave(
  store: GuestPreviewStore,
  intent: GuestLookSaveIntent,
  isCurrent: () => boolean
) {
  const cached = store.snapshot()
  const snapshot = cached.persistent ? await store.syncExternal() : cached
  const pending = snapshot.state?.conversion
  if (
    !isCurrent() ||
    pending?.intent !== GUEST_PREVIEW_SAVE_INTENT ||
    pending.key !== intent.key
  )
    return false
  // Retries stay in this review, bound to its verified account and chosen settings.
  store.clear()
  await store.flush()
  return isCurrent()
}

function isActiveReview(status: ReviewStatus): status is ActiveReview {
  return status.kind === 'ready' || status.kind === 'saving' || status.kind === 'failed'
}

function ComfortColumn({
  heading,
  values,
  strings,
  testId,
  styleRows,
}: {
  heading: string
  values: SampleComfort
  strings: GuestPreviewStrings
  testId: string
  styleRows?: ReturnType<typeof guestLookStyleRows>
}) {
  const v = strings.values
  return (
    <div
      data-testid={testId}
      data-surface="card"
      className="space-y-2 rounded-xl border border-line bg-card p-4"
    >
      <h2 className="text-sm font-semibold text-ink">{heading}</h2>
      <dl className="space-y-1 text-sm">
        <dt className="text-ink-muted">{strings.preferences.thermal}</dt>
        <dd>{v.runsColdWarm[values.runsColdWarm]}</dd>
        <dt className="text-ink-muted">{strings.preferences.wind}</dt>
        <dd>{v.windTolerance[values.windTolerance]}</dd>
        <dt className="text-ink-muted">{strings.preferences.rain}</dt>
        <dd>{v.precipPreparedness[values.precipPreparedness]}</dd>
        {styleRows?.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-ink-muted">{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
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
  const { t, i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getGuestPreviewStrings(i18n.language)
  const { showNotice } = useStatusBar()
  const store = webGuestPreviewStore()
  const [status, setStatus] = useState<ReviewStatus>({ kind: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const client = useRef<WebComfortClient | null>(null)
  const inFlight = useRef(false)
  const garmentIntent = useRef(false)
  const mounted = useRef(true)
  const [lookReview, setLookReview] = useState<LookReview | null>(null)
  const saveChoice = useRef<boolean | null>(null)
  const scopeIsCurrent = useRef<(() => boolean) | null>(null)

  useEffect(() => {
    mounted.current = true
    let active = true
    const discard = () => {
      client.current = null
      scopeIsCurrent.current = null
      setLookReview(null)
      setStatus({ kind: 'loading' })
      store.clear()
      router.replace('/')
    }
    void (async () => {
      const snapshot = await store.load()
      if (!active) return
      const conversion = snapshot.state?.conversion
      const draft = guestPreviewReviewProposal(snapshot.state)
      garmentIntent.current = conversion?.intent === GUEST_PREVIEW_GARMENT_INTENT
      if (!draft) {
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
        const { account, lookReview: loadedReview } = await loadAccountReview(
          verified,
          draft.intent
        )
        if (!active) return
        // W2: the member may have changed while the read was in flight.
        if (webSessionIdentity() !== verified.memberId) {
          const identity = await settledIdentity(verified.memberId)
          if (!active || client.current !== verified) return
          if (identity === 'other') return discard()
          if (identity === 'unknown') return setStatus({ kind: 'load-failed' })
        }
        if (loadedReview?.client.isCurrent() === false) return discard()
        scopeIsCurrent.current = loadedReview?.client.isCurrent ?? null
        setLookReview(loadedReview)
        setStatus({ kind: 'ready', account, proposal: draft.comfort })
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
    const unsubscribeScope = subscribeWebStyleScope(() => {
      if (scopeIsCurrent.current?.() === false) discard()
    })
    return () => {
      active = false
      mounted.current = false
      window.removeEventListener('couture:session', onSession)
      unsubscribeScope()
    }
  }, [router, store, loadAttempt])

  function cancelLookReview() {
    if (inFlight.current) return
    client.current = null
    scopeIsCurrent.current = null
    setLookReview(null)
    setStatus({ kind: 'loading' })
    store.clear()
    router.replace('/')
  }

  async function saveLook(
    account: SampleComfort,
    proposal: SampleComfort,
    applySettings: boolean
  ) {
    const verified = client.current
    if (!lookReview || !verified || inFlight.current) return
    const { intent, client: lookClient } = lookReview
    if (!lookClient.isCurrent()) return cancelLookReview()
    inFlight.current = true
    setStatus({ kind: 'saving', account, proposal })
    const isCurrent = () =>
      mounted.current && client.current === verified && lookClient.isCurrent()
    async function commit(verified: NonNullable<typeof client.current>) {
      if (saveChoice.current === null) {
        if (!(await claimLookSave(store, intent, isCurrent))) return null
        saveChoice.current = applySettings
      }
      const comfortClient = saveChoice.current ? await verifiedComfortClient() : verified
      if (comfortClient?.memberId !== verified.memberId) return null
      return completeGuestLookSave({
        intent,
        applySettings: saveChoice.current,
        lookClient,
        comfortClient,
        isCurrent,
        isRejection: isConsentRejection,
      })
    }
    let saved: Awaited<ReturnType<typeof completeGuestLookSave>> | undefined
    try {
      saved = await commit(verified)
    } catch (error) {
      if (isConsentRejection(error)) saved = 'rejected'
    } finally {
      inFlight.current = false
    }
    if (!mounted.current || client.current !== verified) return
    if (!lookClient.isCurrent() || saved === null) return cancelLookReview()
    if (saved === 'rejected') {
      store.clear()
      setLookReview(null)
      setStatus({ kind: 'rejected' })
      return
    }
    if (!saved) {
      setStatus({ kind: 'failed', account, proposal })
      return
    }
    notifySavedLooksChanged(verified.memberId)
    showNotice({
      id: `guest-look-saved:${saved.id}`,
      message: t('feedback.savedToLooks'),
      tone: 'success',
      actions: [
        {
          id: 'view',
          kind: 'view',
          label: t('feedback.view'),
          onPress: () => {
            if (lookClient.isCurrent()) router.push(savedLookHref(saved.id))
          },
        },
      ],
    })
    router.replace(savedLooksHref())
  }

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
    // Story CC-7.9 D6, D7: the shared top bar carries the review question as the screen's only
    // h1; back returns Home, where a declined review leaves the member.
    <AppPage>
      <AppTopBar
        title={strings.review.heading}
        parentHref={lookReview ? undefined : '/'}
        onBack={lookReview ? cancelLookReview : undefined}
      />
      <main
        id="main-content"
        tabIndex={-1}
        data-testid="guest-preview-review"
        className={`${APP_MAIN_BASE_CLASS} max-w-2xl gap-6`}
      >
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
              className="min-h-11 rounded-lg bg-inverse px-4 text-sm font-semibold text-on-inverse"
            >
              {strings.chrome.retry}
            </button>
          </div>
        ) : null}
        {isActiveReview(status) && (
          <ReviewChoices
            status={status}
            strings={strings}
            locale={i18n.language}
            lookReview={lookReview}
            saveChoice={saveChoice.current}
            onUse={() => {
              if (lookReview) void saveLook(status.account, status.proposal, true)
              else void applyProposal(status.account, status.proposal)
            }}
            onKeep={() => {
              if (lookReview) void saveLook(status.account, status.proposal, false)
              else keepAccount()
            }}
            onCancel={cancelLookReview}
          />
        )}
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
              className="min-h-11 rounded-lg bg-inverse px-4 text-sm font-semibold text-on-inverse"
            >
              {strings.review.continue}
            </button>
          </div>
        ) : null}
      </main>
    </AppPage>
  )
}

function ReviewChoices({
  status,
  strings,
  locale,
  lookReview,
  saveChoice,
  onUse,
  onKeep,
  onCancel,
}: {
  status: ActiveReview
  strings: GuestPreviewStrings
  locale: string
  lookReview: LookReview | null
  saveChoice: boolean | null
  onUse: () => void
  onKeep: () => void
  onCancel: () => void
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <ComfortColumn
          heading={strings.review.account}
          values={status.account}
          strings={strings}
          testId="guest-preview-review-account"
          styleRows={
            lookReview ? guestLookStyleRows(lookReview.accountStyle, locale) : undefined
          }
        />
        <ComfortColumn
          heading={strings.review.proposed}
          values={status.proposal}
          strings={strings}
          testId="guest-preview-review-proposed"
          styleRows={
            lookReview ? guestLookStyleRows(lookReview.intent.style, locale) : undefined
          }
        />
      </div>
      {status.kind === 'failed' ? (
        <p role="alert" data-testid="guest-preview-review-failed">
          {lookReview ? strings.firstRun.reviewFailed : strings.review.failed}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={status.kind === 'saving' || saveChoice === false}
          aria-busy={status.kind === 'saving'}
          onClick={onUse}
          data-testid="guest-preview-review-use"
          className="min-h-11 rounded-lg bg-inverse px-4 text-sm font-semibold text-on-inverse disabled:opacity-60"
        >
          {status.kind === 'saving' && saveChoice !== false
            ? strings.review.saving
            : lookReview
              ? strings.firstRun.saveWithSettings
              : strings.review.use}
        </button>
        <button
          type="button"
          disabled={status.kind === 'saving' || saveChoice === true}
          onClick={onKeep}
          data-testid="guest-preview-review-keep"
          className="min-h-11 rounded-lg border border-line-strong bg-page px-4 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {status.kind === 'saving' && saveChoice === false
            ? strings.review.saving
            : lookReview
              ? strings.firstRun.saveOnly
              : strings.review.keep}
        </button>
        {lookReview && (
          <button
            type="button"
            data-testid="guest-preview-review-cancel"
            disabled={status.kind === 'saving'}
            onClick={onCancel}
            className="min-h-11 px-3 text-sm font-semibold underline"
          >
            {strings.firstRun.cancelReview}
          </button>
        )}
      </div>
    </>
  )
}

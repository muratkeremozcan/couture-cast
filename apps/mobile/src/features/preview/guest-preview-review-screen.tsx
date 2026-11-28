// Story 6.16 D8: after a verified sign-in that started in the preview, one review step
// offers the preview's comfort settings. Nothing is written without explicit consent,
// success is shown only after a read-back, and a member change discards the proposal.
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
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
import { useHeroPalette } from '@/components/hero/hero-theme'
import { useStatusBar } from '@/components/save-feedback'
import { savedLookRoute, savedLooksRoute } from '@/src/features/looks/looks-routes'
import { verifiedGuestLookClient, isGuestLookRefusal } from '@/src/lib/guest-look-review'
import { notifyMobileSavedLooksChanged } from '@/src/lib/saved-looks'
import {
  isConsentRejection,
  mobileGuestPreviewStore,
  resolveMobileNextStep,
  verifiedComfortClient,
  type MobileComfortClient,
} from '@/src/lib/guest-preview'
import {
  mobileApplicationUserId,
  resolveMobileAccessToken,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { PreviewButton, previewStyles, type PreviewPalette } from './guest-preview-parts'

type ReviewStatus =
  | { kind: 'loading' }
  | { kind: 'load-failed' | 'look-rejected' }
  | ActiveReview
  | { kind: 'saved' | 'kept' | 'rejected' }

type ActiveReview = {
  kind: 'ready' | 'saving' | 'failed'
  account: SampleComfort
  proposal: SampleComfort
}

type LookReview = {
  intent: GuestLookSaveIntent
  accountStyle: StyleProfileAnswers | null
  styleUnavailable: boolean
  client: Awaited<ReturnType<typeof verifiedGuestLookClient>>
}

async function loadAccountReview(
  verified: MobileComfortClient,
  intent: GuestLookSaveIntent | null
) {
  const client = intent ? await verifiedGuestLookClient(verified.memberId) : null
  const [account, accountStyle] = await Promise.all([
    verified.read(),
    client?.readStyle().catch(() => undefined) ?? null,
  ])
  return {
    account,
    lookReview:
      intent && client
        ? {
            intent,
            accountStyle: accountStyle ?? null,
            styleUnavailable: accountStyle === undefined,
            client,
          }
        : null,
  }
}

async function claimLookSave(
  store: GuestPreviewStore,
  intent: GuestLookSaveIntent,
  isCurrent: () => boolean
) {
  const snapshot = store.snapshot()
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
  palette,
  testID,
  styleRows,
}: {
  heading: string
  values: SampleComfort
  strings: GuestPreviewStrings
  palette: PreviewPalette
  testID: string
  styleRows?: ReturnType<typeof guestLookStyleRows>
}) {
  const v = strings.values
  const rows = [
    [strings.preferences.thermal, v.runsColdWarm[values.runsColdWarm]],
    [strings.preferences.wind, v.windTolerance[values.windTolerance]],
    [strings.preferences.rain, v.precipPreparedness[values.precipPreparedness]],
  ] as const
  return (
    <View
      testID={testID}
      style={{
        borderWidth: 1,
        borderColor: palette.line,
        borderRadius: 12,
        padding: 12,
        gap: 4,
      }}
    >
      <Text style={{ color: palette.ink, fontWeight: '700' }}>{heading}</Text>
      {[...rows, ...(styleRows ?? [])].map(([label, value]) => (
        <Text key={label} style={{ color: palette.ink }}>{`${label}: ${value}`}</Text>
      ))}
    </View>
  )
}

/**
 * D8: who is signed in once session verification settles. Re-verification on an auth
 * event sets the member to null and back, so a mismatch seen mid-flight decides nothing
 * until this answers: 'same', 'other' (a different member or signed out), or 'unknown'
 * when the session cannot be read.
 */
async function settledIdentity(memberId: string): Promise<'same' | 'other' | 'unknown'> {
  try {
    const token = await resolveMobileAccessToken()
    return token && mobileApplicationUserId() === memberId ? 'same' : 'other'
  } catch {
    return 'unknown'
  }
}

export function GuestPreviewReviewScreen() {
  const { t, i18n } = useTranslation()
  const strings = getGuestPreviewStrings(i18n.language)
  const { showNotice } = useStatusBar()
  const palette = useHeroPalette()
  const store = mobileGuestPreviewStore()
  const [status, setStatus] = useState<ReviewStatus>({ kind: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const client = useRef<MobileComfortClient | null>(null)
  const inFlight = useRef(false)
  const garmentIntent = useRef(false)
  const mounted = useRef(true)
  const [lookReview, setLookReview] = useState<LookReview | null>(null)
  const saveChoice = useRef<boolean | null>(null)
  const scopeIsCurrent = useRef<(() => boolean) | null>(null)

  useEffect(() => {
    mounted.current = true
    let active = true
    let isLookReview = false
    const discard = () => {
      client.current = null
      scopeIsCurrent.current = null
      setLookReview(null)
      setStatus({ kind: 'loading' })
      store.clear()
      if (isLookReview) router.dismissTo('/')
      else router.replace('/')
    }
    void (async () => {
      const snapshot = await store.load()
      if (!active) return
      const conversion = snapshot.state?.conversion
      const draft = guestPreviewReviewProposal(snapshot.state)
      isLookReview = Boolean(draft?.intent)
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
        // The member may have changed while the read was in flight.
        if (mobileApplicationUserId() !== verified.memberId) {
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
    const unsubscribe = subscribeMobileApplicationUser(() => {
      if (scopeIsCurrent.current?.() === false) return discard()
      const verified = client.current
      if (!verified || mobileApplicationUserId() === verified.memberId) return
      void settledIdentity(verified.memberId).then((identity) => {
        if (active && client.current === verified && identity === 'other') discard()
      })
    })
    return () => {
      active = false
      mounted.current = false
      unsubscribe()
    }
  }, [store, loadAttempt])

  function cancelLookReview() {
    if (inFlight.current) return
    client.current = null
    scopeIsCurrent.current = null
    setLookReview(null)
    setStatus({ kind: 'loading' })
    store.clear()
    router.dismissTo('/')
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
      if (isGuestLookRefusal(error)) saved = 'rejected'
    } finally {
      inFlight.current = false
    }
    if (!mounted.current || client.current !== verified) return
    if (!lookClient.isCurrent() || saved === null) return cancelLookReview()
    if (saved === 'rejected') {
      setLookReview(null)
      setStatus({ kind: 'look-rejected' })
      return
    }
    if (!saved) {
      setStatus({ kind: 'failed', account, proposal })
      return
    }
    notifyMobileSavedLooksChanged(verified.memberId)
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
            if (lookClient.isCurrent()) router.push(savedLookRoute(saved.id))
          },
        },
      ],
    })
    router.dismissTo(savedLooksRoute())
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
          mobileApplicationUserId() === verified.memberId,
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
    if (outcome.status === 'saved' || outcome.status === 'rejected') {
      store.clear()
      setStatus({ kind: outcome.status })
    } else {
      setStatus({ kind: 'failed', account, proposal })
    }
  }

  return (
    <ScrollView
      testID="guest-preview-review"
      style={[previewStyles.screen, { backgroundColor: palette.page }]}
      contentContainerStyle={previewStyles.content}
    >
      <Text
        accessibilityRole="header"
        style={{ color: palette.ink, fontSize: 24, fontWeight: '700' }}
      >
        {strings.review.heading}
      </Text>
      {status.kind === 'loading' ? (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.inkMuted }}>
          {strings.chrome.checkingSession}
        </Text>
      ) : null}
      {status.kind === 'load-failed' ? (
        <>
          <Text accessibilityRole="alert" style={{ color: palette.ink }}>
            {strings.review.loadFailed}
          </Text>
          <PreviewButton
            label={strings.chrome.retry}
            onPress={() => {
              setStatus({ kind: 'loading' })
              setLoadAttempt((attempt) => attempt + 1)
            }}
            testID="guest-preview-review-retry"
            palette={palette}
            primary
          />
        </>
      ) : null}
      {isActiveReview(status) && (
        <ReviewChoices
          status={status}
          strings={strings}
          locale={i18n.language}
          palette={palette}
          lookReview={lookReview}
          saveChoice={saveChoice.current}
          onUse={() => {
            if (lookReview) void saveLook(status.account, status.proposal, true)
            else void applyProposal(status.account, status.proposal)
          }}
          onKeep={() => {
            if (lookReview) void saveLook(status.account, status.proposal, false)
            else {
              store.clear()
              setStatus({ kind: 'kept' })
            }
          }}
          onCancel={cancelLookReview}
        />
      )}
      {status.kind === 'look-rejected' && (
        <>
          <Text accessibilityRole="alert" style={{ color: palette.dangerInk }}>
            {strings.review.rejected}
          </Text>
          <PreviewButton
            label={strings.review.continue}
            testID="guest-preview-review-rejected-continue"
            onPress={cancelLookReview}
            palette={palette}
            primary
          />
        </>
      )}
      {status.kind === 'saved' || status.kind === 'kept' || status.kind === 'rejected' ? (
        <>
          <Text
            testID="guest-preview-review-result"
            accessibilityLiveRegion="polite"
            style={{ color: palette.ink }}
          >
            {status.kind === 'saved'
              ? strings.review.saved
              : status.kind === 'kept'
                ? strings.review.kept
                : strings.review.rejected}
          </Text>
          <PreviewButton
            label={strings.review.continue}
            onPress={() => {
              const verified = client.current
              if (!verified || mobileApplicationUserId() !== verified.memberId) return
              const next = garmentIntent.current
                ? resolveMobileNextStep(true)
                : resolveMobileNextStep()
              void next.then((destination) => {
                if (mounted.current && mobileApplicationUserId() === verified.memberId)
                  router.replace(destination)
              })
            }}
            testID="guest-preview-review-continue"
            palette={palette}
            primary
          />
        </>
      ) : null}
    </ScrollView>
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
  palette,
}: {
  status: ActiveReview
  strings: GuestPreviewStrings
  locale: string
  lookReview: LookReview | null
  saveChoice: boolean | null
  onUse: () => void
  onKeep: () => void
  onCancel: () => void
  palette: PreviewPalette
}) {
  const labels = reviewActionLabels(
    strings,
    lookReview !== null,
    status.kind === 'saving',
    saveChoice
  )
  return (
    <>
      <ComfortColumn
        heading={strings.review.account}
        values={status.account}
        strings={strings}
        palette={palette}
        testID="guest-preview-review-account"
        styleRows={
          lookReview && !lookReview.styleUnavailable
            ? guestLookStyleRows(lookReview.accountStyle, locale)
            : undefined
        }
      />
      <ComfortColumn
        heading={strings.review.proposed}
        values={status.proposal}
        strings={strings}
        palette={palette}
        testID="guest-preview-review-proposed"
        styleRows={
          lookReview ? guestLookStyleRows(lookReview.intent.style, locale) : undefined
        }
      />
      {lookReview?.styleUnavailable && (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.ink }}>
          {strings.review.loadFailed}
        </Text>
      )}
      {status.kind === 'failed' ? (
        <Text
          testID="guest-preview-review-failed"
          accessibilityRole="alert"
          style={{ color: palette.dangerInk }}
        >
          {lookReview ? strings.firstRun.reviewFailed : strings.review.failed}
        </Text>
      ) : null}
      <PreviewButton
        label={labels.use}
        onPress={onUse}
        testID="guest-preview-review-use"
        palette={palette}
        disabled={
          Boolean(lookReview?.styleUnavailable) ||
          status.kind === 'saving' ||
          saveChoice === false
        }
        primary
      />
      <PreviewButton
        label={labels.keep}
        onPress={onKeep}
        testID="guest-preview-review-keep"
        palette={palette}
        disabled={status.kind === 'saving' || saveChoice === true}
      />
      {lookReview && (
        <PreviewButton
          label={strings.firstRun.cancelReview}
          onPress={onCancel}
          testID="guest-preview-review-cancel"
          palette={palette}
          disabled={status.kind === 'saving'}
        />
      )}
    </>
  )
}

function reviewActionLabels(
  strings: GuestPreviewStrings,
  savingLook: boolean,
  busy: boolean,
  saveChoice: boolean | null
) {
  return {
    use:
      busy && saveChoice !== false
        ? strings.review.saving
        : savingLook
          ? strings.firstRun.saveWithSettings
          : strings.review.use,
    keep:
      busy && saveChoice === false
        ? strings.review.saving
        : savingLook
          ? strings.firstRun.saveOnly
          : strings.review.keep,
  }
}

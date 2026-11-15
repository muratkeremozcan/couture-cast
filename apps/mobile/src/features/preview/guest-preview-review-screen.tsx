// Story 6.16 D8: after a verified sign-in that started in the preview, one review step
// offers the preview's comfort settings. Nothing is written without explicit consent,
// success is shown only after a read-back, and a member change discards the proposal.
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  applyComfortCarryover,
  getGuestPreviewStrings,
  type GuestPreviewStrings,
  type SampleComfort,
} from '@couture/utils'
import { useHeroPalette } from '@/components/hero/hero-theme'
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
  | { kind: 'load-failed' }
  | {
      kind: 'ready' | 'saving' | 'failed'
      account: SampleComfort
      proposal: SampleComfort
    }
  | { kind: 'saved' | 'kept' | 'rejected' }

function ComfortColumn({
  heading,
  values,
  strings,
  palette,
  testID,
}: {
  heading: string
  values: SampleComfort
  strings: GuestPreviewStrings
  palette: PreviewPalette
  testID: string
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
        borderColor: palette.divider,
        borderRadius: 12,
        padding: 12,
        gap: 4,
      }}
    >
      <Text style={{ color: palette.text, fontWeight: '700' }}>{heading}</Text>
      {rows.map(([label, value]) => (
        <Text key={label} style={{ color: palette.text }}>{`${label}: ${value}`}</Text>
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
  const { i18n } = useTranslation()
  const strings = getGuestPreviewStrings(i18n.language)
  const palette = useHeroPalette()
  const store = mobileGuestPreviewStore()
  const [status, setStatus] = useState<ReviewStatus>({ kind: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const client = useRef<MobileComfortClient | null>(null)
  const inFlight = useRef(false)
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
      const proposal = snapshot.state?.conversion ? snapshot.state.comfort : null
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
        // The member may have changed while the read was in flight.
        if (mobileApplicationUserId() !== verified.memberId) {
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
    const unsubscribe = subscribeMobileApplicationUser(() => {
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

  const review =
    status.kind === 'ready' || status.kind === 'saving' || status.kind === 'failed'
  return (
    <ScrollView
      testID="guest-preview-review"
      style={[previewStyles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={previewStyles.content}
    >
      <Text
        accessibilityRole="header"
        style={{ color: palette.text, fontSize: 24, fontWeight: '700' }}
      >
        {strings.review.heading}
      </Text>
      {status.kind === 'loading' ? (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.mutedText }}>
          {strings.chrome.checkingSession}
        </Text>
      ) : null}
      {status.kind === 'load-failed' ? (
        <>
          <Text accessibilityRole="alert" style={{ color: palette.text }}>
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
      {review ? (
        <>
          <ComfortColumn
            heading={strings.review.account}
            values={status.account}
            strings={strings}
            palette={palette}
            testID="guest-preview-review-account"
          />
          <ComfortColumn
            heading={strings.review.proposed}
            values={status.proposal}
            strings={strings}
            palette={palette}
            testID="guest-preview-review-proposed"
          />
          {status.kind === 'failed' ? (
            <Text
              testID="guest-preview-review-failed"
              accessibilityRole="alert"
              style={{ color: palette.danger }}
            >
              {strings.review.failed}
            </Text>
          ) : null}
          <PreviewButton
            label={status.kind === 'saving' ? strings.review.saving : strings.review.use}
            onPress={() => void applyProposal(status.account, status.proposal)}
            testID="guest-preview-review-use"
            palette={palette}
            disabled={status.kind === 'saving'}
            primary
          />
          <PreviewButton
            label={strings.review.keep}
            onPress={() => {
              store.clear()
              setStatus({ kind: 'kept' })
            }}
            testID="guest-preview-review-keep"
            palette={palette}
            disabled={status.kind === 'saving'}
          />
        </>
      ) : null}
      {status.kind === 'saved' || status.kind === 'kept' || status.kind === 'rejected' ? (
        <>
          <Text
            testID="guest-preview-review-result"
            accessibilityLiveRegion="polite"
            style={{ color: palette.text }}
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
              void resolveMobileNextStep().then((next) => router.replace(next))
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

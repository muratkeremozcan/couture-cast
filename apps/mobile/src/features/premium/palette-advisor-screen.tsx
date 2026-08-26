// Story 5.4 Task 8 owner: the mobile colour palette & beauty/accessory advisor screen.
//
// The mobile counterpart of `apps/web/src/app/components/palette-advisor-panel.tsx`,
// with the same state machine, the same `data-testid`/`testID` vocabulary and the same
// four load-bearing rules:
//
// - No English ever reaches the screen from a thrown message. `src/lib/palette-advisor`
//   classifies every failure into a `PaletteAdvisorFailureReason`, and this file maps
//   each member onto a `commerce.premium.palette.*` key or onto a state change.
// - No shade name is hardcoded. Every card renders `t(card.labelKey)` from the server's
//   `ADVISOR_RULES` entry (Decision 6).
// - The sponsored disclosure precedes the control it describes, in reading order.
// - Withdrawing consent is an erase, so it is confirmed inline rather than fired on the
//   first press, and it runs `DELETE` -- the one route that is neither entitlement- nor
//   flag-gated, so a lapsed subscriber can always erase.
//
// It lives under `src/features` rather than `app/` so it stays covered by the component
// test runner, and it deliberately does not render `<Stack.Screen>` itself: that import
// chain pulls in native-only modules the browser-based runner cannot polyfill. The thin
// `app/palette-advisor.tsx` route sets the nav title instead. Same split
// `wardrobe-silhouette-screen.tsx` documents.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { File } from 'expo-file-system'
import type {
  AdvisorRecommendationCard,
  PaletteAdvisorProfile,
  PaletteAnalysisFailureReason,
} from '@couture/api-client/contracts/http'

import { Text, View } from '@/components/themed'
import {
  mintAffiliateClickFromMobile,
  openAffiliatePartnerSite,
} from '@/src/lib/commerce'
import { sha256Hex } from '@/src/lib/expo-native-helpers'
import { randomUuidV4 } from '@/src/lib/uuid'
import {
  analyzeWardrobePaletteFromMobile,
  erasePaletteAdvisorFromMobile,
  getPaletteAdvisorFromMobile,
  paletteAdvisorFailureReason,
  setPaletteConsentFromMobile,
  updateAdvisorRecommendationFromMobile,
  uploadPaletteSelfieFromMobile,
  type PaletteSelfieUploadState,
} from '@/src/lib/palette-advisor'

type ScreenState = 'loading' | 'signed_out' | 'ready' | 'load_failed'

type BusyKind = null | 'consent' | 'erase' | 'wardrobe' | 'selfie' | 'recommendation'

type LastDismissal = { itemKey: string; slot: AdvisorRecommendationCard['slot'] }

/**
 * Exhaustive over the contract enum on purpose: a failure reason added to
 * `paletteAnalysisFailureReasonSchema` fails to typecheck here until it has copy.
 */
const FAILURE_KEYS: Record<PaletteAnalysisFailureReason, string> = {
  no_face: 'commerce.premium.palette.failure.noFace',
  low_quality: 'commerce.premium.palette.failure.lowQuality',
  privacy_violation: 'commerce.premium.palette.failure.privacyViolation',
  insufficient_wardrobe: 'commerce.premium.palette.failure.insufficientWardrobe',
  timeout: 'commerce.premium.palette.failure.timeout',
  storage_error: 'commerce.premium.palette.failure.storageError',
}

/**
 * The largest edge the selfie is re-encoded to before upload.
 *
 * The contract caps a declared dimension at 4096, and the server's analysis resizes to
 * 256x256 anyway, so anything larger is bytes spent on a connection for pixels that are
 * discarded. 1536 keeps the face well above the server's sampling grid.
 */
const MAX_SELFIE_EDGE = 1536

/** The floor `createPaletteSelfieUploadUrlInputSchema` enforces on both dimensions. */
const MIN_SELFIE_EDGE = 256

/** The status key for the current analysis, or null when there is nothing to say. */
function statusKey(
  profile: PaletteAdvisorProfile | null,
  uploadState: PaletteSelfieUploadState | null
): string | null {
  if (uploadState !== null) {
    return uploadState === 'committing'
      ? 'commerce.premium.palette.status.processing'
      : 'commerce.premium.palette.status.uploading'
  }
  const analysis = profile?.analysis ?? null
  if (!analysis) {
    return 'commerce.premium.palette.status.idle'
  }
  switch (analysis.status) {
    case 'pending_upload':
    case 'bytes_uploaded':
      return 'commerce.premium.palette.status.uploading'
    case 'processing':
      return 'commerce.premium.palette.status.processing'
    case 'ready':
      return 'commerce.premium.palette.status.ready'
    case 'failed':
      return 'commerce.premium.palette.status.failed'
  }
}

function LockedPanel({ isSignedOut }: { isSignedOut: boolean }) {
  const { t } = useTranslation()

  return (
    <View style={styles.panel} testID="palette-advisor-locked">
      <Text style={styles.panelTitle}>{t('commerce.premium.palette.locked.title')}</Text>
      <Text style={styles.body}>
        {t(
          isSignedOut
            ? 'commerce.premium.palette.locked.signedOutBody'
            : 'commerce.premium.palette.locked.body'
        )}
      </Text>
    </View>
  )
}

function RecommendationCardView({
  card,
  isBusy,
  onSave,
  onDismiss,
  onUndoSave,
  onSponsoredActivate,
  sponsoredError,
}: {
  card: AdvisorRecommendationCard
  isBusy: boolean
  onSave: () => void
  onDismiss: () => void
  onUndoSave: () => void
  onSponsoredActivate: () => void
  sponsoredError: string | null
}) {
  const { t } = useTranslation()

  return (
    <View style={styles.card} testID={`palette-advisor-card-${card.itemKey}`}>
      <Text style={styles.slotLabel}>
        {t(`commerce.premium.palette.slot.${card.slot}`)}
      </Text>
      <View style={styles.shadeRow}>
        {/*
          The one literal colour on this screen, and it is a colour rather than copy:
          `swatchHex` comes from the server's ADVISOR_RULES entry and is pinned against
          `ADVISOR_SWATCH_CARD_BACKGROUND` at SC 1.4.11's 3:1 non-text floor by the
          contract's own test. It carries no information the label does not, so the
          shade is never conveyed by colour alone.
        */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.swatch, { backgroundColor: card.swatchHex }]}
          testID={`palette-advisor-swatch-${card.itemKey}`}
        />
        <Text style={styles.shadeName} testID={`palette-advisor-label-${card.itemKey}`}>
          {t(card.labelKey)}
        </Text>
      </View>

      {card.sponsored ? (
        <View
          style={styles.sponsored}
          testID={`palette-advisor-sponsored-${card.itemKey}`}
        >
          {/*
            AC 6: the disclosure comes BEFORE the control it describes, in reading
            order, as its own text node. Not an accessibility hint on the button.
          */}
          <Text
            style={styles.disclosure}
            testID={`palette-advisor-sponsored-disclosure-${card.itemKey}`}
          >
            {t('commerce.premium.palette.sponsored.disclosure')}
          </Text>
          <Text style={styles.partnerLabel}>
            {t('commerce.premium.palette.sponsored.partnerLabel', {
              partner: card.sponsored.partnerDisplayName,
            })}
          </Text>
          <Text style={styles.offerTitle}>{card.sponsored.offerTitle}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('commerce.premium.palette.sponsored.cta')}
            style={styles.ctaButton}
            testID={`palette-advisor-sponsored-cta-${card.itemKey}`}
            onPress={onSponsoredActivate}
          >
            <Text style={styles.ctaButtonText}>
              {t('commerce.premium.palette.sponsored.cta')}
            </Text>
          </Pressable>
          {sponsoredError ? (
            <Text
              accessibilityRole="alert"
              style={styles.errorText}
              testID={`palette-advisor-sponsored-error-${card.itemKey}`}
            >
              {sponsoredError}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {card.saved ? (
          <>
            <Text
              style={styles.savedLabel}
              testID={`palette-advisor-saved-${card.itemKey}`}
            >
              {t('commerce.premium.palette.actions.saved')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isBusy }}
              disabled={isBusy}
              style={styles.secondaryButton}
              testID={`palette-advisor-unsave-${card.itemKey}`}
              onPress={onUndoSave}
            >
              <Text style={styles.secondaryButtonText}>
                {t('commerce.premium.palette.actions.undo')}
              </Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isBusy }}
            disabled={isBusy}
            style={styles.secondaryButton}
            testID={`palette-advisor-save-${card.itemKey}`}
            onPress={onSave}
          >
            <Text style={styles.secondaryButtonText}>
              {t('commerce.premium.palette.actions.save')}
            </Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isBusy }}
          disabled={isBusy}
          style={styles.secondaryButton}
          testID={`palette-advisor-dismiss-${card.itemKey}`}
          onPress={onDismiss}
        >
          <Text style={styles.secondaryButtonText}>
            {t('commerce.premium.palette.actions.dismiss')}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

/**
 * The consent gate, extracted from `PaletteAdvisorScreen` rather than inlined.
 *
 * Not a style choice: the screen is a state machine with five async writes and
 * as many render branches, and holding these blocks inline pushed its
 * cyclomatic complexity far past the repository's ceiling of 15. The split
 * follows the boundaries the ACs already draw -- consent (AC 1), sources
 * (AC 2/3), results and cards (AC 4/5/6) -- and leaves the screen owning state
 * transitions only. Same shape as the web panel's own split.
 */
function ConsentBlock({
  hasConsent,
  isBusy,
  isAnalysisEnabled,
  showUnavailable,
  confirmingErase,
  onGrant,
  onStartErase,
  onCancelErase,
  onConfirmErase,
}: {
  hasConsent: boolean
  isBusy: boolean
  isAnalysisEnabled: boolean
  showUnavailable: boolean
  confirmingErase: boolean
  onGrant: () => void
  onStartErase: () => void
  onCancelErase: () => void
  onConfirmErase: () => void
}) {
  const { t } = useTranslation()

  return (
    <View style={styles.panel} testID="palette-advisor-consent">
      <Text style={styles.panelTitle}>{t('commerce.premium.palette.consent.title')}</Text>
      {/*
        The consent explanation comes before the control it gates, in reading
        order -- the same rule AC 6 states for the sponsored disclosure, applied to
        the consent itself.
      */}
      <Text style={styles.body} testID="palette-advisor-consent-body">
        {t('commerce.premium.palette.consent.body')}
      </Text>

      {hasConsent ? (
        <>
          <Text style={styles.savedLabel} testID="palette-advisor-consent-granted">
            {t('commerce.premium.palette.consent.granted')}
          </Text>
          {confirmingErase ? (
            <View testID="palette-advisor-erase-confirm">
              <Text style={styles.body}>
                {t('commerce.premium.palette.deleteConfirm')}
              </Text>
              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isBusy }}
                  disabled={isBusy}
                  style={styles.dangerButton}
                  testID="palette-advisor-erase-confirm-yes"
                  onPress={onConfirmErase}
                >
                  <Text style={styles.dangerButtonText}>
                    {t('commerce.premium.palette.consent.revoke')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={styles.secondaryButton}
                  testID="palette-advisor-erase-confirm-no"
                  onPress={onCancelErase}
                >
                  <Text style={styles.secondaryButtonText}>
                    {t('commerce.premium.palette.actions.undo')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isBusy }}
              disabled={isBusy}
              style={styles.secondaryButton}
              testID="palette-advisor-consent-revoke"
              onPress={onStartErase}
            >
              <Text style={styles.secondaryButtonText}>
                {t('commerce.premium.palette.consent.revoke')}
              </Text>
            </Pressable>
          )}
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityHint={
            showUnavailable ? t('commerce.premium.palette.unavailable') : undefined
          }
          accessibilityState={{
            disabled: isBusy || !isAnalysisEnabled,
          }}
          disabled={isBusy || !isAnalysisEnabled}
          style={styles.primaryButton}
          testID="palette-advisor-consent-grant"
          onPress={onGrant}
        >
          <Text style={styles.primaryButtonText}>
            {t('commerce.premium.palette.consent.grant')}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

/** The two derivation sources. Both disabled while the kill switch is off. */
function SourceChoice({
  isBusy,
  isAnalysisEnabled,
  onAnalyzeWardrobe,
  onChooseSelfie,
}: {
  isBusy: boolean
  isAnalysisEnabled: boolean
  onAnalyzeWardrobe: () => void
  onChooseSelfie: () => void
}) {
  const { t } = useTranslation()

  return (
    <View style={styles.panel} testID="palette-advisor-sources">
      <Text style={styles.body} testID="palette-advisor-wardrobe-hint">
        {t('commerce.premium.palette.source.wardrobeHint')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          disabled: isBusy || !isAnalysisEnabled,
        }}
        disabled={isBusy || !isAnalysisEnabled}
        style={styles.secondaryButton}
        testID="palette-advisor-source-wardrobe"
        onPress={onAnalyzeWardrobe}
      >
        <Text style={styles.secondaryButtonText}>
          {t('commerce.premium.palette.source.wardrobe')}
        </Text>
      </Pressable>

      <Text style={styles.body} testID="palette-advisor-selfie-hint">
        {t('commerce.premium.palette.source.selfieHint')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          disabled: isBusy || !isAnalysisEnabled,
        }}
        disabled={isBusy || !isAnalysisEnabled}
        style={styles.secondaryButton}
        testID="palette-advisor-source-selfie"
        onPress={onChooseSelfie}
      >
        <Text style={styles.secondaryButtonText}>
          {t('commerce.premium.palette.source.selfie')}
        </Text>
      </Pressable>
    </View>
  )
}

/**
 * The derived palette, the depth-less note, the undo affordance and the cards.
 *
 * The `depth === null` branch is AC 4's whole point: a wardrobe-sourced palette
 * yields undertone-family foundation guidance rather than a shade match, and
 * the copy says why instead of hiding the difference.
 */
function PaletteResult({
  undertone,
  depth,
  confidenceLabel,
  isBusy,
  showDismissedNotice,
  recommendations,
  sponsoredErrorItemKey,
  onUndoDismiss,
  onRecommendation,
  onSponsoredActivate,
}: {
  undertone: string
  depth: string | null
  confidenceLabel: string | null
  isBusy: boolean
  showDismissedNotice: boolean
  recommendations: readonly AdvisorRecommendationCard[]
  sponsoredErrorItemKey: string | null
  onUndoDismiss: () => void
  onRecommendation: (
    card: AdvisorRecommendationCard,
    action: 'saved' | 'dismissed' | null
  ) => void
  onSponsoredActivate: (card: AdvisorRecommendationCard) => void
}) {
  const { t } = useTranslation()

  return (
    <>
      <View style={styles.panel} testID="palette-advisor-result">
        <Text style={styles.body}>
          {`${t('commerce.premium.palette.result.undertone')}: `}
          <Text style={styles.savedLabel} testID="palette-advisor-undertone">
            {t(`commerce.premium.palette.undertone.${undertone}`)}
          </Text>
        </Text>
        <Text style={styles.body}>
          {`${t('commerce.premium.palette.result.depth')}: `}
          <Text style={styles.savedLabel} testID="palette-advisor-depth">
            {depth
              ? t(`commerce.premium.palette.depth.${depth}`)
              : t('commerce.premium.palette.result.depthUnknown')}
          </Text>
        </Text>
        <Text style={styles.body}>
          {`${t('commerce.premium.palette.result.confidence')}: `}
          <Text style={styles.savedLabel} testID="palette-advisor-confidence">
            {confidenceLabel}
          </Text>
        </Text>
      </View>

      {/*
        AC 4: a wardrobe-sourced palette carries no depth, so foundation is family
        guidance rather than a shade match, and the copy says so.
      */}
      {depth === null ? (
        <Text style={styles.body} testID="palette-advisor-foundation-depth-unknown">
          {t('commerce.premium.palette.foundationDepthUnknown')}
        </Text>
      ) : null}

      {showDismissedNotice ? (
        <View style={styles.actionRow} testID="palette-advisor-dismissed-notice">
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {t('commerce.premium.palette.actions.dismissed')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isBusy }}
            disabled={isBusy}
            style={styles.secondaryButton}
            testID="palette-advisor-undo-dismiss"
            onPress={onUndoDismiss}
          >
            <Text style={styles.secondaryButtonText}>
              {t('commerce.premium.palette.actions.undo')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View testID="palette-advisor-recommendations">
        {recommendations.map((card) => (
          <RecommendationCardView
            key={card.itemKey}
            card={card}
            isBusy={isBusy}
            onSave={() => onRecommendation(card, 'saved')}
            onDismiss={() => onRecommendation(card, 'dismissed')}
            onUndoSave={() => onRecommendation(card, null)}
            onSponsoredActivate={() => onSponsoredActivate(card)}
            sponsoredError={
              sponsoredErrorItemKey === card.itemKey
                ? t('commerce.premium.palette.saveError')
                : null
            }
          />
        ))}
      </View>
    </>
  )
}

/**
 * Asks for library access and returns the chosen asset, or null when the reader
 * backs out.
 *
 * Reuses the permission shape `wardrobe-onboarding-screen.tsx` established: ask,
 * and let the picker itself report a denial rather than pre-empting it. No new
 * media dependency -- `expo-image-picker` is already here, and
 * `expo-face-detector` is deliberately absent (Decision 3: there is no face
 * detector, only a skin-chroma gate on the server).
 */
async function pickSelfieAsset(): Promise<ImagePicker.ImagePickerAsset | null> {
  await ImagePicker.requestMediaLibraryPermissionsAsync()
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 1,
  })
  return picked.canceled ? null : (picked.assets[0] ?? null)
}

/**
 * Re-encodes the picked asset to the bytes the allocate call declares.
 *
 * Always re-encoded, and to PNG rather than JPEG. Re-encoded because the
 * allocate call declares a MIME type the server re-decodes and checks, and the
 * OS hands back whatever the camera captured. PNG because the server classifies
 * undertone from Cb/Cr chroma (Decision 3), and JPEG's 4:2:0 chroma subsampling
 * throws away exactly the two channels the classification reads. The silhouette
 * editor re-encodes to PNG too, for a weaker reason.
 */
async function prepareSelfieBytes(asset: ImagePicker.ImagePickerAsset): Promise<{
  bytes: Uint8Array<ArrayBuffer>
  mimeType: 'image/png'
  widthPx: number
  heightPx: number
  sha256: string
}> {
  const scale = Math.min(1, MAX_SELFIE_EDGE / Math.max(asset.width, asset.height))
  const widthPx = Math.round(asset.width * scale)
  const heightPx = Math.round(asset.height * scale)
  if (widthPx < MIN_SELFIE_EDGE || heightPx < MIN_SELFIE_EDGE) {
    throw new Error('SELFIE_TOO_SMALL')
  }

  const prepared = await manipulateAsync(
    asset.uri,
    [{ resize: { width: widthPx, height: heightPx } }],
    { compress: 1, format: SaveFormat.PNG }
  )
  const bytes = await new File(prepared.uri).bytes()

  return {
    bytes,
    mimeType: 'image/png',
    widthPx: prepared.width,
    heightPx: prepared.height,
    sha256: await sha256Hex(bytes),
  }
}

/**
 * The confidence, as the reader's own language writes a percentage.
 *
 * `Intl.NumberFormat` rather than a hand-built `${x * 100}%`: the percent sign
 * is spaced in French and precedes the number in Turkish, and the decimal
 * separator differs across the ten catalogs. Hermes ships `Intl.NumberFormat`
 * (unlike `Intl.ListFormat`, whose absence took the settings screen down in
 * story 5.3), so this is safe on device.
 */
function formatConfidence(confidence: number, language: string): string {
  return new Intl.NumberFormat(language, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(confidence)
}

/**
 * The live status line and, when an analysis terminated badly, why.
 *
 * The failure copy is looked up from `FAILURE_KEYS`, which is exhaustive over
 * the contract enum, so a reason added to
 * `paletteAnalysisFailureReasonSchema` fails to typecheck until it has copy in
 * all ten catalogs. The server's own message never reaches this element.
 */
function AnalysisStatus({
  statusKey,
  failureReason,
}: {
  statusKey: string | null
  failureReason: PaletteAnalysisFailureReason | null
}) {
  const { t } = useTranslation()

  return (
    <>
      {statusKey ? (
        <Text
          accessibilityLiveRegion="polite"
          style={styles.body}
          testID="palette-advisor-status"
        >
          {t(statusKey)}
        </Text>
      ) : null}

      {failureReason ? (
        <Text
          accessibilityRole="alert"
          style={styles.errorText}
          testID="palette-advisor-failure"
        >
          {t(FAILURE_KEYS[failureReason])}
        </Text>
      ) : null}
    </>
  )
}

/**
 * Everything the render pass needs, resolved once.
 *
 * Extracted from the component body for the same reason the JSX blocks were: a
 * dozen optional chains and boolean joins inline pushed `PaletteAdvisorScreen`
 * past the repository's complexity ceiling. It also puts the entitlement rule
 * in one readable place. Entitlement reaches this screen only as the
 * server-resolved `isEntitled` on the advisor response, so the client never
 * combines two endpoints and never has two moments in time to disagree about.
 *
 * `load_failed` deliberately renders neither the advisor nor the locked panel:
 * a read that failed tells us nothing about entitlement, and showing a
 * subscriber an upsell for something they already pay for would be worse than
 * showing the error alone.
 */
function resolveScreenView(
  screenState: ScreenState,
  profile: PaletteAdvisorProfile | null
): {
  analysis: PaletteAdvisorProfile['analysis']
  isEntitled: boolean
  isAnalysisEnabled: boolean
  hasConsent: boolean
  showLocked: boolean
  showUnavailable: boolean
  showSources: boolean
  recommendations: PaletteAdvisorProfile['recommendations']
} {
  const isEntitled = screenState === 'ready' && profile?.isEntitled === true
  const isAnalysisEnabled = profile?.analysisEnabled !== false
  const hasConsent = profile?.hasConsent === true

  return {
    analysis: profile?.analysis ?? null,
    isEntitled,
    isAnalysisEnabled,
    hasConsent,
    showLocked: screenState === 'signed_out' || (profile !== null && !isEntitled),
    showUnavailable: isEntitled && !isAnalysisEnabled,
    showSources: isEntitled && hasConsent,
    recommendations: profile?.recommendations ?? [],
  }
}

export function PaletteAdvisorScreen() {
  const { t, i18n } = useTranslation()
  const [screenState, setScreenState] = useState<ScreenState>('loading')
  const [profile, setProfile] = useState<PaletteAdvisorProfile | null>(null)
  const [busy, setBusy] = useState<BusyKind>(null)
  const [uploadState, setUploadState] = useState<PaletteSelfieUploadState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sponsoredErrorItemKey, setSponsoredErrorItemKey] = useState<string | null>(null)
  const [confirmingErase, setConfirmingErase] = useState(false)
  const [lastDismissal, setLastDismissal] = useState<LastDismissal | null>(null)

  const writeControllerRef = useRef<AbortController | null>(null)
  useEffect(() => () => writeControllerRef.current?.abort(), [])

  const loadErrorMessage = t('commerce.premium.palette.loadError')

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      try {
        const next = await getPaletteAdvisorFromMobile(controller.signal)
        if (controller.signal.aborted) return
        setProfile(next)
        setScreenState('ready')
      } catch (loadError: unknown) {
        if (controller.signal.aborted) return
        if (paletteAdvisorFailureReason(loadError) === 'signed_out') {
          setScreenState('signed_out')
          return
        }
        setError(loadErrorMessage)
        setScreenState('load_failed')
      }
    })()

    return () => controller.abort()
  }, [loadErrorMessage])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await getPaletteAdvisorFromMobile()
      setProfile(next)
      setScreenState('ready')
    } catch {
      // A failed refresh leaves the last known state on screen rather than blanking a
      // screen the reader is mid-interaction with.
    }
  }, [])

  /**
   * A rejected write re-resolves the screen, it does not just print a line.
   *
   * Entitlement can lapse, consent can be revoked from the web surface and the kill
   * switch can flip while this screen is open. Folding the rejection back into
   * `profile` renders the localized explanation the catalogs already carry.
   */
  const applyWriteFailure = useCallback(
    (writeError: unknown, fallbackKey: string): void => {
      switch (paletteAdvisorFailureReason(writeError)) {
        case 'signed_out':
          setProfile(null)
          setScreenState('signed_out')
          return
        case 'not_entitled':
          setProfile((current) =>
            current === null ? null : { ...current, isEntitled: false }
          )
          return
        case 'no_consent':
          setProfile((current) =>
            current === null ? null : { ...current, hasConsent: false }
          )
          return
        case 'analysis_disabled':
          setProfile((current) =>
            current === null ? null : { ...current, analysisEnabled: false }
          )
          return
        case 'in_progress':
          void refresh()
          return
        default:
          setError(t(fallbackKey))
      }
    },
    [refresh, t]
  )

  const runWrite = useCallback(
    async (
      kind: Exclude<BusyKind, null>,
      fallbackKey: string,
      write: (signal: AbortSignal) => Promise<PaletteAdvisorProfile>
    ): Promise<void> => {
      if (busy !== null) return

      const controller = new AbortController()
      writeControllerRef.current = controller
      setBusy(kind)
      setError(null)

      try {
        const next = await write(controller.signal)
        if (controller.signal.aborted) return
        setProfile(next)
        setScreenState('ready')
      } catch (writeError: unknown) {
        if (controller.signal.aborted) return
        applyWriteFailure(writeError, fallbackKey)
      } finally {
        if (writeControllerRef.current === controller) {
          writeControllerRef.current = null
        }
        if (!controller.signal.aborted) {
          setBusy(null)
          setUploadState(null)
        }
      }
    },
    [applyWriteFailure, busy]
  )

  function handleGrantConsent(): void {
    void runWrite('consent', 'commerce.premium.palette.saveError', (signal) =>
      setPaletteConsentFromMobile(true, signal)
    )
  }

  /**
   * Withdrawal runs `DELETE`, not `POST /consent { granted: false }`.
   *
   * The two do the same thing server-side, but the consent route mounts
   * `PremiumEntitlementGuard` and checks the kill switch while `DELETE` deliberately
   * does neither. Routing withdrawal through the guarded one would mean a reader whose
   * subscription lapsed could no longer erase data the app still holds about their face
   * (Decision 9).
   */
  function handleConfirmErase(): void {
    setConfirmingErase(false)
    setLastDismissal(null)
    void runWrite('erase', 'commerce.premium.palette.saveError', (signal) =>
      erasePaletteAdvisorFromMobile(signal)
    )
  }

  function handleAnalyzeWardrobe(): void {
    setLastDismissal(null)
    void runWrite('wardrobe', 'commerce.premium.palette.saveError', (signal) =>
      analyzeWardrobePaletteFromMobile(signal)
    )
  }

  /**
   * Reuses the permission shape `wardrobe-onboarding-screen.tsx` established: ask for
   * both, and let the picker itself report a denial rather than pre-empting it. No new
   * media dependency -- `expo-image-picker` is already here, and `expo-face-detector`
   * is deliberately absent (Decision 3: there is no face detector, only a skin-chroma
   * gate on the server).
   */
  async function handleChooseSelfie(): Promise<void> {
    if (busy !== null) return

    const asset = await pickSelfieAsset()
    if (!asset) return

    setLastDismissal(null)
    const idempotencyKey = randomUuidV4()

    void runWrite('selfie', 'commerce.premium.palette.saveError', async (signal) => {
      const prepared = await prepareSelfieBytes(asset)
      return uploadPaletteSelfieFromMobile({
        ...prepared,
        idempotencyKey,
        signal,
        onStateChange: setUploadState,
      })
    })
  }

  function handleRecommendation(
    card: AdvisorRecommendationCard,
    action: 'saved' | 'dismissed' | null
  ): void {
    if (action === 'dismissed') {
      setLastDismissal({ itemKey: card.itemKey, slot: card.slot })
    }
    void runWrite('recommendation', 'commerce.premium.palette.saveError', (signal) =>
      updateAdvisorRecommendationFromMobile(
        { itemKey: card.itemKey, slot: card.slot, action },
        signal
      )
    )
  }

  function handleUndoDismiss(): void {
    const dismissal = lastDismissal
    if (!dismissal) return
    setLastDismissal(null)
    void runWrite('recommendation', 'commerce.premium.palette.saveError', (signal) =>
      updateAdvisorRecommendationFromMobile(
        { itemKey: dismissal.itemKey, slot: dismissal.slot, action: null },
        signal
      )
    )
  }

  async function handleSponsoredActivate(card: AdvisorRecommendationCard): Promise<void> {
    const sponsored = card.sponsored
    const profileId = profile?.profileId ?? null
    if (!sponsored || !profileId) return

    setSponsoredErrorItemKey(null)
    try {
      const redirectUrl = await mintAffiliateClickFromMobile({
        offerId: sponsored.offerId,
        // Decision 7: the advisor's `recommendationId` is the PaletteProfile id. The
        // server re-resolves it from the session and does not trust this value.
        recommendationId: profileId,
        surface: 'palette_advisor',
        platform: 'mobile',
      })
      // Only navigate once the click is attributed: traffic the partner cannot
      // attribute is worth nothing to them and cannot be audited by us.
      await openAffiliatePartnerSite(redirectUrl)
    } catch {
      setSponsoredErrorItemKey(card.itemKey)
    }
  }

  const view = resolveScreenView(screenState, profile)
  const { analysis, isEntitled, showLocked, showUnavailable, showSources } = view
  const currentStatusKey = showSources ? statusKey(profile, uploadState) : null
  const confidenceLabel =
    analysis?.status === 'ready'
      ? formatConfidence(analysis.confidence, i18n.language)
      : null

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      testID="palette-advisor-screen"
      accessibilityLabel={t('commerce.premium.palette.sectionTitle')}
    >
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="palette-advisor-title"
      >
        {t('commerce.premium.palette.sectionTitle')}
      </Text>
      <Text style={styles.body} testID="palette-advisor-intro">
        {t('commerce.premium.palette.intro')}
      </Text>

      {screenState === 'loading' ? (
        <ActivityIndicator
          accessibilityLabel={t('commerce.premium.palette.sectionTitle')}
          testID="palette-advisor-loading"
        />
      ) : null}

      {showUnavailable ? (
        <Text style={styles.body} testID="palette-advisor-unavailable">
          {t('commerce.premium.palette.unavailable')}
        </Text>
      ) : null}

      {isEntitled ? (
        <ConsentBlock
          hasConsent={view.hasConsent}
          isBusy={busy !== null}
          isAnalysisEnabled={view.isAnalysisEnabled}
          showUnavailable={showUnavailable}
          confirmingErase={confirmingErase}
          onGrant={handleGrantConsent}
          onStartErase={() => setConfirmingErase(true)}
          onCancelErase={() => setConfirmingErase(false)}
          onConfirmErase={handleConfirmErase}
        />
      ) : null}

      {showSources ? (
        <SourceChoice
          isBusy={busy !== null}
          isAnalysisEnabled={view.isAnalysisEnabled}
          onAnalyzeWardrobe={handleAnalyzeWardrobe}
          onChooseSelfie={() => {
            void handleChooseSelfie()
          }}
        />
      ) : null}

      <AnalysisStatus
        statusKey={currentStatusKey}
        failureReason={
          showSources && analysis?.status === 'failed' ? analysis.failureReason : null
        }
      />

      {showSources && analysis?.status === 'ready' ? (
        <PaletteResult
          undertone={analysis.undertone}
          depth={analysis.depth}
          confidenceLabel={confidenceLabel}
          isBusy={busy !== null}
          showDismissedNotice={lastDismissal !== null}
          recommendations={view.recommendations}
          sponsoredErrorItemKey={sponsoredErrorItemKey}
          onUndoDismiss={handleUndoDismiss}
          onRecommendation={handleRecommendation}
          onSponsoredActivate={(card) => {
            void handleSponsoredActivate(card)
          }}
        />
      ) : null}

      {showLocked ? <LockedPanel isSignedOut={screenState === 'signed_out'} /> : null}

      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.errorText}
          testID="palette-advisor-error"
        >
          {error}
        </Text>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: '600' },
  panel: { gap: 8, paddingVertical: 8 },
  panelTitle: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 20 },
  card: { gap: 8, paddingVertical: 12 },
  slotLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  shadeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 20, height: 20, borderRadius: 10 },
  shadeName: { fontSize: 16, fontWeight: '600' },
  sponsored: { gap: 6, paddingVertical: 8 },
  disclosure: { fontSize: 12, lineHeight: 18 },
  partnerLabel: { fontSize: 12 },
  offerTitle: { fontSize: 14, fontWeight: '600' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  savedLabel: { fontSize: 14, fontWeight: '600' },
  primaryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  primaryButtonText: { fontSize: 14, fontWeight: '600' },
  secondaryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  secondaryButtonText: { fontSize: 14 },
  dangerButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  dangerButtonText: { fontSize: 14, fontWeight: '600' },
  ctaButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  ctaButtonText: { fontSize: 14, fontWeight: '600' },
  errorText: { fontSize: 14 },
})

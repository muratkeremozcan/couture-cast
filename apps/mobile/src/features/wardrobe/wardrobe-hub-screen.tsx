// Story 4.1/4.2 owner (original), Story 4.4 Task 6 owner (this file's move +
// onboarding entry-point card): the mobile wardrobe hub. Moved here, out of
// app/(tabs)/wardrobe.tsx, so it's covered by the component test runner (see
// wardrobe-silhouette-screen.tsx for why app/ route files stay thin
// wrappers); apps/mobile/app/(tabs)/wardrobe.tsx now just re-exports this.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ElementRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet } from 'react-native'
import type { GarmentItemContract } from '@couture/api-client/contracts/http'
import {
  getGuestPreviewStrings,
  getStylePieceStrings,
  nextStylePiecePhotoExpiry,
  scheduleStylePiecePhotoExpiry,
  type StylePieceSelection,
} from '@couture/utils'

import { underModalAccessibility } from '@/components/edge-to-edge-modal'
import { Text, View, useSchemeColors } from '@/components/themed'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { safeFindNodeHandle } from '@/src/lib/expo-native-helpers'
import { notifyWardrobeChanged } from '@/src/lib/wardrobe-changes'

import { MobileGarmentCaptureModal } from '@/components/wardrobe/garment-capture-modal'
import { MobileGarmentTaggingModal } from '@/components/wardrobe/garment-tagging-modal'
import {
  getWardrobeOnboardingStateFromMobile,
  listGarmentsFromMobile,
  pollGarmentUntilSettled,
} from '@/src/lib/wardrobe'
import {
  focusStylePieceControl,
  StylePieceEntry,
  StylePiecePanel,
} from './style-piece-panel'

export interface WardrobeHubScreenProps {
  addEntry?: boolean
  /** Test-only override for the still-processing garment poll cadence. */
  pollOffsetsMs?: readonly number[]
}

export function WardrobeHubScreen(props: WardrobeHubScreenProps = {}) {
  const epoch = useSyncExternalStore(subscribeMobileApplicationUser, mobileIdentityEpoch)
  return <MemberWardrobeHub key={epoch} epoch={epoch} {...props} />
}

function MemberWardrobeHub({
  pollOffsetsMs,
  addEntry,
  epoch,
}: WardrobeHubScreenProps & { epoch: number }) {
  const { t, i18n } = useTranslation()
  const strings = getGuestPreviewStrings(i18n.language)
  const colors = useSchemeColors()
  const secondaryButton = [styles.secondaryButton, { borderColor: colors.strongBorder }]
  const secondaryButtonText = [styles.secondaryButtonText, { color: colors.text }]
  const notice = {
    backgroundColor: colors.noticeSurface,
    borderColor: colors.noticeBorder,
  }
  const [garments, setGarments] = useState<GarmentItemContract[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [confirmedGarment, setConfirmedGarment] = useState(false)
  const [isCaptureOpen, setIsCaptureOpen] = useState(false)
  const [taggingGarmentId, setTaggingGarmentId] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState<string>('')
  const [taggingInvokerNodeHandle, setTaggingInvokerNodeHandle] = useState<number | null>(
    null
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showOnboardingCard, setShowOnboardingCard] = useState(false)
  const [styleSelection, setStyleSelection] = useState<StylePieceSelection | null>(null)
  const [styleClosing, setStyleClosing] = useState(false)
  const styleSelectionRef = useRef<StylePieceSelection | null>(null)
  const taggingOpen = useRef(false)
  const styleLabels = getStylePieceStrings(i18n.language)
  const owner = mobileApplicationUserId()
  const [, updatePhotoClock] = useState(0)
  const photoExpiry = nextStylePiecePhotoExpiry(garments, Date.now())
  useEffect(
    () =>
      scheduleStylePiecePhotoExpiry(photoExpiry, () =>
        updatePhotoClock((clock) => clock + 1)
      ),
    [photoExpiry]
  )
  const styleButtons = useRef(new Map<string, ElementRef<typeof Pressable>>())
  const pollingAbortRef = useRef<AbortController | null>(null)
  const pendingTagging = useRef<{ id: string; invoker?: number | null } | null>(null)
  const isCaptureOpenRef = useRef(false)
  const addGarmentButtonRef = useRef<ElementRef<typeof Pressable> | null>(null)
  const directEntryConsumed = useRef(false)

  const presentTagging = (id: string, invoker?: number | null) => {
    if (epoch !== mobileIdentityEpoch()) return
    if (styleSelectionRef.current || isCaptureOpenRef.current) {
      pendingTagging.current = { id, invoker }
      return
    }
    taggingOpen.current = true
    setTaggingInvokerNodeHandle(
      invoker ?? safeFindNodeHandle(addGarmentButtonRef.current)
    )
    setTaggingGarmentId(id)
  }

  const closeTagging = () => {
    taggingOpen.current = false
    setTaggingGarmentId(null)
  }

  const openStylePanel = (selection: StylePieceSelection) => {
    if (taggingOpen.current || isCaptureOpenRef.current || styleSelectionRef.current)
      return
    styleSelectionRef.current = selection
    setStyleSelection(selection)
  }

  const finishStyleDismissal = (selection: StylePieceSelection) => {
    if (epoch !== mobileIdentityEpoch() || styleSelectionRef.current !== selection) return
    const invoker = styleButtons.current.get(selection.id) ?? addGarmentButtonRef.current
    styleSelectionRef.current = null
    setStyleSelection(null)
    setStyleClosing(false)
    const pending = pendingTagging.current
    pendingTagging.current = null
    if (pending) {
      presentTagging(pending.id, pending.invoker ?? safeFindNodeHandle(invoker))
      return
    }
    requestAnimationFrame(() => {
      if (
        epoch === mobileIdentityEpoch() &&
        !styleSelectionRef.current &&
        !taggingOpen.current &&
        !isCaptureOpenRef.current
      )
        focusStylePieceControl(
          styleButtons.current.get(selection.id) ?? addGarmentButtonRef.current
        )
    })
  }

  const markGarmentConfirmed = () => {
    if (epoch !== mobileIdentityEpoch()) return
    setConfirmedGarment(true)
    notifyWardrobeChanged()
  }

  useEffect(() => {
    isCaptureOpenRef.current = isCaptureOpen
  }, [isCaptureOpen])

  const loadGarments = useCallback(
    async (signal?: AbortSignal) => {
      const token = await resolveMobileAccessToken()
      if (signal?.aborted || epoch !== mobileIdentityEpoch()) return null
      if (!token) {
        throw new Error('AUTHENTICATION_REQUIRED')
      }
      setAccessToken(token)
      const next = await listGarmentsFromMobile(token, signal)
      if (signal?.aborted || epoch !== mobileIdentityEpoch()) return null
      setGarments(next)
      setHasLoaded(true)
      setLoadFailed(false)
      return next
    },
    [epoch]
  )

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    void loadGarments(controller.signal)
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [loadAttempt, loadGarments])

  useEffect(() => {
    const controller = new AbortController()
    // The onboarding entry-point card fetch is independent of, and must never
    // block, the garment list: a stalled/erroring onboarding read shouldn't
    // hide the wardrobe hub's actual contents.
    void resolveMobileAccessToken()
      .then((token) => {
        if (!token || controller.signal.aborted) return null
        return getWardrobeOnboardingStateFromMobile(token, controller.signal)
      })
      .then((state) => {
        if (!state || controller.signal.aborted) return
        setShowOnboardingCard(state.status !== 'completed')
      })
      .catch(() => undefined)
    return () => {
      controller.abort()
      pollingAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!addEntry) {
      directEntryConsumed.current = false
      return
    }
    if (
      !mobileApplicationUserId() ||
      isLoading ||
      loadFailed ||
      !hasLoaded ||
      directEntryConsumed.current
    )
      return
    directEntryConsumed.current = true
    router.setParams({ entry: undefined })
    const awaitingTags = garments.find((garment) => garment.status === 'awaiting_tags')
    if (awaitingTags) {
      presentTagging(awaitingTags.id)
    } else if (!garments.some((garment) => garment.status === 'processing')) {
      setIsCaptureOpen(true)
    }
  }, [addEntry, garments, hasLoaded, isLoading, loadFailed])

  const closeCapture = () => {
    setIsCaptureOpen(false)
    isCaptureOpenRef.current = false
    const pending = pendingTagging.current
    pendingTagging.current = null
    if (pending) setTimeout(() => presentTagging(pending.id, pending.invoker), 0)
  }

  const pollCommittedGarment = (garmentId: string, token: string) => {
    pollingAbortRef.current?.abort()
    const controller = new AbortController()
    pollingAbortRef.current = controller
    setErrorMessage(null)
    void (async () => {
      try {
        const settled = await pollGarmentUntilSettled(
          token,
          garmentId,
          controller.signal,
          (next) => {
            if (!controller.signal.aborted && epoch === mobileIdentityEpoch())
              setGarments(next)
          },
          pollOffsetsMs
        )
        if (controller.signal.aborted || epoch !== mobileIdentityEpoch()) return
        if (!settled) {
          setErrorMessage(t('wardrobe.tagging.poll_timeout'))
          return
        }
        if (settled.status === 'ready') markGarmentConfirmed()
        if (settled.status === 'awaiting_tags') presentTagging(settled.id)
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrorMessage(
            error instanceof Error ? error.message : t('wardrobe.tagging.load_failed')
          )
        }
      }
    })()
  }

  const openTaggingGarment = async (
    garmentId: string,
    invokingNodeHandle?: number | null
  ) => {
    const freshToken = await resolveMobileAccessToken()
    if (epoch !== mobileIdentityEpoch()) return
    if (!freshToken) {
      setErrorMessage('AUTHENTICATION_REQUIRED')
      return
    }
    setAccessToken(freshToken)
    presentTagging(garmentId, invokingNodeHandle)
  }

  const handleGarmentCommitted = (garment: GarmentItemContract, token: string) => {
    setAccessToken(token)
    setGarments((current) => [
      garment,
      ...current.filter((item) => item.id !== garment.id),
    ])
    if (garment.status === 'ready') markGarmentConfirmed()
    if (garment.status === 'awaiting_tags') {
      pendingTagging.current = { id: garment.id }
    } else if (garment.status === 'processing') {
      pollCommittedGarment(garment.id, token)
    }
  }

  return (
    <>
      <View
        style={styles.screen}
        testID="wardrobe-screen"
        {...underModalAccessibility(Boolean(taggingGarmentId || styleSelection))}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{t('wardrobe.title')}</Text>
              <Text style={styles.subtitle}>{t('wardrobe.empty_desc')}</Text>
            </View>
            <View style={styles.headerActions}>
              {/* The capsule screen had no entry point anywhere in the app. */}
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('wardrobe.capsules.title')}
                testID="wardrobe-capsules-link"
                style={secondaryButton}
                onPress={() => router.push('/wardrobe-capsules')}
              >
                <Text style={secondaryButtonText}>{t('wardrobe.capsules.title')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('wardrobe.silhouette.title')}
                testID="wardrobe-silhouette-link"
                style={secondaryButton}
                onPress={() => router.push('/wardrobe-silhouette')}
              >
                <Text style={secondaryButtonText}>{t('wardrobe.silhouette.title')}</Text>
              </Pressable>
              <Pressable
                ref={addGarmentButtonRef}
                accessibilityRole="button"
                testID="garment-capture-open"
                style={[styles.primaryButton, { backgroundColor: colors.inverseSurface }]}
                onPress={() => setIsCaptureOpen(true)}
              >
                <Text style={[styles.primaryButtonText, { color: colors.onInverse }]}>
                  {t('wardrobe.add_garment')}
                </Text>
              </Pressable>
            </View>
          </View>

          {showOnboardingCard ? (
            <Pressable
              accessibilityRole="link"
              testID="wardrobe-onboarding-card"
              style={[styles.onboardingCard, notice]}
              onPress={() => router.push('/wardrobe-onboarding')}
            >
              <Text style={[styles.onboardingCardTitle, { color: colors.noticeText }]}>
                {t('wardrobe.onboarding.title')}
              </Text>
              <Text style={[styles.onboardingCardBody, { color: colors.noticeText }]}>
                {t('wardrobe.onboarding.permission_body')}
              </Text>
            </Pressable>
          ) : null}

          {errorMessage ? (
            <View
              style={[styles.errorBox, { backgroundColor: colors.dangerSurface }]}
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
              testID="wardrobe-error-banner"
            >
              <Text style={{ color: colors.dangerText }}>{errorMessage}</Text>
            </View>
          ) : null}
          {loadFailed ? (
            <View
              style={[styles.errorBox, { backgroundColor: colors.dangerSurface }]}
              accessibilityLiveRegion="polite"
            >
              <Text style={{ color: colors.dangerText }}>
                {garments.length > 0
                  ? strings.firstUse.staleWardrobe
                  : strings.firstUse.wardrobeFailed}
              </Text>
              <Pressable
                accessibilityRole="button"
                testID="wardrobe-list-retry"
                disabled={isLoading}
                style={secondaryButton}
                onPress={() => setLoadAttempt((attempt) => attempt + 1)}
              >
                <Text style={secondaryButtonText}>{strings.chrome.retry}</Text>
              </Pressable>
            </View>
          ) : null}
          {confirmedGarment ? (
            <Pressable
              accessibilityRole="link"
              style={secondaryButton}
              onPress={() => router.navigate('/')}
            >
              <Text style={secondaryButtonText}>{strings.firstUse.backToOutfit}</Text>
            </Pressable>
          ) : null}

          {isLoading && garments.length === 0 ? (
            <ActivityIndicator accessibilityLabel="Loading wardrobe" />
          ) : garments.length === 0 ? (
            hasLoaded && !loadFailed ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>{t('wardrobe.empty_title')}</Text>
              </View>
            ) : null
          ) : (
            <View style={styles.grid} testID="wardrobe-garment-list">
              {garments.map((garment) => (
                <View key={garment.id} style={styles.garmentCard}>
                  {garment.imageAccess ? (
                    <Image
                      source={{ uri: garment.imageAccess.url }}
                      accessibilityLabel={t('wardrobe.capture.title')}
                      style={styles.garmentImage}
                    />
                  ) : null}
                  <Text numberOfLines={1} style={styles.garmentId}>
                    {garment.id}
                  </Text>
                  <Text testID={`garment-status-${garment.status}`}>
                    {garment.status}
                  </Text>
                  {garment.status === 'awaiting_tags' && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('wardrobe.tagging.needs_tags', {
                        defaultValue: 'Needs tags',
                      })}
                      style={[styles.needsTagsBtn, notice]}
                      onPress={(event) => {
                        void openTaggingGarment(
                          garment.id,
                          safeFindNodeHandle(event.currentTarget)
                        )
                      }}
                    >
                      <Text style={[styles.needsTagsText, { color: colors.noticeText }]}>
                        {t('wardrobe.tagging.needs_tags', { defaultValue: 'Needs tags' })}
                      </Text>
                    </Pressable>
                  )}
                  {garment.status === 'failed' && (
                    <Pressable
                      accessibilityRole="button"
                      style={[styles.needsTagsBtn, notice]}
                      onPress={() => setIsCaptureOpen(true)}
                    >
                      <Text style={[styles.needsTagsText, { color: colors.noticeText }]}>
                        {strings.firstUse.replaceGarment}
                      </Text>
                    </Pressable>
                  )}
                  {garment.status === 'processing' && (
                    <Pressable
                      accessibilityRole="button"
                      style={[styles.needsTagsBtn, notice]}
                      onPress={() => pollCommittedGarment(garment.id, accessToken)}
                    >
                      <Text style={[styles.needsTagsText, { color: colors.noticeText }]}>
                        {strings.firstUse.checkGarment}
                      </Text>
                    </Pressable>
                  )}
                  <StylePieceEntry
                    garment={garment}
                    owner={owner}
                    epoch={epoch}
                    unavailable={loadFailed}
                    loading={isLoading}
                    labels={styleLabels}
                    buttonRef={(button) => {
                      if (button) styleButtons.current.set(garment.id, button)
                      else styleButtons.current.delete(garment.id)
                    }}
                    onRefresh={() => setLoadAttempt((attempt) => attempt + 1)}
                    onOpen={openStylePanel}
                  />
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <MobileGarmentCaptureModal
          confirmDiscard
          visible={isCaptureOpen}
          onClose={closeCapture}
          onGarmentCommitted={handleGarmentCommitted}
          invokingNodeHandle={safeFindNodeHandle(addGarmentButtonRef.current)}
        />
      </View>

      <MobileGarmentTaggingModal
        visible={Boolean(taggingGarmentId)}
        onClose={closeTagging}
        garmentId={taggingGarmentId}
        accessToken={accessToken}
        invokingNodeHandle={taggingInvokerNodeHandle}
        onTagsConfirmed={(updatedGarment) => {
          setGarments((current) =>
            current.map((item) => (item.id === updatedGarment.id ? updatedGarment : item))
          )
          closeTagging()
          markGarmentConfirmed()
          setLoadAttempt((attempt) => attempt + 1)
        }}
      />

      {owner && styleSelection && (
        <StylePiecePanel
          selection={styleSelection}
          inWardrobe={garments.some(({ id }) => id === styleSelection.id)}
          loadInventory={loadGarments}
          visible={!styleClosing}
          owner={owner}
          epoch={epoch}
          locale={i18n.language}
          onClose={() => setStyleClosing(true)}
          onDismiss={() => finishStyleDismissal(styleSelection)}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  needsTagsBtn: {
    minHeight: 44,
    minWidth: 44,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
  },
  needsTagsText: {
    fontWeight: '700',
    fontSize: 12,
  },
  content: { padding: 20, gap: 24 },
  header: { gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { marginTop: 6, opacity: 0.7 },
  // Story 6.15 F-00i: at iOS XXXL and the accessibility sizes the three actions are wider than
  // the screen, so they wrap instead of pushing Add garment past the edge.
  headerActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
  },
  secondaryButtonText: { fontSize: 13, fontWeight: '600' },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: { fontWeight: '700' },
  onboardingCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  onboardingCardTitle: { fontSize: 18, fontWeight: '700' },
  onboardingCardBody: { opacity: 0.8 },
  emptyState: { alignItems: 'center', borderRadius: 16, padding: 36 },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  garmentCard: { width: '47%', overflow: 'hidden', borderRadius: 12, padding: 10 },
  garmentImage: { width: '100%', aspectRatio: 0.75, borderRadius: 8 },
  garmentId: { marginTop: 8, fontSize: 12 },
  errorBox: { borderRadius: 12, padding: 12, gap: 8 },
})

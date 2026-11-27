// Story 4.1/4.2 owner (original), Story 4.4 Task 6 owner (this file's move +
// onboarding entry-point card): the mobile wardrobe hub. Moved here, out of
// app/(tabs)/wardrobe.tsx, so it's covered by the component test runner (see
// wardrobe-silhouette-screen.tsx for why app/ route files stay thin
// wrappers); apps/mobile/app/(tabs)/wardrobe.tsx now just re-exports this.
// Story CC-7.11 D4, D5: the Closet opens on its grid. Add and More sit in the top bar, setup and
// Silhouette moved into the More sheet, Capsules to the Looks tab, and the saved looks row below
// the grid until CC-7.12.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.12 D8: the saved looks row is gone; saved looks live on the Looks tab.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ElementRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { router, useFocusEffect, useNavigation } from 'expo-router'
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import {
  garmentCategoryEnum,
  wardrobeOnboardingStepEnum,
  type GarmentCategory,
  type GarmentItemContract,
  type WardrobeOnboardingStep,
} from '@couture/api-client/contracts/http'
import { formatGarmentCategory, getGuestPreviewStrings } from '@couture/utils'

import { underModalAccessibility } from '@/components/edge-to-edge-modal'
import { NavRow } from '@/src/components/nav-row'
import { ShellIcon, type ShellIconName } from '@/src/components/shell-icons'
import { ScreenGate } from '@/src/components/screen-gate'
import { useStatusBar } from '@/components/save-feedback'
import { Text, View, useSchemeColors } from '@/components/themed'
import { TAB_BODY_INSET } from '@/src/theme/tokens'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { safeFindNodeHandle } from '@/src/lib/expo-native-helpers'
import { notifyWardrobeChanged, onWardrobeChanged } from '@/src/lib/wardrobe-changes'

import { MobileGarmentCaptureModal } from '@/components/wardrobe/garment-capture-modal'
import { MobileGarmentTaggingModal } from '@/components/wardrobe/garment-tagging-modal'
import {
  getWardrobeOnboardingStateFromMobile,
  listGarmentsFromMobile,
  pollGarmentUntilSettled,
} from '@/src/lib/wardrobe'
import { ensureMobileLegacySavedLooksMigration } from '@/src/lib/saved-looks'
import { ClosetMoreSheet, ClosetTopBarActions } from './closet-top-bar'
import { garmentDeletion, type MobileGarmentDeletion } from './garment-deletion'
import {
  garmentCardLabel,
  garmentPhotoLabel,
  type ClosetGarment,
} from './garment-detail-screen'

export interface WardrobeHubScreenProps {
  addEntry?: boolean
  /** Test-only override for the still-processing garment poll cadence. */
  pollOffsetsMs?: readonly number[]
  /** Story CC-7.6 D10: test seam; defaults to the app's one garment deletion. */
  deletion?: MobileGarmentDeletion
}

/**
 * Story CC-7.6: the hub's side of a garment delete the detail requested. Pending pieces are
 * hidden, and the hub hands the deletion its root status bar and grid, so "Deleted" with Undo,
 * "Deleted" once a confirmed delete or a Retry lands, and "Could not delete" with Retry show
 * there, even after the member left the hub. Backgrounding the app or leaving the hub (a tab
 * switch, Capsules, Silhouette: anything but a garment detail) sends every pending delete at
 * once (D1).
 */
function useHubGarmentDeletion({
  deletion,
  epoch,
  onCommitted,
  openingDetailRef,
}: {
  deletion: MobileGarmentDeletion
  epoch: number
  onCommitted: (garmentId: string) => void
  /** True from a garment card press until the hub is focused again. */
  openingDetailRef: React.MutableRefObject<boolean>
}) {
  const { t } = useTranslation()
  const statusBar = useStatusBar()
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  // Every bar change renders the hub; the deletion learns which notice is on screen.
  deletion.observeBar(statusBar.notice?.id ?? null)
  const tRef = useRef(t)
  tRef.current = t
  const onCommittedRef = useRef(onCommitted)
  onCommittedRef.current = onCommitted
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(deletion.pendingIds())
  )

  useEffect(() => {
    const detach = deletion.attach({
      epoch,
      presenter: {
        showNotice: (input) => statusBarRef.current.showNotice(input),
        dismissNotice: (noticeId) => statusBarRef.current.dismissNotice(noticeId),
        announce: (message, announcementId) =>
          statusBarRef.current.announce(message, { announcementId }),
        isOnline: () => statusBarRef.current.isOnline,
        t: (key) => tRef.current(key),
      },
      onCommitted: (garmentId) => onCommittedRef.current(garmentId),
    })
    setPendingIds(new Set(deletion.pendingIds()))
    const unsubscribe = deletion.subscribe(() => {
      setPendingIds(new Set(deletion.pendingIds()))
    })
    // Backgrounding the app sends every pending delete at once (D1).
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') void deletion.controller.flush()
    })
    return () => {
      subscription.remove()
      unsubscribe()
      detach()
      // Leaving the hub sends whatever is still inside its Undo window; the deletion keeps
      // the root status bar, so a failure still shows "Could not delete" with Retry (D6).
      void deletion.controller.flush()
    }
  }, [deletion, epoch])

  // Tabs and pushed routes keep the hub mounted, so leaving it is a blur. A garment detail
  // pushed over the hub is still the Closet: its delete is what the window is for.
  useFocusEffect(
    useCallback(() => {
      openingDetailRef.current = false
      return () => {
        if (!openingDetailRef.current) void deletion.controller.flush()
      }
    }, [deletion, openingDetailRef])
  )

  return pendingIds
}

/** Only the first inventory read shows the spinner, and only over an empty grid. */
function showFirstReadSpinner(
  isLoading: boolean,
  settled: boolean,
  visibleCount: number
) {
  return isLoading && !settled && visibleCount === 0
}

export function WardrobeHubScreen(props: WardrobeHubScreenProps = {}) {
  const epoch = useSyncExternalStore(
    subscribeMobileApplicationUser,
    mobileIdentityEpoch,
    mobileIdentityEpoch
  )
  const sessionSeen = useSessionSeen(mobileApplicationUserId())
  return (
    <MemberWardrobeHub key={epoch} epoch={epoch} sessionSeen={sessionSeen} {...props} />
  )
}

function useClosetCategories(garments: readonly ClosetGarment[]) {
  const [category, setCategory] = useState<GarmentCategory | 'all'>('all')
  const categories = garmentCategoryEnum.options.filter((option) =>
    garments.some((garment) => garment.category === option)
  )
  const activeCategory =
    category !== 'all' && categories.includes(category) ? category : 'all'
  const filteredGarments =
    activeCategory === 'all'
      ? garments
      : garments.filter((garment) => garment.category === activeCategory)
  return { categories, activeCategory, filteredGarments, setCategory }
}

function MemberWardrobeHub({
  pollOffsetsMs,
  addEntry,
  epoch,
  sessionSeen,
  deletion = garmentDeletion,
}: WardrobeHubScreenProps & { epoch: number; sessionSeen: SessionSeen }) {
  const { t, i18n } = useTranslation()
  const { fontScale, width } = useWindowDimensions()
  const wideCards = fontScale >= 1.5 && width <= 400
  const strings = getGuestPreviewStrings(i18n.language)
  const colors = useSchemeColors()
  const secondaryButton = [styles.secondaryButton, { borderColor: colors.lineStrong }]
  const secondaryButtonText = [styles.secondaryButtonText, { color: colors.ink }]
  const navigation = useNavigation()
  const [garments, setGarments] = useState<ClosetGarment[]>([])
  const inventoryRevision = useRef(0)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  /**
   * Story CC-7.9 add-on B: a visitor who never signed in. The closet read finds no token and the
   * screen has seen no session (`useSessionSeen`), so there is nothing that failed: the screen
   * offers sign-in in place of the "could not load" notice, and Add goes to sign-in. A member
   * whose session ends here keeps the failure notice and its Retry.
   */
  const [visitor, setVisitor] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [confirmedGarment, setConfirmedGarment] = useState(false)
  const [isCaptureOpen, setIsCaptureOpen] = useState(false)
  const [taggingGarmentId, setTaggingGarmentId] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState<string>('')
  const [taggingInvokerNodeHandle, setTaggingInvokerNodeHandle] = useState<number | null>(
    null
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // D5: the More sheet's setup row reads "Closet setup: done" once onboarding is completed.
  const [setupStep, setSetupStep] = useState<WardrobeOnboardingStep | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  // Story CC-7.7 D3: the Closet gate waits for the first inventory read.
  const [inventorySettled, setInventorySettled] = useState(false)
  const pollingAbortRef = useRef<AbortController | null>(null)
  const pendingTagging = useRef<{ id: string; invoker?: number | null } | null>(null)
  const isCaptureOpenRef = useRef(false)
  const addGarmentButtonRef = useRef<ElementRef<typeof Pressable> | null>(null)
  const moreButtonRef = useRef<ElementRef<typeof Pressable> | null>(null)
  const directEntryConsumed = useRef(false)
  // Story CC-7.11 D13: the control that opened capture (top bar Add, empty-state Add or a
  // piece's Replace) takes focus back.
  const captureInvokerRef = useRef<ElementRef<typeof Pressable> | null>(null)
  const openCapture = (invoker: ElementRef<typeof Pressable> | null) => {
    captureInvokerRef.current = invoker
    setIsCaptureOpen(true)
  }
  const captureInvoker = () => captureInvokerRef.current ?? addGarmentButtonRef.current

  const presentTagging = (id: string, invoker?: number | null) => {
    if (epoch !== mobileIdentityEpoch()) return
    if (isCaptureOpenRef.current) {
      pendingTagging.current = { id, invoker }
      return
    }
    setTaggingInvokerNodeHandle(invoker ?? safeFindNodeHandle(captureInvoker()))
    setTaggingGarmentId(id)
  }

  const closeTagging = () => {
    setTaggingGarmentId(null)
  }

  // The hub's own change notices are for other screens; it already reloads itself.
  const notifyingWardrobeRef = useRef(false)
  const markGarmentConfirmed = () => {
    if (epoch !== mobileIdentityEpoch()) return
    setConfirmedGarment(true)
    notifyingWardrobeRef.current = true
    try {
      notifyWardrobeChanged()
    } finally {
      notifyingWardrobeRef.current = false
    }
  }

  // Story CC-7.5 D3: a tag save on the garment detail reloads the grid in place.
  useEffect(
    () =>
      onWardrobeChanged(() => {
        if (notifyingWardrobeRef.current || epoch !== mobileIdentityEpoch()) return
        // Every read started before the save carries an older revision and is discarded, so a
        // pre-save snapshot that settles late cannot win over the reload below.
        inventoryRevision.current++
        setLoadAttempt((attempt) => attempt + 1)
      }),
    [epoch]
  )

  useEffect(() => {
    isCaptureOpenRef.current = isCaptureOpen
  }, [isCaptureOpen])

  const openingDetailRef = useRef(false)
  const hasLoadedRef = useRef(hasLoaded)
  hasLoadedRef.current = hasLoaded
  const pendingDeleteIds = useHubGarmentDeletion({
    deletion,
    epoch,
    openingDetailRef,
    onCommitted: (garmentId) => {
      if (epoch !== mobileIdentityEpoch()) return
      inventoryRevision.current++
      setGarments((current) => current.filter((item) => item.id !== garmentId))
      // The revision bump discards any read still in flight. Before the first read landed
      // (a hub that remounted while the DELETE was out) that read is the grid itself, so
      // read again: the server already answers without the deleted piece.
      if (!hasLoadedRef.current) setLoadAttempt((attempt) => attempt + 1)
      // Other screens (Looks, capsules, Today) read the closet again; a saved look holding
      // the piece now shows it as missing (CC-7.2).
      notifyingWardrobeRef.current = true
      try {
        notifyWardrobeChanged()
      } finally {
        notifyingWardrobeRef.current = false
      }
    },
  })
  // A piece inside its Undo window, or being sent, is hidden from the grid.
  const visibleGarments =
    pendingDeleteIds.size === 0
      ? garments
      : garments.filter((garment) => !pendingDeleteIds.has(garment.id))

  const { categories, activeCategory, filteredGarments, setCategory } =
    useClosetCategories(visibleGarments)

  const refreshGarmentList = useCallback(
    async (token: string, signal?: AbortSignal) => {
      const revision = inventoryRevision.current
      const isCurrent = () =>
        !signal?.aborted &&
        epoch === mobileIdentityEpoch() &&
        revision === inventoryRevision.current
      if (!isCurrent()) return null
      let next: GarmentItemContract[]
      try {
        next = await listGarmentsFromMobile(token, signal)
      } catch (error) {
        if (!isCurrent()) return null
        throw error
      }
      // A concurrent list or write may have updated or removed a garment.
      // An older snapshot cannot settle a poll or authorize another view.
      if (!isCurrent()) return null
      inventoryRevision.current++
      setGarments(next)
      return next
    },
    [epoch]
  )

  const loadGarments = useCallback(
    async (signal?: AbortSignal) => {
      const token = await resolveMobileAccessToken()
      if (signal?.aborted || epoch !== mobileIdentityEpoch()) return null
      if (!token) throw new Error('AUTHENTICATION_REQUIRED')
      sessionSeen.current = true
      setAccessToken(token)
      const next = await refreshGarmentList(token, signal)
      if (next) {
        setHasLoaded(true)
        setLoadFailed(false)
        setVisitor(false)
        void ensureMobileLegacySavedLooksMigration({
          owner: mobileApplicationUserId(),
          epoch,
          accessToken: token,
          garments: next,
        })
      }
      return next
    },
    [epoch, refreshGarmentList, sessionSeen]
  )

  // Story CC-7.7 D5: tabs stay mounted, so returning to the Closet is a focus, never a mount.
  // It reads the inventory again in place: the grid and the scroll position stay, and only the
  // first read ever shows the spinner. The first focus is the mount, whose reads are already
  // running.
  const leftClosetRef = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (leftClosetRef.current && epoch === mobileIdentityEpoch()) {
        setLoadAttempt((attempt) => attempt + 1)
      }
      leftClosetRef.current = false
      return () => {
        leftClosetRef.current = true
      }
    }, [epoch])
  )

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    void loadGarments(controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const noSession =
          error instanceof Error && error.message === 'AUTHENTICATION_REQUIRED'
        if (noSession && !sessionSeen.current) setVisitor(true)
        else setLoadFailed(true)
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setIsLoading(false)
        setInventorySettled(true)
      })
    return () => controller.abort()
  }, [loadAttempt, loadGarments, sessionSeen])

  // The onboarding state only names the More sheet's setup row, so it never blocks the garment
  // list: a stalled or failing read leaves the row as it was. It is read again with the closet
  // (a return from setup is a focus), so a finished setup reads "done".
  useEffect(() => {
    const controller = new AbortController()
    void resolveMobileAccessToken()
      .then((token) => {
        if (!token || controller.signal.aborted) return null
        return getWardrobeOnboardingStateFromMobile(token, controller.signal)
      })
      .then((state) => {
        if (!state || controller.signal.aborted) return
        if (epoch === mobileIdentityEpoch()) setSetupStep(state.currentStep)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [epoch, loadAttempt])

  useEffect(() => () => pollingAbortRef.current?.abort(), [])

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
      openCapture(null)
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
          undefined,
          pollOffsetsMs,
          refreshGarmentList
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
      setErrorMessage(t('wardrobe.error.sign_in_required'))
      return
    }
    setAccessToken(freshToken)
    presentTagging(garmentId, invokingNodeHandle)
  }

  const handleGarmentCommitted = (garment: GarmentItemContract, token: string) => {
    if (epoch !== mobileIdentityEpoch()) return
    inventoryRevision.current++
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

  // D4: Add and More fill the tab top bar's trailing slot. The latest press handler is read
  // through a ref, so the header element stays stable while the hub's state changes.
  const openAdd = (invoker: ElementRef<typeof Pressable> | null) =>
    visitor ? router.push('/signin') : openCapture(invoker)
  const openAddRef = useRef(openAdd)
  openAddRef.current = openAdd
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <ClosetTopBarActions
          addRef={addGarmentButtonRef}
          moreRef={moreButtonRef}
          onAdd={() => openAddRef.current(addGarmentButtonRef.current)}
          onMore={() => setMoreOpen(true)}
        />
      ),
    })
  }, [navigation])

  return (
    <>
      <View
        style={styles.screen}
        testID="wardrobe-screen"
        {...underModalAccessibility(Boolean(taggingGarmentId))}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenGate
            screen="closet"
            // Story CC-7.7 D3: the Closet gate waits for the first inventory read. Story CC-7.12
            // D8: saved looks left the Closet for the Looks tab, so the gate no longer waits on them.
            ready={inventorySettled}
            // The ScrollView's 24-point gap reaches only its direct children; the notices and
            // the inventory keep the same spacing inside the gate body.
            style={styles.gatedBody}
          >
            {errorMessage ? (
              <View
                style={[styles.errorBox, { backgroundColor: colors.dangerSurface }]}
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                testID="wardrobe-error-banner"
              >
                <Text style={{ color: colors.dangerInk }}>{errorMessage}</Text>
              </View>
            ) : null}
            {loadFailed ? (
              <View
                style={[styles.errorBox, { backgroundColor: colors.dangerSurface }]}
                accessibilityLiveRegion="polite"
              >
                <Text style={{ color: colors.dangerInk }}>
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

            <ClosetVisitorOffer
              visible={visitor}
              buttonStyle={secondaryButton}
              textStyle={secondaryButtonText}
            />
            {visibleGarments.length > 0 && (
              <ScrollView
                horizontal
                accessibilityLabel={t('wardrobe.hub.categoryFilters')}
                testID="closet-category-filters"
                contentContainerStyle={styles.categoryFilters}
                style={styles.categoryScroll}
              >
                {(['all', ...categories] as const).map((option) => (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option === activeCategory }}
                    testID={`closet-category-${option}`}
                    style={[
                      styles.categoryChip,
                      {
                        backgroundColor:
                          option === activeCategory ? colors.inverse : colors.page,
                        borderColor: colors.lineStrong,
                      },
                    ]}
                    onPress={() => setCategory(option)}
                  >
                    <Text
                      style={{
                        color: option === activeCategory ? colors.onInverse : colors.ink,
                      }}
                    >
                      {option === 'all'
                        ? t('wardrobe.hub.categoryAll')
                        : formatGarmentCategory(i18n.language, option)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {/* Story CC-7.7 D5: only the first read shows the spinner; a refresh after a tag
              save, a delete or a Retry keeps the grid or the empty state in place. */}
            {showFirstReadSpinner(isLoading, inventorySettled, visibleGarments.length) ? (
              <ActivityIndicator accessibilityLabel={t('wardrobe.hub.loading')} />
            ) : filteredGarments.length === 0 ? (
              hasLoaded && !loadFailed ? (
                // CC-7.10: marks the empty closet. The screen budget measures empty Closet chrome
                // to the Add control (garment-capture-open) while this renders (review #11).
                <View style={styles.emptyState} testID="wardrobe-empty-state">
                  <Text style={styles.emptyTitle}>{t('wardrobe.empty_title')}</Text>
                  {/* D4: the top bar Add is the one gold primary, so this one is neutral. */}
                  <Pressable
                    accessibilityRole="button"
                    testID="wardrobe-empty-add"
                    style={secondaryButton}
                    onPress={(event) =>
                      openAddRef.current(
                        event.currentTarget as unknown as ElementRef<typeof Pressable>
                      )
                    }
                  >
                    <Text style={secondaryButtonText}>{t('wardrobe.add_garment')}</Text>
                  </Pressable>
                </View>
              ) : null
            ) : (
              // CC-7.10 screen budget anchor (wardrobe-garment-list) around the P5 grid id.
              <View testID="wardrobe-garment-list">
                <View style={styles.grid} testID="closet-garment-grid">
                  {filteredGarments.map((garment) => (
                    <View
                      key={garment.id}
                      style={[styles.garmentCard, wideCards && styles.wideGarmentCard]}
                      testID={`garment-card-${garment.id}`}
                    >
                      {garment.status === 'ready' ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={garmentPhotoLabel(i18n.language, garment)}
                          testID={`garment-open-${garment.id}`}
                          onPress={() => {
                            openingDetailRef.current = true
                            router.push({
                              pathname: '/wardrobe-garment',
                              params: { id: garment.id },
                            })
                          }}
                        >
                          <GarmentCardFace garment={garment} locale={i18n.language} />
                        </Pressable>
                      ) : (
                        <GarmentCardFace garment={garment} locale={i18n.language} />
                      )}
                      {garment.status === 'awaiting_tags' && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t('wardrobe.hub.status.awaiting_tags')}
                          style={styles.statusAction}
                          onPress={(event) => {
                            void openTaggingGarment(
                              garment.id,
                              safeFindNodeHandle(event.currentTarget)
                            )
                          }}
                        >
                          <GarmentStatusBadge status="awaiting_tags" />
                        </Pressable>
                      )}
                      {garment.status === 'failed' && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t('wardrobe.hub.status.failed')}
                          accessibilityHint={strings.firstUse.replaceGarment}
                          style={styles.statusAction}
                          onPress={(event) =>
                            openCapture(
                              event.currentTarget as unknown as ElementRef<
                                typeof Pressable
                              >
                            )
                          }
                        >
                          <GarmentStatusBadge status="failed" />
                        </Pressable>
                      )}
                      {garment.status === 'processing' && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t('wardrobe.hub.status.processing')}
                          accessibilityHint={strings.firstUse.checkGarment}
                          style={styles.statusAction}
                          onPress={() => pollCommittedGarment(garment.id, accessToken)}
                        >
                          <GarmentStatusBadge status="processing" />
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}
            {hasLoaded && setupStep && setupStep !== 'complete' && (
              <View testID="closet-setup-progress">
                <NavRow
                  label={t('wardrobe.menu.setup')}
                  value={t('wardrobe.hub.setupProgress', {
                    completed: wardrobeOnboardingStepEnum.options.indexOf(setupStep),
                    total: wardrobeOnboardingStepEnum.options.length - 1,
                  })}
                  testID="closet-setup-progress-link"
                  onPress={() => router.push('/wardrobe-onboarding')}
                />
              </View>
            )}
          </ScreenGate>
        </ScrollView>

        <MobileGarmentCaptureModal
          confirmDiscard
          visible={isCaptureOpen}
          onClose={closeCapture}
          onGarmentCommitted={handleGarmentCommitted}
          invokingNodeHandle={safeFindNodeHandle(captureInvoker())}
        />
      </View>

      <MobileGarmentTaggingModal
        visible={Boolean(taggingGarmentId)}
        onClose={closeTagging}
        garmentId={taggingGarmentId}
        accessToken={accessToken}
        invokingNodeHandle={taggingInvokerNodeHandle}
        onTagsConfirmed={(updatedGarment) => {
          if (epoch !== mobileIdentityEpoch()) return
          inventoryRevision.current++
          setGarments((current) =>
            current.map((item) => (item.id === updatedGarment.id ? updatedGarment : item))
          )
          closeTagging()
          markGarmentConfirmed()
          setLoadAttempt((attempt) => attempt + 1)
        }}
      />

      <ClosetMoreSheet
        visible={moreOpen}
        setupDone={setupStep === 'complete'}
        onClose={() => setMoreOpen(false)}
        returnFocusRef={moreButtonRef}
      />
    </>
  )
}

/** A card's photo and label. The raw garment id never shows (2026-11-19 tester report). */
function GarmentCardFace({
  garment,
  locale,
}: {
  garment: ClosetGarment
  locale: string
}) {
  const label = garmentPhotoLabel(locale, garment)
  return (
    <>
      {garment.imageAccess ? (
        <Image
          source={{ uri: garment.imageAccess.url }}
          accessible
          accessibilityRole="image"
          accessibilityLabel={label}
          style={styles.garmentImage}
        />
      ) : null}
      <Text style={styles.garmentLabel} testID="garment-card-label">
        {garmentCardLabel(locale, garment)}
      </Text>
    </>
  )
}

const statusIcon = {
  awaiting_tags: 'tag',
  failed: 'warning',
  processing: 'clock',
} as const satisfies Record<string, ShellIconName>

function GarmentStatusBadge({ status }: { status: keyof typeof statusIcon }) {
  const { t } = useTranslation()
  const colors = useSchemeColors()
  const tones = {
    awaiting_tags: { backgroundColor: colors.noticeSurface, color: colors.noticeInk },
    failed: { backgroundColor: colors.dangerSurface, color: colors.dangerInk },
    processing: { backgroundColor: colors.cardMuted, color: colors.inkSoft },
  }
  const { backgroundColor, color } = tones[status]
  return (
    <View
      testID={`garment-status-${status}`}
      style={[styles.statusBadge, { backgroundColor, borderColor: color }]}
    >
      <ShellIcon name={statusIcon[status]} size={16} color={color} />
      <Text style={[styles.garmentStatus, { color }]}>
        {t(`wardrobe.hub.status.${status}`)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  statusAction: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minWidth: 44,
    minHeight: 44,
    maxWidth: '100%',
  },
  content: { paddingHorizontal: TAB_BODY_INSET, paddingVertical: 20, gap: 24 },
  gatedBody: { gap: 8 },
  categoryScroll: { flexGrow: 0 },
  categoryFilters: { gap: 8 },
  categoryChip: {
    justifyContent: 'center',
    minHeight: 44,
    maxWidth: 280,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 9999,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
  },
  secondaryButtonText: { fontSize: 14, fontWeight: '600' },
  emptyState: { alignItems: 'center', borderRadius: 16, padding: 40, gap: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  // Story CC-7.11 D4 (review #2): two rows of tagged tiles (photo, label, status, Style this
  // piece) fit between the top bar and the tab bar at 360 x 640 dp, so the tile is compact: a
  // landscape photo, a tight label and status, and the 44 pt actions kept.
  garmentCard: { width: '47%', overflow: 'hidden', borderRadius: 12, padding: 8 },
  wideGarmentCard: { width: '100%' },
  garmentImage: { width: '100%', aspectRatio: 4 / 3, borderRadius: 8 },
  garmentLabel: { marginTop: 4, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  statusBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 4,
    borderWidth: 1,
    padding: 4,
    maxWidth: '100%',
  },
  garmentStatus: { flexShrink: 1, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  errorBox: { borderRadius: 12, padding: 12, gap: 8 },
})

/** Set once this screen has seen a member or a stored session token. */
type SessionSeen = { current: boolean }

/**
 * Add-on B, review P2-2: whether this screen has seen any session since it mounted, a member
 * holding it or a token the closet read resolved. It lives in the screen, above the
 * identity-epoch keyed hub, so a sign-out or expiry that remounts the hub keeps it: that person
 * keeps the failure notice and its Retry, and only someone who never had a session is a
 * visitor. It holds one flag and no member data.
 */
function useSessionSeen(owner: string | null): SessionSeen {
  const seen = useRef(false)
  if (owner !== null) seen.current = true
  return seen
}

/** Add-on B: the visitor's sign-in offer, where the empty closet would be. */
function ClosetVisitorOffer({
  visible,
  buttonStyle,
  textStyle,
}: {
  visible: boolean
  buttonStyle: StyleProp<ViewStyle>
  textStyle: StyleProp<TextStyle>
}) {
  const { t } = useTranslation()
  if (!visible) return null
  return (
    <View style={visitorStyles.offer} testID="wardrobe-visitor-offer">
      <Pressable
        accessibilityRole="link"
        testID="wardrobe-sign-in"
        style={buttonStyle}
        onPress={() => router.push('/signin')}
      >
        <Text style={textStyle}>{t('community.notifications.signin')}</Text>
      </Pressable>
    </View>
  )
}

const visitorStyles = StyleSheet.create({
  offer: { alignItems: 'center', paddingVertical: 32 },
})

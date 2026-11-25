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
import { router, useFocusEffect } from 'expo-router'
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  getGuestPreviewStrings,
  getStylePieceStrings,
  nextStylePiecePhotoExpiry,
  scheduleStylePiecePhotoExpiry,
  type StylePieceSelection,
} from '@couture/utils'

import { underModalAccessibility } from '@/components/edge-to-edge-modal'
import { ScreenGate } from '@/src/components/screen-gate'
import { useStatusBar } from '@/components/save-feedback'
import { Text, View, useSchemeColors } from '@/components/themed'
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
import {
  ensureMobileLegacySavedLooksMigration,
  listSavedLooksPageFromMobile,
  subscribeMobileSavedLooksChanged,
} from '@/src/lib/saved-looks'
import { ClosetSavedLooksRow } from './saved-looks-row'
import { garmentDeletion, type MobileGarmentDeletion } from './garment-deletion'
import {
  garmentCardLabel,
  garmentPhotoLabel,
  type ClosetGarment,
} from './garment-detail-screen'
import {
  focusStylePieceControl,
  StylePieceEntry,
  StylePiecePanel,
} from './style-piece-panel'

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

/**
 * Story CC-7.7 D3, D4: the Closet gate's reads are the inventory, the onboarding state and the
 * first Saved Looks page. The Saved Looks row and its error with Retry sit above the inventory,
 * so a page that landed after the gate opened would push the closet down.
 */
function closetGateReady(
  inventorySettled: boolean,
  onboardingSettled: boolean,
  savedLooksSettled: boolean
) {
  return inventorySettled && onboardingSettled && savedLooksSettled
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
  const epoch = useSyncExternalStore(subscribeMobileApplicationUser, mobileIdentityEpoch)
  return <MemberWardrobeHub key={epoch} epoch={epoch} {...props} />
}

function MemberWardrobeHub({
  pollOffsetsMs,
  addEntry,
  epoch,
  deletion = garmentDeletion,
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
  const [garments, setGarments] = useState<ClosetGarment[]>([])
  const inventoryRevision = useRef(0)
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
  // Story CC-7.7 D3: the Closet gate waits for the first inventory read and the onboarding
  // state, so the setup card is already in place when the closet appears.
  const [inventorySettled, setInventorySettled] = useState(false)
  const [onboardingSettled, setOnboardingSettled] = useState(false)
  const [savedLooksSettled, setSavedLooksSettled] = useState(false)
  const [styleSelection, setStyleSelection] = useState<StylePieceSelection | null>(null)
  const [initialSavedLook, setInitialSavedLook] = useState<SavedLookContract | null>(null)
  const [savedLooks, setSavedLooks] = useState<SavedLookContract[]>([])
  const [savedLooksTotal, setSavedLooksTotal] = useState(0)
  const [savedLooksLoading, setSavedLooksLoading] = useState(false)
  const [savedLooksLoadingMore, setSavedLooksLoadingMore] = useState(false)
  const [savedLooksError, setSavedLooksError] = useState<string | null>(null)
  const [savedLooksAttempt, setSavedLooksAttempt] = useState(0)
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
    setInitialSavedLook(null)
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
        // A saved look's Ready or Needs review status follows its anchor's live tags.
        setSavedLooksAttempt((attempt) => attempt + 1)
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
      // A saved look holding the piece now shows it as missing (CC-7.2).
      setSavedLooksAttempt((attempt) => attempt + 1)
      // Other screens (capsules, Today) read the closet again.
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
      setAccessToken(token)
      const next = await refreshGarmentList(token, signal)
      if (next) {
        setHasLoaded(true)
        setLoadFailed(false)
        void ensureMobileLegacySavedLooksMigration({
          owner: mobileApplicationUserId(),
          epoch,
          accessToken: token,
          garments: next,
        })
      }
      return next
    },
    [epoch, refreshGarmentList]
  )

  const savedLooksLoadEpochRef = useRef(0)

  useEffect(() => {
    const loadEpoch = ++savedLooksLoadEpochRef.current
    setSavedLooksLoadingMore(false)
    if (!owner) {
      setSavedLooks([])
      setSavedLooksTotal(0)
      setSavedLooksError(null)
      setSavedLooksLoading(false)
      setSavedLooksSettled(true)
      return
    }
    const controller = new AbortController()
    setSavedLooksLoading(true)
    void listSavedLooksPageFromMobile({ limit: 50, offset: 0, signal: controller.signal })
      .then((page) => {
        if (
          controller.signal.aborted ||
          savedLooksLoadEpochRef.current !== loadEpoch ||
          epoch !== mobileIdentityEpoch()
        ) {
          return
        }
        setSavedLooks(page.data)
        setSavedLooksTotal(page.total)
        setSavedLooksError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || savedLooksLoadEpochRef.current !== loadEpoch) {
          return
        }
        setSavedLooksError(
          error instanceof Error ? error.message : 'Unable to load your saved looks.'
        )
      })
      .finally(() => {
        if (!controller.signal.aborted && savedLooksLoadEpochRef.current === loadEpoch) {
          setSavedLooksLoading(false)
          setSavedLooksSettled(true)
        }
      })
    return () => controller.abort()
  }, [epoch, owner, savedLooksAttempt])

  useEffect(() => {
    if (!owner) return
    return subscribeMobileSavedLooksChanged((changedOwner) => {
      if (changedOwner === owner) {
        setSavedLooksAttempt((attempt) => attempt + 1)
      }
    })
  }, [owner])

  // Story CC-7.7 D5: tabs stay mounted, so returning to the Closet is a focus, never a mount.
  // It reads the inventory and the Saved Looks again in place: the grid, the row and the
  // scroll position stay, and only the first read ever shows the spinner. The first focus is
  // the mount, whose reads are already running.
  const leftClosetRef = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (leftClosetRef.current && epoch === mobileIdentityEpoch()) {
        setLoadAttempt((attempt) => attempt + 1)
        setSavedLooksAttempt((attempt) => attempt + 1)
      }
      leftClosetRef.current = false
      return () => {
        leftClosetRef.current = true
      }
    }, [epoch])
  )

  const loadMoreSavedLooks = useCallback(() => {
    if (
      !owner ||
      savedLooksLoading ||
      savedLooksLoadingMore ||
      savedLooks.length >= savedLooksTotal
    )
      return
    setSavedLooksLoadingMore(true)
    const offset = savedLooks.length
    const startEpoch = epoch
    const startLoadEpoch = savedLooksLoadEpochRef.current
    void listSavedLooksPageFromMobile({ limit: 50, offset })
      .then((page) => {
        if (
          savedLooksLoadEpochRef.current !== startLoadEpoch ||
          startEpoch !== mobileIdentityEpoch()
        ) {
          return
        }
        setSavedLooks((current) => {
          const seen = new Set(current.map((item) => item.id))
          return [...current, ...page.data.filter((item) => !seen.has(item.id))]
        })
        setSavedLooksTotal(page.total)
      })
      .catch(() => undefined)
      .finally(() => {
        if (savedLooksLoadEpochRef.current === startLoadEpoch) {
          setSavedLooksLoadingMore(false)
        }
      })
  }, [
    epoch,
    owner,
    savedLooks.length,
    savedLooksLoading,
    savedLooksLoadingMore,
    savedLooksTotal,
  ])

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    void loadGarments(controller.signal)
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true)
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setIsLoading(false)
        setInventorySettled(true)
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
      .finally(() => {
        if (!controller.signal.aborted) setOnboardingSettled(true)
      })
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
      setErrorMessage('AUTHENTICATION_REQUIRED')
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

          <ScreenGate
            screen="closet"
            ready={closetGateReady(
              inventorySettled,
              onboardingSettled,
              savedLooksSettled
            )}
            // The ScrollView's 24-point gap reaches only its direct children; the gated card,
            // Saved Looks and inventory keep the same spacing inside the gate body.
            style={styles.gatedBody}
          >
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

            <ClosetSavedLooksRow
              owner={owner}
              savedLooks={savedLooks}
              totalCount={savedLooksTotal}
              hasMore={savedLooks.length < savedLooksTotal}
              isLoadingMore={savedLooksLoadingMore}
              onLoadMore={loadMoreSavedLooks}
              // Story CC-7.7 D5: only the first page shows the loading count; a refresh keeps
              // the count on screen until its answer lands.
              isLoading={savedLooksLoading && !savedLooksSettled}
              loadError={savedLooksError}
              garments={garments}
              onRetry={() => setSavedLooksAttempt((attempt) => attempt + 1)}
              onChanged={() => setSavedLooksAttempt((attempt) => attempt + 1)}
              onReopenStylePiece={(look) => {
                const anchor = garments.find((item) => item.id === look.anchorGarmentId)
                if (!anchor || !anchor.category || !anchor.comfortRange) return
                setInitialSavedLook(look)
                openStylePanel({
                  id: anchor.id,
                  category: anchor.category,
                  comfortRange: anchor.comfortRange,
                })
              }}
            />

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

            {/* Story CC-7.7 D5: only the first read shows the spinner; a refresh after a tag
              save, a delete or a Retry keeps the grid or the empty state in place. */}
            {showFirstReadSpinner(isLoading, inventorySettled, visibleGarments.length) ? (
              <ActivityIndicator accessibilityLabel="Loading wardrobe" />
            ) : visibleGarments.length === 0 ? (
              hasLoaded && !loadFailed ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>{t('wardrobe.empty_title')}</Text>
                </View>
              ) : null
            ) : (
              <View style={styles.grid} testID="wardrobe-garment-list">
                {visibleGarments.map((garment) => (
                  <View
                    key={garment.id}
                    style={styles.garmentCard}
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
                        <Text
                          style={[styles.needsTagsText, { color: colors.noticeText }]}
                        >
                          {t('wardrobe.tagging.needs_tags', {
                            defaultValue: 'Needs tags',
                          })}
                        </Text>
                      </Pressable>
                    )}
                    {garment.status === 'failed' && (
                      <Pressable
                        accessibilityRole="button"
                        style={[styles.needsTagsBtn, notice]}
                        onPress={() => setIsCaptureOpen(true)}
                      >
                        <Text
                          style={[styles.needsTagsText, { color: colors.noticeText }]}
                        >
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
                        <Text
                          style={[styles.needsTagsText, { color: colors.noticeText }]}
                        >
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
          </ScreenGate>
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

      {owner && styleSelection && (
        <StylePiecePanel
          selection={styleSelection}
          initialSavedLook={initialSavedLook}
          inWardrobe={garments.some(({ id }) => id === styleSelection.id)}
          loadInventory={loadGarments}
          visible={!styleClosing}
          owner={owner}
          epoch={epoch}
          locale={i18n.language}
          onSavedLooksChanged={() => setSavedLooksAttempt((attempt) => attempt + 1)}
          onClose={() => setStyleClosing(true)}
          onDismiss={() => finishStyleDismissal(styleSelection)}
        />
      )}
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
      <Text numberOfLines={1} style={styles.garmentLabel} testID="garment-card-label">
        {garmentCardLabel(locale, garment)}
      </Text>
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
  gatedBody: { gap: 24 },
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
  garmentLabel: { marginTop: 8, fontSize: 13, fontWeight: '600' },
  errorBox: { borderRadius: 12, padding: 12, gap: 8 },
})

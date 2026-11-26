// Story CC-7.2: Temporary "Saved looks" row on the mobile Closet screen until CC-7.12 ships.
// Story CC-7.11 D4, D8, D12: the row now sits below the Closet grid, the Looks tab lists the same
// looks open (`variant="list"`), and a look's detail is a full-height layer under the app top bar
// with back and the look's title.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import {
  useEffect,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  createAnnouncementToken,
  getGuestPreviewStrings,
  isOfflineError,
  SAMPLE_CATALOG,
  sampleGarmentText,
  sampleLookText,
  savedLookToStylePieceRecipe,
  stylePieceAnchor,
  stylePieceLooks,
  visibleStylePieceLooks,
  type SampleWeatherKey,
} from '@couture/utils'
import {
  EdgeToEdgeModal,
  LayerSwipeHandle,
  useModalInsets,
} from '@/components/edge-to-edge-modal'
import { AppTopBar } from '@/src/components/app-top-bar-view'
import { useHeroPalette } from '@/components/hero/hero-theme'
import {
  checkNetworkOnlineForAction,
  getNetworkOnline,
  hasReliableBrowserOnline,
  reportNetworkOffline,
  SaveFeedbackProvider,
  useStatusBar,
} from '@/components/save-feedback'
import { useSchemeColors } from '@/components/themed'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
} from '@/src/lib/mobile-auth'
import {
  deleteSavedLookFromMobile,
  formatSavedLookIfMatch,
  getSavedLookFromMobile,
  MobileSavedLookRequestError,
  notifyMobileSavedLooksChanged,
  restoreSavedLookFromMobile,
} from '@/src/lib/saved-looks'
import { PreviewButton, SampleGarmentArt } from '../preview/guest-preview-parts'

const CATALOG_BY_ID = new Map(SAMPLE_CATALOG.garments.map((item) => [item.id, item]))

function sortedSlots(look: SavedLookContract) {
  return [...look.composition].sort((a, b) => a.slotIndex - b.slotIndex)
}

function editorPreservesExactComposition(
  look: SavedLookContract,
  anchor: GarmentItemContract
): boolean {
  const selection = stylePieceAnchor(anchor)
  const recipe = savedLookToStylePieceRecipe(look)
  if (!selection || !recipe) return false
  const generated = visibleStylePieceLooks(
    stylePieceLooks(selection, recipe.weather, SAMPLE_CATALOG).looks,
    { [recipe.lookId]: recipe },
    { reopenedLookId: recipe.lookId }
  )
  const matched = generated.find((entry) => entry.recipe.lookId === recipe.lookId)
  if (!matched) return false
  const expectedSlots = [
    { kind: 'garment', category: selection.category, itemId: anchor.id },
    ...matched.companions.map((companion) => ({
      kind: 'catalog',
      category: companion.category,
      itemId: companion.id,
    })),
  ]
  const stored = sortedSlots(look)
  if (stored.length !== expectedSlots.length) return false
  return stored.every((slot, index) => {
    const expected = expectedSlots[index]
    return (
      expected !== undefined &&
      slot.slotIndex === index &&
      slot.kind === expected.kind &&
      slot.category === expected.category &&
      slot.itemId === expected.itemId
    )
  })
}

function isSlotImageValid(
  lookId: string,
  slot: SavedLookContract['composition'][number],
  failedImageKeys: ReadonlySet<string>
): boolean {
  if (!slot.imageAccess?.url) return false
  const expiresAtMs = Date.parse(slot.imageAccess.expiresAt)
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return false
  return !failedImageKeys.has(`${lookId}:${slot.slotIndex}:${slot.imageAccess.url}`)
}

function SavedLookStatusBadges({
  status,
  missingLabel,
  needsReviewLabel,
  color,
}: {
  status: SavedLookContract['availabilityStatus']
  missingLabel: string
  needsReviewLabel: string
  color: string
}) {
  if (status === 'missing_garment') {
    return (
      <Text testID="saved-look-missing-garment" style={[styles.badge, { color }]}>
        {missingLabel}
      </Text>
    )
  }
  if (status === 'needs_review') {
    return (
      <Text testID="saved-look-needs-review" style={[styles.badge, { color }]}>
        {needsReviewLabel}
      </Text>
    )
  }
  return null
}

function SavedLookDetailNotices({
  status,
  missingDetail,
  needsReviewDetail,
  color,
}: {
  status: SavedLookContract['availabilityStatus']
  missingDetail: string
  needsReviewDetail: string
  color: string
}) {
  if (status === 'missing_garment') {
    return (
      <Text testID="saved-look-detail-missing" style={{ color }}>
        {missingDetail}
      </Text>
    )
  }
  if (status === 'needs_review') {
    return (
      <Text testID="saved-look-detail-needs-review" style={{ color }}>
        {needsReviewDetail}
      </Text>
    )
  }
  return null
}

/** The saved looks read failed: the message and Retry. Nothing while the read is fine. */
function SavedLooksLoadError({
  error,
  palette,
  onRetry,
}: {
  error: string | null
  palette: ReturnType<typeof useHeroPalette>
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const colors = useSchemeColors()
  if (!error) return null
  return (
    <View
      accessibilityRole="alert"
      style={[styles.errorBox, { backgroundColor: colors.dangerSurface }]}
    >
      <Text style={{ color: colors.dangerInk }}>{t('savedLooks.loadFailed')}</Text>
      <PreviewButton
        label={t('savedLooks.retry')}
        testID="saved-looks-retry"
        palette={palette}
        onPress={onRetry}
      />
    </View>
  )
}

/** The Closet row's header: the title and count, and the show or hide toggle. */
function SavedLooksToggle({
  expanded,
  count,
  onToggle,
}: {
  expanded: boolean
  count: string
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const colors = useSchemeColors()
  return (
    <Pressable
      accessibilityRole="button"
      aria-expanded={expanded}
      testID="closet-saved-looks-row"
      style={styles.headerButton}
      onPress={onToggle}
    >
      <View>
        <Text style={[styles.title, { color: colors.ink }]}>{t('savedLooks.title')}</Text>
        <Text style={[styles.count, { color: colors.ink }]}>{count}</Text>
      </View>
      <Text style={[styles.toggle, { color: colors.ink }]}>
        {expanded ? t('savedLooks.hideList') : t('savedLooks.showList')}
      </Text>
    </Pressable>
  )
}

async function ensureMobileOnline(readLiveOnline: () => boolean): Promise<boolean> {
  if (readLiveOnline()) return true
  if (hasReliableBrowserOnline()) return false
  return checkNetworkOnlineForAction()
}

export type ClosetSavedLooksRowProps = {
  owner: string | null
  savedLooks: SavedLookContract[]
  totalCount?: number
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
  isLoading: boolean
  loadError: string | null
  garments: GarmentItemContract[]
  onRetry: () => void
  onChanged: () => void
  /**
   * Opens a Style piece look in its editor. `opener` is the Reopen button pressed, which takes
   * focus back once the editor closes (Story CC-7.11 D13).
   */
  onReopenStylePiece: (
    look: SavedLookContract,
    opener: ComponentRef<typeof Pressable> | null
  ) => void
  /**
   * `row` (default): the Closet's collapsible card. `list`: the Looks tab's open list, with no
   * toggle and no card around the looks, so they are the screen's own content.
   */
  variant?: 'row' | 'list'
}

export function ClosetSavedLooksRow(props: ClosetSavedLooksRowProps) {
  const { hasProvider } = useStatusBar()
  if (!props.owner) return null
  if (hasProvider) {
    return <ClosetSavedLooksRowInner {...props} />
  }
  return (
    <SaveFeedbackProvider inline renderOfflineLine={false}>
      <ClosetSavedLooksRowInner {...props} />
    </SaveFeedbackProvider>
  )
}

function ClosetSavedLooksRowInner({
  owner,
  savedLooks,
  totalCount,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  isLoading,
  loadError,
  garments,
  onRetry,
  onChanged,
  onReopenStylePiece,
  variant = 'row',
}: ClosetSavedLooksRowProps) {
  const { t, i18n } = useTranslation()
  const samples = getGuestPreviewStrings(i18n.language)
  const colors = useSchemeColors()
  const palette = useHeroPalette()
  const statusBar = useStatusBar()
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const mountedRef = useRef(true)
  const ownedNoticeIdsRef = useRef<Set<string>>(new Set())
  const detailLookIdRef = useRef<string | null>(null)
  const [toggledOpen, setExpanded] = useState(false)
  const expanded = variant === 'list' || toggledOpen
  // D13: the Reopen button that opened a look's detail takes focus back when it closes.
  const reopenButtons = useRef(new Map<string, ComponentRef<typeof Pressable>>())
  const detailOpener = useRef<ComponentRef<typeof Pressable> | null>(null)
  const [detailLook, setDetailLook] = useState<SavedLookContract | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [failedImageKeys, setFailedImageKeys] = useState<Set<string>>(() => new Set())
  const noticeSeqRef = useRef(0)
  detailLookIdRef.current = detailLook?.id ?? null

  const isActiveOwnerSession = (
    actionOwner: string | null,
    actionEpoch: number
  ): boolean => {
    if (!mountedRef.current || !actionOwner || ownerRef.current !== actionOwner) {
      return false
    }
    if (mobileIdentityEpoch() !== actionEpoch) return false
    const liveUser = mobileApplicationUserId()
    return liveUser === null || liveUser === actionOwner
  }

  const showOwnedNotice = (
    actionOwner: string | null,
    actionEpoch: number,
    notice: Parameters<typeof statusBar.showNotice>[0]
  ) => {
    if (!isActiveOwnerSession(actionOwner, actionEpoch)) return
    ownedNoticeIdsRef.current.add(notice.id)
    statusBarRef.current.showNotice(notice)
  }

  useEffect(() => {
    mountedRef.current = true
    const owned = ownedNoticeIdsRef.current
    return () => {
      mountedRef.current = false
      for (const id of owned) {
        statusBarRef.current.dismissNotice(id)
      }
      owned.clear()
    }
  }, [])

  useEffect(() => {
    const owned = ownedNoticeIdsRef.current
    setDetailLook(null)
    setRemovingId(null)
    setFailedImageKeys(new Set())
    return () => {
      for (const id of owned) {
        statusBarRef.current.dismissNotice(id)
      }
      owned.clear()
    }
  }, [owner])

  const readLiveOnline = () => getNetworkOnline()

  const weatherLabel = (weather: string) =>
    samples.values.weather[weather as SampleWeatherKey] ?? weather

  const isSlotPhotoUsable = (
    lookId: string,
    slot: SavedLookContract['composition'][number]
  ): boolean => isSlotImageValid(lookId, slot, failedImageKeys)

  const canReopenInStylePiece = (look: SavedLookContract): boolean => {
    if (look.source !== 'style_piece' || look.availabilityStatus !== 'ready') {
      return false
    }
    const anchor = garments.find((item) => item.id === look.anchorGarmentId)
    return Boolean(anchor && editorPreservesExactComposition(look, anchor))
  }

  const handleReopen = (look: SavedLookContract) => {
    // D13: the Reopen pressed takes focus back from whichever layer it opens.
    const opener = reopenButtons.current.get(look.id) ?? null
    if (canReopenInStylePiece(look)) {
      onReopenStylePiece(look, opener)
      return
    }
    detailOpener.current = opener
    setDetailLook(look)
    const needsPhotoRefresh = look.composition.some(
      (slot) =>
        slot.kind === 'garment' && !slot.missing && !isSlotPhotoUsable(look.id, slot)
    )
    if (needsPhotoRefresh && owner) {
      const actionOwner = owner
      const actionEpoch = mobileIdentityEpoch()
      void resolveMobileAccessToken()
        .catch(() => null)
        .then((token) =>
          getSavedLookFromMobile(look.id, { accessToken: token ?? undefined })
        )
        .then((fresh) => {
          if (
            !isActiveOwnerSession(actionOwner, actionEpoch) ||
            detailLookIdRef.current !== look.id
          ) {
            return
          }
          setDetailLook(fresh)
        })
        .catch(() => undefined)
    }
  }

  const showActionError = (
    actionOwner: string | null,
    actionEpoch: number,
    kind: string,
    error: unknown,
    retry?: {
      id: 'retry' | 'undo'
      kind: 'retry' | 'undo'
      label: string
      onPress: () => void
    }
  ) => {
    const seq = ++noticeSeqRef.current
    const offline = isOfflineError(error) || !readLiveOnline()
    if (offline) reportNetworkOffline()
    showOwnedNotice(actionOwner, actionEpoch, {
      id: `${kind}-${offline ? 'offline' : 'failed'}-${seq}`,
      announcementId: createAnnouncementToken(
        `${kind}-${offline ? 'offline' : 'failed'}`,
        seq
      ),
      message: offline ? t('feedback.offlineAction') : t('feedback.saveFailed'),
      tone: offline ? 'offline' : 'error',
      actions: retry ? [retry] : [],
    })
  }

  const runUndoRemove = async (
    look: SavedLookContract,
    actionOwner: string | null,
    actionEpoch: number,
    actionToken: string | undefined
  ) => {
    if (!isActiveOwnerSession(actionOwner, actionEpoch)) return
    const reachable = await ensureMobileOnline(readLiveOnline)
    if (!isActiveOwnerSession(actionOwner, actionEpoch)) return
    const retryUndo = () => {
      void runUndoRemove(look, actionOwner, actionEpoch, actionToken)
    }
    if (!reachable) {
      showActionError(
        actionOwner,
        actionEpoch,
        'mobile-saved-look-undo',
        new TypeError('Failed to fetch'),
        { id: 'undo', kind: 'undo', label: t('feedback.undo'), onPress: retryUndo }
      )
      return
    }
    try {
      await restoreSavedLookFromMobile(look.id, { accessToken: actionToken })
      if (!isActiveOwnerSession(actionOwner, actionEpoch)) return
      onChanged()
      notifyMobileSavedLooksChanged(actionOwner)
      const undoSeq = ++noticeSeqRef.current
      showOwnedNotice(actionOwner, actionEpoch, {
        id: `mobile-saved-look-undo-${undoSeq}`,
        announcementId: createAnnouncementToken('mobile-saved-look-undo', undoSeq),
        message: t('feedback.undone'),
        tone: 'neutral',
      })
    } catch (undoError) {
      if (!isActiveOwnerSession(actionOwner, actionEpoch)) return
      const offline = isOfflineError(undoError) || !readLiveOnline()
      showActionError(actionOwner, actionEpoch, 'mobile-saved-look-undo', undoError, {
        id: 'retry',
        kind: 'retry',
        label: offline ? t('feedback.undo') : t('feedback.retry'),
        onPress: retryUndo,
      })
    }
  }

  const handleRemove = async (look: SavedLookContract) => {
    const actionOwner = owner
    const actionEpoch = mobileIdentityEpoch()
    if (!isActiveOwnerSession(actionOwner, actionEpoch)) return

    const reachable = await ensureMobileOnline(readLiveOnline)
    if (!isActiveOwnerSession(actionOwner, actionEpoch)) return
    if (!reachable) {
      showActionError(
        actionOwner,
        actionEpoch,
        'mobile-saved-look-remove',
        new TypeError('Failed to fetch')
      )
      return
    }

    const actionToken = (await resolveMobileAccessToken().catch(() => null)) ?? undefined
    if (!isActiveOwnerSession(actionOwner, actionEpoch)) return

    setRemovingId(look.id)
    let alreadyDeleted = false
    try {
      await deleteSavedLookFromMobile(
        look.id,
        formatSavedLookIfMatch(look.id, look.revision),
        { accessToken: actionToken }
      )
    } catch (error) {
      if (!isActiveOwnerSession(actionOwner, actionEpoch)) return
      if (error instanceof MobileSavedLookRequestError && error.status === 404) {
        alreadyDeleted = true
      } else {
        const offline = isOfflineError(error) || !readLiveOnline()
        showActionError(
          actionOwner,
          actionEpoch,
          'mobile-saved-look-remove',
          error,
          offline
            ? undefined
            : {
                id: 'retry',
                kind: 'retry',
                label: t('feedback.retry'),
                onPress: () => {
                  if (isActiveOwnerSession(actionOwner, actionEpoch))
                    void handleRemove(look)
                },
              }
        )
        setRemovingId(null)
        return
      }
    }

    if (!isActiveOwnerSession(actionOwner, actionEpoch)) return
    setRemovingId(null)
    if (detailLookIdRef.current === look.id) setDetailLook(null)
    onChanged()
    notifyMobileSavedLooksChanged(actionOwner)

    let undoInFlight = false
    const seq = ++noticeSeqRef.current
    showOwnedNotice(actionOwner, actionEpoch, {
      id: `mobile-saved-look-remove-${seq}`,
      announcementId: createAnnouncementToken('mobile-saved-look-remove', seq),
      message: t('feedback.removed'),
      tone: 'neutral',
      actions: alreadyDeleted
        ? []
        : [
            {
              id: 'undo',
              kind: 'undo',
              label: t('feedback.undo'),
              onPress: async () => {
                if (undoInFlight) return
                undoInFlight = true
                try {
                  await runUndoRemove(look, actionOwner, actionEpoch, actionToken)
                } finally {
                  undoInFlight = false
                }
              },
            },
          ],
    })
  }

  const renderSlot = (lookId: string, slot: SavedLookContract['composition'][number]) => {
    if (slot.kind === 'catalog') {
      const catalogItem = CATALOG_BY_ID.get(slot.itemId)
      const label = catalogItem
        ? sampleGarmentText(catalogItem, samples).name
        : (slot.label ?? samples.values.category[slot.category])
      return (
        <View
          key={`${slot.slotIndex}-${slot.itemId}`}
          testID={`saved-look-slot-${slot.slotIndex}`}
          accessibilityHint={slot.itemId}
          style={[styles.slotChip, { borderColor: colors.lineStrong }]}
        >
          {catalogItem ? <SampleGarmentArt garment={catalogItem} size={24} /> : null}
          <Text style={[styles.slotText, { color: colors.ink }]}>{label}</Text>
        </View>
      )
    }

    if (slot.missing) {
      return (
        <View
          key={`${slot.slotIndex}-${slot.itemId}`}
          testID={`saved-look-slot-${slot.slotIndex}`}
          accessibilityHint={slot.itemId}
          style={[
            styles.slotChip,
            {
              borderColor: colors.noticeLine,
              backgroundColor: colors.noticeSurface,
            },
          ]}
        >
          <Text style={[styles.slotText, { color: colors.noticeInk }]}>
            {`${samples.values.category[slot.category]} · ${t('savedLooks.missingPiece')}`}
          </Text>
        </View>
      )
    }

    const photoUsable = isSlotPhotoUsable(lookId, slot)
    const photoKey = slot.imageAccess?.url
      ? `${lookId}:${slot.slotIndex}:${slot.imageAccess.url}`
      : null

    return (
      <View
        key={`${slot.slotIndex}-${slot.itemId}`}
        testID={`saved-look-slot-${slot.slotIndex}`}
        accessibilityHint={slot.itemId}
        style={[styles.slotChip, { borderColor: colors.lineStrong }]}
      >
        {photoUsable && slot.imageAccess ? (
          <Image
            source={{ uri: slot.imageAccess.url }}
            accessibilityLabel={samples.values.category[slot.category]}
            style={styles.slotImage}
            onError={() => {
              if (!photoKey) return
              setFailedImageKeys((prev) => {
                if (prev.has(photoKey)) return prev
                const next = new Set(prev)
                next.add(photoKey)
                return next
              })
            }}
          />
        ) : (
          <View
            testID="saved-look-photo-placeholder"
            style={[styles.photoFallback, { backgroundColor: colors.noticeSurface }]}
          >
            <Text style={[styles.photoFallbackText, { color: colors.noticeInk }]}>
              {samples.values.category[slot.category].slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )}
        <Text style={[styles.slotText, { color: colors.ink }]}>
          {photoUsable
            ? samples.values.category[slot.category]
            : `${samples.values.category[slot.category]} · ${t('savedLooks.photoUnavailable')}`}
        </Text>
      </View>
    )
  }

  const displayedCount = totalCount ?? savedLooks.length
  const sourceLabel = (look: SavedLookContract) =>
    look.source === 'style_piece'
      ? t('savedLooks.sourceStylePiece')
      : t('savedLooks.sourceHomeSample')
  const titleOf = (look: SavedLookContract) =>
    look.title || sampleLookText({ id: look.lookId }, samples).name || look.lookId

  return (
    <View
      style={
        variant === 'list'
          ? styles.listContainer
          : [styles.container, { borderColor: colors.lineStrong }]
      }
    >
      {variant === 'row' ? (
        <SavedLooksToggle
          expanded={expanded}
          count={
            isLoading && savedLooks.length === 0
              ? '…'
              : t('savedLooks.count', { count: displayedCount })
          }
          onToggle={() => setExpanded((current) => !current)}
        />
      ) : null}

      <SavedLooksLoadError error={loadError} palette={palette} onRetry={onRetry} />

      {expanded ? (
        <View testID="closet-saved-looks-list" style={styles.list}>
          {savedLooks.length === 0 ? (
            <Text style={{ color: colors.ink }}>{t('savedLooks.empty')}</Text>
          ) : (
            savedLooks.map((look) => {
              const title = titleOf(look)
              return (
                <View
                  key={look.id}
                  testID={`saved-look-card-${look.id}`}
                  style={[styles.card, { borderColor: colors.lineStrong }]}
                >
                  <Text style={[styles.cardTitle, { color: colors.ink }]}>{title}</Text>
                  <Text style={[styles.meta, { color: colors.ink }]}>
                    {`${weatherLabel(look.weather)} · ${sourceLabel(look)}`}
                  </Text>
                  <SavedLookStatusBadges
                    status={look.availabilityStatus}
                    missingLabel={t('savedLooks.missingPiece')}
                    needsReviewLabel={t('savedLooks.needsReview')}
                    color={colors.noticeInk}
                  />
                  <View style={styles.slotsRow}>
                    {sortedSlots(look).map((slot) => renderSlot(look.id, slot))}
                  </View>
                  <View style={styles.actionsRow}>
                    <PreviewButton
                      label={t('savedLooks.reopen')}
                      testID="saved-look-reopen"
                      palette={palette}
                      buttonRef={(button) => {
                        if (button) reopenButtons.current.set(look.id, button)
                        else reopenButtons.current.delete(look.id)
                      }}
                      onPress={() => handleReopen(look)}
                    />
                    <PreviewButton
                      label={t('savedLooks.remove')}
                      testID="saved-look-remove"
                      palette={palette}
                      disabled={removingId === look.id}
                      onPress={() => void handleRemove(look)}
                    />
                  </View>
                </View>
              )
            })
          )}
          {hasMore && onLoadMore ? (
            <PreviewButton
              label={isLoadingMore ? '…' : t('savedLooks.showList')}
              testID="saved-looks-load-more"
              palette={palette}
              disabled={isLoadingMore}
              onPress={onLoadMore}
            />
          ) : null}
        </View>
      ) : null}

      {detailLook ? (
        <SavedLookDetailLayer
          look={detailLook}
          title={titleOf(detailLook) || t('savedLooks.detailTitle')}
          meta={`${weatherLabel(detailLook.weather)} · ${sourceLabel(detailLook)}`}
          removing={removingId === detailLook.id}
          opener={detailOpener}
          onClose={() => setDetailLook(null)}
          onRemove={() => void handleRemove(detailLook)}
          renderSlot={renderSlot}
        />
      ) : null}
    </View>
  )
}

/**
 * D12: a saved look's detail, a full-height layer. Its header is the app top bar with back and
 * the look's title, which is also the swipe-down handle (D13); focus returns to its Reopen.
 */
function SavedLookDetailLayer({
  look,
  title,
  meta,
  removing,
  opener,
  onClose,
  onRemove,
  renderSlot,
}: {
  look: SavedLookContract
  title: string
  meta: string
  removing: boolean
  opener: RefObject<unknown>
  onClose: () => void
  onRemove: () => void
  renderSlot: (
    lookId: string,
    slot: SavedLookContract['composition'][number]
  ) => ReactNode
}) {
  const { t } = useTranslation()
  const colors = useSchemeColors()
  const palette = useHeroPalette()
  const insets = useModalInsets()
  return (
    <EdgeToEdgeModal
      visible
      transparent={false}
      animationType="none"
      onRequestClose={onClose}
      returnFocusRef={opener}
    >
      <View
        testID="saved-look-detail-modal"
        accessibilityViewIsModal
        style={[
          styles.modal,
          { backgroundColor: palette.page, paddingBottom: insets.bottom },
        ]}
      >
        <LayerSwipeHandle>
          <AppTopBar title={title} onBack={onClose} />
        </LayerSwipeHandle>
        <ScrollView testID="layer-body" contentContainerStyle={styles.modalBody}>
          <Text style={{ color: palette.ink }}>{meta}</Text>
          <SavedLookDetailNotices
            status={look.availabilityStatus}
            missingDetail={t('savedLooks.missingPieceDetail')}
            needsReviewDetail={t('savedLooks.needsReviewDetail')}
            color={colors.noticeInk}
          />
          <Text style={[styles.cardTitle, { color: palette.ink }]}>
            {t('savedLooks.slotOrderLabel')}
          </Text>
          <View style={styles.slotsRow}>
            {sortedSlots(look).map((slot) => renderSlot(look.id, slot))}
          </View>
          <PreviewButton
            label={t('savedLooks.remove')}
            testID="saved-look-detail-remove"
            palette={palette}
            disabled={removing}
            onPress={onRemove}
          />
        </ScrollView>
      </View>
    </EdgeToEdgeModal>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  headerButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { fontSize: 16, fontWeight: '700' },
  count: { fontSize: 12, opacity: 0.75 },
  toggle: { fontSize: 14, fontWeight: '600' },
  errorBox: { borderRadius: 12, padding: 12, gap: 8 },
  list: { gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 12, opacity: 0.75 },
  badge: { fontSize: 12, fontWeight: '700' },
  slotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  slotImage: { width: 24, height: 24, borderRadius: 4 },
  photoFallback: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFallbackText: { fontSize: 12, fontWeight: '700' },
  slotText: { fontSize: 12 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // The open list on the Looks tab: the looks are the screen's content, with no card around them.
  listContainer: { gap: 12 },
  modal: { flex: 1 },
  modalBody: { gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
})

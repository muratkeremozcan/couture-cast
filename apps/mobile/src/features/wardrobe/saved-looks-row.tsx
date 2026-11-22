// Story CC-7.2: Temporary "Saved looks" row at the top of the mobile Closet screen until CC-7.12 ships.
import { useEffect, useRef, useState } from 'react'
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
import { EdgeToEdgeModal, useModalInsets } from '@/components/edge-to-edge-modal'
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
  onReopenStylePiece: (look: SavedLookContract) => void
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
}: ClosetSavedLooksRowProps) {
  const { t, i18n } = useTranslation()
  const samples = getGuestPreviewStrings(i18n.language)
  const colors = useSchemeColors()
  const palette = useHeroPalette()
  const insets = useModalInsets()
  const statusBar = useStatusBar()
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const mountedRef = useRef(true)
  const ownedNoticeIdsRef = useRef<Set<string>>(new Set())
  const detailLookIdRef = useRef<string | null>(null)
  const [expanded, setExpanded] = useState(false)
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

  const readLiveOnline = () => statusBarRef.current.isOnline && getNetworkOnline()

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
    if (canReopenInStylePiece(look)) {
      onReopenStylePiece(look)
      return
    }
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
    retry?: () => void
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
      actions:
        !offline && retry
          ? [{ id: 'retry', kind: 'retry', label: t('feedback.retry'), onPress: retry }]
          : [],
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
    if (!reachable) {
      showActionError(
        actionOwner,
        actionEpoch,
        'mobile-saved-look-undo',
        new TypeError('Failed to fetch')
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
      showActionError(actionOwner, actionEpoch, 'mobile-saved-look-undo', undoError)
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
        showActionError(
          actionOwner,
          actionEpoch,
          'mobile-saved-look-remove',
          error,
          () => {
            if (isActiveOwnerSession(actionOwner, actionEpoch)) void handleRemove(look)
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
          style={[styles.slotChip, { borderColor: colors.strongBorder }]}
        >
          {catalogItem ? <SampleGarmentArt garment={catalogItem} size={24} /> : null}
          <Text style={[styles.slotText, { color: colors.text }]}>{label}</Text>
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
              borderColor: colors.noticeBorder,
              backgroundColor: colors.noticeSurface,
            },
          ]}
        >
          <Text style={[styles.slotText, { color: colors.noticeText }]}>
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
        style={[styles.slotChip, { borderColor: colors.strongBorder }]}
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
            <Text style={[styles.photoFallbackText, { color: colors.noticeText }]}>
              {samples.values.category[slot.category].slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )}
        <Text style={[styles.slotText, { color: colors.text }]}>
          {photoUsable
            ? samples.values.category[slot.category]
            : `${samples.values.category[slot.category]} · ${t('savedLooks.photoUnavailable')}`}
        </Text>
      </View>
    )
  }

  const displayedCount = totalCount ?? savedLooks.length

  return (
    <View style={[styles.container, { borderColor: colors.strongBorder }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        testID="closet-saved-looks-row"
        style={styles.headerButton}
        onPress={() => setExpanded((current) => !current)}
      >
        <View>
          <Text style={[styles.title, { color: colors.text }]}>
            {t('savedLooks.title')}
          </Text>
          <Text style={[styles.count, { color: colors.text }]}>
            {isLoading && savedLooks.length === 0
              ? '…'
              : t('savedLooks.count', { count: displayedCount })}
          </Text>
        </View>
        <Text style={[styles.toggle, { color: colors.text }]}>
          {expanded ? t('savedLooks.hideList') : t('savedLooks.showList')}
        </Text>
      </Pressable>

      {loadError ? (
        <View
          accessibilityRole="alert"
          style={[styles.errorBox, { backgroundColor: colors.dangerSurface }]}
        >
          <Text style={{ color: colors.dangerText }}>{t('savedLooks.loadFailed')}</Text>
          <PreviewButton
            label={t('savedLooks.retry')}
            testID="saved-looks-retry"
            palette={palette}
            onPress={onRetry}
          />
        </View>
      ) : null}

      {expanded ? (
        <View testID="closet-saved-looks-list" style={styles.list}>
          {savedLooks.length === 0 ? (
            <Text style={{ color: colors.text }}>{t('savedLooks.empty')}</Text>
          ) : (
            savedLooks.map((look) => {
              const title =
                look.title ||
                sampleLookText({ id: look.lookId }, samples).name ||
                look.lookId
              return (
                <View
                  key={look.id}
                  testID={`saved-look-card-${look.id}`}
                  style={[styles.card, { borderColor: colors.strongBorder }]}
                >
                  <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
                  <Text style={[styles.meta, { color: colors.text }]}>
                    {`${weatherLabel(look.weather)} · ${
                      look.source === 'style_piece'
                        ? t('savedLooks.sourceStylePiece')
                        : t('savedLooks.sourceHomeSample')
                    }`}
                  </Text>
                  <SavedLookStatusBadges
                    status={look.availabilityStatus}
                    missingLabel={t('savedLooks.missingPiece')}
                    needsReviewLabel={t('savedLooks.needsReview')}
                    color={colors.noticeText}
                  />
                  <View style={styles.slotsRow}>
                    {sortedSlots(look).map((slot) => renderSlot(look.id, slot))}
                  </View>
                  <View style={styles.actionsRow}>
                    <PreviewButton
                      label={t('savedLooks.reopen')}
                      testID="saved-look-reopen"
                      palette={palette}
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
        <EdgeToEdgeModal
          visible
          transparent={false}
          animationType="none"
          onRequestClose={() => setDetailLook(null)}
        >
          <View
            testID="saved-look-detail-modal"
            style={[
              styles.modal,
              {
                backgroundColor: palette.background,
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text
                accessibilityRole="header"
                style={[styles.modalTitle, { color: palette.text }]}
              >
                {t('savedLooks.detailTitle')}
              </Text>
              <PreviewButton
                label={t('savedLooks.close')}
                testID="saved-look-detail-close"
                palette={palette}
                onPress={() => setDetailLook(null)}
              />
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <Text style={{ color: palette.text }}>
                {`${weatherLabel(detailLook.weather)} · ${
                  detailLook.source === 'style_piece'
                    ? t('savedLooks.sourceStylePiece')
                    : t('savedLooks.sourceHomeSample')
                }`}
              </Text>
              <SavedLookDetailNotices
                status={detailLook.availabilityStatus}
                missingDetail={t('savedLooks.missingPieceDetail')}
                needsReviewDetail={t('savedLooks.needsReviewDetail')}
                color={colors.noticeText}
              />
              <Text style={[styles.cardTitle, { color: palette.text }]}>
                {t('savedLooks.slotOrderLabel')}
              </Text>
              <View style={styles.slotsRow}>
                {sortedSlots(detailLook).map((slot) => renderSlot(detailLook.id, slot))}
              </View>
              <PreviewButton
                label={t('savedLooks.remove')}
                testID="saved-look-detail-remove"
                palette={palette}
                disabled={removingId === detailLook.id}
                onPress={() => void handleRemove(detailLook)}
              />
            </ScrollView>
          </View>
        </EdgeToEdgeModal>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
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
  toggle: { fontSize: 13, fontWeight: '600' },
  errorBox: { borderRadius: 10, padding: 12, gap: 8 },
  list: { gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, opacity: 0.75 },
  badge: { fontSize: 12, fontWeight: '700' },
  slotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  photoFallbackText: { fontSize: 10, fontWeight: '700' },
  slotText: { fontSize: 12 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modal: { flex: 1, paddingHorizontal: 16 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalBody: { gap: 12, paddingBottom: 24 },
})

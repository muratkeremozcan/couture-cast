// Story CC-7.2: Temporary "Saved looks" row at the top of the mobile Closet screen until CC-7.12 ships.
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type {
  CreateSavedLookInput,
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  createAnnouncementToken,
  createIdempotencyKey,
  getGuestPreviewStrings,
  isOfflineError,
  SAMPLE_CATALOG,
  sampleGarmentText,
  sampleLookText,
  stylePieceAnchor,
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
  createSavedLookFromMobile,
  deleteSavedLookFromMobile,
  formatSavedLookIfMatch,
} from '@/src/lib/saved-looks'
import { PreviewButton, SampleGarmentArt } from '../preview/guest-preview-parts'

const CATALOG_BY_ID = new Map(SAMPLE_CATALOG.garments.map((item) => [item.id, item]))

function toRecreateInput(look: SavedLookContract): CreateSavedLookInput {
  return {
    source: look.source,
    lookId: look.lookId,
    weather: look.weather,
    title: look.title,
    anchorGarmentId: look.anchorGarmentId,
    anchorSnapshot: look.anchorSnapshot,
    composition: look.composition.map((slot) => ({
      slotIndex: slot.slotIndex,
      category: slot.category,
      kind: slot.kind,
      itemId: slot.itemId,
      label: slot.label,
    })),
    swaps: look.swaps,
    collection: look.collection,
    comfort: look.comfort,
  }
}

export function ClosetSavedLooksRow(props: {
  owner: string | null
  savedLooks: SavedLookContract[]
  isLoading: boolean
  loadError: string | null
  garments: GarmentItemContract[]
  onRetry: () => void
  onChanged: () => void
  onReopenStylePiece: (look: SavedLookContract) => void
}) {
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
  savedLooks,
  isLoading,
  loadError,
  garments,
  onRetry,
  onChanged,
  onReopenStylePiece,
}: {
  owner: string | null
  savedLooks: SavedLookContract[]
  isLoading: boolean
  loadError: string | null
  garments: GarmentItemContract[]
  onRetry: () => void
  onChanged: () => void
  onReopenStylePiece: (look: SavedLookContract) => void
}) {
  const { t, i18n } = useTranslation()
  const samples = getGuestPreviewStrings(i18n.language)
  const colors = useSchemeColors()
  const palette = useHeroPalette()
  const insets = useModalInsets()
  const statusBar = useStatusBar()
  const [expanded, setExpanded] = useState(false)
  const [detailLook, setDetailLook] = useState<SavedLookContract | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const noticeSeqRef = useRef(0)

  const readLiveOnline = () => statusBar.isOnline && getNetworkOnline()

  const weatherLabel = (weather: string) =>
    samples.values.weather[weather as SampleWeatherKey] ?? weather

  const canReopenInStylePiece = (look: SavedLookContract): boolean => {
    if (look.source !== 'style_piece' || look.availabilityStatus !== 'ready') {
      return false
    }
    const anchor = garments.find((item) => item.id === look.anchorGarmentId)
    return Boolean(anchor && stylePieceAnchor(anchor))
  }

  const handleReopen = (look: SavedLookContract) => {
    if (canReopenInStylePiece(look)) {
      onReopenStylePiece(look)
      return
    }
    setDetailLook(look)
  }

  const handleRemove = async (look: SavedLookContract) => {
    if (!readLiveOnline()) {
      const reachable = hasReliableBrowserOnline()
        ? false
        : await checkNetworkOnlineForAction()
      if (!reachable) {
        const seq = ++noticeSeqRef.current
        statusBar.showNotice({
          id: `mobile-saved-look-offline-${seq}`,
          announcementId: createAnnouncementToken('mobile-saved-look-offline', seq),
          message: t('feedback.offlineAction'),
          tone: 'offline',
          actions: [],
        })
        return
      }
    }

    setRemovingId(look.id)
    try {
      await deleteSavedLookFromMobile(
        look.id,
        formatSavedLookIfMatch(look.id, look.revision)
      )
      if (detailLook?.id === look.id) setDetailLook(null)
      onChanged()
      const seq = ++noticeSeqRef.current
      statusBar.showNotice({
        id: `mobile-saved-look-remove-${seq}`,
        announcementId: createAnnouncementToken('mobile-saved-look-remove', seq),
        message: t('feedback.removed'),
        tone: 'neutral',
        actions:
          look.availabilityStatus === 'missing_garment'
            ? []
            : [
                {
                  id: 'undo',
                  kind: 'undo',
                  label: t('feedback.undo'),
                  onPress: async () => {
                    if (!readLiveOnline()) {
                      const reachable = hasReliableBrowserOnline()
                        ? false
                        : await checkNetworkOnlineForAction()
                      if (!reachable) {
                        const offSeq = ++noticeSeqRef.current
                        statusBar.showNotice({
                          id: `mobile-saved-look-undo-offline-${offSeq}`,
                          announcementId: createAnnouncementToken(
                            'mobile-saved-look-undo-offline',
                            offSeq
                          ),
                          message: t('feedback.offlineAction'),
                          tone: 'offline',
                          actions: [],
                        })
                        return
                      }
                    }
                    try {
                      await createSavedLookFromMobile(toRecreateInput(look), {
                        idempotencyKey: createIdempotencyKey(),
                      })
                      onChanged()
                      const undoSeq = ++noticeSeqRef.current
                      statusBar.showNotice({
                        id: `mobile-saved-look-undo-${undoSeq}`,
                        announcementId: createAnnouncementToken(
                          'mobile-saved-look-undo',
                          undoSeq
                        ),
                        message: t('feedback.undone'),
                        tone: 'neutral',
                      })
                    } catch (undoError) {
                      const errSeq = ++noticeSeqRef.current
                      const offline = isOfflineError(undoError) || !readLiveOnline()
                      if (offline) reportNetworkOffline()
                      statusBar.showNotice({
                        id: `mobile-saved-look-undo-${offline ? 'offline' : 'failed'}-${errSeq}`,
                        announcementId: createAnnouncementToken(
                          `mobile-saved-look-undo-${offline ? 'offline' : 'failed'}`,
                          errSeq
                        ),
                        message: offline
                          ? t('feedback.offlineAction')
                          : t('feedback.saveFailed'),
                        tone: offline ? 'offline' : 'error',
                        actions: [],
                      })
                    }
                  },
                },
              ],
      })
    } catch (error) {
      const seq = ++noticeSeqRef.current
      if (isOfflineError(error) || !readLiveOnline()) {
        reportNetworkOffline()
        statusBar.showNotice({
          id: `mobile-saved-look-remove-offline-${seq}`,
          announcementId: createAnnouncementToken(
            'mobile-saved-look-remove-offline',
            seq
          ),
          message: t('feedback.offlineAction'),
          tone: 'offline',
          actions: [],
        })
      } else {
        statusBar.showNotice({
          id: `mobile-saved-look-remove-failed-${seq}`,
          announcementId: createAnnouncementToken('mobile-saved-look-remove-failed', seq),
          message: t('feedback.saveFailed'),
          tone: 'error',
          actions: [
            {
              id: 'retry',
              kind: 'retry',
              label: t('feedback.retry'),
              onPress: () => {
                void handleRemove(look)
              },
            },
          ],
        })
      }
    } finally {
      setRemovingId(null)
    }
  }

  const renderSlot = (slot: SavedLookContract['composition'][number]) => {
    if (slot.kind === 'catalog') {
      const catalogItem = CATALOG_BY_ID.get(slot.itemId)
      const label = catalogItem
        ? sampleGarmentText(catalogItem, samples).name
        : (slot.label ?? samples.values.category[slot.category])
      return (
        <View
          key={`${slot.slotIndex}-${slot.itemId}`}
          testID={`saved-look-slot-${slot.slotIndex}`}
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

    return (
      <View
        key={`${slot.slotIndex}-${slot.itemId}`}
        testID={`saved-look-slot-${slot.slotIndex}`}
        style={[styles.slotChip, { borderColor: colors.strongBorder }]}
      >
        {slot.imageAccess ? (
          <Image
            source={{ uri: slot.imageAccess.url }}
            accessibilityLabel={samples.values.category[slot.category]}
            style={styles.slotImage}
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
          {slot.imageAccess
            ? samples.values.category[slot.category]
            : `${samples.values.category[slot.category]} · ${t('savedLooks.photoUnavailable')}`}
        </Text>
      </View>
    )
  }

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
              : t('savedLooks.count', { count: savedLooks.length })}
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
                  {look.availabilityStatus === 'missing_garment' ? (
                    <Text
                      testID="saved-look-missing-garment"
                      style={[styles.badge, { color: colors.noticeText }]}
                    >
                      {t('savedLooks.missingPiece')}
                    </Text>
                  ) : null}
                  {look.availabilityStatus === 'needs_review' ? (
                    <Text
                      testID="saved-look-needs-review"
                      style={[styles.badge, { color: colors.noticeText }]}
                    >
                      {t('savedLooks.needsReview')}
                    </Text>
                  ) : null}
                  <View style={styles.slotsRow}>
                    {look.composition.map((slot) => renderSlot(slot))}
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
              {detailLook.availabilityStatus === 'missing_garment' ? (
                <Text
                  testID="saved-look-detail-missing"
                  style={{ color: colors.noticeText }}
                >
                  {t('savedLooks.missingPieceDetail')}
                </Text>
              ) : null}
              {detailLook.availabilityStatus === 'needs_review' ? (
                <Text
                  testID="saved-look-detail-needs-review"
                  style={{ color: colors.noticeText }}
                >
                  {t('savedLooks.needsReviewDetail')}
                </Text>
              ) : null}
              <Text style={[styles.cardTitle, { color: palette.text }]}>
                {t('savedLooks.slotOrderLabel')}
              </Text>
              <View style={styles.slotsRow}>
                {detailLook.composition.map((slot) => renderSlot(slot))}
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
  errorBox: { borderRadius: 10, padding: 10, gap: 8 },
  list: { gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  meta: { fontSize: 12, opacity: 0.8 },
  badge: { fontSize: 12, fontWeight: '700' },
  slotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
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
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', flex: 1 },
  modalBody: { paddingHorizontal: 20, paddingVertical: 12, gap: 14 },
})

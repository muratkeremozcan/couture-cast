// Story CC-7.12 D5 owner: a saved look's own native screen (`saved-look/[savedLookId]`). It reads
// the one look, shows its pieces with the missing and needs-review notices, and Remove with Undo.
// View on every save confirmation and every Saved tile open it, so a deep link and back behave
// the same. A look that is gone or not this member's reads like a removed one (TEA P6); signed
// out it asks to sign in and reads nothing. The content moved here from the CC-7.2 Closet row,
// Reopen in Style this piece included (TEA T3).
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
import { router, Stack } from 'expo-router'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type Pressable,
} from 'react-native'
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
  type LooksFilter,
  type SampleWeatherKey,
} from '@couture/utils'
import { useHeroPalette } from '@/components/hero/hero-theme'
import {
  checkNetworkOnlineForAction,
  getNetworkOnline,
  hasReliableBrowserOnline,
  reportNetworkOffline,
  useStatusBar,
} from '@/components/save-feedback'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  subscribeMobileApplicationUser,
  resolveMobileAccessToken,
} from '@/src/lib/mobile-auth'
import { trackOwnedNotice } from './owned-notices'
import {
  deleteSavedLookFromMobile,
  formatSavedLookIfMatch,
  getSavedLookFromMobile,
  MobileSavedLookRequestError,
  notifyMobileSavedLooksChanged,
  restoreSavedLookFromMobile,
} from '@/src/lib/saved-looks'
import { listGarmentsFromMobile } from '@/src/lib/wardrobe'
import { useTokens } from '@/src/theme/tokens'
import { PreviewButton, SampleGarmentArt } from '../preview/guest-preview-parts'
import { focusStylePieceControl, StylePiecePanel } from '../wardrobe/style-piece-panel'
import { savedLooksRoute } from './looks-routes'
import { useSavedLookName } from './looks-tile'
import { reopenAnchorFor } from './saved-look-reopen'

const CATALOG_BY_ID = new Map(SAMPLE_CATALOG.garments.map((item) => [item.id, item]))

type Slot = SavedLookContract['composition'][number]

type DetailState =
  | { kind: 'loading' }
  | { kind: 'ready'; look: SavedLookContract }
  | { kind: 'gone' }
  | { kind: 'failed' }

function sortedSlots(look: SavedLookContract) {
  return [...look.composition].sort((a, b) => a.slotIndex - b.slotIndex)
}

function isSlotImageValid(
  lookId: string,
  slot: Slot,
  failedImageKeys: ReadonlySet<string>
): boolean {
  if (!slot.imageAccess?.url) return false
  const expiresAtMs = Date.parse(slot.imageAccess.expiresAt)
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return false
  return !failedImageKeys.has(`${lookId}:${slot.slotIndex}:${slot.imageAccess.url}`)
}

async function ensureMobileOnline(): Promise<boolean> {
  if (getNetworkOnline()) return true
  if (hasReliableBrowserOnline()) return false
  return checkNetworkOnlineForAction()
}

/** One member's detail; a sign-in, sign-out or account switch mounts a fresh one. */
export function SavedLookDetailScreen({
  savedLookId,
  from,
}: {
  savedLookId: string | undefined
  /** The Saved filter whose tile opened the look; null for View, a deep link or a cold start. */
  from: LooksFilter | null
}) {
  const epoch = useSyncExternalStore(subscribeMobileApplicationUser, mobileIdentityEpoch)
  return (
    <MemberSavedLookDetail
      key={`${epoch}:${savedLookId ?? ''}`}
      epoch={epoch}
      savedLookId={savedLookId}
      from={from}
    />
  )
}

function MemberSavedLookDetail({
  epoch,
  savedLookId,
  from,
}: {
  epoch: number
  savedLookId: string | undefined
  from: LooksFilter | null
}) {
  const { t, i18n } = useTranslation()
  const { colors, space } = useTokens()
  const palette = useHeroPalette()
  const samples = getGuestPreviewStrings(i18n.language)
  const statusBar = useStatusBar()
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const owner = mobileApplicationUserId()
  const nameOf = useSavedLookName()
  const [state, setState] = useState<DetailState>(() =>
    savedLookId ? { kind: 'loading' } : { kind: 'gone' }
  )
  const [attempt, setAttempt] = useState(0)
  const [removing, setRemoving] = useState(false)
  const [failedImageKeys, setFailedImageKeys] = useState<Set<string>>(() => new Set())
  const noticeSeqRef = useRef(0)

  // TEA T3: a Style this piece look reopens in its editor on the anchor garment, so the closet is
  // read for those looks only.
  const styleLook = state.kind === 'ready' && state.look.source === 'style_piece'
  const [garments, setGarments] = useState<GarmentItemContract[]>([])
  const [reopening, setReopening] = useState(false)
  const [reopenClosing, setReopenClosing] = useState(false)
  const reopenButton = useRef<ComponentRef<typeof Pressable> | null>(null)
  const loadInventory = useCallback(
    async (signal: AbortSignal) => {
      const token = await resolveMobileAccessToken()
      if (!token || signal.aborted || epoch !== mobileIdentityEpoch()) return null
      const next = await listGarmentsFromMobile(token, signal)
      if (signal.aborted || epoch !== mobileIdentityEpoch()) return null
      setGarments(next)
      return next
    },
    [epoch]
  )
  useEffect(() => {
    if (!owner || !styleLook) return
    const controller = new AbortController()
    void loadInventory(controller.signal).catch(() => undefined)
    return () => controller.abort()
  }, [loadInventory, owner, styleLook])

  // P6: signed out sends no read; a 404 (removed or another member's) reads as gone.
  useEffect(() => {
    if (!owner || !savedLookId) return
    const controller = new AbortController()
    void getSavedLookFromMobile(savedLookId, { signal: controller.signal })
      .then((look) => {
        if (controller.signal.aborted || epoch !== mobileIdentityEpoch()) return
        setState({ kind: 'ready', look })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || epoch !== mobileIdentityEpoch()) return
        const status = error instanceof MobileSavedLookRequestError ? error.status : 0
        setState(status === 404 || status === 403 ? { kind: 'gone' } : { kind: 'failed' })
      })
    return () => controller.abort()
  }, [attempt, epoch, owner, savedLookId])

  // Codex TEA review #3: every notice is tied to the member who acted and leaves the bar when
  // the identity changes, so the next member never sees it.
  const showOwnedNotice = (
    actionOwner: string | null,
    actionEpoch: number,
    notice: Parameters<typeof statusBarRef.current.showNotice>[0]
  ) => {
    const bar = statusBarRef.current
    bar.showNotice(notice)
    if (actionOwner) {
      trackOwnedNotice(notice.id, actionOwner, actionEpoch, () =>
        bar.dismissNotice(notice.id)
      )
    }
  }

  // The Undo bar outlives this screen (Remove leaves it), so actions check the session only.
  const isLiveSession = (actionOwner: string | null, actionEpoch: number) =>
    Boolean(
      actionOwner &&
        mobileIdentityEpoch() === actionEpoch &&
        mobileApplicationUserId() === actionOwner
    )

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
    if (!isLiveSession(actionOwner, actionEpoch)) return
    const seq = ++noticeSeqRef.current
    const offline = isOfflineError(error) || !getNetworkOnline()
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
    actionOwner: string,
    actionEpoch: number,
    actionToken: string | undefined
  ) => {
    if (!isLiveSession(actionOwner, actionEpoch)) return
    const reachable = await ensureMobileOnline()
    if (!isLiveSession(actionOwner, actionEpoch)) return
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
      if (!isLiveSession(actionOwner, actionEpoch)) return
      // The Looks feed reads again and the tile returns to its place.
      notifyMobileSavedLooksChanged(actionOwner)
      const undoSeq = ++noticeSeqRef.current
      showOwnedNotice(actionOwner, actionEpoch, {
        id: `mobile-saved-look-undo-${undoSeq}`,
        announcementId: createAnnouncementToken('mobile-saved-look-undo', undoSeq),
        message: t('feedback.undone'),
        tone: 'neutral',
      })
    } catch (undoError) {
      const offline = isOfflineError(undoError) || !getNetworkOnline()
      showActionError(actionOwner, actionEpoch, 'mobile-saved-look-undo', undoError, {
        id: 'retry',
        kind: 'retry',
        label: offline ? t('feedback.undo') : t('feedback.retry'),
        onPress: retryUndo,
      })
    }
  }

  /** The DELETE itself: `deleted`, `already` (a 404), or `failed` with its notice shown. */
  const deleteLook = async (
    look: SavedLookContract,
    actionOwner: string,
    actionEpoch: number,
    actionToken: string | undefined
  ): Promise<'deleted' | 'already' | 'failed'> => {
    try {
      await deleteSavedLookFromMobile(
        look.id,
        formatSavedLookIfMatch(look.id, look.revision),
        { accessToken: actionToken }
      )
      return 'deleted'
    } catch (error) {
      if (error instanceof MobileSavedLookRequestError && error.status === 404)
        return 'already'
      const offline = isOfflineError(error) || !getNetworkOnline()
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
                if (isLiveSession(actionOwner, actionEpoch)) void handleRemove(look)
              },
            }
      )
      return 'failed'
    }
  }

  const showRemovedNotice = (
    look: SavedLookContract,
    actionOwner: string,
    actionEpoch: number,
    actionToken: string | undefined,
    undoable: boolean
  ) => {
    let undoInFlight = false
    const seq = ++noticeSeqRef.current
    showOwnedNotice(actionOwner, actionEpoch, {
      id: `mobile-saved-look-remove-${seq}`,
      announcementId: createAnnouncementToken('mobile-saved-look-remove', seq),
      message: t('feedback.removed'),
      tone: 'neutral',
      actions: undoable
        ? [
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
          ]
        : [],
    })
  }

  const handleRemove = async (look: SavedLookContract) => {
    const actionOwner = owner
    const actionEpoch = mobileIdentityEpoch()
    if (!actionOwner || !isLiveSession(actionOwner, actionEpoch)) return
    const reachable = await ensureMobileOnline()
    if (!isLiveSession(actionOwner, actionEpoch)) return
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
    if (!isLiveSession(actionOwner, actionEpoch)) return

    setRemoving(true)
    const outcome = await deleteLook(look, actionOwner, actionEpoch, actionToken)
    if (!isLiveSession(actionOwner, actionEpoch)) return
    if (outcome === 'failed') {
      setRemoving(false)
      return
    }
    notifyMobileSavedLooksChanged(actionOwner)
    showRemovedNotice(look, actionOwner, actionEpoch, actionToken, outcome === 'deleted')
    // P10, T2: opened from a Saved tile, the screen below is that Saved page, so back returns to
    // it; any other entry replaces this screen with Saved.
    if (from !== null && router.canGoBack()) router.back()
    // Fable review P3: a root-stack replace would stack a second tab group; dismiss to Looks.
    else router.dismissTo(savedLooksRoute(from ?? 'all'))
  }

  const renderSlot = (lookId: string, slot: Slot) => {
    const key = `${slot.slotIndex}-${slot.itemId}`
    const categoryLabel = samples.values.category[slot.category]
    if (slot.kind === 'catalog') {
      const catalogItem = CATALOG_BY_ID.get(slot.itemId)
      const label = catalogItem
        ? sampleGarmentText(catalogItem, samples).name
        : (slot.label ?? categoryLabel)
      return (
        <View
          key={key}
          testID={`saved-look-slot-${slot.slotIndex}`}
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
          key={key}
          testID={`saved-look-slot-${slot.slotIndex}`}
          style={[
            styles.slotChip,
            { borderColor: colors.noticeLine, backgroundColor: colors.noticeSurface },
          ]}
        >
          <Text style={[styles.slotText, { color: colors.noticeInk }]}>
            {`${categoryLabel} · ${t('savedLooks.missingPiece')}`}
          </Text>
        </View>
      )
    }
    const photoUsable = isSlotImageValid(lookId, slot, failedImageKeys)
    const photoKey = slot.imageAccess?.url
      ? `${lookId}:${slot.slotIndex}:${slot.imageAccess.url}`
      : null
    return (
      <View
        key={key}
        testID={`saved-look-slot-${slot.slotIndex}`}
        style={[styles.slotChip, { borderColor: colors.lineStrong }]}
      >
        {photoUsable && slot.imageAccess ? (
          <Image
            source={{ uri: slot.imageAccess.url }}
            accessible={false}
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
              {categoryLabel.slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )}
        <Text style={[styles.slotText, { color: colors.ink }]}>
          {photoUsable
            ? categoryLabel
            : `${categoryLabel} · ${t('savedLooks.photoUnavailable')}`}
        </Text>
      </View>
    )
  }

  if (!owner || state.kind !== 'ready') {
    // Signed out wins over a read state: no read is sent then (P6).
    const status = !owner || state.kind === 'ready' ? 'signedOut' : state.kind
    return (
      <DetailStatus
        status={status}
        onRetry={() => {
          setState({ kind: 'loading' })
          setAttempt((value) => value + 1)
        }}
      />
    )
  }

  const body = { gap: space[3], padding: space[4] }
  const { look } = state
  const anchor = reopenAnchorFor(look, garments)
  return (
    <View style={styles.screen} testID="saved-look-detail">
      {/* The root stack's AppTopBar shows the look's name and back; the body has no heading. */}
      <Stack.Screen options={{ title: nameOf(look) || t('savedLooks.detailTitle') }} />
      <ScrollView testID="saved-look-detail-body" contentContainerStyle={body}>
        <DetailHeader look={look} />
        <Text style={[styles.sectionLabel, { color: colors.ink }]}>
          {t('savedLooks.slotOrderLabel')}
        </Text>
        <View style={styles.slotsRow}>
          {sortedSlots(look).map((slot) => renderSlot(look.id, slot))}
        </View>
        {anchor ? (
          <PreviewButton
            label={t('savedLooks.reopen')}
            testID="saved-look-reopen"
            palette={palette}
            buttonRef={reopenButton}
            onPress={() => {
              if (!reopening) setReopening(true)
            }}
          />
        ) : null}
        <PreviewButton
          label={t('savedLooks.remove')}
          testID="saved-look-detail-remove"
          palette={palette}
          disabled={removing}
          onPress={() => void handleRemove(look)}
        />
      </ScrollView>
      {anchor && reopening && anchor.category && anchor.comfortRange ? (
        <StylePiecePanel
          selection={{
            id: anchor.id,
            category: anchor.category,
            comfortRange: anchor.comfortRange,
          }}
          initialSavedLook={look}
          inWardrobe
          loadInventory={loadInventory}
          visible={!reopenClosing}
          owner={owner}
          epoch={epoch}
          locale={i18n.language}
          onSavedLooksChanged={() => setAttempt((value) => value + 1)}
          onClose={() => setReopenClosing(true)}
          onDismiss={() => {
            setReopening(false)
            setReopenClosing(false)
            // CC-7.11 D13: Reopen takes focus back once the editor has gone.
            requestAnimationFrame(() => focusStylePieceControl(reopenButton.current))
          }}
        />
      ) : null}
    </View>
  )
}

/** The look's weather and source, then its missing or needs-review notice. */
function DetailHeader({ look }: { look: SavedLookContract }) {
  const { t, i18n } = useTranslation()
  const { colors } = useTokens()
  const samples = getGuestPreviewStrings(i18n.language)
  const weather = samples.values.weather[look.weather as SampleWeatherKey] ?? look.weather
  const source =
    look.source === 'style_piece'
      ? t('savedLooks.sourceStylePiece')
      : t('savedLooks.sourceHomeSample')
  return (
    <>
      <Text style={{ color: colors.inkMuted }}>{`${weather} · ${source}`}</Text>
      {look.availabilityStatus === 'missing_garment' ? (
        <Text testID="saved-look-detail-missing" style={{ color: colors.noticeInk }}>
          {t('savedLooks.missingPieceDetail')}
        </Text>
      ) : null}
      {look.availabilityStatus === 'needs_review' ? (
        <Text testID="saved-look-detail-needs-review" style={{ color: colors.noticeInk }}>
          {t('savedLooks.needsReviewDetail')}
        </Text>
      ) : null}
    </>
  )
}

/** Every state but a read look: signed out, loading, gone or failed. None has a title (P6). */
function DetailStatus({
  status,
  onRetry,
}: {
  status: 'signedOut' | 'loading' | 'gone' | 'failed'
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const { colors, radius, space, type } = useTokens()
  const palette = useHeroPalette()
  const body = { gap: space[3], padding: space[4] }
  const line = { color: colors.ink, fontSize: type.base.fontSize }
  const testID = {
    signedOut: 'saved-look-detail-sign-in',
    loading: 'saved-look-detail-loading',
    gone: 'saved-look-detail-gone',
    failed: 'saved-look-detail-error',
  }[status]
  return (
    <View style={styles.screen} testID={testID}>
      <Stack.Screen options={{ title: '' }} />
      {status === 'signedOut' ? (
        // Signed out: no read, one way to sign in.
        <View style={body}>
          <Text style={line}>{t('looks.detail.signIn')}</Text>
          <PreviewButton
            label={t('looks.detail.signInAction')}
            testID="saved-look-detail-sign-in-action"
            palette={palette}
            onPress={() => router.push('/signin')}
          />
        </View>
      ) : null}
      {status === 'loading' ? (
        <ActivityIndicator color={colors.ink} style={{ marginTop: space[10] }} />
      ) : null}
      {status === 'gone' ? (
        <View style={body}>
          <Text style={line}>{t('looks.detail.gone')}</Text>
        </View>
      ) : null}
      {status === 'failed' ? (
        <View
          accessibilityRole="alert"
          style={[
            body,
            {
              margin: space[4],
              borderRadius: radius.lg,
              backgroundColor: colors.dangerSurface,
            },
          ]}
        >
          <Text style={{ color: colors.dangerInk }}>{t('savedLooks.loadFailed')}</Text>
          <PreviewButton
            label={t('savedLooks.retry')}
            testID="saved-look-detail-retry"
            palette={palette}
            onPress={onRetry}
          />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  sectionLabel: { fontSize: 16, fontWeight: '600' },
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
})

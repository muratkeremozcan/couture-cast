import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
  type Ref,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  AccessibilityInfo,
  AppState,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  buildStylePieceSavedLookInput,
  createAnnouncementToken,
  createIdempotencyKey,
  createStylePieceRefresh,
  formatPreviewString,
  formatSampleTemperature,
  getGuestPreviewStrings,
  getStylePieceStrings,
  initialStylePieceWeather,
  isOfflineError,
  isStylePieceTagged,
  popLookUndoSnapshot,
  pushLookUndoSnapshot,
  SAMPLE_CATALOG,
  sampleGarmentText,
  SAMPLE_WEATHER,
  savedLookToStylePieceRecipe,
  STYLE_PIECE_WEATHER_KEYS,
  stylePieceAnchor,
  stylePieceLooks,
  stylePieceRecipeKey,
  stylePieceSwapOptions,
  visibleStylePieceLooks,
  type SampleGarmentCategory,
  type StylePieceWeatherKey,
  type StylePieceLook,
  type StylePieceAnchor,
  type StylePiecePhotoAnchor,
  type StylePieceSelection,
  type StylePieceRecipe,
} from '@couture/utils'
import { EdgeToEdgeModal, useModalInsets } from '@/components/edge-to-edge-modal'
import { useHeroPalette } from '@/components/hero/hero-theme'
import {
  checkNetworkOnlineForAction,
  getNetworkOnline,
  hasReliableBrowserOnline,
  reportNetworkOffline,
  SaveActionButton,
  SaveFeedbackProvider,
  useStatusBar,
} from '@/components/save-feedback'
import { useSchemeColors } from '@/components/themed'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import {
  createSavedLookFromMobile,
  deleteSavedLookFromMobile,
  formatSavedLookIfMatch,
  listSavedLooksFromMobile,
  MobileSavedLookRequestError,
  notifyMobileSavedLooksChanged,
  restoreSavedLookFromMobile,
} from '@/src/lib/saved-looks'
import {
  PreviewButton,
  SampleGarmentArt,
  type PreviewPalette,
} from '../preview/guest-preview-parts'

type InventoryRefresh = ReturnType<typeof createStylePieceRefresh>
type Labels = ReturnType<typeof getStylePieceStrings>
type SampleLabels = ReturnType<typeof getGuestPreviewStrings>

export function StylePieceEntry({
  garment,
  owner,
  epoch,
  unavailable,
  loading,
  labels,
  buttonRef,
  onRefresh,
  onOpen,
}: {
  garment: GarmentItemContract
  owner: string | null
  epoch: number
  unavailable: boolean
  loading: boolean
  labels: Labels
  buttonRef: Ref<ComponentRef<typeof Pressable>>
  onRefresh: () => void
  onOpen: (selection: StylePieceSelection) => void
}) {
  const colors = useSchemeColors()
  if (!owner || !isStylePieceTagged(garment)) return null
  const needsRefresh = unavailable || !stylePieceAnchor(garment)
  return (
    <Pressable
      ref={buttonRef}
      accessibilityRole="button"
      accessibilityState={{ disabled: needsRefresh && loading }}
      testID={needsRefresh ? 'style-piece-refresh' : 'style-piece-open'}
      disabled={needsRefresh && loading}
      style={[
        styles.entry,
        { backgroundColor: colors.noticeSurface, borderColor: colors.noticeLine },
      ]}
      onPress={() => {
        if (mobileIdentityEpoch() !== epoch || mobileApplicationUserId() !== owner) return
        if (unavailable || !stylePieceAnchor(garment)) onRefresh()
        else
          onOpen({
            id: garment.id,
            category: garment.category,
            comfortRange: garment.comfortRange,
          })
      }}
    >
      <Text style={[styles.entryText, { color: colors.noticeInk }]}>
        {needsRefresh ? labels.refreshPhoto : labels.start}
      </Text>
    </Pressable>
  )
}

export function focusStylePieceControl(button: ComponentRef<typeof Pressable> | null) {
  if (Platform.OS === 'web') button?.focus()
  else {
    const node = safeFindNodeHandle(button)
    if (node != null) AccessibilityInfo.setAccessibilityFocus(node)
  }
}

const CATALOG_BY_ID = new Map(SAMPLE_CATALOG.garments.map((item) => [item.id, item]))

export function StylePiecePanel({
  selection,
  initialSavedLook,
  inWardrobe,
  loadInventory,
  visible,
  owner,
  epoch,
  locale,
  onSavedLooksChanged,
  onClose,
  onDismiss,
}: {
  selection: StylePieceSelection
  initialSavedLook?: SavedLookContract | null
  inWardrobe: boolean
  loadInventory: (signal: AbortSignal) => Promise<GarmentItemContract[] | null>
  visible: boolean
  owner: string
  epoch: number
  locale: string
  onSavedLooksChanged?: () => void
  onClose: () => void
  onDismiss: () => void
}) {
  const labels = getStylePieceStrings(locale)
  const samples = getGuestPreviewStrings(locale)
  const palette = useHeroPalette()
  const insets = useModalInsets()
  const closeButton = useRef<ComponentRef<typeof Pressable> | null>(null)
  const [{ anchor, piece, restoreWeatherFocus }, setInventoryView] = useState<{
    anchor?: StylePiecePhotoAnchor | null
    piece: StylePieceAnchor
    restoreWeatherFocus: boolean
  }>({ piece: selection, restoreWeatherFocus: false })
  const refreshRef = useRef<InventoryRefresh | null>(null)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useLayoutEffect(() => {
    if (!visible) return
    const isCurrent = () =>
      mobileIdentityEpoch() === epoch && mobileApplicationUserId() === owner
    const inventory = createStylePieceRefresh({
      garmentId: selection.id,
      load: loadInventory,
      isCurrent,
      onAnchor: (next) => {
        setInventoryView((view) => ({
          anchor: next,
          piece: next
            ? { category: next.category, comfortRange: next.comfortRange }
            : view.piece,
          // A background pause explicitly puts the panel back into the checking state.
          restoreWeatherFocus:
            next === undefined ||
            (Boolean(next) && view.anchor === undefined && view.restoreWeatherFocus),
        }))
      },
    })
    refreshRef.current = inventory
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active'
      inventory.setVisible(active)
      if (active) void inventory.refresh()
    })
    const unsubscribe = subscribeMobileApplicationUser(() => {
      if (!isCurrent()) inventory.stop()
    })
    inventory.setVisible(
      AppState.currentState == null || AppState.currentState === 'active'
    )
    return () => {
      inventory.stop()
      refreshRef.current = null
      subscription.remove()
      unsubscribe()
    }
  }, [epoch, loadInventory, owner, selection.id, visible])

  useEffect(() => {
    // Android has no onDismiss event. Its unanimated dialog and the web implementation
    // have removed their content by the next frame.
    if (visible || Platform.OS === 'ios') return
    const frame = requestAnimationFrame(() => dismissRef.current())
    return () => cancelAnimationFrame(frame)
  }, [visible])

  const close = () => {
    refreshRef.current?.stop()
    onClose()
  }

  return (
    <EdgeToEdgeModal
      visible={visible}
      transparent={false}
      animationType="none"
      onShow={() => focusStylePieceControl(closeButton.current)}
      onRequestClose={close}
      onDismiss={onDismiss}
    >
      <View
        accessibilityViewIsModal
        onAccessibilityEscape={close}
        testID="style-piece-panel"
        style={[
          styles.modal,
          {
            backgroundColor: palette.page,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.ink }]}>
            {labels.start}
          </Text>
          <PreviewButton
            label={samples.chrome.close}
            testID="style-piece-close"
            onPress={close}
            palette={palette}
            buttonRef={closeButton}
          />
        </View>
        <SaveFeedbackProvider inline renderOfflineLine>
          <StylePieceIdeas
            key={JSON.stringify([
              selection.id,
              piece.category,
              piece.comfortRange,
              initialSavedLook?.id ?? null,
            ])}
            anchor={inWardrobe ? anchor : null}
            piece={piece}
            initialSavedLook={initialSavedLook}
            restoreWeatherFocus={restoreWeatherFocus}
            refreshRef={refreshRef}
            closeButton={closeButton}
            owner={owner}
            epoch={epoch}
            garmentId={selection.id}
            locale={locale}
            labels={labels}
            samples={samples}
            palette={palette}
            onSavedLooksChanged={onSavedLooksChanged}
          />
        </SaveFeedbackProvider>
      </View>
    </EdgeToEdgeModal>
  )
}

function StylePieceUnavailable({
  labels,
  palette,
  closeButton,
  retrying,
  onRetry,
}: {
  labels: Labels
  palette: PreviewPalette
  closeButton: RefObject<ComponentRef<typeof Pressable> | null>
  retrying: boolean
  onRetry: () => void
}) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => focusStylePieceControl(closeButton.current))
    return () => cancelAnimationFrame(frame)
  }, [closeButton])
  return (
    <View style={[styles.content, styles.group]}>
      <Text
        accessibilityRole="alert"
        testID="style-piece-unavailable"
        style={{ color: palette.ink }}
      >
        {labels.photo}
      </Text>
      <PreviewButton
        label={labels.refreshPhoto}
        testID="style-piece-refresh"
        onPress={onRetry}
        disabled={retrying}
        palette={palette}
      />
    </View>
  )
}

function StylePieceIdeas({
  anchor,
  piece,
  initialSavedLook,
  restoreWeatherFocus,
  refreshRef,
  closeButton,
  owner,
  epoch,
  garmentId,
  locale,
  labels,
  samples,
  palette,
  onSavedLooksChanged,
}: {
  anchor: StylePiecePhotoAnchor | null | undefined
  piece: StylePieceAnchor
  initialSavedLook?: SavedLookContract | null
  restoreWeatherFocus: boolean
  refreshRef: RefObject<InventoryRefresh | null>
  closeButton: RefObject<ComponentRef<typeof Pressable> | null>
  owner: string
  epoch: number
  garmentId: string
  locale: string
  labels: Labels
  samples: SampleLabels
  palette: PreviewPalette
  onSavedLooksChanged?: () => void
}) {
  const { t } = useTranslation()
  const statusBar = useStatusBar()
  const { category, comfortRange } = piece
  const photo = anchor?.photo
  const initialRecipe = initialSavedLook
    ? savedLookToStylePieceRecipe(initialSavedLook)
    : null
  const [weather, setWeather] = useState<StylePieceWeatherKey>(
    () => initialRecipe?.weather ?? initialStylePieceWeather(piece)
  )
  const [edits, setEdits] = useState<Record<string, StylePieceRecipe>>(() =>
    initialRecipe ? { [initialRecipe.lookId]: initialRecipe } : {}
  )
  const [reopened, setReopened] = useState<string | undefined>(
    () => initialRecipe?.lookId
  )
  const [latestEdit, setLatestEdit] = useState<string | undefined>(
    () => initialRecipe?.lookId
  )
  const [saved, setSaved] = useState<SavedLookContract[]>([])
  const [savedResetNonce, setSavedResetNonce] = useState(0)
  const [savedState, setSavedState] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading'
  )
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string>()
  const photoFailed = failedPhotoUrl !== undefined && failedPhotoUrl === photo?.url
  const [retrying, setRetrying] = useState(false)
  const authorized = Boolean(anchor) && !photoFailed
  const scroll = useRef<ScrollView | null>(null)
  const selectedWeather = useRef<ComponentRef<typeof Pressable> | null>(null)
  const swapUndoStackRef = useRef<Record<string, StylePieceRecipe>[]>([])
  const swapRevisionRef = useRef(0)
  const saveAttemptKeysRef = useRef<Map<string, string>>(new Map())
  const lastCreatedRef = useRef<Record<string, SavedLookContract>>({})
  const deletedIdsRef = useRef<Set<string>>(new Set())
  const mutationVersionRef = useRef(0)
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const noticeSeqRef = useRef(0)
  const reopenAction = useRef(0)
  const readLiveOnline = () => statusBarRef.current.isOnline && getNetworkOnline()

  const isCurrentSession = () =>
    mobileIdentityEpoch() === epoch && mobileApplicationUserId() === owner

  useEffect(() => {
    if (!authorized || !restoreWeatherFocus) return
    const frame = requestAnimationFrame(() => {
      if (refreshRef.current?.currentAnchor())
        focusStylePieceControl(selectedWeather.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [authorized, refreshRef, restoreWeatherFocus])

  useEffect(() => {
    if (!authorized) return
    const loadVersion = mutationVersionRef.current
    const controller = new AbortController()
    setSavedState('loading')
    void listSavedLooksFromMobile({
      source: 'style_piece',
      anchorGarmentId: garmentId,
      signal: controller.signal,
    })
      .then((items) => {
        if (
          controller.signal.aborted ||
          !refreshRef.current?.currentAnchor() ||
          !isCurrentSession()
        )
          return
        setSaved((current) => {
          if (mutationVersionRef.current === loadVersion) return items
          const seen = new Set(current.map((item) => item.id))
          return [
            ...current,
            ...items.filter(
              (item) => !seen.has(item.id) && !deletedIdsRef.current.has(item.id)
            ),
          ]
        })
        setSavedState('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setSavedState('unavailable')
      })
    return () => controller.abort()
  }, [authorized, epoch, garmentId, owner, refreshRef])

  const currentPiece = (inventory: InventoryRefresh | null) => {
    const fresh = inventory?.currentAnchor()
    return fresh?.category === category && fresh.comfortRange === comfortRange
      ? fresh
      : null
  }

  const verifyAnchorForAction = async () => {
    const inventory = refreshRef.current
    const refreshResult = await inventory?.refreshForAction()
    if (!refreshResult || refreshResult.status === 'revoked') return null
    if (refreshResult.status === 'error') throw refreshResult.error
    return currentPiece(inventory)
  }

  const retryPhoto = async () => {
    if (retrying) return
    setRetrying(true)
    const inventory = refreshRef.current
    if ((await inventory?.refresh()) && inventory?.currentAnchor()) {
      setFailedPhotoUrl((failed) => (failed === failedPhotoUrl ? undefined : failed))
      requestAnimationFrame(() => focusStylePieceControl(selectedWeather.current))
    }
    setRetrying(false)
  }

  const changeWeather = (value: StylePieceWeatherKey) => {
    if (value === weather) return
    reopenAction.current++
    swapUndoStackRef.current = []
    setWeather(value)
    setEdits({})
    setLatestEdit(undefined)
    setReopened(undefined)
    statusBar.dismissNotice()
  }

  const openSaved = async (entry: SavedLookContract) => {
    const action = ++reopenAction.current
    const inventory = refreshRef.current
    if (!(await inventory?.refresh()) || reopenAction.current !== action) return
    const fresh = currentPiece(inventory)
    if (!fresh) return
    const recipe = savedLookToStylePieceRecipe(entry)
    if (!recipe) return
    swapUndoStackRef.current = []
    statusBar.dismissNotice()
    setWeather(recipe.weather)
    setEdits({ [recipe.lookId]: recipe })
    setReopened(recipe.lookId)
    setLatestEdit(recipe.lookId)
    requestAnimationFrame(() => {
      if (reopenAction.current !== action || !currentPiece(inventory)) return
      scroll.current?.scrollTo({ y: 0, animated: false })
      focusStylePieceControl(selectedWeather.current)
    })
  }

  const text = { color: palette.ink }
  if (anchor === undefined)
    return (
      <Text accessibilityRole="progressbar" style={[styles.content, text]}>
        {labels.checkingPhoto}
      </Text>
    )
  if (!photo || photoFailed)
    return (
      <StylePieceUnavailable
        labels={labels}
        palette={palette}
        closeButton={closeButton}
        retrying={retrying}
        onRetry={() => void retryPhoto()}
      />
    )

  const result = stylePieceLooks(piece, weather)
  const looks = visibleStylePieceLooks(result.looks, edits, {
    reopenedLookId: reopened,
    editedLookId: latestEdit,
  })
  const weatherName = (value: StylePieceWeatherKey) => samples.values.weather[value]
  const emptyMessage = {
    protection: labels.protection,
    comfort: labels.comfort,
    'no-looks': labels.noLooks,
  }
  const error = result.reason && emptyMessage[result.reason]
  const anchorPhoto = (
    <View style={styles.anchor}>
      <Image
        key={photo.url}
        source={{ uri: photo.url }}
        accessibilityLabel={labels.anchor}
        accessibilityRole="image"
        testID="style-piece-anchor"
        style={styles.photo}
        onError={() => {
          if (refreshRef.current?.currentAnchor()?.photo.url === photo.url)
            setFailedPhotoUrl(photo.url)
        }}
      />
      <Text style={[styles.label, text]}>{labels.anchor}</Text>
    </View>
  )
  return (
    <ScrollView ref={scroll} contentContainerStyle={styles.content}>
      <View style={styles.group}>
        <Text accessibilityRole="header" style={[styles.label, text]}>
          {labels.weather}
        </Text>
        <View style={styles.row}>
          {STYLE_PIECE_WEATHER_KEYS.map((value) => (
            <PreviewButton
              key={value}
              buttonRef={value === weather ? selectedWeather : undefined}
              label={weatherName(value)}
              testID={`style-piece-weather-${value}`}
              palette={palette}
              selected={weather === value}
              primary={weather === value}
              onPress={() => changeWeather(value)}
            />
          ))}
        </View>
        <Text style={text}>
          {formatSampleTemperature(SAMPLE_WEATHER[weather].feelsLike, locale)}
        </Text>
      </View>

      {error && (
        <View style={styles.group}>
          <Text accessibilityLiveRegion="polite" style={text}>
            {error}
          </Text>
          {anchorPhoto}
        </View>
      )}

      {looks.map((look, index) => {
        const recipeKey = stylePieceRecipeKey(look.recipe)
        const compositionKey = look.companions
          .map((item) => `${item.category}=${item.id}`)
          .join(',')
        return (
          <StylePieceCard
            key={recipeKey}
            look={look}
            index={index}
            owner={owner}
            compositionKey={compositionKey}
            resetNonce={savedResetNonce}
            anchorPhoto={anchorPhoto}
            labels={labels}
            samples={samples}
            palette={palette}
            canSave={savedState !== 'loading'}
            onSave={async () => {
              const startSwapRevision = swapRevisionRef.current
              const fresh = await verifyAnchorForAction()
              if (!fresh) return false
              const payload = buildStylePieceSavedLookInput(
                {
                  id: garmentId,
                  category: fresh.category,
                  comfortRange: fresh.comfortRange,
                },
                look
              )
              const existingMatch = saved.find((item) => {
                if (
                  item.source !== 'style_piece' ||
                  item.lookId !== payload.lookId ||
                  item.weather !== payload.weather ||
                  item.anchorGarmentId !== garmentId ||
                  item.composition.length !== payload.composition.length
                ) {
                  return false
                }
                return payload.composition.every((slot) => {
                  const match = item.composition[slot.slotIndex]
                  return (
                    match !== undefined &&
                    match.kind === slot.kind &&
                    match.category === slot.category &&
                    match.itemId === slot.itemId
                  )
                })
              })
              const attemptKey = `${recipeKey}:${compositionKey}`
              if (existingMatch) {
                delete lastCreatedRef.current[attemptKey]
                setSavedState('ready')
                if (swapRevisionRef.current === startSwapRevision) {
                  swapUndoStackRef.current = []
                }
                return { saved: true, undoable: false }
              }
              let idempotencyKey = saveAttemptKeysRef.current.get(attemptKey)
              if (!idempotencyKey) {
                idempotencyKey = createIdempotencyKey()
                saveAttemptKeysRef.current.set(attemptKey, idempotencyKey)
              }
              let created: SavedLookContract
              try {
                created = await createSavedLookFromMobile(payload, { idempotencyKey })
              } catch (error) {
                if (
                  error instanceof MobileSavedLookRequestError &&
                  error.status === 409
                ) {
                  saveAttemptKeysRef.current.delete(attemptKey)
                  if (error.code === 'SAVED_LOOK_ALREADY_REMOVED') {
                    return false
                  }
                }
                throw error
              }
              if (!isCurrentSession()) return false
              saveAttemptKeysRef.current.delete(attemptKey)
              deletedIdsRef.current.delete(created.id)
              mutationVersionRef.current += 1
              lastCreatedRef.current[attemptKey] = created
              setSaved((current) => [
                created,
                ...current.filter((item) => item.id !== created.id),
              ])
              setSavedState('ready')
              onSavedLooksChanged?.()
              notifyMobileSavedLooksChanged(owner)
              if (swapRevisionRef.current === startSwapRevision) {
                swapUndoStackRef.current = []
              }
              return true
            }}
            onUndoSave={async () => {
              const attemptKey = `${recipeKey}:${compositionKey}`
              const created = lastCreatedRef.current[attemptKey]
              if (!created) return false
              const fresh = await verifyAnchorForAction()
              if (!fresh) return false
              try {
                await deleteSavedLookFromMobile(
                  created.id,
                  formatSavedLookIfMatch(created.id, created.revision)
                )
              } catch (error) {
                if (
                  !(error instanceof MobileSavedLookRequestError && error.status === 404)
                ) {
                  throw error
                }
              }
              if (!isCurrentSession()) return false
              deletedIdsRef.current.add(created.id)
              mutationVersionRef.current += 1
              delete lastCreatedRef.current[attemptKey]
              setSaved((current) => current.filter((item) => item.id !== created.id))
              onSavedLooksChanged?.()
              notifyMobileSavedLooksChanged(owner)
              return true
            }}
            onViewSaved={() => {
              scroll.current?.scrollToEnd?.({ animated: false })
            }}
            onSwap={(category, id) => {
              reopenAction.current++
              swapRevisionRef.current += 1
              swapUndoStackRef.current = pushLookUndoSnapshot(
                swapUndoStackRef.current,
                edits
              )
              setLatestEdit(look.recipe.lookId)
              setEdits((current) => ({
                ...current,
                [look.recipe.lookId]: {
                  ...look.recipe,
                  swaps: { ...look.recipe.swaps, [category]: id },
                },
              }))
              const seq = ++noticeSeqRef.current
              statusBar.showNotice({
                id: `style-piece-swap-${seq}`,
                announcementId: createAnnouncementToken('style-piece-swap', seq),
                message: t('feedback.pieceSwapped'),
                tone: 'neutral',
                actions: [
                  {
                    id: 'undo',
                    kind: 'undo',
                    label: t('feedback.undo'),
                    onPress: () => {
                      const { snapshot, rest } = popLookUndoSnapshot(
                        swapUndoStackRef.current
                      )
                      swapUndoStackRef.current = rest
                      if (snapshot !== undefined) {
                        reopenAction.current++
                        swapRevisionRef.current += 1
                        setEdits(snapshot)
                        const undoSeq = ++noticeSeqRef.current
                        statusBarRef.current.showNotice({
                          id: `style-piece-swap-undo-${undoSeq}`,
                          announcementId: createAnnouncementToken(
                            'style-piece-swap-undo',
                            undoSeq
                          ),
                          message: t('feedback.undone'),
                          tone: 'neutral',
                        })
                      }
                    },
                  },
                ],
              })
            }}
          />
        )
      })}

      {savedState === 'unavailable' && (
        <Text accessibilityRole="alert" style={text}>
          {t('savedLooks.loadFailed')}
        </Text>
      )}
      {saved.length > 0 && (
        <View style={styles.group}>
          <Text accessibilityRole="header" style={[styles.label, text]}>
            {labels.saved}
          </Text>
          {saved.map((entry) => {
            const companionNames = entry.composition
              .filter((slot) => slot.kind === 'catalog')
              .map((slot) => {
                const item = CATALOG_BY_ID.get(slot.itemId)
                return item
                  ? sampleGarmentText(item, samples).name
                  : (slot.label ?? samples.values.category[slot.category])
              })
            const description = [
              samples.values.weather[entry.weather as StylePieceWeatherKey] ??
                entry.weather,
              ...companionNames,
            ].join(' · ')
            return (
              <View key={entry.id} style={[styles.card, { borderColor: palette.line }]}>
                <Text style={text}>{description}</Text>
                {entry.availabilityStatus === 'needs_review' ? (
                  <Text testID="saved-look-needs-review" style={[styles.label, text]}>
                    {t('savedLooks.needsReview')}
                  </Text>
                ) : null}
                <View style={styles.row}>
                  <PreviewButton
                    label={labels.reopen}
                    accessibilityLabel={`${labels.reopen}: ${description}`}
                    testID="style-piece-reopen"
                    palette={palette}
                    onPress={() => void openSaved(entry)}
                  />
                  <PreviewButton
                    label={labels.remove}
                    accessibilityLabel={`${labels.remove}: ${description}`}
                    testID="style-piece-remove"
                    palette={palette}
                    onPress={() => {
                      const runRemove = async () => {
                        if (!readLiveOnline()) {
                          const reachable = hasReliableBrowserOnline()
                            ? false
                            : await checkNetworkOnlineForAction()
                          if (!reachable) {
                            const seq = ++noticeSeqRef.current
                            statusBarRef.current.showNotice({
                              id: `style-piece-remove-offline-${seq}`,
                              announcementId: createAnnouncementToken(
                                'style-piece-remove-offline',
                                seq
                              ),
                              message: t('feedback.offlineAction'),
                              tone: 'offline',
                              actions: [],
                            })
                            return
                          }
                        }
                        let alreadyDeleted = false
                        try {
                          const fresh = await verifyAnchorForAction()
                          if (!fresh) return
                          try {
                            await deleteSavedLookFromMobile(
                              entry.id,
                              formatSavedLookIfMatch(entry.id, entry.revision)
                            )
                          } catch (deleteError) {
                            if (
                              deleteError instanceof MobileSavedLookRequestError &&
                              deleteError.status === 404
                            ) {
                              alreadyDeleted = true
                            } else {
                              throw deleteError
                            }
                          }
                          if (!isCurrentSession()) return
                          deletedIdsRef.current.add(entry.id)
                          mutationVersionRef.current += 1
                          setSaved((current) =>
                            current.filter((item) => item.id !== entry.id)
                          )
                          onSavedLooksChanged?.()
                          notifyMobileSavedLooksChanged(owner)
                        } catch (error) {
                          const errSeq = ++noticeSeqRef.current
                          if (isOfflineError(error) || !readLiveOnline()) {
                            reportNetworkOffline()
                            statusBarRef.current.showNotice({
                              id: `style-piece-remove-offline-${errSeq}`,
                              announcementId: createAnnouncementToken(
                                'style-piece-remove-offline',
                                errSeq
                              ),
                              message: t('feedback.offlineAction'),
                              tone: 'offline',
                              actions: [],
                            })
                          } else {
                            statusBarRef.current.showNotice({
                              id: `style-piece-remove-failed-${errSeq}`,
                              announcementId: createAnnouncementToken(
                                'style-piece-remove-failed',
                                errSeq
                              ),
                              message: t('feedback.saveFailed'),
                              tone: 'error',
                              actions: [
                                {
                                  id: 'retry',
                                  kind: 'retry',
                                  label: t('feedback.retry'),
                                  onPress: () => {
                                    void runRemove()
                                  },
                                },
                              ],
                            })
                          }
                          return
                        }
                        setSavedResetNonce((value) => value + 1)
                        scroll.current?.scrollTo({ y: 0, animated: false })
                        focusStylePieceControl(selectedWeather.current)
                        const seq = ++noticeSeqRef.current
                        statusBarRef.current.showNotice({
                          id: `style-piece-remove-${seq}`,
                          announcementId: createAnnouncementToken(
                            'style-piece-remove',
                            seq
                          ),
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
                                    if (!readLiveOnline()) {
                                      const reachable = hasReliableBrowserOnline()
                                        ? false
                                        : await checkNetworkOnlineForAction()
                                      if (!reachable) {
                                        const offSeq = ++noticeSeqRef.current
                                        statusBarRef.current.showNotice({
                                          id: `style-piece-remove-undo-offline-${offSeq}`,
                                          announcementId: createAnnouncementToken(
                                            'style-piece-remove-undo-offline',
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
                                      const fresh = await verifyAnchorForAction()
                                      if (!fresh) return
                                      const restored = await restoreSavedLookFromMobile(
                                        entry.id
                                      )
                                      if (!isCurrentSession()) return
                                      deletedIdsRef.current.delete(restored.id)
                                      mutationVersionRef.current += 1
                                      setSaved((current) => [
                                        restored,
                                        ...current.filter(
                                          (item) => item.id !== restored.id
                                        ),
                                      ])
                                      onSavedLooksChanged?.()
                                      notifyMobileSavedLooksChanged(owner)
                                      const undoSeq = ++noticeSeqRef.current
                                      statusBarRef.current.showNotice({
                                        id: `style-piece-remove-undo-${undoSeq}`,
                                        announcementId: createAnnouncementToken(
                                          'style-piece-remove-undo',
                                          undoSeq
                                        ),
                                        message: t('feedback.undone'),
                                        tone: 'neutral',
                                      })
                                    } catch (error) {
                                      const errSeq = ++noticeSeqRef.current
                                      if (isOfflineError(error) || !readLiveOnline()) {
                                        reportNetworkOffline()
                                        statusBarRef.current.showNotice({
                                          id: `style-piece-remove-undo-offline-${errSeq}`,
                                          announcementId: createAnnouncementToken(
                                            'style-piece-remove-undo-offline',
                                            errSeq
                                          ),
                                          message: t('feedback.offlineAction'),
                                          tone: 'offline',
                                          actions: [],
                                        })
                                      } else {
                                        statusBarRef.current.showNotice({
                                          id: `style-piece-remove-undo-failed-${errSeq}`,
                                          announcementId: createAnnouncementToken(
                                            'style-piece-remove-undo-failed',
                                            errSeq
                                          ),
                                          message: t('feedback.saveFailed'),
                                          tone: 'error',
                                        })
                                      }
                                    }
                                  },
                                },
                              ],
                        })
                      }
                      void runRemove()
                    }}
                  />
                </View>
              </View>
            )
          })}
        </View>
      )}
    </ScrollView>
  )
}

function StylePieceCard({
  look,
  index,
  owner,
  compositionKey,
  resetNonce,
  anchorPhoto,
  labels,
  samples,
  palette,
  canSave,
  onSave,
  onUndoSave,
  onViewSaved,
  onSwap,
}: {
  look: StylePieceLook
  index: number
  owner: string
  compositionKey: string
  resetNonce: number
  anchorPhoto: React.ReactNode
  labels: Labels
  samples: SampleLabels
  palette: PreviewPalette
  canSave: boolean
  onSave: () => Promise<boolean | { saved: boolean; undoable?: boolean }>
  onUndoSave: () => Promise<boolean>
  onViewSaved: () => void
  onSwap: (category: SampleGarmentCategory, id: string) => void
}) {
  const [editing, setEditing] = useState<SampleGarmentCategory | null>(null)
  const swapInvoker = useRef<ComponentRef<typeof Pressable> | null>(null)
  const text = { color: palette.ink }
  const recipeKey = stylePieceRecipeKey(look.recipe)

  return (
    <View testID="style-piece-look" style={[styles.card, { borderColor: palette.line }]}>
      <Text accessibilityRole="header" style={[styles.label, text]}>
        {formatPreviewString(labels.idea, { number: index + 1 })}
      </Text>
      <View style={styles.row}>
        {anchorPhoto}
        <View style={styles.companions}>
          <Text accessibilityRole="header" style={[styles.label, text]}>
            {labels.companions}
          </Text>
          {look.companions.map((item) => {
            const options = stylePieceSwapOptions(look, item.category).filter(
              ({ id }) => id !== item.id
            )
            const expanded = editing === item.category
            const swapLabel = formatPreviewString(samples.outfit.swapTitle, {
              category: samples.values.category[item.category],
            })
            return (
              <View key={item.category} style={styles.group}>
                <View style={styles.piece}>
                  <SampleGarmentArt garment={item} size={36} />
                  <Text style={[styles.pieceName, text]}>
                    {sampleGarmentText(item, samples).name}
                  </Text>
                </View>
                {options.length > 0 && (
                  <PreviewButton
                    buttonRef={expanded ? swapInvoker : undefined}
                    label={swapLabel}
                    testID={`style-piece-swap-${item.category}`}
                    palette={palette}
                    expanded={expanded}
                    onPress={() => setEditing(expanded ? null : item.category)}
                  />
                )}
                {expanded &&
                  options.map((option) => (
                    <PreviewButton
                      key={option.id}
                      label={sampleGarmentText(option, samples).name}
                      testID={`style-piece-option-${option.id}`}
                      palette={palette}
                      onPress={() => {
                        const invoker = swapInvoker.current
                        onSwap(item.category, option.id)
                        setEditing(null)
                        requestAnimationFrame(() => focusStylePieceControl(invoker))
                      }}
                    />
                  ))}
              </View>
            )
          })}
        </View>
      </View>
      <SaveActionButton
        idleLabel={labels.save}
        testID="style-piece-save"
        disabled={!canSave}
        requiresNetwork
        ownerKey={owner}
        resetKey={`${recipeKey}:${compositionKey}:${resetNonce}`}
        onSave={onSave}
        onUndo={onUndoSave}
        onView={onViewSaved}
        barPlacement="inline"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  entry: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  modal: { flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { flex: 1, fontSize: 24, fontWeight: '700' },
  content: { paddingHorizontal: 20, paddingVertical: 12, gap: 16 },
  group: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  label: { fontWeight: '700' },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 12 },
  anchor: { width: 94, alignSelf: 'flex-start', gap: 4 },
  photo: { width: '100%', aspectRatio: 0.75, borderRadius: 8 },
  companions: { flexGrow: 1, flexShrink: 1, flexBasis: 145, gap: 8 },
  piece: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pieceName: { flex: 1 },
})

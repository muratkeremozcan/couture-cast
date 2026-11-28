// Story CC-7.12 D7: a save confirmation's View closes the panel and opens the saved look's screen.
import { router } from 'expo-router'
import { Image as ExpoImage } from 'expo-image'
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
  garmentSubtypeStrings,
  getGuestPreviewStrings,
  getStylePieceStrings,
  initialStylePieceWeather,
  isOfflineError,
  isStylePieceOwnedCompanion,
  isStylePieceTagged,
  popLookUndoSnapshot,
  pushLookUndoSnapshot,
  SAMPLE_CATALOG,
  sampleGarmentText,
  SAMPLE_WEATHER,
  reopenStylePieceRecipe,
  savedStylePieceEditorRecipe,
  savedLookMatchesStylePiece,
  STYLE_PIECE_WEATHER_KEYS,
  stylePieceAnchor,
  stylePieceCompanionOptions,
  stylePieceLookHasCurrentCompanions,
  stylePieceLooks,
  stylePieceOccasionLooks,
  stylePieceRecipeKey,
  type SampleGarmentCategory,
  type StylePieceWeatherKey,
  type StylePieceOccasionLook,
  type StylePieceOwnedCompanion,
  type StylePieceCompanion,
  type StylePieceAnchor,
  type StylePiecePhotoAnchor,
  type StylePieceSelection,
  type StylePieceRecipe,
} from '@couture/utils'
import {
  EdgeToEdgeModal,
  LayerSwipeHandle,
  useModalInsets,
} from '@/components/edge-to-edge-modal'
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
import { savedLookRoute } from '@/src/features/looks/looks-routes'
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
  garment: GarmentItemContract & Pick<StylePieceAnchor, 'subtype'>
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
      aria-disabled={needsRefresh && loading}
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
            ...(garment.subtype && { subtype: garment.subtype }),
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

/**
 * How many times the panel has moved focus. Story CC-7.11 D13: the dialog's onShow focuses Close
 * only when nothing inside the panel moved focus since it opened, so a photo check or retry that
 * finishes before the slide-in ends keeps focus where it put it.
 */
let stylePieceFocusMoves = 0

export function focusStylePieceControl(button: ComponentRef<typeof Pressable> | null) {
  if (button) stylePieceFocusMoves++
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
  const [{ anchor, owned, piece, restoreWeatherFocus }, setInventoryView] = useState<{
    anchor?: StylePiecePhotoAnchor | null
    owned: readonly StylePieceOwnedCompanion[]
    piece: StylePieceAnchor
    restoreWeatherFocus: boolean
  }>({ owned: [], piece: selection, restoreWeatherFocus: false })
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
      onAnchor: (next, nextOwned) => {
        setInventoryView((view) => ({
          anchor: next,
          owned: nextOwned,
          piece: next
            ? {
                category: next.category,
                comfortRange: next.comfortRange,
                subtype: next.subtype,
              }
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
      if (!isCurrent()) {
        inventory.stop()
        setInventoryView((view) => ({ ...view, anchor: undefined, owned: [] }))
      }
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

  // Story CC-7.11 D13: the focus count when the panel opened, read by onShow below. A layout
  // effect, so it is taken before any content's frame-deferred focus.
  const focusMovesAtOpen = useRef(0)
  useLayoutEffect(() => {
    if (visible) focusMovesAtOpen.current = stylePieceFocusMoves
  }, [visible])

  const close = () => {
    refreshRef.current?.stop()
    onClose()
  }

  // D7: the panel closes first, so the saved look's screen is not pushed under its layer.
  const viewSavedLook = (savedLookId: string) => {
    close()
    requestAnimationFrame(() => router.push(savedLookRoute(savedLookId)))
  }

  return (
    <EdgeToEdgeModal
      visible={visible}
      transparent={false}
      animationType="none"
      onShow={() => {
        if (stylePieceFocusMoves === focusMovesAtOpen.current)
          focusStylePieceControl(closeButton.current)
      }}
      onRequestClose={close}
      // Story CC-7.11 D13: the hub's finishStyleDismissal focuses the Style piece button.
      returnFocusRef={null}
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
        {/* Story CC-7.11 D13: the header is the layer's swipe-down handle, through the same close. */}
        <LayerSwipeHandle style={styles.header}>
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
        </LayerSwipeHandle>
        <SaveFeedbackProvider inline renderOfflineLine>
          <StylePieceIdeas
            key={JSON.stringify([
              selection.id,
              piece.category,
              piece.comfortRange,
              piece.subtype ?? null,
              initialSavedLook?.id ?? null,
            ])}
            anchor={inWardrobe ? anchor : null}
            owned={inWardrobe ? owned : []}
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
            onViewSavedLook={viewSavedLook}
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
  owned,
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
  onViewSavedLook,
}: {
  anchor: StylePiecePhotoAnchor | null | undefined
  owned: readonly StylePieceOwnedCompanion[]
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
  onViewSavedLook: (savedLookId: string) => void
}) {
  const { t } = useTranslation()
  const statusBar = useStatusBar()
  const { category, comfortRange, subtype } = piece
  const photo = anchor?.photo
  const initialRecipe = initialSavedLook
    ? savedStylePieceEditorRecipe(initialSavedLook)
    : null
  const [weather, setWeather] = useState<StylePieceWeatherKey>(
    () => initialRecipe?.weather ?? initialStylePieceWeather(piece)
  )
  const [edits, setEdits] = useState<Record<string, StylePieceRecipe>>(() =>
    initialRecipe ? { [initialRecipe.lookId]: initialRecipe } : {}
  )
  const [reopenedSaved, setReopenedSaved] = useState(initialSavedLook ?? null)
  const reopened = reopenedSaved?.lookId
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
  const swapUndoStackRef = useRef<
    {
      edits: Record<string, StylePieceRecipe>
      latestEdit: string | undefined
    }[]
  >([])
  const swapRevisionRef = useRef(0)
  const saveAttemptKeysRef = useRef<Map<string, string>>(new Map())
  const lastCreatedRef = useRef<Record<string, SavedLookContract>>({})
  // D7: per look and composition, the saved look the last save confirmed (View opens it).
  const viewIdsRef = useRef<Record<string, string>>({})
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
    return fresh?.category === category &&
      fresh.comfortRange === comfortRange &&
      (fresh.subtype ?? null) === (subtype ?? null)
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

  const retryFocusPending = useRef(false)
  const [, setRetryFocusTick] = useState(0)
  useLayoutEffect(() => {
    if (!retryFocusPending.current || !selectedWeather.current) return
    retryFocusPending.current = false
    focusStylePieceControl(selectedWeather.current)
  })

  const retryPhoto = async () => {
    if (retrying) return
    setRetrying(true)
    const inventory = refreshRef.current
    if ((await inventory?.refresh()) && inventory?.currentAnchor()) {
      setFailedPhotoUrl((failed) => (failed === failedPhotoUrl ? undefined : failed))
      // TEA (hub flake): focus waits for the commit that shows the renewed view; a bare frame
      // could run before it and leave focus on Close.
      retryFocusPending.current = true
      setRetryFocusTick((tick) => tick + 1)
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
    setReopenedSaved(null)
    statusBar.dismissNotice()
  }

  const openSaved = async (entry: SavedLookContract) => {
    const action = ++reopenAction.current
    const inventory = refreshRef.current
    if (!(await inventory?.refresh()) || reopenAction.current !== action) return
    const fresh = currentPiece(inventory)
    if (!fresh) return
    const recipe = reopenStylePieceRecipe(
      entry,
      { ...fresh, id: garmentId },
      inventory?.currentCompanions() ?? []
    )
    if (!recipe) {
      onViewSavedLook(entry.id)
      return
    }
    swapUndoStackRef.current = []
    statusBar.dismissNotice()
    setWeather(recipe.weather)
    setEdits({ [recipe.lookId]: recipe })
    setReopenedSaved(entry)
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
  const selection = { ...piece, id: garmentId }
  const staleReopen =
    reopenedSaved &&
    !reopenStylePieceRecipe(
      reopenedSaved,
      selection,
      owned,
      edits[reopenedSaved.lookId]?.swaps
    )
  const looks = stylePieceOccasionLooks(result.looks, edits, {
    owned,
    reopenedLookId: reopened,
    editedLookId: latestEdit,
  }).filter((look) => !staleReopen || look.recipe.lookId !== reopened)
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

      {staleReopen && (
        <Text accessibilityLiveRegion="polite" style={text}>
          {t('savedLooks.needsReview')}
        </Text>
      )}
      {looks.map((look) => {
        const recipeKey = stylePieceRecipeKey(look.recipe)
        const compositionKey = look.companions
          .map((item) => `${item.category}=${item.id}`)
          .join(',')
        return (
          <StylePieceCard
            key={recipeKey}
            look={look}
            owned={owned}
            locale={locale}
            photoUnavailable={t('savedLooks.photoUnavailable')}
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
              if (
                !fresh ||
                !stylePieceLookHasCurrentCompanions(
                  look,
                  refreshRef.current?.currentCompanions() ?? []
                )
              )
                return false
              const payload = buildStylePieceSavedLookInput(
                {
                  id: garmentId,
                  category: fresh.category,
                  comfortRange: fresh.comfortRange,
                },
                look
              )
              const existingMatch = saved.find((item) =>
                savedLookMatchesStylePiece(item, garmentId, look, fresh.category)
              )
              const attemptKey = `${recipeKey}:${compositionKey}`
              if (existingMatch) {
                delete lastCreatedRef.current[attemptKey]
                viewIdsRef.current[attemptKey] = existingMatch.id
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
              viewIdsRef.current[attemptKey] = created.id
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
              if (viewIdsRef.current[attemptKey] === created.id)
                delete viewIdsRef.current[attemptKey]
              setSaved((current) => current.filter((item) => item.id !== created.id))
              onSavedLooksChanged?.()
              notifyMobileSavedLooksChanged(owner)
              return true
            }}
            onViewSaved={() => {
              const savedLookId = viewIdsRef.current[`${recipeKey}:${compositionKey}`]
              if (savedLookId && isCurrentSession()) onViewSavedLook(savedLookId)
            }}
            onSwap={(category, id) => {
              reopenAction.current++
              swapRevisionRef.current += 1
              swapUndoStackRef.current = pushLookUndoSnapshot(swapUndoStackRef.current, {
                edits,
                latestEdit,
              })
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
                        setEdits(snapshot.edits)
                        setLatestEdit(snapshot.latestEdit)
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
            {t('savedLooks.title')}
          </Text>
          {saved.map((entry) => {
            const canReopen = Boolean(reopenStylePieceRecipe(entry, selection, owned))
            const missing = entry.availabilityStatus === 'missing_garment'
            const companionNames = entry.composition
              .filter((slot) => slot.slotIndex !== 0)
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
                {!canReopen && (
                  <Text
                    testID={
                      missing ? 'saved-look-missing-piece' : 'saved-look-needs-review'
                    }
                    style={[styles.label, text]}
                  >
                    {t(missing ? 'savedLooks.missingPiece' : 'savedLooks.needsReview')}
                  </Text>
                )}
                <View style={styles.row}>
                  {canReopen && (
                    <PreviewButton
                      label={labels.reopen}
                      accessibilityLabel={`${labels.reopen}: ${description}`}
                      testID="style-piece-reopen"
                      palette={palette}
                      onPress={() => void openSaved(entry)}
                    />
                  )}
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

function OwnedCompanionPhoto({
  item,
  unavailable,
  palette,
}: {
  item: StylePieceOwnedCompanion
  unavailable: string
  palette: PreviewPalette
}) {
  const [failed, setFailed] = useState(false)
  return item.photo && !failed ? (
    <ExpoImage
      source={{ uri: item.photo.url }}
      cachePolicy="none"
      contentFit="cover"
      accessible={false}
      style={styles.companionPhoto}
      onError={() => setFailed(true)}
    />
  ) : (
    <Text
      testID="style-piece-companion-placeholder"
      style={[
        styles.companionPlaceholder,
        { color: palette.ink, borderColor: palette.line },
      ]}
    >
      {unavailable}
    </Text>
  )
}

function StylePieceCard({
  look,
  owned,
  locale,
  photoUnavailable,
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
  look: StylePieceOccasionLook
  owned: readonly StylePieceOwnedCompanion[]
  locale: string
  photoUnavailable: string
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
  const name = (item: StylePieceCompanion) =>
    isStylePieceOwnedCompanion(item)
      ? item.subtype
        ? garmentSubtypeStrings(locale).values[item.subtype]
        : samples.values.category[item.category]
      : sampleGarmentText(item, samples).name
  const art = (item: StylePieceCompanion) =>
    isStylePieceOwnedCompanion(item) ? (
      <OwnedCompanionPhoto
        key={item.photo?.url}
        item={item}
        unavailable={photoUnavailable}
        palette={palette}
      />
    ) : (
      <SampleGarmentArt garment={item} size={36} />
    )

  return (
    <View testID="style-piece-look" style={[styles.card, { borderColor: palette.line }]}>
      <Text accessibilityRole="header" style={[styles.label, text]}>
        {labels.occasions[look.occasion]}
      </Text>
      <View style={styles.row}>
        {anchorPhoto}
        <View style={styles.companions}>
          <Text accessibilityRole="header" style={[styles.label, text]}>
            {labels.companions}
          </Text>
          {look.companions.map((item) => {
            const options = stylePieceCompanionOptions(look, item.category, owned).filter(
              ({ id }) => id !== item.id
            )
            const expanded = editing === item.category
            const swapLabel = formatPreviewString(samples.outfit.swapTitle, {
              category: samples.values.category[item.category],
            })
            return (
              <View key={item.category} style={styles.group}>
                <View
                  style={styles.piece}
                  testID={
                    isStylePieceOwnedCompanion(item)
                      ? 'style-piece-owned-companion'
                      : undefined
                  }
                >
                  {art(item)}
                  <Text style={[styles.pieceName, text]}>{name(item)}</Text>
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
                      label={name(option)}
                      leading={art(option)}
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
  // Story CC-7.11 review #2: a compact gap under the Closet tile's status line.
  entry: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 4,
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
  companionPhoto: { width: 36, height: 36, borderRadius: 8 },
  companionPlaceholder: {
    maxWidth: 76,
    borderWidth: 1,
    borderRadius: 8,
    padding: 4,
    fontSize: 12,
  },
  piece: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pieceName: { flex: 1 },
})

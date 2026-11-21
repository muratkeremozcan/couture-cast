import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
  type Ref,
  type RefObject,
} from 'react'
import type { GarmentItemContract } from '@couture/api-client/contracts/http'
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
  createStylePieceRefresh,
  formatPreviewString,
  formatSampleTemperature,
  getGuestPreviewStrings,
  getStylePieceStrings,
  initialStylePieceWeather,
  isStylePieceTagged,
  parseStylePieceRecipes,
  sampleGarmentText,
  SAMPLE_WEATHER,
  STYLE_PIECE_WEATHER_KEYS,
  saveStylePieceRecipe,
  stylePieceAnchor,
  stylePieceLooks,
  stylePieceRecipeKey,
  stylePieceStorageKey,
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
import { useSchemeColors } from '@/components/themed'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { sampleRecipeStorage } from '@/src/lib/sample-recipe-storage'
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
        { backgroundColor: colors.noticeSurface, borderColor: colors.noticeBorder },
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
      <Text style={[styles.entryText, { color: colors.noticeText }]}>
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

export function StylePiecePanel({
  selection,
  inWardrobe,
  loadInventory,
  visible,
  owner,
  epoch,
  locale,
  onClose,
  onDismiss,
}: {
  selection: StylePieceSelection
  inWardrobe: boolean
  loadInventory: (signal: AbortSignal) => Promise<GarmentItemContract[] | null>
  visible: boolean
  owner: string
  epoch: number
  locale: string
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
            backgroundColor: palette.background,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <View style={styles.header}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: palette.text }]}
          >
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
        <StylePieceIdeas
          key={JSON.stringify([selection.id, piece.category, piece.comfortRange])}
          anchor={inWardrobe ? anchor : null}
          piece={piece}
          restoreWeatherFocus={restoreWeatherFocus}
          refreshRef={refreshRef}
          closeButton={closeButton}
          owner={owner}
          garmentId={selection.id}
          locale={locale}
          labels={labels}
          samples={samples}
          palette={palette}
        />
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
        style={{ color: palette.text }}
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
  restoreWeatherFocus,
  refreshRef,
  closeButton,
  owner,
  garmentId,
  locale,
  labels,
  samples,
  palette,
}: {
  anchor: StylePiecePhotoAnchor | null | undefined
  piece: StylePieceAnchor
  restoreWeatherFocus: boolean
  refreshRef: RefObject<InventoryRefresh | null>
  closeButton: RefObject<ComponentRef<typeof Pressable> | null>
  owner: string
  garmentId: string
  locale: string
  labels: Labels
  samples: SampleLabels
  palette: PreviewPalette
}) {
  const { category, comfortRange } = piece
  const photo = anchor?.photo
  const key = stylePieceStorageKey(owner, garmentId)
  const [weather, setWeather] = useState<StylePieceWeatherKey>(() =>
    initialStylePieceWeather(piece)
  )
  const [edits, setEdits] = useState<Record<string, StylePieceRecipe>>({})
  const [reopened, setReopened] = useState<string>()
  const [latestEdit, setLatestEdit] = useState<string>()
  const [saved, setSaved] = useState<StylePieceLook[]>([])
  const [storage, setStorage] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string>()
  const photoFailed = failedPhotoUrl !== undefined && failedPhotoUrl === photo?.url
  const [retrying, setRetrying] = useState(false)
  const authorized = Boolean(anchor) && !photoFailed
  const [notice, setNotice] = useState('')
  const adapter = useRef<Awaited<ReturnType<typeof sampleRecipeStorage>> | null>(null)
  const scroll = useRef<ScrollView | null>(null)
  const selectedWeather = useRef<ComponentRef<typeof Pressable> | null>(null)
  const reopenAction = useRef(0)

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
    let mounted = true
    void sampleRecipeStorage(key)
      .then((store) => {
        if (!mounted || !refreshRef.current?.currentAnchor()) return
        const entries = parseStylePieceRecipes(store.read(), { category, comfortRange })
        adapter.current = store
        setSaved(entries)
        setStorage('ready')
      })
      .catch(() => {
        if (mounted) setStorage('unavailable')
      })
    return () => {
      mounted = false
      adapter.current = null
    }
  }, [authorized, category, comfortRange, key, refreshRef])

  const currentPiece = (inventory: InventoryRefresh | null) => {
    const fresh = inventory?.currentAnchor()
    return fresh?.category === category && fresh.comfortRange === comfortRange
      ? fresh
      : null
  }

  const updateSaved = async (update: (entries: StylePieceLook[]) => StylePieceLook[]) => {
    const inventory = refreshRef.current
    if (!(await inventory?.refresh())) return false
    const fresh = currentPiece(inventory)
    const store = adapter.current
    if (!fresh || !store) return false
    try {
      const next = update(parseStylePieceRecipes(store.read(), fresh))
      store.write(JSON.stringify(next.map(({ recipe }) => recipe)))
      setSaved(next)
      return true
    } catch {
      setStorage('unavailable')
      return false
    }
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
    setWeather(value)
    setEdits({})
    setLatestEdit(undefined)
    setReopened(undefined)
    setNotice('')
  }

  const openSaved = async (entry: StylePieceLook) => {
    const action = ++reopenAction.current
    const inventory = refreshRef.current
    if (!(await inventory?.refresh()) || reopenAction.current !== action) return
    const fresh = currentPiece(inventory)
    const store = adapter.current
    if (!fresh || !store) return
    let recipe: StylePieceRecipe | undefined
    try {
      recipe = parseStylePieceRecipes(store.read(), fresh).find(
        (item) => stylePieceRecipeKey(item.recipe) === stylePieceRecipeKey(entry.recipe)
      )?.recipe
    } catch {
      setStorage('unavailable')
    }
    if (!recipe) return
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

  const text = { color: palette.text }
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

      {looks.map((look, index) => (
        <StylePieceCard
          key={stylePieceRecipeKey(look.recipe)}
          look={look}
          index={index}
          anchorPhoto={anchorPhoto}
          labels={labels}
          samples={samples}
          palette={palette}
          canSave={storage === 'ready'}
          onSave={() => {
            void updateSaved((current) => saveStylePieceRecipe(current, look)).then(
              (saved) => {
                if (saved) setNotice(labels.saved)
              }
            )
          }}
          onSwap={(category, id) => {
            reopenAction.current++
            setLatestEdit(look.recipe.lookId)
            setEdits((current) => ({
              ...current,
              [look.recipe.lookId]: {
                ...look.recipe,
                swaps: { ...look.recipe.swaps, [category]: id },
              },
            }))
            setNotice('')
          }}
        />
      ))}

      {storage === 'unavailable' && (
        <Text accessibilityRole="alert" style={text}>
          {labels.storage}
        </Text>
      )}
      {saved.length > 0 && (
        <View style={styles.group}>
          <Text
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            style={[styles.label, text]}
          >
            {notice || labels.saved}
          </Text>
          {saved.map((entry) => {
            const id = stylePieceRecipeKey(entry.recipe)
            const description = [
              weatherName(entry.recipe.weather),
              ...entry.companions.map((item) => sampleGarmentText(item, samples).name),
            ].join(' · ')
            return (
              <View key={id} style={[styles.card, { borderColor: palette.divider }]}>
                <Text style={text}>{description}</Text>
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
                    disabled={storage !== 'ready'}
                    onPress={() => {
                      void updateSaved((current) =>
                        current.filter(({ recipe }) => stylePieceRecipeKey(recipe) !== id)
                      ).then((removed) => {
                        if (!removed) return
                        setNotice('')
                        scroll.current?.scrollTo({ y: 0, animated: false })
                        focusStylePieceControl(selectedWeather.current)
                      })
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
  anchorPhoto,
  labels,
  samples,
  palette,
  canSave,
  onSave,
  onSwap,
}: {
  look: StylePieceLook
  index: number
  anchorPhoto: React.ReactNode
  labels: Labels
  samples: SampleLabels
  palette: PreviewPalette
  canSave: boolean
  onSave: () => void
  onSwap: (category: SampleGarmentCategory, id: string) => void
}) {
  const [editing, setEditing] = useState<SampleGarmentCategory | null>(null)
  const swapInvoker = useRef<ComponentRef<typeof Pressable> | null>(null)
  const text = { color: palette.text }

  return (
    <View
      testID="style-piece-look"
      style={[styles.card, { borderColor: palette.divider }]}
    >
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
      <PreviewButton
        label={labels.save}
        testID="style-piece-save"
        palette={palette}
        disabled={!canSave}
        onPress={onSave}
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
  title: { flex: 1, fontSize: 22, fontWeight: '700' },
  content: { paddingHorizontal: 20, paddingVertical: 12, gap: 16 },
  group: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  label: { fontWeight: '700' },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 12 },
  anchor: { width: 94, alignSelf: 'flex-start', gap: 4 },
  photo: { width: '100%', aspectRatio: 0.75, borderRadius: 8 },
  companions: { flexGrow: 1, flexShrink: 1, flexBasis: 145, gap: 8 },
  piece: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pieceName: { flex: 1 },
})

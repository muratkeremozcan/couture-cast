import { Image } from 'expo-image'
import { useId, useRef, useState, type ComponentRef } from 'react'
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  formatPreviewString,
  garmentSubtypeStrings,
  sampleGarmentText,
  todayCatalogSlot,
  todaySlotCatalogItem,
  type GuestPreviewStrings,
  type SampleSwapOptions,
  type TodaySlot,
} from '@couture/utils'
import {
  EdgeToEdgeModal,
  LayerSwipeHandle,
  useModalInsets,
} from '@/components/edge-to-edge-modal'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { useModalAnimation } from '@/src/hooks/use-modal-animation'
import { usePhotoBeforeExpiry } from '@/src/hooks/use-photo-before-expiry'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import {
  PreviewSampleSwapRows,
  SampleGarmentArt,
} from '@/src/features/preview/guest-preview-parts'
import { useTokens } from '@/src/theme/tokens'

type Button = ComponentRef<typeof Pressable>
const pictureHeight = 176

function slotName(
  slot: TodaySlot,
  strings: GuestPreviewStrings,
  locale: string | undefined
) {
  const item = todaySlotCatalogItem(slot)
  return item
    ? sampleGarmentText(item, strings).name
    : slot.subtype
      ? garmentSubtypeStrings(locale).values[slot.subtype]
      : strings.values.category[slot.category]
}

function usePiecePhoto(slot: TodaySlot) {
  const access = slot.imageAccess
  const [loadedUrl, setLoadedUrl] = useState<string>()
  const [unavailableUrl, setUnavailableUrl] = useState<string>()
  const beforeExpiry = usePhotoBeforeExpiry(
    access ? Date.parse(access.expiresAt) : undefined
  )
  const url =
    access && beforeExpiry && unavailableUrl !== access.url ? access.url : undefined

  return {
    url,
    loaded: url !== undefined && loadedUrl === url,
    onLoad: () => setLoadedUrl(url),
    onError: () => setUnavailableUrl(url),
  }
}

function PieceArt({
  slot,
  photo,
  size,
}: {
  slot: TodaySlot
  photo: ReturnType<typeof usePiecePhoto>
  size: number
}) {
  return (
    <>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={photo.loaded && styles.loading}
      >
        <SampleGarmentArt garment={slot} size={size} />
      </View>
      {photo.url && (
        <Image
          key={photo.url}
          source={{ uri: photo.url }}
          contentFit="contain"
          cachePolicy="none"
          recyclingKey={photo.url}
          accessible={false}
          style={[StyleSheet.absoluteFill, !photo.loaded && styles.loading]}
          onLoad={photo.onLoad}
          onError={photo.onError}
        />
      )}
    </>
  )
}

function PictureSlot({
  slot,
  index,
  label,
  setButton,
  onPress,
}: {
  slot: TodaySlot
  index: number
  label: string
  setButton: (node: Button | null) => void
  onPress: () => void
}) {
  const palette = useHeroPalette()
  const photo = usePiecePhoto(slot)
  return (
    <View
      collapsable={false}
      testID={`today-outfit-${photo.loaded ? 'photo' : 'catalog'}-${index}`}
      style={styles.tile}
    >
      <Pressable
        ref={setButton}
        testID={`today-outfit-slot-${index}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[
          styles.slot,
          { backgroundColor: palette.cardMuted, borderColor: palette.line },
        ]}
        onPress={onPress}
      >
        <PieceArt slot={slot} photo={photo} size={68} />
      </Pressable>
    </View>
  )
}

function OptionArt({ slot }: { slot: TodaySlot }) {
  const photo = usePiecePhoto(slot)
  return (
    <View style={styles.optionArt}>
      <PieceArt slot={slot} photo={photo} size={32} />
    </View>
  )
}

export function TodayOutfitPicture({
  slots,
  strings,
  locale,
  getOptions,
  getSampleOptions,
  onChoose,
}: {
  slots: readonly TodaySlot[]
  strings: GuestPreviewStrings
  locale?: string
  getOptions?: (index: number) => readonly TodaySlot[]
  getSampleOptions?: (index: number) => SampleSwapOptions | undefined
  onChoose: (index: number, slot: TodaySlot) => void
}) {
  const palette = useHeroPalette()
  const { scrim } = useTokens()
  const { bottom } = useModalInsets()
  const animation = useModalAnimation('slide')
  const titleId = useId()
  const [swappingIndex, setSwappingIndex] = useState<number | null>(null)
  const buttons = useRef(new Map<number, Button>())
  const invoker = useRef<Button | null>(null)
  const firstOption = useRef<Button | null>(null)
  const current = swappingIndex !== null ? slots[swappingIndex] : undefined
  const category = current ? strings.values.category[current.category] : ''
  const options = swappingIndex !== null ? (getOptions?.(swappingIndex) ?? []) : []
  const sampleOptions =
    swappingIndex !== null ? getSampleOptions?.(swappingIndex) : undefined
  const title = formatPreviewString(strings.outfit.swapTitle, { category })

  const renderOption = (
    slot: TodaySlot,
    index: number,
    selected: boolean,
    name = slotName(slot, strings, locale),
    ref?: React.Ref<Button>
  ) => (
    <Pressable
      key={slot.itemId}
      ref={index === 0 ? firstOption : ref}
      testID={`today-outfit-swap-option-${index}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      style={[styles.option, { borderColor: palette.line }]}
      onPress={() => {
        if (swappingIndex !== null && !selected) onChoose(swappingIndex, slot)
        setSwappingIndex(null)
      }}
    >
      <OptionArt slot={slot} />
      <Text style={[styles.optionLabel, { color: palette.ink }]}>{name}</Text>
      {selected && (
        <Text style={{ color: palette.inkMuted }}>{strings.outfit.current}</Text>
      )}
    </Pressable>
  )

  return (
    <>
      <ScrollView
        testID="today-outfit-picture"
        style={[styles.picture, { backgroundColor: palette.page }]}
        contentContainerStyle={[
          styles.pictureContent,
          slots.length <= 3 && styles.singleRow,
        ]}
        nestedScrollEnabled
        scrollEnabled={slots.length > 6}
      >
        {slots.map((slot, index) => (
          <PictureSlot
            key={index}
            slot={slot}
            index={index}
            setButton={(node) => {
              if (node) buttons.current.set(index, node)
              else buttons.current.delete(index)
            }}
            label={`${formatPreviewString(strings.outfit.swap, { category: strings.values.category[slot.category] })}: ${slotName(slot, strings, locale)}`}
            onPress={() => {
              invoker.current = buttons.current.get(index) ?? null
              setSwappingIndex(index)
            }}
          />
        ))}
      </ScrollView>
      <EdgeToEdgeModal
        visible={current !== undefined}
        animationType={animation}
        onShow={() =>
          requestAnimationFrame(() => {
            const option = firstOption.current
            option?.focus()
            const node = safeFindNodeHandle(option)
            if (node) AccessibilityInfo.setAccessibilityFocus(node)
          })
        }
        onRequestClose={() => setSwappingIndex(null)}
        returnFocusRef={invoker}
        scrim={scrim}
      >
        <View style={styles.overlay}>
          <View
            testID="today-outfit-swap"
            role="dialog"
            aria-modal
            aria-labelledby={titleId}
            accessibilityViewIsModal
            accessibilityLabel={title}
            style={[
              styles.sheet,
              { backgroundColor: palette.page, paddingBottom: 16 + bottom },
            ]}
          >
            <LayerSwipeHandle>
              <Text
                nativeID={titleId}
                accessibilityRole="header"
                style={[styles.title, { color: palette.ink }]}
              >
                {title}
              </Text>
            </LayerSwipeHandle>
            {sampleOptions ? (
              <ScrollView style={styles.sampleSwapScroll}>
                <PreviewSampleSwapRows
                  options={sampleOptions}
                  label={title}
                  strings={strings}
                  palette={palette}
                  showMoreTestId="today-outfit-swap-show-more"
                  renderOption={(garment, index, selected, ref) =>
                    renderOption(
                      todayCatalogSlot(garment),
                      index,
                      selected,
                      sampleGarmentText(garment, strings).name,
                      ref
                    )
                  }
                />
              </ScrollView>
            ) : (
              <ScrollView accessibilityRole="radiogroup" aria-labelledby={titleId}>
                {options.map((slot, index) => renderOption(slot, index, index === 0))}
                {options.length === 1 && (
                  <Text style={{ color: palette.inkMuted }}>
                    {strings.outfit.noSuitableAlternative}
                  </Text>
                )}
              </ScrollView>
            )}
            <Pressable
              accessibilityRole="button"
              style={[styles.close, { borderColor: palette.lineStrong }]}
              onPress={() => setSwappingIndex(null)}
            >
              <Text style={{ color: palette.ink }}>{strings.chrome.close}</Text>
            </Pressable>
          </View>
        </View>
      </EdgeToEdgeModal>
    </>
  )
}

const styles = StyleSheet.create({
  picture: { height: pictureHeight, flexGrow: 0, borderRadius: 8 },
  pictureContent: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 4 },
  singleRow: { minHeight: pictureHeight, alignContent: 'center' },
  tile: {
    width: '31%',
    minWidth: 44,
    height: 80,
  },
  slot: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { opacity: 0 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 8,
    maxHeight: '72%',
  },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  sampleSwapScroll: { flexGrow: 0, flexShrink: 1 },
  option: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    paddingVertical: 4,
  },
  optionArt: { position: 'relative', borderRadius: 8, overflow: 'hidden' },
  optionLabel: { flex: 1, minWidth: 0 },
  close: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
  },
})

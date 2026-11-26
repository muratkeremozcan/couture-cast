// Story 6.16: the building blocks of the mobile guest preview. Each reads the shared
// policy result and strings, so mobile says and shows exactly what web does.
import { useEffect, useRef, useState, type ComponentRef, type Ref } from 'react'
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Svg, { Path } from 'react-native-svg'
import {
  colorRoles,
  evaluateGuestPreviewGate,
  formatPreviewString,
  formatSampleExplanation,
  formatSampleTemperature,
  hasAppliedSampleSwaps,
  resolveSampleArt,
  SAMPLE_ART_VIEWBOX,
  SAMPLE_CATALOG,
  SAMPLE_COLLECTION_FILTERS,
  SAMPLE_GARMENT_CATEGORIES,
  SAMPLE_WEATHER,
  SAMPLE_WEATHER_KEYS,
  sampleFeedbackProgress,
  sampleGarmentText,
  sampleLookText,
  type GuestPreviewState,
  type GuestPreviewStrings,
  type SampleCollectionFilter,
  type SampleComfort,
  type SampleGarment,
  type SampleGarmentCategory,
  type SampleOutfitResult,
  type SampleVote,
  type GuestSampleWeatherKey,
} from '@couture/utils'
import {
  EdgeToEdgeModal,
  LayerSwipeHandle,
  type LayerFocusTarget,
} from '@/components/edge-to-edge-modal'
import { type useHeroPalette } from '@/components/hero/hero-theme'
import { useTokens, withAlpha } from '@/src/theme/tokens'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { useModalAnimation } from '@/src/hooks/use-modal-animation'

export type PreviewPalette = ReturnType<typeof useHeroPalette>
export type PreviewControl = 'weather' | 'thermal' | 'wind' | 'rain'

/**
 * The sample art palette is drawn for a light ground, so its tile stays the light card in both
 * schemes: a light tile keeps dark garments visible in the dark theme.
 */
const ART_TILE = colorRoles.light.card
const ART_OUTLINE = withAlpha(colorRoles.light.ink, 0.18)

export function SampleGarmentArt({
  garment,
  label,
  size = 72,
}: {
  garment: Pick<SampleGarment, 'art' | 'category'>
  label?: string
  size?: number
}) {
  const art = resolveSampleArt(garment.art, garment.category)
  return (
    <View style={[styles.artTile, { width: size + 12, height: size + 12 }]}>
      <Svg
        viewBox={SAMPLE_ART_VIEWBOX}
        width={size}
        height={size}
        testID={art.fallback ? 'sample-garment-art-fallback' : 'sample-garment-art'}
        accessible={Boolean(label)}
        accessibilityLabel={label}
      >
        {art.paths.map((path, index) =>
          path.stroke ? (
            <Path
              key={index}
              d={path.d}
              fill="none"
              stroke={path.tone === 'primary' ? art.primary : art.secondary}
              strokeWidth={2}
            />
          ) : (
            <Path
              key={index}
              d={path.d}
              fill={path.tone === 'primary' ? art.primary : art.secondary}
              stroke={ART_OUTLINE}
              strokeWidth={1}
            />
          )
        )}
      </Svg>
    </View>
  )
}

export function PreviewButton({
  label,
  onPress,
  testID,
  palette,
  primary = false,
  disabled = false,
  expanded,
  selected,
  accessibilityLabel,
  buttonRef,
}: {
  label: string
  onPress: () => void
  testID: string
  palette: PreviewPalette
  primary?: boolean
  disabled?: boolean
  expanded?: boolean
  selected?: boolean
  accessibilityLabel?: string
  buttonRef?: Ref<ComponentRef<typeof Pressable>>
}) {
  return (
    <Pressable
      ref={buttonRef}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      aria-disabled={disabled}
      aria-expanded={expanded}
      // ARIA allows aria-selected only on option/tab/row/gridcell/treeitem,
      // so the web side uses aria-pressed.
      accessibilityState={{ selected }}
      aria-pressed={selected}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        // Story CC-7.9 D3: a filled button is ink; any other is the neutral outline.
        primary
          ? { backgroundColor: palette.inverse }
          : { borderColor: palette.lineStrong, borderWidth: 1 },
        disabled ? styles.disabled : null,
      ]}
    >
      <Text
        style={[styles.buttonText, { color: primary ? palette.onInverse : palette.ink }]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export function ChoiceGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
  testID,
  palette,
}: {
  legend: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  testID: string
  palette: PreviewPalette
}) {
  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel={legend}
      style={styles.group}
    >
      <Text style={[styles.legend, { color: palette.inkMuted }]}>{legend}</Text>
      <View style={styles.wrap}>
        {options.map((option) => {
          const checked = option.value === value
          return (
            <Pressable
              key={option.value}
              testID={`${testID}-${option.value}`}
              accessibilityRole="radio"
              aria-checked={checked}
              onPress={() => onChange(option.value)}
              style={[
                styles.chip,
                checked
                  ? { backgroundColor: palette.inverse, borderColor: palette.inverse }
                  : { borderColor: palette.lineStrong },
              ]}
            >
              <Text style={{ color: checked ? palette.onInverse : palette.ink }}>
                {option.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export function PreviewGate({
  strings,
  palette,
  onEligible,
  onExit,
}: {
  strings: GuestPreviewStrings
  palette: PreviewPalette
  onEligible: () => void
  onExit: () => void
}) {
  const [birthdate, setBirthdate] = useState('')
  const [error, setError] = useState<'underage' | 'invalid' | null>(null)
  const submit = () => {
    const result = evaluateGuestPreviewGate(birthdate)
    setBirthdate('')
    if (result.eligible) {
      setError(null)
      onEligible()
      return
    }
    setError(result.reason === 'underage' ? 'underage' : 'invalid')
  }
  return (
    <View
      testID="guest-preview-gate"
      style={[styles.card, { backgroundColor: palette.card, borderColor: palette.line }]}
    >
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.ink }]}>
        {strings.gate.heading}
      </Text>
      <Text style={{ color: palette.inkMuted }}>{strings.gate.body}</Text>
      <Text style={{ color: palette.ink }}>{strings.gate.field}</Text>
      <TextInput
        testID="guest-preview-birthdate"
        accessibilityLabel={strings.gate.field}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        autoComplete="off"
        value={birthdate}
        onChangeText={setBirthdate}
        onSubmitEditing={submit}
        style={[styles.input, { borderColor: palette.lineStrong, color: palette.ink }]}
      />
      {error ? (
        <Text
          testID="guest-preview-gate-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{ color: palette.dangerInk }}
        >
          {error === 'underage' ? strings.gate.underage : strings.gate.invalid}
        </Text>
      ) : null}
      <PreviewButton
        label={strings.gate.submit}
        onPress={submit}
        testID="guest-preview-gate-submit"
        palette={palette}
        primary
      />
      <Text style={[styles.small, { color: palette.inkMuted }]}>
        {strings.gate.selfReported}
      </Text>
      <PreviewButton
        label={strings.gate.exit}
        onPress={onExit}
        testID="guest-preview-gate-exit"
        palette={palette}
      />
    </View>
  )
}

function useSwapButtonFocus(category: SampleGarmentCategory | null) {
  const previous = useRef(category)
  const buttons = useRef(new Map<SampleGarmentCategory, ComponentRef<typeof Pressable>>())
  useEffect(() => {
    const closed = previous.current
    previous.current = category
    if (!closed || category) return
    const frame = requestAnimationFrame(() => {
      const button = buttons.current.get(closed)
      if (Platform.OS === 'web') button?.focus()
      else {
        const node = safeFindNodeHandle(button)
        if (node != null) AccessibilityInfo.setAccessibilityFocus(node)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [category])
  return buttons
}

export function PreviewOutfit({
  result,
  strings,
  locale,
  palette,
  noAlternative,
  onTryAnother,
  onSwap,
  onUndoSwaps,
  onBrowseWardrobe,
  onReviewChoices,
  onResetChoices,
  heading,
  continuation,
  swapCategory = null,
}: {
  result: SampleOutfitResult
  strings: GuestPreviewStrings
  locale: string
  palette: PreviewPalette
  noAlternative: boolean
  onTryAnother: () => void
  onSwap: (category: SampleGarmentCategory) => void
  onUndoSwaps: () => void
  onBrowseWardrobe?: () => void
  onReviewChoices: () => void
  onResetChoices: () => void
  heading?: string
  continuation?: React.ReactNode
  swapCategory?: SampleGarmentCategory | null
}) {
  const swapButtons = useSwapButtonFocus(swapCategory)
  const look = result.look
  const hasSwaps = hasAppliedSampleSwaps(result)
  if (!look) {
    return (
      <View
        testID="guest-preview-empty"
        style={[
          styles.card,
          { backgroundColor: palette.card, borderColor: palette.line },
        ]}
      >
        <Text accessibilityRole="header" style={[styles.heading, { color: palette.ink }]}>
          {result.reason === 'all-disliked'
            ? strings.outfit.allDisliked
            : strings.outfit.noEligible}
        </Text>
        <PreviewButton
          label={strings.outfit.reviewChoices}
          onPress={onReviewChoices}
          testID="guest-preview-review-choices"
          palette={palette}
        />
        <PreviewButton
          label={strings.outfit.resetChoices}
          onPress={onResetChoices}
          testID="guest-preview-reset-choices"
          palette={palette}
          primary
        />
      </View>
    )
  }
  const lookText = sampleLookText(look, strings)
  return (
    <View
      testID="guest-preview-outfit"
      style={[styles.card, { backgroundColor: palette.card, borderColor: palette.line }]}
    >
      {(heading || !hasSwaps) && (
        <Text style={[styles.eyebrow, { color: palette.inkMuted }]}>
          {heading ?? strings.outfit.heading}
        </Text>
      )}
      <Text
        testID="guest-preview-look-name"
        accessibilityRole="header"
        style={[styles.heading, { color: palette.ink }]}
      >
        {hasSwaps ? strings.outfit.heading : lookText.name}
      </Text>
      {!hasSwaps && (
        <Text style={{ color: palette.inkMuted }}>{lookText.description}</Text>
      )}
      <Text
        testID="guest-preview-weather-chip"
        style={[styles.chipLabel, { color: palette.ink }]}
      >
        {strings.values.weather[result.context.weather]}
      </Text>
      {continuation}
      <PreviewButton
        label={strings.outfit.tryAnother}
        onPress={onTryAnother}
        testID="guest-preview-try-another"
        palette={palette}
        primary
      />
      <Text style={{ color: palette.inkMuted }}>{strings.styleIdeas.illustrations}</Text>
      <View testID="guest-preview-garments" style={styles.wrap}>
        {result.garments.map((garment) => {
          const text = sampleGarmentText(garment, strings)
          const category = strings.values.category[garment.category]
          const swapLabel = formatPreviewString(strings.outfit.swap, { category })
          return (
            <View
              key={garment.category}
              testID={`guest-preview-garment-${garment.id.slice('sample:g:'.length)}`}
              // Inside the outfit card, so a plain section (Story CC-7.9 D7: one card level).
              style={styles.garment}
            >
              <SampleGarmentArt garment={garment} label={text.description} />
              <Text style={[styles.garmentName, { color: palette.ink }]}>
                {text.name}
              </Text>
              <PreviewButton
                buttonRef={(button) => {
                  if (button) swapButtons.current.set(garment.category, button)
                  else swapButtons.current.delete(garment.category)
                }}
                label={swapLabel}
                accessibilityLabel={`${swapLabel}: ${text.name}`}
                onPress={() => onSwap(garment.category)}
                testID={`guest-preview-swap-${garment.category}`}
                palette={palette}
              />
            </View>
          )
        })}
      </View>
      <Text style={[styles.subheading, { color: palette.ink }]}>
        {strings.outfit.whyThisWorks}
      </Text>
      <View testID="guest-preview-explanation" accessibilityLiveRegion="polite">
        {result.explanation.map((item, index) => (
          <Text key={`${item.key}-${index}`} style={{ color: palette.inkMuted }}>
            {`• ${formatSampleExplanation(item, { strings, locale, catalog: SAMPLE_CATALOG })}`}
          </Text>
        ))}
      </View>
      {noAlternative ? (
        <Text
          testID="guest-preview-no-alternative"
          accessibilityLiveRegion="polite"
          style={{ color: palette.ink }}
        >
          {strings.outfit.noAlternative}
        </Text>
      ) : null}
      {hasSwaps ? (
        <PreviewButton
          label={strings.outfit.undoSwaps}
          onPress={onUndoSwaps}
          testID="guest-preview-undo-swaps"
          palette={palette}
        />
      ) : null}
      {onBrowseWardrobe && (
        <PreviewButton
          label={strings.outfit.browseWardrobe}
          onPress={onBrowseWardrobe}
          testID="guest-preview-browse-wardrobe"
          palette={palette}
        />
      )}
    </View>
  )
}

const RUNS = ['cold', 'neutral', 'warm'] as const
const TOLERANCES = ['low', 'medium', 'high'] as const

export function PreviewControls({
  state,
  strings,
  locale,
  palette,
  onWeather,
  onComfort,
}: {
  state: GuestPreviewState
  strings: GuestPreviewStrings
  locale: string
  palette: PreviewPalette
  onWeather: (weather: GuestSampleWeatherKey) => void
  onComfort: (comfort: SampleComfort, control: PreviewControl) => void
}) {
  const { values } = strings
  const weather = SAMPLE_WEATHER[state.weather]
  return (
    <View
      testID="guest-preview-controls"
      style={[styles.card, { backgroundColor: palette.card, borderColor: palette.line }]}
    >
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.ink }]}>
        {strings.preferences.heading}
      </Text>
      <Text style={{ color: palette.inkMuted }}>{strings.chrome.supporting}</Text>
      <ChoiceGroup
        legend={strings.preferences.weather}
        testID="guest-preview-weather"
        value={state.weather}
        options={SAMPLE_WEATHER_KEYS.map((key) => ({
          value: key,
          label: values.weather[key],
        }))}
        onChange={onWeather}
        palette={palette}
      />
      <Text style={[styles.small, { color: palette.inkMuted }]}>
        {formatPreviewString(strings.preferences.weatherDetail, {
          temperature: formatSampleTemperature(weather.feelsLike, locale),
          windSpeed: weather.windSpeed,
          rainPercent: Math.round(weather.precipitationProbability * 100),
        })}
      </Text>
      <ChoiceGroup
        legend={strings.preferences.thermal}
        testID="guest-preview-thermal"
        value={state.comfort.runsColdWarm}
        options={RUNS.map((run) => ({ value: run, label: values.runsColdWarm[run] }))}
        onChange={(runsColdWarm) =>
          onComfort({ ...state.comfort, runsColdWarm }, 'thermal')
        }
        palette={palette}
      />
      <ChoiceGroup
        legend={strings.preferences.wind}
        testID="guest-preview-wind"
        value={state.comfort.windTolerance}
        options={TOLERANCES.map((level) => ({
          value: level,
          label: values.windTolerance[level],
        }))}
        onChange={(windTolerance) =>
          onComfort({ ...state.comfort, windTolerance }, 'wind')
        }
        palette={palette}
      />
      <ChoiceGroup
        legend={strings.preferences.rain}
        testID="guest-preview-rain"
        value={state.comfort.precipPreparedness}
        options={TOLERANCES.map((level) => ({
          value: level,
          label: values.precipPreparedness[level],
        }))}
        onChange={(precipPreparedness) =>
          onComfort({ ...state.comfort, precipPreparedness }, 'rain')
        }
        palette={palette}
      />
    </View>
  )
}

const garmentsById = new Map(
  SAMPLE_CATALOG.garments.map((garment) => [garment.id, garment])
)

export function PreviewFeedback({
  votes,
  strings,
  palette,
  onVote,
  onReset,
}: {
  votes: Readonly<Record<string, SampleVote>>
  strings: GuestPreviewStrings
  palette: PreviewPalette
  onVote: (lookId: string, vote: SampleVote) => void
  onReset: () => void
}) {
  const progress = sampleFeedbackProgress(votes, SAMPLE_CATALOG)
  return (
    <View
      testID="guest-preview-feedback"
      style={[styles.card, { backgroundColor: palette.card, borderColor: palette.line }]}
    >
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.ink }]}>
        {strings.feedback.heading}
      </Text>
      <Text style={{ color: palette.inkMuted }}>{strings.feedback.body}</Text>
      <Text
        testID="guest-preview-feedback-progress"
        accessibilityLiveRegion="polite"
        style={{ color: palette.ink }}
      >
        {formatPreviewString(strings.feedback.progress, {
          reviewed: progress.reviewed,
          total: progress.total,
        })}
      </Text>
      {progress.cards.map((card) => {
        const vote = votes[card.id]
        const text = sampleLookText(card, strings)
        return (
          <View
            key={card.id}
            testID={`guest-preview-card-${card.id.slice('sample:l:'.length)}`}
            // Inside the feedback card, so a plain section under a rule (Story CC-7.9 D7).
            style={[styles.feedbackCard, { borderTopColor: palette.line }]}
          >
            <View
              style={styles.wrap}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {card.core.map((id) => {
                const garment = garmentsById.get(id)
                return garment ? (
                  <SampleGarmentArt key={id} garment={garment} size={36} />
                ) : null
              })}
            </View>
            <Text style={[styles.subheading, { color: palette.ink }]}>{text.name}</Text>
            <Text style={{ color: palette.inkMuted }}>{text.description}</Text>
            <View style={styles.row}>
              {(['like', 'dislike'] as const).map((choice) => {
                const selected = vote === choice
                return (
                  <Pressable
                    key={choice}
                    testID={`guest-preview-vote-${choice}-${card.id.slice('sample:l:'.length)}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${choice === 'like' ? strings.feedback.like : strings.feedback.dislike}: ${text.name}`}
                    // ARIA allows aria-selected only on option/tab/row/gridcell/treeitem,
                    // so the web side uses aria-pressed.
                    accessibilityState={{ selected }}
                    aria-pressed={selected}
                    onPress={() => onVote(card.id, choice)}
                    style={[
                      styles.voteButton,
                      selected
                        ? {
                            backgroundColor: palette.inverse,
                            borderColor: palette.inverse,
                          }
                        : { borderColor: palette.lineStrong },
                    ]}
                  >
                    <Text style={{ color: selected ? palette.onInverse : palette.ink }}>
                      {choice === 'like'
                        ? strings.feedback.like
                        : strings.feedback.dislike}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )
      })}
      <PreviewButton
        label={strings.outfit.resetChoices}
        onPress={onReset}
        testID="guest-preview-feedback-reset"
        palette={palette}
      />
    </View>
  )
}

type CategoryFilter = SampleGarmentCategory | 'all'

export function PreviewWardrobe({
  strings,
  palette,
  collection,
  usableIds,
  onCollection,
  onCategory,
  onInspect,
  onUse,
  onBackToOutfit,
}: {
  strings: GuestPreviewStrings
  palette: PreviewPalette
  collection: SampleCollectionFilter
  usableIds: ReadonlySet<string>
  onCollection: (collection: SampleCollectionFilter) => void
  onCategory: () => void
  onInspect: () => void
  onUse: (garment: SampleGarment) => void
  onBackToOutfit: () => void
}) {
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [open, setOpen] = useState<SampleGarment | null>(null)
  // Story CC-7.11 D13: the garment that opened the detail takes focus back when it closes.
  const detailOpener = useRef<unknown>(null)
  const { values } = strings
  const items = SAMPLE_CATALOG.garments.filter(
    (garment) =>
      (category === 'all' || garment.category === category) &&
      (collection === 'all' || garment.collections.includes(collection))
  )
  const openText = open ? sampleGarmentText(open, strings) : null
  return (
    <View testID="guest-preview-wardrobe" style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.ink }]}>
        {strings.wardrobe.heading}
      </Text>
      <PreviewButton
        label={strings.wardrobe.backToOutfit}
        onPress={onBackToOutfit}
        testID="guest-preview-back-to-outfit"
        palette={palette}
      />
      <ChoiceGroup
        legend={strings.wardrobe.category}
        testID="guest-preview-category"
        value={category}
        options={[
          { value: 'all' as const, label: strings.wardrobe.allCategories },
          ...SAMPLE_GARMENT_CATEGORIES.map((key) => ({
            value: key,
            label: values.categoryTitle[key],
          })),
        ]}
        onChange={(next) => {
          setCategory(next)
          onCategory()
        }}
        palette={palette}
      />
      <ChoiceGroup
        legend={strings.preferences.collection}
        testID="guest-preview-collection"
        value={collection}
        options={SAMPLE_COLLECTION_FILTERS.map((key) => ({
          value: key,
          label: values.collection[key],
        }))}
        onChange={onCollection}
        palette={palette}
      />
      <Text
        testID="guest-preview-item-count"
        accessibilityLiveRegion="polite"
        style={{ color: palette.inkMuted }}
      >
        {items.length === 0
          ? strings.wardrobe.empty
          : formatPreviewString(strings.wardrobe.count, { count: items.length })}
      </Text>
      <View style={styles.wrap}>
        {items.map((garment) => {
          const text = sampleGarmentText(garment, strings)
          return (
            <Pressable
              key={garment.id}
              testID={`guest-preview-item-${garment.id.slice('sample:g:'.length)}`}
              accessibilityRole="button"
              accessibilityLabel={`${text.name}, ${values.categoryTitle[garment.category]}`}
              onPress={(event) => {
                detailOpener.current = event.currentTarget
                setOpen(garment)
                onInspect()
              }}
              style={[
                styles.garment,
                styles.garmentCard,
                { backgroundColor: palette.card, borderColor: palette.line },
              ]}
            >
              <SampleGarmentArt garment={garment} />
              <Text style={[styles.garmentName, { color: palette.ink }]}>
                {text.name}
              </Text>
              <Text style={[styles.small, { color: palette.inkMuted }]}>
                {values.categoryTitle[garment.category]}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <PreviewSheet
        visible={open !== null}
        title={openText?.name ?? ''}
        strings={strings}
        palette={palette}
        onClose={() => setOpen(null)}
        returnFocusRef={detailOpener}
        testID="guest-preview-item-detail"
      >
        {open && openText ? (
          <>
            <SampleGarmentArt garment={open} label={openText.description} size={96} />
            <Text style={{ color: palette.ink }}>{openText.description}</Text>
            <DetailRow
              label={strings.wardrobe.category}
              value={values.categoryTitle[open.category]}
              palette={palette}
            />
            {open.material ? (
              <DetailRow
                label={strings.wardrobe.material}
                value={values.material[open.material]}
                palette={palette}
              />
            ) : null}
            <DetailRow
              label={strings.wardrobe.comfortRange}
              value={open.comfortRanges.map((range) => values.range[range]).join(', ')}
              palette={palette}
            />
            <DetailRow
              label={strings.wardrobe.windResistant}
              value={open.windResistant ? strings.wardrobe.yes : strings.wardrobe.no}
              palette={palette}
            />
            <DetailRow
              label={strings.wardrobe.waterResistant}
              value={open.waterResistant ? strings.wardrobe.yes : strings.wardrobe.no}
              palette={palette}
            />
            {usableIds.has(open.id) ? (
              <PreviewButton
                label={formatPreviewString(strings.outfit.swap, {
                  category: values.category[open.category],
                })}
                onPress={() => {
                  onUse(open)
                  setOpen(null)
                }}
                testID="guest-preview-use-item"
                palette={palette}
                primary
              />
            ) : null}
          </>
        ) : null}
      </PreviewSheet>
    </View>
  )
}

function DetailRow({
  label,
  value,
  palette,
}: {
  label: string
  value: string
  palette: PreviewPalette
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: palette.inkMuted }]}>{label}</Text>
      <Text style={{ color: palette.ink }}>{value}</Text>
    </View>
  )
}

/** A bottom sheet over the preview. Android Back closes it before leaving the screen. */
export function PreviewSheet({
  visible,
  title,
  strings,
  palette,
  onClose,
  returnFocusRef = null,
  testID,
  children,
}: {
  visible: boolean
  title: string
  strings: GuestPreviewStrings
  palette: PreviewPalette
  onClose: () => void
  /**
   * Story CC-7.11 D13: the opener that takes focus back on close. The swap sheet leaves it out:
   * useSwapButtonFocus returns focus to the swap button itself.
   */
  returnFocusRef?: LayerFocusTarget | null
  testID: string
  children: React.ReactNode
}) {
  const modalAnimation = useModalAnimation('slide')
  const { scrim } = useTokens()
  return (
    <EdgeToEdgeModal
      visible={visible}
      animationType={modalAnimation}
      onRequestClose={onClose}
      returnFocusRef={returnFocusRef}
      scrim={scrim}
    >
      <View style={styles.sheetSpacer} />
      <View
        testID={testID}
        accessibilityViewIsModal
        style={[styles.sheet, { backgroundColor: palette.page }]}
      >
        {/* Story CC-7.11 D13: the header is the layer's swipe-down handle, through the same close. */}
        <LayerSwipeHandle style={styles.sheetHeader}>
          <Text
            accessibilityRole="header"
            style={[styles.heading, styles.sheetTitle, { color: palette.ink }]}
          >
            {title}
          </Text>
          <Pressable
            testID={`${testID}-close`}
            accessibilityRole="button"
            accessibilityLabel={strings.chrome.close}
            onPress={onClose}
            style={styles.close}
          >
            <Text style={{ color: palette.ink, fontSize: 20 }}>{'×'}</Text>
          </Pressable>
        </LayerSwipeHandle>
        <Text style={[styles.small, { color: palette.inkMuted }]}>
          {strings.chrome.sampleLabel}
        </Text>
        {children}
      </View>
    </EdgeToEdgeModal>
  )
}

export function PreviewSwapSheet({
  category,
  candidates,
  currentId,
  strings,
  palette,
  onChoose,
  onClose,
}: {
  category: SampleGarmentCategory | null
  candidates: readonly SampleGarment[]
  currentId: string | undefined
  strings: GuestPreviewStrings
  palette: PreviewPalette
  onChoose: (garmentId: string) => void
  onClose: () => void
}) {
  const label = category ? strings.values.category[category] : ''
  const alternatives = candidates.filter((garment) => garment.id !== currentId)
  return (
    <PreviewSheet
      visible={category !== null}
      title={formatPreviewString(strings.outfit.swapTitle, { category: label })}
      strings={strings}
      palette={palette}
      onClose={onClose}
      testID="guest-preview-swap-sheet"
    >
      {alternatives.length === 0 ? (
        <Text testID="guest-preview-no-suitable" style={{ color: palette.ink }}>
          {strings.outfit.noSuitableAlternative}
        </Text>
      ) : (
        <View accessibilityRole="radiogroup" accessibilityLabel={label}>
          {candidates.map((garment) => {
            const text = sampleGarmentText(garment, strings)
            const checked = garment.id === currentId
            return (
              <Pressable
                key={garment.id}
                testID={`guest-preview-swap-option-${garment.id.slice('sample:g:'.length)}`}
                accessibilityRole="radio"
                aria-checked={checked}
                accessibilityLabel={
                  checked ? `${text.name} (${strings.outfit.current})` : text.name
                }
                onPress={() => onChoose(garment.id)}
                style={[
                  styles.option,
                  { borderColor: checked ? palette.ink : palette.line },
                ]}
              >
                <SampleGarmentArt garment={garment} size={40} />
                <Text style={[styles.optionText, { color: palette.ink }]}>
                  {checked ? `${text.name} (${strings.outfit.current})` : text.name}
                </Text>
              </Pressable>
            )
          })}
        </View>
      )}
    </PreviewSheet>
  )
}

export function PreviewConversion({
  strings,
  palette,
  onCreateAccount,
  onSignIn,
}: {
  strings: GuestPreviewStrings
  palette: PreviewPalette
  onCreateAccount: () => void
  onSignIn: () => void
}) {
  const detail = strings.conversionDetail
  return (
    <View
      testID="guest-preview-conversion"
      style={[
        styles.card,
        { backgroundColor: palette.card, borderColor: palette.lineStrong },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.subheading, { color: palette.ink }]}
      >
        {detail.garmentHeading}
      </Text>
      <Text style={{ color: palette.ink }}>{strings.chrome.conversion}</Text>
      {(
        [
          [detail.canSave, detail.canSaveBody],
          [detail.previewOnly, detail.previewOnlyBody],
          [detail.stillRequired, detail.stillRequiredBody],
        ] as const
      ).map(([title, body]) => (
        <View key={title}>
          <Text style={[styles.subheading, { color: palette.ink }]}>{title}</Text>
          <Text style={{ color: palette.inkMuted }}>{body}</Text>
        </View>
      ))}
      <PreviewButton
        label={strings.chrome.createAccount}
        onPress={onCreateAccount}
        testID="guest-preview-create-account"
        palette={palette}
        primary
      />
      <PreviewButton
        label={strings.chrome.signIn}
        onPress={onSignIn}
        testID="guest-preview-sign-in"
        palette={palette}
      />
      <Text style={[styles.small, { color: palette.inkMuted }]}>
        {strings.chrome.connectionNeeded}
      </Text>
    </View>
  )
}

export const previewStyles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  label: { borderRadius: 12, padding: 12, fontWeight: '600' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: {
    minHeight: 44,
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
})

const styles = StyleSheet.create({
  artTile: {
    backgroundColor: ART_TILE,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    minHeight: 44,
    borderRadius: 9999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.6 },
  group: { gap: 8 },
  legend: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    minHeight: 44,
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  section: { gap: 12 },
  heading: { fontSize: 20, fontWeight: '700' },
  subheading: { fontSize: 16, fontWeight: '700' },
  eyebrow: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  chipLabel: { fontSize: 14, fontWeight: '600' },
  small: { fontSize: 14 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12 },
  garment: {
    width: 148,
    borderRadius: 12,
    padding: 8,
    gap: 8,
    alignItems: 'center',
  },
  garmentCard: { borderWidth: 1 },
  garmentName: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  feedbackCard: { borderTopWidth: 1, paddingTop: 12, gap: 8 },
  voteButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontWeight: '600' },
  sheetSpacer: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 12,
    maxHeight: '85%',
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetTitle: { flex: 1 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  option: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderRadius: 12,
    padding: 8,
    marginBottom: 8,
  },
  optionText: { flex: 1, fontSize: 16 },
})

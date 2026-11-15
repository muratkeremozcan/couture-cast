// Story 6.16: the building blocks of the mobile guest preview. Each reads the shared
// policy result and strings, so mobile says and shows exactly what web does.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import {
  evaluateGuestPreviewGate,
  formatPreviewString,
  formatSampleExplanation,
  formatSampleTemperature,
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
  type SampleWeatherKey,
} from '@couture/utils'
import { EdgeToEdgeModal } from '@/components/edge-to-edge-modal'
import { type useHeroPalette } from '@/components/hero/hero-theme'

export type PreviewPalette = ReturnType<typeof useHeroPalette>
export type PreviewControl = 'weather' | 'thermal' | 'wind' | 'rain'

const LIGHT_TILE = '#F5F5F7'

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
              stroke="rgba(17,17,17,0.18)"
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
  accessibilityLabel,
}: {
  label: string
  onPress: () => void
  testID: string
  palette: PreviewPalette
  primary?: boolean
  disabled?: boolean
  accessibilityLabel?: string
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        primary
          ? { backgroundColor: palette.text }
          : { borderColor: palette.text, borderWidth: 1 },
        disabled ? styles.disabled : null,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          { color: primary ? palette.background : palette.text },
        ]}
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
      <Text style={[styles.legend, { color: palette.mutedText }]}>{legend}</Text>
      <View style={styles.wrap}>
        {options.map((option) => {
          const checked = option.value === value
          return (
            <Pressable
              key={option.value}
              testID={`${testID}-${option.value}`}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              onPress={() => onChange(option.value)}
              style={[
                styles.chip,
                checked
                  ? { backgroundColor: palette.text, borderColor: palette.text }
                  : { borderColor: palette.divider },
              ]}
            >
              <Text style={{ color: checked ? palette.background : palette.text }}>
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
      style={[styles.card, { borderColor: palette.divider }]}
    >
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
        {strings.gate.heading}
      </Text>
      <Text style={{ color: palette.mutedText }}>{strings.gate.body}</Text>
      <Text style={{ color: palette.text }}>{strings.gate.field}</Text>
      <TextInput
        testID="guest-preview-birthdate"
        accessibilityLabel={strings.gate.field}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        autoComplete="off"
        value={birthdate}
        onChangeText={setBirthdate}
        onSubmitEditing={submit}
        style={[styles.input, { borderColor: palette.divider, color: palette.text }]}
      />
      {error ? (
        <Text
          testID="guest-preview-gate-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{ color: palette.danger }}
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
      <Text style={[styles.small, { color: palette.mutedText }]}>
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

export function PreviewOutfit({
  result,
  strings,
  locale,
  palette,
  noAlternative,
  hasSwaps,
  onTryAnother,
  onSwap,
  onUndoSwaps,
  onBrowseWardrobe,
  onReviewChoices,
  onResetChoices,
}: {
  result: SampleOutfitResult
  strings: GuestPreviewStrings
  locale: string
  palette: PreviewPalette
  noAlternative: boolean
  hasSwaps: boolean
  onTryAnother: () => void
  onSwap: (category: SampleGarmentCategory) => void
  onUndoSwaps: () => void
  onBrowseWardrobe: () => void
  onReviewChoices: () => void
  onResetChoices: () => void
}) {
  const look = result.look
  if (!look) {
    return (
      <View
        testID="guest-preview-empty"
        style={[styles.card, { borderColor: palette.divider }]}
      >
        <Text
          accessibilityRole="header"
          style={[styles.heading, { color: palette.text }]}
        >
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
      style={[styles.card, { borderColor: palette.divider }]}
    >
      <Text style={[styles.eyebrow, { color: palette.accentText }]}>
        {strings.outfit.heading}
      </Text>
      <Text
        testID="guest-preview-look-name"
        accessibilityRole="header"
        style={[styles.heading, { color: palette.text }]}
      >
        {lookText.name}
      </Text>
      <Text style={{ color: palette.mutedText }}>{lookText.description}</Text>
      <Text
        testID="guest-preview-weather-chip"
        style={[styles.chipLabel, { color: palette.text }]}
      >
        {strings.values.weather[result.context.weather]}
      </Text>
      <View testID="guest-preview-garments" style={styles.wrap}>
        {result.garments.map((garment) => {
          const text = sampleGarmentText(garment, strings)
          const category = strings.values.category[garment.category]
          const swapLabel = formatPreviewString(strings.outfit.swap, { category })
          return (
            <View
              key={garment.id}
              testID={`guest-preview-garment-${garment.id.slice('sample:g:'.length)}`}
              style={[styles.garment, { borderColor: palette.divider }]}
            >
              <SampleGarmentArt garment={garment} label={text.description} />
              <Text style={[styles.garmentName, { color: palette.text }]}>
                {text.name}
              </Text>
              <PreviewButton
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
      <Text style={[styles.subheading, { color: palette.text }]}>
        {strings.outfit.whyThisWorks}
      </Text>
      <View testID="guest-preview-explanation" accessibilityLiveRegion="polite">
        {result.explanation.map((item, index) => (
          <Text key={`${item.key}-${index}`} style={{ color: palette.mutedText }}>
            {`• ${formatSampleExplanation(item, { strings, locale, catalog: SAMPLE_CATALOG })}`}
          </Text>
        ))}
      </View>
      {noAlternative ? (
        <Text
          testID="guest-preview-no-alternative"
          accessibilityLiveRegion="polite"
          style={{ color: palette.text }}
        >
          {strings.outfit.noAlternative}
        </Text>
      ) : null}
      <PreviewButton
        label={strings.outfit.tryAnother}
        onPress={onTryAnother}
        testID="guest-preview-try-another"
        palette={palette}
        primary
      />
      {hasSwaps ? (
        <PreviewButton
          label={strings.outfit.undoSwaps}
          onPress={onUndoSwaps}
          testID="guest-preview-undo-swaps"
          palette={palette}
        />
      ) : null}
      <PreviewButton
        label={strings.outfit.browseWardrobe}
        onPress={onBrowseWardrobe}
        testID="guest-preview-browse-wardrobe"
        palette={palette}
      />
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
  onWeather: (weather: SampleWeatherKey) => void
  onComfort: (comfort: SampleComfort, control: PreviewControl) => void
}) {
  const { values } = strings
  const weather = SAMPLE_WEATHER[state.weather]
  return (
    <View
      testID="guest-preview-controls"
      style={[styles.card, { borderColor: palette.divider }]}
    >
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
        {strings.preferences.heading}
      </Text>
      <Text style={{ color: palette.mutedText }}>{strings.chrome.supporting}</Text>
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
      <Text style={[styles.small, { color: palette.mutedText }]}>
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
      style={[styles.card, { borderColor: palette.divider }]}
    >
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
        {strings.feedback.heading}
      </Text>
      <Text style={{ color: palette.mutedText }}>{strings.feedback.body}</Text>
      <Text
        testID="guest-preview-feedback-progress"
        accessibilityLiveRegion="polite"
        style={{ color: palette.text }}
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
            style={[styles.feedbackCard, { borderColor: palette.divider }]}
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
            <Text style={[styles.subheading, { color: palette.text }]}>{text.name}</Text>
            <Text style={{ color: palette.mutedText }}>{text.description}</Text>
            <View style={styles.row}>
              {(['like', 'dislike'] as const).map((choice) => {
                const selected = vote === choice
                return (
                  <Pressable
                    key={choice}
                    testID={`guest-preview-vote-${choice}-${card.id.slice('sample:l:'.length)}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${choice === 'like' ? strings.feedback.like : strings.feedback.dislike}: ${text.name}`}
                    accessibilityState={{ selected }}
                    onPress={() => onVote(card.id, choice)}
                    style={[
                      styles.voteButton,
                      selected
                        ? { backgroundColor: palette.text, borderColor: palette.text }
                        : { borderColor: palette.divider },
                    ]}
                  >
                    <Text style={{ color: selected ? palette.background : palette.text }}>
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
  const { values } = strings
  const items = SAMPLE_CATALOG.garments.filter(
    (garment) =>
      (category === 'all' || garment.category === category) &&
      (collection === 'all' || garment.collections.includes(collection))
  )
  const openText = open ? sampleGarmentText(open, strings) : null
  return (
    <View testID="guest-preview-wardrobe" style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
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
        style={{ color: palette.mutedText }}
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
              onPress={() => {
                setOpen(garment)
                onInspect()
              }}
              style={[styles.garment, { borderColor: palette.divider }]}
            >
              <SampleGarmentArt garment={garment} />
              <Text style={[styles.garmentName, { color: palette.text }]}>
                {text.name}
              </Text>
              <Text style={[styles.small, { color: palette.mutedText }]}>
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
        testID="guest-preview-item-detail"
      >
        {open && openText ? (
          <>
            <SampleGarmentArt garment={open} label={openText.description} size={96} />
            <Text style={{ color: palette.text }}>{openText.description}</Text>
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
      <Text style={[styles.detailLabel, { color: palette.mutedText }]}>{label}</Text>
      <Text style={{ color: palette.text }}>{value}</Text>
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
  testID,
  children,
}: {
  visible: boolean
  title: string
  strings: GuestPreviewStrings
  palette: PreviewPalette
  onClose: () => void
  testID: string
  children: React.ReactNode
}) {
  return (
    <EdgeToEdgeModal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      scrim="rgba(0,0,0,0.45)"
    >
      <View style={styles.sheetSpacer} />
      <View
        testID={testID}
        accessibilityViewIsModal
        style={[styles.sheet, { backgroundColor: palette.surface }]}
      >
        <View style={styles.sheetHeader}>
          <Text
            accessibilityRole="header"
            style={[styles.heading, styles.sheetTitle, { color: palette.text }]}
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
            <Text style={{ color: palette.text, fontSize: 20 }}>{'×'}</Text>
          </Pressable>
        </View>
        <Text style={[styles.small, { color: palette.mutedText }]}>
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
        <Text testID="guest-preview-no-suitable" style={{ color: palette.text }}>
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
                accessibilityState={{ checked }}
                accessibilityLabel={
                  checked ? `${text.name} (${strings.outfit.current})` : text.name
                }
                onPress={() => onChoose(garment.id)}
                style={[
                  styles.option,
                  { borderColor: checked ? '#C9A14A' : palette.divider },
                ]}
              >
                <SampleGarmentArt garment={garment} size={40} />
                <Text style={[styles.optionText, { color: palette.text }]}>
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
      style={[styles.card, { borderColor: '#C9A14A' }]}
    >
      <Text style={{ color: palette.text }}>{strings.chrome.conversion}</Text>
      {(
        [
          [detail.canSave, detail.canSaveBody],
          [detail.previewOnly, detail.previewOnlyBody],
          [detail.stillRequired, detail.stillRequiredBody],
        ] as const
      ).map(([title, body]) => (
        <View key={title}>
          <Text style={[styles.subheading, { color: palette.text }]}>{title}</Text>
          <Text style={{ color: palette.mutedText }}>{body}</Text>
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
      <Text style={[styles.small, { color: palette.mutedText }]}>
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
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
})

const styles = StyleSheet.create({
  artTile: {
    backgroundColor: LIGHT_TILE,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    minHeight: 44,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
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
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  section: { gap: 12 },
  heading: { fontSize: 22, fontWeight: '700' },
  subheading: { fontSize: 15, fontWeight: '700' },
  eyebrow: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  small: { fontSize: 13 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  garment: {
    width: 148,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 8,
    alignItems: 'center',
  },
  garmentName: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  feedbackCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  voteButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontWeight: '600' },
  sheetSpacer: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
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
  optionText: { flex: 1, fontSize: 15 },
})

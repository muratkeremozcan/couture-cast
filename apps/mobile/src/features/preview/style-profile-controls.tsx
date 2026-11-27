import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  getStyleProfileStrings,
  SAMPLE_STYLE_OPTIONS,
  STYLE_PALETTE_SWATCHES,
  STYLE_TEMPERATURE_OPTIONS,
  STYLE_TUNE_GROUPS,
  STYLE_TUNE_STEPS,
  styleChoiceGarment,
  styleTunePatch,
  styleTuneSelected,
  toggleStyleTuneChoice,
  type StyleIllustratedChoice,
  type StyleMood,
  type StyleProfileAnswers,
} from '@couture/utils'
import { EdgeToEdgeModal, LayerSwipeHandle } from '@/components/edge-to-edge-modal'
import { useHeroPalette } from '@/components/hero/hero-theme'
import type { useMobileStyleProfile } from '@/src/lib/style-profile'
import { PreviewButton, SampleGarmentArt } from './guest-preview-parts'

type StyleState = ReturnType<typeof useMobileStyleProfile>

function useStyleCopy() {
  return getStyleProfileStrings(useTranslation().i18n.language)
}

function PictureChoice({
  id,
  label,
  choice,
  selected,
  disabled,
  onSelect,
}: {
  id: string
  label: string
  choice: StyleIllustratedChoice | keyof typeof STYLE_PALETTE_SWATCHES
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  const palette = useHeroPalette()
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      aria-pressed={selected}
      disabled={disabled}
      onPress={onSelect}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? palette.card : palette.page,
          borderColor: selected ? palette.ink : palette.line,
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      {choice === 'neutral' || choice === 'colorful' ? (
        <View style={[styles.swatch, { borderColor: palette.line }]}>
          {STYLE_PALETTE_SWATCHES[choice].map((color) => (
            <View key={color} style={{ backgroundColor: color, width: 20 }} />
          ))}
        </View>
      ) : (
        <SampleGarmentArt garment={styleChoiceGarment(choice)} size={34} />
      )}
      <Text style={[styles.choiceText, { color: palette.ink }]}>{label}</Text>
    </Pressable>
  )
}

export function StyleMoodRow({
  selected,
  onSelect,
  disabled,
  day = false,
}: {
  selected?: StyleMood | null
  onSelect: (mood: StyleMood) => void
  disabled?: boolean
  day?: boolean
}) {
  const copy = useStyleCopy()
  const { ink } = useHeroPalette()
  return (
    <View style={styles.group}>
      <Text style={[styles.heading, { color: ink }]}>{copy.mood}</Text>
      <View style={styles.row}>
        {SAMPLE_STYLE_OPTIONS.style.map((mood) => (
          <PictureChoice
            key={mood}
            id={`style-${day ? 'day-' : ''}mood-${mood}`}
            label={copy[mood]}
            choice={mood}
            selected={selected === mood}
            disabled={disabled}
            onSelect={() => onSelect(mood)}
          />
        ))}
      </View>
    </View>
  )
}

export function StyleDayControls({
  style,
  showTune = false,
}: {
  style: StyleState
  showTune?: boolean
}) {
  const copy = useStyleCopy()
  const palette = useHeroPalette()
  const [open, setOpen] = useState(false)
  const { scope, day, store } = style
  if (!scope) return null
  return (
    <View style={styles.stack}>
      <PreviewButton
        label={copy.day}
        testID="style-day-open"
        onPress={() => setOpen(!open)}
        palette={palette}
        expanded={open}
      />
      {open && (
        <View style={styles.stack}>
          <View style={styles.group}>
            <Text style={[styles.heading, { color: palette.ink }]}>
              {copy.temperature}
            </Text>
            <View style={styles.actions}>
              {STYLE_TEMPERATURE_OPTIONS.map((temperature) => (
                <PreviewButton
                  key={temperature}
                  label={copy[temperature]}
                  testID={`style-day-temperature-${temperature}`}
                  palette={palette}
                  selected={day?.temperature === temperature}
                  primary={day?.temperature === temperature}
                  onPress={() =>
                    store.updateDay(scope, {
                      temperature: day?.temperature === temperature ? null : temperature,
                    })
                  }
                />
              ))}
            </View>
          </View>
          <StyleMoodRow
            day
            selected={day?.mood}
            onSelect={(mood) =>
              store.updateDay(scope, { mood: day?.mood === mood ? null : mood })
            }
          />
          <PreviewButton
            label={copy.reset}
            testID="style-day-reset"
            palette={palette}
            disabled={!day}
            onPress={() => store.updateDay(scope, null)}
          />
          {showTune && <StyleMemberControls style={style} showMood={false} />}
        </View>
      )}
    </View>
  )
}

function TuneWizard({
  profile,
  saving,
  save,
  onClose,
}: {
  profile: StyleProfileAnswers
  saving: boolean
  save: (patch: Partial<StyleProfileAnswers>) => Promise<boolean>
  onClose: () => void
}) {
  const copy = useStyleCopy()
  const palette = useHeroPalette()
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState(profile)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [failed, setFailed] = useState(false)
  const fields = STYLE_TUNE_STEPS[step]!
  const last = step === STYLE_TUNE_STEPS.length - 1
  const advance = () => {
    setFailed(false)
    if (last) onClose()
    else setStep(step + 1)
  }
  return (
    <View style={styles.stack}>
      {fields.map((field) => (
        <View key={field} style={styles.group}>
          <Text
            accessibilityRole="header"
            style={[styles.heading, { color: palette.ink }]}
          >
            {copy[field]}
          </Text>
          <View style={styles.row}>
            {STYLE_TUNE_GROUPS[field].map((choice) => (
              <PictureChoice
                key={choice}
                id={`style-${field}-${choice}`}
                label={copy[choice]}
                choice={choice}
                selected={styleTuneSelected(draft, field, choice)}
                disabled={saving}
                onSelect={() =>
                  setDraft((current) => toggleStyleTuneChoice(current, field, choice))
                }
              />
            ))}
          </View>
        </View>
      ))}
      {failed && (
        <Text accessibilityRole="alert" style={{ color: palette.ink }}>
          {copy.saveFailed}
        </Text>
      )}
      <View style={styles.actions}>
        <PreviewButton
          label={copy.skip}
          testID="style-tune-skip"
          palette={palette}
          disabled={saving}
          onPress={advance}
        />
        <PreviewButton
          label={saving ? copy.saving : last ? copy.finish : copy.next}
          testID="style-tune-next"
          palette={palette}
          disabled={saving}
          onPress={() => {
            void save(styleTunePatch(draft, step)).then((saved) => {
              if (!mounted.current) return
              if (saved) advance()
              else setFailed(true)
            })
          }}
          primary
        />
      </View>
    </View>
  )
}

export function StyleMemberControls({
  style,
  showClear = false,
  showMood = true,
}: {
  style: StyleState
  showClear?: boolean
  showMood?: boolean
}) {
  const { t } = useTranslation()
  const copy = useStyleCopy()
  const palette = useHeroPalette()
  const { scope, profile, status, saving, store } = style
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const opener = useRef<ComponentRef<typeof Pressable>>(null)
  if (!scope) return null
  const close = () => setOpen(false)
  const mutate = async (work: Promise<boolean>) => {
    setFailed(false)
    setFailed(!(await work))
  }
  return (
    <View style={styles.stack}>
      {showMood && (
        <StyleMoodRow
          selected={profile?.mood}
          disabled={!profile || saving}
          onSelect={(mood) =>
            void mutate(store.save(scope, { mood: profile?.mood === mood ? null : mood }))
          }
        />
      )}
      <View style={styles.actions}>
        <PreviewButton
          label={copy.tune}
          testID="style-tune-open"
          buttonRef={opener}
          palette={palette}
          onPress={() => {
            setFailed(false)
            setOpen(true)
            if (status === 'failed') void store.load(scope)
          }}
        />
        {showClear && (
          <PreviewButton
            label={copy.clear}
            testID="style-profile-clear"
            palette={palette}
            disabled={!profile || saving}
            onPress={() => void mutate(store.clear(scope))}
          />
        )}
      </View>
      {!open && status === 'failed' && !profile && (
        <View style={styles.actions}>
          <Text accessibilityRole="alert" style={{ color: palette.ink }}>
            {copy.loadFailed}
          </Text>
          <PreviewButton
            label={copy.retry}
            testID="style-profile-retry"
            palette={palette}
            onPress={() => void store.load(scope)}
          />
        </View>
      )}
      {failed && (
        <Text accessibilityRole="alert" style={{ color: palette.ink }}>
          {copy.saveFailed}
        </Text>
      )}
      <EdgeToEdgeModal
        visible={open}
        onRequestClose={close}
        returnFocusRef={opener}
        transparent={false}
      >
        <View
          accessibilityViewIsModal
          style={[styles.modal, { backgroundColor: palette.page }]}
        >
          <LayerSwipeHandle style={styles.modalHeader}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: palette.ink }]}
            >
              {copy.tune}
            </Text>
            <PreviewButton
              label={t('shell.close')}
              testID="style-tune-close"
              palette={palette}
              onPress={close}
            />
          </LayerSwipeHandle>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {open &&
              (profile ? (
                <TuneWizard
                  profile={profile}
                  onClose={close}
                  save={(patch) => store.save(scope, patch)}
                  saving={saving}
                />
              ) : status === 'failed' ? (
                <View style={styles.group}>
                  <Text accessibilityRole="alert" style={{ color: palette.ink }}>
                    {copy.loadFailed}
                  </Text>
                  <PreviewButton
                    label={copy.retry}
                    testID="style-tune-retry"
                    palette={palette}
                    onPress={() => void store.load(scope)}
                  />
                </View>
              ) : (
                <Text accessibilityLiveRegion="polite" style={{ color: palette.ink }}>
                  {copy.loading}
                </Text>
              ))}
          </ScrollView>
        </View>
      </EdgeToEdgeModal>
    </View>
  )
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  group: { gap: 8 },
  heading: { fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 2,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  swatch: {
    flexDirection: 'row',
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    marginVertical: 8,
  },
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: 16,
  },
  title: { flex: 1, fontSize: 20, fontWeight: '600' },
  modalBody: { padding: 16 },
})

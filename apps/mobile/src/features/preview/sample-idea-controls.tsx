import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  SAMPLE_STYLE_OPTIONS,
  SAMPLE_WEATHER_KEYS,
  formatPreviewString,
  sampleLookText,
  type GuestPreviewStrings,
  type SampleBookmark,
  type SampleStylePreferences,
  type SampleWeatherKey,
} from '@couture/utils'
import { PreviewButton, type PreviewPalette } from './guest-preview-parts'
import { SaveActionButton } from '@/components/save-feedback'

type SampleBookmarkItem = SampleBookmark & {
  savedLookId?: string
  needsReview?: boolean
}

export function SampleIdeaControls({
  strings,
  palette,
  preferences,
  onPreferences,
  bookmarks,
  needsReviewLabel,
  lookId,
  onSave,
  onUndoSave,
  onViewSaved,
  onOpen,
  onRemove,
  weather,
  onWeather,
  persistent = true,
  showStorageFailureWhenEmpty = false,
  ownerKey,
  saveResetKey,
  useSharedFeedback = false,
  requiresNetwork = false,
}: {
  strings: GuestPreviewStrings
  palette: PreviewPalette
  preferences?: SampleStylePreferences
  onPreferences: (preferences: SampleStylePreferences) => void
  bookmarks: SampleBookmarkItem[]
  needsReviewLabel?: string
  lookId?: string
  onSave: () => unknown
  onUndoSave?: () => unknown
  onViewSaved?: () => void
  onOpen: (bookmark: SampleBookmarkItem) => void
  onRemove: (id: string) => void
  weather?: SampleWeatherKey
  onWeather?: (weather: SampleWeatherKey) => void
  persistent?: boolean
  showStorageFailureWhenEmpty?: boolean
  ownerKey?: string | null
  saveResetKey?: string
  useSharedFeedback?: boolean
  requiresNetwork?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const labels = strings.styleIdeas
  const dimensions = Object.keys(SAMPLE_STYLE_OPTIONS) as (keyof SampleStylePreferences)[]
  const isBookmarked = Boolean(
    lookId && bookmarks.some((bookmark) => bookmark.lookId === lookId)
  )
  return (
    <View style={[styles.card, { borderColor: palette.divider }]}>
      {lookId &&
        (useSharedFeedback ? (
          <SaveActionButton
            testID="sample-save-look"
            idleLabel={isBookmarked ? labels.update : labels.save}
            onSave={onSave}
            onUndo={onUndoSave}
            onView={onViewSaved}
            ownerKey={ownerKey}
            resetKey={saveResetKey ?? lookId}
            requiresNetwork={requiresNetwork}
          />
        ) : (
          <PreviewButton
            testID="sample-save-look"
            label={isBookmarked ? labels.update : labels.save}
            onPress={() => {
              void onSave()
            }}
            palette={palette}
          />
        ))}
      {onWeather && (
        <View style={styles.group}>
          <Text style={{ color: palette.text }}>{strings.preferences.weather}</Text>
          <View style={styles.row}>
            {SAMPLE_WEATHER_KEYS.map((value) => (
              <PreviewButton
                key={value}
                testID={`sample-weather-${value}`}
                label={strings.values.weather[value]}
                onPress={() => onWeather(value)}
                palette={palette}
                primary={weather === value}
                selected={weather === value}
              />
            ))}
          </View>
        </View>
      )}
      {(bookmarks.length > 0 || (!persistent && showStorageFailureWhenEmpty)) && (
        <View
          testID={bookmarks.length > 0 ? 'sample-saved-looks' : undefined}
          style={styles.group}
        >
          <Text
            accessibilityRole={bookmarks.length > 0 ? 'header' : undefined}
            accessibilityLiveRegion="none"
            style={{ color: palette.text }}
          >
            {persistent ? labels.saved : strings.chrome.storageUnavailable}
          </Text>
          {bookmarks.map((bookmark) => {
            const look = sampleLookText({ id: bookmark.lookId }, strings).name
            const entryId = bookmark.savedLookId ?? bookmark.lookId
            return (
              <View key={entryId} style={styles.row}>
                <PreviewButton
                  testID={`sample-open-${bookmark.lookId}`}
                  label={look}
                  onPress={() => onOpen(bookmark)}
                  palette={palette}
                />
                {bookmark.needsReview && needsReviewLabel ? (
                  <Text testID="saved-look-needs-review" style={{ color: palette.text }}>
                    {needsReviewLabel}
                  </Text>
                ) : null}
                <PreviewButton
                  testID={`sample-remove-${bookmark.lookId}`}
                  label={formatPreviewString(labels.remove, { look })}
                  onPress={() => onRemove(entryId)}
                  palette={palette}
                />
              </View>
            )
          })}
        </View>
      )}
      <PreviewButton
        testID="sample-style-preferences"
        label={labels.heading}
        expanded={expanded}
        onPress={() => setExpanded((open) => !open)}
        palette={palette}
      />
      {expanded &&
        dimensions.map((dimension) => (
          <View key={dimension} style={styles.group}>
            <Text style={{ color: palette.text }}>{labels[dimension]}</Text>
            <View style={styles.row}>
              {[undefined, ...SAMPLE_STYLE_OPTIONS[dimension]].map((option) => (
                <PreviewButton
                  key={option ?? 'any'}
                  testID={`sample-${dimension}-${option ?? 'any'}`}
                  label={labels[option ?? 'any']}
                  onPress={() => onPreferences({ ...preferences, [dimension]: option })}
                  palette={palette}
                  primary={preferences?.[dimension] === option}
                  selected={preferences?.[dimension] === option}
                />
              ))}
            </View>
          </View>
        ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1, padding: 16, gap: 10 },
  group: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})

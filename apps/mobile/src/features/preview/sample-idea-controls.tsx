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

export function SampleIdeaControls({
  strings,
  palette,
  preferences,
  onPreferences,
  bookmarks,
  lookId,
  onSave,
  onOpen,
  onRemove,
  weather,
  onWeather,
  persistent = true,
  showStorageFailureWhenEmpty = false,
}: {
  strings: GuestPreviewStrings
  palette: PreviewPalette
  preferences?: SampleStylePreferences
  onPreferences: (preferences: SampleStylePreferences) => void
  bookmarks: SampleBookmark[]
  lookId?: string
  onSave: () => void
  onOpen: (bookmark: SampleBookmark) => void
  onRemove: (lookId: string) => void
  weather?: SampleWeatherKey
  onWeather?: (weather: SampleWeatherKey) => void
  persistent?: boolean
  showStorageFailureWhenEmpty?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const labels = strings.styleIdeas
  const dimensions = Object.keys(SAMPLE_STYLE_OPTIONS) as (keyof SampleStylePreferences)[]
  return (
    <View style={[styles.card, { borderColor: palette.divider }]}>
      {lookId && (
        <PreviewButton
          testID="sample-save-look"
          label={
            bookmarks.some((bookmark) => bookmark.lookId === lookId)
              ? labels.update
              : labels.save
          }
          onPress={onSave}
          palette={palette}
        />
      )}
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
            accessibilityLiveRegion="polite"
            style={{ color: palette.text }}
          >
            {persistent ? labels.saved : strings.chrome.storageUnavailable}
          </Text>
          {bookmarks.map((bookmark) => {
            const look = sampleLookText({ id: bookmark.lookId }, strings).name
            return (
              <View key={bookmark.lookId} style={styles.row}>
                <PreviewButton
                  testID={`sample-open-${bookmark.lookId}`}
                  label={look}
                  onPress={() => onOpen(bookmark)}
                  palette={palette}
                />
                <PreviewButton
                  testID={`sample-remove-${bookmark.lookId}`}
                  label={formatPreviewString(labels.remove, { look })}
                  onPress={() => onRemove(bookmark.lookId)}
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

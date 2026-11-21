import { StyleSheet, Text, View } from 'react-native'
import type { ClimateBand } from '@couture/api-client/contracts/http'
import {
  communitySampleOutfits,
  getGuestPreviewStrings,
  sampleLookText,
} from '@couture/utils'
import { SampleGarmentArt, type PreviewPalette } from '../preview/guest-preview-parts'

export function CommunityExampleInspiration({
  band,
  locale,
  palette,
}: {
  band: ClimateBand | null
  locale: string
  palette: PreviewPalette
}) {
  const strings = getGuestPreviewStrings(locale)
  return (
    <View
      testID="community-example-inspiration"
      style={[
        styles.group,
        { borderColor: palette.divider, backgroundColor: palette.surface },
      ]}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
        {strings.styleIdeas.inspiration}
      </Text>
      <Text style={{ color: palette.mutedText }}>{strings.styleIdeas.illustrations}</Text>
      {communitySampleOutfits(band).map((result) => {
        if (!result.look) return null
        const look = sampleLookText(result.look, strings)
        return (
          <View
            key={result.look.id}
            style={[styles.card, { borderColor: palette.divider }]}
          >
            <Text
              accessibilityRole="header"
              style={[styles.look, { color: palette.text }]}
            >
              {look.name}
            </Text>
            <View style={styles.art}>
              {result.garments.map((garment) => (
                <SampleGarmentArt key={garment.id} garment={garment} size={42} />
              ))}
            </View>
            <Text style={{ color: palette.text }}>{look.description}</Text>
            <Text style={{ color: palette.mutedText }}>
              {strings.preferences.weather} ·{' '}
              {strings.values.weather[result.context.weather]}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  group: {
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderRadius: 12,
    gap: 8,
  },
  title: { fontSize: 18, fontWeight: '700' },
  card: { padding: 12, borderWidth: 1, borderRadius: 8, gap: 6 },
  look: { fontWeight: '600' },
  art: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
})

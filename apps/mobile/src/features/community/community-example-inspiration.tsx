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
      style={[styles.group, { borderColor: palette.line, backgroundColor: palette.card }]}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: palette.ink }]}>
        {strings.styleIdeas.inspiration}
      </Text>
      <Text style={{ color: palette.inkMuted }}>{strings.styleIdeas.illustrations}</Text>
      {communitySampleOutfits(band).map((result) => {
        if (!result.look) return null
        const look = sampleLookText(result.look, strings)
        return (
          <View
            key={result.look.id}
            style={[styles.section, { borderTopColor: palette.line }]}
          >
            <Text
              accessibilityRole="header"
              style={[styles.look, { color: palette.ink }]}
            >
              {look.name}
            </Text>
            <View style={styles.art}>
              {result.garments.map((garment) => (
                <SampleGarmentArt key={garment.id} garment={garment} size={42} />
              ))}
            </View>
            <Text style={{ color: palette.ink }}>{look.description}</Text>
            <Text style={{ color: palette.inkMuted }}>
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
  // Story CC-7.9 D7: one card level, so each look is a plain section inside the group card.
  section: { paddingTop: 12, borderTopWidth: 1, gap: 8 },
  look: { fontWeight: '600' },
  art: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
})

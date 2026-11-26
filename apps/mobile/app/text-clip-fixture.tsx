// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i: the text layout probe's native fixture. Two copies of one two-line label: the
// healthy one in an auto-height container, the mutant in a container one line tall at the base
// scale with hidden overflow, which cuts the second line while the label's accessibility text and
// its hierarchy rect stay intact. Only the layout probe sees the cut, so the device proof
// (maestro/live-font/text-clip-fixture.yaml) shows the mutant red and the healthy copy green.
//
// It renders only in builds bundled with EXPO_PUBLIC_TEXT_LAYOUT_PROBE=1, which Metro inlines;
// every other build renders nothing here.
import { Stack } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { useTokens } from '@/src/theme/tokens'

const TEXT_CLIP_LABEL = 'Show watermark on the card\nCard preview below'
const LINE_HEIGHT = 22

export default function TextClipFixtureRoute() {
  if (process.env.EXPO_PUBLIC_TEXT_LAYOUT_PROBE !== '1') return null
  return <TextClipFixture />
}

/** The fixture on the page surface of the OS scheme (Story CC-7.9 D7). */
function TextClipFixture() {
  const { colors } = useTokens()
  const label = [styles.label, { color: colors.ink }]
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.screen, { backgroundColor: colors.page }]}>
        <View collapsable={false} style={styles.healthy}>
          <Text testID="text-clip-healthy" style={label}>
            {TEXT_CLIP_LABEL}
          </Text>
        </View>
        <View collapsable={false} style={styles.mutant}>
          <Text testID="text-clip-mutant" style={label}>
            {TEXT_CLIP_LABEL}
          </Text>
        </View>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 64, paddingHorizontal: 24 },
  label: { fontSize: 16, lineHeight: LINE_HEIGHT },
  healthy: { marginBottom: 48 },
  // One line at the base scale: the second line is cut at every scale.
  mutant: { height: LINE_HEIGHT, overflow: 'hidden' },
})

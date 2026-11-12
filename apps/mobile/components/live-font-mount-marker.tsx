// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// The Story 6.15 live font-scale proof must test a text tree that survived the scale change. A
// recreated Activity or a remounted screen measures its text afresh at the new scale and keeps
// the process id, so it would read as a fix. Each marked component renders an invisible view
// whose testID changes on every mount, and the proof requires the same ids before and after the
// change. A testID costs nothing at runtime and reaches the Android and iOS hierarchies the
// proof already reads; a native view tag would need a module to read it. Production builds
// render nothing.
import Constants from 'expo-constants'
import { useRef } from 'react'
import { StyleSheet, View } from 'react-native'

// One value per JavaScript runtime, so a reloaded bundle that restarts the counter still reads
// as new.
const runtime = Math.random().toString(36).slice(2, 8)
let mounts = 0

export function liveFontMountMarkersEnabled({ dev = __DEV__ }: { dev?: boolean } = {}) {
  return dev || Constants.expoConfig?.extra?.liveFontMountMarkers === true
}

export function LiveFontMountMarker({ scope }: { scope: string }) {
  const id = useRef<string | null>(null)
  if (id.current === null) {
    mounts += 1
    id.current = `${runtime}${mounts.toString(36)}`
  }
  if (!liveFontMountMarkersEnabled()) return null
  return (
    <View
      testID={`live-font-mount-${scope}-${id.current}`}
      style={styles.marker}
      collapsable={false}
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  )
}

const styles = StyleSheet.create({
  marker: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    pointerEvents: 'none',
  },
})

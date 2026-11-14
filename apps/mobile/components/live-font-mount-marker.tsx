// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// The Story 6.15 live font-scale proof must test a text tree that survived the scale change. A
// recreated Activity or a remounted screen measures its text afresh at the new scale and keeps
// the process id, so it would read as a fix. Each marked component renders an invisible view
// whose testID changes on every mount, and the proof requires the same ids before and after the
// change. A testID costs nothing at runtime and reaches the Android and iOS hierarchies the
// proof already reads; a native view tag would need a module to read it. A second view reports
// the font scale JavaScript sees, so a scale change the app never received cannot pass as a
// relayout. A third reports the installed React Native version and the configuration the app
// applied (theme, layout direction, density, language), so the proof reads the version from
// the build under test and can check a theme, locale or density change took effect (Codex R4).
// Production builds render nothing.
import Constants from 'expo-constants'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  I18nManager,
  Platform,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native'

// One value per JavaScript runtime, so a reloaded bundle that restarts the counter still reads
// as new.
const runtime = Math.random().toString(36).slice(2, 8)
let mounts = 0

export function liveFontMountMarkersEnabled({ dev = __DEV__ }: { dev?: boolean } = {}) {
  return dev || Constants.expoConfig?.extra?.liveFontMountMarkers === true
}

type NativeConstants = {
  reactNativeVersion?: {
    major: number
    minor: number
    patch: number
    prerelease?: string | number | null
  }
}

function reactNativeVersion() {
  // React Native Web has no native constants; the proof runs on native builds only.
  const version = (Platform as { constants?: NativeConstants }).constants
    ?.reactNativeVersion
  if (!version) return 'web'
  const { major, minor, patch, prerelease } = version
  return `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ''}`
}

/**
 * Keeps the marker away from assistive technology. On iOS, `aria-hidden` and
 * `accessibilityElementsHidden` also remove the view from the XCUITest hierarchy Maestro reads,
 * so on iOS the marker is a plain view that is not an accessibility element.
 */
export function markerAccessibilityProps(os: string) {
  if (os === 'ios') return { accessible: false } as const
  return {
    'aria-hidden': true,
    importantForAccessibility: 'no-hide-descendants',
    accessibilityElementsHidden: true,
  } as const
}

export function LiveFontMountMarker({ scope }: { scope: string }) {
  const { fontScale, scale } = useWindowDimensions()
  const scheme = useColorScheme() ?? 'light'
  // A test double of useTranslation may return only `t`; the marker still renders.
  const { i18n } = useTranslation()
  const id = useRef<string | null>(null)
  if (id.current === null) {
    mounts += 1
    id.current = `${runtime}${mounts.toString(36)}`
  }
  if (!liveFontMountMarkersEnabled()) return null
  const hidden = {
    style: styles.marker,
    collapsable: false,
    ...markerAccessibilityProps(Platform.OS),
  } as const
  return (
    <>
      <View testID={`live-font-mount-${scope}-${id.current}`} {...hidden} />
      <View testID={`live-font-scale-${scope}-${fontScale}`} {...hidden} />
      <View
        testID={`live-font-env-${scope}~${reactNativeVersion()}~${scheme}~${I18nManager.isRTL ? 'rtl' : 'ltr'}~${scale}~${i18n?.language ?? 'unknown'}`}
        {...hidden}
      />
    </>
  )
}

const styles = StyleSheet.create({
  // Mid-height at the left edge: UiAutomator leaves out views the translucent status bar or the
  // navigation bar covers, so a marker at the top of the window never reaches the hierarchy.
  marker: {
    position: 'absolute',
    top: '50%',
    left: 0,
    width: 1,
    height: 1,
    pointerEvents: 'none',
  },
})

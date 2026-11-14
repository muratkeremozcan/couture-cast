// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i: at Android 2.0 the bottom tab label "Community" was wider than its tab and
// ellipsized ("Commun..."), and every label grew below the bar's fixed height into the active
// tab's underline. This label draws exactly what React Navigation's own label draws (one line,
// centred, 10 pt, the theme's medium face), and adds two things: a label wider than its tab
// shrinks to fit instead of being cut, and each label reports its height so the bar can grow by
// what the text grew (tabBarGrowth). On iOS the label keeps React Navigation's behaviour: it does
// not scale, and the tab's Large Content Viewer shows the label at the user's size instead.
import React from 'react'
import {
  type LayoutChangeEvent,
  PixelRatio,
  Platform,
  StyleSheet,
  Text,
} from 'react-native'

const WEB_FONT_STACK =
  'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"'

/** React Navigation's `fonts.medium` for each platform, which its tab label uses. */
const MEDIUM = Platform.select({
  web: { fontFamily: WEB_FONT_STACK, fontWeight: '500' as const },
  ios: { fontFamily: 'System', fontWeight: '500' as const },
  default: { fontFamily: 'sans-serif-medium', fontWeight: 'normal' as const },
})

/** The smallest share of its size a label shrinks to before it would be cut. */
export const TAB_LABEL_MIN_SCALE = 0.5

/**
 * How much taller the bar must be than at the default text size, from the labels' heights now.
 * A label's height grows with the text scale, so at scale `s` its default height is about `h / s`;
 * the bar grows by the most any label grew. Zero at or below the default size.
 */
export function tabBarGrowth(labelHeights: readonly number[], fontScale: number): number {
  if (!(Number.isFinite(fontScale) && fontScale > 1)) return 0
  const grown = labelHeights
    .filter((height) => Number.isFinite(height) && height > 0)
    .map((height) => height - height / fontScale)
  return grown.length === 0 ? 0 : PixelRatio.roundToNearestPixel(Math.max(...grown))
}

type TabBarLabelProps = {
  color: string
  children: string
  onHeight: (label: string, height: number) => void
}

export function TabBarLabel({ color, children, onHeight }: TabBarLabelProps) {
  const onLayout = (event: LayoutChangeEvent) =>
    onHeight(children, event.nativeEvent.layout.height)
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={TAB_LABEL_MIN_SCALE}
      allowFontScaling={Platform.OS === 'ios' ? false : undefined}
      onLayout={onLayout}
      style={[styles.label, MEDIUM, { color }]}
    >
      {children}
    </Text>
  )
}

const styles = StyleSheet.create({
  label: {
    textAlign: 'center',
    backgroundColor: 'transparent',
    fontSize: 10,
  },
})

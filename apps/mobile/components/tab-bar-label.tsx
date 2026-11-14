// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i: at Android 2.0 the bottom tab label "Community" was wider than its tab and
// ellipsized ("Commun..."), and every label grew below the bar's fixed height into the active
// tab's underline. This label draws exactly what React Navigation's own label draws (centred,
// 10 pt below the icon or 13 pt beside it, the theme's medium face), and adds two things: a label
// wider than its tab shrinks to fit (nextTabLabelFit) instead of being cut, and each label reports
// its height so the bar can grow by what the text grew (tabBarGrowth). On iOS the label keeps React Navigation's behaviour: it does
// not scale, and the tab's Large Content Viewer shows the label at the user's size instead.
import React, { useRef, useState } from 'react'
import {
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  PixelRatio,
  Platform,
  StyleSheet,
  Text,
  type TextLayoutEventData,
  useWindowDimensions,
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

/** The labels' reported heights at one text scale. */
export type TabLabelHeights = {
  fontScale: number
  heights: Readonly<Record<string, number>>
}

/**
 * Records one label's height. Heights reported at another text scale are dropped: a label box
 * is held at the tallest label's height (see TabBarLabel), so after a scale change only fresh
 * reports say how tall the labels now are.
 */
export function recordTabLabelHeight(
  current: TabLabelHeights,
  fontScale: number,
  label: string,
  height: number
): TabLabelHeights {
  const heights = current.fontScale === fontScale ? current.heights : {}
  if (current.fontScale === fontScale && heights[label] === height) return current
  return { fontScale, heights: { ...heights, [label]: height } }
}

/** The tallest label's height at this text scale, or undefined before any label reported one. */
export function tallestTabLabel(
  current: TabLabelHeights,
  fontScale: number
): number | undefined {
  if (current.fontScale !== fontScale) return undefined
  const heights = Object.values(current.heights).filter((height) => height > 0)
  return heights.length === 0 ? undefined : Math.max(...heights)
}

/**
 * The next font-size factor for a label, from its laid-out lines. One line fits: keep the factor.
 * A label that wrapped is too wide for its tab: shrink by how much it overflowed, with a little
 * slack so the next layout lands on one line, never below TAB_LABEL_MIN_SCALE. At the floor the
 * label stays wrapped on two lines rather than being cut.
 *
 * React Native's adjustsFontSizeToFit did this before, but Fabric Android drops minimumFontScale
 * (it never reaches the Java text layout), so it could shrink a label toward 4 dp.
 */
export function nextTabLabelFit(fit: number, lineWidths: readonly number[]): number {
  if (lineWidths.length <= 1 || fit <= TAB_LABEL_MIN_SCALE) return fit
  const natural = lineWidths.reduce((sum, width) => sum + width, 0)
  const available = Math.max(...lineWidths)
  if (!(natural > 0 && available > 0)) return fit
  return Math.max(TAB_LABEL_MIN_SCALE, fit * Math.min(available / natural, 1) * 0.98)
}

type TabBarLabelProps = {
  color: string
  children: string
  onHeight: (label: string, height: number) => void
  /** React Navigation's label position: below the icon on phones, beside it on tablets. */
  position?: 'below-icon' | 'beside-icon'
  /**
   * The tallest label's height. A label shrunk to fit its tab is shorter than the others, and
   * the tab places it at the top, so its baseline sat 5 px above theirs at Android 2.0; held at
   * the tallest height and drawn at the box bottom, it lines up with them.
   */
  lineBoxHeight?: number
}

export function TabBarLabel({
  color,
  children,
  onHeight,
  position = 'below-icon',
  lineBoxHeight,
}: TabBarLabelProps) {
  const { fontScale } = useWindowDimensions()
  const key = `${children}|${fontScale}|${position}`
  const [fitState, setFitState] = useState({ key, fit: 1 })
  const fit = fitState.key === key ? fitState.fit : 1
  // A label reports its height only once it has settled on its size; a wrapped first layout
  // would otherwise grow the bar for a moment. Web has no text layout events and no text scale.
  const settled = useRef(Platform.OS === 'web')
  const layoutHeight = useRef<number | null>(null)
  const report = () => {
    if (settled.current && layoutHeight.current !== null)
      onHeight(children, layoutHeight.current)
  }
  const onLayout = (event: LayoutChangeEvent) => {
    layoutHeight.current = event.nativeEvent.layout.height
    report()
  }
  const onTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const next = nextTabLabelFit(
      fit,
      event.nativeEvent.lines.map((line) => line.width)
    )
    settled.current = next === fit
    if (settled.current) report()
    else setFitState({ key, fit: next })
  }
  const base = position === 'beside-icon' ? styles.beside : styles.below
  return (
    <Text
      allowFontScaling={Platform.OS === 'ios' ? false : undefined}
      onLayout={onLayout}
      onTextLayout={onTextLayout}
      style={[
        styles.label,
        base,
        MEDIUM,
        { color },
        fit < 1 ? { fontSize: base.fontSize * fit } : null,
        lineBoxHeight === undefined ? null : { minHeight: lineBoxHeight },
      ]}
    >
      {children}
    </Text>
  )
}

// React Navigation's label styles: labelBeneath, and labelBeside with labelBesideUikit (the bar
// is never compact here: that is iPhone landscape, and the app is portrait only).
const styles = StyleSheet.create({
  label: {
    textAlign: 'center',
    backgroundColor: 'transparent',
    textAlignVertical: 'bottom',
  },
  below: { fontSize: 10 },
  beside: { fontSize: 13, marginStart: 5, marginEnd: 12, lineHeight: 24 },
})

// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i: at Android 2.0 the bottom tab label "Community" was wider than its tab and
// ellipsized ("Commun..."), and every label grew below the bar's fixed height into the active
// tab's underline. This label draws what React Navigation's own label draws (centred, the
// theme's medium face) at the D4 type scale (Story CC-7.9: 12 pt below the icon, 14 pt beside
// it), and adds two things: a label wider than its tab shrinks to fit (nextTabLabelFit) instead of being cut, and each label reports
// its height so the bar can grow by what the text grew (tabBarGrowth). On iOS the label keeps React Navigation's behaviour: it does
// not scale, and the tab's Large Content Viewer shows the label at the user's size instead.
//
// Story CC-7.11 D3 (P6, P7): a label never renders below 12 px. It may shrink only down to the
// share of its size that still renders 12 px at the member's text scale, and a label that still
// does not fit wraps to at most two lines. The active label is semibold, the others medium, so
// the active tab never relies on color alone.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
import React, { useCallback, useRef, useState } from 'react'
import {
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  PixelRatio,
  Platform,
  StyleSheet,
  Text,
  type TextLayoutEventData,
  useWindowDimensions,
  View,
} from 'react-native'

const WEB_FONT_STACK =
  'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"'

/** React Navigation's `fonts.medium` for each platform, which its tab label uses. */
const MEDIUM = Platform.select({
  web: { fontFamily: WEB_FONT_STACK, fontWeight: '500' as const },
  ios: { fontFamily: 'System', fontWeight: '500' as const },
  default: { fontFamily: 'sans-serif-medium', fontWeight: 'normal' as const },
})

/**
 * D3 (P6): the active label's face, a weight of 600. Android's medium family has no heavier
 * weight, so the active label takes the regular family at 600.
 */
const SEMIBOLD = Platform.select({
  web: { fontFamily: WEB_FONT_STACK, fontWeight: '600' as const },
  ios: { fontFamily: 'System', fontWeight: '600' as const },
  default: { fontFamily: 'sans-serif', fontWeight: '600' as const },
})

/**
 * The smallest share of its size a label shrinks to before it would be cut, for callers that pass
 * no floor of their own. TabBarLabel passes tabLabelFitFloor, which never goes below 12 px.
 */
export const TAB_LABEL_MIN_SCALE = 0.5

/** D3: no tab label renders below this many px, at any text size. */
export const TAB_LABEL_MIN_PX = 12

/** D3: a label that does not fit at its floor wraps to this many lines and never more. */
export const TAB_LABEL_MAX_LINES = 2

/**
 * The smallest fit factor that still renders TAB_LABEL_MIN_PX. A label at `fontSize` drawn at
 * text scale `fontScale` renders `fontSize * fit * fontScale` px, so the floor is
 * `TAB_LABEL_MIN_PX / (fontSize * fontScale)`, never above 1 (a label never grows to fit). At the
 * default scale a 12 px label below the icon therefore never shrinks. iOS labels do not scale,
 * so the caller passes scale 1 there.
 */
export function tabLabelFitFloor(fontSize: number, fontScale: number): number {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1
  return Math.min(1, TAB_LABEL_MIN_PX / (fontSize * scale))
}

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
 * Records one label's height. Heights reported at another text scale are dropped, since after a
 * scale change only fresh reports say how tall the labels now are.
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
 * slack so the next layout lands on one line, never below `floor` (TAB_LABEL_MIN_SCALE when
 * omitted). At the floor the label stays wrapped on two lines rather than being cut.
 *
 * React Native's adjustsFontSizeToFit did this before, but Fabric Android drops minimumFontScale
 * (it never reaches the Java text layout), so it could shrink a label toward 4 dp.
 */
export function nextTabLabelFit(
  fit: number,
  lineWidths: readonly number[],
  floor: number = TAB_LABEL_MIN_SCALE
): number {
  if (lineWidths.length <= 1 || fit <= floor) return fit
  const natural = lineWidths.reduce((sum, width) => sum + width, 0)
  const available = Math.max(...lineWidths)
  if (!(natural > 0 && available > 0)) return fit
  return Math.max(floor, fit * Math.min(available / natural, 1) * 0.98)
}

/** A tab label's position, as React Navigation passes it to tabBarLabel. */
export type TabLabelPosition = 'below-icon' | 'beside-icon'

/**
 * The tab bar's text-scale sizing, for the tabs layout: how much the bar grows, how far the
 * below-icon underline drops with it, the tallest label for the line boxes, and the callback each
 * label reports its height and position through. iOS labels do not scale (Large Content Viewer),
 * so the bar keeps its height there.
 */
export function useTabBarSizing() {
  const { fontScale } = useWindowDimensions()
  const [labelHeights, setLabelHeights] = useState<TabLabelHeights>({
    fontScale,
    heights: {},
  })
  const [position, setPosition] = useState<TabLabelPosition>('below-icon')
  const onLabelHeight = useCallback(
    (label: string, height: number, labelPosition: TabLabelPosition) => {
      setPosition(labelPosition)
      setLabelHeights((current) =>
        recordTabLabelHeight(current, fontScale, label, height)
      )
    },
    [fontScale]
  )
  const tallestLabel = tallestTabLabel(labelHeights, fontScale)
  const growth = tabBarGrowth(
    tallestLabel === undefined ? [] : [tallestLabel],
    Platform.OS === 'ios' ? 1 : fontScale
  )
  // The underline sits on the bar's bottom edge below a label; beside the icon it does not move.
  const indicatorDrop = position === 'below-icon' ? growth : 0
  return { growth, indicatorDrop, onLabelHeight, tallestLabel }
}

type TabBarLabelProps = {
  color: string
  children: string
  /** D3 (P6): the active tab's label is semibold, the others medium. */
  focused?: boolean
  onHeight: (label: string, height: number, position: TabLabelPosition) => void
  /** React Navigation's label position: below the icon on phones, beside it on tablets. */
  position?: TabLabelPosition
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
  focused = false,
  onHeight,
  position = 'below-icon',
  lineBoxHeight,
}: TabBarLabelProps) {
  const { fontScale } = useWindowDimensions()
  // The active weight is wider, so a focus change fits the label again.
  const key = `${children}|${fontScale}|${position}|${focused ? 'active' : 'idle'}`
  const [fitState, setFitState] = useState({ key, fit: 1 })
  const fit = fitState.key === key ? fitState.fit : 1
  // A label reports its height only once it has settled on its size; a wrapped first layout
  // would otherwise grow the bar for a moment. Web has no text layout events and no text scale.
  // A new text, scale or position starts unsettled again (r46): its first layout is unfitted.
  const settled = useRef(Platform.OS === 'web')
  const layoutHeight = useRef<number | null>(null)
  const settledKey = useRef(key)
  if (settledKey.current !== key) {
    settledKey.current = key
    settled.current = Platform.OS === 'web'
    // The previous label's height is not this one's (r47): report only a layout of this key.
    layoutHeight.current = null
  }
  const report = () => {
    if (settled.current && layoutHeight.current !== null)
      onHeight(children, layoutHeight.current, position)
  }
  const onLayout = (event: LayoutChangeEvent) => {
    layoutHeight.current = event.nativeEvent.layout.height
    report()
  }
  const base = position === 'beside-icon' ? styles.beside : styles.below
  // D3: iOS labels do not scale (Large Content Viewer), so they render at their own size.
  const floor = tabLabelFitFloor(base.fontSize, Platform.OS === 'ios' ? 1 : fontScale)
  const onTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const next = nextTabLabelFit(
      fit,
      event.nativeEvent.lines.map((line) => line.width),
      floor
    )
    settled.current = next === fit
    if (settled.current) report()
    else setFitState({ key, fit: next })
  }
  // The line box is a view holding the text at its bottom. Holding the text view itself at the
  // tallest height with textAlignVertical bottom drew a shrunk label 64 px above its own box on
  // Android 2.0 (6c85bbb4 record run), so the text keeps its own height and reports it.
  return (
    <View
      style={[
        position === 'beside-icon' ? styles.lineBoxBeside : styles.lineBox,
        lineBoxHeight === undefined ? null : { minHeight: lineBoxHeight },
      ]}
    >
      <Text
        allowFontScaling={Platform.OS === 'ios' ? false : undefined}
        // D3 (P7): a label wraps to two lines at its 12 px floor; two lines hold every catalog
        // label at the smallest supported width, so none is ellipsized.
        numberOfLines={TAB_LABEL_MAX_LINES}
        onLayout={onLayout}
        onTextLayout={onTextLayout}
        style={[
          styles.label,
          base,
          focused ? SEMIBOLD : MEDIUM,
          { color },
          fit < 1 ? fitted(position, fit) : null,
        ]}
      >
        {children}
      </Text>
    </View>
  )
}

/** The size of a label shrunk by `fit`; beside the icon its fixed line height shrinks with it. */
function fitted(position: TabLabelPosition, fit: number) {
  return position === 'beside-icon'
    ? {
        fontSize: styles.beside.fontSize * fit,
        lineHeight: styles.beside.lineHeight * fit,
      }
    : { fontSize: styles.below.fontSize * fit }
}

// React Navigation's label styles: labelBeneath, and labelBeside with labelBesideUikit (the bar
// is never compact here: that is iPhone landscape, and the app is portrait only).
const styles = StyleSheet.create({
  label: {
    textAlign: 'center',
    backgroundColor: 'transparent',
  },
  lineBox: { justifyContent: 'flex-end' },
  // Beside the icon the line box shrinks in the tab's row and centres its label on the icon.
  lineBoxBeside: { justifyContent: 'center', flexShrink: 1 },
  below: { fontSize: 12 },
  // flexShrink lets a beside-icon label wrap inside its row instead of widening it.
  beside: { fontSize: 14, marginStart: 4, marginEnd: 12, lineHeight: 24, flexShrink: 1 },
})

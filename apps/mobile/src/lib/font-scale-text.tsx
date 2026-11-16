// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// React Native 0.81 lays each paragraph out once, with the text size multiplier of that moment,
// and keeps that layout when the system text size changes while the app runs: the boxes keep
// their old height and grown text is cut (iOS live font dispatch 43815625762: the share card
// title stayed 31 pt where a cold launch at the new size measures 42, Home's hourly ribbon read
// "Hourly Fo" and "12 A"). A paragraph is laid out again whenever its props change, so the
// outermost Text of every paragraph carries a maxFontSizeMultiplier that follows the font scale
// and that no text ever reaches: the change relayouts the text in place, with the screen, its
// state and its scroll position kept. Metro gives every `Text` from 'react-native' this one
// (metro-font-scale-text.js), so no call site changes. It is built from react-native's own Text
// by the shim (react-native-font-scale.js) and imports nothing from react-native at runtime, so it
// can never be handed itself.
//
// The Expo SDK 58 upgrade (React Native 0.87, where text relayouts on a font scale change by
// itself) removes this file, its Metro alias and their tests.
import React, { forwardRef, useContext, type Context } from 'react'
import type { Text, TextProps, useWindowDimensions } from 'react-native'

/**
 * A cap far above any text size multiplier the system offers (iOS tops out near 3.6, Android at
 * 2), so an uncapped paragraph stays uncapped.
 */
const UNCAPPED = 100

/**
 * The maxFontSizeMultiplier a paragraph's outermost Text carries at `fontScale`: different at
 * every font scale, and never a cap the text reaches. A caller's own cap moves by a millionth of
 * the scale at most, a size change far below a point.
 */
export function remeasureCap(cap: number | null | undefined, fontScale: number): number {
  if (typeof cap === 'number' && cap > 0) return cap + fontScale * 1e-6
  return UNCAPPED + fontScale * 1e-3
}

/**
 * The font-scale Text over react-native's own `Text`, `useWindowDimensions` and
 * `unstable_TextAncestorContext`. That context is true inside a Text and a View resets it, so a
 * Text in a View in a Text starts a paragraph of its own (CodeRabbit on PR 242), exactly as
 * react-native lays it out.
 */
export function createFontScaleText(
  NativeText: typeof Text,
  useDimensions: typeof useWindowDimensions,
  TextAncestor: Context<boolean>
) {
  const FontScaleText = forwardRef<React.ComponentRef<typeof Text>, TextProps>(
    function FontScaleText(props, ref) {
      const nested = useContext(TextAncestor)
      const { fontScale } = useDimensions()
      // A nested Text inherits its paragraph's cap; one of its own would override a cap the
      // paragraph sets.
      if (nested) return <NativeText ref={ref} {...props} />
      return (
        <NativeText
          ref={ref}
          {...props}
          maxFontSizeMultiplier={remeasureCap(props.maxFontSizeMultiplier, fontScale)}
        />
      )
    }
  )
  FontScaleText.displayName = 'Text'
  return FontScaleText
}

// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i: a fixed-size box around one glyph (the swap circle, the info dot, an avatar
// initial, a checkbox mark, the error mark) clipped its glyph at large text sizes, because the
// glyph scales with the system text size and the box did not. The box now scales by the same
// factor, so it looks the same at every size and is unchanged at the default size.
//
// Yoga's aspectRatio cannot do this in a row: it sets the box height from its width, and a glyph
// is narrower than it is tall, so the box stays shorter than its text.
import { PixelRatio, useWindowDimensions } from 'react-native'

/**
 * The text scale a glyph is drawn at: the system scale, capped by the glyph's own
 * `maxFontSizeMultiplier` when it sets one (React Native ignores values below 1, as here).
 */
function glyphScale(fontScale: number, maxFontSizeMultiplier?: number): number {
  return maxFontSizeMultiplier !== undefined &&
    Number.isFinite(maxFontSizeMultiplier) &&
    maxFontSizeMultiplier >= 1
    ? Math.min(fontScale, maxFontSizeMultiplier)
    : fontScale
}

/**
 * The side of a glyph box drawn at `base` at the default text size, never smaller than `base`.
 * At or below the default size it is `base` exactly: rounding it to the pixel grid made a 22 box
 * 58 px where Yoga drew 57 or 58 by position (2.625 density), so the default look moved 1 px.
 * Pass the glyph's `maxFontSizeMultiplier` when it sets one, so the box stops where the glyph does.
 */
export function glyphBoxSide(
  base: number,
  fontScale: number,
  maxFontSizeMultiplier?: number
): number {
  const scale = glyphScale(fontScale, maxFontSizeMultiplier)
  if (!(Number.isFinite(scale) && scale > 1)) return base
  return PixelRatio.roundToNearestPixel(base * scale)
}

/**
 * The size style of a square glyph box at the current text size. `round` makes it a circle;
 * otherwise the caller keeps its own corner radius.
 */
export function useGlyphBox(
  base: number,
  round: boolean,
  maxFontSizeMultiplier?: number
) {
  const { fontScale } = useWindowDimensions()
  const side = glyphBoxSide(base, fontScale, maxFontSizeMultiplier)
  return round
    ? { width: side, height: side, borderRadius: side / 2 }
    : { width: side, height: side }
}

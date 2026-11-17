// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Bundled into the app by the react-native shim (react-native-font-scale.js) and read by Metro's
// config tests, so it imports nothing. The Expo SDK 58 upgrade (React Native 0.87) removes it.

/**
 * `source`'s properties, each read only when used, with each loader in `replaced` in place of
 * the property it names. A replaced property of `source` is never read.
 */
function lazyCopy(source, replaced) {
  const copy = {}
  for (const name of Object.keys(source))
    Object.defineProperty(copy, name, {
      enumerable: true,
      get: replaced[name] ?? (() => source[name]),
    })
  return copy
}

/**
 * react-native's exports with the font-scale versions in `replaced` (Text, and Animated with an
 * animated font-scale Text). The real Text is never read, so nothing reaches it past the
 * font-scale Text.
 */
function withFontScaleText(reactNative, replaced) {
  return lazyCopy(reactNative, replaced)
}

/**
 * React Native's Animated with Text animated from the font-scale Text: Animated builds its own
 * Text from React Native's Text module, past 'react-native', and React Navigation draws header
 * titles with it (iOS dispatch 43852018196: Settings' title kept its launch height). One
 * component, made on first use, so React keeps each title's state.
 */
function withAnimatedText(Animated, loadText) {
  let animatedText
  return lazyCopy(Animated, {
    Text: () => (animatedText ??= Animated.createAnimatedComponent(loadText())),
  })
}

module.exports = { withAnimatedText, withFontScaleText }

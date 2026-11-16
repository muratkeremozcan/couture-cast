// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// What 'react-native' resolves to on iOS and Android (metro-font-scale-text.js): react-native,
// with the font-scale Text in place of Text, Animated.Text included. CommonJS, so each export stays a lazy getter as
// react-native's own are. It reads react-native as 'react-native/index': Metro caches the bare
// 'react-native' of app code once for every importer, so that name would hand the shim itself
// back. The Expo SDK 58 upgrade (React Native 0.87) removes it.
const reactNative = require('react-native/index')
const { createFontScaleText } = require('./font-scale-text')
const { withAnimatedText, withFontScaleText } = require('./with-font-scale-text')

let fontScaleText
let animated
const loadText = () =>
  (fontScaleText ??= createFontScaleText(
    reactNative.Text,
    reactNative.useWindowDimensions,
    reactNative.unstable_TextAncestorContext
  ))
module.exports = withFontScaleText(reactNative, {
  Text: loadText,
  Animated: () => (animated ??= withAnimatedText(reactNative.Animated, loadText)),
})

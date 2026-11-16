// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Bundled into the app by the react-native shim (react-native-font-scale.js) and read by Metro's
// config tests, so it imports nothing. The Expo SDK 58 upgrade (React Native 0.87) removes it.

/**
 * react-native's exports, each read only when used, with `loadText()` in place of Text. The real
 * Text is never read, so nothing reaches it past the font-scale Text.
 */
function withFontScaleText(reactNative, loadText) {
  const exports = {}
  for (const name of Object.keys(reactNative))
    Object.defineProperty(exports, name, {
      enumerable: true,
      get: name === 'Text' ? loadText : () => reactNative[name],
    })
  return exports
}

module.exports = { withFontScaleText }

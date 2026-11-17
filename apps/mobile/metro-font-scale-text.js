// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Metro gives every `Text` and `Animated.Text` from 'react-native', in the app and in its
// libraries, the font-scale Text (src/lib/font-scale-text.tsx), which relayouts text in place
// when the system text size changes. On iOS and Android only: the web lays text out again by
// itself. The shim reads react-native as REACT_NATIVE_ENTRY, a name this never takes, and the
// font-scale Text imports nothing from react-native at runtime. The Expo SDK 58 upgrade (React
// Native 0.87) removes this file with the font-scale Text.
const path = require('node:path')

const { withAnimatedText, withFontScaleText } = require('./src/lib/with-font-scale-text')

const FONT_SCALE_SHIM = path.join(__dirname, 'src/lib/react-native-font-scale.js')

// The name the shim reads react-native by. Metro caches the bare 'react-native' of app code once
// for every importer, so the shim cannot ask for that name, and 'react-native/index' is a deep
// import: React Native's dev Babel preset logs a warning for it on every bundle load, and LogBox
// shows that warning as a toast over the bottom of the screen, where it swallowed a Maestro tap
// on Android (run 44160911846). Metro resolves this name as its own resolver resolves the bare
// 'react-native'.
const REACT_NATIVE_ENTRY = 'react-native-font-scale-entry'

/** The file Metro resolves `moduleName` to instead of react-native, or null. */
function fontScaleTextTarget(moduleName, platform) {
  if (moduleName !== 'react-native') return null
  if (platform !== 'ios' && platform !== 'android') return null
  return FONT_SCALE_SHIM
}

/** The name Metro's own resolver resolves `moduleName` as, or null. */
function reactNativeEntryRequest(moduleName) {
  return moduleName === REACT_NATIVE_ENTRY ? 'react-native' : null
}

module.exports = {
  FONT_SCALE_SHIM,
  REACT_NATIVE_ENTRY,
  fontScaleTextTarget,
  reactNativeEntryRequest,
  withAnimatedText,
  withFontScaleText,
}

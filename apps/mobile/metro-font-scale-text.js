// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Metro gives every `Text` imported from 'react-native', in the app and in its libraries, the
// font-scale Text (src/lib/font-scale-text.tsx), which relayouts text in place when the system
// text size changes. On iOS and Android only: the web lays text out again by itself. The shim
// reads react-native as 'react-native/index', a name this never takes, and the font-scale Text
// imports nothing from react-native at runtime. The Expo SDK 58 upgrade (React Native 0.87)
// removes this file with the font-scale Text.
const path = require('node:path')

const { withFontScaleText } = require('./src/lib/with-font-scale-text')

const FONT_SCALE_SHIM = path.join(__dirname, 'src/lib/react-native-font-scale.js')

/** The file Metro resolves `moduleName` to instead of react-native, or null. */
function fontScaleTextTarget(moduleName, platform) {
  if (moduleName !== 'react-native') return null
  if (platform !== 'ios' && platform !== 'android') return null
  return FONT_SCALE_SHIM
}

module.exports = {
  FONT_SCALE_SHIM,
  fontScaleTextTarget,
  withFontScaleText,
}

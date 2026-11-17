const { getDefaultConfig } = require('expo/metro-config')
const {
  fontScaleTextTarget,
  reactNativeEntryRequest,
} = require('./metro-font-scale-text')

const config = getDefaultConfig(__dirname)

// TypeScript's NodeNext resolution requires `.js` on relative dynamic imports, while the
// source files are `.ts`/`.tsx`. Retry an unresolved relative `.js` specifier without the
// extension so Metro finds the TypeScript module. Real `.js` files still resolve first.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Every Text from 'react-native' relayouts in place when the system text size changes
  // (metro-font-scale-text.js), until the Expo SDK 58 upgrade removes it.
  const fontScaleShim = fontScaleTextTarget(
    moduleName,
    platform,
    context.originModulePath
  )
  if (fontScaleShim) return { type: 'sourceFile', filePath: fontScaleShim }
  // The shim's own react-native, by a name no deep-import warning covers.
  const reactNativeEntry = reactNativeEntryRequest(moduleName)
  if (reactNativeEntry) return context.resolveRequest(context, reactNativeEntry, platform)
  try {
    return context.resolveRequest(context, moduleName, platform)
  } catch (error) {
    if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform)
    }
    throw error
  }
}

module.exports = config

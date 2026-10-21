const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// TypeScript's NodeNext resolution requires `.js` on relative dynamic imports, while the
// source files are `.ts`/`.tsx`. Retry an unresolved relative `.js` specifier without the
// extension so Metro finds the TypeScript module. Real `.js` files still resolve first.
config.resolver.resolveRequest = (context, moduleName, platform) => {
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

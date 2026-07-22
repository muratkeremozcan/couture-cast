// Proxy to merge react-native-web and missing react-native native-only exports
export * from 'react-native-web'

// Mock native Fabric TurboModuleRegistry
export const TurboModuleRegistry = {
  get: (name) => null,
  getEnforcing: (name) => ({}),
}

// Add any other native-only API stubs here if needed in the future

// vitest.config.ts aliases this specifier to expo-constants' built web module.
declare module 'expo-constants/exponent-constants-web' {
  const constants: Record<string, unknown>
  export default constants
}

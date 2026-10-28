/**
 * Environment of the owned dev Metro. Expo bundles `import()` targets lazily in dev, so the
 * first use of a dynamically imported module (expo-media-library on the first Save) built a
 * 13.8 s bundle mid-flow in CI run 40726798107. On iOS, where warm-metro.mjs builds the whole
 * bundle before the first flow, lazy bundling is disabled so every module is in that bundle.
 * Other platforms keep Expo's default: Android lanes do not warm Metro.
 */
export const metroServerEnv = (buildEnv, platform) =>
  platform === 'ios' ? { ...buildEnv, EXPO_NO_METRO_LAZY: '1' } : { ...buildEnv }

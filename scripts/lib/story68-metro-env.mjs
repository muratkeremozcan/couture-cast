/**
 * Environment of the owned dev Metro. Expo bundles `import()` targets lazily in dev, so the
 * first use of a dynamically imported module (expo-media-library on the first Save) built a
 * 13.8 s bundle mid-flow in CI run 40726798107. Disabling lazy bundling puts every module in
 * the bundle that warm-metro.mjs builds before the first flow.
 */
export const metroServerEnv = (buildEnv) => ({ ...buildEnv, EXPO_NO_METRO_LAZY: '1' })

/**
 * Environment of the owned dev Metro. Expo bundles `import()` targets lazily in dev, so the
 * first use of a dynamically imported module (expo-media-library on the first Save) built a
 * 13.8 s bundle mid-flow in CI run 40726798107. On iOS, where warm-metro.mjs builds the whole
 * bundle before the first flow, lazy bundling is disabled so every module is in that bundle.
 * Other platforms keep Expo's default: Android lanes do not warm Metro.
 */
export const metroServerEnv = (buildEnv, platform) =>
  platform === 'ios' ? { ...buildEnv, EXPO_NO_METRO_LAZY: '1' } : { ...buildEnv }

/**
 * Metro's transform workers are separate Node processes that stay resident after the bundle is
 * built (two of 515 to 630 MB each in CI runs 21 and 22, next to the 670 MB server). On the 3 CPU
 * 7 GB iOS host that memory is paged out under the simulator. One worker runs the transforms in
 * the server process: the cold bundle takes about twice as long (21 s of 2232 modules), before
 * any flow starts, and the resident total drops by about 0.4 GB (measured locally with --clear).
 */
export const metroServerArgs = (platform) =>
  platform === 'ios' ? ['--max-workers', '1'] : []

/**
 * The public build environment of the Story 6.8 native harness: loopback origins and the
 * isolated-build switch, plus the runtime's anon key. prepare.mjs writes it for each runtime, and
 * scripts/ci/native-build-cache.mjs keys the native development client by the same values, so the
 * two cannot drift apart.
 */
export const STORY68_API_ORIGIN = 'http://127.0.0.1:4088'
/**
 * The owned auth proxy's port (scripts/e2e-share-card/auth.mjs). Below 32768, outside every
 * runner's ephemeral range: on 53068 an outgoing connection could hold it as its local port, and
 * the proxy's listen then failed (run 44145335277; scripts/lib/owned-listener-ports.test.mjs).
 */
export const STORY68_AUTH_PROXY_PORT = 23068
export const STORY68_AUTH_ORIGIN = `http://127.0.0.1:${STORY68_AUTH_PROXY_PORT}`

/** @param {string} anonKey the anon key of the runtime's own Supabase stack */
export const story68PublicBuildEnv = (anonKey) => ({
  STORY68_NATIVE_TEST_BUILD: '1',
  TEST_ENV: 'local',
  EXPO_PUBLIC_API_BASE_URL: STORY68_API_ORIGIN,
  EXPO_PUBLIC_SUPABASE_URL: STORY68_AUTH_ORIGIN,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  POSTHOG_API_KEY: '',
})

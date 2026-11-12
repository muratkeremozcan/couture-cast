// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Which RevenueCat public SDK key the app configures (story 6.15 D15, TEA-20). A RevenueCat Test
// Store key runs only in a development bundle: the SDK crashes on purpose when one reaches a
// release build, and `.env.local`, which holds the Test Store key, is also loaded for laptop
// production builds. So a release bundle never selects a `test_` key, wherever it came from.

type RevenueCatKeyEnv = {
  EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY?: string
  EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY?: string
  EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY?: string
}

const isTestStoreKey = (key: string | undefined) => Boolean(key?.startsWith('test_'))

export function selectRevenueCatApiKey({
  os,
  dev,
  env,
}: {
  os: string
  dev: boolean
  env: RevenueCatKeyEnv
}): string | undefined {
  const platformKey =
    os === 'ios'
      ? env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY
      : os === 'android'
        ? env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY
        : undefined
  if (os !== 'ios' && os !== 'android') return undefined
  if (dev && env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY)
    return env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY
  if (!platformKey || (!dev && isTestStoreKey(platformKey))) return undefined
  return platformKey
}

/**
 * The keys as Expo inlines them. Each `process.env.EXPO_PUBLIC_*` is written out in full, because
 * the bundler replaces only literal member reads, and the Test Store key is read only inside the
 * `__DEV__` branch, so a release bundle's minifier drops it with the branch; the production bundle
 * scan (scripts/ci/revenuecat-bundle-scan.mjs) proves the key is absent.
 */
export function revenueCatKeyEnv(): RevenueCatKeyEnv {
  return {
    EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY:
      process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY,
    EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY:
      process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY,
    EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY: __DEV__
      ? process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY
      : undefined,
  }
}

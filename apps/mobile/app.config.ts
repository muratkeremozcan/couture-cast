import { config as loadEnv } from 'dotenv'
import type { ConfigContext } from 'expo/config'
import path from 'node:path'

const rootDir = path.resolve(__dirname, '../..')
const rootEnvFiles = [
  '.env.local',
  process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.preview',
  '.env',
]

for (const file of rootEnvFiles) {
  loadEnv({ path: path.join(rootDir, file), override: false, quiet: true })
}

const story68Native = process.env.STORY68_NATIVE_TEST_BUILD === '1'
const releaseProofLoopback = process.env.CC68_RELEASE_PROOF_LOOPBACK === '1'
if (
  releaseProofLoopback &&
  (!story68Native ||
    (process.env.EAS_BUILD_PROFILE &&
      process.env.EAS_BUILD_PROFILE !== 'cc68-release-proof'))
)
  throw new Error('Story 6.8 Release loopback requires an isolated local proof build.')

const isolatedNative = process.env.STORY65_NATIVE_TEST_BUILD === '1' || story68Native
const isolatedStory = story68Native ? '68' : '65'
if (isolatedNative) {
  for (const value of [
    process.env.EXPO_PUBLIC_API_BASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  ]) {
    if (
      !value ||
      !['localhost', '127.0.0.1', '10.0.2.2'].includes(new URL(value).hostname)
    )
      throw new Error(
        'Story 6.5 native fixtures require explicit local API and Auth origins.'
      )
  }
}
export default ({ config }: ConfigContext) => ({
  ...config,
  plugins: ['./plugins/with-story68-release-network', ...(config.plugins ?? [])],
  ...(isolatedNative
    ? {
        name: `CoutureCast Story${isolatedStory}`,
        scheme: `couturecast-story${isolatedStory}`,
      }
    : {}),
  ios: {
    ...config.ios,
    ...(isolatedNative
      ? { bundleIdentifier: `com.couturecast.story${isolatedStory}` }
      : {}),
  },
  android: {
    ...config.android,
    ...(isolatedNative ? { package: `com.couturecast.story${isolatedStory}` } : {}),
    ...(process.env.FIREBASE_GOOGLE_SERVICES_FILE
      ? { googleServicesFile: process.env.FIREBASE_GOOGLE_SERVICES_FILE }
      : {}),
  },
  extra: {
    ...config.extra,
    story65NativeFixtures: isolatedNative && !story68Native,
    story68NativeFixtures: story68Native,
    supabaseUrl:
      process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      '',
    posthogApiKey: process.env.POSTHOG_API_KEY ?? '',
    posthogHost: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    mobileAnalyticsDiagnostics:
      process.env.MOBILE_ANALYTICS_DIAGNOSTICS === '1' ||
      process.env.EXPO_PUBLIC_MOBILE_ANALYTICS_DIAGNOSTICS === '1',
  },
})

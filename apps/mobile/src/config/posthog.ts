import Constants from 'expo-constants'
import PostHog from 'posthog-react-native'

type ExpoExtra = {
  posthogApiKey?: string
  posthogHost?: string
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra
const apiKey = extra.posthogApiKey ?? process.env.EXPO_PUBLIC_POSTHOG_KEY
const host =
  extra.posthogHost ?? process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'
const isPostHogConfigured = Boolean(apiKey && apiKey !== 'phc_your_project_key')

if (!isPostHogConfigured) {
  console.warn(
    'PostHog API key not configured. Analytics will be disabled. ' +
      'Set POSTHOG_API_KEY in root env files to enable analytics.'
  )
}

/**
 * PostHog-backed provider client for Expo analytics.
 *
 * The repo-local mobile analytics facade wraps this instance so feature code
 * can depend on `MobileAnalyticsClient` instead of importing PostHog directly.
 *
 * Configuration loaded from Expo app config extra values.
 * Root env files provide canonical POSTHOG_API_KEY and POSTHOG_HOST values.
 * Required peer dependencies: expo-file-system, expo-application, expo-device,
 * expo-localization.
 *
 * @see https://posthog.com/docs/libraries/react-native
 */
export const posthogProviderClient = new PostHog(apiKey ?? 'placeholder_key', {
  // PostHog API host
  host,

  // Disable PostHog if API key is not configured
  disabled: !isPostHogConfigured,

  // Capture app lifecycle events:
  // - Application Installed, Application Updated
  // - Application Opened, Application Became Active, Application Backgrounded
  captureAppLifecycleEvents: true,

  // Batching: queue events and flush periodically to optimize battery usage
  flushAt: 20, // Number of events to queue before sending
  flushInterval: 10000, // Interval in ms between periodic flushes
  maxBatchSize: 100, // Maximum events per batch
  maxQueueSize: 1000, // Maximum queued events (oldest dropped when full)

  // Feature flags
  preloadFeatureFlags: true, // Load flags on initialization
  sendFeatureFlagEvent: true, // Track getFeatureFlag calls for experiments
  featureFlagsRequestTimeoutMs: 10000, // Timeout for flag requests

  // Network settings
  requestTimeout: 10000, // General request timeout in ms
  fetchRetryCount: 3, // Number of retry attempts for failed requests
  fetchRetryDelay: 3000, // Delay between retries in ms
})

// Backwards-compatible alias while the repo-local facade rolls out across the
// mobile app.
export const posthog = posthogProviderClient

export const isPostHogEnabled = isPostHogConfigured

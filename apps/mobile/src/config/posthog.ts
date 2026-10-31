// Story 6.9 Task 6 step 1 owner: sanitize mobile share events in `apps/mobile/src/config/posthog.ts`
import Constants from 'expo-constants'
import PostHog, { type PostHogOptions } from 'posthog-react-native'
import {
  SHARE_CARD_SHARED_EVENT,
  sanitizeShareCardSharedProperties,
} from '@couture/api-client'

type ExpoExtra = {
  posthogApiKey?: string
  posthogHost?: string
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra
// `||`, not `??`, on both hops. app.config.ts resolves this value as
// `process.env.POSTHOG_API_KEY ?? ''`, so an environment without the variable
// supplies an empty string rather than undefined, and `??` treats that as a
// present value: the env fallback never fires and the empty string reaches the
// PostHog constructor, which throws `You must pass your PostHog project's api
// key` at module scope. That crash takes the whole bundle down, so every
// Maestro flow fails with the app never mounting, and it fires on any machine
// without a key configured, which is every CI runner.
const apiKey = extra.posthogApiKey || process.env.EXPO_PUBLIC_POSTHOG_KEY
const host =
  extra.posthogHost || process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'
const isPostHogConfigured = Boolean(apiKey && apiKey !== 'phc_your_project_key')

if (!isPostHogConfigured) {
  console.warn(
    'PostHog API key not configured. Analytics will be disabled. ' +
      'Set POSTHOG_API_KEY in root env files to enable analytics.'
  )
}

type BeforeSend = Extract<
  NonNullable<PostHogOptions['before_send']>,
  (event: never) => unknown
>
type PostHogCaptureEvent = NonNullable<Parameters<BeforeSend>[0]>
type PostHogEventProperties = NonNullable<PostHogCaptureEvent['properties']>

/**
 * Story 6.9 D5: the final allowlist at the SDK boundary, run by the SDK after it has
 * merged super properties and device enrichment. For `share_card_shared` only, the
 * envelope stays intact (event, uuid, timestamp; the SDK keeps distinct_id, type, library
 * and library_version outside this hook), `properties` become the sanitized allowlist with
 * `$geoip_disable: true`, `$ip: null` and `$process_person_profile: false`, and top-level
 * and nested `$set`/`$set_once` are removed. A
 * sanitizer refusal or any error drops the event and logs a closed code; the SDK would
 * otherwise send the unsanitized event after a throwing hook, so this never throws.
 * Every other event passes through unchanged.
 */
export function mobilePostHogBeforeSend(
  event: PostHogCaptureEvent | null
): PostHogCaptureEvent | null {
  try {
    if (!event || event.event !== SHARE_CARD_SHARED_EVENT) return event
    const properties = sanitizeShareCardSharedProperties(event.properties)
    if (!properties) {
      console.warn('[cc69-analytics] share_event_dropped')
      return null
    }
    return {
      uuid: event.uuid,
      event: event.event,
      timestamp: event.timestamp,
      properties: properties as PostHogEventProperties,
    }
  } catch {
    console.warn('[cc69-analytics] before_send_failed')
    return null
  }
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
// The placeholder is used whenever the key is not usable, not merely when it is
// nullish. `disabled` below already reads `isPostHogConfigured`, but the
// constructor rejects a falsy key before any option is consulted, so the guard
// has to be on the argument itself.
export const posthogProviderClient = new PostHog(
  isPostHogConfigured && apiKey ? apiKey : 'placeholder_key',
  {
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

    // Story 6.9 D5: the event-specific final allowlist for share_card_shared.
    before_send: mobilePostHogBeforeSend,
  }
)

// Backwards-compatible alias while the repo-local facade rolls out across the
// mobile app.
export const posthog = posthogProviderClient

export const isPostHogEnabled = isPostHogConfigured

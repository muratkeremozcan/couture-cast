// Story 6.9 Task 6 step 2 owner: sanitize web share events in `apps/web/src/analytics/browser-analytics.ts`
import posthog, { type CaptureResult } from 'posthog-js'
import {
  PERSONAL_ANALYTICS_PROPERTY_KEYS,
  SHARE_CARD_SHARED_EVENT,
  sanitizeShareCardSharedProperties,
  stripPersonalAnalyticsData,
} from '@couture/api-client'

export interface BrowserAnalyticsClient {
  capture(event: string, properties?: Record<string, unknown>): void
  getDistinctId(): string | undefined
}

type CapturedAnalyticsEvent = {
  event: string
  properties: Record<string, unknown>
}

declare global {
  interface Window {
    __enableAnalyticsTestHook?: boolean
    __capturedAnalyticsEvents?: CapturedAnalyticsEvent[]
  }
}

let initialized = false

/** The closed code logged when the share event is dropped at the SDK boundary. */
export const SHARE_CARD_ANALYTICS_DROPPED = 'share_card_analytics_dropped'

/**
 * Story 6.9 D5: the final allowlist for share_card_shared at the SDK boundary, after
 * posthog-js has added URL, path, referrer, screen, super properties and `$set` /
 * `$set_once`. The event keeps its envelope (event, uuid, timestamp) and only the
 * sanitized `properties`; web keeps `distinct_id` inside them. Any internal error or a
 * null sanitizer result drops the event and logs a closed code. It never throws,
 * because posthog-js keeps the original event when a hook throws. Other events pass
 * through unchanged.
 */
export function shareCardSharedBeforeSend(
  event: CaptureResult | null
): CaptureResult | null {
  try {
    if (event?.event !== SHARE_CARD_SHARED_EVENT) return event
    const properties = sanitizeShareCardSharedProperties(event.properties)
    if (!properties) throw new Error(SHARE_CARD_ANALYTICS_DROPPED)
    const sanitized: CaptureResult = { uuid: event.uuid, event: event.event, properties }
    if (event.timestamp !== undefined) sanitized.timestamp = event.timestamp
    return sanitized
  } catch {
    console.warn(SHARE_CARD_ANALYTICS_DROPPED)
    return null
  }
}

// The only script posthog-js may load at runtime: the exception autocapture bundle.
const ALLOWED_EXTERNAL_SCRIPT = /^\/ingest\/static\/exception-autocapture\.js$/

/**
 * Production analytics privacy: posthog-js loads optional extensions (console logs,
 * session replay, surveys, toolbar, web vitals, the remote config script and site apps)
 * as scripts when the project's remote config asks for them, and a local `false` is no
 * veto for console logs, whose exporter bypasses before_send. This hook lets through
 * the exception autocapture script from our own /ingest proxy and refuses every other
 * script, so no remote setting can switch those extensions on.
 */
export function allowExceptionAutocaptureScriptOnly(
  script: HTMLScriptElement
): HTMLScriptElement | null {
  try {
    const url = new URL(script.src, window.location.origin)
    return url.origin === window.location.origin &&
      ALLOWED_EXTERNAL_SCRIPT.test(url.pathname)
      ? script
      : null
  } catch {
    return null
  }
}

function isAnalyticsTestMode() {
  return typeof window !== 'undefined' && window.__enableAnalyticsTestHook === true
}

function getPostHogToken() {
  const token = process.env.POSTHOG_API_KEY

  return typeof token === 'string' && token.trim().length > 0 ? token : null
}

export const browserAnalytics: BrowserAnalyticsClient = {
  capture(event, properties) {
    if (isAnalyticsTestMode()) {
      window.__capturedAnalyticsEvents ??= []
      window.__capturedAnalyticsEvents.push({
        event,
        properties: properties ?? {},
      })
    }

    if (!getPostHogToken()) {
      return
    }

    initializeBrowserAnalytics()
    posthog.capture(
      event,
      properties,
      isAnalyticsTestMode()
        ? {
            send_instantly: true,
            transport: 'XHR',
          }
        : undefined
    )
  },
  getDistinctId() {
    if (!getPostHogToken()) {
      return undefined
    }

    initializeBrowserAnalytics()
    return posthog.get_distinct_id() || undefined
  },
}

export function initializeBrowserAnalytics(): BrowserAnalyticsClient {
  if (!initialized) {
    const analyticsTestMode = isAnalyticsTestMode()
    const postHogToken = getPostHogToken()

    if (!postHogToken) {
      return browserAnalytics
    }

    // Production analytics privacy: CoutureCast has members aged 13 to 15 (with
    // guardian consent) and wardrobe photos, so the SDK sends explicit events,
    // pageviews and exceptions only, in every environment. Autocapture, rage and dead
    // clicks, heatmaps, session recording, surveys, product tours and conversations
    // stay off; element text, attributes and inputs are masked should any capture
    // mode be switched on remotely; no extension script but exception autocapture
    // loads; anonymous visitors get no person profile; and stripPersonalAnalyticsData
    // removes personal keys, reduces every URL to origin and route template, and
    // scrubs exception messages before any event leaves. See the "Production
    // analytics" section of _bmad-output/project-knowledge/deployment-guide.md.
    posthog.init(postHogToken, {
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      capture_pageview: analyticsTestMode ? false : 'history_change',
      autocapture: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      disable_session_recording: true,
      session_recording: { maskAllInputs: true, maskTextSelector: '*' },
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      mask_personal_data_properties: true,
      custom_personal_data_properties: [...PERSONAL_ANALYTICS_PROPERTY_KEYS],
      person_profiles: 'identified_only',
      prepare_external_dependency_script: allowExceptionAutocaptureScriptOnly,
      request_batching: !analyticsTestMode,
      disable_compression: analyticsTestMode,
      // Include the defaults option as required by PostHog
      defaults: '2026-01-30',
      // Enables capturing unhandled exceptions via Error Tracking
      capture_exceptions: !analyticsTestMode,
      before_send: [stripPersonalAnalyticsData, shareCardSharedBeforeSend],
      // Turn on debug in development mode
      debug: process.env.NODE_ENV === 'development',
    })
    initialized = true
  }

  return browserAnalytics
}

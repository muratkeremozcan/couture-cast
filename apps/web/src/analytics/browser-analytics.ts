import posthog, { type CaptureResult } from 'posthog-js'
import {
  SHARE_CARD_SHARED_EVENT,
  sanitizeShareCardSharedProperties,
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

    posthog.init(postHogToken, {
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      capture_pageview: analyticsTestMode ? false : 'history_change',
      autocapture: !analyticsTestMode,
      request_batching: !analyticsTestMode,
      disable_compression: analyticsTestMode,
      disable_session_recording: analyticsTestMode,
      disable_surveys: analyticsTestMode,
      // Include the defaults option as required by PostHog
      defaults: '2026-01-30',
      // Enables capturing unhandled exceptions via Error Tracking
      capture_exceptions: !analyticsTestMode,
      before_send: shareCardSharedBeforeSend,
      // Turn on debug in development mode
      debug: process.env.NODE_ENV === 'development',
    })
    initialized = true
  }

  return browserAnalytics
}

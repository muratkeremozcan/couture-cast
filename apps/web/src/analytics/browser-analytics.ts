import posthog from 'posthog-js'

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

function isAnalyticsTestMode() {
  return typeof window !== 'undefined' && window.__enableAnalyticsTestHook === true
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
    initializeBrowserAnalytics()
    return posthog.get_distinct_id() || undefined
  },
}

export function initializeBrowserAnalytics(): BrowserAnalyticsClient {
  if (!initialized) {
    const analyticsTestMode = isAnalyticsTestMode()

    posthog.init(process.env.POSTHOG_API_KEY!, {
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
      // Turn on debug in development mode
      debug: process.env.NODE_ENV === 'development',
    })
    initialized = true
  }

  return browserAnalytics
}

import posthog from 'posthog-js'

export interface BrowserAnalyticsClient {
  capture(event: string, properties?: Record<string, unknown>): void
  getDistinctId(): string | undefined
}

let initialized = false

export const browserAnalytics: BrowserAnalyticsClient = {
  capture(event, properties) {
    posthog.capture(event, properties)
  },
  getDistinctId() {
    return posthog.get_distinct_id() || undefined
  },
}

export function initializeBrowserAnalytics(): BrowserAnalyticsClient {
  if (!initialized) {
    posthog.init(process.env.POSTHOG_API_KEY!, {
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      capture_pageview: 'history_change',
      // Include the defaults option as required by PostHog
      defaults: '2026-01-30',
      // Enables capturing unhandled exceptions via Error Tracking
      capture_exceptions: true,
      // Turn on debug in development mode
      debug: process.env.NODE_ENV === 'development',
    })
    initialized = true
  }

  return browserAnalytics
}

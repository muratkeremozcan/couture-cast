/* eslint-disable react/no-unescaped-entities */
'use client'

import {
  trackAlertReceived,
  trackRitualCreated,
  trackWardrobeUploadStarted,
} from '@couture/api-client'
import { useEffect, useRef, type ChangeEvent, type MouseEvent } from 'react'
import { browserAnalytics } from '../../analytics/browser-analytics'
import { createWebApiClient } from '../../lib/api-client'
import { pollWebEvents } from '../../lib/events-client'

declare global {
  interface Window {
    __enableAnalyticsTestHook?: boolean
    __analyticsBindingsReady?: boolean
  }
}

type AlertEventPayload = {
  alertType?: string
  severity?: 'warning' | 'critical'
  weatherSeverity?: string
}

function parseAlertEventPayload(payload: unknown): AlertEventPayload {
  if (!payload || typeof payload !== 'object') {
    return {}
  }

  const payloadRecord = payload as Record<string, unknown>

  return {
    alertType:
      typeof payloadRecord.alertType === 'string' ? payloadRecord.alertType : undefined,
    severity:
      payloadRecord.severity === 'warning' || payloadRecord.severity === 'critical'
        ? payloadRecord.severity
        : undefined,
    weatherSeverity:
      typeof payloadRecord.weatherSeverity === 'string'
        ? payloadRecord.weatherSeverity
        : undefined,
  }
}

/** Story 0.7 support file: explicit web tracking wrapper usage.
 * Wrapper role: keep handlers thin by delegating event/property contracts to shared track* helpers.
 * Problems solved: avoids per-handler payload drift that weakens funnel/debug observability across web and mobile.
 * Alternatives: raw posthog.capture calls in each handler or full reliance on DOM auto-capture conventions.
 * Flow refs:
 * - S0.7/T3/1: web handlers reuse the shared track* wrappers instead of building payloads inline.
 * - S0.7/T2/2: wrapper calls keep the snake_case property contract consistent with mobile/API.
 */
// Flow ref S0.7/T3/1: collect identity + feature context here, then let the
// shared wrappers decide the analytics payload shape.
function getWebAnalyticsIdentity() {
  return {
    userId: browserAnalytics.getDistinctId() || 'web-anonymous-user',
    locationId: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
  }
}

export function AnalyticsEventActions() {
  const nextSinceRef = useRef<string | null>(null)
  const apiClientRef = useRef<ReturnType<typeof createWebApiClient> | null>(null)

  useEffect(() => {
    // Story 0.9 Task 7 step 4 owner:
    // hold the generated client at the component edge so polling reuses one app-local runtime wrapper.
    apiClientRef.current = createWebApiClient()
  }, [])

  useEffect(() => {
    if (window.__enableAnalyticsTestHook) {
      window.__analyticsBindingsReady = true
    }

    const trackAlertEvents = async () => {
      const apiClient = apiClientRef.current
      if (!apiClient) {
        return
      }

      try {
        const body = await pollWebEvents(nextSinceRef.current ?? undefined, apiClient)
        if (typeof body.nextSince === 'string') {
          nextSinceRef.current = body.nextSince
        }

        for (const event of body.events ?? []) {
          if (!event.channel.includes('alert')) {
            continue
          }

          const eventPayload = parseAlertEventPayload(event.payload)

          // Flow ref S0.7/T2/2: build canonical analytics payloads via the
          // shared track* wrappers, not ad hoc posthog.capture calls.
          const payload = trackAlertReceived({
            userId: event.userId || getWebAnalyticsIdentity().userId,
            alertType: eventPayload.alertType || event.channel,
            severity: eventPayload.severity ?? 'info',
            weatherSeverity: eventPayload.weatherSeverity,
            timestamp: new Date().toISOString(),
          })
          // Flow ref S0.7/T3/1: emit only the normalized contract payload.
          browserAnalytics.capture(payload.event, payload.properties)
        }
      } catch {
        // Ignore transient polling failures and retry on the next interval.
        return
      }
    }

    void trackAlertEvents()
    const interval = window.setInterval(() => {
      void trackAlertEvents()
    }, 30_000)
    return () => {
      window.clearInterval(interval)

      if (window.__enableAnalyticsTestHook) {
        window.__analyticsBindingsReady = false
      }
    }
  }, [])

  const handleRitualCreated = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()

    const identity = getWebAnalyticsIdentity()
    const payload = trackRitualCreated({
      userId: identity.userId,
      locationId: identity.locationId,
      ritualType: 'daily_outfit',
      weatherContext: 'hero_cta',
      timestamp: new Date().toISOString(),
    })
    browserAnalytics.capture(payload.event, payload.properties)
  }

  const handleWardrobeUploadStarted = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const identity = getWebAnalyticsIdentity()
    const payload = trackWardrobeUploadStarted({
      userId: identity.userId,
      itemId: file.name || `web-upload-${Date.now()}`,
      fileSize: file.size,
      itemCount: 1,
      uploadSource: 'web_file_picker',
      timestamp: new Date().toISOString(),
    })
    browserAnalytics.capture(payload.event, payload.properties)
    event.target.value = ''
  }

  return (
    <div className="flex flex-wrap gap-4" data-testid="hero-cta-group">
      <a
        href="#"
        data-testid="cta-primary"
        data-ph-event="cta_clicked"
        data-ph-cta-label="Preview outfits"
        data-ph-cta-type="primary"
        onClick={handleRitualCreated}
        className="bg-amber-300 text-black px-6 py-3 rounded-full font-semibold hover:bg-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
      >
        Preview outfits
      </a>
      <a
        href="#wardrobe"
        data-testid="cta-secondary"
        data-ph-event="cta_clicked"
        data-ph-cta-label="See the planner"
        data-ph-cta-type="secondary"
        className="border border-white/30 px-6 py-3 rounded-full font-semibold hover:border-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        See the planner
      </a>
      <label
        htmlFor="wardrobe-upload-input"
        data-testid="track-wardrobe-upload-started"
        className="border border-amber-300/70 px-6 py-3 rounded-full font-semibold text-amber-200 hover:bg-amber-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
      >
        Start wardrobe upload
      </label>
      <input
        id="wardrobe-upload-input"
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleWardrobeUploadStarted}
      />
    </div>
  )
}

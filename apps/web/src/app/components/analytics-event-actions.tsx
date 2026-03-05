/* eslint-disable react/no-unescaped-entities */
'use client'

import {
  trackAlertReceived,
  trackRitualCreated,
  trackWardrobeUploadStarted,
} from '@couture/api-client'
import posthog from 'posthog-js'
import { useEffect, useRef, type ChangeEvent, type MouseEvent } from 'react'

type EventPollResponse = {
  events?: {
    id: string
    channel: string
    payload?: Record<string, unknown>
    userId?: string | null
  }[]
  nextSince?: string | null
}

/** Story 0.7 Task 2/3: explicit web tracking wrapper usage.
 * Wrapper role: keep handlers thin by delegating event/property contracts to shared track* helpers.
 * Problems solved: avoids per-handler payload drift that weakens funnel/debug observability across web and mobile.
 * Alternatives: raw posthog.capture calls in each handler or full reliance on DOM auto-capture conventions.
 * Setup steps (where we did this):
 *   1) collect identity + feature context (CTA, upload, alert poll payloads).
 *   2) build canonical analytics payloads via trackRitualCreated/trackWardrobeUploadStarted/trackAlertReceived.
 *   3) emit normalized events with posthog.capture in each flow below.
 */
// 1) collect identity + feature context (CTA, upload, alert poll payloads).
function getWebAnalyticsIdentity() {
  return {
    userId: posthog.get_distinct_id() || 'web-anonymous-user',
    locationId: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
  }
}

export function AnalyticsEventActions() {
  const nextSinceRef = useRef<string | null>(null)

  useEffect(() => {
    const trackAlertEvents = async () => {
      const params = new URLSearchParams()
      if (nextSinceRef.current) {
        params.set('since', nextSinceRef.current)
      }

      try {
        const response = await fetch(
          `/api/v1/events/poll${params.toString() ? `?${params.toString()}` : ''}`,
          {
            cache: 'no-store',
          }
        )
        if (!response.ok) {
          return
        }

        const body = (await response.json()) as EventPollResponse
        if (typeof body.nextSince === 'string') {
          nextSinceRef.current = body.nextSince
        }

        for (const event of body.events ?? []) {
          if (!event.channel.includes('alert')) {
            continue
          }

          // 2) build canonical analytics payloads via trackRitualCreated/trackWardrobeUploadStarted/trackAlertReceived.
          const payload = trackAlertReceived({
            userId: event.userId || getWebAnalyticsIdentity().userId,
            alertType:
              (typeof event.payload?.alertType === 'string' && event.payload.alertType) ||
              event.channel,
            severity:
              event.payload?.severity === 'warning' ||
              event.payload?.severity === 'critical'
                ? event.payload.severity
                : 'info',
            weatherSeverity:
              typeof event.payload?.weatherSeverity === 'string'
                ? event.payload.weatherSeverity
                : undefined,
            timestamp: new Date().toISOString(),
          })
          // 3) emit normalized events with posthog.capture in each flow below.
          posthog.capture(payload.event, payload.properties)
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
    return () => window.clearInterval(interval)
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
    posthog.capture(payload.event, payload.properties)
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
    posthog.capture(payload.event, payload.properties)
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

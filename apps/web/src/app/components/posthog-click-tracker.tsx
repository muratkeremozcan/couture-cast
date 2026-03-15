'use client'

import { useEffect } from 'react'
import { browserAnalytics } from '../../analytics/browser-analytics'

/** Story 0.7 support file: DOM attribute-based tracking wrapper.
 * This is the lightweight alternative to explicit typed track* wrappers for simple click instrumentation.
 * Tradeoff: fast adoption, but weaker schema guarantees and higher risk of property-name drift.
 * Flow refs:
 * - S0.7/T3/1: simple click instrumentation still feeds the shared Story 0.7 analytics surface.
 * - S0.7/T2/2: dataset keys are normalized to the same snake_case style used by the typed wrappers.
 */
function toSnakeCase(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

export function PostHogClickTracker() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      // Flow ref S0.7/T3/1: annotate clickable elements with data-ph-event and
      // data-ph-* attributes to opt into delegated analytics capture.
      const element = target?.closest<HTMLElement>('[data-ph-event]')
      if (!element) {
        return
      }

      const eventName = element.dataset.phEvent
      if (!eventName) {
        return
      }

      // Flow ref S0.7/T2/2: normalize dataset keys to snake_case before capture.
      const properties = Object.entries(element.dataset)
        .filter(([key, value]) => key.startsWith('ph') && key !== 'phEvent' && value)
        .reduce<Record<string, string>>((acc, [key, value]) => {
          acc[toSnakeCase(key.slice(2))] = value as string
          return acc
        }, {})

      browserAnalytics.capture(eventName, properties)
    }

    // Flow ref S0.7/T3/1: emit one delegated posthog.capture call from a
    // document-level click listener.
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  return null
}

'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'

/** Story 0.7 Task 2/3: DOM attribute-based tracking wrapper.
 * This is the lightweight alternative to explicit typed track* wrappers for simple click instrumentation.
 * Tradeoff: fast adoption, but weaker schema guarantees and higher risk of property-name drift.
 * Setup steps (where we did this):
 *   1) annotate clickable elements with data-ph-event and data-ph-* attributes.
 *   2) normalize dataset keys to snake_case before capture.
 *   3) emit one delegated posthog.capture call from a document-level click listener.
 */
function toSnakeCase(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

export function PostHogClickTracker() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      // 1) annotate clickable elements with data-ph-event and data-ph-* attributes.
      const element = target?.closest<HTMLElement>('[data-ph-event]')
      if (!element) {
        return
      }

      const eventName = element.dataset.phEvent
      if (!eventName) {
        return
      }

      // 2) normalize dataset keys to snake_case before capture.
      const properties = Object.entries(element.dataset)
        .filter(([key, value]) => key.startsWith('ph') && key !== 'phEvent' && value)
        .reduce<Record<string, string>>((acc, [key, value]) => {
          acc[toSnakeCase(key.slice(2))] = value as string
          return acc
        }, {})

      posthog.capture(eventName, properties)
    }

    // 3) emit one delegated posthog.capture call from a document-level click listener.
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  return null
}

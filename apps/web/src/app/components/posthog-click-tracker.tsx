'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'

function toSnakeCase(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

export function PostHogClickTracker() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const element = target?.closest<HTMLElement>('[data-ph-event]')
      if (!element) {
        return
      }

      const eventName = element.dataset.phEvent
      if (!eventName) {
        return
      }

      const properties = Object.entries(element.dataset)
        .filter(([key, value]) => key.startsWith('ph') && key !== 'phEvent' && value)
        .reduce<Record<string, string>>((acc, [key, value]) => {
          acc[toSnakeCase(key.slice(2))] = value as string
          return acc
        }, {})

      posthog.capture(eventName, properties)
    }

    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  return null
}

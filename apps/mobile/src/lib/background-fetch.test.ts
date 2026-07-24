import { describe, expect, it } from 'vitest'
import { isWidgetCacheFresh } from './widget-cache-freshness'

describe('widget background cache freshness', () => {
  const now = Date.parse('2026-07-24T18:00:00.000Z')

  it('accepts a cache entry inside the freshness window', () => {
    expect(isWidgetCacheFresh(now - 29 * 60 * 1000, now)).toBe(true)
  })

  it('expires a cache entry at the boundary', () => {
    expect(isWidgetCacheFresh(now - 30 * 60 * 1000, now)).toBe(false)
  })

  it('expires future and non-finite timestamps', () => {
    expect(isWidgetCacheFresh(now + 1, now)).toBe(false)
    expect(isWidgetCacheFresh(Number.NaN, now)).toBe(false)
  })
})

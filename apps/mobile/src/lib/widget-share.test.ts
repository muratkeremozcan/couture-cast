import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RitualResponse } from '@couture/api-client/contracts/http'
import { mockRitualResponse } from '../test-utils/msw/handlers'
import { createWidgetData, resolveWidgetScenario, shareWidgetData } from './widget-share'

function cloneRitual(): RitualResponse {
  return JSON.parse(JSON.stringify(mockRitualResponse)) as RitualResponse
}

describe('widget share serialization', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('serializes the complete localized payload with its source cache timestamp', async () => {
    const now = Date.parse('2026-07-24T17:30:00.000Z')
    const lastUpdated = now - 20 * 60 * 1000
    vi.setSystemTime(now)
    const ritual = cloneRitual()
    ritual.data.weather.timezone = 'America/Los_Angeles'
    ritual.data.weather.current.condition = 'clear'
    ritual.data.weather.hourly[0]!.forecastAt = '2026-07-24T18:00:00.000Z'
    ritual.data.weather.hourly[0]!.condition = 'rain'
    ritual.data.weather.hourly[0]!.precipitationProbability = 0.72

    await shareWidgetData(ritual, 'tr-TR', lastUpdated)

    const stored = localStorage.getItem('OutfitWidgetData')
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!) as Record<string, string>
    expect(parsed).toMatchObject({
      locale: 'tr-TR',
      currentConditionText: 'Açık',
      nowLabel: 'ŞİMDİ',
      nextHourLabel: 'SONRAKİ SAAT',
      staleLabel: 'Güncel değil',
      nextHourIcon: 'rain',
      lastUpdated: new Date(lastUpdated).toISOString(),
    })
    expect(parsed.currentTemp).toContain('°C')
    expect(parsed.nextHourTime).toBe('11:00')
    expect(parsed.nextHourPrecipitation).toContain('72')
  })

  it('selects the next future forecast after sorting and uses the location timezone', () => {
    const now = Date.parse('2026-07-24T17:30:00.000Z')
    const ritual = cloneRitual()
    ritual.data.weather.timezone = 'America/Los_Angeles'
    ritual.data.weather.hourly[0]!.forecastAt = '2026-07-24T19:00:00.000Z'
    ritual.data.weather.hourly[0]!.temperature = 30
    ritual.data.weather.hourly[1]!.forecastAt = '2026-07-24T18:00:00.000Z'
    ritual.data.weather.hourly[1]!.temperature = 24

    const widgetData = createWidgetData(ritual, 'en-US', now, now)

    expect(widgetData.nextHourTime).toBe('11:00 AM')
    expect(widgetData.nextHourTemp).toContain('75°F')
    expect(widgetData.nowOutfitSummary).toBe(
      'Mild morning with gentle winds. Trench coat recommended.'
    )
    expect(widgetData.nextOutfitSummary).toBe(
      'Warm and sunny midday. Light tee is perfect.'
    )
    expect(resolveWidgetScenario(ritual, 'now', now)).toBe('morning')
    expect(resolveWidgetScenario(ritual, 'next', now)).toBe('midday')
  })

  it('uses an honest empty next-hour state when no future forecast exists', () => {
    const now = Date.parse('2026-07-27T00:00:00.000Z')
    const ritual = cloneRitual()
    for (const hourly of ritual.data.weather.hourly) {
      hourly.forecastAt = '2026-07-26T00:00:00.000Z'
    }

    const widgetData = createWidgetData(ritual, 'en-US', now, now)

    expect(widgetData.nextHourTime).toBe('')
    expect(widgetData.nextHourTemp).toBe('')
    expect(widgetData.nextHourIcon).toBe('unknown')
    expect(widgetData.nextHourPrecipitation).toBe('')
  })
})

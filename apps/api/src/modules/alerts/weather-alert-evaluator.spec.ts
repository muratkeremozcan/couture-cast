import { describe, expect, it } from 'vitest'

import type { NormalizedWeatherForecast } from '../weather/providers/weather.types.js'
import {
  evaluateWeatherAlertRules,
  type WeatherAlertEvaluationRule,
} from './weather-alert-evaluator.js'

const fetchedAt = new Date('2026-07-13T14:00:00.000Z')

function buildForecast(
  overrides: Partial<NormalizedWeatherForecast> = {}
): NormalizedWeatherForecast {
  return {
    provider: 'openweather',
    locationKey: 'new-york-ny',
    locationName: 'New York',
    latitude: 40.7128,
    longitude: -74.006,
    timezone: 'America/New_York',
    providerUpdatedAt: fetchedAt,
    fetchedAt,
    current: {
      temperature: 20,
      feelsLike: 20,
      windSpeed: 2,
      humidity: 50,
      condition: 'clear',
      providerConditionText: 'clear sky',
      providerWeatherCode: '800',
    },
    hourly: Array.from({ length: 48 }, (_, index) => ({
      forecastAt: new Date(fetchedAt.getTime() + (index + 1) * 3_600_000),
      temperature: 20,
      feelsLike: 20,
      precipitationProbability: 0,
      precipitationAmount: 0,
      windSpeed: 2,
      windGust: 3,
      condition: 'clear' as const,
      providerConditionText: 'clear sky',
      providerWeatherCode: '800',
    })),
    alerts: [],
    ...overrides,
  }
}

function rule(
  ruleType: WeatherAlertEvaluationRule['ruleType'],
  threshold: number,
  enabled = true
): WeatherAlertEvaluationRule {
  return { ruleType, threshold, enabled }
}

describe('evaluateWeatherAlertRules', () => {
  it.each([
    { temperature: 31, direction: 'rise' },
    { temperature: 9, direction: 'drop' },
  ])('triggers for a strict temperature $direction over 24 hours', (sample) => {
    const forecast = buildForecast()
    forecast.hourly[5] = {
      ...forecast.hourly[5]!,
      temperature: sample.temperature,
    }

    const triggers = evaluateWeatherAlertRules(
      [rule('temperature', 10)],
      forecast,
      'New York'
    )

    expect(triggers).toHaveLength(1)
    expect(triggers[0]).toMatchObject({
      alertType: 'temperature',
      severity: 'warning',
    })
    expect(triggers[0]?.message).toContain(sample.direction)
  })

  it('does not trigger at the temperature threshold or beyond the first 24 hours', () => {
    const forecast = buildForecast()
    forecast.hourly[3] = { ...forecast.hourly[3]!, temperature: 30 }
    forecast.hourly[24] = { ...forecast.hourly[24]!, temperature: 40 }

    expect(
      evaluateWeatherAlertRules([rule('temperature', 10)], forecast, 'New York')
    ).toEqual([])
  })

  it.each(['rain', 'snow', 'sleet'] as const)(
    'triggers on the first dry-to-%s transition above the probability threshold',
    (condition) => {
      const forecast = buildForecast()
      forecast.hourly[2] = {
        ...forecast.hourly[2]!,
        condition,
        precipitationProbability: 0.61,
      }

      const triggers = evaluateWeatherAlertRules(
        [rule('precipitation', 0.6)],
        forecast,
        'New York'
      )

      expect(triggers).toHaveLength(1)
      expect(triggers[0]).toMatchObject({
        alertType: 'precipitation',
        severity: 'info',
      })
      expect(triggers[0]?.message).toContain(condition)
    }
  )

  it('requires a dry-to-wet transition strictly above the precipitation threshold', () => {
    const forecast = buildForecast({
      current: {
        ...buildForecast().current,
        condition: 'rain',
      },
    })
    forecast.hourly[0] = {
      ...forecast.hourly[0]!,
      condition: 'rain',
      precipitationProbability: 0.9,
    }
    forecast.hourly[1] = {
      ...forecast.hourly[1]!,
      condition: 'clear',
      precipitationProbability: 0,
    }
    forecast.hourly[2] = {
      ...forecast.hourly[2]!,
      condition: 'snow',
      precipitationProbability: 0.6,
    }

    expect(
      evaluateWeatherAlertRules([rule('precipitation', 0.6)], forecast, 'New York')
    ).toEqual([])
  })

  it('triggers a severe alert at the configured provider severity threshold', () => {
    const forecast = buildForecast({
      alerts: [
        {
          event: 'Tornado warning',
          description: 'Take shelter now.',
          start: fetchedAt,
          end: new Date(fetchedAt.getTime() + 3_600_000),
          severity: 'high',
        },
      ],
    })

    expect(evaluateWeatherAlertRules([rule('severe', 3)], forecast, 'New York')).toEqual([
      {
        alertType: 'severe',
        fingerprint: 'severe:tornado warning',
        severity: 'critical',
        message: 'Tornado warning for New York: Take shelter now.',
      },
    ])
  })

  it('selects the highest-severity eligible provider alert as one coherent alert', () => {
    const forecast = buildForecast({
      alerts: [
        {
          event: 'Flood advisory',
          description: 'Use caution near low areas.',
          start: fetchedAt,
          end: new Date(fetchedAt.getTime() + 3_600_000),
          severity: 'low',
        },
        {
          event: 'Tornado warning',
          description: 'Take shelter now.',
          start: fetchedAt,
          end: new Date(fetchedAt.getTime() + 3_600_000),
          severity: 'high',
        },
        {
          event: 'Severe thunderstorm watch',
          description: 'Monitor local conditions.',
          start: fetchedAt,
          end: new Date(fetchedAt.getTime() + 3_600_000),
          severity: 'medium',
        },
      ],
    })

    expect(evaluateWeatherAlertRules([rule('severe', 2)], forecast, 'New York')).toEqual([
      {
        alertType: 'severe',
        fingerprint: 'severe:tornado warning',
        severity: 'critical',
        message: 'Tornado warning for New York: Take shelter now.',
      },
    ])
  })

  it('filters severe alerts below the configured minimum severity', () => {
    const forecast = buildForecast({
      alerts: [
        {
          event: 'Flood advisory',
          description: 'Use caution near low areas.',
          start: fetchedAt,
          end: new Date(fetchedAt.getTime() + 3_600_000),
          severity: 'low',
        },
        {
          event: 'Severe thunderstorm watch',
          description: 'Monitor local conditions.',
          start: fetchedAt,
          end: new Date(fetchedAt.getTime() + 3_600_000),
          severity: 'medium',
        },
      ],
    })

    expect(evaluateWeatherAlertRules([rule('severe', 3)], forecast, 'New York')).toEqual(
      []
    )
    expect(evaluateWeatherAlertRules([rule('severe', 2)], forecast, 'New York')).toEqual([
      {
        alertType: 'severe',
        fingerprint: 'severe:severe thunderstorm watch',
        severity: 'warning',
        message: 'Severe thunderstorm watch for New York: Monitor local conditions.',
      },
    ])
  })

  it('treats an unclassified provider warning conservatively as high severity', () => {
    const forecast = buildForecast({
      alerts: [
        {
          event: 'Provider warning',
          description: 'Follow official instructions.',
          start: fetchedAt,
          end: new Date(fetchedAt.getTime() + 3_600_000),
        },
      ],
    })

    expect(evaluateWeatherAlertRules([rule('severe', 3)], forecast, 'New York')).toEqual([
      {
        alertType: 'severe',
        fingerprint: 'severe:provider warning',
        severity: 'critical',
        message: 'Provider warning for New York: Follow official instructions.',
      },
    ])
  })

  it('ignores disabled rules and malformed persisted thresholds', () => {
    const forecast = buildForecast({
      alerts: [
        {
          event: 'Flood warning',
          description: 'Avoid low areas.',
          start: fetchedAt,
          end: new Date(fetchedAt.getTime() + 3_600_000),
        },
      ],
    })
    forecast.hourly[0] = { ...forecast.hourly[0]!, temperature: 40 }

    expect(
      evaluateWeatherAlertRules(
        [
          rule('temperature', Number.NaN),
          rule('precipitation', 2),
          rule('severe', 2.5),
          rule('severe', 3, false),
        ],
        forecast,
        'New York'
      )
    ).toEqual([])
  })
})

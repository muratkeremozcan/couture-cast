// Learning path Step 16: Weather API ingestion service and durable worker ingestion.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-16-weather-api-ingestion-service-and-durable-worker-ingestion
import { describe, expect, it } from 'vitest'
import {
  mapOpenWeatherCondition,
  mapWeatherApiAlertSeverity,
  mapWeatherApiCondition,
} from './weather-condition.mapper.js'

describe('weather condition mapping', () => {
  it.each([
    [800, 'clear'],
    [801, 'partly_cloudy'],
    [804, 'cloudy'],
    [502, 'rain'],
    [511, 'sleet'],
    [611, 'sleet'],
    [601, 'snow'],
    [741, 'fog'],
    [211, 'thunderstorm'],
  ] as const)('maps OpenWeather code %i to %s', (code, expected) => {
    expect(mapOpenWeatherCondition(code)).toBe(expected)
  })

  it.each([
    [1000, 'clear'],
    [1003, 'partly_cloudy'],
    [1009, 'cloudy'],
    [1189, 'rain'],
    [1204, 'sleet'],
    [1237, 'sleet'],
    [1264, 'sleet'],
    [1219, 'snow'],
    [1135, 'fog'],
    [1276, 'thunderstorm'],
  ] as const)('maps WeatherAPI code %i to %s', (code, expected) => {
    expect(mapWeatherApiCondition(code)).toBe(expected)
  })

  it.each([
    ['Minor', 'low'],
    ['Moderate', 'medium'],
    ['Severe', 'high'],
    ['Extreme', 'high'],
    ['Unknown', undefined],
  ] as const)('maps WeatherAPI alert severity %s to %s', (severity, expected) => {
    expect(mapWeatherApiAlertSeverity(severity)).toBe(expected)
  })

  it.each([
    [771, 'wind'],
    [781, 'wind'],
    [321, 'drizzle'],
    [701, 'fog'],
    [762, 'fog'],
    // 771/781 are handled as wind above, so the 7xx group falls through here.
    [799, 'unknown'],
    [802, 'cloudy'],
    [805, 'unknown'],
    [900, 'unknown'],
    [100, 'unknown'],
  ] as const)('maps unusual OpenWeather code %i to %s', (code, expected) => {
    expect(mapOpenWeatherCondition(code)).toBe(expected)
  })

  it.each([
    [1153, 'drizzle'],
    [1063, 'rain'],
    [9999, 'unknown'],
  ] as const)('maps unusual WeatherAPI code %i to %s', (code, expected) => {
    expect(mapWeatherApiCondition(code)).toBe(expected)
  })

  it('returns undefined when a WeatherAPI alert carries no severity', () => {
    // An absent severity must stay absent rather than defaulting to a level.
    expect(mapWeatherApiAlertSeverity(undefined)).toBeUndefined()
  })

  it('normalises whitespace and casing around a severity label', () => {
    expect(mapWeatherApiAlertSeverity('  SEVERE  ')).toBe('high')
  })
})

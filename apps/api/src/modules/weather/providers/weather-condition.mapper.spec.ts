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
})

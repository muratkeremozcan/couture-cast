import { describe, expect, it } from 'vitest'

import { ConfiguredWeatherTargetSource } from './weather-target-source.js'

describe('ConfiguredWeatherTargetSource', () => {
  it('loads validated non-personal bootstrap targets from weather configuration', async () => {
    const source = new ConfiguredWeatherTargetSource({
      WEATHER_INGESTION_TARGETS_JSON: JSON.stringify([
        { locationKey: 'new-york-ny', latitude: 40.7128, longitude: -74.006 },
      ]),
    })

    await expect(source.getTargets()).resolves.toEqual([
      { locationKey: 'new-york-ny', latitude: 40.7128, longitude: -74.006 },
    ])
  })

  it('rejects duplicate configured canonical location keys', async () => {
    const source = new ConfiguredWeatherTargetSource({
      WEATHER_INGESTION_TARGETS_JSON: JSON.stringify([
        { locationKey: 'new-york-ny', latitude: 40.7128, longitude: -74.006 },
        { locationKey: 'new-york-ny', latitude: 41, longitude: -75 },
      ]),
    })

    await expect(source.getTargets()).rejects.toThrow(
      'Invalid weather configuration: WEATHER_INGESTION_TARGETS_JSON'
    )
  })
})

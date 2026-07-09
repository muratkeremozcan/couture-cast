import { describe, expect, it } from 'vitest'

import {
  CombinedWeatherTargetSource,
  ConfiguredWeatherTargetSource,
  SavedLocationWeatherTargetSource,
} from './weather-target-source.js'

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

describe('CombinedWeatherTargetSource', () => {
  it('deduplicates targets across saved and configured sources in source order', async () => {
    const source = new CombinedWeatherTargetSource([
      {
        getTargets: () =>
          Promise.resolve([
            { locationKey: 'chicago-il', latitude: 41.878, longitude: -87.63 },
          ]),
      },
      {
        getTargets: () =>
          Promise.resolve([
            { locationKey: 'chicago-il', latitude: 41.879, longitude: -87.631 },
            { locationKey: 'new-york-ny', latitude: 40.713, longitude: -74.006 },
          ]),
      },
    ])

    await expect(source.getTargets()).resolves.toEqual([
      { locationKey: 'chicago-il', latitude: 41.878, longitude: -87.63 },
      { locationKey: 'new-york-ny', latitude: 40.713, longitude: -74.006 },
    ])
  })
})

describe('SavedLocationWeatherTargetSource', () => {
  it('returns unique primary saved locations as weather ingestion targets', async () => {
    const prisma = {
      savedLocation: {
        findMany: () =>
          Promise.resolve([
            {
              location_key: 'chicago-il',
              latitude: 41.878,
              longitude: -87.63,
            },
            {
              location_key: 'new-york-ny',
              latitude: 40.713,
              longitude: -74.006,
            },
            {
              location_key: 'chicago-il',
              latitude: 41.879,
              longitude: -87.631,
            },
          ]),
      },
    }
    const source = new SavedLocationWeatherTargetSource(prisma as never)

    await expect(source.getTargets()).resolves.toEqual([
      { locationKey: 'chicago-il', latitude: 41.878, longitude: -87.63 },
      { locationKey: 'new-york-ny', latitude: 40.713, longitude: -74.006 },
    ])
  })
})

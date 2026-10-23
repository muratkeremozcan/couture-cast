import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  startWeatherProviderDouble,
  type WeatherProviderDouble,
} from '../../../../../../scripts/weather-provider-double.mjs'
import { OpenWeatherGeocodingClient } from './openweather-geocoding.client'
import { WeatherProviderError } from './weather-provider.error'
import { WeatherApiGeocodingClient } from './weatherapi-geocoding.client'

let double: WeatherProviderDouble

beforeAll(async () => {
  double = await startWeatherProviderDouble()
})

afterAll(async () => {
  await double.close()
})

function openWeather(apiKey = 'test-key') {
  return new OpenWeatherGeocodingClient({
    apiKey,
    env: { TEST_ENV: 'local', OPENWEATHER_API_ORIGIN: double.origin },
  })
}

function weatherApi(apiKey = 'test-key') {
  return new WeatherApiGeocodingClient({
    apiKey,
    env: { TEST_ENV: 'local', WEATHERAPI_API_ORIGIN: double.origin },
  })
}

const signal = () => AbortSignal.timeout(3000)

describe('OpenWeatherGeocodingClient', () => {
  it('1.2b-UNIT-GEO-01 maps default name, state, ISO country, rounded coordinates and local name', async () => {
    const [chicago] = await openWeather().search('Chicago', 'ja', signal())

    expect(chicago).toEqual({
      city: 'Chicago',
      region: 'Illinois',
      country: 'US',
      latitude: 41.878,
      longitude: -87.63,
      localizedName: 'シカゴ',
    })
  })

  it('1.2b-UNIT-GEO-02 keeps the default name for every display language', async () => {
    const [ja] = await openWeather().search('Moscow', 'ja', signal())
    const [en] = await openWeather().search('Moscow', 'en', signal())

    expect(ja?.city).toBe('Moscow')
    expect(en?.city).toBe('Moscow')
    expect(ja?.localizedName).toBe('モスクワ')
  })

  it('1.2b-UNIT-GEO-03 leaves region null when the provider omits state', async () => {
    const [monaco] = await openWeather().search('Monaco', 'en', signal())

    expect(monaco).toMatchObject({ city: 'Monaco', region: null, country: 'MC' })
  })

  it('1.2b-UNIT-GEO-04 returns every same-name candidate, at most five', async () => {
    const places = await openWeather().search('Springfield', 'en', signal())

    expect(places.map((place) => place.region)).toEqual(['Illinois', 'Missouri'])
  })

  it('1.2b-UNIT-GEO-05 classifies provider failure, timeout and a missing key', async () => {
    await expect(
      openWeather().search('Provider down', 'en', signal())
    ).rejects.toMatchObject({
      kind: 'retryable_http',
    })
    await expect(
      openWeather().search('Provider slow', 'en', AbortSignal.timeout(50))
    ).rejects.toMatchObject({ kind: 'timeout' })
    await expect(
      openWeather('').search('Chicago', 'en', signal())
    ).rejects.toBeInstanceOf(WeatherProviderError)
  })
})

describe('WeatherApiGeocodingClient', () => {
  it('1.2b-UNIT-GEO-06 resolves English country names to ISO codes', async () => {
    const [istanbul] = await weatherApi().search('Istanbul', 'tr', signal())

    expect(istanbul).toEqual({
      city: 'İstanbul',
      region: 'İstanbul',
      country: 'TR',
      latitude: 41.008,
      longitude: 28.978,
      localizedName: null,
    })
  })

  it('1.2b-UNIT-GEO-07 drops a candidate whose country resolves to no ISO code', async () => {
    expect(await weatherApi().search('Atlantis', 'en', signal())).toEqual([])
  })

  it('1.2b-UNIT-GEO-08 turns an empty region into null', async () => {
    const [monaco] = await weatherApi().search('Monaco', 'en', signal())

    expect(monaco?.region).toBeNull()
  })

  it('1.2b-UNIT-GEO-09 refuses to call without a key', async () => {
    await expect(weatherApi('').search('Chicago', 'en', signal())).rejects.toMatchObject({
      kind: 'invalid_configuration',
    })
  })
})

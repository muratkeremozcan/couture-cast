import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  startWeatherProviderDouble,
  type WeatherProviderDouble,
} from '../../../../../../scripts/weather-provider-double.mjs'
import { OpenWeatherGeocodingClient } from './openweather-geocoding.client'
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
    // A keyless request must never leave: the double would answer 401 and
    // the outcome would read as an outage, not a configuration error.
    const before = double.stats.geocoding
    await expect(openWeather('').search('Chicago', 'en', signal())).rejects.toMatchObject(
      {
        kind: 'invalid_configuration',
      }
    )
    expect(double.stats.geocoding).toBe(before)
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

/**
 * Response validation, fed through a stubbed fetch: the double slices results
 * to five and only serves well-formed bodies, so it cannot reach these paths.
 */
describe('geocoding response validation', () => {
  const requested: URL[] = []

  function respondWith(body: string) {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      requested.push(new URL(input instanceof Request ? input.url : String(input)))
      return Promise.resolve(new Response(body, { status: 200 }))
    })
  }

  const openWeatherEntry = (overrides: Record<string, unknown> = {}) => ({
    name: 'Springfield',
    lat: 39.782,
    lon: -89.65,
    country: 'US',
    state: 'Illinois',
    ...overrides,
  })
  const weatherApiEntry = (overrides: Record<string, unknown> = {}) => ({
    name: 'Springfield',
    region: 'Illinois',
    country: 'United States of America',
    lat: 39.782,
    lon: -89.65,
    ...overrides,
  })

  afterEach(() => {
    requested.length = 0
    vi.restoreAllMocks()
  })

  it('1.2b-UNIT-GEO-10 returns at most five candidates from either provider', async () => {
    const seven = (entry: (o: Record<string, unknown>) => object) =>
      JSON.stringify(Array.from({ length: 7 }, (_, index) => entry({ lat: 30 + index })))

    respondWith(seven(openWeatherEntry))
    expect(await openWeather().search('Springfield', 'en', signal())).toHaveLength(5)
    expect(requested[0]?.searchParams.get('limit')).toBe('5')

    respondWith(seven(weatherApiEntry))
    expect(await weatherApi().search('Springfield', 'en', signal())).toHaveLength(5)
  })

  it.each([
    ['a non-list body', '{}'],
    ['malformed JSON', 'not json'],
  ])('1.2b-UNIT-GEO-11 answers %s with invalid_response', async (_case, body) => {
    for (const client of [openWeather(), weatherApi()]) {
      respondWith(body)
      await expect(client.search('Springfield', 'en', signal())).rejects.toMatchObject({
        kind: 'invalid_response',
      })
    }
  })

  it('1.2b-UNIT-GEO-12 skips an invalid entry and keeps its valid siblings', async () => {
    respondWith(JSON.stringify([openWeatherEntry(), openWeatherEntry({ lat: 999 })]))
    expect(await openWeather().search('Springfield', 'en', signal())).toEqual([
      expect.objectContaining({ city: 'Springfield', latitude: 39.782 }),
    ])

    respondWith(JSON.stringify([weatherApiEntry({ lon: 999 }), weatherApiEntry()]))
    expect(await weatherApi().search('Springfield', 'en', signal())).toEqual([
      expect.objectContaining({ city: 'Springfield', longitude: -89.65 }),
    ])
  })

  it('1.2b-UNIT-GEO-13 drops an unmapped OpenWeather country and upper-cases a lowercase one', async () => {
    respondWith(
      JSON.stringify([
        openWeatherEntry({ country: 'XX' }),
        openWeatherEntry({ country: 'us', lat: 37.209 }),
      ])
    )

    expect(await openWeather().search('Springfield', 'en', signal())).toEqual([
      expect.objectContaining({ country: 'US', latitude: 37.209 }),
    ])
  })
})

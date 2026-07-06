import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getOpenWeatherSuccessFixture,
  OPENWEATHER_FAILURE_FIXTURES,
  OPENWEATHER_MISSING_FIELDS_FIXTURE,
} from './fixtures/openweather.fixtures.js'
import { WeatherProviderError } from './weather-provider.error.js'
import { OpenWeatherProvider } from './openweather.provider.js'

const target = {
  locationKey: 'nyc',
  latitude: 40.71281,
  longitude: -74.00599,
}
const signal = new AbortController().signal

function responseWith(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response
}

function calledUrl(): URL {
  const input = vi.mocked(globalThis.fetch).mock.calls[0]?.[0]
  if (input instanceof URL) return input
  if (typeof input === 'string') return new URL(input)
  throw new Error('Expected fetch to be called with a URL')
}

describe('OpenWeatherProvider', () => {
  let provider: OpenWeatherProvider
  const apiKey = 'test-api-key'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T13:30:00Z'))
    provider = new OpenWeatherProvider({ apiKey, env: {} })
    vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('fetches and normalizes exactly 48 metric hourly entries', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(getOpenWeatherSuccessFixture(target.latitude, target.longitude))
    )

    const result = await provider.fetchForecast(target, signal)
    const url = calledUrl()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(url.searchParams.get('lat')).toBe('40.7128')
    expect(url.searchParams.get('lon')).toBe('-74.006')
    expect(url.searchParams.get('units')).toBe('metric')
    expect(url.searchParams.get('exclude')).toBe('minutely,daily')
    expect(url.searchParams.get('appid')).toBe(apiKey)
    expect(result).toMatchObject({
      provider: 'openweather',
      locationKey: 'nyc',
      latitude: 40.7128,
      longitude: -74.006,
      timezone: 'America/New_York',
      current: {
        temperature: 21.5,
        feelsLike: 21,
        condition: 'clear',
        providerConditionText: 'clear sky',
        providerWeatherCode: '800',
        windSpeed: 4,
        humidity: 55,
      },
    })
    expect(result.hourly).toHaveLength(48)
    expect(result.hourly[0]).toMatchObject({
      temperature: 20,
      feelsLike: 19,
      precipitationProbability: 0.1,
      precipitationAmount: 0,
      windSpeed: 3.5,
      windGust: 4.5,
      condition: 'partly_cloudy',
      providerConditionText: 'few clouds',
      providerWeatherCode: '801',
    })
    expect(
      result.hourly[1]!.forecastAt.getTime() - result.hourly[0]!.forecastAt.getTime()
    ).toBe(3600000)
    expect(result.alerts).toHaveLength(1)
  })

  it('keeps the response-arrival hour when JSON parsing crosses an hour boundary', async () => {
    vi.setSystemTime(new Date('2026-07-06T13:59:59Z'))
    const fixture = getOpenWeatherSuccessFixture(target.latitude, target.longitude)
    const json = vi.fn().mockImplementation(() => {
      vi.setSystemTime(new Date('2026-07-06T14:00:01Z'))
      return Promise.resolve(fixture)
    })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json,
    } as unknown as Response)

    const result = await provider.fetchForecast(target, signal)

    expect(result.hourly).toHaveLength(48)
    expect(result.fetchedAt).toEqual(new Date('2026-07-06T13:59:59Z'))
  })

  it('requires a configured API key', async () => {
    const noKeyProvider = new OpenWeatherProvider({ env: {} })

    await expect(noKeyProvider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_configuration',
    })
  })

  it('classifies 429 as a rate-limit failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(null, OPENWEATHER_FAILURE_FIXTURES.rateLimit.status)
    )

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'rate_limit',
      statusCode: 429,
    })
  })

  it('classifies 5xx as retryable', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(null, OPENWEATHER_FAILURE_FIXTURES.serverError.status)
    )

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'retryable_http',
      statusCode: 503,
    })
  })

  it('classifies HTTP 408 as retryable', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(responseWith(null, 408))

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'retryable_http',
      statusCode: 408,
    })
  })

  it('classifies timeout without exposing the key or coordinates', async () => {
    const fixture = OPENWEATHER_FAILURE_FIXTURES.timeout
    const timeoutError = Object.assign(
      new Error(`${fixture.message} ${apiKey} 40.7128`),
      {
        name: fixture.name,
      }
    )
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(timeoutError)

    const error = await provider
      .fetchForecast(target, signal)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(WeatherProviderError)
    expect(error).toMatchObject({ kind: 'timeout' })
    expect(String(error)).not.toContain(apiKey)
    expect(String(error)).not.toContain('40.7128')
  })

  it('classifies malformed JSON as an invalid response', async () => {
    const json = vi
      .fn()
      .mockRejectedValueOnce(new SyntaxError(OPENWEATHER_FAILURE_FIXTURES.malformed.body))
    const malformedResponse = { ok: true, status: 200, json } as unknown as Response
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(malformedResponse)

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })

  it('preserves cancellation while consuming the response body', async () => {
    const controller = new AbortController()
    controller.abort()
    const json = vi.fn().mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json,
    } as unknown as Response)

    await expect(provider.fetchForecast(target, controller.signal)).rejects.toMatchObject(
      {
        kind: 'aborted',
      }
    )
  })

  it('rejects responses missing required fields', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(OPENWEATHER_MISSING_FIELDS_FIXTURE)
    )

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })

  it('rejects duplicate hourly horizons even when 48 unique hours remain', async () => {
    const fixture = getOpenWeatherSuccessFixture(target.latitude, target.longitude)
    fixture.hourly.push({
      ...fixture.hourly[47]!,
      dt: fixture.hourly[47]!.dt + 3600,
    })
    fixture.hourly.push({ ...fixture.hourly[0]! })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(responseWith(fixture))

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })

  it('rejects a contiguous horizon that begins after the next hour', async () => {
    const fixture = getOpenWeatherSuccessFixture(target.latitude, target.longitude)
    fixture.hourly.forEach((hour) => {
      hour.dt += 2 * 3600
    })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(responseWith(fixture))

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })

  it('accepts stale current conditions', async () => {
    const fixture = getOpenWeatherSuccessFixture(target.latitude, target.longitude)
    fixture.current.dt -= 2 * 3600
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(responseWith(fixture))

    const result = await provider.fetchForecast(target, signal)
    expect(result).toBeDefined()
    expect(result.providerUpdatedAt).toEqual(new Date(fixture.current.dt * 1000))
  })

  it('rejects invalid targets before making a request', async () => {
    await expect(
      provider.fetchForecast({ ...target, latitude: Number.NaN }, signal)
    ).rejects.toMatchObject({ kind: 'invalid_target' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('encodes credentials and preserves existing base URL parameters', async () => {
    const encodedProvider = new OpenWeatherProvider({
      apiKey: 'key&with=special+characters',
      baseUrl: 'https://weather.test/onecall?existing=true',
      env: {},
    })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(getOpenWeatherSuccessFixture(target.latitude, target.longitude))
    )

    await encodedProvider.fetchForecast(target, signal)
    const url = calledUrl()

    expect(url.searchParams.get('appid')).toBe('key&with=special+characters')
    expect(url.searchParams.get('existing')).toBe('true')
  })

  it('rejects a response for a different location', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(getOpenWeatherSuccessFixture(10, 10))
    )

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })

  it('accepts equivalent longitudes across the antimeridian', async () => {
    const datelineTarget = { locationKey: 'dateline', latitude: 0, longitude: 179.995 }
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(getOpenWeatherSuccessFixture(0, -179.995))
    )

    await expect(provider.fetchForecast(datelineTarget, signal)).resolves.toMatchObject({
      locationKey: 'dateline',
      longitude: 179.995,
    })
  })

  it('rejects invalid provider timezones', async () => {
    const fixture = getOpenWeatherSuccessFixture(target.latitude, target.longitude)
    fixture.timezone = 'Not/A_Timezone'
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(responseWith(fixture))

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })

  it('classifies an invalid base URL as configuration failure', async () => {
    const invalidProvider = new OpenWeatherProvider({
      apiKey,
      baseUrl: 'not a URL',
      env: {},
    })

    await expect(invalidProvider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_configuration',
    })
  })
})

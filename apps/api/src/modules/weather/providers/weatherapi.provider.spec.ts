import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getWeatherApiSuccessFixture,
  WEATHERAPI_FAILURE_FIXTURES,
  WEATHERAPI_MISSING_FIELDS_FIXTURE,
} from './fixtures/weatherapi.fixtures.js'
import { WeatherProviderError } from './weather-provider.error.js'
import { WeatherApiProvider } from './weatherapi.provider.js'

const target = {
  locationKey: 'nyc',
  locationName: 'New York',
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

describe('WeatherApiProvider', () => {
  let provider: WeatherApiProvider
  const apiKey = 'test-weather-api-key'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T13:30:00Z'))
    provider = new WeatherApiProvider({ apiKey, env: {} })
    vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('fetches and normalizes exactly 48 metric hourly entries', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(getWeatherApiSuccessFixture(target.latitude, target.longitude))
    )

    const result = await provider.fetchForecast(target, signal)
    const url = calledUrl()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(url.searchParams.get('q')).toBe('40.7128,-74.006')
    expect(url.searchParams.get('days')).toBe('3')
    expect(url.searchParams.get('aqi')).toBe('no')
    expect(url.searchParams.get('alerts')).toBe('yes')
    expect(url.searchParams.get('key')).toBe(apiKey)
    expect(result).toMatchObject({
      provider: 'weatherapi',
      locationKey: 'nyc',
      locationName: 'New York',
      latitude: 40.7128,
      longitude: -74.006,
      timezone: 'America/New_York',
      current: {
        temperature: 21.5,
        feelsLike: 21,
        condition: 'partly_cloudy',
        providerConditionText: 'Partly cloudy',
        providerWeatherCode: '1003',
        humidity: 55,
      },
    })
    expect(result.current.windSpeed).toBeCloseTo(14.3 / 3.6, 4)
    expect(result.hourly).toHaveLength(48)
    expect(result.hourly[0]).toMatchObject({
      temperature: 20,
      feelsLike: 19,
      precipitationProbability: 0.1,
      precipitationAmount: 0,
      condition: 'clear',
      providerConditionText: 'Sunny',
      providerWeatherCode: '1000',
    })
    expect(result.hourly[0]!.windSpeed).toBeCloseTo(10.8 / 3.6, 4)
    expect(result.hourly[0]!.windGust).toBeCloseTo(14.3 / 3.6, 4)
    expect(result.alerts).toEqual([
      expect.objectContaining({
        event: 'Flood Advisory',
        severity: 'medium',
      }),
    ])
  })

  it('requires a configured API key', async () => {
    const noKeyProvider = new WeatherApiProvider({ env: {} })

    await expect(noKeyProvider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_configuration',
    })
  })

  it('classifies 429 as a rate-limit failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(null, WEATHERAPI_FAILURE_FIXTURES.rateLimit.status)
    )

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'rate_limit',
      statusCode: 429,
    })
  })

  it('classifies 5xx as retryable', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(null, WEATHERAPI_FAILURE_FIXTURES.serverError.status)
    )

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'retryable_http',
      statusCode: 503,
    })
  })

  it('classifies timeout without exposing the key or coordinates', async () => {
    const fixture = WEATHERAPI_FAILURE_FIXTURES.timeout
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
      .mockRejectedValueOnce(new SyntaxError(WEATHERAPI_FAILURE_FIXTURES.malformed.body))
    const malformedResponse = { ok: true, status: 200, json } as unknown as Response
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(malformedResponse)

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })

  it('preserves timeout classification while consuming the response body', async () => {
    const controller = new AbortController()
    const timeoutReason = new DOMException('deadline', 'TimeoutError')
    controller.abort(timeoutReason)
    const json = vi.fn().mockRejectedValueOnce(timeoutReason)
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json,
    } as unknown as Response)

    await expect(provider.fetchForecast(target, controller.signal)).rejects.toMatchObject(
      {
        kind: 'timeout',
      }
    )
  })

  it('rejects responses missing required fields', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(WEATHERAPI_MISSING_FIELDS_FIXTURE)
    )

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })

  it('rejects historical hourly data instead of backfilling it', async () => {
    const fixture = getWeatherApiSuccessFixture(target.latitude, target.longitude)
    fixture.forecast.forecastday.forEach((day) => {
      day.hour.forEach((hour, index) => {
        hour.time_epoch = 1_700_000_000 + index * 3600
      })
    })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(responseWith(fixture))

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })

  it('rejects incomplete future hourly horizons', async () => {
    const fixture = getWeatherApiSuccessFixture(target.latitude, target.longitude)
    fixture.forecast.forecastday = fixture.forecast.forecastday.slice(0, 2)
    fixture.forecast.forecastday[1]!.hour.pop()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(responseWith(fixture))

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })

  it('rejects duplicate hourly horizons even when 48 unique hours remain', async () => {
    const fixture = getWeatherApiSuccessFixture(target.latitude, target.longitude)
    fixture.forecast.forecastday[2]!.hour.push({
      ...fixture.forecast.forecastday[2]!.hour[23]!,
      time_epoch: fixture.forecast.forecastday[2]!.hour[23]!.time_epoch + 3600,
    })
    fixture.forecast.forecastday[2]!.hour.push({
      ...fixture.forecast.forecastday[0]!.hour[0]!,
    })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(responseWith(fixture))

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })

  it('rejects a contiguous horizon that begins after the next hour', async () => {
    const fixture = getWeatherApiSuccessFixture(target.latitude, target.longitude)
    fixture.forecast.forecastday.forEach((day) => {
      day.hour.forEach((hour) => {
        hour.time_epoch += 2 * 3600
      })
    })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(responseWith(fixture))

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })

  it('rejects invalid targets before making a request', async () => {
    await expect(
      provider.fetchForecast({ ...target, longitude: 181 }, signal)
    ).rejects.toMatchObject({ kind: 'invalid_target' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('encodes credentials and preserves existing base URL parameters', async () => {
    const encodedProvider = new WeatherApiProvider({
      apiKey: 'key&with=special+characters',
      baseUrl: 'https://weather.test/forecast.json?existing=true',
      env: {},
    })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(getWeatherApiSuccessFixture(target.latitude, target.longitude))
    )

    await encodedProvider.fetchForecast(target, signal)
    const url = calledUrl()

    expect(url.searchParams.get('key')).toBe('key&with=special+characters')
    expect(url.searchParams.get('existing')).toBe('true')
  })

  it('rejects a response for a different location', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      responseWith(getWeatherApiSuccessFixture(10, 10))
    )

    await expect(provider.fetchForecast(target, signal)).rejects.toMatchObject({
      kind: 'invalid_response',
    })
  })
})

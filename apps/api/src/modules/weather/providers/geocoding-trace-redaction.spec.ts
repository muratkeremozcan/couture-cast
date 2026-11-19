// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), Codex review 1 finding 1: Use my location asks the weather
// provider about the member's rounded position in a GET query (OpenWeather lat/lon, WeatherAPI
// q=lat,lon), next to the provider key. The provider has to see it; our traces must not. This
// drives the real geocoding clients, in both provider modes, through the undici instrumentation
// the API's SDK options register (createOpenTelemetrySdkOptions in instrumentation.ts) against
// the weather provider double, on success and on a provider failure, and reads every span
// attribute, event and status message.
import type { Instrumentation } from '@opentelemetry/instrumentation'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  REVERSE_DOWN_COORDINATE,
  startWeatherProviderDouble,
  type WeatherProviderDouble,
} from '../../../../../../scripts/weather-provider-double.mjs'
import { createOpenTelemetrySdkOptions } from '../../../instrumentation'
import { OpenWeatherGeocodingClient } from './openweather-geocoding.client'
import { WeatherApiGeocodingClient } from './weatherapi-geocoding.client'

const KEY = 'trace-secret-key'
const ROUNDED = { latitude: 41.88, longitude: -87.63 }
/** Anything of the request's query: the separator, its names, the key, the position. */
const QUERY_TEXT = new RegExp(
  [
    '\\?',
    'appid',
    'key=',
    'lat=',
    'lon=',
    'q=',
    KEY,
    '41\\.88',
    '87\\.63',
    '7\\.77',
  ].join('|')
)

const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
let instrumentations: Instrumentation[] = []
let double: WeatherProviderDouble

/** Every string a span would export: attributes, event attributes and names, status. */
function exportedText(span: ReadableSpan): string[] {
  return [
    span.name,
    span.status.message ?? '',
    ...Object.entries(span.attributes).map(([key, value]) => `${key}=${String(value)}`),
    ...span.events.flatMap((event) => [
      event.name,
      ...Object.entries(event.attributes ?? {}).map(
        ([key, value]) => `${key}=${String(value)}`
      ),
    ]),
  ]
}

function leaks(): string[] {
  return exporter
    .getFinishedSpans()
    .flatMap((span) => exportedText(span).filter((text) => QUERY_TEXT.test(text)))
}

const signal = () => AbortSignal.timeout(5_000)

beforeAll(async () => {
  double = await startWeatherProviderDouble()
  // The instrumentations the deployed API registers: the SDK options initializeOpenTelemetry
  // starts with when OTLP export is configured, not a hand-built list.
  const options = createOpenTelemetrySdkOptions({
    GRAFANA_OTLP_ENDPOINT: 'https://otlp.example.test/otlp',
    GRAFANA_API_KEY: 'trace-test',
    GRAFANA_INSTANCE_ID: '1',
  })
  if (!options?.instrumentations)
    throw new Error('OTLP export registers no instrumentations')
  instrumentations = options.instrumentations.flat()
  for (const each of instrumentations) each.disable()
  const undici = instrumentations.find(
    (each) => each.instrumentationName === '@opentelemetry/instrumentation-undici'
  )
  if (!undici) throw new Error('The API registers no undici instrumentation')
  undici.setTracerProvider(provider)
  undici.enable()
})

afterAll(async () => {
  for (const each of instrumentations) each.disable()
  await double.close()
  await provider.shutdown()
})

beforeEach(() => {
  exporter.reset()
})

describe('reverse geocoding traces carry no query', () => {
  const clients = {
    openweather: () =>
      new OpenWeatherGeocodingClient({
        apiKey: KEY,
        env: { OPENWEATHER_API_ORIGIN: double.origin },
      }),
    weatherapi: () =>
      new WeatherApiGeocodingClient({
        apiKey: KEY,
        env: { WEATHERAPI_API_ORIGIN: double.origin },
      }),
  }

  it.each(Object.keys(clients) as (keyof typeof clients)[])(
    'GEO-TRACE-01 %s: a reverse lookup reaches the provider with the position, and its span has no query',
    async (mode) => {
      const places = await clients[mode]().reverse(
        ROUNDED.latitude,
        ROUNDED.longitude,
        'en',
        signal()
      )
      await provider.forceFlush()

      // The provider did get the rounded position (the transport is real), and it found Chicago.
      expect(places.map((place) => place.city)).toEqual(['Chicago'])
      expect(double.requests.geocoding.at(-1)).toMatchObject({
        provider: mode,
        latitude: ROUNDED.latitude,
        longitude: ROUNDED.longitude,
      })
      const spans = exporter.getFinishedSpans()
      expect(spans).toHaveLength(1)
      expect(spans[0]!.attributes['url.full']).toBe(
        `${double.origin}${mode === 'openweather' ? '/geo/1.0/reverse' : '/v1/search.json'}`
      )
      expect(leaks()).toEqual([])
    }
  )

  it.each(Object.keys(clients) as (keyof typeof clients)[])(
    'GEO-TRACE-02 %s: a provider failure leaves no query in the span either',
    async (mode) => {
      await expect(
        clients[mode]().reverse(
          REVERSE_DOWN_COORDINATE.lat,
          REVERSE_DOWN_COORDINATE.lon,
          'en',
          signal()
        )
      ).rejects.toMatchObject({ provider: mode })
      await provider.forceFlush()

      expect(exporter.getFinishedSpans()).toHaveLength(1)
      expect(leaks()).toEqual([])
    }
  )
})

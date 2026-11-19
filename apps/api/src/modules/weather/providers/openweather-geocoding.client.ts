import { Injectable } from '@nestjs/common'
import { canonicalCountryCode } from '@couture/utils'
import { z } from 'zod'
import {
  buildProviderUrl,
  fetchGeocodingJson,
  GEOCODING_RESULT_LIMIT,
  roundGeocodedCoordinate,
  trimToNull,
  type GeocodedPlace,
  type ILocationGeocoder,
} from './location-geocoding.js'
import { WeatherProviderError } from './weather-provider.error.js'
import { resolveWeatherProviderOrigin } from './weather-provider-origin.js'

const PROVIDER = 'openweather' as const
const GEOCODING_PATH = '/geo/1.0/direct'
const REVERSE_GEOCODING_PATH = '/geo/1.0/reverse'

const OpenWeatherGeocodingEntrySchema = z.object({
  name: z.string().trim().min(1).max(120),
  local_names: z.record(z.string(), z.string()).optional().nullable(),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/),
  state: z.string().max(120).optional().nullable(),
})

export interface OpenWeatherGeocodingClientOptions {
  apiKey?: string
  baseUrl?: string
  reverseBaseUrl?: string
  env?: NodeJS.ProcessEnv
}

/**
 * Story 1.2b: OpenWeather Geocoding `direct`, on the One Call key. `name` is
 * the provider's default name and becomes the stored city; `local_names` only
 * localizes the display label. A missing `state` stays null, so City Spotlight
 * resolves that place at country level. `reverse` asks Geocoding `reverse`,
 * which answers the same entry shape, so both map through one parser.
 */
@Injectable()
export class OpenWeatherGeocodingClient implements ILocationGeocoder {
  readonly provider = PROVIDER
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly reverseBaseUrl: string

  constructor(options: OpenWeatherGeocodingClientOptions = {}) {
    const env = options.env ?? process.env
    this.apiKey = options.apiKey ?? env.OPENWEATHER_API_KEY ?? ''
    const origin = resolveWeatherProviderOrigin(PROVIDER, env)
    this.baseUrl = options.baseUrl ?? `${origin}${GEOCODING_PATH}`
    this.reverseBaseUrl = options.reverseBaseUrl ?? `${origin}${REVERSE_GEOCODING_PATH}`
  }

  async search(
    query: string,
    language: string,
    signal: AbortSignal
  ): Promise<GeocodedPlace[]> {
    this.requireKey()
    const url = buildProviderUrl(PROVIDER, this.baseUrl)
    url.searchParams.set('q', query)
    url.searchParams.set('limit', String(GEOCODING_RESULT_LIMIT))
    url.searchParams.set('appid', this.apiKey)
    return this.fetchPlaces(url, language, signal)
  }

  async reverse(
    latitude: number,
    longitude: number,
    language: string,
    signal: AbortSignal
  ): Promise<GeocodedPlace[]> {
    this.requireKey()
    const url = buildProviderUrl(PROVIDER, this.reverseBaseUrl)
    url.searchParams.set('lat', String(latitude))
    url.searchParams.set('lon', String(longitude))
    url.searchParams.set('limit', String(GEOCODING_RESULT_LIMIT))
    url.searchParams.set('appid', this.apiKey)
    return this.fetchPlaces(url, language, signal)
  }

  private requireKey(): void {
    if (!this.apiKey) {
      throw new WeatherProviderError('OpenWeather API key is not configured', {
        provider: PROVIDER,
        kind: 'invalid_configuration',
      })
    }
  }

  private async fetchPlaces(
    url: URL,
    language: string,
    signal: AbortSignal
  ): Promise<GeocodedPlace[]> {
    const raw = await fetchGeocodingJson(PROVIDER, url, signal)
    if (!Array.isArray(raw)) {
      throw new WeatherProviderError('OpenWeather geocoding response is not a list', {
        provider: PROVIDER,
        kind: 'invalid_response',
      })
    }

    const places: GeocodedPlace[] = []
    for (const entry of raw.slice(0, GEOCODING_RESULT_LIMIT)) {
      const parsed = OpenWeatherGeocodingEntrySchema.safeParse(entry)
      if (!parsed.success) continue
      const country = canonicalCountryCode(parsed.data.country)
      if (!country) continue
      places.push({
        city: parsed.data.name,
        region: trimToNull(parsed.data.state),
        country,
        latitude: roundGeocodedCoordinate(parsed.data.lat),
        longitude: roundGeocodedCoordinate(parsed.data.lon),
        localizedName: trimToNull(parsed.data.local_names?.[language]),
      })
    }
    return places
  }
}

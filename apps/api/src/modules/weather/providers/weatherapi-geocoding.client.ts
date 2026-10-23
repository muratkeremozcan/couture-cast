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

const PROVIDER = 'weatherapi' as const
const SEARCH_PATH = '/v1/search.json'

const WeatherApiSearchEntrySchema = z.object({
  name: z.string().trim().min(1).max(120),
  region: z.string().max(120).optional().nullable(),
  country: z.string().trim().min(1).max(120),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
})

export interface WeatherApiGeocodingClientOptions {
  apiKey?: string
  baseUrl?: string
  env?: NodeJS.ProcessEnv
}

/**
 * Story 1.2b: WeatherAPI `search.json`, on the forecast key. WeatherAPI names
 * the country in English; `canonicalCountryCode` turns it into ISO 3166-1
 * alpha-2 and a name that resolves to nothing drops the candidate. WeatherAPI
 * offers no localized names, so the display label stays the default name.
 */
@Injectable()
export class WeatherApiGeocodingClient implements ILocationGeocoder {
  readonly provider = PROVIDER
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(options: WeatherApiGeocodingClientOptions = {}) {
    const env = options.env ?? process.env
    this.apiKey = options.apiKey ?? env.WEATHERAPI_API_KEY ?? ''
    this.baseUrl =
      options.baseUrl ?? `${resolveWeatherProviderOrigin(PROVIDER, env)}${SEARCH_PATH}`
  }

  async search(
    query: string,
    _language: string,
    signal: AbortSignal
  ): Promise<GeocodedPlace[]> {
    if (!this.apiKey) {
      throw new WeatherProviderError('WeatherAPI API key is not configured', {
        provider: PROVIDER,
        kind: 'invalid_configuration',
      })
    }

    const url = buildProviderUrl(PROVIDER, this.baseUrl)
    url.searchParams.set('key', this.apiKey)
    url.searchParams.set('q', query)

    const raw = await fetchGeocodingJson(PROVIDER, url, signal)
    if (!Array.isArray(raw)) {
      throw new WeatherProviderError('WeatherAPI search response is not a list', {
        provider: PROVIDER,
        kind: 'invalid_response',
      })
    }

    const places: GeocodedPlace[] = []
    for (const entry of raw) {
      if (places.length >= GEOCODING_RESULT_LIMIT) break
      const parsed = WeatherApiSearchEntrySchema.safeParse(entry)
      if (!parsed.success) continue
      const country = canonicalCountryCode(parsed.data.country)
      if (!country) continue
      places.push({
        city: parsed.data.name,
        region: trimToNull(parsed.data.region),
        country,
        latitude: roundGeocodedCoordinate(parsed.data.lat),
        longitude: roundGeocodedCoordinate(parsed.data.lon),
        localizedName: null,
      })
    }
    return places
  }
}

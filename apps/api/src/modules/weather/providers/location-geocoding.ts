import {
  classifyFetchFailure,
  classifyHttpFailure,
  WeatherProviderError,
} from './weather-provider.error.js'
import type { WeatherProviderName } from './weather.types.js'

/** Story 1.2b: provider geocoding requests at most this many results. */
export const GEOCODING_RESULT_LIMIT = 5

/**
 * One provider place, canonicalized: the provider's default (locale-independent)
 * name, its region or null, an ISO 3166-1 alpha-2 country and coordinates at the
 * three-decimal precision saved locations store. `localizedName` is display only.
 */
export interface GeocodedPlace {
  city: string
  region: string | null
  country: string
  latitude: number
  longitude: number
  localizedName: string | null
}

export interface ILocationGeocoder {
  readonly provider: WeatherProviderName
  search(query: string, language: string, signal: AbortSignal): Promise<GeocodedPlace[]>
}

/** The precision `LocationPreferencesService` stores coordinates at. */
export function roundGeocodedCoordinate(value: number): number {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? 0 : rounded
}

export function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * Fetches and parses one provider JSON response, mapping every failure onto the
 * shared provider error kinds so callers answer one typed 503.
 */
export async function fetchGeocodingJson(
  provider: WeatherProviderName,
  url: URL,
  signal: AbortSignal
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error: unknown) {
    throw classifyFetchFailure(provider, error, signal)
  }
  if (!response.ok) {
    throw classifyHttpFailure(provider, response.status)
  }
  try {
    return (await response.json()) as unknown
  } catch (error: unknown) {
    if (signal.aborted) {
      throw classifyFetchFailure(provider, error, signal)
    }
    throw new WeatherProviderError(`${provider} geocoding returned malformed JSON`, {
      provider,
      kind: 'invalid_response',
    })
  }
}

export function buildProviderUrl(provider: WeatherProviderName, base: string): URL {
  try {
    return new URL(base)
  } catch {
    throw new WeatherProviderError(`${provider} geocoding base URL is invalid`, {
      provider,
      kind: 'invalid_configuration',
    })
  }
}

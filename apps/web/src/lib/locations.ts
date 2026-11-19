// Story 1.2b owner: the web app's saved-location client.
//
// Follows `planner.ts`: the `sessionStorage` bearer token, Zod-parsed responses
// at the trust boundary, and a classified failure reason rather than the
// server's English. Search and save from search answer typed `code` values,
// which map onto `locations.errors.*` catalog keys.
'use client'

import {
  createSavedLocationFromSearchResponseSchema,
  deleteSavedLocationResponseSchema,
  listSavedLocationsResponseSchema,
  locationRequestErrorResponseSchema,
  locationSearchResponseSchema,
  locationUnavailableResponseSchema,
  setPrimarySavedLocationResponseSchema,
  updateSavedLocationResponseSchema,
  type LocationSearchCandidate,
  type SavedLocation,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'
import { FetchError, ResponseError } from '@couture/api-client'
import { createWebApiClient } from './api-client'
import { approximateCoordinate } from './device-position'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
import { readStorage } from './browser-persistence'

export { hasWebSession } from './commerce'

export type LocationFailureReason =
  | 'signed_out'
  | 'invalid_query'
  | 'invalid_candidate'
  | 'limit_reached'
  | 'duplicate'
  | 'provider_unavailable'
  | 'service_unavailable'
  | 'rate_limited'
  | 'not_found'
  | 'unknown'

/** `message` is developer-facing; UI code reads `reason`. */
export class LocationRequestError extends Error {
  readonly reason: LocationFailureReason

  constructor(reason: LocationFailureReason, message: string) {
    super(message)
    this.name = 'LocationRequestError'
    this.reason = reason
  }
}

function readAccessToken(): string {
  const token =
    typeof window === 'undefined'
      ? null
      : (readStorage('session', WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? null)
  if (!token) {
    throw new LocationRequestError('signed_out', 'Sign in to manage locations.')
  }
  return token
}

const REQUEST_CODE_REASONS = {
  invalid_request: 'invalid_query',
  invalid_candidate: 'invalid_candidate',
  location_limit_reached: 'limit_reached',
  location_duplicate: 'duplicate',
} as const satisfies Record<string, LocationFailureReason>

const UNAVAILABLE_CODE_REASONS = {
  provider_unavailable: 'provider_unavailable',
  location_service_unavailable: 'service_unavailable',
} as const satisfies Record<string, LocationFailureReason>

async function reasonForResponse(response: Response): Promise<LocationFailureReason> {
  if (response.status === 401) return 'signed_out'
  if (response.status === 404) return 'not_found'
  if (response.status === 429) return 'rate_limited'
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    return 'unknown'
  }
  const request = locationRequestErrorResponseSchema.safeParse(body)
  if (request.success) return REQUEST_CODE_REASONS[request.data.code]
  const unavailable = locationUnavailableResponseSchema.safeParse(body)
  if (unavailable.success) return UNAVAILABLE_CODE_REASONS[unavailable.data.code]
  // The legacy routes answer the plain `{ statusCode, message, error }` 400.
  if (response.status === 400) return 'invalid_query'
  return 'unknown'
}

async function locationError(error: unknown): Promise<LocationRequestError> {
  if (error instanceof LocationRequestError) return error
  if (error instanceof ResponseError) {
    return new LocationRequestError(
      await reasonForResponse(error.response),
      `Location request failed with HTTP ${error.response.status}`
    )
  }
  // The generated SDK wraps a fetch rejection in `FetchError`, so an abort
  // arrives as its cause. A cancelled request is the caller's choice, never a
  // failure to report.
  if (error instanceof FetchError && error.cause.name === 'AbortError') throw error.cause
  if (error instanceof Error && error.name === 'AbortError') throw error
  return new LocationRequestError(
    'unknown',
    error instanceof Error ? error.message : 'Location request failed'
  )
}

/**
 * The bearer a member-owned operation captured when the member acted. Every request in that
 * operation sends this one, never a later read of session storage, so one member's data can only
 * travel under that member's token.
 */
export interface LocationCredentials {
  readonly accessToken: string
}

/** The bearer this tab holds right now, captured for one operation, or null when signed out. */
export function captureLocationCredentials(): LocationCredentials | null {
  const token =
    typeof window === 'undefined'
      ? null
      : (readStorage('session', WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? null)
  return token ? { accessToken: token } : null
}

function client(credentials?: LocationCredentials) {
  return createWebApiClient({
    accessToken: credentials?.accessToken ?? readAccessToken(),
  })
}

export async function listLocationsFromWeb(
  signal?: AbortSignal,
  credentials?: LocationCredentials
): Promise<SavedLocation[]> {
  try {
    const response = await client(credentials).apiV1LocationsGet({ signal })
    return listSavedLocationsResponseSchema.parse(response).data
  } catch (error) {
    throw await locationError(error)
  }
}

export async function searchLocationsFromWeb(
  query: string,
  locale: SupportedLocale,
  signal?: AbortSignal,
  credentials?: LocationCredentials
): Promise<LocationSearchCandidate[]> {
  try {
    const response = await client(credentials).apiV1LocationsSearchGet(
      { q: query, locale, xCouturePlatform: 'web' },
      { signal }
    )
    return locationSearchResponseSchema.parse(response).data
  } catch (error) {
    throw await locationError(error)
  }
}

/**
 * Use my location: the cities nearest an approximate position, as search
 * candidates that save through `saveLocationFromSearchFromWeb`. The position is
 * rounded to two decimals here as well and travels only in the POST body.
 */
export async function locationsFromCoordinatesFromWeb(
  position: { latitude: number; longitude: number },
  locale: SupportedLocale,
  signal?: AbortSignal,
  credentials?: LocationCredentials
): Promise<LocationSearchCandidate[]> {
  try {
    const response = await client(credentials).apiV1LocationsFromCoordinatesPost(
      {
        xCouturePlatform: 'web',
        locationsFromCoordinatesInput: {
          latitude: approximateCoordinate(position.latitude),
          longitude: approximateCoordinate(position.longitude),
          locale,
        },
      },
      { signal }
    )
    return locationSearchResponseSchema.parse(response).data
  } catch (error) {
    throw await locationError(error)
  }
}

export async function saveLocationFromSearchFromWeb(
  candidateToken: string,
  label: string,
  credentials?: LocationCredentials
): Promise<SavedLocation> {
  try {
    const response = await client(credentials).apiV1LocationsFromSearchPost({
      xCouturePlatform: 'web',
      createSavedLocationFromSearchInput: { candidateToken, label },
    })
    const saved = createSavedLocationFromSearchResponseSchema.parse(response).data
    return saved
  } catch (error) {
    throw await locationError(error)
  }
}

export async function setPrimaryLocationFromWeb(
  locationId: string,
  credentials?: LocationCredentials
): Promise<SavedLocation> {
  try {
    const response = await client(credentials).apiV1LocationsLocationIdPrimaryPost({
      locationId,
    })
    const saved = setPrimarySavedLocationResponseSchema.parse(response).data
    return saved
  } catch (error) {
    throw await locationError(error)
  }
}

export async function renameLocationFromWeb(
  locationId: string,
  label: string,
  credentials?: LocationCredentials
): Promise<SavedLocation> {
  try {
    const response = await client(credentials).apiV1LocationsLocationIdPatch({
      locationId,
      updateSavedLocationInput: { label },
    })
    const saved = updateSavedLocationResponseSchema.parse(response).data
    return saved
  } catch (error) {
    throw await locationError(error)
  }
}

export async function deleteLocationFromWeb(
  locationId: string,
  credentials?: LocationCredentials
): Promise<void> {
  try {
    const response = await client(credentials).apiV1LocationsLocationIdDelete({
      locationId,
    })
    deleteSavedLocationResponseSchema.parse(response)
  } catch (error) {
    throw await locationError(error)
  }
}

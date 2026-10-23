// Story 1.2b owner: the mobile saved-location client.
//
// Follows `planner.ts`: the resolved bearer token, the shared request deadline,
// Zod-parsed responses and a classified failure reason, never the server's
// English. Mutations notify `onLocationsChanged` listeners so the hero and the
// Community tab reload as soon as a location changes, whichever screen made it.
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
import { ResponseError } from '@couture/api-client'
import { createMobileApiClient } from './api-client'
import { withRequestTimeout } from './commerce'
import { resolveMobileAccessToken } from './mobile-auth'

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

type Listener = () => void
const listeners = new Set<Listener>()

/** Subscribes to saved-location changes; returns the unsubscribe. */
export function onLocationsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyLocationsChanged(): void {
  for (const listener of [...listeners]) listener()
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
  return new LocationRequestError(
    'unknown',
    error instanceof Error ? error.message : 'Location request failed'
  )
}

/** The reason behind a rejection from this module. */
export function locationFailureReason(error: unknown): LocationFailureReason {
  return error instanceof LocationRequestError ? error.reason : 'unknown'
}

async function client() {
  const accessToken = (await resolveMobileAccessToken())?.trim()
  if (!accessToken) {
    throw new LocationRequestError('signed_out', 'Sign in to manage locations.')
  }
  return createMobileApiClient({ accessToken })
}

export async function listLocationsFromMobile(
  signal?: AbortSignal
): Promise<SavedLocation[]> {
  try {
    const api = await client()
    const response = await withRequestTimeout(signal, (requestSignal) =>
      api.apiV1LocationsGet({ signal: requestSignal })
    )
    return listSavedLocationsResponseSchema.parse(response).data
  } catch (error) {
    throw await locationError(error)
  }
}

export async function searchLocationsFromMobile(
  query: string,
  locale: SupportedLocale,
  signal?: AbortSignal
): Promise<LocationSearchCandidate[]> {
  try {
    const api = await client()
    const response = await withRequestTimeout(signal, (requestSignal) =>
      api.apiV1LocationsSearchGet(
        { q: query, locale, xCouturePlatform: 'mobile' },
        { signal: requestSignal }
      )
    )
    return locationSearchResponseSchema.parse(response).data
  } catch (error) {
    throw await locationError(error)
  }
}

export async function saveLocationFromSearchFromMobile(
  candidateToken: string,
  label: string
): Promise<SavedLocation> {
  try {
    const api = await client()
    const response = await withRequestTimeout(undefined, (requestSignal) =>
      api.apiV1LocationsFromSearchPost(
        {
          xCouturePlatform: 'mobile',
          createSavedLocationFromSearchInput: { candidateToken, label },
        },
        { signal: requestSignal }
      )
    )
    const saved = createSavedLocationFromSearchResponseSchema.parse(response).data
    notifyLocationsChanged()
    return saved
  } catch (error) {
    throw await locationError(error)
  }
}

export async function setPrimaryLocationFromMobile(
  locationId: string
): Promise<SavedLocation> {
  try {
    const api = await client()
    const response = await withRequestTimeout(undefined, (requestSignal) =>
      api.apiV1LocationsLocationIdPrimaryPost({ locationId }, { signal: requestSignal })
    )
    const saved = setPrimarySavedLocationResponseSchema.parse(response).data
    notifyLocationsChanged()
    return saved
  } catch (error) {
    throw await locationError(error)
  }
}

export async function renameLocationFromMobile(
  locationId: string,
  label: string
): Promise<SavedLocation> {
  try {
    const api = await client()
    const response = await withRequestTimeout(undefined, (requestSignal) =>
      api.apiV1LocationsLocationIdPatch(
        { locationId, updateSavedLocationInput: { label } },
        { signal: requestSignal }
      )
    )
    const saved = updateSavedLocationResponseSchema.parse(response).data
    notifyLocationsChanged()
    return saved
  } catch (error) {
    throw await locationError(error)
  }
}

export async function deleteLocationFromMobile(locationId: string): Promise<void> {
  try {
    const api = await client()
    const response = await withRequestTimeout(undefined, (requestSignal) =>
      api.apiV1LocationsLocationIdDelete({ locationId }, { signal: requestSignal })
    )
    deleteSavedLocationResponseSchema.parse(response)
    notifyLocationsChanged()
  } catch (error) {
    throw await locationError(error)
  }
}

import type { SavedLocation } from '@couture/api-client/contracts/http'
import type { LocationFailureReason } from '../../../lib/locations'

export const MAX_SAVED_LOCATIONS = 3

/** City, region and the country's name in the reader's language. */
export function formatPlace(
  location: Pick<SavedLocation, 'city' | 'region' | 'country'>,
  locale: string
): string {
  let country = location.country
  if (country) {
    try {
      country = new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country
    } catch {
      // A legacy free-text country stays as typed.
    }
  }
  return distinctPlaceParts([location.city, location.region, country]).join(', ')
}

/** City states such as Monaco name the city, region and country alike; say it once. */
export function distinctPlaceParts(
  parts: readonly (string | null | undefined)[]
): string[] {
  const seen = new Set<string>()
  return parts.filter((part): part is string => {
    if (!part) return false
    const key = part.trim().toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Which step failed: the same provider outage reads differently on save. Use my
 * location (`locate`) answers an outage like search, because it is one.
 */
export type LocationFailureStep = 'search' | 'save' | 'locate'

/**
 * Use my location failures that happen before or instead of a request: the
 * member or browser refused the position, the browser could not tell, or no
 * city is near it. Each one points back at the city search.
 */
export type LocateFailure = 'location_denied' | 'location_unavailable' | 'no_city_nearby'

export function locateErrorKey(failure: LocateFailure): string {
  return `locations.errors.${failure}`
}

export function errorKey(
  reason: LocationFailureReason,
  step: LocationFailureStep = 'search'
): string {
  switch (reason) {
    case 'provider_unavailable':
      // The save-time forecast is a different request from city search, and
      // telling the member search is down when their pick could not be saved
      // sends them to the wrong fix.
      return step === 'save'
        ? 'locations.errors.save_unavailable'
        : 'locations.errors.provider_unavailable'
    case 'service_unavailable':
    case 'invalid_candidate':
    case 'duplicate':
    case 'rate_limited':
    case 'invalid_query':
      return `locations.errors.${reason}`
    case 'limit_reached':
      return 'locations.limit'
    default:
      return 'locations.errors.unknown'
  }
}

const HOME_PATH = '/'

/**
 * The guided path's return target. No target means stay here (`null`). A target
 * must be a plain same-origin path: it is resolved against `origin` and kept only
 * when its canonical pathname starts with a single slash. Refuse control
 * characters, backslashes and encoded separators before parsing. A refused
 * target returns home.
 */
export function safeReturnPath(value: string | null, origin: string): string | null {
  if (!value) return null
  if (!value.startsWith(HOME_PATH) || /\\|%(2f|5c|25)|\p{Cc}/iu.test(value))
    return HOME_PATH
  try {
    const resolved = new URL(value, origin)
    if (
      resolved.origin !== new URL(origin).origin ||
      !/^\/(?!\/)/.test(resolved.pathname)
    )
      return HOME_PATH
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return HOME_PATH
  }
}

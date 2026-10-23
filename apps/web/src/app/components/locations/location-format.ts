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

export function errorKey(reason: LocationFailureReason): string {
  switch (reason) {
    case 'provider_unavailable':
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
 * when it stays on that origin. A backslash, or a percent-encoded slash,
 * backslash or percent sign anywhere (which a browser or a later decode can turn
 * into `//other.host`), is refused. A refused target returns home.
 */
export function safeReturnPath(value: string | null, origin: string): string | null {
  if (!value) return null
  if (!value.startsWith(HOME_PATH) || /\\|%(2f|5c|25)/i.test(value)) return HOME_PATH
  let resolved: URL
  try {
    resolved = new URL(value, origin)
  } catch {
    return HOME_PATH
  }
  if (resolved.origin !== new URL(origin).origin) return HOME_PATH
  return `${resolved.pathname}${resolved.search}${resolved.hash}`
}

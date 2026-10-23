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

/** Only a same-origin path may be a return target. */
export function safeReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  return value
}

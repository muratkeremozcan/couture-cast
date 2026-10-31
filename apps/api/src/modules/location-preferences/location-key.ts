// Story 1.2b location key owner: folded, coordinate-suffixed keys and `isSearchLocationKey` in `apps/api/src/modules/location-preferences/location-key.ts`
import { foldAreaComponent } from '@couture/utils'
import { savedLocationSchema } from '../../contracts/http'

/** `locationKeySchema` caps keys at 120 characters. */
export const LOCATION_KEY_MAX_LENGTH = 120

export interface LocationKeySource {
  city: string
  region: string | null
  country: string
  latitude: number
  longitude: number
}

function slugPart(value: string | null): string {
  return (foldAreaComponent(value) ?? '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function truncatePart(part: string, length: number): string {
  return part.slice(0, Math.max(0, length)).replace(/-+$/g, '')
}

/** `41.871n-87.631w`, normalized to `41-871n-87-631w`. */
function coordinateSuffix(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(3)}${latitude < 0 ? 's' : 'n'}`
  const lon = `${Math.abs(longitude).toFixed(3)}${longitude < 0 ? 'w' : 'e'}`
  return `${lat}-${lon}`.replace(/\./g, '-')
}

/**
 * Shortens city and region (never the country or the coordinates) until the
 * name part fits. Each gets half the budget; a part shorter than its half
 * gives the remainder to the other.
 */
function fitNameParts(city: string, region: string, budget: number): [string, string] {
  if (city.length + region.length <= budget) return [city, region]
  if (!region) return [truncatePart(city, budget), '']
  if (!city) return ['', truncatePart(region, budget)]
  const half = Math.floor(budget / 2)
  if (city.length <= half) return [city, truncatePart(region, budget - city.length)]
  if (region.length <= half) return [truncatePart(city, budget - region.length), region]
  return [truncatePart(city, half), truncatePart(region, budget - half)]
}

/**
 * Story 1.2b: the saved-location key for a searched city, derived from
 * server-held fields only. Default name, region and ISO country fold to ASCII
 * (NFKD, marks removed, Turkish dotted and dotless I folded), followed by the
 * coordinates at the stored three-decimal precision with hemisphere letters.
 * Distinct stored places never share a key, the same candidate always yields
 * the same key, and no display locale can change it.
 */
export function buildSearchLocationKey(source: LocationKeySource): string {
  const country = slugPart(source.country)
  const suffix = coordinateSuffix(source.latitude, source.longitude)
  const city = slugPart(source.city)
  const region = slugPart(source.region)
  const fixedLength =
    suffix.length + country.length + [city, region, country].filter(Boolean).length
  const [fittedCity, fittedRegion] = fitNameParts(
    city,
    region,
    LOCATION_KEY_MAX_LENGTH - fixedLength
  )
  const key = [fittedCity, fittedRegion, country, suffix]
    .filter((part) => part.length > 0)
    .join('-')
  return savedLocationSchema.shape.locationKey.parse(key)
}

const SEARCH_KEY_COORDINATE_SUFFIX = /(?:^|-)\d{1,2}-\d{3}[ns]-\d{1,3}-\d{3}[ew]$/

/**
 * True for keys `buildSearchLocationKey` produced. Their locations were saved
 * weather-ready, so nothing may substitute synthetic weather for them.
 */
export function isSearchLocationKey(locationKey: string): boolean {
  return SEARCH_KEY_COORDINATE_SUFFIX.test(locationKey)
}

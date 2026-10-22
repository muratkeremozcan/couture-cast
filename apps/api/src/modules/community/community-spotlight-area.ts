// Story 6.6 owner: hierarchical coarse areas for the City Spotlight.
import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { CommunitySpotlightLevel } from '@couture/api-client/contracts/http'

export type SpotlightAreaLevel = Exclude<CommunitySpotlightLevel, 'none'>

/** Narrowest first: the order a viewer's level is resolved in. */
export const SPOTLIGHT_AREA_LEVELS: readonly SpotlightAreaLevel[] = [
  'city',
  'region',
  'country',
]

/**
 * The stored hierarchical prefix. `region` is only ever set under a `country`
 * and `city` only under a `region`, so a level exists exactly when its own
 * component is set.
 */
export interface SpotlightAreaComponents {
  country: string | null
  region: string | null
  city: string | null
}

export interface SpotlightLocationSource {
  country: string | null
  region: string | null
  city: string | null
}

/** Trimmed, NFKC, lowercased; blank collapses to null. */
export function normalizeAreaComponent(value: string | null | undefined): string | null {
  if (value == null) return null
  const normalized = value.trim().normalize('NFKC').trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

/**
 * Keeps only the prefix whose parents are all present, so a city under a
 * missing region is dropped rather than stored where it could merge with a
 * same-named city elsewhere.
 */
export function areaComponentsOf(
  source: SpotlightLocationSource
): SpotlightAreaComponents {
  const country = normalizeAreaComponent(source.country)
  const region = country ? normalizeAreaComponent(source.region) : null
  const city = region ? normalizeAreaComponent(source.city) : null
  return { country, region, city }
}

export function hasAreaLevel(
  area: SpotlightAreaComponents,
  level: SpotlightAreaLevel
): boolean {
  if (level === 'country') return area.country !== null
  if (level === 'region') return area.region !== null
  return area.city !== null
}

/** The levels this area can be ranked at, narrowest first. */
export function availableAreaLevels(area: SpotlightAreaComponents): SpotlightAreaLevel[] {
  return SPOTLIGHT_AREA_LEVELS.filter((level) => hasAreaLevel(area, level))
}

/** The components a level matches on; deeper components are dropped. */
export function areaTupleAt(
  area: SpotlightAreaComponents,
  level: SpotlightAreaLevel
): string[] {
  if (level === 'country') return [area.country ?? '']
  if (level === 'region') return [area.country ?? '', area.region ?? '']
  return [area.country ?? '', area.region ?? '', area.city ?? '']
}

/**
 * An opaque identity for one area at one level. Redis keys and cursors carry
 * this digest and never a place name, so neither leaks where a member lives.
 */
export function areaHash(
  area: SpotlightAreaComponents,
  level: SpotlightAreaLevel
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(['community-spotlight-area', level, ...areaTupleAt(area, level)])
    )
    .digest('hex')
}

/** Every level hash a post's components belong to, for invalidation. */
export function areaHashesOf(area: SpotlightAreaComponents): string[] {
  return availableAreaLevels(area).map((level) => areaHash(area, level))
}

/**
 * The viewer's own place name at the chosen level, as they saved it. It is
 * never derived from authors.
 */
export function viewerAreaLabel(
  source: SpotlightLocationSource,
  level: CommunitySpotlightLevel
): string | null {
  if (level === 'none') return null
  const raw =
    level === 'city' ? source.city : level === 'region' ? source.region : source.country
  const label = raw?.trim().normalize('NFKC').trim()
  return label ? label : null
}

export interface SpotlightLocation extends SpotlightLocationSource {
  area: SpotlightAreaComponents
}

/** How many saved locations the area walk will consider. */
const MAX_AREA_LOCATIONS = 10

/**
 * The first saved location in `findViewerLocations` order (`is_primary desc,
 * created_at asc`) whose country is usable. Authors and viewers resolve their
 * area through this one rule. Null means level `none`.
 */
export async function findSpotlightLocation(
  prisma: Pick<PrismaClient, 'savedLocation'>,
  userId: string
): Promise<SpotlightLocation | null> {
  const locations = await prisma.savedLocation.findMany({
    where: { user_id: userId, country: { not: null } },
    orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
    take: MAX_AREA_LOCATIONS,
    select: { country: true, region: true, city: true },
  })
  for (const location of locations) {
    const area = areaComponentsOf(location)
    if (area.country) return { ...location, area }
  }
  return null
}

/**
 * The ritual cache key scheme, and the one operation anything outside
 * `RitualService` ever needs from it.
 *
 * `RitualService` owns the cache: it writes the entries, it decides what is
 * stale, and its key carries location, date, locale and occasion. But two
 * consumers only ever need to throw a user's entries away — the wardrobe
 * retention purge, when a garment stops existing, and `RitualService` itself.
 * Before this file the purge reached that by depending on the whole
 * `RitualService`, which drags in weather, locations, commerce and a Redis
 * client, and made the sweep impossible to run anywhere the full graph is not
 * already standing.
 *
 * The prefix lives here so there is exactly one definition of it. A second copy
 * that drifted would leave stale outfits rendering for a garment the user
 * deleted, which is a correctness bug that no test outside this file would see.
 */

export const RITUAL_CACHE_KEY_PREFIX = 'ritual'

export interface RitualCacheInvalidator {
  invalidateUserCache(userId: string): Promise<boolean>
}

export const RITUAL_CACHE_INVALIDATOR = Symbol('RITUAL_CACHE_INVALIDATOR')

/**
 * Narrowed to the two commands this file issues rather than `Pick<Redis, ...>`.
 * ioredis types `scan` as a dozen overloads covering every optional token, and a
 * test double cannot satisfy that signature without being cast — which would
 * defeat the point of typing it at all.
 */
export interface RitualCacheRedis {
  scan(
    cursor: string,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number
  ): Promise<[cursor: string, keys: string[]]>
  del(keys: string[]): Promise<number>
}

/**
 * SCAN rather than KEYS: this runs against the same Redis the request path uses,
 * and `KEYS` blocks the server for the length of the scan.
 *
 * Returns `false` instead of throwing. A user whose cache could not be cleared
 * sees stale outfits for up to the cache TTL, which is worth strictly less than
 * failing the deletion that triggered it — the garment is already gone from the
 * database by the time this runs.
 */
export async function invalidateRitualCacheForUser(
  redis: RitualCacheRedis,
  userId: string
): Promise<boolean> {
  try {
    const matchPattern = `${RITUAL_CACHE_KEY_PREFIX}:${userId}:*`
    let cursor = '0'
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        matchPattern,
        'COUNT',
        100
      )
      cursor = nextCursor
      if (keys.length > 0) {
        await redis.del(keys)
      }
    } while (cursor !== '0')
    return true
  } catch {
    return false
  }
}

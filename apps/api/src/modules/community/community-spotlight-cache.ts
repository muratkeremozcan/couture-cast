// Story 6.6 owner: the City Spotlight Redis read model.
import { randomBytes } from 'node:crypto'
import Redis from 'ioredis'
import { z } from 'zod'
import { getRedisConfig, redisOptionsFromConfig } from '../../config/redis.js'
import { SPOTLIGHT_SNAPSHOT_TTL_SECONDS } from './community-spotlight-ranking.js'
import type { SpotlightAreaLevel } from './community-spotlight-area.js'

export const COMMUNITY_SPOTLIGHT_REDIS = Symbol('COMMUNITY_SPOTLIGHT_REDIS')
export const COMMUNITY_SPOTLIGHT_KEY_PREFIX = 'community-spotlight'

/**
 * The read model's client reuses the ritual cache's options: a short connect
 * timeout, one retry and no offline queue, so an unavailable Redis fails fast
 * and readers rank directly from the database.
 */
export function createCommunitySpotlightRedis(options: { eager?: boolean } = {}): Redis {
  const config = getRedisConfig()
  const client = new Redis(config.url, {
    ...redisOptionsFromConfig(config),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1000,
    // The worker runtime connects on first use; the request path connects at
    // startup so its first read does not fall back to the database.
    lazyConnect: true,
  })
  // Failures surface on each command; the connection's own error events would
  // otherwise be unhandled while Redis is down.
  client.on('error', () => undefined)
  if (options.eager) void client.connect().catch(() => undefined)
  return client
}

/**
 * The commands this read model issues, narrowed from ioredis so a test double
 * can satisfy it without casts.
 */
export interface SpotlightRedis {
  get(key: string): Promise<string | null>
  set(
    key: string,
    value: string,
    expiryToken: 'EX',
    seconds: number,
    modeToken: 'NX'
  ): Promise<'OK' | null>
  eval(
    script: string,
    numberOfKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>
}

/**
 * Counters are compared as strings everywhere. A random 63-bit seed exceeds
 * both JavaScript's safe integers and Lua's doubles, so reading one as a
 * number would make two different versions compare equal.
 */
export interface SpotlightCounters {
  epoch: string
  version: string
}

export const spotlightSnapshotSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[0-9a-f]{64}$/),
    asOf: z.string().datetime(),
    level: z.enum(['city', 'region', 'country']),
    areaHash: z.string().regex(/^[0-9a-f]{64}$/),
    entries: z.array(
      z.object({ id: z.string().min(1), generation: z.number().int().min(0) }).strict()
    ),
  })
  .strict()
export type SpotlightSnapshot = z.infer<typeof spotlightSnapshotSchema>

const pointerSchema = z
  .object({ snapshotId: z.string().regex(/^[0-9a-f]{64}$/), version: z.string().min(1) })
  .strict()

/** Room left under the 64-bit signed ceiling so INCR can never overflow. */
const COUNTER_HEADROOM = 1n << 40n
const COUNTER_SEED_RANGE = (1n << 63n) - COUNTER_HEADROOM

/** A random 63-bit seed, so a reset counter never re-matches an old pointer. */
export function randomCounterSeed(): string {
  return ((randomBytes(8).readBigUInt64BE() >> 1n) % COUNTER_SEED_RANGE).toString()
}

/** Reads each key, creating a missing one with `SET NX` at its random seed. */
const ENSURE_COUNTERS = `
local values = {}
for index, key in ipairs(KEYS) do
  local value = redis.call('GET', key)
  if not value then
    redis.call('SET', key, ARGV[index], 'NX')
    value = redis.call('GET', key)
  end
  values[index] = value
end
return values
`

/** Increments each key; a missing key is first seeded, then incremented. */
const BUMP_COUNTERS = `
for index, key in ipairs(KEYS) do
  redis.call('SET', key, ARGV[index], 'NX')
  redis.call('INCR', key)
end
return #KEYS
`

/**
 * Publishes a pointer only while the area version and the global epoch still
 * hold the values the builder read before its database read. Values are
 * compared as strings and never converted to Lua numbers.
 */
const COMPARE_AND_SET_POINTER = `
if redis.call('GET', KEYS[1]) == ARGV[1] and redis.call('GET', KEYS[2]) == ARGV[2] then
  redis.call('SET', KEYS[3], ARGV[3], 'EX', tonumber(ARGV[4]))
  return 1
end
return 0
`

export class CommunitySpotlightCache {
  constructor(
    private readonly redis: SpotlightRedis,
    private readonly prefix: string = COMMUNITY_SPOTLIGHT_KEY_PREFIX
  ) {}

  epochKey(): string {
    return `${this.prefix}:epoch`
  }

  areaVersionKey(areaHash: string): string {
    return `${this.prefix}:area:${areaHash}`
  }

  pointerKey(epoch: string, level: SpotlightAreaLevel, areaHash: string): string {
    return `${this.prefix}:pointer:${epoch}:${level}:${areaHash}`
  }

  snapshotKey(snapshotId: string): string {
    return `${this.prefix}:snapshot:${snapshotId}`
  }

  /** Read BEFORE a builder's database read; the CAS later compares against it. */
  async counters(areaHash: string): Promise<SpotlightCounters> {
    const result = await this.redis.eval(
      ENSURE_COUNTERS,
      2,
      this.epochKey(),
      this.areaVersionKey(areaHash),
      randomCounterSeed(),
      randomCounterSeed()
    )
    const [epoch, version] = z.tuple([z.string(), z.string()]).parse(result)
    return { epoch, version }
  }

  /**
   * The current snapshot for an area, or null. A pointer built at an older
   * area version is treated as absent, so a stale rebuild can never be served.
   */
  async current(
    level: SpotlightAreaLevel,
    areaHash: string,
    counters: SpotlightCounters
  ): Promise<SpotlightSnapshot | null> {
    const raw = await this.redis.get(this.pointerKey(counters.epoch, level, areaHash))
    if (!raw) return null
    const pointer = pointerSchema.safeParse(safeJson(raw))
    if (!pointer.success || pointer.data.version !== counters.version) return null
    const snapshot = await this.snapshot(pointer.data.snapshotId)
    if (!snapshot || snapshot.level !== level || snapshot.areaHash !== areaHash)
      return null
    return snapshot
  }

  async snapshot(snapshotId: string): Promise<SpotlightSnapshot | null> {
    const raw = await this.redis.get(this.snapshotKey(snapshotId))
    if (!raw) return null
    const parsed = spotlightSnapshotSchema.safeParse(safeJson(raw))
    return parsed.success && parsed.data.id === snapshotId ? parsed.data : null
  }

  /**
   * Stores the immutable snapshot under its digest, then publishes the area
   * pointer through the compare-and-set. Returns whether the pointer landed.
   */
  async publish(
    snapshot: SpotlightSnapshot,
    counters: SpotlightCounters
  ): Promise<boolean> {
    await this.redis.set(
      this.snapshotKey(snapshot.id),
      JSON.stringify(spotlightSnapshotSchema.parse(snapshot)),
      'EX',
      SPOTLIGHT_SNAPSHOT_TTL_SECONDS,
      'NX'
    )
    const landed = await this.redis.eval(
      COMPARE_AND_SET_POINTER,
      3,
      this.areaVersionKey(snapshot.areaHash),
      this.epochKey(),
      this.pointerKey(counters.epoch, snapshot.level, snapshot.areaHash),
      counters.version,
      counters.epoch,
      JSON.stringify({ snapshotId: snapshot.id, version: counters.version }),
      SPOTLIGHT_SNAPSHOT_TTL_SECONDS
    )
    return landed === 1
  }

  /** Invalidates every pointer for these areas. */
  async bumpAreas(areaHashes: readonly string[]): Promise<void> {
    const keys = [...new Set(areaHashes)].map((hash) => this.areaVersionKey(hash))
    if (keys.length === 0) return
    await this.redis.eval(
      BUMP_COUNTERS,
      keys.length,
      ...keys,
      ...keys.map(() => randomCounterSeed())
    )
  }

  /** Invalidates every pointer for every area at once. */
  async bumpEpoch(): Promise<void> {
    await this.redis.eval(BUMP_COUNTERS, 1, this.epochKey(), randomCounterSeed())
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

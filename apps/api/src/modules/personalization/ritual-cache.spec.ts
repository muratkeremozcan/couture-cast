import { describe, expect, it, vi } from 'vitest'
import {
  invalidateRitualCacheForUser,
  RITUAL_CACHE_KEY_PREFIX,
  type RitualCacheRedis,
} from './ritual-cache'

/**
 * The key pattern is the contract. `RitualService` writes entries under
 * `ritual:<userId>:<location>:<date>:<locale>:<occasion>` and this is the only
 * thing that deletes them, so a pattern that stopped matching would leave a
 * deleted garment showing in cached outfits — silently, and with every test
 * outside this file still green.
 */

type RedisDouble = {
  scan: ReturnType<typeof createScan>
  del: ReturnType<typeof createDel>
}

const createScan = () => vi.fn<RitualCacheRedis['scan']>()
const createDel = () => vi.fn<RitualCacheRedis['del']>()

function createRedis(pages: [string, string[]][]): RedisDouble {
  const scan = createScan()
  for (const page of pages) {
    scan.mockResolvedValueOnce(page)
  }
  const del = createDel()
  del.mockResolvedValue(1)
  return { scan, del }
}

describe('invalidateRitualCacheForUser', () => {
  it('scans on the user-scoped pattern and deletes what it finds', async () => {
    const redis = createRedis([['0', ['ritual:user-1:nyc:2026-08-20:en:work']]])

    await expect(invalidateRitualCacheForUser(redis, 'user-1')).resolves.toBe(true)

    expect(redis.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      `${RITUAL_CACHE_KEY_PREFIX}:user-1:*`,
      'COUNT',
      100
    )
    expect(redis.del).toHaveBeenCalledWith(['ritual:user-1:nyc:2026-08-20:en:work'])
  })

  it('follows the cursor until it returns to 0', async () => {
    const redis = createRedis([
      ['17', ['ritual:user-1:a']],
      ['42', ['ritual:user-1:b']],
      ['0', ['ritual:user-1:c']],
    ])

    await invalidateRitualCacheForUser(redis, 'user-1')

    expect(redis.scan).toHaveBeenCalledTimes(3)
    expect(redis.scan.mock.calls[1]?.[0]).toBe('17')
    expect(redis.scan.mock.calls[2]?.[0]).toBe('42')
    expect(redis.del).toHaveBeenCalledTimes(3)
  })

  it('does not issue a delete for an empty page', async () => {
    // `DEL` with no keys is an error in Redis, not a no-op.
    const redis = createRedis([['0', []]])

    await expect(invalidateRitualCacheForUser(redis, 'user-1')).resolves.toBe(true)
    expect(redis.del).not.toHaveBeenCalled()
  })

  it('scopes the pattern to one user', async () => {
    const redis = createRedis([['0', []]])

    await invalidateRitualCacheForUser(redis, 'user-2')

    expect(redis.scan.mock.calls[0]?.[2]).toBe('ritual:user-2:*')
  })

  it('reports false rather than throwing when Redis is unavailable', async () => {
    // The garment is already gone from the database by the time this runs, so
    // failing the caller would be strictly worse than serving a stale outfit
    // until the cache expires on its own.
    const redis = createRedis([])
    redis.scan.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(invalidateRitualCacheForUser(redis, 'user-1')).resolves.toBe(false)
  })

  it('reports false when the delete fails mid-scan', async () => {
    const redis = createRedis([['0', ['ritual:user-1:a']]])
    redis.del.mockRejectedValueOnce(new Error('READONLY'))

    await expect(invalidateRitualCacheForUser(redis, 'user-1')).resolves.toBe(false)
  })
})

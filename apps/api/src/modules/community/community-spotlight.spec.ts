// Story 6.6: the pure City Spotlight rules. Database and Redis behavior is proven
// against real services in integration/community-spotlight*.integration.spec.ts.
import { describe, expect, it } from 'vitest'
import {
  areaComponentsOf,
  areaHash,
  areaHashesOf,
  availableAreaLevels,
  normalizeAreaComponent,
  viewerAreaLabel,
} from './community-spotlight-area'
import {
  CommunitySpotlightCache,
  randomCounterSeed,
  type SpotlightRedis,
} from './community-spotlight-cache'
import {
  decodeSpotlightCursor,
  encodeSpotlightCursor,
} from './community-spotlight-cursor'
import {
  SPOTLIGHT_AGE_OFFSET_HOURS,
  SPOTLIGHT_MIN_COHORT_AUTHORS,
  SPOTLIGHT_SCORE_EXPONENT,
  SPOTLIGHT_SNAPSHOT_CAP,
  SPOTLIGHT_SNAPSHOT_TTL_SECONDS,
  SPOTLIGHT_WINDOW_DAYS,
  isWithinSpotlightWindow,
  rankSpotlightEntries,
  spotlightAgeHours,
  spotlightAsOf,
  spotlightScore,
  spotlightSnapshotId,
} from './community-spotlight-ranking'

const AS_OF = new Date('2026-10-22T12:00:00.000Z')
const hoursBefore = (hours: number) => new Date(AS_OF.getTime() - hours * 3_600_000)
const HASH = 'a'.repeat(64)

describe('6.6 spotlight constants', () => {
  it('6.6-UNIT-001 pins the owner-delegated threshold, window, exponent, cap and lifetimes', () => {
    expect(SPOTLIGHT_MIN_COHORT_AUTHORS).toBe(5)
    expect(SPOTLIGHT_WINDOW_DAYS).toBe(7)
    expect(SPOTLIGHT_SCORE_EXPONENT).toBe(1.5)
    expect(SPOTLIGHT_AGE_OFFSET_HOURS).toBe(2)
    expect(SPOTLIGHT_SNAPSHOT_CAP).toBe(60)
    expect(SPOTLIGHT_SNAPSHOT_TTL_SECONDS).toBe(600)
  })
})

describe('6.6 spotlight score', () => {
  it('6.6-UNIT-002 is non-author reactions over (age_hours + 2)^1.5', () => {
    expect(spotlightScore(4, 2)).toBeCloseTo(4 / Math.pow(4, 1.5), 12)
    expect(spotlightScore(1, 0)).toBeCloseTo(1 / Math.pow(2, 1.5), 12)
    expect(spotlightAgeHours(AS_OF, hoursBefore(30))).toBe(30)
  })

  it('6.6-UNIT-003 truncates as_of to the minute', () => {
    expect(spotlightAsOf(new Date('2026-10-22T12:34:56.789Z')).toISOString()).toBe(
      '2026-10-22T12:34:00.000Z'
    )
  })

  it('6.6-UNIT-004 excludes exactly as_of minus seven days and includes exactly as_of', () => {
    expect(isWithinSpotlightWindow(AS_OF, hoursBefore(7 * 24))).toBe(false)
    expect(
      isWithinSpotlightWindow(AS_OF, new Date(hoursBefore(7 * 24).getTime() + 1))
    ).toBe(true)
    expect(isWithinSpotlightWindow(AS_OF, AS_OF)).toBe(true)
    expect(isWithinSpotlightWindow(AS_OF, new Date(AS_OF.getTime() + 1))).toBe(false)
  })

  it('6.6-UNIT-005 orders equal scores and counts by published_at desc, then id desc', () => {
    const same = hoursBefore(5)
    const ranked = rankSpotlightEntries(AS_OF, [
      { id: 'post-a', reactions: 2, publishedAt: same },
      { id: 'post-c', reactions: 2, publishedAt: same },
      { id: 'post-b', reactions: 2, publishedAt: hoursBefore(4) },
      { id: 'post-self-only', reactions: 0, publishedAt: hoursBefore(1) },
    ])
    expect(ranked.map((entry) => entry.id)).toEqual(['post-b', 'post-c', 'post-a'])
  })

  it('6.6-UNIT-006 ranks identically on every run and caps at 60', () => {
    const entries = Array.from({ length: 75 }, (_, index) => ({
      id: `post-${String(index).padStart(3, '0')}`,
      reactions: (index % 4) + 1,
      publishedAt: hoursBefore(index % 9),
    }))
    const first = rankSpotlightEntries(AS_OF, entries)
    const second = rankSpotlightEntries(AS_OF, [...entries].reverse())
    expect(first).toHaveLength(60)
    expect(second.map((entry) => entry.id)).toEqual(first.map((entry) => entry.id))
  })

  it('6.6-UNIT-007 derives the snapshot id from as_of, level, area hash and ordered ids only', () => {
    const base = { asOf: AS_OF, level: 'city' as const, areaHash: HASH, ids: ['a', 'b'] }
    const id = spotlightSnapshotId(base)
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(spotlightSnapshotId({ ...base })).toBe(id)
    expect(spotlightSnapshotId({ ...base, ids: ['b', 'a'] })).not.toBe(id)
    expect(spotlightSnapshotId({ ...base, level: 'region' })).not.toBe(id)
    expect(spotlightSnapshotId({ ...base, asOf: hoursBefore(1) })).not.toBe(id)
    expect(spotlightSnapshotId({ ...base, areaHash: 'b'.repeat(64) })).not.toBe(id)
  })
})

describe('6.6 hierarchical areas', () => {
  it('6.6-UNIT-008 trims, applies NFKC and lowercases each component', () => {
    expect(normalizeAreaComponent('  Ｌｉｓｂｏｎ ')).toBe('lisbon')
    expect(normalizeAreaComponent('LISBOA')).toBe('lisboa')
    expect(normalizeAreaComponent('   ')).toBeNull()
    expect(normalizeAreaComponent(null)).toBeNull()
  })

  it('6.6-UNIT-009 keeps only the prefix whose parents exist', () => {
    expect(areaComponentsOf({ country: 'PT', region: null, city: 'Lisbon' })).toEqual({
      country: 'pt',
      region: null,
      city: null,
    })
    expect(areaComponentsOf({ country: null, region: 'Lisboa', city: 'Lisbon' })).toEqual(
      {
        country: null,
        region: null,
        city: null,
      }
    )
    expect(
      availableAreaLevels(
        areaComponentsOf({ country: 'PT', region: 'Lisboa', city: null })
      )
    ).toEqual(['region', 'country'])
  })

  it('6.6-UNIT-010 never merges same-named cities or regions under different parents', () => {
    const springfieldA = areaComponentsOf({
      country: 'US',
      region: 'IL',
      city: 'Springfield',
    })
    const springfieldB = areaComponentsOf({
      country: 'US',
      region: 'MO',
      city: 'Springfield',
    })
    expect(areaHash(springfieldA, 'city')).not.toBe(areaHash(springfieldB, 'city'))
    expect(areaHash(springfieldA, 'country')).toBe(areaHash(springfieldB, 'country'))
    const regionA = areaComponentsOf({ country: 'US', region: 'Georgia', city: null })
    const regionB = areaComponentsOf({ country: 'GE', region: 'Georgia', city: null })
    expect(areaHash(regionA, 'region')).not.toBe(areaHash(regionB, 'region'))
    expect(areaHashesOf(springfieldA)).toHaveLength(3)
  })

  it("6.6-UNIT-011 labels with the viewer's own saved name and null for none", () => {
    const source = { country: 'Portugal', region: ' Lisboa ', city: 'Lisbon' }
    expect(viewerAreaLabel(source, 'city')).toBe('Lisbon')
    expect(viewerAreaLabel(source, 'region')).toBe('Lisboa')
    expect(viewerAreaLabel(source, 'country')).toBe('Portugal')
    expect(viewerAreaLabel(source, 'none')).toBeNull()
  })
})

describe('6.6 spotlight cursor', () => {
  const cursor = {
    level: 'city' as const,
    areaHash: HASH,
    asOf: AS_OF.toISOString(),
    snapshotId: 'c'.repeat(64),
    index: 6,
  }

  it('6.6-UNIT-012 round-trips for the member it was minted for', () => {
    expect(
      decodeSpotlightCursor(encodeSpotlightCursor('member-1', cursor), 'member-1')
    ).toEqual(cursor)
  })

  it('6.6-UNIT-013 refuses a foreign, tampered or malformed cursor as invalid_cursor', () => {
    const encoded = encodeSpotlightCursor('member-1', cursor)
    const [payload, signature] = encoded.split('.')
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
        index: 12,
      })
    ).toString('base64url')
    for (const candidate of [
      encoded,
      `${forged}.${signature}`,
      `${payload}.`,
      'not-a-cursor',
      `${encoded}.extra`,
    ]) {
      const member = candidate === encoded ? 'member-2' : 'member-1'
      let refusal: unknown
      try {
        decodeSpotlightCursor(candidate, member)
      } catch (error) {
        refusal = error
      }
      expect(refusal).toMatchObject({
        response: { code: 'invalid_cursor', statusCode: 400 },
      })
    }
  })

  it('6.6-UNIT-014 never carries the raw member id', () => {
    const encoded = encodeSpotlightCursor('member-raw-id', cursor)
    expect(Buffer.from(encoded.split('.')[0]!, 'base64url').toString()).not.toContain(
      'member-raw-id'
    )
  })
})

describe('6.6 spotlight counters', () => {
  it('6.6-UNIT-015 seeds counters as decimal strings with INCR headroom', () => {
    for (let index = 0; index < 200; index += 1) {
      const seed = randomCounterSeed()
      expect(seed).toMatch(/^\d+$/)
      expect(BigInt(seed) < (1n << 63n) - (1n << 40n)).toBe(true)
    }
  })

  it('6.6-UNIT-016 compares versions as strings, so values past 2^53 never collide', async () => {
    // 2^53 and 2^53 + 1 are the same IEEE double; a numeric compare would serve
    // the stale pointer.
    const stored = new Map<string, string>()
    const redis: SpotlightRedis = {
      get: (key) => Promise.resolve(stored.get(key) ?? null),
      set: () => Promise.resolve('OK'),
      eval: () => Promise.resolve(null),
    }
    const cache = new CommunitySpotlightCache(redis, 'unit')
    const snapshotId = 'd'.repeat(64)
    stored.set(
      cache.pointerKey('7', 'city', HASH),
      JSON.stringify({ snapshotId, version: '9007199254740993' })
    )
    stored.set(
      cache.snapshotKey(snapshotId),
      JSON.stringify({
        version: 1,
        id: snapshotId,
        asOf: AS_OF.toISOString(),
        level: 'city',
        areaHash: HASH,
        entries: [],
      })
    )
    expect(Number('9007199254740993')).toBe(Number('9007199254740992'))
    await expect(
      cache.current('city', HASH, { epoch: '7', version: '9007199254740992' })
    ).resolves.toBeNull()
    await expect(
      cache.current('city', HASH, { epoch: '7', version: '9007199254740993' })
    ).resolves.toMatchObject({ id: snapshotId })
  })
})

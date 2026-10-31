// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Story 6.6: the pure City Spotlight rules. Database and Redis behavior is proven
// against real services in integration/community-spotlight*.integration.spec.ts.
import { describe, expect, it } from 'vitest'
import {
  areaComponentsOf,
  areaHash,
  areaHashesOf,
  availableAreaLevels,
  storedAreaComponents,
  viewerAreaLabel,
} from './community-spotlight-area'
import {
  CommunitySpotlightCache,
  randomCounterSeed,
  type SpotlightRedis,
} from './community-spotlight-cache'
import {
  communityPostToken,
  communitySubjectToken,
  spotlightOpenDedupeKey,
} from './community-analytics'
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

  it('6.6-UNIT-005 orders equal scores by non-author reactions desc, then equal counts by id desc', () => {
    // 1 / (2 + 2)^1.5 and 8 / (14 + 2)^1.5 are both exactly 0.125. The newer
    // post would win a published_at tiebreak, so only the reactions term puts
    // the older post first. Equal scores with equal counts imply equal ages,
    // so the published_at term never decides between distinct timestamps.
    const fewer = { id: 'post-z-fewer', reactions: 1, publishedAt: hoursBefore(2) }
    const more = { id: 'post-a-more', reactions: 8, publishedAt: hoursBefore(14) }
    expect(spotlightScore(fewer.reactions, 2)).toBe(0.125)
    expect(spotlightScore(more.reactions, 14)).toBe(0.125)
    const same = hoursBefore(5)
    const ranked = rankSpotlightEntries(AS_OF, [
      fewer,
      { id: 'post-a', reactions: 2, publishedAt: same },
      { id: 'post-c', reactions: 2, publishedAt: same },
      more,
      { id: 'post-self-only', reactions: 0, publishedAt: hoursBefore(1) },
    ])
    expect(ranked.map((entry) => entry.id)).toEqual([
      'post-a-more',
      'post-z-fewer',
      'post-c',
      'post-a',
    ])
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
  it('6.6-UNIT-008 resolves spelling variants of one place to one area', () => {
    const variants = [
      { country: 'USA', region: 'Illinois', city: 'Chicago' },
      { country: 'United States', region: ' ILLINOIS ', city: 'chicago' },
      { country: 'Estados Unidos', region: 'Illinois', city: 'Chicago' },
    ]
    for (const variant of variants) {
      expect(areaComponentsOf(variant)).toEqual({
        country: 'US',
        region: 'illinois',
        city: 'chicago',
      })
    }
    expect(
      areaComponentsOf({ country: 'Deutschland', region: 'Bayern', city: 'München' })
    ).toEqual({ country: 'DE', region: 'bayern', city: 'munchen' })
    const accented = areaComponentsOf({
      country: 'Brasil',
      region: 'SP',
      city: 'São Paulo',
    })
    const plain = areaComponentsOf({ country: 'Brazil', region: 'sp', city: 'Sao Paulo' })
    expect(areaHashesOf(accented)).toEqual(areaHashesOf(plain))
    const dotted = areaComponentsOf({
      country: 'Türkiye',
      region: 'İstanbul',
      city: 'İstanbul',
    })
    const dotless = areaComponentsOf({
      country: 'Turkey',
      region: 'Istanbul',
      city: 'ıstanbul',
    })
    expect(dotted).toEqual({ country: 'TR', region: 'istanbul', city: 'istanbul' })
    expect(areaHashesOf(dotted)).toEqual(areaHashesOf(dotless))
  })

  it('6.6-UNIT-009 keeps only the prefix whose parents exist or resolve', () => {
    expect(areaComponentsOf({ country: 'PT', region: null, city: 'Lisbon' })).toEqual({
      country: 'PT',
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
      areaComponentsOf({ country: 'Atlantis', region: 'Lisboa', city: 'Lisbon' })
    ).toEqual({ country: null, region: null, city: null })
    expect(
      availableAreaLevels(
        areaComponentsOf({ country: 'PT', region: 'Lisboa', city: null })
      )
    ).toEqual(['region', 'country'])
    expect(
      storedAreaComponents({
        area_country: null,
        area_region: 'lisboa',
        area_city: 'lisbon',
      })
    ).toEqual({ country: null, region: null, city: null })
    expect(
      storedAreaComponents({ area_country: 'PT', area_region: null, area_city: 'lisbon' })
    ).toEqual({ country: 'PT', region: null, city: null })
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

describe('6.6 spotlight open dedupe key', () => {
  it('6.6-UNIT-012 keys on HMAC tokens for viewer and post, never a raw id', () => {
    const key = spotlightOpenDedupeKey('viewer-raw-id', 'post-raw-id', 'community')
    expect(key).toBe(
      [
        'community_spotlight_opened',
        communitySubjectToken('viewer-raw-id'),
        communityPostToken('post-raw-id'),
        'community',
      ].join(':')
    )
    expect(key).toMatch(
      /^community_spotlight_opened:[0-9a-f]{16}:[0-9a-f]{16}:community$/
    )
    expect(key).not.toContain('viewer-raw-id')
    expect(key).not.toContain('post-raw-id')
    expect(communityPostToken('post-raw-id')).not.toBe(
      communitySubjectToken('post-raw-id')
    )
    expect(spotlightOpenDedupeKey('viewer-raw-id', 'post-raw-id', 'community')).toBe(key)
    expect(spotlightOpenDedupeKey('viewer-raw-id', 'other-post', 'community')).not.toBe(
      key
    )
    expect(spotlightOpenDedupeKey('other-viewer', 'post-raw-id', 'community')).not.toBe(
      key
    )
    // Story 6.7: the Home teaser and Community count as separate opens.
    expect(spotlightOpenDedupeKey('viewer-raw-id', 'post-raw-id', 'home_teaser')).toBe(
      key.replace(/:community$/, ':home_teaser')
    )
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

  it('6.6-UNIT-017 a same-ID rebuild overwrites the stored generations', async () => {
    const stored = new Map<string, string>()
    const redis: SpotlightRedis = {
      get: (key) => Promise.resolve(stored.get(key) ?? null),
      // Honors NX like Redis, so a create-only write would keep the old body.
      set: (key: string, value: string, ...modes: unknown[]) => {
        if (modes.includes('NX') && stored.has(key)) return Promise.resolve(null)
        stored.set(key, value)
        return Promise.resolve('OK')
      },
      eval: () => Promise.resolve(1),
    }
    const cache = new CommunitySpotlightCache(redis, 'unit')
    const counters = { epoch: '7', version: '11' }
    const snapshot = {
      version: 1 as const,
      id: 'e'.repeat(64),
      asOf: AS_OF.toISOString(),
      level: 'city' as const,
      areaHash: HASH,
      entries: [{ id: 'post-1', generation: 3 }],
    }
    await expect(cache.publish(snapshot, counters)).resolves.toBe(true)
    await cache.publish(
      { ...snapshot, entries: [{ id: 'post-1', generation: 4 }] },
      counters
    )
    await expect(cache.snapshot(snapshot.id)).resolves.toMatchObject({
      entries: [{ id: 'post-1', generation: 4 }],
    })
  })
})

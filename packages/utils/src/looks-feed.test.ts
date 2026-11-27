// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-UNIT-001..007, the newest-first merge of saved looks and
// capsules that web and native Looks both page through, plus the Ideas and sample week data.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import { describe, expect, it } from 'vitest'
import {
  EMPTY_LOOKS_FEED_SOURCE,
  LOOKS_FILTERS,
  LOOKS_SEGMENTS,
  capsuleTileState,
  compareLooksFeedEntries,
  looksIdeas,
  mergeLooksFeed,
  parseLooksFilter,
  parseLooksSegment,
  sampleWeek,
  savedLookTileState,
  type LooksFeedKind,
  type LooksFeedRecord,
  type LooksFeedSource,
} from './looks-feed'
import { SAMPLE_CATALOG } from './sample-wardrobe/catalog'

type Row = LooksFeedRecord & { readonly label: string }

const BASE = Date.parse('2026-11-01T12:00:00.000Z')

function row(id: string, minutesAfterBase: number): Row {
  return {
    id,
    createdAt: new Date(BASE + minutesAfterBase * 60_000).toISOString(),
    label: id,
  }
}

function complete<T extends LooksFeedRecord>(items: T[]): LooksFeedSource<T> {
  return { items, total: items.length, loaded: true }
}

function partial<T extends LooksFeedRecord>(
  items: T[],
  total: number
): LooksFeedSource<T> {
  return { items, total, loaded: true }
}

const UNREAD: LooksFeedSource<Row> = { items: [], total: 0, loaded: false }

function keys(view: {
  entries: readonly { kind: LooksFeedKind; id: string }[]
}): string[] {
  return view.entries.map((entry) => `${entry.kind}:${entry.id}`)
}

/** Server order for one kind: `created_at desc, id asc`. */
function serverOrder(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt)
    if (byTime !== 0) return byTime
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** Deterministic PRNG (mulberry32) so the property run is reproducible from its seed. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('7.12-UNIT-001 complete sources interleave newest first (AC2, D3)', () => {
  it('orders both kinds by createdAt desc and keeps every item exactly once', () => {
    const looks = [row('look-c', 30), row('look-a', 10)]
    const capsules = [row('capsule-b', 20)]

    const view = mergeLooksFeed(complete(looks), complete(capsules))

    expect(keys(view)).toEqual(['look:look-c', 'capsule:capsule-b', 'look:look-a'])
    expect(view.next).toBeNull()
    expect(view.entries[1]).toMatchObject({ kind: 'capsule', item: capsules[0] })
  })

  it('drops a repeated id within one kind (a page that overlaps the one before it)', () => {
    const look = row('look-a', 10)
    const capsule = row('capsule-a', 5)

    const view = mergeLooksFeed(complete([look, look]), complete([capsule, capsule]))

    expect(keys(view)).toEqual(['look:look-a', 'capsule:capsule-a'])
  })

  it('keeps a saved look and a capsule that share an id as two entries', () => {
    const view = mergeLooksFeed(complete([row('same', 2)]), complete([row('same', 1)]))

    expect(keys(view)).toEqual(['look:same', 'capsule:same'])
  })
})

describe('7.12-UNIT-002 boundary: nothing shows that an unloaded item could precede (D3)', () => {
  it('holds back a capsule older than the last loaded look while looks have more pages', () => {
    const looks = partial([row('look-4', 40), row('look-3', 30)], 4)
    const capsules = complete([row('capsule-35', 35), row('capsule-5', 5)])

    const view = mergeLooksFeed(looks, capsules)

    expect(keys(view)).toEqual(['look:look-4', 'capsule:capsule-35', 'look:look-3'])
    expect(view.next).toBe('look')
  })

  it('shows the held capsule after the next look page, in its place', () => {
    const looks = complete([
      row('look-4', 40),
      row('look-3', 30),
      row('look-2', 20),
      row('look-1', 1),
    ])
    const capsules = complete([row('capsule-35', 35), row('capsule-5', 5)])

    const view = mergeLooksFeed(looks, capsules)

    expect(keys(view)).toEqual([
      'look:look-4',
      'capsule:capsule-35',
      'look:look-3',
      'look:look-2',
      'capsule:capsule-5',
      'look:look-1',
    ])
    expect(view.next).toBeNull()
  })

  it('shows nothing until an unread source answers, and asks for that source', () => {
    const view = mergeLooksFeed(complete([row('look-1', 1)]), UNREAD)

    expect(view.entries).toEqual([])
    expect(view.next).toBe('capsule')
  })

  it('treats a loaded source with more pages but no items as blocking', () => {
    const view = mergeLooksFeed(partial<Row>([], 3), complete([row('capsule-1', 1)]))

    expect(view.entries).toEqual([])
    expect(view.next).toBe('look')
  })
})

describe('7.12-UNIT-003 next source names the list that limits the view (D3)', () => {
  it('picks the list whose last loaded item is newest when both have more', () => {
    const looks = partial([row('look-9', 90), row('look-8', 80)], 10)
    const capsules = partial([row('capsule-7', 70)], 5)

    const view = mergeLooksFeed(looks, capsules)

    expect(view.next).toBe('look')
    expect(keys(view)).toEqual(['look:look-9', 'look:look-8'])
  })

  it('picks capsules when their last loaded item is the newer limit', () => {
    const looks = partial([row('look-9', 90), row('look-1', 10)], 10)
    const capsules = partial([row('capsule-7', 70)], 5)

    const view = mergeLooksFeed(looks, capsules)

    expect(view.next).toBe('capsule')
    expect(keys(view)).toEqual(['look:look-9', 'capsule:capsule-7'])
  })

  it('reports no next source when both lists are complete', () => {
    expect(
      mergeLooksFeed(complete([row('a', 1)]), complete([row('b', 2)])).next
    ).toBeNull()
  })
})

describe('7.12-UNIT-004 exact ties: saved look before capsule, then id asc (D3, P3)', () => {
  it('puts the saved look first on an exact createdAt tie', () => {
    const view = mergeLooksFeed(
      complete([row('z-look', 10)]),
      complete([row('a-capsule', 10)])
    )

    expect(keys(view)).toEqual(['look:z-look', 'capsule:a-capsule'])
  })

  it('orders ties within one kind by id ascending, as the server does', () => {
    const view = mergeLooksFeed(
      complete([row('look-b', 10), row('look-a', 10)]),
      EMPTY_LOOKS_FEED_SOURCE
    )

    expect(keys(view)).toEqual(['look:look-a', 'look:look-b'])
  })

  it('returns the same view whichever source page arrived first', () => {
    const looks = partial([row('look-b', 10), row('look-c', 10)], 3)
    const capsules = complete([row('capsule-a', 10)])

    const first = mergeLooksFeed(looks, capsules)
    const again = mergeLooksFeed(
      { ...looks, items: [...looks.items].reverse() },
      { ...capsules, items: [...capsules.items] }
    )

    expect(keys(again)).toEqual(keys(first))
    // The look page may still hold a tied look-* id after look-c, so the capsule waits.
    expect(keys(first)).toEqual(['look:look-b', 'look:look-c'])
  })

  it('compares as equal only the same kind and id at the same time', () => {
    const entry = { kind: 'look' as const, id: 'x', createdAt: row('x', 1).createdAt }

    expect(compareLooksFeedEntries(entry, { ...entry })).toBe(0)
    expect(compareLooksFeedEntries(entry, { ...entry, id: 'w' })).toBeGreaterThan(0)
    expect(compareLooksFeedEntries(entry, { ...entry, kind: 'capsule' })).toBeLessThan(0)
  })

  it('sorts an unparsable createdAt as the oldest possible item', () => {
    const broken = { id: 'broken', createdAt: 'not-a-date' }

    const view = mergeLooksFeed(
      complete([broken, row('look-1', 1)]),
      EMPTY_LOOKS_FEED_SOURCE
    )

    expect(view.entries.map((entry) => entry.id)).toEqual(['look-1', 'broken'])
  })
})

describe('7.12-UNIT-005 property: Load more pages yield the global order with no gaps (AC2, D3)', () => {
  const PAGE = 50

  function run(seed: number, lookCount: number, capsuleCount: number) {
    const random = prng(seed)
    // Minute buckets small enough to force cross-kind and same-kind ties.
    const make = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) =>
        row(
          `${prefix}-${String(index).padStart(3, '0')}-${Math.floor(random() * 1e6)}`,
          Math.floor(random() * 40)
        )
      )
    const allLooks = serverOrder(make('look', lookCount))
    const allCapsules = serverOrder(make('capsule', capsuleCount))
    const expected = mergeLooksFeed(complete(allLooks), complete(allCapsules))

    let looks: LooksFeedSource<Row> = UNREAD
    let capsules: LooksFeedSource<Row> = UNREAD
    const shownSoFar: string[][] = []
    for (let step = 0; step < 20; step += 1) {
      const view = mergeLooksFeed(looks, capsules)
      shownSoFar.push(keys(view))
      if (view.next === null) break
      const target = view.next === 'look' ? allLooks : allCapsules
      const current = view.next === 'look' ? looks : capsules
      const items = target.slice(0, current.items.length + PAGE)
      const next = { items, total: target.length, loaded: true }
      if (view.next === 'look') looks = next
      else capsules = next
    }
    return { expected: keys(expected), shownSoFar }
  }

  it.each([
    [1, 60, 3],
    [7, 60, 3],
    [42, 3, 60],
    [99, 120, 75],
    [2026, 0, 51],
    [11, 51, 0],
  ])('seed %i with %i looks and %i capsules', (seed, lookCount, capsuleCount) => {
    const { expected, shownSoFar } = run(seed, lookCount, capsuleCount)

    // The last view is the full global order.
    expect(shownSoFar.at(-1)).toEqual(expected)
    // Every earlier view is a prefix of it: no tile is ever inserted above a shown one.
    for (const shown of shownSoFar) {
      expect(expected.slice(0, shown.length)).toEqual(shown)
    }
  })
})

describe('7.12-UNIT-006 one or both sources empty (D3, D4)', () => {
  it('pages one list alone when the other is the empty source (Capsules or Today filter)', () => {
    const view = mergeLooksFeed(
      EMPTY_LOOKS_FEED_SOURCE,
      partial([row('capsule-2', 2)], 2)
    )

    expect(keys(view)).toEqual(['capsule:capsule-2'])
    expect(view.next).toBe('capsule')
  })

  it('yields no entries and no next source for two empty lists', () => {
    expect(mergeLooksFeed(EMPTY_LOOKS_FEED_SOURCE, EMPTY_LOOKS_FEED_SOURCE)).toEqual({
      entries: [],
      next: null,
    })
  })

  it('exposes a complete empty source', () => {
    expect(EMPTY_LOOKS_FEED_SOURCE).toEqual({ items: [], total: 0, loaded: true })
  })
})

describe('7.12-UNIT-007 Ideas and the sample week come from the shared catalog (AC3, AC4, D9, D10)', () => {
  const garmentIds = new Set(SAMPLE_CATALOG.garments.map((garment) => garment.id))

  it('lists every sample look in catalog order with its garments resolved', () => {
    const ideas = looksIdeas()

    expect(ideas.map((idea) => idea.look.id)).toEqual(
      SAMPLE_CATALOG.looks.map((look) => look.id)
    )
    for (const idea of ideas) {
      expect(idea.garments.length).toBe(idea.look.core.length)
      expect(idea.garments.map((garment) => garment.id)).toEqual(idea.look.core)
      for (const garment of idea.garments) expect(garmentIds.has(garment.id)).toBe(true)
    }
  })

  it('gives seven days, offsets 0 to 6, each a catalog look', () => {
    const week = sampleWeek()
    const lookIds = new Set(SAMPLE_CATALOG.looks.map((look) => look.id))

    expect(week.map((day) => day.offset)).toEqual([0, 1, 2, 3, 4, 5, 6])
    for (const day of week) expect(lookIds.has(day.idea.look.id)).toBe(true)
  })

  it('is the same on every call (web and native render one week)', () => {
    expect(sampleWeek().map((day) => day.idea.look.id)).toEqual(
      sampleWeek().map((day) => day.idea.look.id)
    )
  })
})

describe('7.12-UNIT-030 tile state line, first match wins (AC2, D2)', () => {
  const at = '2026-11-20T12:00:00.000Z'

  it('a saved look: missing pieces, then needs review, else its saved date', () => {
    const base = {
      availabilityStatus: 'ready' as const,
      missingGarmentIds: [],
      createdAt: at,
    }
    expect(savedLookTileState(base)).toEqual({ kind: 'saved', createdAt: at })
    expect(savedLookTileState({ ...base, availabilityStatus: 'needs_review' })).toEqual({
      kind: 'needsReview',
    })
    expect(
      savedLookTileState({
        ...base,
        availabilityStatus: 'needs_review',
        missingGarmentIds: ['g1', 'g2'],
      })
    ).toEqual({ kind: 'missing', count: 2 })
    // A missing status without ids still reads one piece missing, never zero.
    expect(
      savedLookTileState({ ...base, availabilityStatus: 'missing_garment' })
    ).toEqual({
      kind: 'missing',
      count: 1,
    })
  })

  it('a capsule: unavailable pieces, else its saved date', () => {
    const base = {
      availabilityStatus: 'ready' as const,
      unavailableGarmentCount: 0,
      createdAt: at,
    }
    expect(capsuleTileState(base)).toEqual({ kind: 'saved', createdAt: at })
    expect(capsuleTileState({ ...base, unavailableGarmentCount: 3 })).toEqual({
      kind: 'missing',
      count: 3,
    })
    expect(capsuleTileState({ ...base, availabilityStatus: 'needs_repair' })).toEqual({
      kind: 'missing',
      count: 1,
    })
  })
})

describe('7.12-UNIT-023 address segment and filter parsing (D1, D4)', () => {
  it('accepts each known value and nothing else', () => {
    for (const segment of LOOKS_SEGMENTS) expect(parseLooksSegment(segment)).toBe(segment)
    for (const filter of LOOKS_FILTERS) expect(parseLooksFilter(filter)).toBe(filter)
    expect(LOOKS_SEGMENTS).toEqual(['saved', 'ideas', 'plan'])
    expect(LOOKS_FILTERS).toEqual(['all', 'today', 'capsules'])
  })

  it('an unknown, cased or non-string value falls back (segment none, filter all)', () => {
    for (const value of ['Saved', 'lookbook', '', null, undefined, 1, ['saved']]) {
      expect(parseLooksSegment(value)).toBeNull()
      expect(parseLooksFilter(value)).toBe('all')
    }
  })
})

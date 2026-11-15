// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 U-AGE-*, U-STATE-*, U-STORE-EPOCH and U-FROM-LITERAL.
import { describe, expect, it } from 'vitest'
import { SAMPLE_CATALOG } from './catalog'
import {
  createGuestPreviewState,
  evaluateGuestPreviewGate,
  GUEST_PREVIEW_CONVERSION_INTENT,
  GUEST_PREVIEW_MAX_BYTES,
  GUEST_PREVIEW_RETENTION_MS,
  guestPreviewStateSchema,
  isGuestPreviewExpired,
  parseGuestPreviewState,
  parsePreviewFrom,
  resetGuestPreviewState,
  serializeGuestPreviewState,
  toSampleSelectionInput,
  withoutConversionIntent,
  type GuestPreviewState,
} from './state'
import { createGuestPreviewStore, type GuestPreviewStorageAdapter } from './store'

const START = Date.UTC(2026, 10, 15, 9, 0, 0)
const HOUR = 60 * 60 * 1000
const TODAY = new Date(Date.UTC(2026, 10, 15, 9, 0, 0))

type Loose = { eligibility: Record<string, unknown>; weather?: string }
const loose = (text: string) => JSON.parse(text) as Loose

function stored(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ...createGuestPreviewState(START, SAMPLE_CATALOG),
    ...overrides,
  })
}

describe('guest gate (U-AGE-BOUNDARY, U-AGE-INVALID)', () => {
  it.each([
    ['2013-11-16', false, 'underage'],
    ['2013-11-15', true, undefined],
    ['2011-01-01', true, undefined],
    ['2010-11-15', true, undefined],
    ['1997-03-01', true, undefined],
  ])('%s gives eligible=%s', (birthdate, eligible, reason) => {
    expect(evaluateGuestPreviewGate(birthdate, TODAY)).toEqual(
      eligible ? { eligible: true } : { eligible: false, reason }
    )
  })

  it('handles a 29 February birthdate in a non-leap year', () => {
    expect(
      evaluateGuestPreviewGate('2012-02-29', new Date(Date.UTC(2025, 1, 28, 9)))
    ).toEqual({
      eligible: false,
      reason: 'underage',
    })
    expect(
      evaluateGuestPreviewGate('2012-02-29', new Date(Date.UTC(2025, 2, 1, 9)))
    ).toEqual({
      eligible: true,
    })
  })

  it.each(['2010-02-30', '2010-2-3', 'not a date', '2026-11-16'])(
    '%s is invalid',
    (birthdate) => {
      expect(evaluateGuestPreviewGate(birthdate, TODAY)).toEqual({
        eligible: false,
        reason: 'invalid',
      })
    }
  )

  it('treats an empty field as empty and accepts padded whitespace like signup does', () => {
    expect(evaluateGuestPreviewGate('   ', TODAY)).toEqual({
      eligible: false,
      reason: 'empty',
    })
    expect(evaluateGuestPreviewGate(' 2000-01-01 ', TODAY)).toEqual({ eligible: true })
  })
})

describe('guest preview state schema (U-STATE-STRICT, U-STATE-ELIGIBILITY)', () => {
  it('stores eligibility as exactly eligible and expiresAt, 24 hours after the start', () => {
    const state = createGuestPreviewState(START, SAMPLE_CATALOG)
    expect(loose(serializeGuestPreviewState(state)).eligibility).toEqual({
      eligible: true,
      expiresAt: START + GUEST_PREVIEW_RETENTION_MS,
    })
    expect(Object.keys(state).sort()).toEqual(
      [
        'catalogVersion',
        'collection',
        'comfort',
        'eligibility',
        'schemaVersion',
        'startedAt',
        'swaps',
        'view',
        'votes',
        'weather',
      ].sort()
    )
  })

  it.each(['birthdate', 'age', 'band'])('rejects an extra %s key', (key) => {
    expect(
      parseGuestPreviewState(stored({ [key]: 'x' }), START, SAMPLE_CATALOG)
    ).toBeNull()
    const nested = loose(stored())
    nested.eligibility[key] = 15
    expect(
      parseGuestPreviewState(JSON.stringify(nested), START, SAMPLE_CATALOG)
    ).toBeNull()
  })

  it('treats a non-literal eligible flag as no eligibility', () => {
    const state = loose(stored())
    state.eligibility.eligible = 'true'
    expect(
      parseGuestPreviewState(JSON.stringify(state), START, SAMPLE_CATALOG)
    ).toBeNull()
  })

  it('refuses a serialized state that fails the schema', () => {
    const bad = { ...createGuestPreviewState(START, SAMPLE_CATALOG), view: 'community' }
    expect(() =>
      serializeGuestPreviewState(bad as unknown as GuestPreviewState)
    ).toThrow()
    expect(guestPreviewStateSchema.safeParse(bad).success).toBe(false)
  })
})

describe('guest preview state limits (U-STATE-LIMITS, U-STATE-RETENTION)', () => {
  it('discards expired, malformed, oversized, wrong-version and stretched states', () => {
    const at = (offset: number) => START + offset
    expect(parseGuestPreviewState(null, START, SAMPLE_CATALOG)).toBeNull()
    expect(parseGuestPreviewState('{not json', START, SAMPLE_CATALOG)).toBeNull()
    expect(
      parseGuestPreviewState(
        'x'.repeat(GUEST_PREVIEW_MAX_BYTES + 1),
        START,
        SAMPLE_CATALOG
      )
    ).toBeNull()
    expect(
      parseGuestPreviewState(stored({ schemaVersion: 2 }), START, SAMPLE_CATALOG)
    ).toBeNull()
    expect(
      parseGuestPreviewState(
        stored({ catalogVersion: '2026-01-01.1' }),
        START,
        SAMPLE_CATALOG
      )
    ).toBeNull()
    expect(
      parseGuestPreviewState(stored(), at(GUEST_PREVIEW_RETENTION_MS), SAMPLE_CATALOG)
    ).toBeNull()
    expect(parseGuestPreviewState(stored(), at(-1), SAMPLE_CATALOG)).toBeNull()
    expect(
      parseGuestPreviewState(
        stored({ eligibility: { eligible: true, expiresAt: START + 48 * HOUR } }),
        START + 30 * HOUR,
        SAMPLE_CATALOG
      )
    ).toBeNull()
  })

  it('keeps a valid state up to the last minute of its window', () => {
    const late = START + 23 * HOUR + 59 * 60 * 1000
    expect(parseGuestPreviewState(stored(), late, SAMPLE_CATALOG)).toEqual(
      createGuestPreviewState(START, SAMPLE_CATALOG)
    )
  })

  it('never moves expiresAt on activity or reset (TEA-1)', async () => {
    let now = START
    const store = createGuestPreviewStore({
      adapter: memoryAdapter(),
      catalog: SAMPLE_CATALOG,
      now: () => now,
    })
    store.start()
    now = START + 23 * HOUR + 59 * 60 * 1000
    const updated = store.update((state) => ({ ...state, weather: 'warm-rainy' }))
    const reset = store.reset()
    expect(updated?.eligibility.expiresAt).toBe(START + GUEST_PREVIEW_RETENTION_MS)
    expect(reset?.eligibility.expiresAt).toBe(START + GUEST_PREVIEW_RETENTION_MS)
    expect(reset?.startedAt).toBe(START)
    expect(reset?.weather).toBe('mild-dry')
    await store.flush()
  })

  it('reports expiry at the 24-hour mark', () => {
    const state = createGuestPreviewState(START, SAMPLE_CATALOG)
    expect(isGuestPreviewExpired(state, START + GUEST_PREVIEW_RETENTION_MS - 1)).toBe(
      false
    )
    expect(isGuestPreviewExpired(state, START + GUEST_PREVIEW_RETENTION_MS)).toBe(true)
  })

  it('reset restores defaults and keeps eligibility', () => {
    const state: GuestPreviewState = {
      ...createGuestPreviewState(START, SAMPLE_CATALOG),
      weather: 'cool-windy',
      votes: { 'sample:l:city-wool': 'like' },
      conversion: { intent: 'guest-preview-carryover' },
    }
    expect(resetGuestPreviewState(state, SAMPLE_CATALOG)).toEqual(
      createGuestPreviewState(START, SAMPLE_CATALOG)
    )
  })
})

describe('guest preview ids (U-STATE-ID-ALLOWLIST)', () => {
  it('drops ids outside the current catalog and keeps the rest', () => {
    const raw = stored({
      selectedLookId: '../x',
      votes: {
        'sample:l:city-wool': 'like',
        'https://evil.example/x': 'like',
        'sample:g:loafers': 'dislike',
        'sample:l:nope': 'like',
      },
      swaps: {
        'sample:l:city-wool': { shoes: 'sample:g:loafers', top: 'sample:g:loafers' },
        'sample:l:office-oxford': { top: '../../etc/passwd' },
        'sample:l:../x': { top: 'sample:g:oxford-shirt' },
      },
    })
    const parsed = parseGuestPreviewState(raw, START, SAMPLE_CATALOG)
    expect(parsed?.selectedLookId).toBeUndefined()
    expect(parsed?.votes).toEqual({ 'sample:l:city-wool': 'like' })
    expect(parsed?.swaps).toEqual({ 'sample:l:city-wool': { shoes: 'sample:g:loafers' } })
  })

  it('keeps a valid selected look and rejects over-length ids', () => {
    expect(
      parseGuestPreviewState(
        stored({ selectedLookId: 'sample:l:city-wool' }),
        START,
        SAMPLE_CATALOG
      )?.selectedLookId
    ).toBe('sample:l:city-wool')
    expect(
      parseGuestPreviewState(
        stored({ selectedLookId: `sample:l:${'a'.repeat(80)}` }),
        START,
        SAMPLE_CATALOG
      )
    ).toBeNull()
  })

  it('maps state to selection input without inventing a selection', () => {
    const state = createGuestPreviewState(START, SAMPLE_CATALOG)
    expect(toSampleSelectionInput(state)).toEqual({
      weather: 'mild-dry',
      collection: 'all',
      comfort: state.comfort,
      votes: {},
      swaps: {},
    })
    expect(
      toSampleSelectionInput({ ...state, selectedLookId: 'sample:l:city-wool' })
        .selectedLookId
    ).toBe('sample:l:city-wool')
  })
})

describe('conversion intent removal (review F3)', () => {
  it('returns the same state with no intent, leaving the input unchanged', () => {
    const state: GuestPreviewState = {
      ...createGuestPreviewState(START, SAMPLE_CATALOG),
      conversion: { intent: GUEST_PREVIEW_CONVERSION_INTENT },
    }
    const next = withoutConversionIntent(state)
    expect(next).not.toHaveProperty('conversion')
    expect({ ...next, conversion: state.conversion }).toEqual(state)
    expect(state.conversion).toEqual({ intent: GUEST_PREVIEW_CONVERSION_INTENT })
  })
})

describe('preview return marker (U-FROM-LITERAL)', () => {
  it('honors only the exact literal', () => {
    expect(parsePreviewFrom('preview')).toBe('preview')
    for (const value of [
      'Preview',
      'preview2',
      'https://x',
      ' preview',
      '',
      undefined,
      null,
      ['preview'],
    ]) {
      expect(parsePreviewFrom(value)).toBeNull()
    }
  })
})

type Deferred = { resolve: () => void; reject: (error: Error) => void }

function memoryAdapter(initial: string | null = null) {
  let value = initial
  const writes: string[] = []
  let hold: Deferred[] | null = null
  let onHeld: (() => void) | null = null
  const gate = () =>
    hold
      ? new Promise<void>((resolve, reject) => {
          hold?.push({ resolve, reject })
          onHeld?.()
        })
      : Promise.resolve()
  const adapter: GuestPreviewStorageAdapter & {
    writes: string[]
    value: () => string | null
    holdNext: () => void
    /** Resolves once an operation is parked at the hold, i.e. it is in flight. */
    held: () => Promise<void>
    release: () => void
    failNext: () => void
  } = {
    writes,
    value: () => value,
    holdNext: () => {
      hold = []
    },
    held: () =>
      hold && hold.length > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            onHeld = () => {
              onHeld = null
              resolve()
            }
          }),
    release: () => {
      const pending = hold ?? []
      hold = null
      for (const entry of pending) entry.resolve()
    },
    failNext: () => {
      const pending = hold ?? []
      hold = null
      for (const entry of pending) entry.reject(new Error('quota'))
    },
    async read() {
      await gate()
      return value
    },
    async write(text) {
      await gate()
      writes.push(text)
      value = text
    },
    async remove() {
      await gate()
      value = null
    },
  }
  return adapter
}

describe('guest preview store (U-STORE-EPOCH, storage failure)', () => {
  it('loads a valid stored state and discards an invalid one from storage', async () => {
    const valid = memoryAdapter(stored({ weather: 'cool-windy' }))
    const store = createGuestPreviewStore({
      adapter: valid,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    expect((await store.load()).state?.weather).toBe('cool-windy')

    const invalid = memoryAdapter('{broken')
    const other = createGuestPreviewStore({
      adapter: invalid,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    expect((await other.load()).state).toBeNull()
    await other.flush()
    expect(invalid.value()).toBeNull()
  })

  it('drops a write queued before reset, so reset wins (L-RESET-THEN-WRITE)', async () => {
    const adapter = memoryAdapter()
    const store = createGuestPreviewStore({
      adapter,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    store.start()
    await store.flush()
    adapter.holdNext()
    store.update((state) => ({ ...state, weather: 'warm-rainy' }))
    await adapter.held()
    // warm-rainy is in flight; cool-windy is queued behind it and must be dropped.
    store.update((state) => ({ ...state, weather: 'cool-windy' }))
    const epoch = store.epoch()
    store.reset()
    expect(store.epoch()).toBe(epoch + 1)
    adapter.release()
    await store.flush()
    expect(loose(adapter.value() as string).weather).toBe('mild-dry')
    expect(adapter.writes.map((text) => loose(text).weather)).toEqual([
      'mild-dry',
      'warm-rainy',
      'mild-dry',
    ])
  })

  it('leaves nothing stored after clear, even with writes in flight (L-EXIT)', async () => {
    const adapter = memoryAdapter()
    const store = createGuestPreviewStore({
      adapter,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    store.start()
    adapter.holdNext()
    store.update((state) => ({ ...state, weather: 'warm-rainy' }))
    await adapter.held()
    store.clear()
    adapter.release()
    await store.flush()
    expect(adapter.value()).toBeNull()
    expect(store.snapshot().state).toBeNull()
    expect(store.update((state) => state)).toBeNull()
    expect(store.reset()).toBeNull()
  })

  it('ignores a load that finishes after a clear', async () => {
    const adapter = memoryAdapter(stored())
    const store = createGuestPreviewStore({
      adapter,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    adapter.holdNext()
    const loading = store.load()
    await adapter.held()
    store.clear()
    adapter.release()
    expect((await loading).state).toBeNull()
  })

  // Review F1: a load waits for the writes and removals queued before it, and never
  // replaces the in-memory state with what a failing or empty store returns.
  it('keeps an update that a load right after it would read before the write lands', async () => {
    const adapter = memoryAdapter(stored())
    const store = createGuestPreviewStore({
      adapter,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    await store.load()
    const ungatedRead = () => Promise.resolve(adapter.value())
    adapter.holdNext()
    store.update((state) => ({ ...state, weather: 'cool-windy' }))
    await adapter.held()
    adapter.read = ungatedRead
    const loading = store.load()
    adapter.release()
    expect((await loading).state?.weather).toBe('cool-windy')
    expect(store.snapshot().state?.weather).toBe('cool-windy')
  })

  it('does not bring back a cleared state that a load reads before the removal lands', async () => {
    const adapter = memoryAdapter(stored())
    const store = createGuestPreviewStore({
      adapter,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    await store.load()
    const ungatedRead = () => Promise.resolve(adapter.value())
    adapter.holdNext()
    store.clear()
    await adapter.held()
    adapter.read = ungatedRead
    const loading = store.load()
    adapter.release()
    expect((await loading).state).toBeNull()
    expect(adapter.value()).toBeNull()
  })

  // TEA G4: a load already reading when the update happens must not land over it.
  it('keeps an update made while a load is already reading', async () => {
    const adapter = memoryAdapter(stored())
    const store = createGuestPreviewStore({
      adapter,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    await store.load()
    adapter.holdNext()
    const loading = store.load()
    await adapter.held()
    store.update((state) => ({ ...state, weather: 'cool-windy' }))
    adapter.release()
    await loading
    await store.flush()
    expect(store.snapshot().state?.weather).toBe('cool-windy')
    expect(adapter.value()).toContain('cool-windy')
  })

  it('keeps the in-memory state when a later read throws', async () => {
    const adapter = memoryAdapter()
    const store = createGuestPreviewStore({
      adapter,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    const started = store.start()
    await store.flush()
    adapter.read = () => Promise.reject(new Error('denied'))
    const loaded = await store.load()
    expect(loaded.persistent).toBe(false)
    expect(loaded.state).toEqual(started)
  })

  it('keeps the in-memory state when storage failed and reads back nothing', async () => {
    const adapter = memoryAdapter()
    const store = createGuestPreviewStore({
      adapter,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    adapter.holdNext()
    const started = store.start()
    await adapter.held()
    adapter.failNext()
    await store.flush()
    expect(adapter.value()).toBeNull()
    expect((await store.load()).state).toEqual(started)
  })

  it('expires on access at 24 hours and removes the stored text (L-EXPIRY)', async () => {
    let now = START
    const adapter = memoryAdapter()
    const store = createGuestPreviewStore({
      adapter,
      catalog: SAMPLE_CATALOG,
      now: () => now,
    })
    store.start()
    await store.flush()
    now = START + GUEST_PREVIEW_RETENTION_MS
    expect(store.update((state) => ({ ...state, weather: 'warm-rainy' }))).toBeNull()
    expect(store.snapshot().state).toBeNull()
    await store.flush()
    expect(adapter.value()).toBeNull()
  })

  it('keeps working in memory when storage fails and says so (W/M-STORAGE-DENIED)', async () => {
    const adapter = memoryAdapter()
    const store = createGuestPreviewStore({
      adapter,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    const seen: boolean[] = []
    const unsubscribe = store.subscribe((snapshot) => seen.push(snapshot.persistent))
    adapter.holdNext()
    store.start()
    await adapter.held()
    adapter.failNext()
    await store.flush()
    expect(store.snapshot().persistent).toBe(false)
    expect(store.update((state) => ({ ...state, weather: 'cool-windy' }))?.weather).toBe(
      'cool-windy'
    )
    adapter.holdNext()
    store.update((state) => ({ ...state, weather: 'warm-rainy' }))
    await adapter.held()
    const emitted = seen.length
    adapter.failNext()
    await store.flush()
    // A second failure keeps the in-memory mode without announcing it again.
    expect(seen).toHaveLength(emitted)
    expect(seen).toContain(false)
    unsubscribe()
  })

  it('marks storage unavailable when reading throws', async () => {
    const adapter = memoryAdapter()
    adapter.read = () => Promise.reject(new Error('denied'))
    const store = createGuestPreviewStore({
      adapter,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    expect(await store.load()).toEqual({ state: null, persistent: false })
  })

  it('uses the wall clock by default', () => {
    const store = createGuestPreviewStore({
      adapter: memoryAdapter(),
      catalog: SAMPLE_CATALOG,
    })
    const before = Date.now()
    expect(store.start().startedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('guest preview store validation and other tabs (G1, G2)', () => {
  it('leaves state untouched when a change breaks the schema or the window (G2)', async () => {
    const store = createGuestPreviewStore({
      adapter: memoryAdapter(),
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    const started = store.start()
    const broken = store.update((state) => ({ ...state, view: 'community' as never }))
    expect(broken).toBe(started)
    const stretched = store.update((state) => ({
      ...state,
      startedAt: START + HOUR,
      eligibility: {
        eligible: true,
        expiresAt: START + HOUR + GUEST_PREVIEW_RETENTION_MS,
      },
    }))
    expect(stretched).toBe(started)
    expect(store.snapshot().state).toBe(started)
    await store.flush()
  })

  it('drops ids outside the catalog in memory, as a load would (G2)', async () => {
    const store = createGuestPreviewStore({
      adapter: memoryAdapter(),
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    store.start()
    const next = store.update((state) => ({
      ...state,
      selectedLookId: 'sample:l:nope',
      votes: { 'sample:l:city-wool': 'like', '../x': 'like' },
    }))
    expect(next?.selectedLookId).toBeUndefined()
    expect(next?.votes).toEqual({ 'sample:l:city-wool': 'like' })
    await store.flush()
  })

  it('adopts an exit made in another tab and drops its own queued write (L-CROSS-TAB-EXIT)', async () => {
    const shared = memoryAdapter()
    const tabA = createGuestPreviewStore({
      adapter: shared,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    const tabB = createGuestPreviewStore({
      adapter: shared,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    tabA.start()
    await tabA.flush()
    await tabB.load()
    shared.holdNext()
    tabA.update((state) => ({ ...state, weather: 'warm-rainy' }))
    await shared.held()
    tabA.update((state) => ({ ...state, weather: 'cool-windy' }))
    tabB.clear()
    const synced = tabA.syncExternal()
    shared.release()
    await tabB.flush()
    expect((await synced).state).toBeNull()
    await tabA.flush()
    expect(shared.value()).toBeNull()
    expect(tabA.update((state) => state)).toBeNull()
  })

  it('adopts a change made in another tab (L-CROSS-TAB-UPDATE)', async () => {
    const shared = memoryAdapter()
    const tabA = createGuestPreviewStore({
      adapter: shared,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    const tabB = createGuestPreviewStore({
      adapter: shared,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    tabA.start()
    await tabA.flush()
    await tabB.load()
    tabB.update((state) => ({ ...state, weather: 'cool-windy' }))
    await tabB.flush()
    expect((await tabA.syncExternal()).state?.weather).toBe('cool-windy')
  })

  it('keeps the newest sync when two arrive together, and survives a failed read', async () => {
    const shared = memoryAdapter(stored())
    const store = createGuestPreviewStore({
      adapter: shared,
      catalog: SAMPLE_CATALOG,
      now: () => START,
    })
    const first = store.syncExternal()
    const second = store.syncExternal()
    // The first sync is superseded before it runs, so only the second adopts storage.
    expect((await first).state).toBeNull()
    expect((await second).state).toEqual(createGuestPreviewState(START, SAMPLE_CATALOG))
    shared.read = () => Promise.reject(new Error('denied'))
    expect(await store.syncExternal()).toEqual({ state: null, persistent: false })
  })
})

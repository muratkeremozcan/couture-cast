// Learning path Step 80: AI-written look ideas.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-80-ai-written-look-ideas
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemberLookbook } from './member-lookbook'
import {
  createMemberLookbookRanking,
  memberLookbookRankingCandidates,
  memberLookbookRankingInput,
  presentMemberLookbookRanking,
  validateMemberLookbookRanking,
} from './member-lookbook-ranking'
import type { StyleProfileAnswers } from './style-profile'

const ideas = createMemberLookbook('mild-dry')
const candidates = memberLookbookRankingCandidates(ideas)
const ranking = [...candidates].reverse().map(({ lookId }, index) => ({
  lookId,
  description: [
    'A cozy mix for a mild day.',
    'A sporty mix for a mild day.',
    'A polished mix for a mild day.',
  ][index]!,
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('CC-7.23 lookbook ranking input and output', () => {
  it('sends coarse weather and the current profile, applying only today’s choices', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 27, 12))
    const profile: StyleProfileAnswers = {
      mood: 'classic',
      palette: 'neutral',
      texture: 'smooth',
      fit: 'fitted',
      avoid: ['leggings'],
    }

    expect(memberLookbookRankingInput('mild-dry', {})).toEqual({
      weather: 'mild-dry',
      profile: null,
    })
    expect(
      memberLookbookRankingInput('mild-dry', {
        profile,
        day: { date: '2026-11-26', mood: 'cozy', temperature: 'cool' },
      })
    ).toEqual({ weather: 'mild-dry', profile })
    expect(
      memberLookbookRankingInput('mild-rainy', {
        profile,
        day: { date: '2026-11-27', mood: 'cozy', temperature: 'cool' },
      })
    ).toEqual({ weather: 'cool-rainy', profile: { ...profile, mood: 'cozy' } })
    expect(
      memberLookbookRankingInput('mild-dry', {
        profile: null,
        day: { date: '2026-11-27', mood: 'cozy' },
      })
    ).toEqual({
      weather: 'mild-dry',
      profile: { mood: 'cozy', palette: null, texture: null, fit: null, avoid: [] },
    })
  })

  it('excludes slots without an eligible look from the provider candidates', () => {
    const [first, ...rest] = ideas
    const missing = { ...first!, result: { ...first!.result, look: null } }
    expect(memberLookbookRankingCandidates([missing, ...rest])).toEqual(
      candidates.slice(1)
    )
  })

  it('accepts weather-neutral descriptions on dry days and rain descriptions on rain days', () => {
    const rain = ranking.map((idea) => ({
      ...idea,
      description: 'A simple mix for a rainy day.',
    }))
    const neutral = ranking.map((idea) => ({
      ...idea,
      description: 'A simple mix for the day.',
    }))
    expect(validateMemberLookbookRanking(neutral, candidates, 'warm-dry')).toEqual(
      neutral
    )
    expect(validateMemberLookbookRanking(rain, candidates, 'mild-rainy')).toEqual(rain)
  })

  it('rejects malformed, unknown, repeated, and incomplete rankings', () => {
    const [first, ...rest] = ranking
    for (const invalid of [
      [{ ...first, description: 'Unapproved copy.' }, ...rest],
      [{ ...first, lookId: 'sample:l:unknown' }, ...rest],
      [ranking[1], ...rest],
      null,
    ]) {
      expect(validateMemberLookbookRanking(invalid, candidates, 'mild-dry')).toBeNull()
    }
    expect(
      validateMemberLookbookRanking(ranking, candidates.slice(1), 'mild-dry')
    ).toBeNull()
  })
})

describe('CC-7.23 lookbook ranking lifecycle', () => {
  it('discards a superseded request even when its transport resolves successfully', async () => {
    const state = createMemberLookbookRanking()
    const older = deferred<typeof ranking>()
    const newer = deferred<typeof ranking>()
    let olderSignal: AbortSignal | undefined
    state.request(
      'old-weather',
      () => true,
      (signal) => {
        olderSignal = signal
        return older.promise
      }
    )
    state.request(
      'new-weather',
      () => true,
      () => newer.promise
    )
    expect(olderSignal?.aborted).toBe(true)

    newer.resolve(ranking)
    await newer.promise
    expect(state.read()).toEqual({
      key: 'new-weather',
      ranking,
      presentation: 'automatic',
    })

    older.resolve([...ranking].reverse())
    await older.promise
    expect(state.read()).toEqual({
      key: 'new-weather',
      ranking,
      presentation: 'automatic',
    })
  })

  it('allows an explicit apply only for the current request and identity', async () => {
    const state = createMemberLookbookRanking()
    const pending = deferred<typeof ranking>()
    state.request(
      'current',
      () => true,
      () => pending.promise
    )
    state.markEdited()
    pending.resolve(ranking)
    await pending.promise
    expect(state.read()?.presentation).toBe('pending')

    const older = state.read()
    state.request(
      'current',
      () => true,
      () => Promise.resolve([...ranking])
    )
    await Promise.resolve()
    const current = state.read()
    expect(current?.presentation).toBe('pending')
    expect(presentMemberLookbookRanking(ideas, undefined, current)).toEqual({
      orderedIdeas: ideas,
      selected: ideas[0],
      pending: true,
      description: undefined,
    })
    state.apply(older, () => true)
    state.apply(current, () => false)
    expect(state.read()?.presentation).toBe('pending')
    state.apply(current, () => true)
    const chosenMood = ideas[1]!.mood
    expect(presentMemberLookbookRanking(ideas, chosenMood, state.read())).toEqual({
      orderedIdeas: [...ideas].reverse(),
      selected: ideas[1],
      pending: false,
      description: ranking[1]!.description,
    })
  })

  it('publishes the automatic ranking to subscribers and falls back if the next request fails', async () => {
    const state = createMemberLookbookRanking()
    const notify = vi.fn()
    const unsubscribe = state.subscribe(notify)
    expect(presentMemberLookbookRanking(ideas, undefined, state.read())).toEqual({
      orderedIdeas: ideas,
      selected: ideas[0],
      pending: false,
      description: undefined,
    })

    const resolved = Promise.resolve(ranking)
    state.request(
      'first',
      () => true,
      () => resolved
    )
    await resolved
    expect(notify).toHaveBeenCalledTimes(1)
    expect(presentMemberLookbookRanking(ideas, undefined, state.read())).toEqual({
      orderedIdeas: [...ideas].reverse(),
      selected: ideas[2],
      pending: false,
      description: ranking[0]!.description,
    })
    unsubscribe()

    const failed = Promise.reject(new Error('Synthetic transport failure'))
    state.request(
      'next',
      () => true,
      () => failed
    )
    await expect(failed).rejects.toThrow('Synthetic transport failure')
    expect(state.read()).toBeNull()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('cancels an abandoned request and holds the fallback after an empty response', async () => {
    const state = createMemberLookbookRanking()
    const request = deferred<typeof ranking>()
    const load = vi.fn((_signal: AbortSignal) => request.promise)
    const cleanup = state.request('first', () => true, load)
    cleanup()
    expect(load.mock.calls[0]?.[0].aborted).toBe(true)
    request.resolve(ranking)
    await request.promise
    expect(state.read()).toBeNull()

    const empty = Promise.resolve(null)
    state.request(
      'second',
      () => true,
      () => empty
    )
    await empty
    expect(state.read()).toBeNull()
    state.request('stale', () => false, load)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('rejects a ranking that misstates the weather for these candidates', () => {
    expect(validateMemberLookbookRanking(ranking, candidates, 'mild-dry')).toEqual(
      ranking
    )
    expect(validateMemberLookbookRanking(ranking, candidates, 'warm-dry')).toBeNull()
    expect(
      validateMemberLookbookRanking(
        ranking.map((idea) => ({
          ...idea,
          description: 'A simple mix for a rainy day.',
        })),
        candidates,
        'mild-dry'
      )
    ).toBeNull()
  })
})

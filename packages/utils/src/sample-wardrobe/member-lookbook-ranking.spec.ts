// Learning path Step 80: AI-written look ideas.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-80-ai-written-look-ideas
import { describe, expect, it } from 'vitest'
import { createMemberLookbook } from './member-lookbook'
import {
  createMemberLookbookRanking,
  memberLookbookRankingCandidates,
  presentMemberLookbookRanking,
  validateMemberLookbookRanking,
} from './member-lookbook-ranking'

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

describe('CC-7.23 lookbook ranking lifecycle', () => {
  it('discards a superseded request even when its transport resolves successfully', async () => {
    const state = createMemberLookbookRanking()
    const older = deferred<typeof ranking>()
    const newer = deferred<typeof ranking>()
    const abandon = state.request(
      'old-weather',
      () => true,
      () => older.promise
    )
    abandon()
    state.request(
      'new-weather',
      () => true,
      () => newer.promise
    )

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
    state.apply(older, () => true)
    state.apply(current, () => false)
    expect(state.read()?.presentation).toBe('pending')
    state.apply(current, () => true)
    const chosenMood = ideas[1]!.mood
    expect(presentMemberLookbookRanking(ideas, chosenMood, state.read())).toEqual({
      selected: ideas[1],
      pending: false,
      description: ranking[1]!.description,
    })
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

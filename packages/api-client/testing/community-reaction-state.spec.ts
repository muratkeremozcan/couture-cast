import { describe, expect, it, vi } from 'vitest'
import { CommunityReactionState } from '../src/community-reaction-state'
import type {
  CommunityReactionFeedItem,
  CommunityReactionSummary,
} from '../src/contracts/http/community'

const zero: CommunityReactionSummary = {
  counts: { applause: 0, love: 0, inspiration: 0 },
  total: 0,
  revision: 0,
  generation: 0,
  viewerReaction: null,
}
const one: CommunityReactionSummary = {
  ...zero,
  counts: { ...zero.counts, applause: 1 },
  total: 1,
  revision: 1,
  generation: 1,
  viewerReaction: 'applause',
}
const item: CommunityReactionFeedItem = {
  id: 'post',
  reactions: zero,
  status: 'published',
  caption: null,
  altText: 'Synthetic outfit.',
  climateBand: 'cold_dry',
  imageAccess: {
    url: 'https://fixtures.invalid/post.jpg',
    expiresAt: '2026-10-19T00:00:00Z',
  },
  createdAt: '2026-10-18T00:00:00Z',
  publishedAt: '2026-10-18T00:00:00Z',
  challengeId: null,
  author: { displayName: 'Synthetic member', isSelf: false },
}
function setup() {
  const mutate = vi.fn().mockResolvedValue({ summary: one, conflict: false })
  const onChange = vi.fn()
  const onAnnounce = vi.fn()
  const failureReason = vi.fn<(error: unknown) => string>().mockReturnValue('unknown')
  const state = new CommunityReactionState({
    mutate,
    onChange,
    onAnnounce,
    failureReason,
    newId: () => '63100000-0000-4000-8000-000000000001',
  })
  return { state, mutate, onChange, onAnnounce, failureReason }
}
const settled = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('screen-owned community reaction state', () => {
  it('shares confirmed snapshots across readers while preserving hidden/legacy omissions', () => {
    const { state, onChange } = setup()
    expect(state.current(item)).toBe(item)
    state.read({ ...item, reactions: one }, state.beginRead())
    expect(state.read(item, state.beginRead())?.reactions).toEqual(one)
    expect(onChange).toHaveBeenLastCalledWith('post', one)
    const generation = { ...one, generation: 2 }
    state.read({ ...item, reactions: generation }, state.beginRead())
    expect(
      state.read({ ...item, reactions: { ...one, revision: 2 } }, state.beginRead())
        ?.reactions
    ).toEqual(generation)
    const hidden = { ...item, reactions: undefined }
    expect(state.read(hidden, state.beginRead())).toBe(hidden)
    expect(state.current(hidden).reactions).toBeUndefined()
    expect(state.current(item).reactions).toBeUndefined()
    expect(onChange).toHaveBeenLastCalledWith('post', undefined)
    const stalePublic = state.beginRead()
    expect(state.read(hidden, state.beginRead())).toBe(hidden)
    expect(state.read(item, stalePublic)).toBeNull()
    const stale = state.beginRead()
    const owner = { ...hidden, status: 'withdrawn' as const }
    expect(state.read(owner, state.beginRead())).toBe(owner)
    expect(onChange).toHaveBeenLastCalledWith('post', undefined)
    expect(state.read(item, stale)).toBeNull()
  })

  it('fences every older read after 404 and permits subsequent public reads', () => {
    const { state, onChange } = setup()
    const old = state.beginRead()
    state.evict('post')
    expect(onChange).toHaveBeenCalledWith('post', null)
    expect(state.read(item, old)).toBeNull()
    expect(state.read(item, state.beginRead())).toEqual(item)
    expect(state.read(item, old)).toBeNull()
  })

  it('shares one pending request and settles after any invoking child disappears', async () => {
    const { state, mutate, onChange } = setup()
    let release!: (value: {
      summary: CommunityReactionSummary
      conflict: boolean
    }) => void
    mutate.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const listener = vi.fn()
    const unsubscribe = state.subscribe(listener)
    const initial = state.getVersion()
    state.controls('post').onSubmit()
    state.controls('post').onSubmit('love')
    expect(mutate).not.toHaveBeenCalled()
    state.read(item, state.beginRead())
    state.controls('post').onSubmit()
    expect(mutate).not.toHaveBeenCalled()
    state.controls('post').onSubmit('applause')
    state.controls('post').onSubmit('love')
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(state.controls('post').pending).toBe(true)
    unsubscribe()
    release({ summary: one, conflict: false })
    await settled()
    expect(onChange).toHaveBeenLastCalledWith('post', one)
    expect(state.controls('post').pending).toBe(false)
    expect(state.getVersion()).toBe(initial + 2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('retracts the selected reaction and reconciles a conflict without a retained retry', async () => {
    const { state, mutate, onAnnounce } = setup()
    state.read({ ...item, reactions: one }, state.beginRead())
    mutate.mockResolvedValue({
      summary: { ...zero, revision: 2, generation: 2 },
      conflict: true,
    })
    state.controls('post').onSubmit('applause')
    await settled()
    expect(mutate).toHaveBeenCalledWith(
      'post',
      expect.objectContaining({ selection: null, baseRevision: 1 })
    )
    expect(state.controls('post')).toMatchObject({
      pending: false,
      canRetry: false,
      errorKey: 'community.reactions.conflict',
    })
    expect(onAnnounce).toHaveBeenCalledWith('community.reactions.conflict', false)
  })

  it('retains the identical failed payload across a newer read and blocks new intents until retry', async () => {
    const { state, mutate, onAnnounce } = setup()
    state.read(item, state.beginRead())
    mutate.mockRejectedValueOnce(new Error('offline'))
    state.controls('post').onSubmit('love')
    await settled()
    const first: unknown = mutate.mock.calls[0]?.[1]
    expect(state.controls('post').canRetry).toBe(true)
    state.read({ ...item, reactions: one }, state.beginRead())
    state.controls('post').onSubmit('inspiration')
    expect(mutate).toHaveBeenCalledTimes(1)
    state.controls('post').onSubmit()
    await settled()
    expect(mutate.mock.calls[1]?.[1]).toBe(first)
    expect(onAnnounce).toHaveBeenLastCalledWith('community.reactions.updated', true)
  })

  it.each([
    ['age_gate', 'community.reactions.ineligible'],
    ['disabled', 'community.error.disabled'],
    ['signed_out', 'community.error.signedOut'],
    ['rate_limited', 'community.reactions.rateLimited'],
    ['unexpected', 'community.reactions.failed'],
  ])(
    'clears refused intent for %s and exposes localized recovery',
    async (reason, key) => {
      const { state, mutate, failureReason, onAnnounce } = setup()
      state.read(item, state.beginRead())
      failureReason.mockReturnValue(reason)
      mutate.mockRejectedValue('refused')
      state.controls('post').onSubmit('love')
      await settled()
      expect(state.controls('post')).toMatchObject({
        errorKey: key,
        canRetry: false,
        pending: false,
      })
      expect(onAnnounce).toHaveBeenCalledWith(key, false)
    }
  )

  it('evicts all copies after mutation 404 and rejects a stale mutation response', async () => {
    const { state, mutate, failureReason, onChange } = setup()
    state.read(item, state.beginRead())
    failureReason.mockReturnValue('not_found')
    mutate.mockRejectedValueOnce(new Error('gone'))
    state.controls('post').onSubmit('love')
    await settled()
    expect(onChange).toHaveBeenLastCalledWith('post', null)
    state.read({ ...item, reactions: one }, state.beginRead())
    mutate.mockResolvedValue({ summary: zero, conflict: false })
    state.controls('post').onSubmit('love')
    await settled()
    expect(onChange).toHaveBeenLastCalledWith('post', one)
  })
  it.each([false, true])(
    'keeps an authoritative omission when an older mutation settles with failure=%s',
    async (failed) => {
      const { state, mutate, onChange, onAnnounce } = setup()
      let resolve!: (value: {
        summary: CommunityReactionSummary
        conflict: boolean
      }) => void
      let reject!: (reason: Error) => void
      mutate.mockReturnValue(
        new Promise((accept, refuse) => {
          resolve = accept
          reject = refuse
        })
      )
      state.read(item, state.beginRead())
      state.controls('post').onSubmit('love')
      const omitted = { ...item, reactions: undefined }
      state.read(omitted, state.beginRead())
      onChange.mockClear()
      if (failed) reject(new Error('offline'))
      else resolve({ summary: one, conflict: false })
      await settled()
      expect(state.current(item).reactions).toBeUndefined()
      expect(onChange).not.toHaveBeenCalled()
      expect(onAnnounce).not.toHaveBeenCalled()
      expect(state.controls('post')).toMatchObject({ pending: false, canRetry: false })
    }
  )
})

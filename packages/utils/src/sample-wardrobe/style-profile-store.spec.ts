// Learning path Step 77: Account style profile.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-77-account-style-profile
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStyleProfileStore } from './style-profile-store'
import type { StyleProfileAnswers } from './style-profile'

const EMPTY: StyleProfileAnswers = {
  mood: null,
  palette: null,
  texture: null,
  fit: null,
  avoid: [],
}

describe('CC-7.20 account style state', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('[7.20-ACCOUNT] retries a failed read and retains the last saved answers when a write fails', async () => {
    const saved: StyleProfileAnswers = { ...EMPTY, mood: 'classic' }
    const request = vi
      .fn<Parameters<typeof createStyleProfileStore>[1]>()
      .mockRejectedValueOnce(new Error('profile unavailable'))
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(saved)
      .mockRejectedValueOnce(new Error('write unavailable'))
      .mockResolvedValueOnce(EMPTY)
    const store = createStyleProfileStore(() => 'member', request)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    expect(store.read()).toEqual({
      profile: null,
      status: 'idle',
      saving: false,
      day: null,
    })
    const failedRead = store.load('member')
    expect(store.read().status).toBe('loading')
    await expect(store.save('member', { mood: 'cozy' })).resolves.toBe(false)
    await expect(failedRead).resolves.toBe(false)
    expect(store.read()).toMatchObject({ status: 'failed', profile: null })

    await expect(store.load('member')).resolves.toBe(true)
    expect(store.read()).toMatchObject({ status: 'ready', profile: EMPTY })
    await expect(store.load('member')).resolves.toBe(true)
    expect(request).toHaveBeenCalledTimes(2)

    const update = store.save('member', { mood: 'classic' })
    expect(store.read().saving).toBe(true)
    await expect(store.clear('member')).resolves.toBe(false)
    await expect(update).resolves.toBe(true)
    expect(store.read()).toMatchObject({ status: 'ready', profile: saved, saving: false })
    await expect(store.save('member', { mood: 'cozy' })).resolves.toBe(false)
    expect(store.read()).toMatchObject({ status: 'ready', profile: saved, saving: false })

    expect(listener).toHaveBeenCalled()
    unsubscribe()
    listener.mockClear()
    await expect(store.clear('member')).resolves.toBe(true)
    expect(store.read()).toMatchObject({ status: 'ready', profile: EMPTY, saving: false })
    expect(listener).not.toHaveBeenCalled()
    expect(request.mock.calls).toEqual([
      ['member', { method: 'GET' }],
      ['member', { method: 'GET' }],
      ['member', { method: 'PATCH', input: { mood: 'classic' } }],
      ['member', { method: 'PATCH', input: { mood: 'cozy' } }],
      ['member', { method: 'DELETE' }],
    ])
  })

  it.each(['success', 'failure'] as const)(
    '[7.20-ACCOUNT] discards a stale %s after the authenticated scope changes',
    async (outcome) => {
      const first: StyleProfileAnswers = { ...EMPTY, mood: 'cozy' }
      const second: StyleProfileAnswers = { ...EMPTY, mood: 'chic' }
      let finishFirst!: () => void
      const response = new Promise<StyleProfileAnswers>((resolve, reject) => {
        finishFirst = () => {
          if (outcome === 'success') resolve(first)
          else reject(new Error('first request failed'))
        }
      })
      let scope = 'first'
      const request = vi
        .fn<Parameters<typeof createStyleProfileStore>[1]>()
        .mockReturnValueOnce(response)
        .mockResolvedValueOnce(second)
      const store = createStyleProfileStore(() => scope, request)
      const pending = store.load('first')
      store.updateDay('first', { mood: 'active' })
      expect(store.read().day?.mood).toBe('active')

      scope = 'second'
      expect(store.read()).toMatchObject({ status: 'idle', profile: null, day: null })
      store.updateDay('first', { temperature: 'warm' })
      expect(store.read().day).toBeNull()
      await expect(store.save('first', { mood: 'cozy' })).resolves.toBe(false)
      await expect(store.load('second')).resolves.toBe(true)
      finishFirst()
      await expect(pending).resolves.toBe(false)
      expect(store.read()).toMatchObject({ status: 'ready', profile: second, day: null })
      expect(request.mock.calls).toEqual([
        ['first', { method: 'GET' }],
        ['second', { method: 'GET' }],
      ])
    }
  )

  it('[7.20-DAY] merges day choices, resets them, and notifies mounted screens at midnight', () => {
    vi.setSystemTime(new Date(2026, 10, 20, 23, 59, 58))
    const request = vi.fn<Parameters<typeof createStyleProfileStore>[1]>()
    const store = createStyleProfileStore(() => 'member', request)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.updateDay('member', { mood: 'cozy' })
    store.updateDay('member', { temperature: 'warm' })
    expect(store.read().day).toEqual({
      date: '2026-11-20',
      mood: 'cozy',
      temperature: 'warm',
    })
    store.updateDay('member', null)
    expect(store.read().day).toBeNull()
    expect(vi.getTimerCount()).toBe(0)

    store.updateDay('member', { mood: 'chic', temperature: 'cool' })
    vi.advanceTimersByTime(1_999)
    expect(store.read().day).toEqual({
      date: '2026-11-20',
      mood: 'chic',
      temperature: 'cool',
    })
    listener.mockClear()
    vi.advanceTimersByTime(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.read().day).toBeNull()
    expect(request).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('[7.20-ACCOUNT] notifies mounted screens when a scope change clears answers and overrides', async () => {
    let scope = 'first'
    const request = vi
      .fn<Parameters<typeof createStyleProfileStore>[1]>()
      .mockResolvedValue({ ...EMPTY, mood: 'cozy' })
    const store = createStyleProfileStore(() => scope, request)
    await store.load(scope)
    store.updateDay(scope, { temperature: 'cool' })
    const listener = vi.fn(store.read)
    const unsubscribe = store.subscribe(listener)

    scope = 'second'
    store.refreshDay()

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveReturnedWith({
      profile: null,
      status: 'idle',
      saving: false,
      day: null,
    })
    expect(vi.getTimerCount()).toBe(0)
    unsubscribe()
  })
})

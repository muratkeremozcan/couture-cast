import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenException } from '@nestjs/common'
import {
  CommunityAuthorizationBudget,
  CommunityUnavailableException,
  communityDependency,
  optionalCommunityAssist,
} from './community-availability.js'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
describe('community dependency and final authorization ownership', () => {
  it('rejects an expired grant even while its invocation budget remains', () => {
    const budget = new CommunityAuthorizationBudget(performance.now() + 1000)
    expect(() =>
      budget.check({
        value: true,
        expiresAt: new Date(Date.now() + 1000),
        validUntil: performance.now() - 1,
      })
    ).toThrow(CommunityUnavailableException)
  })
  it('preserves explicit denials and classifies unknown dependency failures unavailable', async () => {
    const denied = new ForbiddenException('denied')
    await expect(communityDependency(() => Promise.reject(denied))).rejects.toBe(denied)
    await expect(
      communityDependency(() => Promise.reject(new Error('database offline')))
    ).rejects.toBeInstanceOf(CommunityUnavailableException)
  })
  it('bounds a held optional assist, tolerates failure, and clears successful assist timers', async () => {
    vi.useFakeTimers()
    await optionalCommunityAssist(() => Promise.resolve())
    await optionalCommunityAssist(() => Promise.reject(new Error('optional offline')))
    expect(vi.getTimerCount()).toBe(0)
    const held = optionalCommunityAssist(() => new Promise(() => undefined))
    await vi.advanceTimersByTimeAsync(500)
    await held
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects synchronous invocation failure without leaving a timer', async () => {
    vi.useFakeTimers()
    const error = new Error('dependency setup')
    await expect(
      new CommunityAuthorizationBudget().run(() => {
        throw error
      })
    ).rejects.toBe(error)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rechecks monotonic remaining time when an early timer fires', async () => {
    vi.useFakeTimers()
    let clock = 100
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const budget = new CommunityAuthorizationBudget(110)
    const flight = expect(
      budget.run(() => new Promise(() => undefined))
    ).rejects.toBeInstanceOf(CommunityUnavailableException)
    clock = 105
    await vi.advanceTimersByTimeAsync(10)
    clock = 111
    await vi.advanceTimersByTimeAsync(5)
    await flight
    expect(vi.getTimerCount()).toBe(0)
  })
})

// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  CommunityAuthorizationBudget,
  CommunityConnectionGate,
  CommunityUnavailableException,
  communityAvailabilityLogger,
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
  it('logs the cause behind an unavailable answer, and nothing for a denial', async () => {
    const warn = vi
      .spyOn(communityAvailabilityLogger, 'warn')
      .mockImplementation(() => undefined)
    const poolWait = new Prisma.PrismaClientKnownRequestError(
      'Transaction API error: Unable to start a transaction in the given time.',
      { code: 'P2028', clientVersion: 'test' }
    )
    await expect(
      communityDependency(() => Promise.reject(poolWait))
    ).rejects.toBeInstanceOf(CommunityUnavailableException)
    expect(warn).toHaveBeenCalledWith(
      {
        cause: {
          type: 'PrismaClientKnownRequestError',
          prismaCode: 'P2028',
          sqlState: null,
        },
      },
      'community_dependency_unavailable'
    )
    warn.mockClear()
    await expect(
      communityDependency(() => Promise.reject(new ForbiddenException('denied')))
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(warn).not.toHaveBeenCalled()
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
describe('community connection gate', () => {
  const held = () => {
    let release!: () => void
    const done = new Promise<void>((resolve) => (release = resolve))
    return { done, release }
  }
  it('runs work at once on a budget without a gate', async () => {
    await expect(
      new CommunityAuthorizationBudget().connection(() => Promise.resolve('ran'))
    ).resolves.toBe('ran')
  })
  it('admits up to its capacity, then hands each freed slot to the earliest deadline', async () => {
    const gate = new CommunityConnectionGate(2)
    const now = performance.now()
    const order: string[] = []
    const first = held()
    const second = held()
    const busy = [
      new CommunityAuthorizationBudget(now + 1000, gate).connection(() => first.done),
      new CommunityAuthorizationBudget(now + 1000, gate).connection(() => second.done),
    ]
    const queued = (name: string, deadline: number) =>
      new CommunityAuthorizationBudget(deadline, gate).connection(() => {
        order.push(name)
        return Promise.resolve()
      })
    // Arrival order is late, tied-first, early, tied-second.
    const late = queued('late', now + 900)
    const tiedFirst = queued('tied first', now + 600)
    const early = queued('early', now + 300)
    const tiedSecond = queued('tied second', now + 600)
    await Promise.resolve()
    expect(order).toEqual([])
    first.release()
    second.release()
    await Promise.all([...busy, late, tiedFirst, early, tiedSecond])
    expect(order).toEqual(['early', 'tied first', 'tied second', 'late'])
  })
  it('releases its slot when the work fails', async () => {
    const gate = new CommunityConnectionGate(1)
    const budget = () => new CommunityAuthorizationBudget(performance.now() + 1000, gate)
    const failure = new Error('transaction failed')
    await expect(budget().connection(() => Promise.reject(failure))).rejects.toBe(failure)
    await expect(budget().connection(() => Promise.resolve('next'))).resolves.toBe('next')
  })
  it('refuses an expired budget and drops a waiter at its deadline', async () => {
    vi.useFakeTimers()
    let clock = 100
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const gate = new CommunityConnectionGate(1)
    await expect(
      new CommunityAuthorizationBudget(50, gate).connection(() => Promise.resolve())
    ).rejects.toBeInstanceOf(CommunityUnavailableException)
    const holder = held()
    const holding = new CommunityAuthorizationBudget(10_000, gate).connection(
      () => holder.done
    )
    const ran = vi.fn(() => Promise.resolve())
    const waiting = expect(
      new CommunityAuthorizationBudget(120, gate).connection(ran)
    ).rejects.toBeInstanceOf(CommunityUnavailableException)
    // A timer that fires before the monotonic deadline waits again.
    clock = 110
    await vi.advanceTimersByTimeAsync(20)
    clock = 121
    await vi.advanceTimersByTimeAsync(10)
    await waiting
    expect(vi.getTimerCount()).toBe(0)
    holder.release()
    await holding
    expect(ran).not.toHaveBeenCalled()
    // The expired waiter no longer holds a place: the slot is free again.
    await expect(
      new CommunityAuthorizationBudget(10_000, gate).connection(() =>
        Promise.resolve('free')
      )
    ).resolves.toBe('free')
  })
})

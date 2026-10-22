// Story 6.5 owner: cross-process rollout evaluation against real PostgreSQL claims.
//
// The wall-clock 45/60 timeline is the acceptance lane. These CI cases pin the cache
// invariants (one claim across instances, original expiry, no synthetic value on outage,
// bounded reads) and the claim coordination branches every request takes: an unknown
// member, a second instance waiting on another owner's refresh, and a caller that joined
// a shorter-lived flight.
import 'reflect-metadata'
import { PrismaClient, type Prisma } from '@prisma/client'
import { createUser, persistUser } from '@couture/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { until } from './helpers/community-engagement-harness.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import {
  CommunityAuthorizationBudget,
  CommunityUnavailableException,
} from '../src/modules/community/community-availability.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })

beforeAll(async () => {
  await database.migrate()
}, 60_000)
afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

const remote = {
  getFeatureFlagValue: vi.fn<() => Promise<unknown>>().mockResolvedValue(true),
}
const a = new CommunityFlagEvaluationService(prisma, remote)
const b = new CommunityFlagEvaluationService(prisma, remote)
const member = async () =>
  (
    await persistUser(
      prisma,
      createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
    )
  ).id
function heldRemote() {
  let release!: (value: boolean) => void
  const answer = new Promise<boolean>((resolve) => {
    release = resolve
  })
  let calls = 0
  return {
    provider: {
      getFeatureFlagValue: () => {
        calls++
        return answer
      },
    },
    release: (value: boolean) => release(value),
    calls: () => calls,
  }
}

describe('community flag evaluation claims', () => {
  it('reports an unknown member as unavailable with the default retry, without a remote call', async () => {
    const remote = heldRemote()
    const service = new CommunityFlagEvaluationService(prisma, remote.provider)
    const outcome = await service
      .evaluate('member-without-subject')
      .catch((error: unknown) => error)
    expect(outcome).toBeInstanceOf(CommunityUnavailableException)
    expect((outcome as CommunityUnavailableException).retryAfterSeconds).toBe(2)
    expect(remote.calls()).toBe(0)
  })

  it('serves a second instance the refresh another instance owns once it lands', async () => {
    const id = await member()
    const remote = heldRemote()
    const owner = new CommunityFlagEvaluationService(prisma, remote.provider)
    const waiter = new CommunityFlagEvaluationService(prisma, remote.provider)
    const owned = owner.evaluate(id)
    await until(
      () => Promise.resolve(remote.calls()),
      (calls) => calls === 1,
      2000
    )
    // The second instance finds the live claim and waits on it instead of claiming again.
    const waiting = waiter.evaluate(id)
    setTimeout(() => remote.release(true), 150)
    const [first, second] = await Promise.all([owned, waiting])
    expect(first.value).toBe(true)
    expect(second.value).toBe(true)
    expect(second.expiresAt.getTime()).toBe(first.expiresAt.getTime())
    expect(remote.calls()).toBe(1)
  })

  it('reports unavailable with the claim cadence when another owner never lands its refresh', async () => {
    const id = await member()
    const remote = heldRemote()
    const owner = new CommunityFlagEvaluationService(prisma, remote.provider)
    const waiter = new CommunityFlagEvaluationService(prisma, remote.provider)
    const owned = owner.evaluate(id).catch((error: unknown) => error)
    await until(
      () => Promise.resolve(remote.calls()),
      (calls) => calls === 1,
      2000
    )
    const outcome = await waiter.evaluate(id).catch((error: unknown) => error)
    expect(outcome).toBeInstanceOf(CommunityUnavailableException)
    // The claim set the next claim 45 s out; the retry names that cadence, not 2 s.
    expect((outcome as CommunityUnavailableException).retryAfterSeconds).toBeGreaterThan(
      40
    )
    expect(await owned).toBeInstanceOf(CommunityUnavailableException)
    remote.release(true)
    expect(remote.calls()).toBe(1)
  })

  it('lets a caller with a longer budget retry when the flight it joined expires first', async () => {
    const id = await member()
    const remote = heldRemote()
    const service = new CommunityFlagEvaluationService(prisma, remote.provider)
    const short = service
      .evaluate(id, new CommunityAuthorizationBudget(performance.now() + 300))
      .catch((error: unknown) => error)
    await until(
      () => Promise.resolve(remote.calls()),
      (calls) => calls === 1,
      2000
    )
    // Joins the in-flight evaluation, which carries the shorter deadline.
    const long = service.evaluate(id).catch((error: unknown) => error)
    expect(await short).toBeInstanceOf(CommunityUnavailableException)
    const outcome = await long
    // The joined flight failed at its own deadline; the longer caller started its own
    // evaluation rather than inheriting that failure, and is bounded by its own budget.
    expect(outcome).toBeInstanceOf(CommunityUnavailableException)
    expect((outcome as CommunityUnavailableException).retryAfterSeconds).toBeGreaterThan(
      40
    )
    remote.release(true)
  })
})

describe('Story 6.5 remote-only shared flag cache', () => {
  it('A12 a later live waiter re-resolves after the first callers expired DB-read budget', async () => {
    const id = await member()
    remote.getFeatureFlagValue.mockResolvedValue(true)
    const original = await a.evaluate(id)
    remote.getFeatureFlagValue.mockClear()
    let entered!: () => void
    const readStarted = new Promise<void>((resolve) => {
      entered = resolve
    })
    let firstRead = true
    const observed = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === '$transaction')
          return async (
            work: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options?: { timeout?: number; maxWait?: number }
          ) => {
            const result = await target.$transaction(work, options)
            if (firstRead) {
              firstRead = false
              entered()
              await new Promise((resolve) => setTimeout(resolve, 120))
            }
            return result
          }
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const evaluator = new CommunityFlagEvaluationService(observed, remote)
    const first = evaluator.evaluate(
      id,
      new CommunityAuthorizationBudget(performance.now() + 50)
    )
    const firstResult = expect(first).rejects.toMatchObject({ status: 503 })
    await readStarted
    const later = evaluator.evaluate(id)
    await firstResult
    const grant = await later
    expect(grant.value).toBe(true)
    expect(grant.expiresAt).toEqual(original.expiresAt)
    expect(remote.getFeatureFlagValue).not.toHaveBeenCalled()
  })

  it('R03 bounds a delayed cached read before it can return an affirmative grant', async () => {
    const read = () =>
      new Promise<unknown[]>((resolve) =>
        setTimeout(
          () =>
            resolve([
              {
                remote_value: true,
                expires_at: new Date(Date.now() + 60000),
                now: new Date(),
                remote_evaluated_at: new Date(),
              },
            ]),
          2100
        )
      )
    const tx = { $executeRawUnsafe: () => Promise.resolve(0), $queryRaw: read }
    const delayed = new CommunityFlagEvaluationService(
      {
        ...tx,
        $transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx),
      } as never,
      remote
    )
    const start = performance.now()
    await expect(delayed.evaluate('held-member')).rejects.toMatchObject({ status: 503 })
    expect(performance.now() - start).toBeLessThanOrEqual(2000)
  })
  it('R03 uses one local monotonic second for invocation despite app/database clock skew', async () => {
    const id = await member()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 3600000)
    remote.getFeatureFlagValue
      .mockClear()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(true), 1100))
      )
    try {
      await expect(a.evaluate(id)).rejects.toMatchObject({ status: 503 })
      expect(remote.getFeatureFlagValue).toHaveBeenCalledTimes(1)
      expect(
        await prisma.communityFlagEvaluation.findUnique({
          where: {
            member_id_flag_key: { member_id: id, flag_key: 'community_read_enabled' },
          },
        })
      ).toMatchObject({ remote_value: null, refresh_owner: null, refresh_until: null })
    } finally {
      clock.mockRestore()
      remote.getFeatureFlagValue.mockResolvedValue(true)
    }
  })
  it('6.5-INT-010: cold requests across instances join one claim and keep its original expiry', async () => {
    const id = await member()
    remote.getFeatureFlagValue.mockClear().mockResolvedValue(true)
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).evaluate(id))
    )
    expect(results.every((r) => r.value)).toBe(true)
    expect(remote.getFeatureFlagValue).toHaveBeenCalledTimes(1)
    const row = await prisma.communityFlagEvaluation.findUniqueOrThrow({
      where: {
        member_id_flag_key: { member_id: id, flag_key: 'community_read_enabled' },
      },
    })
    expect(row.expires_at!.getTime() - row.remote_evaluated_at!.getTime()).toBe(60_000)
    expect(row.next_claim_at.getTime() - row.remote_evaluated_at!.getTime()).toBe(45_000)
  })

  it('6.5-INT-011: successful false denies, outage cannot consume synthetic fallback or extend expiry', async () => {
    const id = await member()
    remote.getFeatureFlagValue.mockClear().mockResolvedValue(false)
    expect((await a.evaluate(id)).value).toBe(false)
    const other = await member()
    remote.getFeatureFlagValue.mockResolvedValue(undefined)
    const latencies: number[] = []
    for (const evaluator of [a, b]) {
      const started = performance.now()
      await expect(evaluator.evaluate(other)).rejects.toMatchObject({ status: 503 })
      latencies.push(performance.now() - started)
    }
    console.info(
      JSON.stringify({
        evidence: '6.5-INT-011',
        boundary: 'cache-evaluate-rejection',
        elapsedMs: latencies,
      })
    )
    for (const elapsed of latencies) expect(elapsed).toBeLessThanOrEqual(2000)
    expect(
      await prisma.communityFlagEvaluation.findUniqueOrThrow({
        where: {
          member_id_flag_key: { member_id: other, flag_key: 'community_read_enabled' },
        },
      })
    ).toMatchObject({ remote_value: null, expires_at: null })
    expect(remote.getFeatureFlagValue).toHaveBeenCalledTimes(2)
  })
})

// Story 6.5 owner: cross-process rollout evaluation against real PostgreSQL claims.
//
// The wall-clock 45/60 timeline is the acceptance lane. These CI cases pin the cache
// invariants (one claim across instances, original expiry, no synthetic value on outage,
// bounded reads) and the claim coordination branches every request takes: an unknown
// member, a second instance waiting on another owner's refresh, and a caller that joined
// a shorter-lived flight.
import 'reflect-metadata'
import { PrismaClient, Prisma } from '@prisma/client'
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
  it.each([true, false])(
    'returns the committed %s refresh without a redundant cache-read transaction',
    async (value) => {
      const id = await member()
      let transactions = 0
      const observed = new Proxy(prisma, {
        get(target, key, receiver) {
          if (key === '$transaction')
            return (
              work: (tx: Prisma.TransactionClient) => Promise<unknown>,
              options?: { timeout?: number; maxWait?: number }
            ) => {
              transactions++
              return target.$transaction(work, options)
            }
          return Reflect.get(target, key, receiver) as unknown
        },
      })
      const provider = { getFeatureFlagValue: vi.fn(() => Promise.resolve(value)) }
      const grant = await new CommunityFlagEvaluationService(observed, provider).evaluate(
        id
      )
      const row = await prisma.communityFlagEvaluation.findUniqueOrThrow({
        where: {
          member_id_flag_key: { member_id: id, flag_key: 'community_read_enabled' },
        },
      })
      expect(grant.value).toBe(value)
      expect(grant.expiresAt).toEqual(row.expires_at)
      expect(grant.validUntil).toBeGreaterThan(performance.now())
      expect(row.expires_at!.getTime() - row.remote_evaluated_at!.getTime()).toBe(60_000)
      expect(provider.getFeatureFlagValue).toHaveBeenCalledOnce()
      expect(transactions).toBe(3) // Initial read, guarded claim, committed refresh returning its row.
    }
  )

  it('cannot return a refreshed grant after the subject generation changes during the provider call', async () => {
    const id = await member()
    const remote = heldRemote()
    const service = new CommunityFlagEvaluationService(prisma, remote.provider)
    const result = service.evaluate(id)
    const outcome = expect(result).rejects.toBeInstanceOf(CommunityUnavailableException)
    await until(
      () => Promise.resolve(remote.calls()),
      (count) => count === 1
    )
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${id}]::text[],ARRAY[]::text[],true)`
      await tx.communitySubject.update({
        where: { member_id: id },
        data: { generation: { increment: 1 } },
      })
      await tx.communityFlagEvaluation.deleteMany({ where: { member_id: id } })
    })
    remote.release(true)
    await outcome
    expect(await prisma.communityFlagEvaluation.count({ where: { member_id: id } })).toBe(
      0
    )
  })

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
    const transactions: {
      elapsedMs: number
      timeout?: number
      maxWait?: number
      outcome: string
      prismaCode?: string
      sqlState?: string
    }[] = []
    const observed = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === '$transaction')
          return async (
            work: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options?: { timeout?: number; maxWait?: number }
          ) => {
            const started = performance.now()
            try {
              const result = await target.$transaction(work, options)
              transactions.push({
                elapsedMs: Math.round(performance.now() - started),
                ...options,
                outcome: 'fulfilled',
              })
              return result
            } catch (error) {
              transactions.push({
                elapsedMs: Math.round(performance.now() - started),
                ...options,
                outcome:
                  error instanceof Prisma.PrismaClientKnownRequestError
                    ? 'PrismaClientKnownRequestError'
                    : 'other_transaction_error',
                ...(error instanceof Prisma.PrismaClientKnownRequestError
                  ? {
                      prismaCode: error.code,
                      sqlState:
                        typeof error.meta?.code === 'string' &&
                        /^[A-Z0-9]{5}$/.test(error.meta.code)
                          ? error.meta.code
                          : undefined,
                    }
                  : {}),
              })
              throw error
            }
          }
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const instances = [
      new CommunityFlagEvaluationService(observed, remote),
      new CommunityFlagEvaluationService(observed, remote),
    ]
    const started = performance.now()
    let results: Awaited<ReturnType<CommunityFlagEvaluationService['evaluate']>>[] = []
    try {
      results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => instances[i % 2]!.evaluate(id))
      )
    } finally {
      console.info(
        'cold_flag_transaction_diagnostics',
        JSON.stringify({
          elapsedMs: Math.round(performance.now() - started),
          remoteCalls: remote.getFeatureFlagValue.mock.calls.length,
          transactions,
        })
      )
    }
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

  it('INT010-CONTENTION: a waiter lock-times-out on a real uncommitted claim insert, then re-resolves the committed claim', async () => {
    const id = await member()
    const provider = { getFeatureFlagValue: vi.fn(() => Promise.resolve(true)) }
    let held = false
    const errors: { prismaCode: string; sqlState: unknown }[] = []
    // The first claim INSERT stays uncommitted until the other instance's INSERT has
    // hit the real 100 ms lock_timeout. Every transaction started after that waits
    // for the held claim to settle, so the retry meets the committed row.
    let lockTimedOut!: () => void
    const contended = new Promise<void>((resolve) => {
      lockTimedOut = resolve
    })
    let claimSettled!: () => void
    const holderSettled = new Promise<void>((resolve) => {
      claimSettled = resolve
    })
    const observed = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === '$transaction')
          return async (
            work: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options?: { timeout?: number; maxWait?: number }
          ) => {
            if (errors.length) await holderSettled
            let holding = false
            try {
              return await target.$transaction(
                (connection) =>
                  work(
                    new Proxy(connection, {
                      get(tx, property, txReceiver) {
                        if (property === '$executeRaw')
                          return async (
                            query: TemplateStringsArray | Prisma.Sql,
                            ...values: unknown[]
                          ) => {
                            const result = await tx.$executeRaw(query, ...values)
                            if (
                              !held &&
                              Array.isArray(query) &&
                              query
                                .join('')
                                .includes('INSERT INTO "CommunityFlagEvaluation"')
                            ) {
                              held = true
                              holding = true
                              await contended
                            }
                            return result
                          }
                        return Reflect.get(tx, property, txReceiver) as unknown
                      },
                    })
                  ),
                options
              )
            } catch (error) {
              if (error instanceof Prisma.PrismaClientKnownRequestError) {
                errors.push({ prismaCode: error.code, sqlState: error.meta?.code })
                if (error.meta?.code === '55P03') lockTimedOut()
              }
              throw error
            } finally {
              if (holding) claimSettled()
            }
          }
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const instances = [
      new CommunityFlagEvaluationService(observed, provider),
      new CommunityFlagEvaluationService(observed, provider),
    ]
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) => instances[index % 2]!.evaluate(id))
      )
      expect(held).toBe(true)
      expect(errors).toEqual([{ prismaCode: 'P2010', sqlState: '55P03' }])
      expect(results.every((result) => result.value)).toBe(true)
      expect(provider.getFeatureFlagValue).toHaveBeenCalledOnce()
      const row = await prisma.communityFlagEvaluation.findUniqueOrThrow({
        where: {
          member_id_flag_key: { member_id: id, flag_key: 'community_read_enabled' },
        },
      })
      const subject = await prisma.communitySubject.findUniqueOrThrow({
        where: { member_id: id },
      })
      expect(row.subject_generation).toBe(subject.generation)
      expect(row.expires_at!.getTime() - row.remote_evaluated_at!.getTime()).toBe(60_000)
      expect(row.next_claim_at.getTime() - row.remote_evaluated_at!.getTime()).toBe(
        45_000
      )
    } finally {
      lockTimedOut()
      console.info('flag_claim_contention', JSON.stringify({ errors }))
    }
  })

  it('INT010-BOUNDED: persistent real INSERT contention stops after three attempts without a remote call', async () => {
    const id = await member()
    let inserted!: () => void
    const ready = new Promise<void>((resolve) => {
      inserted = resolve
    })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
        INSERT INTO "CommunityFlagEvaluation" (member_id,flag_key,subject_generation)
        SELECT member_id,'community_read_enabled',generation FROM "CommunitySubject" WHERE member_id=${id}
      `
        inserted()
        await held
      },
      { timeout: 3000 }
    )
    await ready
    let lockTimeouts = 0
    const observed = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === '$transaction')
          return async (
            work: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options?: { timeout?: number; maxWait?: number }
          ) => {
            try {
              return await target.$transaction(work, options)
            } catch (error) {
              if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.meta?.code === '55P03'
              )
                lockTimeouts++
              throw error
            }
          }
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const provider = { getFeatureFlagValue: vi.fn(() => Promise.resolve(true)) }
    try {
      await expect(
        new CommunityFlagEvaluationService(observed, provider).evaluate(id)
      ).rejects.toBeInstanceOf(CommunityUnavailableException)
      // Three attempts, then refusal. An unbounded retry would keep timing out until
      // the 1950 ms budget ran out, far past three.
      expect(lockTimeouts).toBe(3)
      expect(provider.getFeatureFlagValue).not.toHaveBeenCalled()
    } finally {
      release()
      await holder
    }
    const row = await prisma.communityFlagEvaluation.findUniqueOrThrow({
      where: {
        member_id_flag_key: { member_id: id, flag_key: 'community_read_enabled' },
      },
    })
    expect(row).toMatchObject({
      remote_value: null,
      refresh_owner: null,
      expires_at: null,
    })
  })

  it('INT010-PRIVACY: an exclusive privacy guard lock fails closed without retry or provider access', async () => {
    const id = await member()
    let locked!: () => void
    const ready = new Promise<void>((resolve) => {
      locked = resolve
    })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${id}]::text[],ARRAY[]::text[],true)`
        locked()
        await held
      },
      { timeout: 3000 }
    )
    await ready
    const provider = { getFeatureFlagValue: vi.fn(() => Promise.resolve(true)) }
    let transactions = 0
    const observed = new Proxy(prisma, {
      get(target, key, receiver) {
        if (key === '$transaction')
          return (
            work: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options?: { timeout?: number; maxWait?: number }
          ) => {
            transactions++
            return target.$transaction(work, options)
          }
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    try {
      await expect(
        new CommunityFlagEvaluationService(observed, provider).evaluate(id)
      ).rejects.toBeInstanceOf(CommunityUnavailableException)
      expect(transactions).toBe(2) // Initial read and exactly one guarded claim.
      expect(provider.getFeatureFlagValue).not.toHaveBeenCalled()
    } finally {
      release()
      await holder
    }
    expect(await prisma.communityFlagEvaluation.count({ where: { member_id: id } })).toBe(
      0
    )
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

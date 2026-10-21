import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { CommunityAuthorizationBudget } from '../src/modules/community/community-availability.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
const remote = {
  getFeatureFlagValue: vi.fn<() => Promise<unknown>>().mockResolvedValue(true),
}
const a = new CommunityFlagEvaluationService(prisma, remote)
const b = new CommunityFlagEvaluationService(prisma, remote)
beforeAll(() => db.migrate(), 30_000)
afterAll(async () => {
  await prisma.$disconnect()
  await db.drop()
})
async function member() {
  return (
    await prisma.user.create({ data: { email: `flag-${randomUUID()}@synthetic.test` } })
  ).id
}

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

// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
//
// Production 2026-11-11: community append had never succeeded. From the hosted worker each
// statement costs about 31 ms, and one candidate took about 16 round trips, so every batch ran
// out of its own 500 ms transaction budget, even at batch limit 1, and retried forever. This
// spec runs the real appender through a proxy that adds production's round trip.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { latencyProxy } from './helpers/latency-proxy.js'
import {
  appendFailure,
  CommunityStreamRepository,
} from '../src/modules/community/community-stream.repository.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
// 15.5 ms each way is the 31 ms production round trip.
const proxy = latencyProxy(database.url, 15.5)
// 50 ms each way, three times production's round trip. Production's worker (2026-11-11, 100
// transactions) starts a transaction in 30 ms at p50, 46 ms at p99 and 220 ms at worst, and
// its main pool is a direct session, so a connection's first telemetry insert also prepares
// its statement. A cold retry write at a slow round trip is this client.
const slowProxy = latencyProxy(database.url, 50)
let remote: PrismaClient
let slow: PrismaClient
// The worker's main pool (connection_limit=3) is shared by its append, notification, retention
// and telemetry loops, whose transactions wait up to 250 ms for a connection. One connection
// here makes the sibling loop that holds it deterministic.
const shared = new PrismaClient({
  datasources: {
    db: {
      url: `${database.url}${database.url.includes('?') ? '&' : '?'}connection_limit=1`,
    },
  },
})

/**
 * Holds `client`'s only connection with a 150 ms statement, from another worker loop. Resolves
 * once the statement runs; `done` settles when it ends.
 */
async function siblingHolds(client: PrismaClient) {
  // A Prisma query starts only once awaited or chained, so chain it now.
  const sibling =
    client.$queryRaw`SELECT pg_sleep(0.15)::text, 'tea-sibling-loop' AS loop`.then(
      () => undefined
    )
  for (let attempt = 0; attempt < 200; attempt++) {
    const running = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_stat_activity
      WHERE state = 'active' AND query LIKE '%tea-sibling-loop%' AND pid <> pg_backend_pid()`
    if (Number(running[0]!.n)) return { done: sibling }
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('the sibling statement never started')
}

beforeAll(async () => {
  await database.migrate()
  remote = new PrismaClient({ datasources: { db: { url: await proxy.listen() } } })
  await remote.$queryRaw`SELECT 1`
  slow = new PrismaClient({ datasources: { db: { url: await slowProxy.listen() } } })
  await slow.$queryRaw`SELECT 1`
  await shared.$queryRaw`SELECT 1`
}, 30_000)
beforeEach(async () => {
  await prisma.communityStreamEvent.deleteMany()
  await prisma.communityDomainOutbox.deleteMany()
  await prisma.communityEngagementTelemetry.deleteMany()
})
afterAll(async () => {
  await remote?.$disconnect()
  await slow?.$disconnect()
  await shared.$disconnect()
  await proxy.close()
  await slowProxy.close()
  await prisma.$disconnect()
  await database.drop()
})

async function publishPosts(count: number) {
  const user = await prisma.user.create({
    data: { email: `append-latency-${randomUUID()}@synthetic.test` },
  })
  await prisma.lookbookPost.createMany({
    data: Array.from({ length: count }, () =>
      buildLookbookPostCreateInput(
        createLookbookPost({ userId: user.id, status: 'published' })
      )
    ),
  })
}

describe('community append at production database latency', () => {
  it('6.5-INT-030: the proxy adds one production round trip per statement', async () => {
    const started = performance.now()
    for (let i = 0; i < 5; i++) await remote.$queryRaw`SELECT 1`
    const perStatement = (performance.now() - started) / 5
    expect(perStatement).toBeGreaterThanOrEqual(30)
    expect(perStatement).toBeLessThan(60)
  })

  it('6.5-INT-031: append makes progress within its budgets at a 31 ms round trip', async () => {
    await publishPosts(30)
    const pending = await prisma.communityDomainOutbox.count({
      where: { appended_at: null },
    })
    expect(pending).toBeGreaterThan(0)
    const repository = new CommunityStreamRepository(remote)
    const outcomes: string[] = []
    // The product's append loop: up to 12 deferrals in a row before it gives up on a batch.
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!(await prisma.communityDomainOutbox.count({ where: { appended_at: null } })))
        break
      try {
        outcomes.push(`appended ${(await repository.appendWithReport()).count}`)
      } catch (error) {
        outcomes.push(appendFailure(error))
      }
    }
    expect(
      await prisma.communityDomainOutbox.count({ where: { appended_at: null } }),
      outcomes.join(', ')
    ).toBe(0)
    expect(await prisma.communityStreamEvent.count()).toBe(pending)
    expect(
      outcomes.filter((outcome) => outcome === 'budget_pressure').length
    ).toBeLessThan(3)
  }, 120_000)

  it('6.5-INT-033: a deferred append records its retry row on a cold connection at three times the round trip', async () => {
    await publishPosts(1)
    const repository = new CommunityStreamRepository(slow)
    // Another session holds the public head, so the batch defers on head contention.
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    let locked!: () => void
    const isLocked = new Promise<void>((resolve) => (locked = resolve))
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CommunityStreamHead" WHERE id = 'public' FOR UPDATE`
        locked()
        await released
      },
      { timeout: 20_000 }
    )
    await isLocked
    try {
      const outcome = await repository.appendWithReport().then(
        () => 'appended',
        (error: unknown) => appendFailure(error)
      )
      expect(outcome).toBe('head_contention')
    } finally {
      release()
      await holder
    }
    // The cold retry write at a 100 ms round trip ran past the old 400 ms budget and was
    // dropped without a trace; the 1 s budget holds it.
    expect(
      await prisma.communityEngagementTelemetry.findMany({
        where: { event_type: 'community_append_retry' },
        select: { reason: true, outcome: true },
      })
    ).toEqual([{ reason: 'head_contention', outcome: 'aborted' }])
  }, 30_000)

  it('6.5-INT-034: a retry row that cannot be written is logged as missing', async () => {
    await publishPosts(1)
    await prisma.$executeRawUnsafe(`CREATE FUNCTION tea_refuse_telemetry() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'telemetry refused'; END $$`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER tea_refuse_telemetry BEFORE INSERT
      ON "CommunityEngagementTelemetry" FOR EACH ROW EXECUTE FUNCTION tea_refuse_telemetry()`)
    const repository = new CommunityStreamRepository(remote)
    const warnings: [Record<string, unknown>, string][] = []
    const logger = Reflect.get(repository, 'logger') as {
      warn: (fields: Record<string, unknown>, message: string) => void
    }
    logger.warn = (fields, message) => warnings.push([fields, message])
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    let locked!: () => void
    const isLocked = new Promise<void>((resolve) => (locked = resolve))
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CommunityStreamHead" WHERE id = 'public' FOR UPDATE`
        locked()
        await released
      },
      { timeout: 20_000 }
    )
    await isLocked
    try {
      await expect(repository.appendWithReport()).rejects.toSatisfy(
        (error: unknown) => appendFailure(error) === 'head_contention'
      )
    } finally {
      release()
      await holder
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER tea_refuse_telemetry ON "CommunityEngagementTelemetry"'
      )
      await prisma.$executeRawUnsafe('DROP FUNCTION tea_refuse_telemetry()')
    }
    expect(warnings).toEqual([
      [{ reason: 'head_contention', nextBatchLimit: 25 }, 'Community append deferred'],
      [
        { reason: 'head_contention', code: 'P0001' },
        'Community append retry not recorded',
      ],
    ])
    expect(await prisma.communityEngagementTelemetry.count()).toBe(0)
  }, 30_000)

  it('6.5-INT-035: an append waits for a connection another worker loop holds', async () => {
    await publishPosts(1)
    const repository = new CommunityStreamRepository(shared)
    const sibling = (await siblingHolds(shared)).done
    // The append asked for the pool's connection while the sibling held it for 150 ms. A 100 ms
    // wait gave up and reported budget_pressure, which halves the next batch for a busy pool.
    const report = await repository.appendWithReport()
    await sibling
    expect(report.count).toBe(1)
    expect(await prisma.communityEngagementTelemetry.count()).toBe(0)
  }, 30_000)

  it('6.5-INT-036: a deferred append records its retry row while another worker loop holds the connection', async () => {
    await publishPosts(1)
    let sibling: Promise<unknown> | undefined
    let transactions = 0
    // The second transaction is the retry write: the sibling takes the connection first.
    const pool = new Proxy(shared, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver)
        if (typeof value !== 'function') return value
        const method = value as (...args: unknown[]) => unknown
        if (prop !== '$transaction')
          return (...args: unknown[]) => Reflect.apply(method, target, args)
        return async (...args: unknown[]) => {
          if (++transactions === 2) sibling = (await siblingHolds(target)).done
          return Reflect.apply(method, target, args)
        }
      },
    })
    const repository = new CommunityStreamRepository(pool)
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    let locked!: () => void
    const isLocked = new Promise<void>((resolve) => (locked = resolve))
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CommunityStreamHead" WHERE id = 'public' FOR UPDATE`
        locked()
        await released
      },
      { timeout: 20_000 }
    )
    await isLocked
    try {
      await expect(repository.appendWithReport()).rejects.toSatisfy(
        (error: unknown) => appendFailure(error) === 'head_contention'
      )
    } finally {
      release()
      await holder
      await sibling
    }
    expect(transactions).toBe(2)
    // A 50 ms wait dropped the row whenever a sibling loop held the connection.
    expect(
      await prisma.communityEngagementTelemetry.findMany({
        where: { event_type: 'community_append_retry' },
        select: { reason: true, outcome: true },
      })
    ).toEqual([{ reason: 'head_contention', outcome: 'aborted' }])
  }, 30_000)
})

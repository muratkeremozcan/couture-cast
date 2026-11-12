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
  COMMUNITY_APPEND_DEADLINE_MS,
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
let slowUrl: string
const clients: PrismaClient[] = []
/**
 * A pool of `connections` (one by default) on the isolated database. The worker's main pool
 * has three, shared by its append, notification, retention and telemetry loops; one makes the
 * sibling loop that holds it deterministic.
 */
function pool(connections = 1, url = database.url) {
  const target = new URL(url)
  target.searchParams.set('connection_limit', String(connections))
  const client = new PrismaClient({ datasources: { db: { url: target.toString() } } })
  clients.push(client)
  return client
}

/** Another worker loop's transaction on `client`, holding a connection until released. */
async function holdConnection(client: PrismaClient) {
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  let held!: () => void
  const isHeld = new Promise<void>((resolve) => (held = resolve))
  const done = client.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1`
      held()
      await released
    },
    { timeout: 20_000, maxWait: 5_000 }
  )
  await isHeld
  return { release, done }
}

/**
 * `client` as the repository sees it: before each listed `$transaction` call, a sibling takes
 * every connection, and it lets go `holdMs` after the call asks for one. The hold is timed from
 * the request itself, so a slow host can only lengthen the wait.
 */
function heldDuring(
  client: PrismaClient,
  connections: number,
  holds: Record<number, number>,
  beforeRequest?: () => Promise<void>
) {
  let calls = 0
  const settled: Promise<unknown>[] = []
  const wrapped = new Proxy(client, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      const method = value as (...args: unknown[]) => unknown
      if (prop !== '$transaction')
        return (...args: unknown[]) => Reflect.apply(method, target, args)
      return async (...args: unknown[]) => {
        const holdMs = holds[++calls]
        if (holdMs !== undefined) {
          const siblings = await Promise.all(
            Array.from({ length: connections }, () => holdConnection(target))
          )
          await beforeRequest?.()
          const request = Reflect.apply(method, target, args)
          setTimeout(() => siblings.forEach((sibling) => sibling.release()), holdMs)
          settled.push(...siblings.map((sibling) => sibling.done))
          return request
        }
        return Reflect.apply(method, target, args)
      }
    },
  })
  return { client: wrapped, calls: () => calls, settled: () => Promise.all(settled) }
}

/** Holds the public head from the test's own connection until released. */
async function holdHead() {
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  let locked!: () => void
  const isLocked = new Promise<void>((resolve) => (locked = resolve))
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CommunityStreamHead" WHERE id = 'public' FOR UPDATE`
      locked()
      await released
    },
    { timeout: 20_000 }
  )
  await isLocked
  return { release, done }
}

beforeAll(async () => {
  await database.migrate()
  remote = new PrismaClient({ datasources: { db: { url: await proxy.listen() } } })
  await remote.$queryRaw`SELECT 1`
  slowUrl = await slowProxy.listen()
  slow = new PrismaClient({ datasources: { db: { url: slowUrl } } })
  await slow.$queryRaw`SELECT 1`
}, 30_000)
beforeEach(async () => {
  await prisma.communityStreamEvent.deleteMany()
  await prisma.communityDomainOutbox.deleteMany()
  await prisma.communityEngagementTelemetry.deleteMany()
})
afterAll(async () => {
  await remote?.$disconnect()
  await slow?.$disconnect()
  await Promise.all(clients.map((client) => client.$disconnect()))
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
    // The sibling lets go 125 ms after the append asks. A 100 ms wait gave up and reported
    // budget_pressure, which halved the next batch for a busy pool.
    const busy = heldDuring(pool(), 1, { 1: 125 })
    const report = await new CommunityStreamRepository(busy.client).appendWithReport()
    await busy.settled()
    expect(report.count).toBe(1)
    expect(await prisma.communityEngagementTelemetry.count()).toBe(0)
  }, 30_000)

  it('6.5-INT-036: a deferred append records its retry row while another worker loop holds the connection', async () => {
    await publishPosts(1)
    // The second transaction is the retry row; the sibling lets go 125 ms after it asks.
    const busy = heldDuring(pool(), 1, { 2: 125 })
    const head = await holdHead()
    try {
      await expect(
        new CommunityStreamRepository(busy.client).appendWithReport()
      ).rejects.toSatisfy((error: unknown) => appendFailure(error) === 'head_contention')
    } finally {
      head.release()
      await head.done
      await busy.settled()
    }
    expect(busy.calls()).toBe(2)
    // A 50 ms wait dropped the row whenever a sibling loop held the connection.
    expect(
      await prisma.communityEngagementTelemetry.findMany({
        where: { event_type: 'community_append_retry' },
        select: { reason: true, outcome: true },
      })
    ).toEqual([{ reason: 'head_contention', outcome: 'aborted' }])
  }, 30_000)

  it('6.5-INT-037: an append that never got a connection keeps its batch size', async () => {
    await publishPosts(25)
    // Three sibling loops hold all three connections for 400 ms after each append asks, past its
    // 250 ms wait; the retry row after each then gets a connection. No append work ran, so the
    // batch stays at 25. Counted as budget pressure it fell 25, 12, 6, 3 (Codex review of #208).
    const busy = heldDuring(pool(3), 3, { 1: 400, 3: 400, 5: 400 })
    const repository = new CommunityStreamRepository(busy.client)
    const outcomes: string[] = []
    for (let episode = 0; episode < 3; episode++)
      outcomes.push(
        await repository.appendWithReport().then(
          () => 'appended',
          (error: unknown) => appendFailure(error)
        )
      )
    await busy.settled()
    expect(outcomes).toEqual(['pool_wait', 'pool_wait', 'pool_wait'])
    expect(
      await prisma.communityEngagementTelemetry.findMany({
        where: { event_type: 'community_append_retry' },
        select: { reason: true, backlog_count: true },
      })
    ).toEqual(
      Array.from({ length: 3 }, () => ({ reason: 'pool_wait', backlog_count: 25 }))
    )
    expect((await repository.appendWithReport()).count).toBe(25)
  }, 30_000)

  it('6.5-INT-038: one deadline bounds an append, its retries and its retry row', async () => {
    await publishPosts(1)
    // The supported pldbgapi2 abort, after 200 ms of server work in the append and 60 ms in
    // the retry row, at three times production's round trip. Each transaction may retry it
    // twice; with a fresh budget per attempt, six attempts took 5.12 s (Codex review of #208).
    const original = (
      await prisma.$queryRaw<{ definition: string }[]>`
        SELECT pg_get_functiondef('community_append_batch(integer,double precision)'::regprocedure)
          AS definition`
    )[0]!.definition
    const abort = `RAISE EXCEPTION USING ERRCODE = 'XX000',
      MESSAGE = 'cannot find parent statement on pldbgapi2 call stack'`
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION
      community_append_batch(ready_limit integer, write_cost_ms double precision)
      RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.2); ${abort}; END $$`)
    await prisma.$executeRawUnsafe(`CREATE FUNCTION tea_abort_telemetry() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.06); ${abort}; END $$`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER tea_abort_telemetry BEFORE INSERT
      ON "CommunityEngagementTelemetry" FOR EACH ROW EXECUTE FUNCTION tea_abort_telemetry()`)
    const counted = heldDuring(pool(1, slowUrl), 1, {})
    const repository = new CommunityStreamRepository(counted.client)
    const warnings: [Record<string, unknown>, string][] = []
    const logger = Reflect.get(repository, 'logger') as {
      warn: (fields: Record<string, unknown>, message: string) => void
    }
    logger.warn = (fields, message) => warnings.push([fields, message])
    const started = performance.now()
    try {
      await expect(repository.appendWithReport()).rejects.toBeDefined()
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER tea_abort_telemetry ON "CommunityEngagementTelemetry"'
      )
      await prisma.$executeRawUnsafe('DROP FUNCTION tea_abort_telemetry()')
      await prisma.$executeRawUnsafe(original)
    }
    const elapsed = performance.now() - started
    console.info(
      JSON.stringify({
        evidence: '6.5-INT-038',
        elapsed,
        attempts: counted.calls(),
        warnings,
      })
    )
    // A retry ran, and every attempt ran inside the deadline plus the last attempt's close.
    expect(counted.calls()).toBeGreaterThanOrEqual(2)
    expect(elapsed).toBeLessThan(COMMUNITY_APPEND_DEADLINE_MS + 500)
    expect(warnings.at(-1)?.[1]).toBe('Community append retry not recorded')
  }, 30_000)
})

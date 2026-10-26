import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { PrismaClient, type Prisma } from '@prisma/client'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
// One appender per test: its adaptive batch limit is per-instance state, and a test that
// drove it into budget pressure must not shrink the next test's batches.
let stream: CommunityStreamRepository
const clients: Client[] = []
async function connection() {
  const client = new Client({ connectionString: database.url })
  await client.connect()
  clients.push(client)
  return client
}
function candidatePreparationLatency(delayMs: number): PrismaClient {
  if (!delayMs) return prisma
  return new Proxy(prisma, {
    get(target, key, receiver) {
      if (key === '$transaction')
        return (
          work: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options?: {
            timeout?: number
            maxWait?: number
            isolationLevel?: Prisma.TransactionIsolationLevel
          }
        ) =>
          target.$transaction(
            (tx) =>
              work(
                new Proxy(tx, {
                  get(connection, property, connectionReceiver) {
                    if (property === '$executeRawUnsafe')
                      return async (query: string, ...values: unknown[]) => {
                        if (query === 'SAVEPOINT community_candidate')
                          await connection.$executeRaw`SELECT pg_sleep(${delayMs / 1000})`
                        return connection.$executeRawUnsafe(query, ...values)
                      }
                    return Reflect.get(
                      connection,
                      property,
                      connectionReceiver
                    ) as unknown
                  },
                })
              ),
            options
          )
      return Reflect.get(target, key, receiver) as unknown
    },
  })
}
async function fixture() {
  const user = await prisma.user.create({
    data: { email: `stream-${randomUUID()}@synthetic.test` },
  })
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: user.id, status: 'published' })
    ),
  })
  return { user, post }
}

beforeAll(async () => {
  await database.migrate()
  const [version] = await prisma.$queryRaw<
    { version: number }[]
  >`SELECT current_setting('server_version_num')::int AS version`
  expect(version!.version).toBeGreaterThanOrEqual(170000)
}, 30_000)
beforeEach(async () => {
  stream = new CommunityStreamRepository(prisma)
  await prisma.communityStreamEvent.deleteMany()
  await prisma.communityDomainOutbox.deleteMany()
})
afterAll(async () => {
  await Promise.all(
    clients.map(async (client) => {
      await client.query('ROLLBACK')
      await client.end()
    })
  )
  await prisma.$disconnect()
  await database.drop()
})

describe('Story 6.5 committed stream append', () => {
  it('6.5-PERF-local: a burst of100 makes bounded append progress without timeout rollback', async () => {
    const user = await prisma.user.create({
      data: { email: `burst-${randomUUID()}@synthetic.test` },
    })
    await prisma.lookbookPost.createMany({
      data: Array.from({ length: 100 }, () =>
        buildLookbookPostCreateInput(
          createLookbookPost({ userId: user.id, status: 'published' })
        )
      ),
    })
    const started = performance.now()
    const batches: { count: number; elapsedMs: number }[] = []
    while (await prisma.communityDomainOutbox.count({ where: { appended_at: null } })) {
      const before = performance.now()
      const count = await stream.append()
      batches.push({ count, elapsedMs: performance.now() - before })
      expect(count).toBeGreaterThan(0)
      expect(performance.now() - started).toBeLessThan(10000)
    }
    expect(await prisma.communityStreamEvent.count()).toBe(100)
    console.info(
      JSON.stringify({
        evidence: '6.5-PERF-local-append100',
        elapsedMs: performance.now() - started,
        batches,
      })
    )
  })
  it('R01 adapts after slow append writes and exposes every aborted batch', async () => {
    const { user } = await fixture()
    await prisma.lookbookPost.createMany({
      data: Array.from({ length: 39 }, () =>
        buildLookbookPostCreateInput(
          createLookbookPost({ userId: user.id, status: 'published' })
        )
      ),
    })
    // The first stream-event insert sleeps past the append's 450 ms statement
    // timeout, so the first append overruns whatever batch it prepared. Sizing
    // the overrun from 20 ms per row alone depended on the 150 ms preparation
    // window filling about 23 rows; a loaded CI runner prepared fewer, every
    // batch fit, and no append failed (Story 1.2b R30). A sequence counts the
    // inserts because it survives the aborted transaction; every later insert
    // keeps the 20 ms cost the adaptation is measured against.
    await prisma.$executeRawUnsafe('CREATE SEQUENCE story65_slow_event_inserts')
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION story65_slow_event_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('story65_slow_event_inserts') = 1 THEN PERFORM pg_sleep(0.6); ELSE PERFORM pg_sleep(0.02); END IF; RETURN NEW; END $$"
    )
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER story65_slow_event BEFORE INSERT ON "CommunityStreamEvent" FOR EACH ROW EXECUTE FUNCTION story65_slow_event_write()'
    )
    let failures = 0
    try {
      for (
        let attempt = 0;
        attempt < 12 &&
        (await prisma.communityDomainOutbox.count({ where: { appended_at: null } }));
        attempt++
      ) {
        try {
          await stream.append()
        } catch {
          failures++
        }
      }
      expect(
        await prisma.communityDomainOutbox.count({ where: { appended_at: null } })
      ).toBe(0)
      expect(await prisma.communityStreamEvent.count()).toBe(40)
      expect(
        await prisma.communityEngagementTelemetry.count({
          where: { event_type: 'community_append_retry' },
        })
      ).toBeGreaterThanOrEqual(failures)
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER story65_slow_event ON "CommunityStreamEvent"'
      )
      await prisma.$executeRawUnsafe('DROP FUNCTION story65_slow_event_write()')
      await prisma.$executeRawUnsafe('DROP SEQUENCE story65_slow_event_inserts')
    }
    expect(failures).toBeGreaterThan(0)
    expect(
      await prisma.communityEngagementTelemetry.count({
        where: {
          event_type: 'community_append_retry',
          reason: 'budget_pressure',
        },
      })
    ).toBeGreaterThan(0)
    await prisma.lookbookPost.createMany({
      data: Array.from({ length: 250 }, () =>
        buildLookbookPostCreateInput(
          createLookbookPost({ userId: user.id, status: 'published' })
        )
      ),
    })
    const recovered: number[] = []
    while (await prisma.communityDomainOutbox.count({ where: { appended_at: null } }))
      recovered.push(await stream.append())
    await prisma.lookbookPost.createMany({
      data: Array.from({ length: 25 }, () =>
        buildLookbookPostCreateInput(
          createLookbookPost({ userId: user.id, status: 'published' })
        )
      ),
    })
    // A busy preparation window may select fewer rows than the recovered ceiling.
    // Observe the actual appender's durable capacity telemetry under a NOWAIT collision.
    const held = await connection()
    await held.query('BEGIN')
    await held.query('SELECT id FROM "CommunityStreamHead" WHERE id=$1 FOR UPDATE', [
      'public',
    ])
    try {
      await expect(stream.append()).rejects.toThrow()
      const capacity = await prisma.communityEngagementTelemetry.findFirstOrThrow({
        where: { event_type: 'community_append_retry', reason: 'head_contention' },
        orderBy: { created_at: 'desc' },
      })
      expect(capacity.backlog_count).toBe(25)
    } finally {
      await held.query('ROLLBACK')
    }
    let restored = 0
    while (await prisma.communityDomainOutbox.count({ where: { appended_at: null } }))
      restored += await stream.append()
    expect(restored).toBe(25)
    console.info(
      JSON.stringify({
        evidence: 'A03-budget-pressure-recovery',
        failures,
        recovered,
        restoredBatch: 25,
      })
    )
  }, 20000)

  it.each([0, 20])(
    'A03 routine head contention preserves capacity and commits 100 contiguous events with %ims real candidate latency',
    async (delayMs) => {
      const { post, user } = await fixture()
      const priorTelemetry = await prisma.communityEngagementTelemetry.findMany({
        select: { id: true },
      })
      const appender = new CommunityStreamRepository(candidatePreparationLatency(delayMs))
      const held = await connection()
      await held.query('BEGIN')
      await held.query('SELECT id FROM "CommunityStreamHead" WHERE id=$1 FOR UPDATE', [
        'public',
      ])
      try {
        for (let attempt = 0; attempt < 5; attempt++)
          await expect(appender.append()).rejects.toThrow()
      } finally {
        await held.query('ROLLBACK')
      }
      const retries = await prisma.communityEngagementTelemetry.findMany({
        where: {
          id: { notIn: priorTelemetry.map((row) => row.id) },
          event_type: 'community_append_retry',
        },
        select: { reason: true, backlog_count: true },
      })
      expect(retries).toHaveLength(5)
      expect(retries).toEqual(
        Array.from({ length: 5 }, () => ({
          reason: 'head_contention',
          backlog_count: 25,
        }))
      )
      await prisma.lookbookPost.createMany({
        data: Array.from({ length: 99 }, () =>
          buildLookbookPostCreateInput(
            createLookbookPost({ userId: user.id, status: 'published' })
          )
        ),
      })
      const start = performance.now()
      const batches: number[] = []
      const timings: number[] = []
      const capacities: unknown[] = []
      try {
        while (
          await prisma.communityDomainOutbox.count({ where: { appended_at: null } })
        ) {
          const before = performance.now()
          batches.push(await appender.append())
          timings.push(Math.round(performance.now() - before))
          capacities.push(Reflect.get(appender, 'readyLimit') as unknown)
          expect(performance.now() - start).toBeLessThan(5000)
        }
        expect(batches[0]).toBeGreaterThan(1)
        const events = await prisma.communityStreamEvent.findMany({
          where: { stream_id: 'public' },
          select: { source_outbox_id: true, sequence: true, post_id: true },
          orderBy: { sequence: 'asc' },
        })
        expect(events).toHaveLength(100)
        expect(new Set(events.map((event) => event.source_outbox_id)).size).toBe(100)
        expect(
          events.every(
            (event, index) => event.sequence === events[0]!.sequence + BigInt(index)
          )
        ).toBe(true)
        expect(events.filter((event) => event.post_id === post.id)).toHaveLength(1)
      } finally {
        const telemetry = await prisma.communityEngagementTelemetry.findMany({
          where: {
            event_type: { in: ['community_append_retry', 'community_append_contention'] },
          },
          select: { reason: true, elapsed_ms: true, backlog_count: true },
          take: 100,
          orderBy: { created_at: 'desc' },
        })
        console.info(
          JSON.stringify({
            evidence: 'A03-contention-burst',
            elapsedMs: Math.round(performance.now() - start),
            batches,
            timings,
            capacities,
            telemetry,
          })
        )
      }
    }
  )
  it('6.5-INT-001: reverse source commit order and aborted source cannot leave a skipped cursor', async () => {
    const a = await fixture()
    const b = await fixture()
    await stream.append()
    const before = await prisma.communityStreamHead.findUniqueOrThrow({
      where: { id: 'public' },
    })
    const writer = await connection()
    await writer.query('BEGIN')
    await writer.query('UPDATE "LookbookPost" SET status = \'withdrawn\' WHERE id = $1', [
      a.post.id,
    ])
    await prisma.lookbookPost.update({
      where: { id: b.post.id },
      data: { status: 'withdrawn' },
    })
    expect(await stream.append()).toBe(1)
    const mid = await prisma.communityStreamHead.findUniqueOrThrow({
      where: { id: 'public' },
    })
    expect(mid.sequence).toBe(before.sequence + 1n)
    await writer.query('COMMIT')
    expect(await stream.append()).toBe(1)
    const after = await prisma.communityStreamHead.findUniqueOrThrow({
      where: { id: 'public' },
    })
    expect(after.sequence).toBe(mid.sequence + 1n)
    expect(await stream.append()).toBe(0)
    await writer.query('BEGIN')
    await writer.query('UPDATE "LookbookPost" SET status = \'published\' WHERE id = $1', [
      a.post.id,
    ])
    await writer.query('ROLLBACK')
    expect(await stream.append()).toBe(0)
  })

  it('6.5-INT-002: concurrent appenders allocate unique committed counters and roll back on busy head', async () => {
    await fixture()
    const locker = await connection()
    await locker.query('BEGIN')
    await locker.query(
      'SELECT id FROM "CommunityStreamHead" WHERE id = \'public\' FOR UPDATE'
    )
    await expect(stream.append()).rejects.toThrow()
    expect(
      await prisma.communityDomainOutbox.count({ where: { appended_at: null } })
    ).toBe(1)
    await locker.query('ROLLBACK')
    await Promise.allSettled([stream.append(), stream.append()])
    expect(
      await prisma.communityDomainOutbox.count({ where: { appended_at: null } })
    ).toBe(0)
    const events = await prisma.communityStreamEvent.findMany()
    expect(events).toHaveLength(1)
    expect(new Set(events.map((e) => e.source_outbox_id)).size).toBe(1)
  })

  it('6.5-INT-003: a busy oldest subject permits unrelated append and recovers after release', async () => {
    const a = await fixture()
    const b = await fixture()
    const locker = await connection()
    await locker.query('BEGIN')
    await locker.query('SELECT pg_advisory_xact_lock(65001,hashtext($1))', [a.user.id])
    expect(await stream.append()).toBe(1)
    expect((await prisma.communityStreamEvent.findMany())[0]!.post_id).toBe(b.post.id)
    await locker.query('ROLLBACK')
    expect(await stream.append()).toBe(1)
    expect(await prisma.communityStreamEvent.count()).toBe(2)
  })

  it('6.5-INT-004: savepoint rollback releases only candidate guards and row locks', async () => {
    const { user, post } = await fixture()
    const candidate = await prisma.communityDomainOutbox.findFirstOrThrow({
      where: { post_id: post.id },
    })
    const owner = await connection()
    const contender = await connection()
    await owner.query('BEGIN')
    const pid = Number(
      (await owner.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid
    )
    await owner.query("SELECT pg_advisory_xact_lock_shared(65001,hashtext('retained'))")
    await owner.query('SAVEPOINT candidate')
    await owner.query('SELECT pg_advisory_xact_lock_shared(65001,hashtext($1))', [
      user.id,
    ])
    await owner.query('SELECT id FROM "CommunityDomainOutbox" WHERE id = $1 FOR UPDATE', [
      candidate.id,
    ])
    const locks = async () =>
      (
        await contender.query<{ key: string }>(
          `SELECT objid::bigint::text AS key FROM pg_locks
      WHERE pid = $1 AND locktype = 'advisory' AND classid = 65001 AND objsubid = 2`,
          [pid]
        )
      ).rows
    expect(await locks()).toHaveLength(2)
    await owner.query('ROLLBACK TO SAVEPOINT candidate')
    expect(await locks()).toHaveLength(1)
    await contender.query('BEGIN')
    await contender.query('SELECT pg_advisory_xact_lock(65001,hashtext($1))', [user.id])
    expect(
      (
        await contender.query<{ key: string }>(
          'SELECT id FROM "CommunityDomainOutbox" WHERE id = $1 FOR UPDATE NOWAIT',
          [candidate.id]
        )
      ).rows
    ).toHaveLength(1)
    await contender.query('ROLLBACK')
    await owner.query('ROLLBACK')
  })

  it('6.5-INT-008: private status stays private; hidden source becomes identifier-free resync', async () => {
    const { user, post } = await fixture()
    await stream.append()
    await prisma.communityStreamEvent.deleteMany()
    await prisma.communityComment.create({
      data: {
        post_id: post.id,
        user_id: user.id,
        body: 'Synthetic pending comment',
        locale: 'en-US',
        platform: 'web',
      },
    })
    expect(await stream.append()).toBe(1)
    const privateEvent = await prisma.communityStreamEvent.findFirstOrThrow()
    expect(privateEvent.kind).toBe('comment.status')
    expect(privateEvent.stream_id).not.toBe('public')
    await prisma.lookbookPost.update({
      where: { id: post.id },
      data: { status: 'withdrawn' },
    })
    await stream.append()
    const removal = await prisma.communityStreamEvent.findFirstOrThrow({
      where: { stream_id: 'public' },
    })
    expect(removal).toMatchObject({
      kind: 'resync',
      post_id: null,
      comment_id: null,
      parent_id: null,
    })
  })

  it('6.5-INT-009: client database roles cannot read or write stream, preference or subject artifacts', async () => {
    const client = await connection()
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE authenticated')
    await expect(client.query('SELECT * FROM "CommunityDomainOutbox"')).rejects.toThrow(
      /permission denied/
    )
    await client.query('ROLLBACK')
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE anon')
    await expect(
      client.query('SELECT * FROM "CommunityNotificationPreference"')
    ).rejects.toThrow(/permission denied/)
    await client.query('ROLLBACK')
  })
})

import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { PrismaClient } from '@prisma/client'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const stream = new CommunityStreamRepository(prisma)
const clients: Client[] = []
async function connection() {
  const client = new Client({ connectionString: database.url })
  await client.connect()
  clients.push(client)
  return client
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
    await prisma.$executeRawUnsafe(
      'CREATE FUNCTION story65_slow_event_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.02); RETURN NEW; END $$'
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

  it('A03 routine head contention preserves burst capacity and successful work restores a pressured limit', async () => {
    const { post, user } = await fixture()
    const appender = new CommunityStreamRepository(prisma)
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
    await prisma.lookbookPost.createMany({
      data: Array.from({ length: 99 }, () =>
        buildLookbookPostCreateInput(
          createLookbookPost({ userId: user.id, status: 'published' })
        )
      ),
    })
    const start = performance.now()
    const batches: number[] = []
    while (await prisma.communityDomainOutbox.count({ where: { appended_at: null } })) {
      batches.push(await appender.append())
      expect(performance.now() - start).toBeLessThan(5000)
    }
    expect(batches[0]).toBeGreaterThan(1)
    expect(batches.length).toBeLessThanOrEqual(8)
    expect(await prisma.communityStreamEvent.count({ where: { post_id: post.id } })).toBe(
      1
    )
    console.info(
      JSON.stringify({
        evidence: 'A03-contention-burst',
        elapsedMs: performance.now() - start,
        batches,
      })
    )
  })
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

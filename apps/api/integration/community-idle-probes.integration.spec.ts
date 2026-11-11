// Idle backoff: the one-statement probes an idle community worker asks instead of a full sweep.
// Each probe must see every row its sweep would select, so it runs here against real PostgreSQL.
import { PrismaClient } from '@prisma/client'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { communityDispatchHasWork } from '../src/modules/community/community-worker-runtime.js'
import { CommunityNotificationsWorker } from '../src/modules/community/community-notifications.worker.js'
import { CommunitySpotlightInvalidator } from '../src/modules/community/community-spotlight-invalidator.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'

const database = isolatedCommunityDatabase()
let prisma: PrismaClient
let sql: Client

beforeAll(async () => {
  await database.migrate()
  prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
  sql = new Client({ connectionString: database.url })
  await sql.connect()
  // Probe fixtures need only the columns the probes read, so foreign keys stay out of the way.
  await sql.query('SET session_replication_role = replica')
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  await sql?.end()
  await database.drop()
})

const tables = [
  'CommunityModerationOutbox',
  'CommunityCommentScreeningOutbox',
  'CommunityReactionReceipt',
  'CommunityReactionOutbox',
  'CommunityCommentAnalyticsOutbox',
  'CommunityDomainOutbox',
  'CommunitySpotlightCursor',
  'CommunityTokenDelivery',
  'CommunityNotificationGroup',
]
beforeEach(async () => {
  await sql.query(tables.map((table) => `DELETE FROM "${table}";`).join('\n'))
  await sql.query('UPDATE "CommunityStreamHead" SET sequence = 0, retention_floor = 0')
})

describe('community dispatch probe', () => {
  it('answers no on an empty database, with or without an analytics sink', async () => {
    await expect(communityDispatchHasWork(prisma, true)).resolves.toBe(false)
    await expect(communityDispatchHasWork(prisma, false)).resolves.toBe(false)
  })

  it('sees an undispatched post and comment screening row', async () => {
    await sql.query(
      "INSERT INTO \"CommunityModerationOutbox\" (id, post_id, updated_at) VALUES ('m1', 'p1', now())"
    )
    await expect(communityDispatchHasWork(prisma, false)).resolves.toBe(true)
    await sql.query('UPDATE "CommunityModerationOutbox" SET dispatched_at = now()')
    await expect(communityDispatchHasWork(prisma, false)).resolves.toBe(false)
    await sql.query(
      "INSERT INTO \"CommunityCommentScreeningOutbox\" (id, comment_id, updated_at) VALUES ('c1', 'k1', now())"
    )
    await expect(communityDispatchHasWork(prisma, false)).resolves.toBe(true)
  })

  it('sees reaction receipts and delivered reaction rows only once they are past 30 days', async () => {
    await sql.query(
      `INSERT INTO "CommunityReactionReceipt" (user_id, mutation_id, post_id, base_revision, created_at)
       VALUES ('u1', gen_random_uuid(), 'p1', 0, now() - interval '29 days')`
    )
    await expect(communityDispatchHasWork(prisma, false)).resolves.toBe(false)
    await sql.query(
      'UPDATE "CommunityReactionReceipt" SET created_at = now() - interval \'31 days\''
    )
    await expect(communityDispatchHasWork(prisma, false)).resolves.toBe(true)
    await sql.query('DELETE FROM "CommunityReactionReceipt"')
    await sql.query(
      `INSERT INTO "CommunityReactionOutbox" (id, user_id, post_id, event_type, payload, delivered_at)
       VALUES (gen_random_uuid(), 'u1', 'p1', 'community_reaction_added', '{}', now() - interval '31 days')`
    )
    await expect(communityDispatchHasWork(prisma, false)).resolves.toBe(true)
  })

  it('sees due analytics rows only while the sink can deliver them', async () => {
    await sql.query(
      `INSERT INTO "CommunityReactionOutbox" (id, user_id, post_id, event_type, payload, next_attempt_at)
       VALUES (gen_random_uuid(), 'u1', 'p1', 'community_reaction_added', '{}', now() + interval '1 hour')`
    )
    await sql.query(
      `INSERT INTO "CommunityCommentAnalyticsOutbox" (id, actor, event_type, payload, next_attempt_at)
       VALUES (gen_random_uuid(), 'a1', 'community_comment_submitted', '{}', now() + interval '1 hour')`
    )
    // Scheduled for later: nothing is due yet.
    await expect(communityDispatchHasWork(prisma, true)).resolves.toBe(false)
    await sql.query(
      'UPDATE "CommunityCommentAnalyticsOutbox" SET next_attempt_at = now()'
    )
    await expect(communityDispatchHasWork(prisma, true)).resolves.toBe(true)
    // Parked: an unconfigured sink keeps the probe quiet.
    await expect(communityDispatchHasWork(prisma, false)).resolves.toBe(false)
    await sql.query('DELETE FROM "CommunityCommentAnalyticsOutbox"')
    await sql.query('UPDATE "CommunityReactionOutbox" SET next_attempt_at = now()')
    await expect(communityDispatchHasWork(prisma, true)).resolves.toBe(true)
    await expect(communityDispatchHasWork(prisma, false)).resolves.toBe(false)
  })
})

describe('append and spotlight probes', () => {
  it('sees an unappended outbox row', async () => {
    const streams = new CommunityStreamRepository(prisma)
    await expect(streams.hasPending()).resolves.toBe(false)
    await sql.query(
      `INSERT INTO "CommunityDomainOutbox" (id, stream_id, kind, revision, appended_at)
       VALUES (gen_random_uuid(), 'public', 'post.published', 1, now())`
    )
    await expect(streams.hasPending()).resolves.toBe(false)
    await sql.query(
      `INSERT INTO "CommunityDomainOutbox" (id, stream_id, kind, revision)
       VALUES (gen_random_uuid(), 'public', 'post.published', 2)`
    )
    await expect(streams.hasPending()).resolves.toBe(true)
  })

  it('wants a spotlight pass exactly when the cursor is missing, stale or behind the head', async () => {
    const spotlight = new CommunitySpotlightInvalidator(prisma, {} as never)
    await expect(spotlight.hasWork()).resolves.toBe(true)
    await sql.query(
      `INSERT INTO "CommunitySpotlightCursor" (id, epoch, position, updated_at)
       SELECT 'public', epoch, sequence, now() FROM "CommunityStreamHead" WHERE id = 'public'`
    )
    await expect(spotlight.hasWork()).resolves.toBe(false)
    await sql.query('UPDATE "CommunityStreamHead" SET sequence = 3 WHERE id = \'public\'')
    await expect(spotlight.hasWork()).resolves.toBe(true)
    await sql.query('UPDATE "CommunitySpotlightCursor" SET position = 3')
    await expect(spotlight.hasWork()).resolves.toBe(false)
    await sql.query('UPDATE "CommunitySpotlightCursor" SET epoch = gen_random_uuid()')
    await expect(spotlight.hasWork()).resolves.toBe(true)
  })
})

describe('dispatch due hints', () => {
  it('names the earliest future group and delivery, and ignores rows already due', async () => {
    const notifications = new CommunityNotificationsWorker(prisma, {} as never)
    await expect(notifications.nextFanoutDueInMs()).resolves.toBeNull()
    await expect(notifications.nextDispatchDueInMs()).resolves.toBeNull()
    const group = await sql.query<{ id: string }>(
      `INSERT INTO "CommunityNotificationGroup" (id, status, eligible_at, next_attempt_at, expires_at)
       VALUES (gen_random_uuid(), 'deferred', now(), now() + interval '90 seconds', now() + interval '1 day'),
              (gen_random_uuid(), 'pending', now(), now() - interval '5 seconds', now() + interval '1 day')
       RETURNING id`
    )
    const fanoutDue = await notifications.nextFanoutDueInMs()
    expect(fanoutDue).toBeGreaterThan(85_000)
    expect(fanoutDue).toBeLessThanOrEqual(90_000)
    await sql.query(
      `INSERT INTO "CommunityTokenDelivery" (id, group_id, registration_id, binding_generation, status, next_attempt_at)
       VALUES (gen_random_uuid(), $1, 'r1', 0, 'retryable_rejection', now() + interval '12 seconds'),
              (gen_random_uuid(), $1, 'r2', 0, 'pending', now() - interval '1 second'),
              (gen_random_uuid(), $1, 'r3', 0, 'accepted', now() + interval '1 second')`,
      [group.rows[0]!.id]
    )
    const dispatchDue = await notifications.nextDispatchDueInMs()
    expect(dispatchDue).toBeGreaterThan(7_000)
    expect(dispatchDue).toBeLessThanOrEqual(12_000)
  })
})

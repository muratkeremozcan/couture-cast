import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityReactionOutboxDispatcher } from '../src/modules/community/community-reaction.outbox.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'

const database = isolatedCommunityDatabase()
const url = new URL(database.url)
url.searchParams.set('connection_limit', '1')
url.searchParams.set('pool_timeout', '1')
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

async function seedReaction(client = prisma) {
  const user = await client.user.create({
    data: { email: `reaction-lease-${randomUUID()}@synthetic.test` },
  })
  const post = await client.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: user.id, status: 'published' })
    ),
  })
  await new CommunityRepository(client).setReaction({
    userId: user.id,
    postId: post.id,
    platform: 'web',
    input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
    assertEligible: () => Promise.resolve(),
  })
  const row = await client.communityReactionOutbox.findFirstOrThrow({
    where: { post_id: post.id },
  })
  return { user, post, row }
}

beforeAll(() => database.migrate(), 30_000)
beforeEach(() => prisma.communityReactionOutbox.deleteMany())
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  try {
    await prisma.$disconnect()
  } finally {
    await database.drop()
  }
})

describe('Story 6.3 committed reaction lease ownership', () => {
  it.each(['success', 'failure'] as const)(
    'a stale worker with %s cannot settle the reclaimed lease on a one-connection pool',
    async (outcome) => {
      const { row } = await seedReaction()
      const startedA = gate()
      const releaseA = gate()
      const startedB = gate()
      const releaseB = gate()
      const acknowledgedA = vi.fn<(event: unknown) => Promise<void>>(async () => {
        startedA.release()
        await releaseA.promise
        if (outcome === 'failure') throw new Error('synthetic unavailable sink')
      })
      const acknowledgedB = vi.fn(async () => {
        startedB.release()
        await releaseB.promise
      })
      const dispatcher = (captureAcknowledged: typeof acknowledgedA) =>
        new CommunityReactionOutboxDispatcher(
          prisma,
          new TelemetryService(prisma, { capture: vi.fn(), captureAcknowledged })
        )
      const [clock] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now()`
      let sweepNow = clock!.now.getTime()
      vi.spyOn(Date, 'now').mockImplementation(() => sweepNow)
      const first = dispatcher(acknowledgedA).dispatchPending()
      let second: Promise<void> | undefined
      try {
        await startedA.promise
        const leaseA = await prisma.communityReactionOutbox.findUniqueOrThrow({
          where: { id: row.id },
        })
        expect(leaseA).toMatchObject({ attempts: 1, delivered_at: null })
        expect(leaseA.lease_id).not.toBeNull()
        // Reclaim eligibility uses the SQL clock; no wall-clock sleep is needed.
        await prisma.$executeRaw`
          UPDATE "CommunityReactionOutbox"
          SET lease_expires_at = now() - interval '1 second', next_attempt_at = now()
          WHERE id = ${row.id}::uuid`
        second = dispatcher(acknowledgedB).dispatchPending()
        await startedB.promise
        const [schedule] = await prisma.$queryRaw<{ due: Date }[]>`
          SELECT now() + interval '30 minutes' AS due`
        await prisma.communityReactionOutbox.update({
          where: { id: row.id },
          data: { next_attempt_at: schedule!.due },
        })
        const leaseB = await prisma.communityReactionOutbox.findUniqueOrThrow({
          where: { id: row.id },
        })
        expect(leaseB.lease_id).not.toBe(leaseA.lease_id)
        expect(leaseB).toMatchObject({ attempts: 2, delivered_at: null })
        expect(leaseB.lease_id).not.toBeNull()

        // Both workers have exceeded their sweep budget while their one send was held.
        sweepNow += 1001
        releaseA.release()
        await first
        expect(
          await prisma.communityReactionOutbox.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).toEqual(leaseB)
        expect(acknowledgedB).toHaveBeenCalledTimes(1)

        releaseB.release()
        await second
        const final = await prisma.communityReactionOutbox.findUniqueOrThrow({
          where: { id: row.id },
        })
        expect(final).toMatchObject({
          attempts: 2,
          lease_id: null,
          lease_expires_at: null,
          next_attempt_at: leaseB.next_attempt_at,
        })
        expect(final.delivered_at).toBeInstanceOf(Date)
        expect(acknowledgedA).toHaveBeenCalledWith(
          expect.objectContaining({
            timestamp: row.created_at.toISOString(),
            properties: expect.objectContaining({ $insert_id: row.id }) as unknown,
          })
        )
        expect(acknowledgedB).toHaveBeenCalledWith(acknowledgedA.mock.calls[0]?.[0])
        expect(await prisma.telemetryEvent.count({ where: { id: row.id } })).toBe(1)
      } finally {
        releaseA.release()
        releaseB.release()
        await Promise.allSettled([first, ...(second ? [second] : [])])
      }
    }
  )

  it('two simultaneous sweeps deliver one claim before its lease expires', async () => {
    const { row } = await seedReaction()
    const started = gate()
    const release = gate()
    const captureAcknowledged = vi.fn(async () => {
      started.release()
      await release.promise
    })
    const dispatcher = () =>
      new CommunityReactionOutboxDispatcher(
        prisma,
        new TelemetryService(prisma, { capture: vi.fn(), captureAcknowledged })
      )
    let completed = 0
    const run = async () => {
      await dispatcher().dispatchPending()
      completed += 1
    }
    const first = run()
    const second = run()
    try {
      await started.promise
      // One worker has actually observed no eligible work while the other owns the lease.
      await vi.waitFor(() => expect(completed).toBe(1))
      expect(captureAcknowledged).toHaveBeenCalledTimes(1)
      const leased = await prisma.communityReactionOutbox.findUniqueOrThrow({
        where: { id: row.id },
      })
      expect(leased).toMatchObject({ attempts: 1, delivered_at: null })
      expect(leased.lease_id).not.toBeNull()
      release.release()
      await Promise.all([first, second])
      const delivered = await prisma.communityReactionOutbox.findUniqueOrThrow({
        where: { id: row.id },
      })
      expect(delivered).toMatchObject({ attempts: 1, lease_id: null })
      expect(delivered.delivered_at).toBeInstanceOf(Date)
      expect(await prisma.telemetryEvent.count({ where: { id: row.id } })).toBe(1)
    } finally {
      release.release()
      await Promise.allSettled([first, second])
    }
  })

  it('isolated global sweeps leave an unrelated database row and schedule unchanged', async () => {
    const unrelated = new PrismaClient({
      datasources: {
        db: {
          url:
            process.env.INTEGRATION_TEST_DATABASE_URL ??
            'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        },
      },
    })
    let external: Awaited<ReturnType<typeof seedReaction>> | undefined
    try {
      external = await seedReaction(unrelated)
      await unrelated.communityReactionOutbox.update({
        where: { id: external.row.id },
        data: {
          next_attempt_at: new Date(0),
          lease_id: randomUUID(),
          lease_expires_at: new Date(0),
          attempts: 7,
        },
      })
      const before = await unrelated.communityReactionOutbox.findUniqueOrThrow({
        where: { id: external.row.id },
      })
      const [ownDatabase] = await prisma.$queryRaw<{ name: string }[]>`
        SELECT current_database() AS name`
      const [externalDatabase] = await unrelated.$queryRaw<{ name: string }[]>`
        SELECT current_database() AS name`
      expect(ownDatabase!.name).not.toBe(externalDatabase!.name)
      const { row } = await seedReaction()
      const captureAcknowledged = vi.fn().mockResolvedValue(undefined)
      await new CommunityReactionOutboxDispatcher(
        prisma,
        new TelemetryService(prisma, { capture: vi.fn(), captureAcknowledged })
      ).dispatchPending()
      expect(captureAcknowledged).toHaveBeenCalledTimes(1)
      expect(captureAcknowledged).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({ $insert_id: row.id }) as unknown,
        })
      )
      expect(
        await unrelated.communityReactionOutbox.findUniqueOrThrow({
          where: { id: external.row.id },
        })
      ).toEqual(before)
    } finally {
      if (external) {
        await unrelated.lookbookPost.delete({ where: { id: external.post.id } })
        await unrelated.user.delete({ where: { id: external.user.id } })
      }
      await unrelated.$disconnect()
    }
  })
})

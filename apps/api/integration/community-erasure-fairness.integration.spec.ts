// Story 6.11 round 9 read: erasure keeps a row open for 70 hours, repeating its delete.
// Open rows must not take the batch from a request that has had no pass at all, and overdue must count what the batch never reached.
// The sweep is global, so this owns an isolated database.
import 'reflect-metadata'
import { PrismaClient, type LookbookPost } from '@prisma/client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS,
  CommunityMaintenanceService,
  ERASURE_DEADLINE_HOURS,
} from '../src/modules/community/community-maintenance.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'

const BATCH = 200
const HOUR_MS = 60 * 60 * 1000
const SWEEP_MS = 15 * 60 * 1000
const later = (at: Date, ms: number) => new Date(at.getTime() + ms)

const database = isolatedCommunityDatabase()
let prisma: PrismaClient
let authorId: string

beforeAll(async () => {
  await database.migrate()
  prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
  authorId = (await persistUser(prisma, createUser())).id
}, 60_000)

afterAll(async () => {
  await prisma.$disconnect()
  await database.drop()
})

afterEach(async () => {
  await prisma.lookbookPost.deleteMany()
})

describe('erasure sweep fairness across a 70 hour window', () => {
  async function requested(storage: InMemoryCommunityStorage, at: Date) {
    const post = await prisma.lookbookPost.create({
      data: {
        ...buildLookbookPostCreateInput(
          createLookbookPost({ userId: authorId, status: 'published' })
        ),
        erasure_requested_at: at,
      },
    })
    storage.put(post.image_object_path!, Buffer.from('image'))
    return post
  }

  async function openBacklog(
    storage: InMemoryCommunityStorage,
    service: CommunityMaintenanceService,
    start: Date,
    count: number
  ) {
    const rows: LookbookPost[] = []
    for (let index = 0; index < count; index += 1) {
      rows.push(await requested(storage, later(start, index)))
    }
    // Their first pass, so what is left of them is only the repeat.
    for (let pass = 0; pass * BATCH < count; pass += 1) {
      await service.sweepErasureRequests(later(start, pass * 1000 + count))
    }
    const open = await prisma.lookbookPost.count({
      where: { id: { in: rows.map((row) => row.id) }, anonymized_at: null },
    })
    expect(open, 'the backlog must have had its first pass').toBe(0)
    return rows
  }

  it('a new request gets its first pass on the next sweep, behind a full batch of open rows', async () => {
    const storage = new InMemoryCommunityStorage()
    const service = new CommunityMaintenanceService(prisma, storage)
    const start = new Date()
    await openBacklog(storage, service, start, BATCH + 1)

    const requestedAt = later(start, HOUR_MS)
    const newer = await requested(storage, requestedAt)
    await service.sweepErasureRequests(later(requestedAt, SWEEP_MS))

    const row = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: newer.id } })
    expect(row.anonymized_at, 'still waiting behind repeats').not.toBeNull()
    expect(row.status).toBe('withdrawn')
    expect(storage.objects.has(newer.image_object_path!), 'object still there').toBe(
      false
    )
  }, 120_000)

  it('a row past the window gets its final delete, behind a full batch of open rows', async () => {
    const storage = new InMemoryCommunityStorage()
    const service = new CommunityMaintenanceService(prisma, storage)
    const start = new Date()
    const past = await requested(storage, start)
    const firstPassAt = later(start, 1)
    await service.sweepErasureRequests(firstPassAt)
    await openBacklog(
      storage,
      service,
      later(start, COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS - 10 * HOUR_MS),
      BATCH + 1
    )

    const finalAt = later(start, COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS + SWEEP_MS)
    await service.sweepErasureRequests(finalAt)
    const row = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: past.id } })
    expect(row.objects_purged_at, 'the final delete waited').not.toBeNull()
    expect(row.image_object_path).toBeNull()
  }, 120_000)

  it('repeats rotate, so every open row is deleted again across enough sweeps', async () => {
    const storage = new InMemoryCommunityStorage()
    const service = new CommunityMaintenanceService(prisma, storage)
    const start = new Date()
    const rows = await openBacklog(storage, service, start, BATCH + 1)

    const newest = rows.at(-1)!
    storage.put(newest.image_object_path!, Buffer.from('late write'))
    await service.sweepErasureRequests(later(start, SWEEP_MS * 2))
    await service.sweepErasureRequests(later(start, SWEEP_MS * 4))
    expect(storage.objects.has(newest.image_object_path!), 'never reached').toBe(false)
  }, 120_000)

  it('counts overdue for an open row the batch never reached', async () => {
    const storage = new InMemoryCommunityStorage()
    const service = new CommunityMaintenanceService(prisma, storage)
    const start = new Date()
    const overdueRows = BATCH + 5
    storage.remove = () => Promise.reject(new Error('storage down'))
    for (let index = 0; index < overdueRows; index += 1) {
      await requested(storage, later(start, index))
    }
    const result = await service.sweepErasureRequests(
      later(start, (ERASURE_DEADLINE_HOURS + 1) * HOUR_MS)
    )
    expect(result.overdue).toBe(overdueRows)
  }, 120_000)

  it('counts no overdue while every open row is inside the deadline', async () => {
    const storage = new InMemoryCommunityStorage()
    const service = new CommunityMaintenanceService(prisma, storage)
    const start = new Date()
    await requested(storage, start)
    const result = await service.sweepErasureRequests(
      later(start, COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS - HOUR_MS)
    )
    expect(result.overdue).toBe(0)
  })
})

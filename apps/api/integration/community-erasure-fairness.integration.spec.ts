// Story 6.11 round 9 read: erasure keeps a row open for 70 hours, repeating its delete.
// All of it shares one queue ordered by when each row is next due, so no kind of work starves another.
// A new request is due at its request time, a repeat at its last delete attempt plus the pace, a final delete at 70 hours.
// Overdue counts what the batch never reached.
// The sweep is global, so this owns an isolated database.
import 'reflect-metadata'
import { PrismaClient } from '@prisma/client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
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
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS,
  CommunityMaintenanceService,
  ERASURE_DEADLINE_HOURS,
} from '../src/modules/community/community-maintenance.service.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'

const BATCH = 200
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const SWEEP_MS = 15 * MINUTE_MS
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

describe('erasure work is one queue ordered by due time', () => {
  const failingFor = (storage: InMemoryCommunityStorage, failing: Set<string>) => {
    const remove = (paths: string[]) => {
      if (paths.some((path) => failing.has(path))) {
        return Promise.reject(new Error('storage down'))
      }
      for (const path of paths) storage.objects.delete(path)
      return Promise.resolve()
    }
    storage.remove = remove
  }

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

  /** A batch of requests in one insert, so a stream of 200 a sweep stays cheap to set up. */
  async function requestedMany(
    storage: InMemoryCommunityStorage,
    at: Date,
    count: number
  ) {
    const rows = Array.from({ length: count }, (_, index) => ({
      ...buildLookbookPostCreateInput(
        createLookbookPost({ userId: authorId, status: 'published' })
      ),
      erasure_requested_at: later(at, index),
    }))
    await prisma.lookbookPost.createMany({ data: rows })
    const paths = rows.map((row) => row.image_object_path as string)
    for (const path of paths) storage.put(path, Buffer.from('image'))
    return paths
  }

  /** Requests that have all had their first pass, so what is left of them is only the repeat. */
  async function openBacklog(
    storage: InMemoryCommunityStorage,
    service: CommunityMaintenanceService,
    start: Date,
    count: number
  ) {
    const paths = await requestedMany(storage, start, count)
    for (let pass = 0; pass * BATCH < count; pass += 1) {
      await service.sweepErasureRequests(later(start, pass * 1000 + count))
    }
    expect(
      await prisma.lookbookPost.count({
        where: { image_object_path: { in: paths }, anonymized_at: null },
      }),
      'the backlog must have had its first pass'
    ).toBe(0)
    return paths
  }

  const rowOf = (id: string) => prisma.lookbookPost.findUniqueOrThrow({ where: { id } })

  describe('a new request', () => {
    it('goes ahead of a full batch of open rows whose next delete is due later', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const start = new Date()
      await openBacklog(storage, service, start, BATCH + 1)

      const requestedAt = later(start, MINUTE_MS)
      const newer = await requested(storage, requestedAt)
      await service.sweepErasureRequests(later(start, SWEEP_MS + MINUTE_MS))

      const row = await rowOf(newer.id)
      expect(row.anonymized_at, 'still waiting behind repeats').not.toBeNull()
      expect(row.status).toBe('withdrawn')
      expect(storage.objects.has(newer.image_object_path!), 'object still there').toBe(
        false
      )
    }, 120_000)
  })

  describe('a final delete', () => {
    it('closes before 72 hours while 200 new requests arrive every sweep', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const start = new Date()
      const row = await requested(storage, start)
      await service.sweepErasureRequests(later(start, 1))

      let at = later(start, COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
      const deadline = later(start, ERASURE_DEADLINE_HOURS * HOUR_MS)
      let sweeps = 0
      while (at < deadline && !(await rowOf(row.id)).objects_purged_at) {
        await requestedMany(storage, later(at, -MINUTE_MS), BATCH)
        await service.sweepErasureRequests(at)
        sweeps += 1
        at = later(at, SWEEP_MS)
      }
      const closed = await rowOf(row.id)
      expect(closed.objects_purged_at, `open after ${sweeps} sweeps`).not.toBeNull()
      expect(closed.image_object_path).toBeNull()
    }, 240_000)

    it('goes ahead of a full batch of repeats due after it', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const start = new Date()
      const past = await requested(storage, start)
      await service.sweepErasureRequests(later(start, 1))
      await openBacklog(
        storage,
        service,
        later(start, COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS - MINUTE_MS),
        BATCH + 1
      )

      await service.sweepErasureRequests(
        later(start, COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS + 20 * MINUTE_MS)
      )
      const row = await rowOf(past.id)
      expect(row.objects_purged_at, 'the final delete waited').not.toBeNull()
      expect(row.image_object_path).toBeNull()
    }, 120_000)

    it('gets a retry at every sweep from 70 hours to 72 when it keeps failing', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const start = new Date()
      const row = await requested(storage, start)
      await service.sweepErasureRequests(later(start, 1))

      let attempts = 0
      storage.remove = () => {
        attempts += 1
        return Promise.reject(new Error('storage down'))
      }
      let at = later(start, COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
      const deadline = later(start, ERASURE_DEADLINE_HOURS * HOUR_MS)
      while (at < deadline) {
        await service.sweepErasureRequests(at)
        at = later(at, SWEEP_MS)
      }
      expect(attempts, 'the retries the spec claims').toBe(8)
      expect((await rowOf(row.id)).objects_purged_at).toBeNull()
    })
  })

  describe('pacing reads the last delete attempt', () => {
    async function afterOneAttempt() {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const start = new Date()
      const row = await requested(storage, start)
      await service.sweepErasureRequests(start)
      let attempts = 0
      storage.remove = () => {
        attempts += 1
        return Promise.resolve()
      }
      return { service, storage, start, row, attempts: () => attempts }
    }

    it('keeps a rejected delete due at the next pace, and not sooner', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const start = new Date()
      await requested(storage, start)
      let attempts = 0
      storage.remove = () => {
        attempts += 1
        return Promise.reject(new Error('storage down'))
      }
      await service.sweepErasureRequests(start)
      expect(attempts).toBe(1)
      await service.sweepErasureRequests(later(start, MINUTE_MS))
      expect(attempts, 'retried before the pace').toBe(1)
      await service.sweepErasureRequests(later(start, SWEEP_MS))
      expect(attempts, 'not due at the pace').toBe(2)
    })

    it('leaves a row due when the worker dies before its delete settles', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const start = new Date()
      await requested(storage, start)
      let attempts = 0
      let finish!: () => void
      const stuck = new Promise<void>((done) => {
        finish = done
      })
      storage.remove = () => {
        attempts += 1
        return attempts === 1 ? stuck : Promise.resolve()
      }
      const lost = service.sweepErasureRequests(start)
      await expect.poll(() => attempts).toBe(1)

      await service.sweepErasureRequests(later(start, MINUTE_MS))
      expect(attempts, 'a delete that never settled counts as serviced').toBe(2)
      finish()
      await lost
    })

    it('ignores an unrelated update that moves updated_at forward', async () => {
      const { service, start, row, attempts } = await afterOneAttempt()
      await prisma.lookbookPost.update({
        where: { id: row.id },
        data: { updated_at: later(start, SWEEP_MS) },
      })
      await service.sweepErasureRequests(later(start, SWEEP_MS))
      expect(attempts(), 'the update postponed the repeat').toBe(1)
    })

    it('ignores an old updated_at, which does not make a row due early', async () => {
      const { service, start, row, attempts } = await afterOneAttempt()
      await prisma.lookbookPost.update({
        where: { id: row.id },
        data: { updated_at: later(start, -HOUR_MS) },
      })
      await service.sweepErasureRequests(later(start, MINUTE_MS))
      expect(attempts(), 'repeated before the pace').toBe(0)
    })

    it('reaches every open row across enough sweeps', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const start = new Date()
      const paths = await openBacklog(storage, service, start, BATCH + 1)

      const newest = paths.at(-1)!
      storage.put(newest, Buffer.from('late write'))
      await service.sweepErasureRequests(later(start, SWEEP_MS * 2))
      await service.sweepErasureRequests(later(start, SWEEP_MS * 4))
      expect(storage.objects.has(newest), 'never reached').toBe(false)
    }, 120_000)
  })

  describe('a batch of failing rows', () => {
    it('cannot hold a healthy row out of its final delete', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const start = new Date()
      const failing = new Set(await requestedMany(storage, start, BATCH))
      failingFor(storage, failing)
      await service.sweepErasureRequests(later(start, BATCH))

      const healthy = await requested(storage, later(start, MINUTE_MS))
      await service.sweepErasureRequests(later(start, SWEEP_MS))
      expect((await rowOf(healthy.id)).anonymized_at, 'no first pass').not.toBeNull()

      let at = later(start, COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS + SWEEP_MS)
      const deadline = later(start, ERASURE_DEADLINE_HOURS * HOUR_MS)
      while (at < deadline && !(await rowOf(healthy.id)).objects_purged_at) {
        await service.sweepErasureRequests(at)
        at = later(at, SWEEP_MS)
      }
      const row = await rowOf(healthy.id)
      expect(row.objects_purged_at, 'held out by rows that always fail').not.toBeNull()
      expect(
        await prisma.lookbookPost.count({
          where: { image_object_path: { in: [...failing] }, objects_purged_at: null },
        }),
        'the failing rows stay open'
      ).toBe(BATCH)
    }, 240_000)
  })

  describe('overdue', () => {
    it('counts every open row past 72 hours, including those the batch never reached', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const start = new Date()
      const overdueRows = BATCH + 5
      storage.remove = () => Promise.reject(new Error('storage down'))
      await requestedMany(storage, start, overdueRows)
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
})

describe('R11: every delete attempt is stamped when it settles, and paces both sweeps', () => {
  const SETTLE_START = new Date('2026-11-04T00:00:00.000Z')

  // Only Date is faked: storage settles when a test says so, and Postgres keeps real timers.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: SETTLE_START })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const advanceTo = (at: Date) => vi.setSystemTime(at)
  const wallClock = (minutes: number, seconds = 0) =>
    later(SETTLE_START, minutes * MINUTE_MS + seconds * 1000)

  async function openRow(storage: InMemoryCommunityStorage, at: Date) {
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

  const stampOf = async (id: string) =>
    (await prisma.lookbookPost.findUniqueOrThrow({ where: { id } }))
      .image_delete_attempted_at

  describe('R11-1: the erasure sweep', () => {
    it('a slow first delete leaves the next row not due until 15 minutes after its own settle', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const first = await openRow(storage, later(SETTLE_START, -2))
      const second = await openRow(storage, later(SETTLE_START, -1))
      const calls: string[] = []
      storage.remove = (paths: string[]) => {
        calls.push(paths[0]!)
        // The first delete takes 16 minutes, so the second row runs and settles at 00:16.
        if (calls.length === 1) advanceTo(wallClock(16))
        return Promise.resolve()
      }

      await service.sweepErasureRequests()
      expect(calls).toEqual([first.image_object_path, second.image_object_path])
      expect(await stampOf(second.id)).toEqual(wallClock(16))

      advanceTo(wallClock(16, 30))
      await service.sweepErasureRequests()
      expect(calls, 'repeated 30 seconds after it settled').toHaveLength(2)

      advanceTo(wallClock(30, 59))
      await service.sweepErasureRequests()
      expect(calls, 'repeated before its pace').toHaveLength(2)

      advanceTo(wallClock(31))
      await service.sweepErasureRequests()
      expect(calls, 'due 15 minutes after settling').toHaveLength(4)
    })

    it('stamps a rejected delete when it settles too', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const row = await openRow(storage, SETTLE_START)
      storage.remove = () => {
        advanceTo(wallClock(3))
        return Promise.reject(new Error('storage down'))
      }
      await service.sweepErasureRequests()
      expect(await stampOf(row.id)).toEqual(wallClock(3))
    })

    it('an older sweep finishing last leaves the newer stamp in place', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const row = await openRow(storage, SETTLE_START)
      let release!: () => void
      const held = new Promise<void>((done) => {
        release = done
      })
      let calls = 0
      storage.remove = () => {
        calls += 1
        return calls === 1 ? held : Promise.resolve()
      }
      const older = service.sweepErasureRequests()
      await vi.waitFor(() => expect(calls).toBe(1))

      advanceTo(wallClock(2))
      await service.sweepErasureRequests()
      expect(await stampOf(row.id)).toEqual(wallClock(2))

      // The older worker's clock reads earlier when it settles, as a skewed host would.
      advanceTo(wallClock(1))
      release()
      await older
      expect(await stampOf(row.id), 'the stamp moved backward').toEqual(wallClock(2))
    })
  })

  describe('R11-2: an abandoned draft', () => {
    async function abandonedDraft(storage: InMemoryCommunityStorage) {
      const post = await prisma.lookbookPost.create({
        data: {
          ...buildLookbookPostCreateInput(
            createLookbookPost({ userId: authorId, status: 'draft' })
          ),
          published_at: null,
          upload_expires_at: later(
            SETTLE_START,
            -COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS - MINUTE_MS
          ),
        },
      })
      storage.put(post.image_object_path!, Buffer.from('image'))
      return post
    }

    it('a rejecting delete runs once in 15 minutes across both sweeps', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const draft = await abandonedDraft(storage)
      let attempts = 0
      storage.remove = () => {
        attempts += 1
        return Promise.reject(new Error('storage down'))
      }

      await service.sweepExpiredUploads()
      expect(attempts).toBe(1)
      expect(await stampOf(draft.id), 'the attempt went unrecorded').toEqual(SETTLE_START)

      for (const at of [wallClock(0, 30), wallClock(1), wallClock(14, 59)]) {
        advanceTo(at)
        await service.sweepExpiredUploads()
        await service.sweepErasureRequests()
      }
      expect(attempts, 'retried inside the pace').toBe(1)

      advanceTo(wallClock(15))
      await service.sweepExpiredUploads()
      await service.sweepErasureRequests()
      expect(attempts, 'one delete at the pace, across both sweeps').toBe(2)
      expect(await stampOf(draft.id)).toEqual(wallClock(15))
    })

    it('a row retained by a concurrent status change keeps its stamp', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const draft = await abandonedDraft(storage)
      storage.remove = async (paths: string[]) => {
        await prisma.lookbookPost.update({
          where: { id: draft.id },
          data: { status: 'uploading' },
        })
        advanceTo(wallClock(2))
        for (const path of paths) storage.objects.delete(path)
      }

      await service.sweepExpiredUploads()
      expect(await stampOf(draft.id)).toEqual(wallClock(2))
    })

    it('a successful delete leaves no row to stamp', async () => {
      const storage = new InMemoryCommunityStorage()
      const service = new CommunityMaintenanceService(prisma, storage)
      const draft = await abandonedDraft(storage)
      expect(await service.sweepExpiredUploads()).toMatchObject({ draftsDeleted: 1 })
      expect(await prisma.lookbookPost.findUnique({ where: { id: draft.id } })).toBeNull()
      expect(storage.objects.has(draft.image_object_path!)).toBe(false)
    })
  })
})

describe('R10-3: the persisted client expiry', () => {
  it('only moves forward, whatever order two replays finish in', async () => {
    const start = new Date()
    const row = await prisma.lookbookPost.create({
      data: {
        ...buildLookbookPostCreateInput(
          createLookbookPost({ userId: authorId, status: 'draft' })
        ),
        published_at: null,
        upload_expires_at: start,
      },
    })
    const repository = new CommunityRepository(prisma)
    const further = later(start, 15 * MINUTE_MS)
    expect(await repository.confirmAllocationReplay(row.id, further)).toBe(true)
    expect(
      await repository.confirmAllocationReplay(row.id, later(start, MINUTE_MS))
    ).toBe(true)
    expect(
      (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: row.id } }))
        .upload_expires_at
    ).toEqual(further)
  })
})

// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- `expect.any(Date)` matchers inside call assertions are typed any. */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  STAGED_UPLOAD_RETENTION_MS,
  STAGING_SWEEP_CURSOR_KEY,
  WardrobeRetentionService,
} from './wardrobe-retention.service'
import { PUBLISH_CLAIM_LEASE_MS } from './wardrobe-publication'
import { WardrobeObjectDeletionOutbox } from './wardrobe-object-deletion.outbox'
import type { RitualService } from '../personalization/ritual.service'
import type { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'
import { createMockPrisma } from '../../testing/prisma-mock'
import {
  createDeletionTable,
  type DeletionTable,
} from '../../testing/wardrobe-object-deletion-table'

const SESSION_1 = '6c0a3f5e-1d2b-4c8a-9e7f-0a1b2c3d4e5f'
const SESSION_2 = '7d1b4a6f-2e3c-4d9b-8f0a-1b2c3d4e5f60'
const SESSION_3 = '8e2c5b70-3f4d-4eac-9a1b-2c3d4e5f6071'
const GARMENT_HELD = 'a0b1c2d3-e4f5-4607-8899-aabbccddeeff'
const GARMENT_ABANDONED = 'b1c2d3e4-f5a6-4718-99aa-bbccddeeff00'

function garment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'garment-1',
    user_id: 'user-1',
    object_path: 'wardrobe/user-1/garment-1.png',
    retention_status: 'active',
    retention_trigger: null,
    deletion_requested_at: null,
    retention_purged_at: null,
    upload_status: 'ready',
    ...overrides,
  }
}

/** A minimal delegate for the models the shared double does not carry. */
function delegate() {
  return {
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  }
}

/** The sweep's continuation, held the way the one-row table holds it. */
function maintenanceStateTable() {
  const values = new Map<string, string | null>()
  return {
    values,
    findUnique: vi.fn(async (args: { where: { key: string } }) =>
      Promise.resolve(
        values.has(args.where.key)
          ? { key: args.where.key, value: values.get(args.where.key) ?? null }
          : null
      )
    ),
    upsert: vi.fn(
      async (args: { where: { key: string }; update: { value: string | null } }) => {
        values.set(args.where.key, args.update.value)
        return Promise.resolve({ key: args.where.key, value: args.update.value })
      }
    ),
  }
}

/** The row a purge leaves: no object, purged, the image columns cleared. */
function purged(row: ReturnType<typeof garment>) {
  return {
    ...row,
    object_path: null,
    upload_status: 'failed',
    retention_status: 'deletion_pending',
    retention_purged_at: new Date('2026-11-19T12:00:00.000Z'),
  }
}

describe('WardrobeRetentionService', () => {
  /** Aliases onto the shared Prisma double so assertions stay readable. */
  type PrismaMock = ReturnType<typeof createMockPrisma>
  type DelegateFn = PrismaMock['garmentItem']['findFirst']

  let findFirst: DelegateFn
  let findMany: DelegateFn
  let updateMany: DelegateFn
  let garmentUpdate: DelegateFn
  let paletteDeleteMany: DelegateFn
  let auditCreate: DelegateFn
  let storageRemove: Mock
  let listStagedUploads: Mock
  let invalidateUserCache: Mock
  let deletions: DeletionTable
  let maintenanceState: ReturnType<typeof maintenanceStateTable>
  let silhouetteProfile: ReturnType<typeof delegate>
  let paletteProfile: ReturnType<typeof delegate>
  let service: WardrobeRetentionService
  let prisma: PrismaMock

  /** The objects recorded in the deletion outbox, across every `createMany` call. */
  function recordedDeletions(): string[] {
    return deletions.createMany.mock.calls
      .flatMap(([args]) => args.data)
      .map((row) => row.object_path)
  }

  /** Every key storage was asked to remove, one removal per key. */
  function removedKeys(): string[] {
    return storageRemove.mock.calls.flatMap(([paths]) => paths as string[])
  }

  /**
   * The lookups a deletion request reads, in order: the request's own read, the purge's locked
   * re-read, then the outbox's read of the authoritative row, which by then is purged.
   */
  function garmentThenPurged(row: ReturnType<typeof garment>) {
    findFirst
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(row)
      .mockResolvedValue(purged(row))
  }

  beforeEach(() => {
    prisma = createMockPrisma()
    // Round 3 deletion outbox, round 4 judged per key under its row lock, and the sweep cursor.
    deletions = createDeletionTable()
    maintenanceState = maintenanceStateTable()
    silhouetteProfile = delegate()
    paletteProfile = delegate()
    Object.assign(prisma, {
      wardrobeObjectDeletion: deletions,
      wardrobeMaintenanceState: maintenanceState,
      silhouetteProfile,
      paletteProfile,
    })
    storageRemove = vi.fn().mockResolvedValue(undefined)
    listStagedUploads = vi.fn().mockResolvedValue({ objects: [], nextCursor: null })
    invalidateUserCache = vi.fn().mockResolvedValue(true)

    findFirst = prisma.garmentItem.findFirst
    findMany = prisma.garmentItem.findMany
    updateMany = prisma.garmentItem.updateMany
    garmentUpdate = prisma.garmentItem.update
    paletteDeleteMany = prisma.paletteInsights.deleteMany
    auditCreate = prisma.auditLog.create

    updateMany.mockResolvedValue({ count: 1 })
    paletteDeleteMany.mockResolvedValue({ count: 1 })

    service = new WardrobeRetentionService(
      prisma.asPrismaClient(),
      {
        remove: storageRemove,
        listStagedUploads,
      } as unknown as SupabaseWardrobeStorageAdapter,
      { invalidateUserCache } as unknown as RitualService
    )
  })

  it('purges source and derived data after a user deletion request', async () => {
    garmentThenPurged(garment())

    await service.requestDeletion('user-1', 'garment-1')

    expect(storageRemove).toHaveBeenCalledExactlyOnceWith([
      'wardrobe/user-1/garment-1.png',
    ])
    expect(invalidateUserCache).toHaveBeenCalledWith('user-1')
    expect(paletteDeleteMany).toHaveBeenCalledWith({
      where: { garment_item_id: 'garment-1' },
    })
    const updateCall = garmentUpdate.mock.calls[0]?.[0] as
      | { data: Record<string, unknown>; where: { id: string } }
      | undefined
    expect(updateCall?.where).toEqual({ id: 'garment-1' })
    expect(updateCall?.data.object_path).toBeNull()
    expect(updateCall?.data.upload_status).toBe('failed')

    const auditCall = auditCreate.mock.calls[0]?.[0] as
      | {
          data: {
            event_data: Record<string, unknown>
            event_type: string
            user_id: string
          }
        }
      | undefined
    expect(auditCall?.data.user_id).toBe('user-1')
    expect(auditCall?.data.event_type).toBe('garment_retention_purged')
    expect(auditCall?.data.event_data).not.toHaveProperty('objectPath')
    expect(auditCall?.data.event_data).not.toHaveProperty('imageUrl')
  })

  /**
   * Production follow-up 2026-11-19 (round 3): the purge clears the row and records its objects
   * in one transaction, then removes them. Round 4: the outbox locks the garment row, judges
   * the key against it and removes it while holding the lock, then drops the obligation.
   */
  it('records the objects with the purge and removes them after it commits', async () => {
    garmentThenPurged(garment())

    await service.requestDeletion('user-1', 'garment-1')

    expect(deletions.createMany).toHaveBeenCalledExactlyOnceWith({
      data: [{ object_path: 'wardrobe/user-1/garment-1.png', reason: 'garment_purged' }],
      skipDuplicates: true,
    })
    expect(garmentUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      storageRemove.mock.invocationCallOrder[0]!
    )
    expect(prisma.$queryRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
      storageRemove.mock.invocationCallOrder[0]!
    )
    expect([...deletions.rows.keys()]).toEqual([])
  })

  it('keeps the purge and the record when the storage removal fails', async () => {
    garmentThenPurged(garment())
    storageRemove.mockRejectedValueOnce(new Error('storage down'))

    await expect(service.requestDeletion('user-1', 'garment-1')).resolves.toBeUndefined()

    expect(garmentUpdate).toHaveBeenCalledOnce()
    expect(deletions.delete).not.toHaveBeenCalled()
    expect(deletions.rows.get('wardrobe/user-1/garment-1.png')).toMatchObject({
      attempts: 1,
      last_error: 'Error',
    })
  })

  /**
   * Round 5 (Codex C4-5): a garment deleted while a commit still owns its publication may get
   * its final key written after the purge, and storage may finish that write after the lease.
   * The keys are removed now and recorded as a removal that repeats every 15 minutes until 24
   * hours after the claim started, so the late write is removed whenever it lands. Round 4
   * removed nothing until the lease ended and settled after one removal.
   */
  describe('during an unfinished publication', () => {
    const NOW = new Date('2026-11-19T12:00:00.000Z')
    const STARTED = new Date(NOW.getTime() - 60_000)
    const HORIZON = new Date(STARTED.getTime() + 24 * 60 * 60 * 1000)
    const NEXT_REPEAT = new Date(NOW.getTime() + 15 * 60 * 1000)

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('removes the keys now and keeps repeating the removal until the horizon', async () => {
      const publishing = garment({
        upload_status: 'pending_upload',
        upload_session_id: SESSION_1,
        mime_type: 'image/jpeg',
        object_path: 'wardrobe/user-1/garment-1.jpg',
        publish_attempt_id: 'attempt-1',
        publish_started_at: STARTED,
      })
      garmentThenPurged(publishing)

      await service.requestDeletion('user-1', 'garment-1')

      expect(deletions.createMany).toHaveBeenCalledExactlyOnceWith({
        data: [
          {
            object_path: 'wardrobe/user-1/garment-1.jpg',
            reason: 'garment_purged',
            not_before: NOW,
            repeat_until: HORIZON,
          },
          {
            object_path: `staging/user-1/garment/${SESSION_1}.jpg`,
            reason: 'garment_purged',
            not_before: NOW,
            repeat_until: HORIZON,
          },
        ],
        skipDuplicates: true,
      })
      expect(storageRemove.mock.calls).toEqual([
        [['wardrobe/user-1/garment-1.jpg']],
        [[`staging/user-1/garment/${SESSION_1}.jpg`]],
      ])
      expect(
        [...deletions.rows.values()].map((row) => [row.not_before, row.repeat_until])
      ).toEqual([
        [NEXT_REPEAT, HORIZON],
        [NEXT_REPEAT, HORIZON],
      ])
    })

    it('turns an obligation already recorded for the key into a repeating one', async () => {
      const publishing = garment({
        upload_status: 'pending_upload',
        upload_session_id: SESSION_1,
        mime_type: 'image/jpeg',
        object_path: 'wardrobe/user-1/garment-1.jpg',
        publish_attempt_id: 'attempt-1',
        publish_started_at: STARTED,
      })
      garmentThenPurged(publishing)
      await deletions.createMany({
        data: [{ object_path: 'wardrobe/user-1/garment-1.jpg', reason: 'staging_swept' }],
      })

      await service.requestDeletion('user-1', 'garment-1')

      expect(deletions.rows.get('wardrobe/user-1/garment-1.jpg')).toMatchObject({
        repeat_until: HORIZON,
        not_before: NEXT_REPEAT,
      })
      expect(storageRemove).toHaveBeenCalledWith(['wardrobe/user-1/garment-1.jpg'])
    })

    it('removes at once when the claim lease already ran out', async () => {
      const stalled = garment({
        upload_status: 'pending_upload',
        upload_session_id: SESSION_1,
        mime_type: 'image/jpeg',
        object_path: 'wardrobe/user-1/garment-1.jpg',
        publish_attempt_id: 'attempt-1',
        publish_started_at: new Date(NOW.getTime() - PUBLISH_CLAIM_LEASE_MS - 1),
      })
      garmentThenPurged(stalled)

      await service.requestDeletion('user-1', 'garment-1')

      expect(removedKeys()).toEqual([
        'wardrobe/user-1/garment-1.jpg',
        `staging/user-1/garment/${SESSION_1}.jpg`,
      ])
    })
  })

  it('preserves source and metadata under legal hold', async () => {
    findFirst.mockResolvedValue(garment({ retention_status: 'legal_hold' }))

    await service.requestDeletion('user-1', 'garment-1')

    expect(updateMany).not.toHaveBeenCalled()
    expect(storageRemove).not.toHaveBeenCalled()
    expect(deletions.createMany).not.toHaveBeenCalled()
    expect(garmentUpdate).not.toHaveBeenCalled()
    expect(auditCreate).not.toHaveBeenCalled()
    expect(invalidateUserCache).not.toHaveBeenCalled()
  })

  it('claims expired pending uploads for idempotent scheduled cleanup', async () => {
    const abandoned = garment({ retention_trigger: 'abandoned_upload' })
    findMany.mockResolvedValueOnce([abandoned])
    findFirst.mockResolvedValueOnce(abandoned).mockResolvedValue(purged(abandoned))

    await service.purgeExpiredAndDeletedGarments()

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'garment-1',
          retention_status: { not: 'legal_hold' },
        },
      })
    )
    expect(storageRemove).toHaveBeenCalledExactlyOnceWith([
      'wardrobe/user-1/garment-1.png',
    ])
    expect(invalidateUserCache).toHaveBeenCalledWith('user-1')
  })

  /**
   * Review round 1, 2026-11-19: a pending session's bytes sit at its staging key, never at the
   * final path, so purging an abandoned upload removes that key too. Round 3 keys staging on
   * the owner, the kind and the session; round 4 removes each key on its own.
   */
  it('removes a pending session staging key along with the final path', async () => {
    const pending = garment({
      upload_status: 'pending_upload',
      upload_session_id: SESSION_1,
      mime_type: 'image/jpeg',
      object_path: 'wardrobe/user-1/garment-1.jpg',
    })
    findMany.mockResolvedValueOnce([pending])
    findFirst.mockResolvedValueOnce(pending).mockResolvedValue(purged(pending))

    await service.purgeExpiredAndDeletedGarments()

    expect(storageRemove.mock.calls).toEqual([
      [['wardrobe/user-1/garment-1.jpg']],
      [[`staging/user-1/garment/${SESSION_1}.jpg`]],
    ])
  })

  /**
   * Review round 2 (Codex C2-8): read signing and the purge parse the stored path and compare
   * owner, kind and this garment's id in any extension; a seeded ready row has no MIME type.
   */
  it('purges a seeded ready garment that carries no MIME type', async () => {
    garmentThenPurged(
      garment({
        id: 'teen-1-garment-1',
        object_path: 'wardrobe/user-1/teen-1-garment-1.png',
      })
    )

    await service.requestDeletion('user-1', 'teen-1-garment-1')

    expect(storageRemove).toHaveBeenCalledExactlyOnceWith([
      'wardrobe/user-1/teen-1-garment-1.png',
    ])
  })

  /**
   * Review round 1, 2026-11-19 (Codex 1): before the revoke migration a member could write
   * their row's object_path. The purge must never delete what such a path names; it logs, skips
   * the storage call, and still purges the row.
   */
  it.each([
    ['another member', 'wardrobe/user-2/garment-1.png'],
    ['another garment of the same member', 'wardrobe/user-1/garment-2.png'],
    ['a My Form photo', 'wardrobe/user-1/silhouette/garment-1.png'],
    ['a staging key', `staging/user-1/garment/${SESSION_1}.png`],
  ])('never removes a path naming %s', async (_, objectPath) => {
    findFirst.mockResolvedValue(garment({ object_path: objectPath }))

    await service.requestDeletion('user-1', 'garment-1')

    expect(storageRemove).not.toHaveBeenCalled()
    expect(deletions.createMany).not.toHaveBeenCalled()
    expect(garmentUpdate).toHaveBeenCalledOnce()
  })

  /** Round 5 (Codex C4-6): the hold's immutable copy goes with the garment's purge. */
  it('removes the held copy a past legal hold captured when the garment is purged', async () => {
    garmentThenPurged(
      garment({
        id: GARMENT_HELD,
        object_path: `wardrobe/user-1/${GARMENT_HELD}.jpg`,
        upload_status: 'pending_upload',
        upload_session_id: SESSION_1,
        mime_type: 'image/jpeg',
        held_source_sha256: 'a'.repeat(64),
      })
    )

    await service.requestDeletion('user-1', GARMENT_HELD)

    expect(recordedDeletions()).toEqual([
      `wardrobe/user-1/${GARMENT_HELD}.jpg`,
      `staging/user-1/garment/${SESSION_1}.jpg`,
      `held/user-1/${GARMENT_HELD}.jpg`,
    ])
    expect(removedKeys()).toContain(`held/user-1/${GARMENT_HELD}.jpg`)
  })

  /**
   * Round 5 (Codex C4-6): storage can admit two first transfers to one staging key before
   * either completes, so a transfer already admitted when a hold began could replace the held
   * garment's staged source. The hourly job copies the staged bytes whose sha256 matches the
   * declaration, once and without upsert, to held/<user>/<garment>.<ext>, and records the
   * digest. A memory bucket models the storage: what the copy holds is what was verified.
   *
   * Round 6 (Codex C5-3, C5-4, C5-5): the held key is recorded on the row, under the garment row
   * lock, before the copy is written, so a purge or release removes it whatever happens after;
   * every attempt's result is stored for the operator; and capture takes the least recently
   * checked garments first, so uncapturable ones cannot starve the rest. The garment rows live
   * in a small in-memory table that honours the capture query's filter, order and batch size.
   */
  describe('held source capture', () => {
    const STAGED = `staging/user-1/garment/${SESSION_1}.jpg`
    const HELD = `held/user-1/${GARMENT_HELD}.jpg`
    const declared = Buffer.from('the declared source bytes')
    const overlapping = Buffer.from('an overlapping first transfer that completed later')
    const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
    const NOW = new Date('2026-11-19T12:00:00.000Z')
    const DAY_MS = 24 * 60 * 60 * 1000

    type GarmentRow = Record<string, unknown> & { id: string }
    let bucket: Map<string, Buffer>
    let publishOnce: Mock
    let downloadBounded: Mock
    let rows: Map<string, GarmentRow>
    let heldGarment: GarmentRow
    let rowUpdate: Mock
    let failDigestRecord: boolean
    let capturing: WardrobeRetentionService

    /** Sorted the way the capture query asks: never checked first, then oldest check. */
    function captureOrder(a: GarmentRow, b: GarmentRow): number {
      const at = (row: GarmentRow) =>
        row.held_source_checked_at instanceof Date
          ? row.held_source_checked_at.getTime()
          : -Infinity
      return at(a) - at(b) || String(a.created_at).localeCompare(String(b.created_at))
    }

    function heldRow(overrides: Record<string, unknown> = {}): GarmentRow {
      return garment({
        id: GARMENT_HELD,
        object_path: `wardrobe/user-1/${GARMENT_HELD}.jpg`,
        upload_status: 'pending_upload',
        retention_status: 'legal_hold',
        upload_session_id: SESSION_1,
        mime_type: 'image/jpeg',
        content_sha256: sha(declared),
        held_source_sha256: null,
        held_source_captured_at: null,
        held_source_object_path: null,
        held_source_capture_outcome: null,
        held_source_checked_at: null,
        created_at: '2026-11-19T00:00:00.000Z',
        ...overrides,
      }) as GarmentRow
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
      bucket = new Map([[STAGED, declared]])
      failDigestRecord = false
      downloadBounded = vi.fn((objectPath: string) => {
        const bytes = bucket.get(objectPath)
        return Promise.resolve(
          bytes ? { status: 'present', bytes } : { status: 'missing' }
        )
      })
      publishOnce = vi.fn((objectPath: string, bytes: Buffer) => {
        if (bucket.has(objectPath)) return Promise.resolve('exists')
        bucket.set(objectPath, Buffer.from(bytes))
        return Promise.resolve('created')
      })
      heldGarment = heldRow()
      rows = new Map([[heldGarment.id, heldGarment]])
      rowUpdate = vi.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          if (failDigestRecord && data.held_source_sha256) {
            return Promise.reject(new Error('the worker stopped after the write'))
          }
          Object.assign(rows.get(where.id)!, data)
          return Promise.resolve(rows.get(where.id))
        }
      )
      Object.assign(prisma.garmentItem, {
        findMany: vi.fn(
          ({ where, take }: { where: Record<string, unknown>; take: number }) => {
            const all = [...rows.values()]
            if (where.retention_status === 'legal_hold') {
              return Promise.resolve(
                all
                  .filter(
                    (row) =>
                      row.retention_status === 'legal_hold' &&
                      row.upload_status === 'pending_upload' &&
                      row.held_source_sha256 === null &&
                      row.upload_session_id !== null
                  )
                  .sort(captureOrder)
                  .slice(0, take)
              )
            }
            if (where.OR && (where.retention_status as { not?: string })?.not) {
              // The release query: held keys the outbox already owns are left out.
              const [byPath] = where.OR as {
                held_source_object_path?: { notIn: string[] }
              }[]
              const owned = byPath?.held_source_object_path?.notIn ?? []
              return Promise.resolve(
                all.filter(
                  (row) =>
                    row.retention_status !== 'legal_hold' &&
                    ((row.held_source_object_path !== null &&
                      !owned.includes(row.held_source_object_path as string)) ||
                      row.held_source_sha256 !== null)
                )
              )
            }
            return Promise.resolve([])
          }
        ),
        findFirst: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(rows.get(where.id) ?? null)
        ),
        update: rowUpdate,
        updateMany: vi.fn(
          ({
            where,
            data,
          }: {
            where: Record<string, unknown> & { id: string }
            data: Record<string, unknown>
          }) => {
            const row = rows.get(where.id)
            // Equality on every column the guard names, `{ not }` on the retention status.
            const matches =
              row !== undefined &&
              Object.entries(where).every(([column, expected]) =>
                expected !== null && typeof expected === 'object' && 'not' in expected
                  ? row[column] !== (expected as { not: unknown }).not
                  : row[column] === expected
              )
            if (!matches) return Promise.resolve({ count: 0 })
            Object.assign(row, data)
            return Promise.resolve({ count: 1 })
          }
        ),
      })
      capturing = new WardrobeRetentionService(
        prisma.asPrismaClient(),
        {
          // A failed removal leaves the bucket as it was.
          remove: vi.fn(async (paths: string[]) => {
            await (storageRemove(paths) as Promise<void>)
            for (const path of paths) bucket.delete(path)
          }),
          listStagedUploads,
          downloadBounded,
          publishOnce,
        } as unknown as SupabaseWardrobeStorageAdapter,
        { invalidateUserCache } as unknown as RitualService
      )
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    /** Moves past the capture's 24-hour horizon and drains: the held key's removal settles. */
    async function settleHeldRemovalPastHorizon() {
      vi.setSystemTime(new Date(NOW.getTime() + DAY_MS + 60_000))
      await new WardrobeObjectDeletionOutbox(prisma.asPrismaClient(), {
        remove: (paths: string[]) => {
          for (const path of paths) bucket.delete(path)
          return Promise.resolve()
        },
      }).drainDue(new Date())
    }

    it('copies the verified staged bytes once and keeps them when a later transfer replaces staging', async () => {
      expect(await capturing.captureHeldSources(NOW)).toBe(1)

      expect(publishOnce).toHaveBeenCalledExactlyOnceWith(HELD, declared, 'image/jpeg')
      expect(heldGarment).toMatchObject({
        held_source_sha256: sha(declared),
        held_source_captured_at: NOW,
        held_source_object_path: HELD,
        held_source_capture_outcome: 'captured',
        held_source_checked_at: NOW,
      })

      // The overlapping first transfer completes after the copy and replaces staging.
      bucket.set(STAGED, overlapping)
      expect(await capturing.captureHeldSources(NOW)).toBe(0)

      expect(publishOnce).toHaveBeenCalledOnce()
      expect(sha(bucket.get(HELD)!)).toBe(sha(declared))
    })

    it('records the held key on the row under the garment lock before writing the copy', async () => {
      await capturing.captureHeldSources(NOW)

      const obligation = rowUpdate.mock.calls.findIndex(
        ([args]) =>
          (args as { data: Record<string, unknown> }).data.held_source_object_path
      )
      // Final review F-4: the cleanup horizon is recorded with the obligation, before the write.
      expect(rowUpdate.mock.calls[obligation]?.[0]).toEqual({
        where: { id: GARMENT_HELD },
        data: {
          held_source_object_path: HELD,
          held_source_cleanup_until: new Date(NOW.getTime() + DAY_MS),
        },
      })
      expect(rowUpdate.mock.invocationCallOrder[obligation]).toBeLessThan(
        publishOnce.mock.invocationCallOrder[0]!
      )
      const locks = prisma.$queryRaw.mock.calls.map((call) =>
        (call[0] as string[]).join('?')
      )
      expect(locks.filter((sql) => /"GarmentItem".*FOR UPDATE/.test(sql))).toHaveLength(2)
    })

    it('stores a digest mismatch for the operator and writes nothing', async () => {
      bucket.set(STAGED, overlapping)

      expect(await capturing.captureHeldSources(NOW)).toBe(0)

      expect(publishOnce).not.toHaveBeenCalled()
      expect(bucket.has(HELD)).toBe(false)
      expect(heldGarment).toMatchObject({
        held_source_sha256: null,
        held_source_object_path: null,
        held_source_capture_outcome: 'digest_mismatch',
        held_source_checked_at: NOW,
      })
    })

    it('records a copy an earlier run wrote only when it holds the declared bytes', async () => {
      bucket.set(HELD, overlapping)

      expect(await capturing.captureHeldSources(NOW)).toBe(0)
      expect(heldGarment.held_source_sha256).toBeNull()
      expect(heldGarment.held_source_capture_outcome).toBe('copy_mismatch')

      bucket.set(HELD, declared)
      expect(await capturing.captureHeldSources(NOW)).toBe(1)
      expect(heldGarment.held_source_sha256).toBe(sha(declared))
    })

    it('stores that no bytes were staged yet and writes nothing', async () => {
      bucket.clear()

      expect(await capturing.captureHeldSources(NOW)).toBe(0)
      expect(publishOnce).not.toHaveBeenCalled()
      expect(heldGarment.held_source_capture_outcome).toBe('missing')
    })

    /**
     * Codex C5-4: a worker that stops after writing the copy and before recording its digest
     * left a held object nothing knew about, and purge cleared the MIME type needed to rebuild
     * its key. The obligation recorded before the write lets the purge after release remove it,
     * and the purge clears every held column with the content digest.
     */
    it('removes a copy whose digest was never recorded once the garment is released and purged', async () => {
      failDigestRecord = true
      expect(await capturing.captureHeldSources(NOW)).toBe(0)
      expect(bucket.has(HELD)).toBe(true)
      expect(heldGarment).toMatchObject({
        held_source_sha256: null,
        held_source_object_path: HELD,
        held_source_capture_outcome: 'failed',
      })

      // The operator releases the hold (any update of the row waits for the capture's lock).
      Object.assign(heldGarment, { retention_status: 'active' })
      await capturing.requestDeletion('user-1', GARMENT_HELD)

      expect(recordedDeletions()).toContain(HELD)
      expect(bucket.has(HELD)).toBe(false)
      // The key stays on the garment while its removal repeats until the capture's horizon.
      expect(heldGarment).toMatchObject({
        content_sha256: null,
        held_source_sha256: null,
        held_source_captured_at: null,
        held_source_object_path: HELD,
      })

      await settleHeldRemovalPastHorizon()
      expect(heldGarment).toMatchObject({
        held_source_object_path: null,
        held_source_cleanup_until: null,
      })
    })

    it('writes nothing when the hold was released between the read and the write', async () => {
      let reads = 0
      Object.assign(prisma.garmentItem, {
        findFirst: vi.fn(({ where }: { where: { id: string } }) => {
          reads += 1
          // The obligation's locked read sees the hold; the release commits before the write.
          if (reads === 2) Object.assign(heldGarment, { retention_status: 'active' })
          return Promise.resolve(rows.get(where.id) ?? null)
        }),
      })

      expect(await capturing.captureHeldSources(NOW)).toBe(0)

      expect(publishOnce).not.toHaveBeenCalled()
      expect(heldGarment.held_source_object_path).toBe(HELD)

      // The hourly release step records the obligation; the outbox judges the key removable
      // and clears it from the garment once the removal settled past the horizon.
      expect(await capturing.releaseUnheldCopies()).toBe(1)
      expect(recordedDeletions()).toEqual([HELD])
      expect(heldGarment.held_source_object_path).toBe(HELD)
      await settleHeldRemovalPastHorizon()
      expect(heldGarment.held_source_object_path).toBeNull()
    })

    it('removes the copy of a garment whose hold was released, and clears its held columns', async () => {
      expect(await capturing.captureHeldSources(NOW)).toBe(1)
      Object.assign(heldGarment, { retention_status: 'active' })

      expect(await capturing.releaseUnheldCopies()).toBe(1)

      expect(recordedDeletions()).toEqual([HELD])
      expect(bucket.has(HELD)).toBe(false)
      expect(heldGarment).toMatchObject({
        held_source_sha256: null,
        held_source_captured_at: null,
        held_source_object_path: HELD,
      })
      // The next hourly release leaves a key the outbox already owns alone.
      expect(await capturing.releaseUnheldCopies()).toBe(0)

      await settleHeldRemovalPastHorizon()
      expect(heldGarment).toMatchObject({
        held_source_object_path: null,
        held_source_cleanup_until: null,
      })
      expect(deletions.rows.size).toBe(0)
    })

    /**
     * Final review F-4: the capture's transaction timed out (or its worker stopped) while
     * storage was still applying the copy. The release that follows finds no object, and the
     * write lands after that first removal. The horizon recorded before the write keeps the
     * removal repeating, so the late copy is removed on the next 15-minute drain.
     */
    it('removes a held copy that lands after the release already removed its absent key', async () => {
      let landLate: () => void = () => undefined
      publishOnce.mockImplementationOnce((objectPath: string, bytes: Buffer) => {
        landLate = () => bucket.set(objectPath, Buffer.from(bytes))
        return Promise.reject(
          new Error('transaction timed out while storage applied the write')
        )
      })
      expect(await capturing.captureHeldSources(NOW)).toBe(0)
      expect(bucket.has(HELD)).toBe(false)

      Object.assign(heldGarment, { retention_status: 'active' })
      expect(await capturing.releaseUnheldCopies()).toBe(1)
      expect(removedKeys()).toEqual([HELD])

      landLate()
      expect(bucket.has(HELD)).toBe(true)

      vi.setSystemTime(new Date(NOW.getTime() + 16 * 60 * 1000))
      await capturing.drainDeletions(new Date())

      expect(bucket.has(HELD)).toBe(false)
      expect(removedKeys()).toEqual([HELD, HELD])
    })

    /**
     * Final review F-5: a hold reapplied before the release's removal settled makes the outbox
     * drop its row and keep the copy. The key stays on the garment, so the next release, after
     * the hold ends again, still removes the copy.
     */
    it('still removes the copy when a hold is reapplied and released again before the removal settled', async () => {
      expect(await capturing.captureHeldSources(NOW)).toBe(1)
      Object.assign(heldGarment, { retention_status: 'active' })
      storageRemove.mockRejectedValueOnce(new Error('storage unavailable'))
      expect(await capturing.releaseUnheldCopies()).toBe(1)
      expect(bucket.has(HELD)).toBe(true)

      // The operator holds the garment again; the outbox's retry sees the hold and drops its row.
      Object.assign(heldGarment, { retention_status: 'legal_hold' })
      vi.setSystemTime(new Date(NOW.getTime() + 6 * 60 * 1000))
      await capturing.drainDeletions(new Date())
      expect(deletions.rows.size).toBe(0)
      expect(bucket.has(HELD)).toBe(true)

      // Released again, with no capture in between.
      Object.assign(heldGarment, { retention_status: 'active' })
      expect(await capturing.releaseUnheldCopies()).toBe(1)

      expect(bucket.has(HELD)).toBe(false)
    })

    it('keeps the copy while the hold still stands', async () => {
      expect(await capturing.captureHeldSources(NOW)).toBe(1)

      expect(await capturing.releaseUnheldCopies()).toBe(0)
      expect(bucket.has(HELD)).toBe(true)
    })

    /**
     * Codex C5-5: the query always took the oldest twenty unmarked rows, so twenty held
     * allocations with no staged bytes kept a capturable twenty-first from ever being read.
     */
    it('reaches a capturable garment behind a full page of garments with no staged bytes', async () => {
      rows.clear()
      for (let index = 0; index < 20; index += 1) {
        const id = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
        rows.set(
          id,
          heldRow({
            id,
            object_path: `wardrobe/user-1/${id}.jpg`,
            upload_session_id: `10000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
            created_at: `2026-11-18T00:00:${index.toString().padStart(2, '0')}.000Z`,
          })
        )
      }
      rows.set(GARMENT_HELD, heldGarment)

      expect(await capturing.captureHeldSources(NOW)).toBe(0)
      expect(
        [...rows.values()].filter((row) => row.held_source_capture_outcome === 'missing')
      ).toHaveLength(20)

      vi.setSystemTime(new Date(NOW.getTime() + 60 * 60 * 1000))
      expect(await capturing.captureHeldSources(new Date())).toBe(1)
      expect(heldGarment.held_source_sha256).toBe(sha(declared))
    })

    it('runs first in the hourly maintenance job, which no longer drains deletions', async () => {
      const drain = vi.spyOn(WardrobeObjectDeletionOutbox.prototype, 'drainDue')

      await capturing.purgeExpiredAndDeletedGarments()

      expect(publishOnce).toHaveBeenCalledExactlyOnceWith(HELD, declared, 'image/jpeg')
      expect(publishOnce.mock.invocationCallOrder[0]).toBeLessThan(
        listStagedUploads.mock.invocationCallOrder[0]!
      )
      expect(drain).not.toHaveBeenCalled()
      drain.mockRestore()
    })
  })

  describe('staged upload sweep', () => {
    const now = new Date('2026-11-19T12:00:00.000Z')
    const cutoff = now.getTime() - STAGED_UPLOAD_RETENTION_MS
    const staged = (objectPath: string, ageOffsetMs: number) => ({
      objectPath,
      createdAt: new Date(cutoff - ageOffsetMs),
    })
    const page = (
      objects: ReturnType<typeof staged>[],
      nextCursor: string | null = null
    ) => ({
      objects,
      nextCursor,
    })
    const myFormStaging = (session: string) => `staging/user-1/silhouette/${session}.jpg`
    const myFormFinal = (session: string) => `wardrobe/user-1/silhouette/${session}.jpg`
    /** A distinct, valid session id per index, so every staged key is its own session. */
    const sessionNo = (index: number) =>
      `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(now)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('keeps the window at the 2 hour token lifetime plus 15 minutes', () => {
      expect(STAGED_UPLOAD_RETENTION_MS).toBe(2 * 60 * 60 * 1000 + 15 * 60 * 1000)
    })

    /**
     * Review round 1, 2026-11-19 (Codex 2, lens 2): a signed URL can still write for 2 hours
     * after its garment, My Form or selfie is deleted, replaced or purged, and an abandoned My
     * Form or selfie session keeps unverified bytes. Those writes only ever land in staging, and
     * the hourly job removes whatever no commit can claim any more, with the session's derived
     * final key (round 3: covers a commit that published and never claimed).
     */
    it('removes staged objects past the window and keeps newer ones', async () => {
      listStagedUploads.mockResolvedValueOnce(
        page([
          staged(myFormStaging(SESSION_1), 60_000),
          staged(myFormStaging(SESSION_2), 0),
          staged(myFormStaging(SESSION_3), -1),
        ])
      )

      await expect(service.purgeStaleStagedUploads(now)).resolves.toBe(2)

      expect(recordedDeletions()).toEqual([
        myFormStaging(SESSION_1),
        myFormFinal(SESSION_1),
        myFormStaging(SESSION_2),
        myFormFinal(SESSION_2),
      ])
      expect(removedKeys()).toEqual(recordedDeletions())
      expect(listStagedUploads).toHaveBeenCalledOnce()
    })

    it('removes a staged key nothing could have signed', async () => {
      listStagedUploads.mockResolvedValueOnce(page([staged('staging/stray.jpg', 1)]))

      await expect(service.purgeStaleStagedUploads(now)).resolves.toBe(1)

      expect(storageRemove).toHaveBeenCalledExactlyOnceWith(['staging/stray.jpg'])
    })

    /**
     * Review round 2 (Codex C2-3): a pending garment put on legal hold after its PUT keeps its
     * only source image; an ordinary abandoned one beside it is removed with its derived final.
     */
    it('keeps an aged held garment upload and removes an aged abandoned one', async () => {
      const heldStaging = `staging/user-1/garment/${SESSION_1}.jpg`
      const abandonedStaging = `staging/user-1/garment/${SESSION_2}.jpg`
      listStagedUploads.mockResolvedValueOnce(
        page([staged(heldStaging, 5_000), staged(abandonedStaging, 4_000)])
      )
      findMany.mockResolvedValueOnce([
        {
          id: GARMENT_HELD,
          user_id: 'user-1',
          upload_session_id: SESSION_1,
          retention_status: 'legal_hold',
        },
        {
          id: GARMENT_ABANDONED,
          user_id: 'user-1',
          upload_session_id: SESSION_2,
          retention_status: 'active',
        },
      ])

      await expect(service.purgeStaleStagedUploads(now)).resolves.toBe(1)

      const abandonedFinal = `wardrobe/user-1/${GARMENT_ABANDONED}.jpg`
      expect(recordedDeletions()).toEqual([abandonedStaging, abandonedFinal])
      expect(removedKeys()).toEqual([abandonedStaging, abandonedFinal])
      expect(removedKeys()).not.toContain(heldStaging)
    })

    /**
     * Round 4 (Codex round 3 finding 3): the outbox locks the garment row across its judgment
     * and the removal. A hold that landed after the sweep's own read is seen under the lock,
     * and the staged source is kept.
     */
    it('keeps a staged garment upload whose hold landed after the sweep read it', async () => {
      const stagedKey = `staging/user-1/garment/${SESSION_1}.jpg`
      listStagedUploads.mockResolvedValueOnce(page([staged(stagedKey, 1)]))
      findMany.mockResolvedValueOnce([])
      findFirst.mockResolvedValue(
        garment({
          id: GARMENT_HELD,
          upload_status: 'pending_upload',
          upload_session_id: SESSION_1,
          retention_status: 'legal_hold',
        })
      )

      await service.purgeStaleStagedUploads(now)

      expect(findFirst).toHaveBeenCalledWith({
        where: { upload_session_id: SESSION_1, user_id: 'user-1' },
      })
      expect(storageRemove).not.toHaveBeenCalled()
      expect(deletions.rows.size).toBe(0)
    })

    /**
     * Review round 2: the derived final key of a committed My Form or selfie is live, so the
     * outbox drops it without removing it; only the stale staging key goes. Round 4 judges each
     * key against the owner's own profile row.
     */
    it.each([
      ['My Form', 'silhouette', 'my_form'],
      ['selfie', 'palette', 'selfie'],
    ] as const)('keeps a committed %s final key', async (_, kind, prefix) => {
      const stagingKey = `staging/user-1/${kind}/${SESSION_1}.jpg`
      const finalKey = `wardrobe/user-1/${kind}/${SESSION_1}.jpg`
      listStagedUploads.mockResolvedValueOnce(page([staged(stagingKey, 1)]))
      const owner = kind === 'silhouette' ? silhouetteProfile : paletteProfile
      owner.findUnique.mockResolvedValue(
        prefix === 'my_form'
          ? {
              user_id: 'user-1',
              my_form_upload_session_id: SESSION_1,
              my_form_object_path: finalKey,
              my_form_status: 'ready',
            }
          : {
              user_id: 'user-1',
              selfie_upload_session_id: SESSION_1,
              selfie_object_path: finalKey,
              status: 'processing',
              source: 'selfie',
              analysis_attempt_id: SESSION_1,
            }
      )

      await service.purgeStaleStagedUploads(now)

      expect(recordedDeletions()).toEqual([stagingKey, finalKey])
      expect(storageRemove).toHaveBeenCalledExactlyOnceWith([stagingKey])
      expect(deletions.rows.size).toBe(0)
    })

    it('follows the listing cursor through full pages and stops on the last one', async () => {
      const fullPage = Array.from({ length: 100 }, () =>
        staged('staging/stray.jpg', 1000)
      )
      listStagedUploads
        .mockResolvedValueOnce(page(fullPage, 'cursor-1'))
        .mockResolvedValueOnce(page([], null))

      await expect(service.purgeStaleStagedUploads(now)).resolves.toBe(100)

      expect(listStagedUploads.mock.calls).toEqual([
        [100, null],
        [100, 'cursor-1'],
      ])
      expect(maintenanceState.values.get(STAGING_SWEEP_CURSOR_KEY)).toBeNull()
    })

    it('stops at the first page that holds a fresh object and restarts from the oldest', async () => {
      maintenanceState.values.set(STAGING_SWEEP_CURSOR_KEY, 'cursor-7')
      listStagedUploads.mockResolvedValueOnce(
        page([staged('staging/old.jpg', 1), staged('staging/new.jpg', -1)], 'cursor-8')
      )

      await expect(service.purgeStaleStagedUploads(now)).resolves.toBe(1)

      expect(listStagedUploads).toHaveBeenCalledExactlyOnceWith(100, 'cursor-7')
      expect(maintenanceState.values.get(STAGING_SWEEP_CURSOR_KEY)).toBeNull()
    })

    it('stops after a bounded number of pages per run and keeps its place', async () => {
      let pageNo = 0
      listStagedUploads.mockImplementation(() => {
        pageNo += 1
        return Promise.resolve(
          page(
            Array.from({ length: 100 }, () => staged('staging/stray.jpg', 1000)),
            `cursor-${pageNo}`
          )
        )
      })

      await service.purgeStaleStagedUploads(now)

      expect(listStagedUploads).toHaveBeenCalledTimes(10)
      expect(maintenanceState.values.get(STAGING_SWEEP_CURSOR_KEY)).toBe('cursor-10')
    })

    /**
     * Round 4 (Codex round 3 finding 11): held keys stay in the listing for good. A run whose
     * whole page budget is held keys saves where it stopped, and the next run continues there
     * and reaches the expired ordinary upload behind them.
     */
    it('reaches an expired upload behind a full budget of held keys on the next run', async () => {
      const heldPages = Array.from({ length: 10 }, (_, pageIndex) =>
        page(
          Array.from({ length: 100 }, (_, index) =>
            staged(
              `staging/user-1/garment/${sessionNo(pageIndex * 100 + index)}.jpg`,
              9_000
            )
          ),
          `held-${pageIndex + 1}`
        )
      )
      const abandonedKey = myFormStaging(SESSION_3)
      listStagedUploads.mockImplementation((_limit: number, cursor: string | null) => {
        if (cursor === 'held-10') return Promise.resolve(page([staged(abandonedKey, 1)]))
        const index = cursor === null ? 0 : Number(cursor.split('-')[1])
        return Promise.resolve(heldPages[index]!)
      })
      // The sweep's own hold read, once per page: every garment on these pages is held.
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        findMany.mockResolvedValueOnce(
          Array.from({ length: 100 }, (_, index) => ({
            id: `held-garment-${pageIndex * 100 + index}`,
            user_id: 'user-1',
            upload_session_id: sessionNo(pageIndex * 100 + index),
            retention_status: 'legal_hold',
          }))
        )
      }

      await expect(service.purgeStaleStagedUploads(now)).resolves.toBe(0)
      expect(storageRemove).not.toHaveBeenCalled()
      expect(maintenanceState.values.get(STAGING_SWEEP_CURSOR_KEY)).toBe('held-10')

      await expect(service.purgeStaleStagedUploads(now)).resolves.toBe(1)

      expect(listStagedUploads.mock.calls.at(-1)).toEqual([100, 'held-10'])
      expect(removedKeys()).toEqual([abandonedKey, myFormFinal(SESSION_3)])
      expect(maintenanceState.values.get(STAGING_SWEEP_CURSOR_KEY)).toBeNull()
    })

    it('forgets a saved cursor the listing refuses, so the next run starts over', async () => {
      maintenanceState.values.set(STAGING_SWEEP_CURSOR_KEY, 'cursor-stale')
      listStagedUploads.mockRejectedValueOnce(new Error('invalid cursor'))

      await expect(service.purgeStaleStagedUploads(now)).rejects.toThrow('invalid cursor')

      expect(listStagedUploads).toHaveBeenCalledExactlyOnceWith(100, 'cursor-stale')
      expect(maintenanceState.values.get(STAGING_SWEEP_CURSOR_KEY)).toBeNull()
    })

    /**
     * Round 6 (Codex C5-8): the hourly job sweeps staging; recorded deletions drain on their own
     * 15-minute job (`drainDeletions`), so a repeating removal is not held to the hourly tick.
     */
    it('runs in the hourly retention job, and leaves due deletions to the 15-minute drain', async () => {
      findMany.mockResolvedValueOnce([])
      listStagedUploads.mockResolvedValueOnce(page([staged('staging/abandoned.jpg', 1)]))
      await deletions.createMany({
        data: [
          {
            object_path: 'wardrobe/user-1/garment-9.png',
            reason: 'garment_purged',
            not_before: new Date(now.getTime() - 60_000),
          },
        ],
      })

      await service.purgeExpiredAndDeletedGarments()

      expect(storageRemove.mock.calls).toEqual([[['staging/abandoned.jpg']]])
      // The hourly job reads no due deletions; the release step only reads outstanding held keys.
      expect(deletions.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ not_before: expect.anything() }),
        })
      )
      expect(deletions.rows.has('wardrobe/user-1/garment-9.png')).toBe(true)

      await expect(service.drainDeletions(now)).resolves.toBe(1)

      expect(storageRemove.mock.calls).toEqual([
        [['staging/abandoned.jpg']],
        [['wardrobe/user-1/garment-9.png']],
      ])
      expect(deletions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { not_before: { lte: now } } })
      )
      expect(deletions.rows.size).toBe(0)
    })

    /**
     * Round 4 (Codex round 3 finding 11): a listing failure must not hold back due deletions.
     * Since round 6 the drain is its own job, so the listing cannot reach it at all; the hourly
     * job still raises the failure afterwards, after every garment had its turn.
     */
    it('raises a listing failure after every garment had its turn, and keeps a failed removal recorded', async () => {
      const purgeTarget = garment()
      findMany.mockResolvedValueOnce([purgeTarget])
      findFirst.mockResolvedValueOnce(purgeTarget).mockResolvedValue(purged(purgeTarget))
      storageRemove.mockRejectedValueOnce(new Error('storage blip'))
      listStagedUploads.mockRejectedValueOnce(new Error('storage down'))

      await expect(service.purgeExpiredAndDeletedGarments()).rejects.toThrow(
        'storage down'
      )

      expect(garmentUpdate).toHaveBeenCalledOnce()
      // The purge's own removal failed and stays recorded for the drain's retry.
      expect(deletions.rows.get('wardrobe/user-1/garment-1.png')?.attempts).toBe(1)
    })

    it('removes an already due deletion on the drain whatever the hourly listing did', async () => {
      findMany.mockResolvedValueOnce([])
      listStagedUploads.mockRejectedValueOnce(new Error('storage down'))
      await deletions.createMany({
        data: [
          {
            object_path: 'wardrobe/user-1/garment-9.png',
            reason: 'garment_purged',
            not_before: new Date(now.getTime() - 60_000),
          },
        ],
      })

      await expect(service.purgeExpiredAndDeletedGarments()).rejects.toThrow(
        'storage down'
      )
      await service.drainDeletions(now)

      expect(storageRemove).toHaveBeenCalledExactlyOnceWith([
        'wardrobe/user-1/garment-9.png',
      ])
      expect(deletions.rows.size).toBe(0)
    })
  })

  /**
   * Round 4 (Codex round 3 finding 5): the hourly job re-enqueues processing photos whose job
   * handoff never happened, through the producers only the worker runtime provides.
   */
  describe('processing handoff', () => {
    const now = new Date('2026-11-19T12:00:00.000Z')

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(now)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('re-enqueues a stranded My Form photo when the producers are given', async () => {
      const silhouetteEnqueue = vi.fn().mockResolvedValue(undefined)
      const paletteEnqueue = vi.fn().mockResolvedValue(undefined)
      const garmentEnqueue = vi.fn().mockResolvedValue(undefined)
      const withHandoffs = new WardrobeRetentionService(
        prisma.asPrismaClient(),
        {
          remove: storageRemove,
          listStagedUploads,
        } as unknown as SupabaseWardrobeStorageAdapter,
        { invalidateUserCache } as unknown as RitualService,
        {
          garment: { enqueue: garmentEnqueue },
          silhouette: { enqueue: silhouetteEnqueue },
          palette: { enqueue: paletteEnqueue },
        }
      )
      silhouetteProfile.findMany.mockResolvedValueOnce([
        {
          id: 'profile-1',
          my_form_status: 'processing',
          my_form_upload_session_id: SESSION_1,
          my_form_processing_job_enqueued_at: null,
        },
      ])

      await withHandoffs.purgeExpiredAndDeletedGarments()

      expect(silhouetteEnqueue).toHaveBeenCalledExactlyOnceWith('profile-1', SESSION_1)
      expect(silhouetteProfile.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'profile-1',
          my_form_status: 'processing',
          my_form_upload_session_id: SESSION_1,
          my_form_processing_job_enqueued_at: null,
        },
        data: { my_form_processing_job_enqueued_at: now },
      })
      expect(paletteEnqueue).not.toHaveBeenCalled()
      expect(garmentEnqueue).not.toHaveBeenCalled()
    })

    it('reads no processing rows when no producers are given', async () => {
      await service.purgeExpiredAndDeletedGarments()

      expect(silhouetteProfile.findMany).not.toHaveBeenCalled()
      expect(paletteProfile.findMany).not.toHaveBeenCalled()
    })
  })
})

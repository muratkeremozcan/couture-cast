// Learning path Step 38: Community feed by climate band.
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  CommunityMaintenanceService,
  ERASURE_DEADLINE_HOURS,
  STALE_PENDING_REVIEW_MINUTES,
} from './community-maintenance.service'
import { InMemoryCommunityStorage } from './community-storage.fake'

describe('CommunityMaintenanceService', () => {
  const now = new Date('2026-09-05T12:00:00.000Z')

  const createService = () => {
    const findMany = vi.fn()
    const update = vi.fn().mockResolvedValue({})
    const updateMany = vi.fn()
    const deleteMany = vi.fn()
    const jobFailureCreate = vi.fn().mockResolvedValue({ id: 'jf-1' })
    const prisma = {
      lookbookPost: { findMany, update, updateMany, deleteMany },
      jobFailure: { create: jobFailureCreate },
    } as unknown as PrismaClient

    const storage = new InMemoryCommunityStorage()
    return {
      service: new CommunityMaintenanceService(prisma, storage),
      storage,
      findMany,
      update,
      updateMany,
      deleteMany,
      jobFailureCreate,
    }
  }

  describe('sweepStalePendingReview', () => {
    it('claims posts stuck past the stall deadline', async () => {
      const { service, findMany } = createService()
      findMany.mockResolvedValueOnce([])

      await service.sweepStalePendingReview(now)

      const expectedDeadline = new Date(
        now.getTime() - STALE_PENDING_REVIEW_MINUTES * 60 * 1000
      )
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'pending_review', updated_at: { lt: expectedDeadline } },
        })
      )
    })

    it('moves a stalled post to review_failed and records an operator alert', async () => {
      // A hung job never fails, so the worker catch never runs and the post
      // would otherwise sit in pending_review forever with no author recovery
      // state and no operator signal.
      const { service, findMany, updateMany, jobFailureCreate } = createService()
      findMany.mockResolvedValueOnce([
        {
          id: 'post-stalled',
          image_object_path: 'community/post-stalled/s.jpg',
          updated_at: new Date('2026-09-05T11:00:00.000Z'),
        },
      ])
      updateMany.mockResolvedValueOnce({ count: 1 })

      const result = await service.sweepStalePendingReview(now)

      expect(result).toEqual({ stalled: 1 })
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'post-stalled', status: 'pending_review' },
        data: { status: 'review_failed', moderation_reason: 'moderation_stalled' },
      })
      // The alert lands in the repository's existing dead-letter surface, so
      // `AdminService.listFailedJobs` shows it and `retryFailedJob` re-drives
      // the exact screening job.
      expect(jobFailureCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          queue_name: 'community-moderation',
          job_id: 'stalled__post-stalled',
          job_data: { postId: 'post-stalled', uploadSessionId: 'post-stalled' },
        }) as unknown,
      })
    })

    it('does not alert for a post another worker already moved on', async () => {
      const { service, findMany, updateMany, jobFailureCreate } = createService()
      findMany.mockResolvedValueOnce([
        {
          id: 'post-raced',
          image_object_path: null,
          updated_at: new Date('2026-09-05T11:00:00.000Z'),
        },
      ])
      updateMany.mockResolvedValueOnce({ count: 0 })

      const result = await service.sweepStalePendingReview(now)

      expect(result).toEqual({ stalled: 0 })
      expect(jobFailureCreate).not.toHaveBeenCalled()
    })

    it('survives a failure to write the alert row', async () => {
      const { service, findMany, updateMany, jobFailureCreate } = createService()
      findMany.mockResolvedValueOnce([
        {
          id: 'post-stalled',
          image_object_path: null,
          updated_at: new Date('2026-09-05T11:00:00.000Z'),
        },
      ])
      updateMany.mockResolvedValueOnce({ count: 1 })
      jobFailureCreate.mockRejectedValueOnce(new Error('db down'))

      await expect(service.sweepStalePendingReview(now)).resolves.toEqual({ stalled: 1 })
    })
  })

  describe('sweepErasureRequests', () => {
    const erasureRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'post-erase',
      status: 'published',
      image_object_path: 'community/post-erase/s.jpg',
      anonymized_at: null,
      erasure_requested_at: new Date('2026-09-05T11:00:00.000Z'),
      ...overrides,
    })

    it('claims requests that have not had their objects purged', async () => {
      const { service, findMany } = createService()
      findMany.mockResolvedValueOnce([])

      await service.sweepErasureRequests(now)

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { erasure_requested_at: { not: null }, objects_purged_at: null },
        })
      )
    })

    it('hides the post before deleting its object', async () => {
      // A signed URL already handed out keeps working until it expires, so the
      // row has to stop being served first.
      const { service, storage, findMany, update, updateMany } = createService()
      storage.put('community/post-erase/s.jpg', Buffer.from('bytes'))
      findMany.mockResolvedValueOnce([erasureRow()])
      updateMany.mockResolvedValueOnce({ count: 1 })

      const result = await service.sweepErasureRequests(now)

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'post-erase' },
        data: { status: 'withdrawn' },
      })
      expect(updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
        update.mock.invocationCallOrder[0]!
      )
      expect(storage.removed).toEqual(['community/post-erase/s.jpg'])
      expect(result).toEqual({ hidden: 1, anonymized: 1, objectsPurged: 1, overdue: 0 })
    })

    it('anonymizes the retained content fields and stamps each step separately', async () => {
      const { service, findMany, update, updateMany } = createService()
      findMany.mockResolvedValueOnce([erasureRow()])
      updateMany.mockResolvedValueOnce({ count: 1 })

      await service.sweepErasureRequests(now)

      expect(update).toHaveBeenCalledWith({
        where: { id: 'post-erase' },
        data: {
          caption: null,
          alt_text: null,
          locale: null,
          location_key: null,
          image_checksum: null,
          anonymized_at: now,
        },
      })
      // Separate timestamps so a sweep interrupted halfway re-drives only the
      // step that did not finish.
      expect(update).toHaveBeenCalledWith({
        where: { id: 'post-erase' },
        data: { image_object_path: null, objects_purged_at: now },
      })
    })

    it('skips re-anonymizing a row that was already anonymized', async () => {
      const { service, findMany, update, updateMany } = createService()
      findMany.mockResolvedValueOnce([
        erasureRow({
          status: 'withdrawn',
          anonymized_at: new Date('2026-09-05T11:30:00.000Z'),
        }),
      ])
      updateMany.mockResolvedValueOnce({ count: 0 })

      const result = await service.sweepErasureRequests(now)

      expect(result.anonymized).toBe(0)
      expect(result.hidden).toBe(0)
      expect(update).toHaveBeenCalledTimes(1)
    })

    it('leaves objects_purged_at unset when the delete fails, and flags an overdue request', async () => {
      const { findMany, update, updateMany } = createService()
      findMany.mockResolvedValueOnce([
        erasureRow({
          status: 'withdrawn',
          anonymized_at: new Date('2026-09-01T00:00:00.000Z'),
          erasure_requested_at: new Date(
            now.getTime() - (ERASURE_DEADLINE_HOURS + 1) * 60 * 60 * 1000
          ),
        }),
      ])
      updateMany.mockResolvedValueOnce({ count: 0 })

      const failingStorage = new InMemoryCommunityStorage()
      vi.spyOn(failingStorage, 'remove').mockRejectedValueOnce(new Error('denied'))
      const service = new CommunityMaintenanceService(
        {
          lookbookPost: { findMany, update, updateMany },
        } as unknown as PrismaClient,
        failingStorage
      )

      const result = await service.sweepErasureRequests(now)

      // Stamping the purge here would record a deletion that never happened.
      expect(result).toEqual({ hidden: 0, anonymized: 0, objectsPurged: 0, overdue: 1 })
      expect(update).not.toHaveBeenCalled()
    })

    it('purges a row whose object was already removed', async () => {
      const { service, findMany, update, updateMany } = createService()
      findMany.mockResolvedValueOnce([
        erasureRow({ status: 'withdrawn', image_object_path: null }),
      ])
      updateMany.mockResolvedValueOnce({ count: 0 })

      const result = await service.sweepErasureRequests(now)

      expect(result.objectsPurged).toBe(1)
      expect(update).toHaveBeenCalledWith({
        where: { id: 'post-erase' },
        data: { image_object_path: null, objects_purged_at: now },
      })
    })
  })

  describe('sweepExpiredUploads', () => {
    it('does nothing when no allocation has expired', async () => {
      const { service, findMany, deleteMany } = createService()
      findMany.mockResolvedValueOnce([])

      const result = await service.sweepExpiredUploads(now)

      expect(result).toEqual({ objectsDeleted: 0, draftsDeleted: 0 })
      expect(deleteMany).not.toHaveBeenCalled()
    })

    it('deletes the abandoned object and its draft row', async () => {
      const { service, storage, findMany, deleteMany } = createService()
      storage.put('community/post-abandoned/s.jpg', Buffer.from('bytes'))
      findMany.mockResolvedValueOnce([
        { id: 'post-abandoned', image_object_path: 'community/post-abandoned/s.jpg' },
      ])
      deleteMany.mockResolvedValueOnce({ count: 1 })

      const result = await service.sweepExpiredUploads(now)

      expect(storage.removed).toEqual(['community/post-abandoned/s.jpg'])
      expect(result).toEqual({ objectsDeleted: 1, draftsDeleted: 1 })
      // Guarded on `status: draft` so a post that was published between the
      // query and the delete is not removed.
      expect(deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['post-abandoned'] }, status: 'draft' },
      })
    })

    it('keeps the rows when the object delete fails, so the next sweep retries', async () => {
      const { findMany, deleteMany } = createService()
      findMany.mockResolvedValueOnce([
        { id: 'post-abandoned', image_object_path: 'community/post-abandoned/s.jpg' },
      ])
      const failingStorage = new InMemoryCommunityStorage()
      vi.spyOn(failingStorage, 'remove').mockRejectedValueOnce(new Error('denied'))
      const failingService = new CommunityMaintenanceService(
        {
          lookbookPost: { findMany, deleteMany },
        } as unknown as PrismaClient,
        failingStorage
      )

      const result = await failingService.sweepExpiredUploads(now)

      expect(result).toEqual({ objectsDeleted: 0, draftsDeleted: 0 })
      // Dropping the rows anyway would orphan the objects permanently.
      expect(deleteMany).not.toHaveBeenCalled()
    })

    it('deletes rows that carry no object path without calling storage', async () => {
      const { service, storage, findMany, deleteMany } = createService()
      findMany.mockResolvedValueOnce([{ id: 'post-no-object', image_object_path: null }])
      deleteMany.mockResolvedValueOnce({ count: 1 })

      const result = await service.sweepExpiredUploads(now)

      expect(storage.removed).toEqual([])
      expect(result).toEqual({ objectsDeleted: 0, draftsDeleted: 1 })
    })
  })
})

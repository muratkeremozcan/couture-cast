// Story 6.1: operator moderation actions (HIGH-7).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { NotFoundException } from '@nestjs/common'
import { CommunityModerationActionsService } from './community-moderation.actions'

describe('CommunityModerationActionsService', () => {
  const queryRaw = vi.fn()
  const postFindUniqueOrThrow = vi.fn()
  const postUpdate = vi.fn().mockResolvedValue({})
  const moderationEventCreate = vi.fn().mockResolvedValue({ id: 'mod-1' })
  const reportUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  const reportFindUniqueOrThrow = vi.fn()

  const prisma = {
    $queryRaw: queryRaw,
    $transaction: vi.fn((callback: (tx: PrismaClient) => Promise<unknown>) =>
      callback(prisma as unknown as PrismaClient)
    ),
    lookbookPost: {
      findUniqueOrThrow: postFindUniqueOrThrow,
      update: postUpdate,
    },
    moderationEvent: { create: moderationEventCreate },
    communityPostReport: {
      updateMany: reportUpdateMany,
      findUniqueOrThrow: reportFindUniqueOrThrow,
    },
  }

  const post = (overrides: Record<string, unknown> = {}) => ({
    id: 'post-1',
    status: 'flagged',
    caption: 'Autumn commute look',
    alt_text: 'A denim jacket over a striped shirt',
    locale: 'en-US',
    climate_band: 'temperate_dry',
    image_object_path: 'community/post-1/session.jpg',
    moderation_engine_version: 'adr013-text-v2.0;adr013-nsfw-v1.0',
    published_at: null,
    ...overrides,
  })

  const createService = () =>
    new CommunityModerationActionsService(prisma as unknown as PrismaClient)

  beforeEach(() => {
    vi.clearAllMocks()
    queryRaw.mockResolvedValue([{ id: 'post-1' }])
    postUpdate.mockResolvedValue({})
    moderationEventCreate.mockResolvedValue({ id: 'mod-1' })
    reportUpdateMany.mockResolvedValue({ count: 1 })
  })

  describe('lockPost', () => {
    it('locks the row FOR UPDATE before reading the status it branches on', async () => {
      /*
       * PINS THE SQL, WHICH NOTHING IN THIS FILE DID.
       *
       * `queryRaw` is a bare `vi.fn()` with an unconditional resolved value, so
       * every other test here passes whatever `lockPost` sends -- including
       * nothing. Deleting `FOR UPDATE` from the query left all fourteen of them
       * green, measured. That is a suite that cannot fail for the reason the
       * code exists.
       *
       * The real proof that the lock WORKS is 6.1-INT-080 and 6.1-INT-081 in
       * `apps/api/integration/community-moderation-pipeline.integration.spec.ts`,
       * which race two operators against real PostgreSQL and go red without it.
       * This test is the cheap half they cannot replace: an integration test
       * exercises whatever the code does, so a query silently rewritten to lock
       * a different row, or to lock nothing, would still race correctly-ish and
       * still pass. Pinning the text is what makes the rewrite visible, and it
       * costs no database.
       *
       * Modelled on `community.repository.spec.ts`, which asserts the same shape
       * for `publishWithinQuota`: the advisory lock is taken BEFORE the count it
       * protects. Order is the property, so order is what is asserted.
       */
      postFindUniqueOrThrow.mockResolvedValueOnce(post())
      const service = createService()

      await service.releaseFlaggedPost({
        postId: 'post-1',
        operatorId: 'operator-7',
        reason: 'False positive on a jacket logo',
      })

      // Prisma's `$queryRaw` is a tagged template, so the statement arrives as
      // the strings array with the bound value spliced out.
      const [sqlParts, boundPostId] = queryRaw.mock.calls[0] as [string[], string]
      const sql = sqlParts.join('?')
      expect(sql).toMatch(/FOR UPDATE\s*$/)
      expect(sql).toContain('"LookbookPost"')
      expect(boundPostId).toBe('post-1')

      // Locked first, THEN read. Reading the status before taking the lock is
      // the check-then-act race the lock exists to close, and it would leave
      // both operators seeing `flagged`.
      expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        postFindUniqueOrThrow.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
      )

      // Both statements go through the transaction client, not `this.prisma`. A
      // lock taken on one connection and a read issued on another locks nothing
      // the read can see, and that mistake looks identical in a diff.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })
  })

  describe('releaseFlaggedPost', () => {
    it('publishes the post and records an operator override naming the engine that flagged it', async () => {
      // The override, never a re-run. Re-screening on release would turn a human
      // decision into a machine verdict in the record, and with the real ADR-013
      // model absent it would simply re-flag everything, so release would not
      // work at all.
      postFindUniqueOrThrow.mockResolvedValueOnce(post())
      const service = createService()

      await expect(
        service.releaseFlaggedPost({
          postId: 'post-1',
          operatorId: 'operator-7',
          reason: 'False positive on a jacket logo',
        })
      ).resolves.toEqual({ released: true })

      expect(postUpdate).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: expect.objectContaining({
          status: 'published',
          published_at: expect.any(Date) as Date,
        }) as unknown,
      })

      const audit = moderationEventCreate.mock.calls[0]?.[0] as {
        data: Record<string, unknown>
      }
      expect(audit.data).toMatchObject({
        post_id: 'post-1',
        reviewed_by_id: 'operator-7',
        action: 'released_by_operator',
        // The trail must never imply the model passed what it refused. The
        // version lives in its own column; `reason` is the operator's words and
        // nothing else, so the two never have to be parsed apart.
        overridden_engine_version: 'adr013-text-v2.0;adr013-nsfw-v1.0',
        reason: 'False positive on a jacket logo',
      })
    })

    it('records a null reason rather than a sentence when the operator gives no words', async () => {
      postFindUniqueOrThrow.mockResolvedValueOnce(post())
      const service = createService()

      await service.releaseFlaggedPost({
        postId: 'post-1',
        operatorId: 'operator-7',
        reason: '   ',
      })

      const audit = moderationEventCreate.mock.calls[0]?.[0] as {
        data: Record<string, unknown>
      }
      expect(audit.data.reason).toBeNull()
      // The override is still fully recorded: the column carries the verdict
      // that was overruled whether or not anyone typed a justification.
      expect(audit.data.overridden_engine_version).toBe(
        'adr013-text-v2.0;adr013-nsfw-v1.0'
      )
    })

    it('records a null column when the flagged post carried no engine version', async () => {
      postFindUniqueOrThrow.mockResolvedValueOnce(
        post({ moderation_engine_version: null })
      )
      const service = createService()

      await service.releaseFlaggedPost({
        postId: 'post-1',
        operatorId: 'operator-7',
        reason: 'Cleared on review',
      })

      const audit = moderationEventCreate.mock.calls[0]?.[0] as {
        data: Record<string, unknown>
      }
      expect(audit.data.overridden_engine_version).toBeNull()
      expect(audit.data.reason).toBe('Cleared on review')
    })

    it('leaves the screener verdict on the post so the override is legible from either side', async () => {
      postFindUniqueOrThrow.mockResolvedValueOnce(post())
      const service = createService()

      await service.releaseFlaggedPost({
        postId: 'post-1',
        operatorId: 'operator-7',
        reason: 'Reviewed and cleared',
      })

      const written = (postUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> })
        .data
      expect(written).not.toHaveProperty('moderation_engine_version')
      expect(written).not.toHaveProperty('moderation_reason')
    })

    it('keeps the original publication time when a taken-down post is released again', async () => {
      // Feed ordering is `published_at, id` DESC, so re-stamping would move a
      // restored post to the top of the feed instead of back where it was.
      const originalPublishedAt = new Date('2026-08-01T10:00:00.000Z')
      postFindUniqueOrThrow.mockResolvedValueOnce(
        post({ published_at: originalPublishedAt })
      )
      const service = createService()

      await service.releaseFlaggedPost({
        postId: 'post-1',
        operatorId: 'operator-7',
        reason: 'Takedown reversed on appeal',
      })

      expect(postUpdate).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: expect.objectContaining({ published_at: originalPublishedAt }) as unknown,
      })
    })

    it('refuses to release a post that is not flagged, and writes no audit row', async () => {
      postFindUniqueOrThrow.mockResolvedValueOnce(post({ status: 'published' }))
      const service = createService()

      await expect(
        service.releaseFlaggedPost({
          postId: 'post-1',
          operatorId: 'operator-7',
          reason: 'Nothing to release',
        })
      ).resolves.toEqual({ released: false })

      expect(postUpdate).not.toHaveBeenCalled()
      expect(moderationEventCreate).not.toHaveBeenCalled()
    })

    it('throws NotFound when the post row does not exist', async () => {
      queryRaw.mockResolvedValueOnce([])
      const service = createService()

      await expect(
        service.releaseFlaggedPost({
          postId: 'ghost',
          operatorId: 'operator-7',
          reason: 'irrelevant',
        })
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('takeDownPublishedPost', () => {
    it('hides the post as flagged and attributes the takedown to the operator', async () => {
      postFindUniqueOrThrow.mockResolvedValueOnce(post({ status: 'published' }))
      const service = createService()

      await expect(
        service.takeDownPublishedPost({
          postId: 'post-1',
          operatorId: 'operator-3',
          reason: 'Harassment reported and confirmed',
        })
      ).resolves.toEqual({ takenDown: true })

      expect(postUpdate).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: {
          status: 'flagged',
          moderation_reason: 'Harassment reported and confirmed',
        },
      })
      expect(moderationEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reviewed_by_id: 'operator-3',
          action: 'taken_down_by_operator',
          content_snapshot: expect.objectContaining({
            caption: 'Autumn commute look',
          }) as unknown,
        }) as unknown,
      })
    })

    it('does not start the erasure clock, so a takedown preserves its own evidence', async () => {
      // `withdrawn` would be wrong here: that is the author's retraction and it
      // schedules deletion of the image within 72 hours.
      postFindUniqueOrThrow.mockResolvedValueOnce(post({ status: 'published' }))
      const service = createService()

      await service.takeDownPublishedPost({
        postId: 'post-1',
        operatorId: 'operator-3',
        reason: 'Held for review',
      })

      const written = (postUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> })
        .data
      expect(written.status).toBe('flagged')
      expect(written).not.toHaveProperty('erasure_requested_at')
    })

    it('refuses to take down a post that is not published', async () => {
      postFindUniqueOrThrow.mockResolvedValueOnce(post({ status: 'withdrawn' }))
      const service = createService()

      await expect(
        service.takeDownPublishedPost({
          postId: 'post-1',
          operatorId: 'operator-3',
          reason: 'Already gone',
        })
      ).resolves.toEqual({ takenDown: false })

      expect(moderationEventCreate).not.toHaveBeenCalled()
    })
  })

  describe('resolveReport', () => {
    const report = (overrides: Record<string, unknown> = {}) => ({
      id: 'report-1',
      post_id: 'post-1',
      subject_alias: 'Style Explorer AABBCCDD',
      image_object_path: 'community/post-1/session.jpg',
      content_snapshot: { caption: 'Autumn commute look' },
      sla_due_at: new Date('2026-09-07T00:00:00.000Z'),
      ...overrides,
    })

    it('stamps resolved_at and records who closed it', async () => {
      // `resolved_at` had zero production writers, so every report was
      // permanently open and the `(resolved_at, sla_due_at)` index served a
      // query nothing ran.
      reportFindUniqueOrThrow.mockResolvedValueOnce(report())
      const service = createService()

      await expect(
        service.resolveReport({
          reportId: 'report-1',
          operatorId: 'operator-2',
          resolution: 'Content removed',
        })
      ).resolves.toEqual({ resolved: true })

      expect(reportUpdateMany).toHaveBeenCalledWith({
        where: { id: 'report-1', resolved_at: null },
        data: { resolved_at: expect.any(Date) as Date },
      })
      expect(moderationEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reviewed_by_id: 'operator-2',
          action: 'report_resolved',
          reason: 'Content removed',
          subject_alias: 'Style Explorer AABBCCDD',
        }) as unknown,
      })
    })

    it('carries the report snapshot onto the audit row so an orphaned resolution still says what it was about', async () => {
      reportFindUniqueOrThrow.mockResolvedValueOnce(report({ post_id: null }))
      const service = createService()

      await service.resolveReport({
        reportId: 'report-1',
        operatorId: 'operator-2',
        resolution: 'Unfounded',
      })

      expect(moderationEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          post_id: null,
          content_snapshot: { caption: 'Autumn commute look' },
        }) as unknown,
      })
    })

    it('writes no snapshot key when the report predates snapshot capture', async () => {
      // Reports created before `content_snapshot` had any writer carry null.
      // Passing that straight through would set the audit column to JSON null,
      // which reads as "captured, and empty" rather than "never captured".
      reportFindUniqueOrThrow.mockResolvedValueOnce(report({ content_snapshot: null }))
      const service = createService()

      await service.resolveReport({
        reportId: 'report-1',
        operatorId: 'operator-2',
        resolution: 'Legacy report closed',
      })

      const written = (
        moderationEventCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
      ).data
      expect(written.content_snapshot).toBeUndefined()
    })

    it('does not re-stamp an already resolved report', async () => {
      // Re-stamping would move the recorded resolution time forward and let a
      // late resolution look punctual on a retry.
      reportUpdateMany.mockResolvedValueOnce({ count: 0 })
      const service = createService()

      await expect(
        service.resolveReport({
          reportId: 'report-1',
          operatorId: 'operator-2',
          resolution: 'Duplicate',
        })
      ).resolves.toEqual({ resolved: false })

      expect(moderationEventCreate).not.toHaveBeenCalled()
    })
  })
})

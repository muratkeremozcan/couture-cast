// Learning path Step 38: Community feed by climate band.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  viewerUserId,
  createRepo,
} from '../../testing/community/community-repository.fixture'

describe('CommunityRepository reports', () => {
  describe('recordReport', () => {
    beforeEach(() => vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z')))
    afterEach(() => vi.useRealTimers())
    const lockedPublishedPost = [
      {
        user_id: 'author-other',
        status: 'published',
        published_at: new Date('2026-09-01T00:00:00.000Z'),
        image_object_path: 'community/post-1/session.jpg',
        // Read under the same FOR UPDATE lock that decides visibility, so the
        // audit snapshot is the content the reporter actually saw.
        caption: 'Autumn commute look',
        alt_text: 'A denim jacket over a striped shirt',
        locale: 'en-US',
        climate_band: 'temperate_dry',
      },
    ]

    const reportParams = (reason: 'spam' | 'violence' = 'spam') => ({
      postId: 'post-1',
      reporterId: viewerUserId,
      reason,
      abuseLimit: 50,
      slaHours: 24,
      subjectAlias: 'Style Explorer AABBCCDD',
    })

    it('locks the post row FOR UPDATE inside the transaction', async () => {
      const { repo, queryRaw, reportFindUnique, reportFindMany } = createRepo()
      queryRaw.mockResolvedValueOnce(lockedPublishedPost)
      reportFindUnique.mockResolvedValueOnce(null)
      reportFindMany.mockResolvedValueOnce([])

      await repo.recordReport(reportParams())

      expect(JSON.stringify(queryRaw.mock.calls[0])).toContain('FOR UPDATE')
    })

    it('returns post_not_visible when the locked row is not published', async () => {
      const { repo, queryRaw, reportCreate } = createRepo()
      queryRaw.mockResolvedValueOnce([
        { user_id: 'author-other', status: 'flagged', image_object_path: null },
      ])

      const result = await repo.recordReport(reportParams())

      expect(result.kind).toBe('post_not_visible')
      expect(reportCreate).not.toHaveBeenCalled()
    })

    it('returns self_report when the reporter owns the post', async () => {
      const { repo, queryRaw } = createRepo()
      queryRaw.mockResolvedValueOnce([
        {
          user_id: viewerUserId,
          status: 'published',
          published_at: new Date('2026-09-01T00:00:00.000Z'),
          image_object_path: null,
        },
      ])

      const result = await repo.recordReport(reportParams())

      expect(result.kind).toBe('self_report')
    })

    it('returns post_not_visible for a published post the operations canary wrote', async () => {
      // Story 6.2b final review (RF8).
      const { repo, queryRaw, reportCreate } = createRepo()
      queryRaw.mockResolvedValueOnce([
        { ...lockedPublishedPost[0], user_id: 'canary-user-run1' },
      ])

      const result = await repo.recordReport(reportParams())

      expect(result.kind).toBe('post_not_visible')
      expect(reportCreate).not.toHaveBeenCalled()
    })

    it('treats a same-reason replay as idempotent', async () => {
      const { repo, queryRaw, reportFindUnique, reportCreate } = createRepo()
      queryRaw.mockResolvedValueOnce(lockedPublishedPost)
      reportFindUnique.mockResolvedValueOnce({ id: 'rep-1', reason: 'spam' })

      const result = await repo.recordReport(reportParams('spam'))

      expect(result.kind).toBe('replayed')
      expect(reportCreate).not.toHaveBeenCalled()
    })

    it('reports reason_changed only when the stored reason differs', async () => {
      const { repo, queryRaw, reportFindUnique } = createRepo()
      queryRaw.mockResolvedValueOnce(lockedPublishedPost)
      reportFindUnique.mockResolvedValueOnce({ id: 'rep-1', reason: 'spam' })

      const result = await repo.recordReport(reportParams('violence'))

      expect(result).toEqual({ kind: 'reason_changed', existingReason: 'spam' })
    })

    it('throttles an abusive reporter with a retry time', async () => {
      const { repo, queryRaw, reportFindUnique, reportFindMany } = createRepo()
      queryRaw.mockResolvedValueOnce(lockedPublishedPost)
      reportFindUnique.mockResolvedValueOnce(null)
      reportFindMany.mockResolvedValueOnce(
        Array.from({ length: 50 }, () => ({
          created_at: new Date(Date.now() - 12 * 60 * 60 * 1000),
        }))
      )

      const result = await repo.recordReport(reportParams())

      expect(result.kind).toBe('rate_limited')
      if (result.kind === 'rate_limited') {
        expect(result.retryAfterSeconds).toBe(43_200)
      }
    })

    it('persists the enum reason, the SLA clock and the denormalized snapshot fields', async () => {
      // The old code concatenated free text into ModerationEvent's `reason`
      // column, destroying the closed enum and making a same-reason replay
      // indistinguishable from a changed one.
      const {
        repo,
        queryRaw,
        reportFindUnique,
        reportFindMany,
        reportCreate,
        moderationEventCreate,
      } = createRepo()
      queryRaw.mockResolvedValueOnce(lockedPublishedPost)
      reportFindUnique.mockResolvedValueOnce(null)
      reportFindMany.mockResolvedValueOnce([])

      const result = await repo.recordReport({
        ...reportParams(),
        details: 'Repetitive marketing links',
      })

      expect(result.kind).toBe('created')
      expect(reportCreate).toHaveBeenCalledWith({
        data: {
          post_id: 'post-1',
          reporter_id: viewerUserId,
          reason: 'spam',
          details: 'Repetitive marketing links',
          subject_alias: 'Style Explorer AABBCCDD',
          image_object_path: 'community/post-1/session.jpg',
          content_snapshot: {
            caption: 'Autumn commute look',
            altText: 'A denim jacket over a striped shirt',
            locale: 'en-US',
            climateBand: 'temperate_dry',
            capturedAt: expect.any(String) as string,
          },
          sla_due_at: expect.any(Date) as Date,
        },
      })
      // ModerationEvent is append-only again now its UNIQUE (post_id,
      // flagged_by_id) is gone, so the audit row is written alongside.
      expect(moderationEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          post_id: 'post-1',
          flagged_by_id: viewerUserId,
          action: 'reported',
          reason: 'spam',
        }) as unknown,
      })
    })

    // `content_snapshot` is declared on both audit tables and, before this, was
    // written by nobody, while the erasure sweep asserted in a comment that both
    // retain it. Erasure nulls `post_id` and anonymization nulls the caption,
    // alt text and locale on the post itself, so without the snapshot a report
    // that outlived its subject pointed at nothing and described nothing.
    it('carries the same content snapshot onto the ModerationEvent, so an orphaned audit row still says what was reported', async () => {
      const {
        repo,
        queryRaw,
        reportFindUnique,
        reportFindMany,
        reportCreate,
        moderationEventCreate,
      } = createRepo()
      queryRaw.mockResolvedValueOnce(lockedPublishedPost)
      reportFindUnique.mockResolvedValueOnce(null)
      reportFindMany.mockResolvedValueOnce([])

      await repo.recordReport(reportParams())

      const reportSnapshot = (
        reportCreate.mock.calls[0]?.[0] as { data: { content_snapshot?: unknown } }
      ).data.content_snapshot
      const eventSnapshot = (
        moderationEventCreate.mock.calls[0]?.[0] as {
          data: { content_snapshot?: unknown }
        }
      ).data.content_snapshot

      expect(eventSnapshot).toEqual(reportSnapshot)
      expect(eventSnapshot).toMatchObject({
        caption: 'Autumn commute look',
        altText: 'A denim jacket over a striped shirt',
      })
      // No user id anywhere in the snapshot: `subject_alias` is how the row
      // says whose content it was, and it is a pseudonym.
      expect(JSON.stringify(eventSnapshot)).not.toContain('author-other')
    })

    it('maps a lost P2002 race to the outcome of whichever report won', async () => {
      const { repo, transaction, reportFindUnique } = createRepo()
      transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: 'test',
        })
      )
      reportFindUnique.mockResolvedValueOnce({ id: 'rep-winner', reason: 'spam' })

      const result = await repo.recordReport(reportParams('spam'))

      expect(result.kind).toBe('replayed')
    })
  })
})

// Learning path Step 38: Community feed by climate band.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  viewerUserId,
  createRepo,
} from '../../testing/community/community-repository.fixture'

describe('CommunityRepository publishing and erasure', () => {
  describe('publishWithinQuota', () => {
    beforeEach(() => vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z')))
    afterEach(() => vi.useRealTimers())
    const publishData = {
      altText: 'A tailored trench over a cream knit',
      caption: 'Autumn commute',
      climateBand: 'temperate_dry' as const,
      locale: 'en-US',
      challengeId: null,
      area: { country: null, region: null, city: null },
    }

    it('takes the per-user advisory lock before counting, inside one transaction', async () => {
      const {
        repo,
        executeRaw,
        lookbookPostFindMany,
        lookbookPostUpdateMany,
        lookbookPostFindUniqueOrThrow,
        transaction,
      } = createRepo()
      lookbookPostFindMany.mockResolvedValueOnce([])
      lookbookPostUpdateMany.mockResolvedValueOnce({ count: 1 })
      lookbookPostFindUniqueOrThrow.mockResolvedValueOnce({ id: 'post-1' })

      await repo.publishWithinQuota({
        userId: viewerUserId,
        postId: 'post-1',
        cap: 10,
        data: publishData,
      })

      expect(transaction).toHaveBeenCalledTimes(1)
      // The lock must be the FIRST statement: counting before locking is exactly
      // the check-then-act race the cap is supposed to close.
      expect(JSON.stringify(executeRaw.mock.calls[0])).toContain('pg_advisory_xact_lock')
      expect(executeRaw.mock.invocationCallOrder[0]!).toBeLessThan(
        lookbookPostFindMany.mock.invocationCallOrder[0]!
      )
    })

    it('counts submitted_at, not created_at, over an exclusive window', async () => {
      // `created_at` is allocate time and a replayed allocate reuses the row, so
      // counting it would charge a retry against the cap.
      const {
        repo,
        lookbookPostFindMany,
        lookbookPostUpdateMany,
        lookbookPostFindUniqueOrThrow,
      } = createRepo()
      lookbookPostFindMany.mockResolvedValueOnce([])
      lookbookPostUpdateMany.mockResolvedValueOnce({ count: 1 })
      lookbookPostFindUniqueOrThrow.mockResolvedValueOnce({ id: 'post-1' })

      await repo.publishWithinQuota({
        userId: viewerUserId,
        postId: 'post-1',
        cap: 10,
        data: publishData,
      })

      expect(lookbookPostFindMany).toHaveBeenCalledWith({
        where: {
          user_id: viewerUserId,
          submitted_at: { gt: new Date('2026-09-04T12:00:00.000Z') },
        },
        orderBy: { submitted_at: 'asc' },
        select: { submitted_at: true },
      })
    })

    it('refuses the eleventh submission with a retry time from the window boundary', async () => {
      const { repo, lookbookPostFindMany, lookbookPostUpdateMany } = createRepo()
      const oldest = new Date(Date.now() - 23 * 60 * 60 * 1000)
      lookbookPostFindMany.mockResolvedValueOnce(
        Array.from({ length: 10 }, (_unused, index) => ({
          submitted_at: index === 0 ? oldest : new Date(),
        }))
      )

      const result = await repo.publishWithinQuota({
        userId: viewerUserId,
        postId: 'post-11',
        cap: 10,
        data: publishData,
      })

      expect(result.kind).toBe('rate_limited')
      if (result.kind === 'rate_limited') {
        // One hour left before the oldest submission leaves the 24-hour window.
        expect(result.retryAfterSeconds).toBe(3_600)
      }
      expect(lookbookPostUpdateMany).not.toHaveBeenCalled()
    })

    it('accepts the tenth submission and stamps submitted_at with the outbox row', async () => {
      const {
        repo,
        lookbookPostFindMany,
        lookbookPostUpdateMany,
        lookbookPostFindUniqueOrThrow,
        moderationOutboxUpsert,
      } = createRepo()
      lookbookPostFindMany.mockResolvedValueOnce(
        Array.from({ length: 9 }, () => ({ submitted_at: new Date() }))
      )
      lookbookPostUpdateMany.mockResolvedValueOnce({ count: 1 })
      lookbookPostFindUniqueOrThrow.mockResolvedValueOnce({
        id: 'post-10',
        status: 'pending_review',
      })

      const result = await repo.publishWithinQuota({
        userId: viewerUserId,
        postId: 'post-10',
        cap: 10,
        data: publishData,
      })

      expect(result.kind).toBe('published')
      expect(lookbookPostUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'post-10',
          user_id: viewerUserId,
          status: 'draft',
          erasure_requested_at: null,
          anonymized_at: null,
        },
        data: {
          status: 'pending_review',
          alt_text: publishData.altText,
          caption: publishData.caption,
          climate_band: 'temperate_dry',
          locale: 'en-US',
          challenge_id: null,
          area_country: null,
          area_region: null,
          area_city: null,
          submitted_at: expect.any(Date) as Date,
          alt_text_confirmed_at: expect.any(Date) as Date,
        },
      })
      // The outbox row commits with the state change it describes.
      expect(moderationOutboxUpsert).toHaveBeenCalledWith({
        where: { post_id: 'post-10' },
        create: { post_id: 'post-10' },
        update: {},
      })
    })

    it('stamps the alt-text confirmation in the same statement as the text, on the way to pending_review', async () => {
      // The database's `status <> 'published' OR alt_text_confirmed_at IS NOT NULL`
      // check depends on this ordering: only moderation moves a row from
      // `pending_review` to `published`, so a stamp written here is always
      // strictly earlier than publication. Writing the confirmation separately
      // from the text it confirms would also let an edit slip in between, and
      // the row would then claim the author approved wording they never saw.
      const {
        repo,
        lookbookPostFindMany,
        lookbookPostUpdateMany,
        lookbookPostFindUniqueOrThrow,
      } = createRepo()
      lookbookPostFindMany.mockResolvedValueOnce([])
      lookbookPostUpdateMany.mockResolvedValueOnce({ count: 1 })
      lookbookPostFindUniqueOrThrow.mockResolvedValueOnce({ id: 'post-1' })

      await repo.publishWithinQuota({
        userId: viewerUserId,
        postId: 'post-1',
        cap: 10,
        data: publishData,
      })

      const call = lookbookPostUpdateMany.mock.calls[0]![0] as {
        where: { status: string }
        data: { status: string; alt_text: string; alt_text_confirmed_at: Date }
      }
      expect(call.where.status).toBe('draft')
      expect(call.data.status).toBe('pending_review')
      expect(call.data.alt_text).toBe(publishData.altText)
      expect(call.data.alt_text_confirmed_at).toBeInstanceOf(Date)
    })

    it('reports not_draft when the guarded update matches nothing', async () => {
      const { repo, lookbookPostFindMany, lookbookPostUpdateMany } = createRepo()
      lookbookPostFindMany.mockResolvedValueOnce([])
      lookbookPostUpdateMany.mockResolvedValueOnce({ count: 0 })

      const result = await repo.publishWithinQuota({
        userId: viewerUserId,
        postId: 'post-already-published',
        cap: 10,
        data: publishData,
      })

      expect(result.kind).toBe('not_draft')
    })
  })

  describe('erasure producers', () => {
    // `erasure_requested_at` had no production writer at all: only the test
    // factory and specs ever set it, so the entire erasure sweep was
    // unreachable, a withdrawn post's image stayed in the bucket forever, and
    // the 72-hour deadline never started, which meant `community_erasure_overdue`
    // could not fire even in principle.
    it('withdraws and starts the clock in one statement', async () => {
      const { repo, executeRaw } = createRepo()
      const requestedAt = new Date('2026-09-06T10:00:00.000Z')

      await repo.withdrawPostAndRequestErasure('post-1', requestedAt)

      const statement = JSON.stringify(
        executeRaw.mock.calls.find((call) => JSON.stringify(call).includes('UPDATE'))
      )
      expect(statement).toContain('UPDATE')
      expect(statement).toContain('withdrawn')
      expect(statement).toContain('erasure_requested_at')
    })

    it('coalesces the clock rather than assigning it, so a later withdrawal cannot push a deadline back', async () => {
      // Account erasure can already have stamped a row while it was still
      // published. A plain assignment on withdrawal would restart the 72 hours
      // and make a deletion that was already late look on time.
      const { repo, executeRaw } = createRepo()

      await repo.withdrawPostAndRequestErasure('post-1', new Date())

      expect(
        JSON.stringify(
          executeRaw.mock.calls.find((call) => JSON.stringify(call).includes('UPDATE'))
        )
      ).toContain('COALESCE')
    })

    it('marks every post of a member that is not already counting down, and reports the count', async () => {
      const { repo, lookbookPostUpdateMany, spotlightReadWindowDeleteMany } = createRepo()
      lookbookPostUpdateMany.mockResolvedValueOnce({ count: 4 })
      const requestedAt = new Date('2026-09-06T10:00:00.000Z')

      await expect(repo.requestErasureForUser('user-1', requestedAt)).resolves.toBe(4)
      expect(spotlightReadWindowDeleteMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
      })

      expect(lookbookPostUpdateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1', erasure_requested_at: null },
        data: { erasure_requested_at: requestedAt },
      })
    })

    it('filters on no status, because a draft and an already-withdrawn post both hold objects', async () => {
      // A post withdrawn before the clock existed has bytes in the bucket and no
      // deadline at all, and a `draft` or `uploading` row can hold an object that
      // was never published. Erasure that skipped either would leave exactly the
      // bytes the request was about.
      const { repo, lookbookPostUpdateMany } = createRepo()
      lookbookPostUpdateMany.mockResolvedValueOnce({ count: 0 })

      await repo.requestErasureForUser('user-1', new Date())

      const where = (
        lookbookPostUpdateMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
      ).where
      expect(where).not.toHaveProperty('status')
    })
  })
})

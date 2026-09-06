// Learning path Step 38: Community feed by climate band.
import { describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  CommunityChallengeWindowError,
  CommunityRepository,
} from './community.repository'

describe('CommunityRepository', () => {
  const viewerUserId = 'user-viewer-456'

  const createRepo = () => {
    const savedLocationFindMany = vi.fn()
    const lookbookPostFindMany = vi.fn()
    const lookbookPostFindUnique = vi.fn()
    const lookbookPostFindUniqueOrThrow = vi.fn()
    const lookbookPostCreate = vi.fn()
    const lookbookPostUpdate = vi.fn()
    const lookbookPostUpdateMany = vi.fn()
    const communityChallengeFindFirst = vi.fn()
    const communityChallengeFindUnique = vi.fn()
    const communityChallengeCreate = vi.fn()
    const communityChallengeUpdate = vi.fn()
    const moderationOutboxUpsert = vi.fn()
    const moderationEventFindFirst = vi.fn()
    const moderationEventFindMany = vi.fn()
    const moderationEventCreate = vi.fn()
    const reportFindUnique = vi.fn()
    const reportFindMany = vi.fn()
    const reportCreate = vi.fn()
    const aliasFindUnique = vi.fn()
    const aliasFindMany = vi.fn()
    const aliasCreate = vi.fn()
    const executeRaw = vi.fn().mockResolvedValue(1)
    const queryRaw = vi.fn()
    const transaction = vi.fn()

    const client = {
      savedLocation: { findMany: savedLocationFindMany },
      lookbookPost: {
        findMany: lookbookPostFindMany,
        findUnique: lookbookPostFindUnique,
        findUniqueOrThrow: lookbookPostFindUniqueOrThrow,
        create: lookbookPostCreate,
        update: lookbookPostUpdate,
        updateMany: lookbookPostUpdateMany,
      },
      communityChallenge: {
        findFirst: communityChallengeFindFirst,
        findUnique: communityChallengeFindUnique,
        create: communityChallengeCreate,
        update: communityChallengeUpdate,
      },
      communityModerationOutbox: {
        upsert: moderationOutboxUpsert,
      },
      moderationEvent: {
        findFirst: moderationEventFindFirst,
        findMany: moderationEventFindMany,
        create: moderationEventCreate,
      },
      communityPostReport: {
        findUnique: reportFindUnique,
        findMany: reportFindMany,
        create: reportCreate,
      },
      communityAlias: {
        findUnique: aliasFindUnique,
        findMany: aliasFindMany,
        create: aliasCreate,
      },
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
    }

    // The transaction double runs the callback against the same client, which is
    // what lets these specs assert the statement ORDER inside a transaction --
    // the advisory lock has to be first or the count is not serialised.
    transaction.mockImplementation((callback: (tx: typeof client) => unknown) =>
      callback(client)
    )

    const prisma = {
      ...client,
      $transaction: transaction,
    } as unknown as PrismaClient

    const repo = new CommunityRepository(prisma)
    return {
      repo,
      savedLocationFindMany,
      lookbookPostFindMany,
      lookbookPostFindUnique,
      lookbookPostFindUniqueOrThrow,
      lookbookPostCreate,
      lookbookPostUpdate,
      lookbookPostUpdateMany,
      communityChallengeFindFirst,
      communityChallengeFindUnique,
      communityChallengeCreate,
      communityChallengeUpdate,
      moderationOutboxUpsert,
      moderationEventFindFirst,
      moderationEventFindMany,
      moderationEventCreate,
      reportFindUnique,
      reportFindMany,
      reportCreate,
      aliasFindUnique,
      aliasFindMany,
      aliasCreate,
      executeRaw,
      queryRaw,
      transaction,
    }
  }

  describe('findViewerLocations', () => {
    it('returns saved locations in preference order so the band walk can try each', async () => {
      const { repo, savedLocationFindMany } = createRepo()
      const locations = [
        {
          id: 'loc-primary',
          user_id: viewerUserId,
          is_primary: true,
          location_key: 'paris-fr',
          created_at: new Date('2026-09-01'),
        },
        {
          id: 'loc-second',
          user_id: viewerUserId,
          is_primary: false,
          location_key: 'lisbon-pt',
          created_at: new Date('2026-09-02'),
        },
      ]
      savedLocationFindMany.mockResolvedValue(locations)

      const result = await repo.findViewerLocations(viewerUserId)

      expect(savedLocationFindMany).toHaveBeenCalledWith({
        where: { user_id: viewerUserId },
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        take: 5,
      })
      expect(result).toEqual(locations)
    })

    it('returns an empty list when user has no saved locations', async () => {
      const { repo, savedLocationFindMany } = createRepo()
      savedLocationFindMany.mockResolvedValue([])

      await expect(repo.findViewerLocations(viewerUserId)).resolves.toEqual([])
    })
  })

  describe('findPublishedFeedPosts', () => {
    const publishedRow = (id: string, publishedAt: string) => ({
      id,
      user_id: 'author-1',
      status: 'published' as const,
      created_at: new Date('2026-09-01T00:00:00.000Z'),
      published_at: new Date(publishedAt),
    })

    it('returns published rows only, ordered on published_at', async () => {
      // Ordering on `created_at` was a correctness bug: moderation stamps
      // `published_at` long after `created_at`, so a post clearing screening an
      // hour after it was drafted lands BEHIND a cursor the reader has already
      // consumed and is never seen.
      const { repo, lookbookPostFindMany } = createRepo()
      lookbookPostFindMany.mockResolvedValue([])

      await repo.findPublishedFeedPosts({ limit: 10, mode: 'auto' })

      expect(lookbookPostFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ status: 'published', published_at: { not: null } }, {}, {}],
          },
          orderBy: [{ published_at: 'desc' }, { id: 'desc' }],
          take: 11,
        })
      )
    })

    it('filters by climate_band when filterBand is specified', async () => {
      const { repo, lookbookPostFindMany } = createRepo()
      lookbookPostFindMany.mockResolvedValue([])

      await repo.findPublishedFeedPosts({
        filterBand: 'warm_wet',
        limit: 12,
        mode: 'warm_wet',
      })

      expect(lookbookPostFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [expect.any(Object), { climate_band: 'warm_wet' }, expect.any(Object)],
          },
        })
      )
    })

    it('applies the keyset cursor condition on published_at', async () => {
      const { repo, lookbookPostFindMany } = createRepo()
      lookbookPostFindMany.mockResolvedValue([])

      const publishedAt = '2026-09-05T10:00:00.000Z'

      await repo.findPublishedFeedPosts({
        cursor: { publishedAt, id: 'post-cursor-id', mode: 'auto', band: null },
        limit: 12,
        mode: 'auto',
      })

      expect(lookbookPostFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              expect.any(Object),
              {},
              {
                OR: [
                  { published_at: { lt: new Date(publishedAt) } },
                  { published_at: new Date(publishedAt), id: { lt: 'post-cursor-id' } },
                ],
              },
            ],
          },
        })
      )
    })

    it('mints the next cursor through the contract encoder, stamped with the mode and the band', async () => {
      // Hand-rolling the base64 here is how the encoder and the decoder drift
      // apart; the cursor also has to carry its mode so it cannot page a
      // different feed, and the BAND it was actually filtered on, which is a
      // different value that can move between two pages of one scroll.
      const { repo, lookbookPostFindMany } = createRepo()
      lookbookPostFindMany.mockResolvedValue([
        publishedRow('post-1', '2026-09-05T12:00:00.000Z'),
        publishedRow('post-2', '2026-09-05T11:00:00.000Z'),
        publishedRow('post-3', '2026-09-05T10:00:00.000Z'),
      ])

      const result = await repo.findPublishedFeedPosts({
        limit: 2,
        mode: 'cold_wet',
        filterBand: 'cold_wet',
      })

      expect(result.posts.length).toBe(2)
      expect(result.nextCursor).not.toBeNull()

      const decoded: unknown = JSON.parse(
        Buffer.from(result.nextCursor!, 'base64url').toString('utf8')
      )
      expect(decoded).toEqual({
        publishedAt: '2026-09-05T11:00:00.000Z',
        id: 'post-2',
        mode: 'cold_wet',
        band: 'cold_wet',
      })
    })

    it('records an unfiltered page as band null rather than omitting the field', async () => {
      // `all`, and `auto` with an unresolved viewer, both filter on nothing. The
      // cursor has to say so explicitly: an absent band would be indistinguishable
      // from a band that has since resolved, which is the whole failure the field
      // exists to catch.
      const { repo, lookbookPostFindMany } = createRepo()
      lookbookPostFindMany.mockResolvedValue([
        publishedRow('post-1', '2026-09-05T12:00:00.000Z'),
        publishedRow('post-2', '2026-09-05T11:00:00.000Z'),
        publishedRow('post-3', '2026-09-05T10:00:00.000Z'),
      ])

      const result = await repo.findPublishedFeedPosts({ limit: 2, mode: 'all' })

      const decoded = JSON.parse(
        Buffer.from(result.nextCursor!, 'base64url').toString('utf8')
      ) as { band: unknown }
      expect(decoded.band).toBeNull()
    })

    it('returns nextCursor: null on the last page', async () => {
      const { repo, lookbookPostFindMany } = createRepo()
      lookbookPostFindMany.mockResolvedValue([
        publishedRow('post-only', '2026-09-05T12:00:00.000Z'),
      ])

      const result = await repo.findPublishedFeedPosts({ limit: 5, mode: 'auto' })

      expect(result.posts.length).toBe(1)
      expect(result.nextCursor).toBeNull()
    })
  })

  describe('findAuthorPostStates', () => {
    it('returns only the caller own non-published rows, unpaginated', async () => {
      // These rows have no `published_at` to keyset on, so mixing them into the
      // public page would perturb its boundaries and consume the page limit.
      const { repo, lookbookPostFindMany } = createRepo()
      lookbookPostFindMany.mockResolvedValue([])

      await repo.findAuthorPostStates(viewerUserId)

      expect(lookbookPostFindMany).toHaveBeenCalledWith({
        where: {
          user_id: viewerUserId,
          status: {
            in: [
              'draft',
              'uploading',
              'pending_review',
              'flagged',
              'review_failed',
              'withdrawn',
              'consent_suspended',
            ],
          },
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: 50,
      })
    })
  })

  describe('findActiveChallenge', () => {
    it('prioritizes band-specific active challenge over unrestricted challenge', async () => {
      const { repo, communityChallengeFindFirst } = createRepo()
      const bandChallenge = {
        id: 'chal-band',
        climate_band: 'warm_dry',
        is_active: true,
      }
      communityChallengeFindFirst.mockResolvedValueOnce(bandChallenge)

      const result = await repo.findActiveChallenge('warm_dry')

      expect(communityChallengeFindFirst).toHaveBeenCalledTimes(1)
      const callArgs = (communityChallengeFindFirst.mock.calls[0]?.[0] ?? {}) as {
        where?: { is_active?: boolean; climate_band?: unknown }
      }
      expect(callArgs.where?.is_active).toBe(true)
      expect(callArgs.where?.climate_band).toBe('warm_dry')
      expect(result).toEqual(bandChallenge)
    })

    it('falls back to the unrestricted challenge when no band challenge matches', async () => {
      const { repo, communityChallengeFindFirst } = createRepo()
      const globalChallenge = { id: 'chal-global', climate_band: null, is_active: true }
      communityChallengeFindFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(globalChallenge)

      const result = await repo.findActiveChallenge('cold_wet')

      expect(communityChallengeFindFirst).toHaveBeenCalledTimes(2)
      expect(result).toEqual(globalChallenge)
    })

    it('searches only the unrestricted challenge when targetBand is null', async () => {
      const { repo, communityChallengeFindFirst } = createRepo()
      communityChallengeFindFirst.mockResolvedValueOnce({
        id: 'chal-global',
        climate_band: null,
      })

      await repo.findActiveChallenge(null)

      expect(communityChallengeFindFirst).toHaveBeenCalledTimes(1)
      const callArgs = (communityChallengeFindFirst.mock.calls[0]?.[0] ?? {}) as {
        where?: { climate_band?: unknown }
      }
      expect(callArgs.where?.climate_band).toBeNull()
    })
  })

  describe('publishWithinQuota', () => {
    const publishData = {
      altText: 'A tailored trench over a cream knit',
      caption: 'Autumn commute',
      climateBand: 'temperate_dry' as const,
      locale: 'en-US',
      challengeId: null,
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
        where: { user_id: viewerUserId, submitted_at: { gt: expect.any(Date) as Date } },
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
        expect(result.retryAfterSeconds).toBeGreaterThan(3_500)
        expect(result.retryAfterSeconds).toBeLessThanOrEqual(3_600)
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
        where: { id: 'post-10', user_id: viewerUserId, status: 'draft' },
        data: {
          status: 'pending_review',
          alt_text: publishData.altText,
          caption: publishData.caption,
          climate_band: 'temperate_dry',
          locale: 'en-US',
          challenge_id: null,
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

      const statement = JSON.stringify(executeRaw.mock.calls[0])
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

      expect(JSON.stringify(executeRaw.mock.calls[0])).toContain('COALESCE')
    })

    it('marks every post of a member that is not already counting down, and reports the count', async () => {
      const { repo, lookbookPostUpdateMany } = createRepo()
      lookbookPostUpdateMany.mockResolvedValueOnce({ count: 4 })
      const requestedAt = new Date('2026-09-06T10:00:00.000Z')

      await expect(repo.requestErasureForUser('user-1', requestedAt)).resolves.toBe(4)

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

  describe('recordReport', () => {
    const lockedPublishedPost = [
      {
        user_id: 'author-other',
        status: 'published',
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
        { user_id: viewerUserId, status: 'published', image_object_path: null },
      ])

      const result = await repo.recordReport(reportParams())

      expect(result.kind).toBe('self_report')
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
        expect(result.retryAfterSeconds).toBeGreaterThan(0)
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

  describe('resolveAlias', () => {
    it('returns the persisted alias without minting a new one', async () => {
      const { repo, aliasFindUnique, aliasCreate } = createRepo()
      aliasFindUnique.mockResolvedValueOnce({ alias: 'Style Explorer ABCDEF01' })

      await expect(
        repo.resolveAlias(viewerUserId, () => 'Style Explorer NEW')
      ).resolves.toBe('Style Explorer ABCDEF01')
      expect(aliasCreate).not.toHaveBeenCalled()
    })

    it('lazily inserts on first use', async () => {
      const { repo, aliasFindUnique, aliasCreate } = createRepo()
      aliasFindUnique.mockResolvedValueOnce(null)
      aliasCreate.mockResolvedValueOnce({ alias: 'Style Explorer NEW00001' })

      await expect(
        repo.resolveAlias(viewerUserId, () => 'Style Explorer NEW00001')
      ).resolves.toBe('Style Explorer NEW00001')
      expect(aliasCreate).toHaveBeenCalledWith({
        data: { user_id: viewerUserId, alias: 'Style Explorer NEW00001' },
      })
    })

    it('re-reads the winner when two requests race the unique index', async () => {
      const { repo, aliasFindUnique, aliasCreate } = createRepo()
      aliasFindUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ alias: 'Style Explorer WINNER1' })
      aliasCreate.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: 'test',
        })
      )

      await expect(
        repo.resolveAlias(viewerUserId, () => 'Style Explorer LOSER01')
      ).resolves.toBe('Style Explorer WINNER1')
    })

    it('resolves a whole page of authors in one query', async () => {
      const { repo, aliasFindMany, aliasFindUnique } = createRepo()
      aliasFindMany.mockResolvedValueOnce([
        { user_id: 'author-1', alias: 'Style Explorer AAAAAAA1' },
        { user_id: 'author-2', alias: 'Style Explorer AAAAAAA2' },
      ])

      const aliases = await repo.resolveAliases(
        ['author-1', 'author-2', 'author-1'],
        () => 'Style Explorer UNUSED1'
      )

      expect(aliasFindMany).toHaveBeenCalledWith({
        where: { user_id: { in: ['author-1', 'author-2'] } },
      })
      expect(aliases.get('author-1')).toBe('Style Explorer AAAAAAA1')
      expect(aliasFindUnique).not.toHaveBeenCalled()
    })

    it('fills a gap for an author with no alias yet', async () => {
      const { repo, aliasFindMany, aliasFindUnique, aliasCreate } = createRepo()
      aliasFindMany.mockResolvedValueOnce([])
      aliasFindUnique.mockResolvedValueOnce(null)
      aliasCreate.mockResolvedValueOnce({ alias: 'Style Explorer FRESH001' })

      const aliases = await repo.resolveAliases(
        ['author-new'],
        () => 'Style Explorer FRESH001'
      )

      expect(aliases.get('author-new')).toBe('Style Explorer FRESH001')
    })
  })

  describe('challenge overlap', () => {
    it('treats a global challenge as overlapping a band-scoped window', async () => {
      const { repo, communityChallengeFindFirst } = createRepo()
      communityChallengeFindFirst.mockResolvedValueOnce({ id: 'chal-global' })
      const startsAt = new Date('2026-09-01T00:00:00.000Z')
      const endsAt = new Date('2026-09-08T00:00:00.000Z')

      const overlap = await repo.findOverlappingChallenge(
        'temperate_dry',
        startsAt,
        endsAt,
        'chal-self'
      )

      expect(communityChallengeFindFirst).toHaveBeenCalledWith({
        where: {
          id: { not: 'chal-self' },
          is_active: true,
          starts_at: { lt: endsAt },
          ends_at: { gt: startsAt },
          OR: [{ climate_band: 'temperate_dry' }, { climate_band: null }],
        },
      })
      expect(overlap?.id).toBe('chal-global')
    })

    it('lets a global window conflict with every band', async () => {
      const { repo, communityChallengeFindFirst } = createRepo()
      communityChallengeFindFirst.mockResolvedValueOnce(null)

      await repo.findOverlappingChallenge(
        null,
        new Date('2026-09-01T00:00:00.000Z'),
        new Date('2026-09-08T00:00:00.000Z')
      )

      const where = (communityChallengeFindFirst.mock.calls[0]?.[0] ?? {}) as {
        where?: Record<string, unknown>
      }
      // No band predicate at all: any active challenge in the window conflicts.
      expect(where.where).not.toHaveProperty('OR')
      expect(where.where).not.toHaveProperty('climate_band')
    })

    it('creates after finding no overlap, without SERIALIZABLE', async () => {
      // The exclusion constraint models each challenge as the set of bands it
      // occupies, so two racing admins cannot both commit regardless of
      // isolation level. The pre-check exists to return a clean 409.
      const { repo, communityChallengeFindFirst, communityChallengeCreate, transaction } =
        createRepo()
      communityChallengeFindFirst.mockResolvedValueOnce(null)
      communityChallengeCreate.mockResolvedValueOnce({ id: 'chal-new' })

      const result = await repo.createChallengeWithoutOverlap(
        'temperate_dry',
        new Date('2026-09-01T00:00:00.000Z'),
        new Date('2026-09-08T00:00:00.000Z'),
        {
          slug: 'chal-autumn',
          starts_at: new Date('2026-09-01T00:00:00.000Z'),
          ends_at: new Date('2026-09-08T00:00:00.000Z'),
          time_zone: 'Europe/Istanbul',
          copy: { 'en-US': { title: 'T', body: 'B' } },
          is_active: true,
        }
      )

      expect(result).toEqual({ kind: 'created', challenge: { id: 'chal-new' } })
      expect(transaction.mock.calls[0]?.[1]).toBeUndefined()
    })

    it('reports overlap without inserting', async () => {
      const { repo, communityChallengeFindFirst, communityChallengeCreate } = createRepo()
      communityChallengeFindFirst.mockResolvedValueOnce({ id: 'chal-existing' })

      const result = await repo.createChallengeWithoutOverlap(
        null,
        new Date('2026-09-01T00:00:00.000Z'),
        new Date('2026-09-08T00:00:00.000Z'),
        {
          slug: 'chal-autumn',
          starts_at: new Date('2026-09-01T00:00:00.000Z'),
          ends_at: new Date('2026-09-08T00:00:00.000Z'),
          time_zone: 'Europe/Istanbul',
          copy: { 'en-US': { title: 'T', body: 'B' } },
          is_active: true,
        }
      )

      expect(result).toEqual({ kind: 'overlap' })
      expect(communityChallengeCreate).not.toHaveBeenCalled()
    })

    it('excludes the row being updated from its own overlap check', async () => {
      const { repo, communityChallengeFindFirst, communityChallengeUpdate } = createRepo()
      communityChallengeFindFirst.mockResolvedValueOnce(null)
      communityChallengeUpdate.mockResolvedValueOnce({ id: 'chal-1', is_active: false })

      const result = await repo.updateChallengeWithoutOverlap(
        'chal-1',
        null,
        new Date('2026-09-01T00:00:00.000Z'),
        new Date('2026-09-08T00:00:00.000Z'),
        { is_active: false }
      )

      expect(result).toEqual({
        kind: 'updated',
        challenge: { id: 'chal-1', is_active: false },
      })
      const where = (communityChallengeFindFirst.mock.calls[0]?.[0] ?? {}) as {
        where?: { id?: unknown }
      }
      expect(where.where?.id).toEqual({ not: 'chal-1' })
    })
  })

  describe('plain persistence helpers', () => {
    it('findPostByIdempotencyKey queries the unique composite key', async () => {
      const { repo, lookbookPostFindUnique } = createRepo()
      lookbookPostFindUnique.mockResolvedValueOnce({ id: 'post-1' })

      const post = await repo.findPostByIdempotencyKey(viewerUserId, 'idemp-123')

      expect(lookbookPostFindUnique).toHaveBeenCalledWith({
        where: {
          user_id_idempotency_key: {
            user_id: viewerUserId,
            idempotency_key: 'idemp-123',
          },
        },
      })
      expect(post).toEqual({ id: 'post-1' })
    })

    it('createPostDraft persists the draft', async () => {
      const { repo, lookbookPostCreate } = createRepo()
      const draftData = {
        id: 'post-draft',
        user_id: viewerUserId,
        status: 'draft' as const,
        image_object_path: 'community/post-draft/session.jpg',
      }
      lookbookPostCreate.mockResolvedValueOnce(draftData)

      const post = await repo.createPostDraft(draftData)

      expect(lookbookPostCreate).toHaveBeenCalledWith({ data: draftData })
      expect(post.id).toBe('post-draft')
    })

    it('findPostById retrieves a post by primary key', async () => {
      const { repo, lookbookPostFindUnique } = createRepo()
      lookbookPostFindUnique.mockResolvedValueOnce({ id: 'post-1' })

      await expect(repo.findPostById('post-1')).resolves.toEqual({ id: 'post-1' })
      expect(lookbookPostFindUnique).toHaveBeenCalledWith({ where: { id: 'post-1' } })
    })

    it('updatePost updates post data', async () => {
      const { repo, lookbookPostUpdate } = createRepo()
      lookbookPostUpdate.mockResolvedValueOnce({ id: 'post-1', status: 'withdrawn' })

      const post = await repo.updatePost('post-1', { status: 'withdrawn' })

      expect(lookbookPostUpdate).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: { status: 'withdrawn' },
      })
      expect(post.status).toBe('withdrawn')
    })

    it('createModerationOutbox upserts the outbox record', async () => {
      const { repo, moderationOutboxUpsert } = createRepo()
      moderationOutboxUpsert.mockResolvedValueOnce({ id: 'outbox-1', post_id: 'post-1' })

      const outbox = await repo.createModerationOutbox('post-1')

      expect(moderationOutboxUpsert).toHaveBeenCalledWith({
        where: { post_id: 'post-1' },
        create: { post_id: 'post-1' },
        update: {},
      })
      expect(outbox.post_id).toBe('post-1')
    })

    it('findReportByPostAndUser reads the report by its composite unique key', async () => {
      const { repo, reportFindUnique } = createRepo()
      reportFindUnique.mockResolvedValueOnce({ id: 'rep-1' })

      const report = await repo.findReportByPostAndUser('post-1', viewerUserId)

      expect(reportFindUnique).toHaveBeenCalledWith({
        where: {
          post_id_reporter_id: { post_id: 'post-1', reporter_id: viewerUserId },
        },
      })
      expect(report).toEqual({ id: 'rep-1' })
    })

    it('findChallengeById queries the challenge by id', async () => {
      const { repo, communityChallengeFindUnique } = createRepo()
      communityChallengeFindUnique.mockResolvedValueOnce({ id: 'chal-1' })

      await expect(repo.findChallengeById('chal-1')).resolves.toEqual({ id: 'chal-1' })
    })
  })
  describe('constraint mapping and window arithmetic', () => {
    const challengeData = {
      slug: 'chal-autumn',
      starts_at: new Date('2026-09-07T00:00:00.000Z'),
      ends_at: new Date('2026-09-14T00:00:00.000Z'),
      time_zone: 'UTC',
      copy: { 'en-US': { title: 'T', body: 'B' } },
      is_active: true,
    }

    const knownRequestError = (sqlState: string) =>
      new Prisma.PrismaClientKnownRequestError('constraint violation', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: sqlState },
      })

    it('maps the exclusion violation (23P01) to an overlap, not an error', async () => {
      // The constraint models each challenge as the set of bands it occupies, so
      // it catches band-versus-global in both directions where the application
      // filter alone would not.
      const { repo, transaction } = createRepo()
      transaction.mockRejectedValueOnce(knownRequestError('23P01'))

      await expect(
        repo.createChallengeWithoutOverlap(
          'temperate_dry',
          challengeData.starts_at,
          challengeData.ends_at,
          challengeData
        )
      ).resolves.toEqual({ kind: 'overlap' })
    })

    it('maps the window check violation (23514) to a dedicated window error', async () => {
      const { repo, transaction } = createRepo()
      transaction.mockRejectedValueOnce(knownRequestError('23514'))

      await expect(
        repo.updateChallengeWithoutOverlap(
          'chal-1',
          null,
          challengeData.starts_at,
          challengeData.ends_at,
          { is_active: false }
        )
      ).rejects.toBeInstanceOf(CommunityChallengeWindowError)
    })

    it('maps a CHECK violation that arrives as an UNKNOWN error with the state only in its message', async () => {
      // Measured against Prisma 6.19: an exclusion violation is a Known error
      // carrying `meta.code`, but a CHECK violation is an Unknown error whose
      // `code` and `meta` are both undefined and whose SQLSTATE appears only
      // inside the message. Reading `meta.code` alone made this branch
      // unreachable, so a backwards window returned 500 where the contract
      // promises a 400.
      const { repo, transaction } = createRepo()
      transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientUnknownRequestError(
          'Invalid `prisma.communityChallenge.create()` invocation\n' +
            'PostgresError { code: "23514", message: "new row for relation ' +
            '\\"CommunityChallenge\\" violates check constraint ' +
            '\\"CommunityChallenge_window_ordered\\"" }',
          { clientVersion: 'test' }
        )
      )

      await expect(
        repo.createChallengeWithoutOverlap(
          'temperate_dry',
          challengeData.starts_at,
          challengeData.ends_at,
          challengeData
        )
      ).rejects.toBeInstanceOf(CommunityChallengeWindowError)
    })

    it('maps an exclusion violation that arrives the same way', async () => {
      const { repo, transaction } = createRepo()
      transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientUnknownRequestError(
          'PostgresError { code: "23P01", message: "conflicting key value ' +
            'violates exclusion constraint" }',
          { clientVersion: 'test' }
        )
      )

      await expect(
        repo.createChallengeWithoutOverlap(
          null,
          challengeData.starts_at,
          challengeData.ends_at,
          challengeData
        )
      ).resolves.toEqual({ kind: 'overlap' })
    })

    it('rethrows an unknown error that carries no SQLSTATE at all', async () => {
      const { repo, transaction } = createRepo()
      transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientUnknownRequestError('connection terminated', {
          clientVersion: 'test',
        })
      )

      await expect(
        repo.createChallengeWithoutOverlap(
          null,
          challengeData.starts_at,
          challengeData.ends_at,
          challengeData
        )
      ).rejects.toBeInstanceOf(Prisma.PrismaClientUnknownRequestError)
    })

    it('rethrows an unrelated database error untouched', async () => {
      const { repo, transaction } = createRepo()
      transaction.mockRejectedValueOnce(new Error('connection reset'))

      await expect(
        repo.createChallengeWithoutOverlap(
          null,
          challengeData.starts_at,
          challengeData.ends_at,
          challengeData
        )
      ).rejects.toThrow('connection reset')
    })

    it('rethrows a known Prisma error carrying no SQLSTATE', async () => {
      const { repo, transaction } = createRepo()
      transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('nope', {
          code: 'P2025',
          clientVersion: 'test',
        })
      )

      await expect(
        repo.createChallengeWithoutOverlap(
          null,
          challengeData.starts_at,
          challengeData.ends_at,
          challengeData
        )
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    })

    it('falls back to the whole window when there is nothing to measure a retry from', async () => {
      // Defensive: the count said the cap was reached, so there must be rows.
      // If the window somehow reports none, the caller is told to wait the
      // whole window rather than being handed a nonsensical retry time.
      const { repo, lookbookPostFindMany } = createRepo()
      lookbookPostFindMany.mockResolvedValueOnce(
        Array.from({ length: 10 }, () => ({ submitted_at: null }))
      )

      const result = await repo.publishWithinQuota({
        userId: viewerUserId,
        postId: 'post-11',
        cap: 10,
        data: {
          altText: 'alt',
          caption: null,
          climateBand: null,
          locale: 'en-US',
          challengeId: null,
        },
      })

      expect(result).toEqual({ kind: 'rate_limited', retryAfterSeconds: 86_400 })
    })

    it('rethrows a non-P2002 failure out of recordReport', async () => {
      const { repo, transaction } = createRepo()
      transaction.mockRejectedValueOnce(new Error('deadlock detected'))

      await expect(
        repo.recordReport({
          postId: 'post-1',
          reporterId: viewerUserId,
          reason: 'spam',
          abuseLimit: 50,
          slaHours: 24,
          subjectAlias: 'Style Explorer AABBCCDD',
        })
      ).rejects.toThrow('deadlock detected')
    })

    it('reports reason_changed with a placeholder when the P2002 winner cannot be re-read', async () => {
      const { repo, transaction, reportFindUnique } = createRepo()
      transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: 'test',
        })
      )
      reportFindUnique.mockResolvedValueOnce(null)

      const result = await repo.recordReport({
        postId: 'post-1',
        reporterId: viewerUserId,
        reason: 'spam',
        abuseLimit: 50,
        slaHours: 24,
        subjectAlias: 'Style Explorer AABBCCDD',
      })

      expect(result).toEqual({ kind: 'reason_changed', existingReason: 'other' })
    })

    it('rethrows a non-P2002 failure out of the lazy alias insert', async () => {
      const { repo, aliasFindUnique, aliasCreate } = createRepo()
      aliasFindUnique.mockResolvedValueOnce(null)
      aliasCreate.mockRejectedValueOnce(new Error('connection reset'))

      await expect(
        repo.resolveAlias(viewerUserId, () => 'Style Explorer NEW00001')
      ).rejects.toThrow('connection reset')
    })

    it('rethrows when a P2002 alias race leaves nothing to re-read', async () => {
      const { repo, aliasFindUnique, aliasCreate } = createRepo()
      aliasFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      aliasCreate.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: 'test',
        })
      )

      await expect(
        repo.resolveAlias(viewerUserId, () => 'Style Explorer NEW00001')
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    })

    it('resolves an empty page of authors without querying', async () => {
      const { repo, aliasFindMany } = createRepo()

      await expect(
        repo.resolveAliases([], () => 'Style Explorer UNUSED1')
      ).resolves.toEqual(new Map())
      expect(aliasFindMany).not.toHaveBeenCalled()
    })
  })
})

// Learning path Step 38: Community feed by climate band.
// Learning path Step 40: Community screening release gate and hosted worker.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-40-community-screening-release-gate-and-hosted-worker
import { describe, expect, it } from 'vitest'
import {
  viewerUserId,
  createRepo,
} from '../../testing/community/community-repository.fixture'

describe('CommunityRepository reads', () => {
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
            AND: [
              {
                status: 'published',
                erasure_requested_at: null,
                anonymized_at: null,
                published_at: { not: null },
                // Story 6.2b final review (RF8): the operations canary's
                // synthetic posts are never served, whatever the flags say.
                NOT: { user_id: { startsWith: 'canary-user-' } },
              },
              {},
              {},
            ],
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
})

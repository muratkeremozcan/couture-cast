// Learning path Step 38: Community feed by climate band.
import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { CommunityChallengeWindowError } from './community.repository'
import {
  viewerUserId,
  createRepo,
} from '../../testing/community/community-repository.fixture'

describe('CommunityRepository constraints', () => {
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

    it('retries once after a deadlock and reports the overlap the winner created', async () => {
      // 6.1-INT-053 caught this in CI as a raw 500. Two concurrent creates both
      // pass the SELECT pre-check, both insert, and each ends up waiting on the
      // other's index entry, so PostgreSQL aborts one with 40P01 instead of the
      // clean 23P01 the overlap branch expects. The aborted transaction wrote
      // nothing, so re-running it is safe, and by then the winner has committed
      // and the pre-check returns `overlap` through the ordinary path.
      const { repo, transaction } = createRepo()
      transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientUnknownRequestError(
          'PostgresError { code: "40P01", message: "deadlock detected" }',
          { clientVersion: 'test' }
        )
      )
      transaction.mockResolvedValueOnce({ kind: 'overlap' })

      await expect(
        repo.createChallengeWithoutOverlap(
          'temperate_wet',
          challengeData.starts_at,
          challengeData.ends_at,
          challengeData
        )
      ).resolves.toEqual({ kind: 'overlap' })
      expect(transaction).toHaveBeenCalledTimes(2)
    })

    it('rethrows a deadlock that survives the retry rather than looping', async () => {
      // The bound is the point. One retry settles two-way contention; retrying
      // a deadlock that keeps recurring would hide a real lock-ordering bug
      // behind a hang instead of surfacing it.
      const { repo, transaction } = createRepo()
      const deadlock = () =>
        new Prisma.PrismaClientUnknownRequestError(
          'PostgresError { code: "40P01", message: "deadlock detected" }',
          { clientVersion: 'test' }
        )
      transaction.mockRejectedValueOnce(deadlock())
      transaction.mockRejectedValueOnce(deadlock())

      await expect(
        repo.createChallengeWithoutOverlap(
          'temperate_wet',
          challengeData.starts_at,
          challengeData.ends_at,
          challengeData
        )
      ).rejects.toThrow('deadlock detected')
      expect(transaction).toHaveBeenCalledTimes(2)
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
          area: { country: null, region: null, city: null },
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

    // TWO RACES, TWO DIFFERENT ANSWERS. P2002 means another request won the
    // mint and the loser reads the winner's value; P2003 means the author's
    // account was deleted while the page was being assembled and there is
    // nothing to alias. Story 6.1 makes the second reachable in production: the
    // feed is table-wide by design and returns other people's posts, so a read
    // races the account erasure this same story ships with a 72-hour window.
    it('returns null when the author was deleted mid-read, rather than throwing', async () => {
      const { repo, aliasFindUnique, aliasCreate } = createRepo()
      aliasFindUnique.mockResolvedValueOnce(null)
      aliasCreate.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('foreign key constraint violated', {
          code: 'P2003',
          clientVersion: 'test',
        })
      )

      await expect(
        repo.resolveAlias('user-erased', () => 'Style Explorer NEW00001')
      ).resolves.toBeNull()
    })

    it('omits a vanished author from a page rather than failing the whole page', async () => {
      // Throwing here turned one stranger's deletion into a 500 for every other
      // item in the response.
      const { repo, aliasFindMany, aliasFindUnique, aliasCreate } = createRepo()
      aliasFindMany.mockResolvedValueOnce([
        { user_id: 'author-alive', alias: 'Style Explorer AAAA1111' },
      ])
      aliasFindUnique.mockResolvedValueOnce(null)
      aliasCreate.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('foreign key constraint violated', {
          code: 'P2003',
          clientVersion: 'test',
        })
      )

      const aliases = await repo.resolveAliases(
        ['author-alive', 'author-erased'],
        () => 'Style Explorer NEW00001'
      )

      expect(aliases.get('author-alive')).toBe('Style Explorer AAAA1111')
      expect(aliases.has('author-erased')).toBe(false)
    })

    it('rethrows a non-P2002 failure out of the lazy alias insert', async () => {
      const { repo, aliasFindUnique, aliasCreate } = createRepo()
      aliasFindUnique.mockResolvedValueOnce(null)
      aliasCreate.mockRejectedValueOnce(new Error('connection reset'))

      await expect(
        repo.resolveAlias(viewerUserId, () => 'Style Explorer NEW00001')
      ).rejects.toThrow('connection reset')
    })

    it('returns null when the P2002 winner was erased before the re-read', async () => {
      // The feed resolves strangers' aliases, so a read can lose the mint to
      // another request and then find the row gone: the author's erasure
      // cascaded it away in between. Seen as a flaky 6.1-INT-070 when a
      // parallel suite removed its own author mid-page.
      const { repo, aliasFindUnique, aliasCreate } = createRepo()
      aliasFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      aliasCreate.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { modelName: 'CommunityAlias', target: ['user_id'] },
        })
      )

      await expect(
        repo.resolveAlias('user-erased', () => 'Style Explorer NEW00001')
      ).resolves.toBeNull()
    })

    it('rethrows a generated-alias collision that leaves nothing to re-read', async () => {
      const { repo, aliasFindUnique, aliasCreate } = createRepo()
      aliasFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      aliasCreate.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { modelName: 'CommunityAlias', target: ['alias'] },
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

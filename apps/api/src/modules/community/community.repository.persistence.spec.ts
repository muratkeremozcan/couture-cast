// Learning path Step 38: Community feed by climate band.
import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  viewerUserId,
  createRepo,
} from '../../testing/community/community-repository.fixture'

describe('CommunityRepository persistence', () => {
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
})

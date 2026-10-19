// Learning path Step 38: Community feed by climate band.
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- assertions nest expect.objectContaining() and vi.fn() members, which is the established pattern for these suites. */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommunityChallengeWindowError } from './community.repository'
import {
  SERVICE_REFERENCE_TIME,
  viewerUserId,
  publishedPost,
  ownPendingPost,
  mockChallenge,
  createService,
  registerCommunityServiceLifecycle,
} from '../../testing/community/community-service.fixture'

describe('CommunityService projections and storage', () => {
  registerCommunityServiceLifecycle()

  describe('sparse rows and defensive projections', () => {
    const sparsePost = {
      ...publishedPost,
      caption: null,
      alt_text: null,
      climate_band: null,
      published_at: null,
      challenge_id: null,
    }

    it('projects a published row whose optional columns are all null', async () => {
      const { service } = createService({ posts: [sparsePost] })
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items[0]).toMatchObject({
        caption: null,
        altText: null,
        climateBand: null,
        publishedAt: null,
        challengeId: null,
      })
    })

    it('projects an author state whose optional columns are all null', async () => {
      const { service } = createService({
        posts: [],
        authorPosts: [
          {
            ...ownPendingPost,
            caption: null,
            alt_text: null,
            climate_band: null,
            challenge_id: null,
            moderation_reason: null,
          },
        ],
      })

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.authorStates[0]).toMatchObject({
        caption: null,
        altText: null,
        climateBand: null,
        challengeId: null,
        moderationReason: null,
      })
    })

    it('skips the storage round trip when no row carries an object path', async () => {
      const { service, signReadUrls } = createService({
        posts: [{ ...publishedPost, image_object_path: null }],
        authorPosts: [],
      })

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items).toEqual([])
      expect(signReadUrls).not.toHaveBeenCalled()
    })

    // THIS TEST USED TO ASSERT THE OPPOSITE, that a missing alias fell back to a
    // freshly minted one, on the premise that an absent entry meant the alias
    // table and the feed query had disagreed. That premise was wrong. An absent
    // entry means `resolveAlias` hit P2003 and the author's account was deleted
    // while the page was being assembled, which Story 6.1 makes reachable in
    // production because it ships account erasure with a 72-hour window against
    // a feed that is table-wide by design.
    //
    // The old fallback minted an UNPERSISTED name, so the same author rendered
    // differently on every request, and it kept an erased person's post on a
    // public feed under an invented identity.
    it('drops a post whose author was deleted while the page was being assembled', async () => {
      const { service, resolveAliases } = createService()
      resolveAliases.mockResolvedValueOnce(new Map())

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items.some((item) => item.author.isSelf === false)).toBe(false)
      // Never a minted stand-in, and never a raw id.
      for (const item of result.items) {
        expect(item.author.displayName).not.toMatch(/^Style Explorer [0-9A-F]{8}$/)
        expect(item.author.displayName).not.toContain('user-author-999')
      }
    })

    it('loses only the erased author, never the rest of the page', async () => {
      // The failure this closes served a 500 for the WHOLE page because one
      // stranger's account had gone mid-read. Every other item has to survive,
      // which is the entire difference between a dropped card and an outage.
      const survivor = {
        ...publishedPost,
        id: 'post-survivor',
        user_id: 'user-author-998',
      }
      const { service, resolveAliases } = createService({
        posts: [publishedPost, survivor],
      })
      // Only the survivor's author resolves; `user-author-999` was deleted while
      // the page was being assembled, so `resolveAliases` omits it.
      resolveAliases.mockResolvedValueOnce(
        new Map([['user-author-998', 'Style Explorer DEADBEEF']])
      )

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items.map((item) => item.id)).toEqual(['post-survivor'])
      expect(result.items[0]?.author.displayName).toBe('Style Explorer DEADBEEF')
    })

    it('drops the challenge when its copy has no usable entry at all', async () => {
      const { service } = createService({
        challenge: { ...mockChallenge, copy: {} },
      })

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.activeChallenge).toBeNull()
    })

    it('serves a challenge with no band restriction', async () => {
      const { service } = createService({
        challenge: { ...mockChallenge, climate_band: null },
      })

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.activeChallenge?.climateBand).toBeNull()
    })

    it('reports weather_malformed when a usable snapshot carries no summaries', async () => {
      const { service, getLatestWeather } = createService()
      getLatestWeather.mockResolvedValueOnce({ status: 'fresh', data: {} })

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.bandUnresolvedReason).toBe('weather_malformed')
    })

    it('replays a publish whose stored caption and locale are both null', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce({
        ...ownPendingPost,
        id: 'post-draft-1',
        status: 'pending_review',
        alt_text: 'A tailored trench',
        caption: null,
        locale: 'en-US',
        image_object_path: 'community/post-draft-1/session-abc.jpg',
      })

      const item = await service.publishPost({
        userId: viewerUserId,
        role: 'adult',
        platform: 'web',
        input: {
          postId: 'post-draft-1',
          uploadSessionId: 'session-abc',
          altText: 'A tailored trench',
          altTextConfirmed: true,
          locale: 'en-US',
        },
      })

      expect(item.id).toBe('post-draft-1')
    })

    it('treats a report on a post that no longer exists as an unknown subject', async () => {
      const { service, findPostById, recordReport } = createService()
      findPostById.mockResolvedValueOnce(null)

      await service.reportPost({
        userId: viewerUserId,
        postId: 'gone',
        platform: 'web',
        input: { reason: 'spam' },
      })

      expect(recordReport).toHaveBeenCalledWith(
        expect.objectContaining({ subjectAlias: 'unknown' })
      )
    })

    it('creates an unrestricted challenge when no band is given', async () => {
      const { service, createChallengeWithoutOverlap } = createService()

      await service.createChallenge({
        slug: 'global-challenge',
        startsAt: '2026-09-07T00:00:00.000Z',
        endsAt: '2026-09-14T00:00:00.000Z',
        timeZone: 'UTC',
        copy: { 'en-US': { title: 'Global', body: 'Global' } },
        isActive: true,
      })

      expect(createChallengeWithoutOverlap).toHaveBeenCalledWith(
        null,
        expect.any(Date),
        expect.any(Date),
        expect.objectContaining({ climate_band: null })
      )
    })

    it('restates the whole window when a challenge update moves it', async () => {
      const { service, updateChallengeWithoutOverlap } = createService()

      await service.updateChallenge('chal-1', {
        startsAt: '2026-09-14T00:00:00.000Z',
        endsAt: '2026-09-21T00:00:00.000Z',
        timeZone: 'UTC',
        climateBand: null,
      })

      expect(updateChallengeWithoutOverlap).toHaveBeenCalledWith(
        'chal-1',
        null,
        new Date('2026-09-14T00:00:00.000Z'),
        new Date('2026-09-21T00:00:00.000Z'),
        expect.objectContaining({
          starts_at: new Date('2026-09-14T00:00:00.000Z'),
          ends_at: new Date('2026-09-21T00:00:00.000Z'),
          time_zone: 'UTC',
        })
      )
    })

    it('maps the database window check to a 400, not a conflict', async () => {
      // A window that is only invalid relative to a row the caller did not send
      // is a malformed request rather than a clash with another challenge.
      const { service, createChallengeWithoutOverlap } = createService()
      createChallengeWithoutOverlap.mockRejectedValueOnce(
        new CommunityChallengeWindowError()
      )

      await expect(
        service.createChallenge({
          slug: 'bad-window',
          startsAt: '2026-09-07T00:00:00.000Z',
          endsAt: '2026-09-14T00:00:00.000Z',
          timeZone: 'UTC',
          copy: { 'en-US': { title: 'X', body: 'Y' } },
          isActive: true,
        })
      ).rejects.toThrow(BadRequestException)
    })
  })
  describe('storage outages are told apart from missing content', () => {
    beforeEach(() => vi.setSystemTime(SERVICE_REFERENCE_TIME))
    const draftPost = {
      ...ownPendingPost,
      id: 'post-draft-1',
      status: 'draft' as const,
      alt_text: null,
      caption: null,
      image_object_path: 'community/post-draft-1/session-abc.jpg' as string | null,
      upload_expires_at: new Date(SERVICE_REFERENCE_TIME.getTime() + 600_000),
    }

    const publishInput = {
      postId: 'post-draft-1',
      uploadSessionId: 'session-abc',
      altText: 'A tailored trench over a cream knit',
      altTextConfirmed: true as const,
      caption: null,
      locale: 'en-US' as const,
    }

    it('answers 503, not 404, when a visible post media cannot be signed', async () => {
      // A 404 tells the client the post is gone and tells an operator nothing,
      // so a storage outage would be indistinguishable from a deletion.
      const { service, findPostById, signReadUrls } = createService()
      findPostById.mockResolvedValueOnce(publishedPost)
      signReadUrls.mockResolvedValueOnce(new Map())

      await expect(
        service.getPost({ userId: viewerUserId, postId: 'post-other-user' })
      ).rejects.toThrow(ServiceUnavailableException)
    })

    it('still answers 404 for a post the caller genuinely cannot see', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce({ ...ownPendingPost, user_id: 'someone-else' })

      await expect(
        service.getPost({ userId: viewerUserId, postId: 'post-hidden' })
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects a publish whose bytes were never uploaded with a 4xx, not a 503', async () => {
      // 503 carries the documented meaning "community write rollout is
      // disabled", which sends the author to the feature flag rather than to
      // their own unfinished upload.
      const { service, findPostById, signReadUrls, publishWithinQuota } = createService()
      findPostById.mockResolvedValueOnce(draftPost)
      signReadUrls.mockResolvedValueOnce(new Map())

      await expect(
        service.publishPost({
          userId: viewerUserId,
          role: 'adult',
          platform: 'web',
          input: publishInput,
        })
      ).rejects.toThrow(ConflictException)

      // And it refuses before consuming a slot from the rolling cap.
      expect(publishWithinQuota).not.toHaveBeenCalled()
    })

    it('names the missing upload rather than the rollout state', async () => {
      const { service, findPostById, signReadUrls } = createService()
      findPostById.mockResolvedValueOnce(draftPost)
      signReadUrls.mockResolvedValueOnce(new Map())

      await expect(
        service.publishPost({
          userId: viewerUserId,
          role: 'adult',
          platform: 'web',
          input: publishInput,
        })
      ).rejects.toThrow(/Upload the image before publishing/)
    })

    it('publishes normally once the bytes are in the bucket', async () => {
      const { service, findPostById, publishWithinQuota } = createService()
      findPostById.mockResolvedValueOnce(draftPost)

      const item = await service.publishPost({
        userId: viewerUserId,
        role: 'adult',
        platform: 'web',
        input: publishInput,
      })

      expect(item.id).toBe('post-draft-1')
      expect(publishWithinQuota).toHaveBeenCalled()
    })
  })
})

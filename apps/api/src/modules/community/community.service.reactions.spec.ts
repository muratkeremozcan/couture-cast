// Learning path Step 38: Community feed by climate band.
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- assertions nest expect.objectContaining() and vi.fn() members, which is the established pattern for these suites. */
import { ForbiddenException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { COMMUNITY_AGE_GATE_DENIED_MESSAGE } from '@couture/api-client/contracts/http'
import {
  viewerUserId,
  publishedPost,
  ownPendingPost,
  createService,
  registerCommunityServiceLifecycle,
} from '../../testing/community/community-service.fixture'

describe('CommunityService reactions', () => {
  registerCommunityServiceLifecycle()

  describe('Story 6.3 reaction eligibility', () => {
    const params = {
      userId: viewerUserId,
      postId: 'post-other-user',
      platform: 'web' as const,
      input: {
        selection: 'applause' as const,
        mutationId: '63100000-0000-4000-8000-000000000001',
        baseRevision: 0,
      },
    }
    it('resolves flags before the repository checks authoritative guardian state', async () => {
      const { service, assertWardrobeUploadAllowed, getFeatureFlag, setReaction } =
        createService()
      let completedFlags = 0
      getFeatureFlag.mockImplementation(async () => {
        await Promise.resolve()
        completedFlags += 1
        return true
      })
      const transaction = setReaction.getMockImplementation()
      if (!transaction) throw new Error('Missing repository boundary fixture')
      setReaction.mockImplementation((request) => {
        expect(completedFlags).toBe(2)
        return transaction(request)
      })
      expect(await service.setReaction(params)).toMatchObject({
        viewerReaction: 'applause',
        revision: 1,
      })
      expect(getFeatureFlag).toHaveBeenCalledWith('community_read_enabled', viewerUserId)
      expect(getFeatureFlag).toHaveBeenCalledWith('community_write_enabled', viewerUserId)
      expect(Math.max(...getFeatureFlag.mock.invocationCallOrder)).toBeLessThan(
        setReaction.mock.invocationCallOrder[0]!
      )
      expect(assertWardrobeUploadAllowed).toHaveBeenCalledWith(
        viewerUserId,
        undefined,
        expect.any(Object)
      )
    })
    it('permits authenticated retraction during a write freeze and consent loss', async () => {
      const { service, assertWardrobeUploadAllowed, getFeatureFlag } = createService()
      getFeatureFlag.mockImplementation((key: string) =>
        Promise.resolve(key === 'community_read_enabled')
      )
      assertWardrobeUploadAllowed.mockRejectedValue(
        new ForbiddenException('consent lost')
      )
      await expect(
        service.setReaction({ ...params, input: { ...params.input, selection: null } })
      ).resolves.toBeDefined()
      expect(assertWardrobeUploadAllowed).not.toHaveBeenCalled()
      expect(getFeatureFlag).not.toHaveBeenCalledWith(
        'community_write_enabled',
        viewerUserId
      )
    })
    it('localizes eligibility refusals and preserves faults and quota retry metadata', async () => {
      const { service, assertWardrobeUploadAllowed, setReaction } = createService()
      assertWardrobeUploadAllowed.mockRejectedValueOnce(
        new ForbiddenException('consent lost')
      )
      await expect(service.setReaction(params)).rejects.toThrow(
        COMMUNITY_AGE_GATE_DENIED_MESSAGE
      )
      assertWardrobeUploadAllowed.mockRejectedValueOnce(new Error('database unavailable'))
      await expect(service.setReaction(params)).rejects.toThrow('database unavailable')
      setReaction.mockResolvedValueOnce({ retryAfterSeconds: 45 })
      await expect(service.setReaction(params)).rejects.toMatchObject({
        retryAfterSeconds: 45,
      })
    })
    it('negotiates summaries only for publicly visible posts and omits hidden owner summaries', async () => {
      const { service, reactionSummaries, findPostById } = createService()
      reactionSummaries.mockResolvedValue(
        new Map([
          [
            publishedPost.id,
            {
              counts: { applause: 0, love: 0, inspiration: 0 },
              total: 0,
              revision: 0,
              generation: 0,
              viewerReaction: null,
            },
          ],
        ])
      )
      const feed = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        reactions: true,
      })
      expect(feed.items[0]).toHaveProperty('reactions')
      findPostById.mockResolvedValue(ownPendingPost)
      const hidden = await service.getPost({
        userId: viewerUserId,
        postId: ownPendingPost.id,
        reactions: true,
      })
      expect(hidden).not.toHaveProperty('reactions')
    })
  })
})

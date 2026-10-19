// Learning path Step 38: Community feed by climate band.
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- assertions nest expect.objectContaining() and vi.fn() members, which is the established pattern for these suites. */
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import {
  viewerUserId,
  publishedPost,
  ownPendingPost,
  createService,
  registerCommunityServiceLifecycle,
} from '../../testing/community/community-service.fixture'

describe('CommunityService post detail', () => {
  registerCommunityServiceLifecycle()

  describe('getPost', () => {
    it('returns a published post to any viewer', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce(publishedPost)

      const item = await service.getPost({
        userId: viewerUserId,
        postId: 'post-other-user',
      })

      expect(item.id).toBe('post-other-user')
    })

    it('returns the author own non-published post so they can poll it', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce(ownPendingPost)

      const item = await service.getPost({
        userId: viewerUserId,
        postId: 'post-self-user',
      })

      expect(item.status).toBe('pending_review')
    })

    it('answers 404, not 403, for a post the caller cannot see', async () => {
      // A 403 would confirm the post exists.
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce({ ...ownPendingPost, user_id: 'someone-else' })

      await expect(
        service.getPost({ userId: viewerUserId, postId: 'post-hidden' })
      ).rejects.toThrow(NotFoundException)
    })

    it('answers 404 for a post that does not exist', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce(null)

      await expect(
        service.getPost({ userId: viewerUserId, postId: 'nope' })
      ).rejects.toThrow(NotFoundException)
    })

    it('answers 404 for a published post the operations canary wrote', async () => {
      // Story 6.2b final review (RF8): the canary's synthetic post is published
      // through the real pipeline and must never be served, whatever the flags.
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce({
        ...publishedPost,
        user_id: 'canary-user-run1',
      })

      await expect(
        service.getPost({ userId: viewerUserId, postId: 'post-other-user' })
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('recordCardOpened', () => {
    it('emits the card-open event the beta gate is measured on', async () => {
      const { service, findPostById, captureEvent, telemetryFailures } = createService()
      findPostById.mockResolvedValueOnce(publishedPost)

      await service.recordCardOpened({
        userId: viewerUserId,
        postId: 'post-other-user',
        platform: 'web',
        input: { experimentVariant: 'auto' },
      })

      expect(telemetryFailures).toEqual([])
      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_card_opened',
        expect.objectContaining({ isSelf: false, climateBand: 'temperate_dry' })
      )
    })

    it('marks a self card-open, which the lift metric excludes', async () => {
      const { service, findPostById, captureEvent } = createService()
      findPostById.mockResolvedValueOnce({ ...publishedPost, user_id: viewerUserId })

      await service.recordCardOpened({
        userId: viewerUserId,
        postId: 'post-other-user',
        platform: 'web',
        input: { experimentVariant: 'auto' },
      })

      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_card_opened',
        expect.objectContaining({ isSelf: true })
      )
    })

    it('rejects a card-open on a published post the operations canary wrote', async () => {
      // Story 6.2b final review (RF8).
      const { service, findPostById, captureEvent } = createService()
      findPostById.mockResolvedValueOnce({
        ...publishedPost,
        user_id: 'canary-user-run1',
      })

      await expect(
        service.recordCardOpened({
          userId: viewerUserId,
          postId: 'post-other-user',
          platform: 'web',
          input: { experimentVariant: 'auto' },
        })
      ).rejects.toThrow(NotFoundException)
      expect(captureEvent).not.toHaveBeenCalled()
    })

    it('rejects a card-open on a post that is not published', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce(ownPendingPost)

      await expect(
        service.recordCardOpened({
          userId: viewerUserId,
          postId: 'post-self-user',
          platform: 'web',
          input: { experimentVariant: 'auto' },
        })
      ).rejects.toThrow(NotFoundException)
    })

    // The sink upserts on the dedupe key, so a post-only key collapsed every
    // viewer's open of one post into ONE event. The non-self lift AC7 advances
    // on could therefore never exceed one per post no matter the traffic, which
    // made the beta gate unmeasurable in a second, quieter way than the missing
    // route did.
    it('scopes the dedupe key to the viewer, so two people opening one post stay two events', async () => {
      const { service, findPostById, captureEvent } = createService()
      findPostById.mockResolvedValue(publishedPost)

      await service.recordCardOpened({
        userId: 'viewer-one',
        postId: 'post-other-user',
        platform: 'web',
        input: { experimentVariant: 'auto' },
      })
      await service.recordCardOpened({
        userId: 'viewer-two',
        postId: 'post-other-user',
        platform: 'web',
        input: { experimentVariant: 'auto' },
      })

      const keys = captureEvent.mock.calls
        .filter((call) => call[1] === 'community_card_opened')
        .map((call) => (call[2] as { dedupeKey: string }).dedupeKey)
      expect(keys).toHaveLength(2)
      expect(keys[0]).not.toBe(keys[1])
      // Deliberately NOT an assertion on the token's value. The property that
      // matters is the ABSENCE of the raw id, and a test pinned to the token
      // string would pass just as happily if someone later concatenated the id
      // back on beside it. See the pseudonymity block below.
      expect(keys[0]).not.toContain('viewer-one')
      expect(keys[1]).not.toContain('viewer-two')
    })

    it('attributes the open to the arm the client was serving, not to a fresh derivation', async () => {
      // An assignment can change between a feed read and a tap. Re-deriving here
      // would attribute the open to an arm the viewer never saw.
      const { service, findPostById, captureEvent } = createService()
      findPostById.mockResolvedValueOnce(publishedPost)

      await service.recordCardOpened({
        userId: viewerUserId,
        postId: 'post-other-user',
        platform: 'web',
        input: { experimentVariant: 'all' },
      })

      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_card_opened',
        expect.objectContaining({ experimentVariant: 'all' })
      )
    })

    it('is gated on the read flag, so a dark feed records no opens', async () => {
      const { service } = createService({ flagEnabled: false })

      await expect(
        service.recordCardOpened({
          userId: viewerUserId,
          postId: 'post-other-user',
          platform: 'web',
          input: { experimentVariant: 'auto' },
        })
      ).rejects.toThrow(ServiceUnavailableException)
    })
  })
})

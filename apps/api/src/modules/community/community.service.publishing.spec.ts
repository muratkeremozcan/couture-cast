// Learning path Step 38: Community feed by climate band.
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- assertions nest expect.objectContaining() and vi.fn() members, which is the established pattern for these suites. */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommunityRateLimitException } from './community-rate-limit.exception'
import { type CommunityService } from './community.service'
import {
  SERVICE_REFERENCE_TIME,
  viewerUserId,
  ownPendingPost,
  mockChallenge,
  createService,
  registerCommunityServiceLifecycle,
} from '../../testing/community/community-service.fixture'

describe('CommunityService publishing and challenges', () => {
  registerCommunityServiceLifecycle()

  describe('allocatePost', () => {
    const validAllocateInput = {
      locale: 'en-US' as const,
      contentType: 'image/jpeg' as const,
      byteSize: 1024 * 500,
      sha256: 'a'.repeat(64),
      widthPx: 1080,
      heightPx: 1350,
    }

    const allocate = (
      service: CommunityService,
      overrides: Record<string, unknown> = {}
    ) =>
      service.allocatePost({
        userId: viewerUserId,
        role: 'adult',
        idempotencyKey: 'idemp-1',
        platform: 'web',
        input: validAllocateInput,
        ...overrides,
      })

    it('enforces guardian consent for teen users', async () => {
      const { service, assertWardrobeUploadAllowed } = createService()
      await allocate(service, { role: 'teen' })
      expect(assertWardrobeUploadAllowed).toHaveBeenCalledWith(viewerUserId, 'teen')
    })

    it('builds an object path with no user id in any segment', async () => {
      const { service, createPostDraft, createUploadSession } = createService()
      const result = await allocate(service)

      const draft = createPostDraft.mock.calls[0]![0] as { image_object_path: string }
      expect(draft.image_object_path).toBe(
        `community/${result.postId}/${result.uploadSessionId}.jpg`
      )
      expect(draft.image_object_path).not.toContain(viewerUserId)
      expect(createUploadSession).toHaveBeenCalledWith(draft.image_object_path, 900)
    })

    it('gives the upload session its own random id, distinct from the post id', async () => {
      const { service } = createService()
      const result = await allocate(service)

      expect(result.uploadSessionId).not.toBe(result.postId)
    })

    it('returns a server-generated alt-text suggestion in the requested locale', async () => {
      // The clients no longer generate alt text at all; the author edits and
      // confirms this.
      const { service } = createService()
      const result = await allocate(service, {
        input: { ...validAllocateInput, locale: 'fr-FR' as const },
      })

      expect(result.altTextSuggestionLocale).toBe('fr-FR')
      expect(result.altTextSuggestion).toContain('tenue')
    })

    it('reflects the resolved climate band in the suggestion', async () => {
      const { service } = createService()
      const result = await allocate(service)

      expect(result.altTextSuggestion).toContain('mild, dry weather')
    })

    it('re-issues a usable upload URL and token when the allocate is replayed', async () => {
      const { service, findPostByIdempotencyKey, createUploadSession, captureEvent } =
        createService()
      findPostByIdempotencyKey.mockResolvedValueOnce({
        ...ownPendingPost,
        id: 'existing-post-1',
        image_checksum: validAllocateInput.sha256,
        image_byte_size: validAllocateInput.byteSize,
        image_object_path: 'community/existing-post-1/session-xyz.jpg',
        image_content_type: 'image/jpeg',
      })

      const session = await allocate(service, { idempotencyKey: 'idemp-replay' })

      expect(session.postId).toBe('existing-post-1')
      expect(session.uploadSessionId).toBe('session-xyz')
      expect(session.uploadUrl).toBe('https://storage.local/upload/url')
      expect(session.uploadToken).toBe('upload-token-123')
      expect(createUploadSession).toHaveBeenCalledWith(
        'community/existing-post-1/session-xyz.jpg',
        900
      )
      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_post_allocated',
        expect.objectContaining({ replayed: true })
      )
    })

    it.each([
      ['checksum', { image_checksum: 'b'.repeat(64) }],
      ['byte size', { image_byte_size: 1 }],
      ['content type', { image_content_type: 'image/png' }],
    ])('throws ConflictException when the replayed %s differs', async (_label, diff) => {
      const { service, findPostByIdempotencyKey } = createService()
      findPostByIdempotencyKey.mockResolvedValueOnce({
        ...ownPendingPost,
        id: 'existing-post-1',
        image_checksum: validAllocateInput.sha256,
        image_byte_size: validAllocateInput.byteSize,
        image_content_type: 'image/jpeg',
        image_object_path: 'community/existing-post-1/session-xyz.jpg',
        ...diff,
      })

      await expect(
        allocate(service, { idempotencyKey: 'idemp-conflict' })
      ).rejects.toThrow(ConflictException)
    })

    it('does not apply the submission cap at allocate time', async () => {
      // Drafts are free by design; the cap belongs at publish, where a
      // submission is actually accepted.
      const { service, publishWithinQuota } = createService()
      await allocate(service)
      expect(publishWithinQuota).not.toHaveBeenCalled()
    })

    it('emits an allocation event marked as not replayed', async () => {
      const { service, captureEvent, telemetryFailures } = createService()
      await allocate(service)

      expect(telemetryFailures).toEqual([])
      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_post_allocated',
        expect.objectContaining({ replayed: false })
      )
    })
  })

  describe('publishPost', () => {
    beforeEach(() => vi.setSystemTime(SERVICE_REFERENCE_TIME))
    const draftPost = {
      ...ownPendingPost,
      id: 'post-draft-1',
      status: 'draft' as const,
      alt_text: null,
      caption: null,
      image_object_path: 'community/post-draft-1/session-abc.jpg',
      upload_expires_at: new Date(SERVICE_REFERENCE_TIME.getTime() + 600_000),
    }

    const validPublishInput = {
      postId: 'post-draft-1',
      uploadSessionId: 'session-abc',
      altText: 'A beautiful tailored beige trench coat over cream knit',
      altTextConfirmed: true as const,
      caption: 'Autumn commute look',
      locale: 'en-US' as const,
    }

    const publish = (
      service: CommunityService,
      input: typeof validPublishInput & { challengeId?: string } = validPublishInput
    ) =>
      service.publishPost({
        userId: viewerUserId,
        role: 'adult',
        platform: 'web',
        input,
      })

    it('throws NotFoundException when the post does not exist or is not owned', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce(null)

      await expect(publish(service)).rejects.toThrow(NotFoundException)
    })

    it('throws ConflictException when the upload session does not match the post', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce(draftPost)

      await expect(
        publish(service, {
          ...validPublishInput,
          uploadSessionId: 'session-from-another-post',
        })
      ).rejects.toThrow(ConflictException)
    })

    it('throws ConflictException one millisecond after the upload expiry boundary', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce({
        ...draftPost,
        upload_expires_at: new Date(SERVICE_REFERENCE_TIME.getTime() - 1),
      })

      await expect(publish(service)).rejects.toThrow(ConflictException)
    })

    it('accepts the upload at its exact expiry boundary', async () => {
      const { service, findPostById, publishWithinQuota } = createService()
      findPostById.mockResolvedValueOnce({
        ...draftPost,
        upload_expires_at: SERVICE_REFERENCE_TIME,
      })

      await expect(publish(service)).resolves.toMatchObject({ id: 'post-draft-1' })
      expect(publishWithinQuota).toHaveBeenCalledTimes(1)
    })

    it('rejects whitespace-only alt text', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce(draftPost)

      await expect(
        publish(service, { ...validPublishInput, altText: '   ' })
      ).rejects.toThrow(BadRequestException)
    })

    it('enforces the submission cap here, with a retry time', async () => {
      const { service, findPostById, publishWithinQuota } = createService()
      findPostById.mockResolvedValueOnce(draftPost)
      publishWithinQuota.mockResolvedValueOnce({
        kind: 'rate_limited',
        retryAfterSeconds: 3_600,
      })

      await expect(publish(service)).rejects.toThrow(CommunityRateLimitException)
    })

    it('submits through the atomic quota path and returns the feed item', async () => {
      const { service, findPostById, publishWithinQuota } = createService()
      findPostById.mockResolvedValueOnce(draftPost)

      const feedItem = await publish(service)

      expect(publishWithinQuota).toHaveBeenCalledWith({
        userId: viewerUserId,
        postId: 'post-draft-1',
        cap: 10,
        data: {
          altText: validPublishInput.altText,
          caption: validPublishInput.caption,
          climateBand: 'temperate_dry',
          locale: 'en-US',
          challengeId: null,
          area: { country: null, region: null, city: null },
        },
      })
      expect(feedItem.id).toBe('post-draft-1')
      expect(feedItem.author.isSelf).toBe(true)
    })

    it("6.6-UNIT-050 stamps only the normalized coarse area of the author's chosen location", async () => {
      const { service, findPostById, publishWithinQuota, findAreaLocation } =
        createService()
      findPostById.mockResolvedValueOnce(draftPost)
      findAreaLocation.mockResolvedValueOnce({
        country: ' Portugal ',
        region: 'Lisboa',
        city: 'Lisbon',
        area: { country: 'portugal', region: 'lisboa', city: 'lisbon' },
      })

      await publish(service)

      const [call] = publishWithinQuota.mock.calls.at(-1) as [
        { data: Record<string, unknown> },
      ]
      expect(call.data.area).toEqual({
        country: 'portugal',
        region: 'lisboa',
        city: 'lisbon',
      })
      expect(JSON.stringify(call.data)).not.toMatch(
        /latitude|longitude|location_key|timezone/
      )
    })

    it('associates an open challenge with the submission', async () => {
      const { service, findPostById, publishWithinQuota, captureEvent } = createService()
      findPostById.mockResolvedValueOnce(draftPost)
      vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'))

      await publish(service, { ...validPublishInput, challengeId: 'challenge-100' })

      expect(publishWithinQuota).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ challengeId: 'challenge-100' }),
        })
      )
      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_post_submitted',
        expect.objectContaining({ hasChallenge: true, hasCaption: true })
      )
    })

    it('rejects a challenge that is not open at submission time', async () => {
      const { service, findPostById, findChallengeById } = createService()
      findPostById.mockResolvedValueOnce(draftPost)
      findChallengeById.mockResolvedValueOnce({ ...mockChallenge, is_active: false })

      await expect(
        publish(service, { ...validPublishInput, challengeId: 'challenge-100' })
      ).rejects.toThrow(BadRequestException)
    })

    it('replays an identical publish instead of rejecting it', async () => {
      // The dropped-response retry is the exact case idempotency exists for.
      const { service, findPostById, publishWithinQuota } = createService()
      findPostById.mockResolvedValueOnce({
        ...draftPost,
        status: 'pending_review',
        alt_text: validPublishInput.altText,
        caption: validPublishInput.caption,
        locale: 'en-US',
      })

      const feedItem = await publish(service)

      expect(feedItem.id).toBe('post-draft-1')
      expect(publishWithinQuota).not.toHaveBeenCalled()
    })

    it('rejects a second publish that changes the payload', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce({
        ...draftPost,
        status: 'pending_review',
        alt_text: 'Something entirely different',
        caption: validPublishInput.caption,
        locale: 'en-US',
      })

      await expect(publish(service)).rejects.toThrow(ConflictException)
    })

    it('emits a submission event the real validator accepts', async () => {
      const { service, findPostById, captureEvent, telemetryFailures } = createService()
      findPostById.mockResolvedValueOnce(draftPost)

      await publish(service)

      expect(telemetryFailures).toEqual([])
      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_post_submitted',
        expect.objectContaining({
          hasCaption: true,
          hasChallenge: false,
          climateBand: 'temperate_dry',
        })
      )
    })
  })

  describe('challenges management', () => {
    const validChallengeInput = {
      slug: 'valid-challenge',
      climateBand: 'temperate_dry' as const,
      startsAt: '2026-09-07T00:00:00.000Z',
      endsAt: '2026-09-14T00:00:00.000Z',
      timeZone: 'Europe/Istanbul',
      copy: { 'en-US': { title: 'Valid', body: 'Valid' } },
      isActive: true,
    }

    it('throws ConflictException when the overlap check reports a clash', async () => {
      const { service, createChallengeWithoutOverlap } = createService()
      createChallengeWithoutOverlap.mockResolvedValueOnce({ kind: 'overlap' })

      await expect(service.createChallenge(validChallengeInput)).rejects.toThrow(
        ConflictException
      )
    })

    it('persists the time zone the Monday boundary is evaluated in', async () => {
      const { service, createChallengeWithoutOverlap } = createService()
      const challenge = await service.createChallenge(validChallengeInput)

      expect(createChallengeWithoutOverlap).toHaveBeenCalledWith(
        'temperate_dry',
        new Date('2026-09-07T00:00:00.000Z'),
        new Date('2026-09-14T00:00:00.000Z'),
        expect.objectContaining({
          slug: 'valid-challenge',
          climate_band: 'temperate_dry',
          time_zone: 'Europe/Istanbul',
          is_active: true,
        })
      )
      expect(challenge.timeZone).toBe('Europe/Istanbul')
      expect(challenge).not.toHaveProperty('climate_band')
    })

    it('throws NotFoundException when updating a challenge that does not exist', async () => {
      const { service, findChallengeById } = createService()
      findChallengeById.mockResolvedValueOnce(null)

      await expect(
        service.updateChallenge('missing-challenge', { slug: 'whatever' })
      ).rejects.toThrow(NotFoundException)
    })

    it('excludes the row being updated from its own overlap check', async () => {
      const { service, updateChallengeWithoutOverlap } = createService()
      await service.updateChallenge('chal-1', { isActive: false })

      expect(updateChallengeWithoutOverlap).toHaveBeenCalledWith(
        'chal-1',
        'temperate_dry',
        mockChallenge.starts_at,
        mockChallenge.ends_at,
        expect.objectContaining({ is_active: false, climate_band: undefined })
      )
    })
  })
})

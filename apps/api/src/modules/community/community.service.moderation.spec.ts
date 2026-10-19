// Learning path Step 38: Community feed by climate band.
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- assertions nest expect.objectContaining() and vi.fn() members, which is the established pattern for these suites. */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { COMMUNITY_AGE_GATE_DENIED_MESSAGE } from '@couture/api-client/contracts/http'
import { type CommunityService } from './community.service'
import {
  viewerUserId,
  publishedPost,
  ownPendingPost,
  createService,
  registerCommunityServiceLifecycle,
} from '../../testing/community/community-service.fixture'

describe('CommunityService moderation and erasure', () => {
  registerCommunityServiceLifecycle()

  describe('reportPost', () => {
    const report = (service: CommunityService, reason: 'spam' | 'violence' = 'spam') =>
      service.reportPost({
        userId: viewerUserId,
        postId: 'other-post',
        platform: 'web',
        input: { reason },
      })

    it('throws NotFoundException when the post is not visible to the reporter', async () => {
      const { service, recordReport } = createService()
      recordReport.mockResolvedValueOnce({ kind: 'post_not_visible' })

      await expect(report(service)).rejects.toThrow(NotFoundException)
    })

    it('throws ForbiddenException, not BadRequest, on a self-report', async () => {
      const { service, recordReport } = createService()
      recordReport.mockResolvedValueOnce({ kind: 'self_report' })

      await expect(report(service)).rejects.toThrow(ForbiddenException)
    })

    it('is idempotent when the same reason is replayed', async () => {
      const { service, recordReport, captureEvent } = createService()
      recordReport.mockResolvedValueOnce({ kind: 'replayed' })

      await expect(report(service)).resolves.toEqual({ tracked: true })
      expect(captureEvent).not.toHaveBeenCalledWith(
        viewerUserId,
        'community_post_reported',
        expect.anything()
      )
    })

    it('throws ConflictException only when the reason changed', async () => {
      const { service, recordReport } = createService()
      recordReport.mockResolvedValueOnce({
        kind: 'reason_changed',
        existingReason: 'spam',
      })

      await expect(report(service, 'violence')).rejects.toThrow(ConflictException)
    })

    it('surfaces the abuse limiter as a 429 carrying a retry time', async () => {
      const { service, recordReport } = createService()
      recordReport.mockResolvedValueOnce({ kind: 'rate_limited', retryAfterSeconds: 900 })

      await expect(report(service)).rejects.toMatchObject({ retryAfterSeconds: 900 })
    })

    it('passes the enum reason, the SLA clock, and the subject pseudonym', async () => {
      const { service, recordReport, findPostById, resolveAlias } = createService()
      findPostById.mockResolvedValueOnce(publishedPost)

      await service.reportPost({
        userId: viewerUserId,
        postId: 'other-post',
        platform: 'web',
        input: { reason: 'violence', details: 'Contains aggressive imagery' },
      })

      expect(resolveAlias).toHaveBeenCalledWith('user-author-999', expect.any(Function))
      expect(recordReport).toHaveBeenCalledWith({
        postId: 'other-post',
        reporterId: viewerUserId,
        reason: 'violence',
        details: 'Contains aggressive imagery',
        abuseLimit: 50,
        slaHours: 24,
        subjectAlias: 'Style Explorer AABBCCDD',
      })
    })

    it('emits a report event whose payload the real strict validator accepts', async () => {
      const { service, captureEvent, telemetryFailures } = createService()

      await report(service)

      // A `postId` here, the defect this replaces, would land in
      // telemetryFailures rather than be swallowed.
      expect(telemetryFailures).toEqual([])
      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_post_reported',
        expect.objectContaining({ platform: 'web', reason: 'spam' })
      )
    })
  })

  describe('withdrawPost', () => {
    const withdraw = (service: CommunityService, postId = 'post-mine') =>
      service.withdrawPost({ userId: viewerUserId, postId, platform: 'web' })

    it('throws NotFoundException when the post does not exist', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce(null)

      await expect(withdraw(service)).rejects.toThrow(NotFoundException)
    })

    it('throws ForbiddenException when the caller is not the author', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce({ ...publishedPost, user_id: 'someone-else' })

      await expect(withdraw(service)).rejects.toThrow(ForbiddenException)
    })

    it.each(['draft', 'withdrawn', 'review_failed'])(
      'rejects withdrawing a %s post',
      async (status) => {
        const { service, findPostById, updatePost } = createService()
        findPostById.mockResolvedValueOnce({ ...ownPendingPost, status: status as never })

        await expect(withdraw(service)).rejects.toThrow(ConflictException)
        expect(updatePost).not.toHaveBeenCalled()
      }
    )

    it('withdraws a published post and emits the event', async () => {
      const {
        service,
        findPostById,
        withdrawPostAndRequestErasure,
        captureEvent,
        telemetryFailures,
      } = createService()
      findPostById.mockResolvedValueOnce({ ...publishedPost, user_id: viewerUserId })

      await expect(withdraw(service)).resolves.toEqual({ tracked: true })

      expect(withdrawPostAndRequestErasure).toHaveBeenCalledWith(
        'post-mine',
        expect.any(Date)
      )
      expect(telemetryFailures).toEqual([])
      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_post_withdrawn',
        expect.objectContaining({ climateBand: 'temperate_dry' })
      )
    })
  })

  describe('age gate refusals', () => {
    const ageGateAllocateInput = {
      locale: 'en-US' as const,
      contentType: 'image/jpeg' as const,
      byteSize: 1024 * 500,
      sha256: 'a'.repeat(64),
      widthPx: 1080,
      heightPx: 1350,
    }

    // The clients classify a community 403 on `COMMUNITY_AGE_GATE_DENIED_MESSAGE`
    // and fall through to a generic "We could not publish your look." for
    // anything else. The shared guard throws `GUARDIAN_CONSENT_REQUIRED`, which
    // is the wardrobe surface's own code, so until this translation existed the
    // age-gate copy translated into all ten locales was unreachable.
    it('publishes the community message rather than the wardrobe code', async () => {
      const { service, assertWardrobeUploadAllowed } = createService()
      assertWardrobeUploadAllowed.mockRejectedValueOnce(
        new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
      )

      await expect(
        service.publishPost({
          userId: viewerUserId,
          role: 'teen',
          platform: 'web',
          input: {
            postId: 'post-mine',
            uploadSessionId: 'session-1',
            altText: 'A denim jacket over a striped shirt',
            altTextConfirmed: true as const,
            caption: 'Autumn commute look',
            locale: 'en-US' as const,
          },
        })
      ).rejects.toThrow(COMMUNITY_AGE_GATE_DENIED_MESSAGE)
    })

    it('translates the refusal on the allocate path too, so the gate reads the same at both steps', async () => {
      const { service, assertWardrobeUploadAllowed } = createService()
      assertWardrobeUploadAllowed.mockRejectedValueOnce(
        new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
      )

      await expect(
        service.allocatePost({
          userId: viewerUserId,
          role: 'teen',
          idempotencyKey: 'idem-age-gate',
          platform: 'web',
          input: ageGateAllocateInput,
        })
      ).rejects.toThrow(COMMUNITY_AGE_GATE_DENIED_MESSAGE)
    })

    it('does not dress a non-Forbidden fault up as an age gate', async () => {
      // A database outage inside the guard is a 500, not a message telling a
      // grown adult they are too young to post.
      const { service, assertWardrobeUploadAllowed } = createService()
      assertWardrobeUploadAllowed.mockRejectedValueOnce(new Error('connection lost'))

      await expect(
        service.allocatePost({
          userId: viewerUserId,
          role: 'adult',
          idempotencyKey: 'idem-fault',
          platform: 'web',
          input: ageGateAllocateInput,
        })
      ).rejects.toThrow('connection lost')
    })
  })

  describe('requestAccountContentErasure', () => {
    // The erasure sweep had no producer at all: `erasure_requested_at` was
    // written only by the test factory, so a withdrawn post's image stayed in
    // the bucket forever and the 72-hour deadline never started, which meant
    // `community_erasure_overdue` could not fire even in principle. Withdrawal
    // is one producer; account deletion is the other.
    it('marks every unclaimed post of the member and reports the count', async () => {
      const { service, requestErasureForUser } = createService()

      await expect(service.requestAccountContentErasure(viewerUserId)).resolves.toEqual({
        postsMarked: 2,
      })

      expect(requestErasureForUser).toHaveBeenCalledWith(viewerUserId, expect.any(Date))
    })

    it('is not gated on either rollout flag, because erasure is not a feature', async () => {
      // A member asking for their content to be deleted must not be refused
      // because the beta happens to be closed.
      const { service, getFeatureFlag } = createService({ flagEnabled: false })

      await expect(service.requestAccountContentErasure(viewerUserId)).resolves.toEqual({
        postsMarked: 2,
      })

      expect(getFeatureFlag).not.toHaveBeenCalled()
    })
  })
})

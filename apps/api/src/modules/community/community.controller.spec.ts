// Learning path Step 38: Community feed by climate band.
import { BadRequestException } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { describe, expect, it, vi } from 'vitest'
import {
  communityFeedResponseSchema,
  type CommunityFeed,
  type CommunityFeedResponse,
} from '../../contracts/http'
import type { Response } from 'express'
import { RequestAuthGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { CommunityRateLimitException } from './community-rate-limit.exception'
import { CommunityController } from './community.controller'
import type { CommunityService } from './community.service'

/**
 * The write endpoints take the response object so a rolling-window refusal can
 * carry `Retry-After`. The double records what was set.
 */
const createResponse = () => {
  const setHeader = vi.fn()
  return { response: { setHeader } as unknown as Response, setHeader }
}

describe('CommunityController', () => {
  const authContext: RequestAuthContext = {
    token: 'test-token',
    userId: 'user-test-123',
    role: 'teen',
  }

  const mockFeedData: CommunityFeed = {
    items: [
      {
        id: 'post-1',
        caption: 'A sunny autumn day look',
        altText: 'Wool sweater and trench coat',
        climateBand: 'temperate_dry',
        imageAccess: {
          url: 'https://storage.local/community-images/post-1.jpg',
          expiresAt: '2026-09-05T12:15:00.000Z',
        },
        publishedAt: '2026-09-05T12:00:00.000Z',
        createdAt: '2026-09-05T12:00:00.000Z',
        status: 'published',
        challengeId: null,
        author: {
          displayName: 'Style Explorer A1B2C3D4',
          isSelf: false,
        },
      },
    ],
    authorStates: [],
    nextCursor: null,
    mode: 'auto',
    viewerBand: 'temperate_dry',
    bandResolved: true,
    bandUnresolvedReason: null,
    experimentVariant: 'auto',
    activeChallenge: {
      id: 'challenge-1',
      slug: 'autumn-layers',
      climateBand: 'temperate_dry',
      title: 'Autumn Layers Challenge',
      timeZone: 'Europe/Istanbul',
      body: 'Show us your best autumn layers!',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-09-08T00:00:00.000Z',
    },
  }

  const createController = (feedData: CommunityFeed = mockFeedData) => {
    const getFeed = vi.fn().mockResolvedValue(feedData)
    const allocatePost = vi.fn().mockResolvedValue({
      postId: 'post-1',
      uploadSessionId: 'post-1',
      uploadUrl: 'https://storage.local/upload/post-1.jpg',
      uploadToken: 'token-1',
      requiredHeaders: { 'content-type': 'image/jpeg' },
      expiresAt: '2026-09-05T13:00:00.000Z',
      altTextSuggestion: 'Portrait photo of an outfit.',
      altTextSuggestionLocale: 'en-US',
    })
    const publishPost = vi.fn().mockResolvedValue(mockFeedData.items[0])
    const reportPost = vi.fn().mockResolvedValue({ tracked: true })
    const withdrawPost = vi.fn().mockResolvedValue({ tracked: true })
    // The service now returns the public projection; the controller only wraps
    // and validates it, so the double returns projection shape, not table rows.
    const challengeProjection = {
      id: 'chal-1',
      slug: 'challenge-1',
      climateBand: 'temperate_dry' as const,
      startsAt: '2026-09-07T00:00:00.000Z',
      endsAt: '2026-09-14T00:00:00.000Z',
      timeZone: 'UTC',
      copy: { 'en-US': { title: 'Autumn', body: 'Layers' } },
      isActive: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }
    const createChallenge = vi.fn().mockResolvedValue(challengeProjection)
    const updateChallenge = vi.fn().mockResolvedValue(challengeProjection)

    const communityService = {
      getFeed,
      allocatePost,
      publishPost,
      reportPost,
      withdrawPost,
      createChallenge,
      updateChallenge,
    } as unknown as CommunityService

    const controller = new CommunityController(communityService)
    return {
      controller,
      getFeed,
      allocatePost,
      publishPost,
      reportPost,
      withdrawPost,
      createChallenge,
      updateChallenge,
    }
  }

  describe('guards and annotations', () => {
    it('is protected by RequestAuthGuard', () => {
      const guards = (Reflect.getMetadata(GUARDS_METADATA, CommunityController) ??
        []) as unknown[]
      expect(guards).toContain(RequestAuthGuard)
    })
  })

  describe('platform header validation', () => {
    it('throws BadRequestException when x-couture-platform header is missing', async () => {
      const { controller } = createController()
      await expect(
        controller.getFeed(authContext, undefined, 'en-US', {})
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when x-couture-platform is invalid (e.g. desktop)', async () => {
      const { controller } = createController()
      await expect(
        controller.getFeed(authContext, 'desktop', 'en-US', {})
      ).rejects.toThrow(BadRequestException)
    })

    it('accepts valid platform web and calls service', async () => {
      const { controller, getFeed } = createController()
      const response = await controller.getFeed(authContext, 'web', 'en-US', {})

      expect(getFeed).toHaveBeenCalledWith({
        userId: 'user-test-123',
        platform: 'web',
        mode: 'auto',
        cursor: undefined,
        limit: 12,
        acceptLanguage: 'en-US',
      })
      expect(response.data).toEqual(mockFeedData)
    })

    it('accepts valid platform mobile and calls service', async () => {
      const { controller, getFeed } = createController()
      const response = await controller.getFeed(authContext, 'mobile', 'en-US', {})

      expect(getFeed).toHaveBeenCalledWith({
        userId: 'user-test-123',
        platform: 'mobile',
        mode: 'auto',
        cursor: undefined,
        limit: 12,
        acceptLanguage: 'en-US',
      })
      expect(response.data).toEqual(mockFeedData)
    })
  })

  describe('query parameter validation', () => {
    it('passes the requested mode through', async () => {
      const { controller, getFeed } = createController()
      await controller.getFeed(authContext, 'web', 'en-US', { mode: 'cold_wet' })

      expect(getFeed).toHaveBeenCalledWith({
        userId: 'user-test-123',
        platform: 'web',
        mode: 'cold_wet',
        cursor: undefined,
        limit: 12,
        acceptLanguage: 'en-US',
      })
    })

    it('accepts the all mode, which the beta experiment assigns half the viewers', async () => {
      const { controller, getFeed } = createController()
      await controller.getFeed(authContext, 'web', 'en-US', { mode: 'all' })

      expect(getFeed).toHaveBeenCalledWith(expect.objectContaining({ mode: 'all' }))
    })

    it('throws BadRequestException when mode is not a valid value', async () => {
      const { controller } = createController()
      await expect(
        controller.getFeed(authContext, 'web', 'en-US', { mode: 'polar' })
      ).rejects.toThrow(BadRequestException)
    })

    it('accepts custom limit within [1, 30]', async () => {
      const { controller, getFeed } = createController()
      await controller.getFeed(authContext, 'web', 'en-US', { limit: '25' })

      expect(getFeed).toHaveBeenCalledWith({
        userId: 'user-test-123',
        platform: 'web',
        mode: 'auto',
        cursor: undefined,
        limit: 25,
        acceptLanguage: 'en-US',
      })
    })

    it('throws BadRequestException when limit is outside [1, 30]', async () => {
      const { controller } = createController()
      await expect(
        controller.getFeed(authContext, 'web', 'en-US', { limit: '0' })
      ).rejects.toThrow(BadRequestException)

      await expect(
        controller.getFeed(authContext, 'web', 'en-US', { limit: '31' })
      ).rejects.toThrow(BadRequestException)
    })

    it('accepts valid cursor query parameter', async () => {
      const { controller, getFeed } = createController()
      const cursor = 'valid-cursor-string'
      await controller.getFeed(authContext, 'web', 'en-US', { cursor })

      expect(getFeed).toHaveBeenCalledWith({
        userId: 'user-test-123',
        platform: 'web',
        mode: 'auto',
        cursor: 'valid-cursor-string',
        limit: 12,
        acceptLanguage: 'en-US',
      })
    })
  })

  describe('response envelope validation', () => {
    it('returns schema-valid data envelope matching communityFeedResponseSchema', async () => {
      const { controller } = createController()
      const response: CommunityFeedResponse = await controller.getFeed(
        authContext,
        'web',
        'en-US',
        {}
      )

      const parsed = communityFeedResponseSchema.parse(response)
      expect(parsed).toEqual({ data: mockFeedData })
    })
  })

  describe('allocatePost', () => {
    const validPayload = {
      contentType: 'image/jpeg',
      byteSize: 1024 * 100,
      sha256: 'c'.repeat(64),
      widthPx: 800,
      heightPx: 1000,
      locale: 'en-US' as const,
    }

    it('throws BadRequestException when platform header is missing', async () => {
      const { controller } = createController()
      await expect(
        controller.allocatePost(
          authContext,
          undefined,
          'idemp-1',
          validPayload,
          createResponse().response
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when Idempotency-Key header is missing', async () => {
      const { controller } = createController()
      await expect(
        controller.allocatePost(
          authContext,
          'web',
          undefined,
          validPayload,
          createResponse().response
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when body fails schema validation', async () => {
      const { controller } = createController()
      await expect(
        controller.allocatePost(
          authContext,
          'web',
          'idemp-1',
          { ...validPayload, byteSize: -1 },
          createResponse().response
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('calls service.allocatePost with parsed parameters and returns envelope', async () => {
      const { controller, allocatePost } = createController()
      const response = await controller.allocatePost(
        authContext,
        'web',
        'idemp-1',
        validPayload,
        createResponse().response
      )

      expect(allocatePost).toHaveBeenCalledWith({
        userId: 'user-test-123',
        role: 'teen',
        idempotencyKey: 'idemp-1',
        platform: 'web',
        input: validPayload,
      })
      expect(response.data.postId).toBe('post-1')
      expect(response.data.uploadUrl).toBe('https://storage.local/upload/post-1.jpg')
    })
  })

  describe('publishPost', () => {
    const validPayload = {
      postId: 'post-1',
      uploadSessionId: 'post-1',
      altText: 'Casual everyday trench coat',
      altTextConfirmed: true as const,
      caption: 'A fresh morning fit',
      locale: 'en-US' as const,
    }

    it('throws BadRequestException when platform header is missing', async () => {
      const { controller } = createController()
      await expect(
        controller.publishPost(
          authContext,
          undefined,
          'idemp-publish-1',
          validPayload,
          createResponse().response
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when body validation fails', async () => {
      const { controller } = createController()
      await expect(
        controller.publishPost(
          authContext,
          'web',
          'idemp-publish-1',
          { ...validPayload, altText: '' },
          createResponse().response
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects a publish with no Idempotency-Key header', async () => {
      // Publish carries the same replay semantics as allocate, so the key is
      // required rather than optional.
      const { controller } = createController()
      await expect(
        controller.publishPost(
          authContext,
          'web',
          undefined,
          validPayload,
          createResponse().response
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('calls service.publishPost and returns published feed item', async () => {
      const { controller, publishPost } = createController()
      const response = await controller.publishPost(
        authContext,
        'web',
        'idemp-publish-1',
        validPayload,
        createResponse().response
      )

      expect(publishPost).toHaveBeenCalledWith({
        userId: 'user-test-123',
        role: 'teen',
        platform: 'web',
        input: validPayload,
      })
      expect(response.data.id).toBe('post-1')
    })

    it('stamps Retry-After when the submission cap refuses the publish', async () => {
      const { controller, publishPost } = createController()
      const { response, setHeader } = createResponse()
      publishPost.mockRejectedValueOnce(
        new CommunityRateLimitException('rate limited', 3_600)
      )

      await expect(
        controller.publishPost(
          authContext,
          'web',
          'idemp-publish-1',
          validPayload,
          response
        )
      ).rejects.toThrow(CommunityRateLimitException)
      expect(setHeader).toHaveBeenCalledWith('Retry-After', '3600')
    })
  })

  describe('reportPost', () => {
    it('throws BadRequestException when platform header is missing', async () => {
      const { controller } = createController()
      await expect(
        controller.reportPost(
          authContext,
          'post-1',
          undefined,
          { reason: 'spam' },
          createResponse().response
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when reason is invalid', async () => {
      const { controller } = createController()
      await expect(
        controller.reportPost(
          authContext,
          'post-1',
          'web',
          { reason: 'not-a-reason' },
          createResponse().response
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('calls service.reportPost and returns tracked response', async () => {
      const { controller, reportPost } = createController()
      const response = await controller.reportPost(
        authContext,
        'post-1',
        'web',
        {
          reason: 'spam',
          details: 'Repetitive marketing links',
        },
        createResponse().response
      )

      expect(reportPost).toHaveBeenCalledWith({
        userId: 'user-test-123',
        postId: 'post-1',
        platform: 'web',
        input: { reason: 'spam', details: 'Repetitive marketing links' },
      })
      expect(response.tracked).toBe(true)
    })

    it('stamps Retry-After when the abuse limiter refuses the report', async () => {
      const { controller, reportPost } = createController()
      const { response, setHeader } = createResponse()
      reportPost.mockRejectedValueOnce(
        new CommunityRateLimitException('report rate limited', 900)
      )

      await expect(
        controller.reportPost(authContext, 'post-1', 'web', { reason: 'spam' }, response)
      ).rejects.toThrow(CommunityRateLimitException)
      expect(setHeader).toHaveBeenCalledWith('Retry-After', '900')
    })
  })

  describe('withdrawPost', () => {
    it('throws BadRequestException when platform header is missing', async () => {
      const { controller } = createController()
      await expect(
        controller.withdrawPost(authContext, 'post-1', undefined)
      ).rejects.toThrow(BadRequestException)
    })

    it('calls service.withdrawPost and returns tracked response', async () => {
      const { controller, withdrawPost } = createController()
      const response = await controller.withdrawPost(authContext, 'post-1', 'mobile')

      expect(withdrawPost).toHaveBeenCalledWith({
        userId: 'user-test-123',
        postId: 'post-1',
        platform: 'mobile',
      })
      expect(response).toEqual({ tracked: true })
    })
  })

  describe('challenges admin endpoints', () => {
    it('creates challenge and returns formatted response', async () => {
      const { controller, createChallenge } = createController()
      // The window must start on a Monday in its own zone and span exactly
      // seven days; the contract enforces that, so a bad one never reaches the
      // service.
      const payload = {
        slug: 'challenge-1',
        climateBand: 'temperate_dry' as const,
        startsAt: '2026-09-07T00:00:00.000Z',
        endsAt: '2026-09-14T00:00:00.000Z',
        timeZone: 'UTC',
        copy: { 'en-US': { title: 'Autumn', body: 'Layers' } },
        isActive: true,
      }

      const response = await controller.createChallenge(payload)
      expect(createChallenge).toHaveBeenCalledWith(payload)
      expect(response.data.slug).toBe('challenge-1')
    })

    it('updates challenge and returns formatted response', async () => {
      const { controller, updateChallenge } = createController()
      const payload = {
        isActive: false,
      }

      const response = await controller.updateChallenge('chal-1', payload)
      expect(updateChallenge).toHaveBeenCalledWith('chal-1', payload)
      expect(response.data.id).toBe('chal-1')
    })
  })
})

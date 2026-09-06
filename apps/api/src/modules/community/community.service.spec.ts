// Learning path Step 38: Community feed by climate band.
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- assertions nest expect.objectContaining() and vi.fn() members, which is the established pattern for these suites. */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  communityCardOpenedEventSchema,
  communityFeedViewedEventSchema,
  communityPostAllocatedEventSchema,
  communityPostReportedEventSchema,
  communityPostSubmittedEventSchema,
  communityPostWithdrawnEventSchema,
} from '@couture/api-client'
import {
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  communityFeedItemSchema,
  communityFeedSchema,
  encodeCommunityFeedCursor,
  type ClimateBand,
} from '@couture/api-client/contracts/http'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service'
import type { GuardianService } from '../guardian/guardian.service'
import type { TelemetryService } from '../telemetry/telemetry.service'
import type { WeatherQueryService } from '../weather/weather-query.service'
import { CommunityRateLimitException } from './community-rate-limit.exception'
import { CommunityChallengeWindowError } from './community.repository'
import type { CommunityStorage } from './community-storage.adapter'
import type { CommunityRepository } from './community.repository'
import { CommunityService } from './community.service'

/**
 * The telemetry double validates through the SAME schemas `TelemetryService`
 * derives its validators from.
 *
 * A plain `vi.fn()` is what let the report event ship broken: the service passed
 * a `postId` the real `.strict()` validator rejects, the throw was swallowed by
 * a bare `catch {}`, and the unit test asserted the wrong payload against a mock
 * that would accept anything. Because the service still fails open on telemetry,
 * asserting the call alone would not catch a rejected payload either, so the
 * double records every rejection and the specs assert that list is empty.
 */
const TELEMETRY_VALIDATORS: Record<string, { parse: (value: unknown) => unknown }> = {
  community_feed_viewed: communityFeedViewedEventSchema
    .omit({ analyticsSubjectId: true })
    .strict(),
  community_card_opened: communityCardOpenedEventSchema
    .omit({ analyticsSubjectId: true })
    .strict(),
  community_post_allocated: communityPostAllocatedEventSchema
    .omit({ analyticsSubjectId: true })
    .strict(),
  community_post_submitted: communityPostSubmittedEventSchema
    .omit({ analyticsSubjectId: true })
    .strict(),
  community_post_reported: communityPostReportedEventSchema
    .omit({ analyticsSubjectId: true })
    .strict(),
  community_post_withdrawn: communityPostWithdrawnEventSchema
    .omit({ analyticsSubjectId: true })
    .strict(),
}

describe('CommunityService', () => {
  const viewerUserId = 'user-viewer-1'

  afterEach(() => {
    vi.useRealTimers()
  })

  const mockLocation = {
    id: 'loc-1',
    user_id: viewerUserId,
    location_key: 'new-york-ny',
    city: 'New York',
    label: 'Home',
    is_primary: true,
    latitude: 40.7128,
    longitude: -74.006,
    created_at: new Date('2026-09-01T00:00:00.000Z'),
    updated_at: new Date('2026-09-01T00:00:00.000Z'),
  }

  const secondaryLocation = {
    ...mockLocation,
    id: 'loc-2',
    location_key: 'lisbon-pt',
    is_primary: false,
  }

  const mockDailySummaries = [
    {
      localDate: '2026-09-05',
      condition: 'clear',
      temperatureMin: 14,
      temperatureMax: 20,
      precipitationProbability: 0.1,
      precipitationAmount: 0,
      windSpeed: 5,
    },
    {
      localDate: '2026-09-06',
      condition: 'cloudy',
      temperatureMin: 15,
      temperatureMax: 21,
      precipitationProbability: 0.2,
      precipitationAmount: 0,
      windSpeed: 7,
    },
    {
      localDate: '2026-09-07',
      condition: 'clear',
      temperatureMin: 16,
      temperatureMax: 22,
      precipitationProbability: 0.1,
      precipitationAmount: 0,
      windSpeed: 6,
    },
  ]

  const basePost = {
    caption: 'Crisp autumn morning layers' as string | null,
    alt_text: 'Beige trench over chunky knit' as string | null,
    climate_band: 'temperate_dry' as ClimateBand | null,
    image_content_type: 'image/jpeg',
    image_checksum: 'a'.repeat(64),
    image_byte_size: 1024,
    upload_expires_at: null,
    submitted_at: new Date('2026-09-05T11:00:00.000Z'),
    moderation_reason: null as string | null,
    moderation_engine_version: null as string | null,
    idempotency_key: null,
    location_key: 'new-york-ny',
    locale: 'en-US',
    palette_insight_id: null,
    challenge_id: null as string | null,
    erasure_requested_at: null,
    anonymized_at: null,
    objects_purged_at: null,
  }

  const publishedPost = {
    ...basePost,
    id: 'post-other-user',
    user_id: 'user-author-999',
    image_object_path: 'community/post-other-user/aaa.jpg' as string | null,
    status: 'published' as const,
    created_at: new Date('2026-09-05T12:00:00.000Z'),
    updated_at: new Date('2026-09-05T12:00:00.000Z'),
    published_at: new Date('2026-09-05T12:00:00.000Z') as Date | null,
  }

  const ownPendingPost = {
    ...basePost,
    id: 'post-self-user',
    user_id: viewerUserId,
    caption: 'My personal look' as string | null,
    alt_text: 'Wool coat and boots' as string | null,
    image_object_path: 'community/post-self-user/bbb.jpg' as string | null,
    status: 'pending_review' as const,
    created_at: new Date('2026-09-05T11:30:00.000Z'),
    updated_at: new Date('2026-09-05T11:30:00.000Z'),
    published_at: null,
  }

  const mockChallenge = {
    id: 'challenge-100',
    slug: 'autumn-layers-2026',
    climate_band: 'temperate_dry' as ClimateBand | null,
    starts_at: new Date('2026-09-01T00:00:00.000Z'),
    ends_at: new Date('2026-09-08T00:00:00.000Z'),
    time_zone: 'Europe/Istanbul',
    is_active: true,
    copy: {
      'en-US': {
        title: 'Autumn Layers Challenge',
        body: 'Share your seasonal transitions.',
      },
      'fr-FR': {
        title: 'Defi Superpositions Automnales',
        body: 'Partagez vos tenues de saison.',
      },
    },
    created_at: new Date('2026-09-01T00:00:00.000Z'),
    updated_at: new Date('2026-09-01T00:00:00.000Z'),
  }

  const createService = (
    options: {
      flagEnabled?: boolean
      locations?: (typeof mockLocation)[]
      weatherStatus?: 'fresh' | 'cached' | 'stale' | 'unavailable'
      dailySummaries?: unknown
      posts?: (typeof publishedPost)[]
      authorPosts?: (typeof ownPendingPost)[]
      nextCursor?: string | null
      challenge?: (Omit<typeof mockChallenge, 'copy'> & { copy: unknown }) | null
    } = {}
  ) => {
    const {
      flagEnabled = true,
      locations = [mockLocation],
      weatherStatus = 'fresh',
      dailySummaries = mockDailySummaries,
      posts = [publishedPost],
      authorPosts = [ownPendingPost],
      nextCursor = 'cursor-next-123',
      challenge = mockChallenge,
    } = options

    const getFeatureFlag = vi.fn().mockResolvedValue(flagEnabled)
    const featureFlagsService = { getFeatureFlag } as unknown as FeatureFlagsService

    const findViewerLocations = vi.fn().mockResolvedValue(locations)
    const findPublishedFeedPosts = vi.fn().mockResolvedValue({ posts, nextCursor })
    const findAuthorPostStates = vi.fn().mockResolvedValue(authorPosts)
    const findActiveChallenge = vi.fn().mockResolvedValue(challenge)
    const findPostByIdempotencyKey = vi.fn().mockResolvedValue(null)
    const createPostDraft = vi
      .fn()
      .mockImplementation((data) =>
        Promise.resolve({ ...data, created_at: new Date(), updated_at: new Date() })
      )
    const findPostById = vi.fn().mockResolvedValue(null)
    const updatePost = vi.fn().mockResolvedValue(ownPendingPost)
    const publishWithinQuota = vi.fn().mockImplementation(
      ({
        postId,
        data,
      }: {
        postId: string
        data: {
          altText: string
          caption: string | null
          climateBand: string | null
          locale: string
          challengeId: string | null
        }
      }) =>
        Promise.resolve({
          kind: 'published',
          post: {
            ...ownPendingPost,
            id: postId,
            alt_text: data.altText,
            caption: data.caption,
            climate_band: data.climateBand,
            locale: data.locale,
            challenge_id: data.challengeId,
            image_object_path: `community/${postId}/session-abc.jpg`,
          },
        })
    )
    const recordReport = vi.fn().mockResolvedValue({ kind: 'created' })
    const findChallengeById = vi.fn().mockResolvedValue(mockChallenge)
    const resolveAlias = vi.fn().mockResolvedValue('Style Explorer AABBCCDD')
    const resolveAliases = vi
      .fn()
      .mockImplementation((userIds: string[]) =>
        Promise.resolve(new Map(userIds.map((id) => [id, `Style Explorer ALIAS-${id}`])))
      )
    const createChallengeWithoutOverlap = vi.fn().mockImplementation((_b, _s, _e, data) =>
      Promise.resolve({
        kind: 'created',
        challenge: {
          ...mockChallenge,
          id: 'chal-1',
          ...data,
          created_at: new Date('2026-09-01T00:00:00.000Z'),
          updated_at: new Date('2026-09-01T00:00:00.000Z'),
        },
      })
    )
    // Prisma ignores `undefined` fields on an update; the double has to as
    // well, or a partial update would blank the columns it did not touch.
    const definedOnly = (data: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))

    const updateChallengeWithoutOverlap = vi
      .fn()
      .mockImplementation((id, _b, _s, _e, data: Record<string, unknown>) =>
        Promise.resolve({
          kind: 'updated',
          challenge: {
            ...mockChallenge,
            id,
            ...definedOnly(data),
            created_at: new Date('2026-09-01T00:00:00.000Z'),
            updated_at: new Date('2026-09-01T00:00:00.000Z'),
          },
        })
      )

    const repository = {
      findViewerLocations,
      findPublishedFeedPosts,
      findAuthorPostStates,
      findActiveChallenge,
      findPostByIdempotencyKey,
      createPostDraft,
      findPostById,
      updatePost,
      publishWithinQuota,
      recordReport,
      findChallengeById,
      resolveAlias,
      resolveAliases,
      createChallengeWithoutOverlap,
      updateChallengeWithoutOverlap,
    } as unknown as CommunityRepository

    const getLatestWeather = vi.fn().mockResolvedValue({
      status: weatherStatus,
      data: weatherStatus !== 'unavailable' ? { daily_summaries: dailySummaries } : null,
    })
    const weatherQueryService = { getLatestWeather } as unknown as WeatherQueryService

    const telemetryFailures: { eventType: string; error: unknown }[] = []
    const captureEvent = vi
      .fn()
      .mockImplementation((_userId: string, eventType: string, properties: unknown) => {
        try {
          TELEMETRY_VALIDATORS[eventType]?.parse(properties)
        } catch (error) {
          telemetryFailures.push({ eventType, error })
          return Promise.reject(error instanceof Error ? error : new Error('invalid'))
        }
        return Promise.resolve(undefined)
      })
    const telemetryService = { captureEvent } as unknown as TelemetryService

    const signReadUrls = vi
      .fn()
      .mockImplementation((paths: string[]) =>
        Promise.resolve(
          new Map(paths.map((path) => [path, `https://signed.local/${path}`]))
        )
      )
    const createUploadSession = vi.fn().mockResolvedValue({
      uploadUrl: 'https://storage.local/upload/url',
      uploadToken: 'upload-token-123',
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    })
    const storage = {
      signReadUrl: vi.fn(),
      signReadUrls,
      createUploadSession,
    } as unknown as CommunityStorage

    const assertWardrobeUploadAllowed = vi.fn().mockResolvedValue(undefined)
    const guardianService = { assertWardrobeUploadAllowed } as unknown as GuardianService

    const service = new CommunityService(
      repository,
      featureFlagsService,
      weatherQueryService,
      telemetryService,
      storage,
      guardianService
    )

    return {
      service,
      getFeatureFlag,
      findViewerLocations,
      getLatestWeather,
      findPublishedFeedPosts,
      findAuthorPostStates,
      findActiveChallenge,
      findPostByIdempotencyKey,
      createPostDraft,
      findPostById,
      updatePost,
      publishWithinQuota,
      recordReport,
      findChallengeById,
      resolveAlias,
      resolveAliases,
      createChallengeWithoutOverlap,
      updateChallengeWithoutOverlap,
      signReadUrls,
      createUploadSession,
      assertWardrobeUploadAllowed,
      captureEvent,
      telemetryFailures,
    }
  }

  describe('rollout gates', () => {
    it('gates the feed on community_read_enabled', async () => {
      const { service, getFeatureFlag, findViewerLocations } = createService({
        flagEnabled: false,
      })

      await expect(
        service.getFeed({ userId: viewerUserId, platform: 'web' })
      ).rejects.toThrow(ServiceUnavailableException)

      expect(getFeatureFlag).toHaveBeenCalledWith('community_read_enabled', viewerUserId)
      expect(findViewerLocations).not.toHaveBeenCalled()
    })

    it('gates writes on community_write_enabled, separately from reads', async () => {
      // Read and write roll out separately: viewers can browse the beta before
      // anyone can post into it.
      const { service, getFeatureFlag } = createService({ flagEnabled: false })

      await expect(
        service.withdrawPost({ userId: viewerUserId, postId: 'p', platform: 'web' })
      ).rejects.toThrow(ServiceUnavailableException)

      expect(getFeatureFlag).toHaveBeenCalledWith('community_write_enabled', viewerUserId)
    })
  })

  describe('cursor decoding and validation', () => {
    it('throws BadRequestException (400) when the cursor is malformed', async () => {
      const { service } = createService()

      await expect(
        service.getFeed({
          userId: viewerUserId,
          platform: 'web',
          cursor: 'not-a-valid-cursor',
        })
      ).rejects.toThrow(COMMUNITY_CURSOR_INVALID_MESSAGE)
    })

    it('decodes a valid cursor and passes the decoded payload to the repository', async () => {
      const { service, findPublishedFeedPosts } = createService()
      const cursorPayload = {
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-sample-1',
        mode: 'auto' as const,
      }

      await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        mode: 'auto',
        cursor: encodeCommunityFeedCursor(cursorPayload),
      })

      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: cursorPayload, mode: 'auto' })
      )
    })

    it('rejects a cursor minted under a different filter mode', async () => {
      // Paging one feed with another feed's keyset would silently skip or repeat
      // posts, so a changed filter restarts paging instead.
      const { service } = createService()
      const otherModeCursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-sample-1',
        mode: 'cold_wet',
      })

      await expect(
        service.getFeed({
          userId: viewerUserId,
          platform: 'web',
          mode: 'auto',
          cursor: otherModeCursor,
        })
      ).rejects.toThrow(COMMUNITY_CURSOR_INVALID_MESSAGE)
    })

    it('accepts a well-formed cursor that points past the end of the feed', async () => {
      const { service, findPublishedFeedPosts } = createService({
        posts: [],
        authorPosts: [],
        nextCursor: null,
      })
      const staleCursor = encodeCommunityFeedCursor({
        publishedAt: '2020-01-01T00:00:00.000Z',
        id: 'post-long-gone',
        mode: 'auto',
      })

      const result = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        cursor: staleCursor,
      })

      expect(result.items).toEqual([])
      expect(result.nextCursor).toBeNull()
      expect(findPublishedFeedPosts).toHaveBeenCalled()
    })
  })

  describe('viewer climate band resolution and unresolved reasons', () => {
    it('resolves the band from the first location with usable weather', async () => {
      const { service } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.bandResolved).toBe(true)
      expect(result.viewerBand).toBe('temperate_dry')
      expect(result.bandUnresolvedReason).toBeNull()
    })

    it('walks to the next saved location when the first has no usable weather', async () => {
      const { service, getLatestWeather } = createService({
        locations: [mockLocation, secondaryLocation],
      })
      getLatestWeather.mockResolvedValueOnce({ status: 'stale', data: null })

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(getLatestWeather).toHaveBeenNthCalledWith(1, 'new-york-ny')
      expect(getLatestWeather).toHaveBeenNthCalledWith(2, 'lisbon-pt')
      expect(result.bandResolved).toBe(true)
    })

    it.each([
      ['no saved locations', { locations: [] }, 'no_location'],
      ['stale weather', { weatherStatus: 'stale' as const }, 'weather_stale'],
      [
        'unavailable weather',
        { weatherStatus: 'unavailable' as const },
        'weather_unavailable',
      ],
      ['an empty forecast', { dailySummaries: [] }, 'weather_malformed'],
      [
        'fewer than three usable days',
        { dailySummaries: [mockDailySummaries[0]] },
        'insufficient_usable_days',
      ],
    ])(
      'reports %s as bandUnresolvedReason %s',
      async (_label, options, expectedReason) => {
        // Clients render their localized banner from this, so it is populated
        // honestly rather than defaulted.
        const { service } = createService(options)
        const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

        expect(result.bandResolved).toBe(false)
        expect(result.viewerBand).toBeNull()
        expect(result.bandUnresolvedReason).toBe(expectedReason)
      }
    )
  })

  describe('filter modes', () => {
    it('pins the feed to a named band', async () => {
      const { service, findPublishedFeedPosts } = createService()
      const result = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        mode: 'cold_wet',
      })

      expect(result.viewerBand).toBe('temperate_dry')
      expect(result.mode).toBe('cold_wet')
      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: 'cold_wet' })
      )
    })

    it('returns every region for mode all', async () => {
      // `all` is a real requestable mode, not a fallback: the beta experiment
      // assigns half the viewers to it and both arms have to be requestable.
      const { service, findPublishedFeedPosts } = createService()
      await service.getFeed({ userId: viewerUserId, platform: 'web', mode: 'all' })

      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: undefined })
      )
    })

    it('follows the viewer band under mode auto', async () => {
      const { service, findPublishedFeedPosts } = createService()
      await service.getFeed({ userId: viewerUserId, platform: 'web', mode: 'auto' })

      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: 'temperate_dry' })
      )
    })

    it('falls back to every region under auto when the band is unresolved', async () => {
      const { service, findPublishedFeedPosts } = createService({ locations: [] })
      await service.getFeed({ userId: viewerUserId, platform: 'web', mode: 'auto' })

      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: undefined })
      )
    })
  })

  describe('public items and author states', () => {
    it('keeps the author own non-published posts out of items', async () => {
      const { service } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items.map((item) => item.id)).toEqual(['post-other-user'])
      expect(result.authorStates.map((state) => state.id)).toEqual(['post-self-user'])
    })

    it('carries moderationReason on author states so a recovery state is visible', async () => {
      const { service } = createService({
        authorPosts: [
          {
            ...ownPendingPost,
            status: 'flagged' as never,
            moderation_reason: 'screening_unavailable',
          },
        ],
      })

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })
      expect(result.authorStates[0]?.moderationReason).toBe('screening_unavailable')
    })

    it('renders an author state with no signable object as a null imageAccess', async () => {
      // The public projection has no way to say "this post is here but its media
      // is gone"; the author's own section does, and that is where the localized
      // removed-content notice comes from.
      const { service, signReadUrls } = createService()
      signReadUrls.mockResolvedValue(new Map())

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items).toEqual([])
      expect(result.authorStates[0]?.imageAccess).toBeNull()
    })

    it('produces a whole feed the response schema accepts', async () => {
      const { service } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(() => communityFeedSchema.parse(result)).not.toThrow()
      for (const item of result.items) {
        expect(() => communityFeedItemSchema.parse(item)).not.toThrow()
      }
    })
  })

  describe('author pseudonym and privacy constraints', () => {
    it('serves the persisted alias and never the raw user id', async () => {
      const { service, resolveAliases } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      const otherPost = result.items[0]!
      expect(resolveAliases).toHaveBeenCalledWith(
        ['user-author-999'],
        expect.any(Function)
      )
      expect(otherPost.author.isSelf).toBe(false)
      expect(otherPost.author.displayName).toBe('Style Explorer ALIAS-user-author-999')
      expect(otherPost.id).not.toContain('user-author-999')
      expect(JSON.stringify(otherPost.imageAccess)).not.toContain('user-author-999')
      expect(JSON.stringify(otherPost)).not.toContain('new-york-ny')
    })

    it('keeps the raw user id out of the object path and the signed URL', async () => {
      const { service } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      for (const item of result.items) {
        expect(item.imageAccess.url).not.toContain('user-author-999')
        expect(item.imageAccess.url).not.toContain(viewerUserId)
      }
    })

    it('labels the viewer own post You', async () => {
      const { service } = createService({
        posts: [{ ...publishedPost, user_id: viewerUserId }],
      })
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items[0]?.author).toEqual({ displayName: 'You', isSelf: true })
    })
  })

  describe('signed image URLs', () => {
    it('signs each section in one call with a matching expiresAt', async () => {
      const { service, signReadUrls } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      // Two calls, one per section, rather than one per item: the old shape cost
      // up to thirty storage round trips for a single page.
      expect(signReadUrls).toHaveBeenCalledTimes(2)
      expect(signReadUrls).toHaveBeenCalledWith(
        ['community/post-other-user/aaa.jpg'],
        900
      )

      const expiryDate = new Date(result.items[0]!.imageAccess.expiresAt)
      expect(expiryDate.getTime()).toBeGreaterThan(Date.now() + 890 * 1000)
      expect(expiryDate.getTime()).toBeLessThanOrEqual(Date.now() + 910 * 1000)
    })
  })

  describe('active challenge resolution', () => {
    it('resolves localized copy for the requested language', async () => {
      const { service, findActiveChallenge } = createService()
      const result = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        acceptLanguage: 'fr-FR',
      })

      expect(findActiveChallenge).toHaveBeenCalledWith('temperate_dry')
      expect(result.activeChallenge).toEqual({
        id: 'challenge-100',
        slug: 'autumn-layers-2026',
        climateBand: 'temperate_dry',
        title: 'Defi Superpositions Automnales',
        body: 'Partagez vos tenues de saison.',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-08T00:00:00.000Z',
        timeZone: 'Europe/Istanbul',
      })
    })

    it('falls back to en-US copy when the requested language has no translation', async () => {
      const { service } = createService()
      const result = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        acceptLanguage: 'ja-JP',
      })

      expect(result.activeChallenge?.title).toBe('Autumn Layers Challenge')
    })

    it('serves the default locale copy when no Accept-Language header is sent', async () => {
      const { service } = createService()
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.activeChallenge?.title).toBe('Autumn Layers Challenge')
    })

    it('returns activeChallenge: null when there is no active challenge', async () => {
      const { service } = createService({ challenge: null })
      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.activeChallenge).toBeNull()
    })

    it('drops a malformed challenge to null instead of failing the whole feed', async () => {
      // An empty body fails `embeddedCommunityChallengeSchema`, which used to
      // surface as a 500 on every feed request for every viewer.
      const { service } = createService({
        challenge: { ...mockChallenge, copy: { 'en-US': { title: 'Broken', body: '' } } },
      })

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.activeChallenge).toBeNull()
      expect(result.items.length).toBe(1)
    })
  })

  describe('feed telemetry', () => {
    it('emits a payload the real closed-enum validator accepts', async () => {
      const { service, captureEvent, telemetryFailures } = createService()
      await service.getFeed({ userId: viewerUserId, platform: 'mobile' })

      expect(telemetryFailures).toEqual([])
      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_feed_viewed',
        expect.objectContaining({
          platform: 'mobile',
          climateBand: 'temperate_dry',
          bandResolved: true,
          filterMode: 'auto',
          itemCount: 1,
          isEmpty: false,
          dedupeKey: expect.any(String),
          experimentVariant: expect.stringMatching(/^(auto|all)$/),
        })
      )
    })

    it('reports the VIEWER band, never the requested filter', async () => {
      // Reporting the filter would make the unresolved-band guardrail
      // unmeasurable: an unresolved viewer browsing a pinned band would look
      // resolved.
      const { service, captureEvent } = createService({ locations: [] })
      await service.getFeed({ userId: viewerUserId, platform: 'web', mode: 'cold_wet' })

      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_feed_viewed',
        expect.objectContaining({
          climateBand: null,
          bandResolved: false,
          filterMode: 'cold_wet',
        })
      )
    })

    it('never puts the raw user id in the dedupe key', async () => {
      const { service, captureEvent } = createService()
      await service.getFeed({ userId: viewerUserId, platform: 'web' })

      const props = captureEvent.mock.calls[0]![2] as { dedupeKey: string }
      expect(props.dedupeKey).not.toContain(viewerUserId)
    })

    it('assigns a stable experiment variant', async () => {
      const { service } = createService()
      const first = await service.getFeed({ userId: viewerUserId, platform: 'web' })
      const second = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(first.experimentVariant).toBe(second.experimentVariant)
    })

    it('fails open when telemetry capture fails', async () => {
      const { service, captureEvent } = createService()
      captureEvent.mockRejectedValueOnce(new Error('Telemetry service offline'))

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items.length).toBe(1)
    })
  })

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
  })

  describe('recordCardOpened', () => {
    it('emits the card-open event the beta gate is measured on', async () => {
      const { service, findPostById, captureEvent, telemetryFailures } = createService()
      findPostById.mockResolvedValueOnce(publishedPost)

      await service.recordCardOpened({
        userId: viewerUserId,
        postId: 'post-other-user',
        platform: 'web',
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
      })

      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_card_opened',
        expect.objectContaining({ isSelf: true })
      )
    })

    it('rejects a card-open on a post that is not published', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce(ownPendingPost)

      await expect(
        service.recordCardOpened({
          userId: viewerUserId,
          postId: 'post-self-user',
          platform: 'web',
        })
      ).rejects.toThrow(NotFoundException)
    })
  })

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
    const draftPost = {
      ...ownPendingPost,
      id: 'post-draft-1',
      status: 'draft' as const,
      alt_text: null,
      caption: null,
      image_object_path: 'community/post-draft-1/session-abc.jpg',
      upload_expires_at: new Date(Date.now() + 600_000),
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

    it('throws ConflictException when the upload window has already closed', async () => {
      const { service, findPostById } = createService()
      findPostById.mockResolvedValueOnce({
        ...draftPost,
        upload_expires_at: new Date(Date.now() - 1000),
      })

      await expect(publish(service)).rejects.toThrow(ConflictException)
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
        },
      })
      expect(feedItem.id).toBe('post-draft-1')
      expect(feedItem.author.isSelf).toBe(true)
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
      const { service, findPostById, updatePost, captureEvent, telemetryFailures } =
        createService()
      findPostById.mockResolvedValueOnce({ ...publishedPost, user_id: viewerUserId })

      await expect(withdraw(service)).resolves.toEqual({ tracked: true })

      expect(updatePost).toHaveBeenCalledWith('post-mine', { status: 'withdrawn' })
      expect(telemetryFailures).toEqual([])
      expect(captureEvent).toHaveBeenCalledWith(
        viewerUserId,
        'community_post_withdrawn',
        expect.objectContaining({ climateBand: 'temperate_dry' })
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

    it('falls back to a minted alias when the lookup returns nothing for an author', async () => {
      // Defensive: `resolveAliases` fills every gap itself, so an absent entry
      // means the alias table and the feed query disagreed. The viewer still
      // gets a pseudonym rather than a crash or a raw id.
      const { service, resolveAliases } = createService()
      resolveAliases.mockResolvedValueOnce(new Map())

      const result = await service.getFeed({ userId: viewerUserId, platform: 'web' })

      expect(result.items[0]?.author.displayName).toMatch(/^Style Explorer [0-9A-F]{8}$/)
      expect(result.items[0]?.author.displayName).not.toContain('user-author-999')
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
    const draftPost = {
      ...ownPendingPost,
      id: 'post-draft-1',
      status: 'draft' as const,
      alt_text: null,
      caption: null,
      image_object_path: 'community/post-draft-1/session-abc.jpg' as string | null,
      upload_expires_at: new Date(Date.now() + 600_000),
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
  describe('beta experiment assignment binds to what is served', () => {
    // Stable, derived from the user id: `viewer-all` hashes into the `all` arm
    // and `user-viewer-1` into the `auto` arm. Pinned here so the intent of each
    // test is readable without recomputing a digest.
    const allArmViewer = 'viewer-all'

    it('serves the all-region feed to an all-arm viewer who requested auto', async () => {
      // THE DEFECT THIS COVERS: the variant used to be computed after the query
      // and read only by telemetry and the response, so both arms were served
      // whatever the client asked for. A lift measured between two arms that
      // receive the identical feed is noise, which made the story's own advance
      // condition unmeasurable at any traffic volume.
      const { service, findPublishedFeedPosts } = createService()

      const result = await service.getFeed({
        userId: allArmViewer,
        platform: 'web',
        mode: 'auto',
      })

      expect(result.experimentVariant).toBe('all')
      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: undefined, mode: 'all' })
      )
    })

    it('reports the mode SERVED, not the mode requested', async () => {
      // Without this the two arms are indistinguishable in the data even once
      // they are served differently.
      const { service, captureEvent } = createService()

      const result = await service.getFeed({
        userId: allArmViewer,
        platform: 'web',
        mode: 'auto',
      })

      expect(result.mode).toBe('all')
      expect(captureEvent).toHaveBeenCalledWith(
        allArmViewer,
        'community_feed_viewed',
        expect.objectContaining({ filterMode: 'all', experimentVariant: 'all' })
      )
    })

    it('serves band resolution to an auto-arm viewer who requested auto', async () => {
      const { service, findPublishedFeedPosts } = createService()

      const result = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        mode: 'auto',
      })

      expect(result.experimentVariant).toBe('auto')
      expect(result.mode).toBe('auto')
      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: 'temperate_dry', mode: 'auto' })
      )
    })

    it('lets an explicit band request win over the assignment', async () => {
      // A band chip is a user action. An assignment that silently overrode it
      // would mean the filter did not work for half the population, which is a
      // worse defect than an unmeasurable experiment.
      const { service, findPublishedFeedPosts } = createService()

      const result = await service.getFeed({
        userId: allArmViewer,
        platform: 'web',
        mode: 'cold_wet',
      })

      expect(result.mode).toBe('cold_wet')
      expect(result.experimentVariant).toBe('all')
      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: 'cold_wet', mode: 'cold_wet' })
      )
    })

    it('lets an explicit all request stand for an auto-arm viewer', async () => {
      const { service, findPublishedFeedPosts } = createService()

      const result = await service.getFeed({
        userId: viewerUserId,
        platform: 'web',
        mode: 'all',
      })

      expect(result.mode).toBe('all')
      expect(result.experimentVariant).toBe('auto')
      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({ filterBand: undefined })
      )
    })

    it('accepts a page-two cursor minted under the effective mode', async () => {
      // The client re-sends `auto`; the cursor it was handed says `all`. The
      // assignment is stable, so the server resolves `auto` to `all` again and
      // the keyset matches. Binding the cursor to the REQUESTED mode would 400
      // every second page for half the population.
      const { service, findPublishedFeedPosts } = createService()
      const pageTwo = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-other-user',
        mode: 'all',
      })

      await service.getFeed({
        userId: allArmViewer,
        platform: 'web',
        mode: 'auto',
        cursor: pageTwo,
      })

      expect(findPublishedFeedPosts).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: expect.objectContaining({ mode: 'all' }) as unknown,
        })
      )
    })

    it('rejects a cursor minted under a mode the viewer is not being served', async () => {
      const { service } = createService()
      const foreignCursor = encodeCommunityFeedCursor({
        publishedAt: '2026-09-05T12:00:00.000Z',
        id: 'post-other-user',
        mode: 'cold_wet',
      })

      await expect(
        service.getFeed({
          userId: allArmViewer,
          platform: 'web',
          mode: 'auto',
          cursor: foreignCursor,
        })
      ).rejects.toThrow(COMMUNITY_CURSOR_INVALID_MESSAGE)
    })
  })
})

// Learning path Step 38: Community feed by climate band.
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- assertions nest expect.objectContaining() and vi.fn() members, which is the established pattern for these suites. */
import type { Prisma } from '@prisma/client'
import { afterEach, vi } from 'vitest'
import {
  communityCardOpenedEventSchema,
  communityFeedViewedEventSchema,
  communityPostAllocatedEventSchema,
  communityPostReportedEventSchema,
  communityPostSubmittedEventSchema,
  communityPostWithdrawnEventSchema,
} from '@couture/api-client'
import {
  type ClimateBand,
  type CommunityReactionSummary,
} from '@couture/api-client/contracts/http'
import type { FeatureFlagsService } from '../../modules/feature-flags/feature-flags.service'
import type { GuardianService } from '../../modules/guardian/guardian.service'
import type { TelemetryService } from '../../modules/telemetry/telemetry.service'
import type { WeatherQueryService } from '../../modules/weather/weather-query.service'
import { type CommunityRepository } from '../../modules/community/community.repository'
import type { CommunityStorage } from '../../modules/community/community-storage.adapter'
import { CommunityService } from '../../modules/community/community.service'

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
export const TELEMETRY_VALIDATORS: Record<
  string,
  { parse: (value: unknown) => unknown }
> = {
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

export const SERVICE_REFERENCE_TIME = new Date('2026-09-05T12:00:00.000Z')
export const viewerUserId = 'user-viewer-1'

export const mockLocation = {
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

export const secondaryLocation = {
  ...mockLocation,
  id: 'loc-2',
  location_key: 'lisbon-pt',
  is_primary: false,
}

export const mockDailySummaries = [
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

export const basePost = {
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

export const publishedPost = {
  ...basePost,
  id: 'post-other-user',
  user_id: 'user-author-999',
  image_object_path: 'community/post-other-user/aaa.jpg' as string | null,
  status: 'published' as const,
  created_at: new Date('2026-09-05T12:00:00.000Z'),
  updated_at: new Date('2026-09-05T12:00:00.000Z'),
  published_at: new Date('2026-09-05T12:00:00.000Z') as Date | null,
}

export const ownPendingPost = {
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

export const mockChallenge = {
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

export const createService = (
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
  const featureFlagsService = {
    getFeatureFlag,
    communityReadEvaluation: async (member: string) => ({
      value: await getFeatureFlag('community_read_enabled', member),
      expiresAt: new Date(Date.now() + 60000),
      validUntil: performance.now() + 60000,
    }),
  } as unknown as FeatureFlagsService

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
  const withdrawPostAndRequestErasure = vi.fn().mockResolvedValue(undefined)
  const requestErasureForUser = vi.fn().mockResolvedValue(2)
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

  const reactionSummary: CommunityReactionSummary = {
    counts: { applause: 1, love: 0, inspiration: 0 },
    total: 1,
    viewerReaction: 'applause',
    revision: 1,
    generation: 1,
  }
  const setReaction = vi
    .fn<CommunityRepository['setReaction']>()
    .mockImplementation(async ({ assertEligible }) => {
      const tx = {} as Prisma.TransactionClient
      await assertEligible(tx, false)
      await assertEligible(tx, true)
      return { summary: reactionSummary }
    })
  const reactionSummaries = vi.fn().mockResolvedValue(new Map())
  const repository = {
    assertReadEligibility: vi.fn().mockResolvedValue(undefined),
    assertSubjectAvailable: vi.fn().mockResolvedValue(undefined),
    setReaction,
    reactionSummaries,
    findViewerLocations,
    findPublishedFeedPosts,
    findAuthorPostStates,
    findActiveChallenge,
    findPostByIdempotencyKey,
    createPostDraft,
    findPostById,
    updatePost,
    withdrawPostAndRequestErasure,
    requestErasureForUser,
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
    expiresAt: new Date(SERVICE_REFERENCE_TIME.getTime() + 900_000).toISOString(),
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
    setReaction,
    reactionSummaries,
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
    withdrawPostAndRequestErasure,
    requestErasureForUser,
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
export const registerCommunityServiceLifecycle = () => {
  afterEach(() => {
    vi.useRealTimers()
  })
}

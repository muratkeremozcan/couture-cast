// Learning path Step 38: Community feed by climate band.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-38-community-feed-by-climate-band
import type { CommunityService } from '../../../../apps/api/src/modules/community/community.service'
import type { CommunitySpotlightService } from '../../../../apps/api/src/modules/community/community-spotlight.service'
import { CommunityRateLimitException } from '../../../../apps/api/src/modules/community/community-rate-limit.exception'
import { decodeSpotlightCursor } from '../../../../apps/api/src/modules/community/community-spotlight-cursor'
import {
  COMMUNITY_REACTION_CONFLICT_MESSAGE,
  COMMUNITY_REACTION_RATE_LIMITED_MESSAGE,
  COMMUNITY_CHALLENGE_OVERLAP_MESSAGE,
  COMMUNITY_CONSENT_SUSPENDED_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE,
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
  COMMUNITY_POST_RATE_LIMITED_MESSAGE,
  COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE,
  communityServedSpotlightLevelSchema,
  communitySpotlightOpenSurfaceSchema,
  communitySpotlightSurfaceSchema,
  encodeCommunityFeedCursor,
  safeDecodeCommunityFeedCursor,
  type ClimateBand,
  type CommunityFeedMode,
  type SetCommunityReactionInput,
  type AllocateCommunityPostInput,
  type AllocateCommunityPostSession,
  type CommunityFeed,
  type CommunityFeedItem,
  type CommunitySpotlight,
  type CommunityReactionSpotlight,
} from '@couture/api-client/contracts/http'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { getProviderCommunityState } from '../state'

/**
 * Provider double for the community surface (Story 6.1).
 *
 * Shape follows `doubles/planner.ts`. The double sits at the whole service, so
 * the weather, storage, moderation-queue and guardian collaborators it composes
 * are covered by one seam, and the real guards stay un-mocked so their
 * rejections are the real ones. `RolesGuard` on the two challenge routes is the
 * case that matters here. It is why `doubles/identity.ts` resolves a third,
 * admin token; a hand-written 403 would prove nothing about the guard.
 *
 * TWO OUTCOMES ARE NOT MODELLED HERE ON PURPOSE. An unknown feed `mode` and an
 * invalid challenge window are both rejected by Zod inside
 * `CommunityController` before this double is reached, so a scenario for either
 * would imply a service code path that does not exist.
 *
 * THE ALLOCATE REPLAY AND THE ALLOCATE MISMATCH SHARE ONE SCENARIO. They share
 * one world state, a session already recorded against the key, and differ only
 * in the payload presented against it. The double therefore compares the
 * incoming `sha256` with the recorded one. Deciding it from the payload is what
 * makes this a test of idempotency; two provider states would only test the
 * state handler.
 *
 * Every identifier, date and message below is mirrored in
 * `pact/http/consumer/interactions/community.ts`. Both sides must agree or the
 * pinned `string()` matchers fail verification.
 */

const PUBLISHED_POST_ID = 'post-6100-published-0001'
const AUTHOR_PENDING_POST_ID = 'post-6100-pending-0002'
const WITHDRAWN_POST_ID = 'post-6100-withdrawn-0003'
const CONSENT_SUSPENDED_POST_ID = 'post-6100-suspended-0004'

const CHALLENGE_ID = 'challenge-6100-0001'
const UPLOAD_SESSION_ID = 'upload-session-6100-0001'

const PUBLISHED_AT = '2026-09-01T12:00:00.000Z'
const CREATED_AT = '2026-09-01T11:30:00.000Z'
const IMAGE_EXPIRES_AT = '2026-09-01T13:00:00.000Z'
const UPLOAD_EXPIRES_AT = '2026-09-01T11:45:00.000Z'
const IMAGE_URL =
  'https://storage.couturecast.test/community/posts/6100/published-0001.jpg'
const UPLOAD_URL = 'https://storage.couturecast.test/community/uploads/6100/session-0001'

const VIEWER_BAND = 'temperate_dry' as const

/** Story 6.6, mirrored from `interactions/community/spotlight.ts`. */
const SPOTLIGHT_LABEL = 'Lisbon'
const SPOTLIGHT_NEXT_CURSOR = 'spotlight-cursor-6600-page-two'
const SPOTLIGHT_PAGE_TWO_RANK = 7
const LOCALE = 'en-US'

/**
 * Sunday in UTC, Monday in `Pacific/Auckland`. Mirrors the consumer fixture,
 * which picks instants where UTC and the named zone disagree so the window rule
 * cannot be satisfied by UTC arithmetic.
 */
const CHALLENGE_STARTS_AT = '2026-09-06T12:00:00.000Z'
const CHALLENGE_ENDS_AT = '2026-09-13T12:00:00.000Z'
const CHALLENGE_TIME_ZONE = 'Pacific/Auckland'
const CHALLENGE_SLUG = 'layered-mondays'

const CHALLENGE_COPY = {
  'en-US': {
    title: 'Layered Mondays',
    body: 'Show the layers that got you through a temperate, dry week.',
  },
}

const CAPTION = 'Three layers and a windproof shell.'
const ALT_TEXT = 'A person in a grey wool coat over a cream knit.'
const AUTHOR_DISPLAY_NAME = 'Cobalt Marten'

/** The bytes the recorded allocation was made for. A different digest under the
 * same key is the mismatch the contract answers with 409. */
const RECORDED_SHA256 = 'd2c8a3f16b0e47a95c3d81f0b6e27a4c9d5e0f3a1b7c8d9e0f1a2b3c4d5e6f70'

const AUTO_MODE_CURSOR = encodeCommunityFeedCursor({
  publishedAt: PUBLISHED_AT,
  id: PUBLISHED_POST_ID,
  mode: 'auto',
  band: VIEWER_BAND,
})

function buildPublishedItem(): CommunityFeedItem {
  return {
    id: PUBLISHED_POST_ID,
    caption: CAPTION,
    altText: ALT_TEXT,
    climateBand: VIEWER_BAND,
    imageAccess: { url: IMAGE_URL, expiresAt: IMAGE_EXPIRES_AT },
    publishedAt: PUBLISHED_AT,
    createdAt: CREATED_AT,
    status: 'published',
    challengeId: CHALLENGE_ID,
    author: { displayName: AUTHOR_DISPLAY_NAME, isSelf: false },
  }
}

function buildResolvedFeed(): CommunityFeed {
  return {
    items: [buildPublishedItem()],
    authorStates: [
      {
        id: AUTHOR_PENDING_POST_ID,
        caption: 'Waiting on screening.',
        altText: 'A person in a red rain shell.',
        climateBand: null,
        imageAccess: { url: IMAGE_URL, expiresAt: IMAGE_EXPIRES_AT },
        createdAt: CREATED_AT,
        publishedAt: null,
        status: 'pending_review',
        challengeId: null,
        moderationReason: null,
      },
    ],
    nextCursor: AUTO_MODE_CURSOR,
    mode: 'auto',
    viewerBand: VIEWER_BAND,
    bandResolved: true,
    bandUnresolvedReason: null,
    experimentVariant: 'auto',
    activeChallenge: {
      id: CHALLENGE_ID,
      slug: CHALLENGE_SLUG,
      climateBand: VIEWER_BAND,
      title: CHALLENGE_COPY['en-US'].title,
      body: CHALLENGE_COPY['en-US'].body,
      startsAt: CHALLENGE_STARTS_AT,
      endsAt: CHALLENGE_ENDS_AT,
      timeZone: CHALLENGE_TIME_ZONE,
    },
  }
}

/**
 * Too few usable weather days to classify a band. An unresolved band degrades
 * the filter and the page still carries content, with the reason stated so the
 * client can explain itself.
 */
function buildBandUnresolvedFeed(): CommunityFeed {
  return {
    items: [buildPublishedItem()],
    authorStates: [],
    nextCursor: null,
    mode: 'all',
    viewerBand: null,
    bandResolved: false,
    bandUnresolvedReason: 'insufficient_usable_days',
    experimentVariant: 'all',
    activeChallenge: null,
  }
}

/**
 * A withdrawn post and a consent-suspended post. Both are gone from `items`,
 * both carry `imageAccess: null` because a takedown moves or deletes the stored
 * object, and the suspended one names the reason the author has to act on.
 */
function buildRemovedContentFeed(): CommunityFeed {
  return {
    items: [],
    authorStates: [
      {
        id: WITHDRAWN_POST_ID,
        caption: null,
        altText: null,
        climateBand: VIEWER_BAND,
        imageAccess: null,
        createdAt: CREATED_AT,
        publishedAt: PUBLISHED_AT,
        status: 'withdrawn',
        challengeId: null,
        moderationReason: null,
      },
      {
        id: CONSENT_SUSPENDED_POST_ID,
        caption: null,
        altText: null,
        climateBand: VIEWER_BAND,
        imageAccess: null,
        createdAt: CREATED_AT,
        publishedAt: PUBLISHED_AT,
        status: 'consent_suspended',
        challengeId: null,
        moderationReason: COMMUNITY_CONSENT_SUSPENDED_MESSAGE,
      },
    ],
    nextCursor: null,
    mode: 'auto',
    viewerBand: VIEWER_BAND,
    bandResolved: true,
    bandUnresolvedReason: null,
    experimentVariant: 'auto',
    activeChallenge: null,
  }
}

function buildUploadSession(): AllocateCommunityPostSession {
  return {
    postId: AUTHOR_PENDING_POST_ID,
    uploadSessionId: UPLOAD_SESSION_ID,
    uploadUrl: UPLOAD_URL,
    uploadToken: 'upload-token-6100-0001',
    requiredHeaders: { 'content-type': 'image/jpeg' },
    expiresAt: UPLOAD_EXPIRES_AT,
    altTextSuggestion: ALT_TEXT,
    altTextSuggestionLocale: LOCALE,
  }
}

/**
 * The post as it comes back from `publishPost`, handed to moderation. `status`
 * is `pending_review` and `publishedAt` is still null, because nothing has
 * screened it yet.
 */
function buildPendingReviewItem(): CommunityFeedItem {
  return {
    id: AUTHOR_PENDING_POST_ID,
    caption: CAPTION,
    altText: ALT_TEXT,
    climateBand: null,
    imageAccess: { url: IMAGE_URL, expiresAt: IMAGE_EXPIRES_AT },
    publishedAt: null,
    createdAt: CREATED_AT,
    status: 'pending_review',
    challengeId: CHALLENGE_ID,
    author: { displayName: AUTHOR_DISPLAY_NAME, isSelf: true },
  }
}

/**
 * `CommunityService.createChallenge` returns a `CommunityChallengeProjection`,
 * already mapped out of the Prisma row by `mapChallenge`, and the controller
 * hands it straight to `communityChallengeResponseSchema.parse`. So this answers
 * in the CONTRACT shape: camelCase keys and ISO strings. A snake_case row here
 * fails that strict parse with seven "Required" issues plus an "Unrecognized
 * key(s)" issue and surfaces as a 500, which is what it did before this was
 * corrected.
 */
function buildChallengeProjection() {
  return {
    id: CHALLENGE_ID,
    slug: CHALLENGE_SLUG,
    climateBand: VIEWER_BAND,
    startsAt: CHALLENGE_STARTS_AT,
    endsAt: CHALLENGE_ENDS_AT,
    timeZone: CHALLENGE_TIME_ZONE,
    copy: CHALLENGE_COPY,
    isActive: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }
}

/**
 * The band `parseCursor` compares a cursor against, mirroring
 * `resolveFilterBand`: `all` filters on no band, `auto` resolves to the viewer's,
 * and a band literal is its own filter. The double's viewer band is
 * `VIEWER_BAND`, matching `buildResolvedFeed`.
 */
function expectedBandFor(mode: CommunityFeedMode): ClimateBand | null {
  if (mode === 'all') return null
  if (mode === 'auto') return VIEWER_BAND
  return mode
}

export function createCommunityDoubles() {
  const scenarioOf = () => getProviderCommunityState()?.scenario ?? 'feed-resolved'

  const currentReactionSummary = () => ({
    counts: { applause: 2, love: 1, inspiration: 3 },
    total: 6,
    viewerReaction: 'applause' as const,
    revision: 3,
    generation: 7,
  })

  const mockCommunityService = {
    setReaction: ({ input }: { input: SetCommunityReactionInput }) => {
      if (scenarioOf() === 'reaction-current') {
        // Mirror repository precedence: a changed receipt payload conflicts even
        // when its base revision matches the current revision.
        const hasReceipt = input.mutationId === '63100000-0000-4000-8000-000000000001'
        const changedReceipt =
          hasReceipt && (input.selection !== 'applause' || input.baseRevision !== 2)
        if (changedReceipt || (!hasReceipt && input.baseRevision !== 3)) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message: COMMUNITY_REACTION_CONFLICT_MESSAGE,
            data: currentReactionSummary(),
          })
        }
        return Promise.resolve(currentReactionSummary())
      }
      if (scenarioOf() === 'reaction-rate-limited') {
        throw new CommunityRateLimitException(COMMUNITY_REACTION_RATE_LIMITED_MESSAGE, 37)
      }
      return Promise.resolve({
        counts: {
          applause: input.selection === 'applause' ? 1 : 0,
          love: input.selection === 'love' ? 1 : 0,
          inspiration: input.selection === 'inspiration' ? 1 : 0,
        },
        total: input.selection === null ? 0 : 1,
        viewerReaction: input.selection,
        revision: input.baseRevision + 1,
        generation: input.baseRevision + 1,
      })
    },
    /*
     * THE CURSOR DECISION IS MADE BY THE REAL CODEC, not by the scenario.
     *
     * This used to be a zero-argument function that rejected unconditionally
     * whenever the state said `feed-cursor-invalid`, and that one state backs all
     * three rows of `communityFeedRejections`. The consequence was that deleting
     * the mode and band comparisons out of `safeDecodeCommunityFeedCursor` left
     * both cursor interactions green: the double was rejecting because it had
     * been told to, so the provider tier was two fixtures agreeing with each
     * other about a property the consumer docblock nominates as observable only
     * on the wire.
     *
     * Now the cursor is decoded with the contract's own function, using the mode
     * the request actually carried, exactly as `parseCursor` does in the real
     * service. A well-formed cursor for this mode is accepted and the feed comes
     * back; a malformed one and one minted under another mode are rejected by the
     * codec rather than by the fixture. `allocatePost` below already decided from
     * its payload for the same reason.
     */
    getFeed: (params: {
      mode?: CommunityFeedMode
      cursor?: string
      reactions?: boolean
    }): Promise<CommunityFeed> => {
      const mode = params.mode ?? 'auto'
      if (params.cursor) {
        const decoded = safeDecodeCommunityFeedCursor(
          params.cursor,
          mode,
          expectedBandFor(mode)
        )
        if (!decoded.success) {
          return Promise.reject(new BadRequestException(decoded.error))
        }
      }

      switch (scenarioOf()) {
        case 'reaction-feed':
          return Promise.resolve({
            ...buildResolvedFeed(),
            items: [
              {
                ...buildPublishedItem(),
                ...(params.reactions ? { reactions: currentReactionSummary() } : {}),
              },
            ],
            authorStates: [],
            nextCursor: null,
            activeChallenge: null,
          })
        case 'feed-band-unresolved':
          return Promise.resolve(buildBandUnresolvedFeed())
        case 'feed-removed-content':
          return Promise.resolve(buildRemovedContentFeed())
        default:
          return Promise.resolve(buildResolvedFeed())
      }
    },

    getPost: (params: { reactions?: boolean }): Promise<CommunityFeedItem> => {
      if (scenarioOf() === 'post-not-found') {
        return Promise.reject(new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE))
      }
      return Promise.resolve({
        ...buildPublishedItem(),
        ...(params.reactions
          ? {
              reactions: {
                counts: { applause: 0, love: 0, inspiration: 0 },
                total: 0,
                viewerReaction: null,
                revision: 0,
                generation: 0,
              },
            }
          : {}),
      })
    },

    /*
     * No rate-limit branch, matching the real service: the daily cap lives in
     * `publishPost` because allocation produces drafts and a draft is free. A
     * 429 modelled here would be a fiction the contract then pinned.
     */
    allocatePost: (params: {
      input: AllocateCommunityPostInput
    }): Promise<AllocateCommunityPostSession> => {
      const scenario = scenarioOf()
      if (scenario === 'allocate-replay' && params.input.sha256 !== RECORDED_SHA256) {
        // Same key, different bytes. The key is a promise about a payload, so
        // serving the first session here would strand the second upload.
        return Promise.reject(
          new ConflictException(COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE)
        )
      }
      return Promise.resolve(buildUploadSession())
    },

    publishPost: (): Promise<CommunityFeedItem> => {
      const scenario = scenarioOf()
      if (scenario === 'post-rate-limited') {
        return Promise.reject(
          new CommunityRateLimitException(COMMUNITY_POST_RATE_LIMITED_MESSAGE, 3600)
        )
      }
      if (scenario === 'publish-session-mismatch') {
        return Promise.reject(
          new ConflictException(COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE)
        )
      }
      return Promise.resolve(buildPendingReviewItem())
    },

    reportPost: (): Promise<{ tracked: true }> => {
      switch (scenarioOf()) {
        case 'report-not-found':
          return Promise.reject(new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE))
        case 'report-reason-changed':
          return Promise.reject(
            new ConflictException(COMMUNITY_REPORT_REASON_CHANGED_MESSAGE)
          )
        case 'report-self':
          return Promise.reject(new ForbiddenException(COMMUNITY_SELF_REPORT_MESSAGE))
        case 'report-rate-limited':
          return Promise.reject(
            new CommunityRateLimitException(
              'Too many reports. Please try again later.',
              900
            )
          )
        default:
          // A same-reason replay is this same 200: a reporter who taps twice
          // has not done anything wrong.
          return Promise.resolve({ tracked: true })
      }
    },

    withdrawPost: (): Promise<{ tracked: true }> => Promise.resolve({ tracked: true }),

    /**
     * Story 6.6: the feed branch of the opened endpoint. It refuses anything but
     * a feed body, so a controller that routed a spotlight open here fails.
     */
    recordCardOpened: (params: {
      input: { experimentVariant?: string }
    }): Promise<{ tracked: true }> =>
      params.input.experimentVariant
        ? Promise.resolve({ tracked: true })
        : Promise.reject(new Error('A spotlight open reached the feed card-open path')),

    createChallenge: () => {
      if (scenarioOf() === 'challenge-overlap') {
        // The overlap check has to consider global (null-band) rows too. That
        // is a service property; this records the envelope it produces.
        return Promise.reject(new ConflictException(COMMUNITY_CHALLENGE_OVERLAP_MESSAGE))
      }
      return Promise.resolve(buildChallengeProjection())
    },

    updateChallenge: () => {
      if (scenarioOf() === 'challenge-overlap') {
        return Promise.reject(new ConflictException(COMMUNITY_CHALLENGE_OVERLAP_MESSAGE))
      }
      return Promise.resolve(buildChallengeProjection())
    },
  } as unknown as CommunityService

  /** Story 6.6: the City Spotlight service, one page per provider scenario. */
  const spotlightItem = (rank: number, reactions: boolean) => ({
    ...buildPublishedItem(),
    rank,
    ...(reactions ? { reactions: currentReactionSummary() } : {}),
  })
  const mockCommunitySpotlightService = {
    getSpotlight: (params: {
      userId: string
      cursor?: string
      limit: number
      surface: string
      reactions?: boolean
    }): Promise<CommunitySpotlight | CommunityReactionSpotlight> => {
      const scenario = scenarioOf()
      // Story 6.7: the controller must hand the parsed surface, its default
      // included, to the service, or the viewed event loses it.
      if (!communitySpotlightSurfaceSchema.safeParse(params.surface).success)
        return Promise.reject(
          new Error('A spotlight read reached the double without a surface')
        )
      // The shared read gate's refusal, byte for byte: CommunityService.readAuthorized.
      if (scenario === 'spotlight-disabled')
        return Promise.reject(
          new ForbiddenException({
            statusCode: 403,
            code: 'denied',
            message: COMMUNITY_FEED_DISABLED_MESSAGE,
          })
        )
      const reactions = params.reactions === true
      if (params.cursor) {
        if (scenario === 'spotlight-page-two' && params.cursor === SPOTLIGHT_NEXT_CURSOR)
          return Promise.resolve({
            level: 'city',
            label: SPOTLIGHT_LABEL,
            items: [spotlightItem(SPOTLIGHT_PAGE_TWO_RANK, reactions)],
            nextCursor: null,
          })
        // Any other cursor is the real codec's decision, so its refusal is the
        // API's own invalid_cursor envelope.
        try {
          decodeSpotlightCursor(params.cursor, params.userId)
        } catch (error: unknown) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)))
        }
        return Promise.reject(new Error('An unexpected spotlight cursor was accepted'))
      }
      if (scenario === 'spotlight-none')
        return Promise.resolve({
          level: 'none',
          label: null,
          items: [],
          nextCursor: null,
        })
      return Promise.resolve({
        level: 'city',
        label: SPOTLIGHT_LABEL,
        items: [spotlightItem(1, reactions)].slice(0, params.limit),
        nextCursor: SPOTLIGHT_NEXT_CURSOR,
      })
    },
    /**
     * The spotlight branch of the opened endpoint. It refuses a body that lost
     * its served level, its rank or the post id, so a controller that drops one
     * fails verification. Story 6.7 adds the opened surface.
     */
    recordOpened: (params: {
      postId: string
      surface: unknown
      rank: number
      level: unknown
    }): Promise<{ tracked: true }> =>
      params.postId === PUBLISHED_POST_ID &&
      communitySpotlightOpenSurfaceSchema.safeParse(params.surface).success &&
      Number.isInteger(params.rank) &&
      communityServedSpotlightLevelSchema.safeParse(params.level).success
        ? Promise.resolve({ tracked: true })
        : Promise.reject(new Error('A spotlight open reached the double incomplete')),
  } as unknown as CommunitySpotlightService

  return { mockCommunityService, mockCommunitySpotlightService }
}

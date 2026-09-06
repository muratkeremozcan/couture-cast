// Learning path Step 38: Community feed by climate band.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-38-community-feed-by-climate-band
import type { CommunityService } from '../../../../apps/api/src/modules/community/community.service'
import { CommunityRateLimitException } from '../../../../apps/api/src/modules/community/community-rate-limit.exception'
import {
  COMMUNITY_CHALLENGE_OVERLAP_MESSAGE,
  COMMUNITY_CONSENT_SUSPENDED_MESSAGE,
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE,
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
  COMMUNITY_POST_RATE_LIMITED_MESSAGE,
  COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE,
  encodeCommunityFeedCursor,
  type AllocateCommunityPostInput,
  type AllocateCommunityPostSession,
  type CommunityFeed,
  type CommunityFeedItem,
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
 * Shape follows `doubles/planner.ts`: one scenario-driven double for the whole
 * service rather than for the weather, storage, moderation-queue and guardian
 * collaborators it composes, with the real guards left un-mocked so their
 * rejections are the real ones. `RolesGuard` on the two challenge routes is the
 * case that matters here -- it is why `doubles/identity.ts` resolves a third,
 * admin token, instead of this double hand-writing a 403 that would prove
 * nothing about the guard.
 *
 * TWO OUTCOMES ARE NOT MODELLED HERE ON PURPOSE. An unknown feed `mode` and an
 * invalid challenge window are both rejected by Zod inside
 * `CommunityController` before this double is reached, so a scenario for either
 * would imply a service code path that does not exist.
 *
 * THE ALLOCATE REPLAY AND THE ALLOCATE MISMATCH SHARE ONE SCENARIO. They share
 * one world state -- a session already recorded against the key -- and differ
 * only in the payload presented against it, so the double compares the incoming
 * `sha256` with the recorded one rather than being told the answer by two
 * different provider states. Deciding it from the payload is what makes this a
 * test of idempotency rather than a test of the state handler.
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

const VIEWER_BAND = 'temperate_dry'
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
 * Too few usable weather days to classify a band. The feed still carries
 * content -- an unresolved band degrades the filter, it does not empty the
 * page -- and states its reason so the client can explain itself.
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
 * The post as it comes back from `publishPost`: handed to moderation, not made
 * live. `status` is `pending_review` and `publishedAt` is still null, because
 * nothing has screened it yet.
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
 * `CommunityService.createChallenge` returns a `CommunityChallengeProjection`
 * -- already mapped out of the Prisma row by `mapChallenge` -- and the
 * controller hands it straight to `communityChallengeResponseSchema.parse`.
 * So this answers in the CONTRACT shape: camelCase keys and ISO strings, not
 * `climate_band` and `Date`. A snake_case row here fails that strict parse with
 * seven "Required" issues plus an "Unrecognized key(s)" issue and surfaces as a
 * 500, which is exactly what it did before this was corrected.
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

export function createCommunityDoubles() {
  const scenarioOf = () => getProviderCommunityState()?.scenario ?? 'feed-resolved'

  const mockCommunityService = {
    getFeed: (): Promise<CommunityFeed> => {
      switch (scenarioOf()) {
        case 'feed-band-unresolved':
          return Promise.resolve(buildBandUnresolvedFeed())
        case 'feed-removed-content':
          return Promise.resolve(buildRemovedContentFeed())
        case 'feed-cursor-invalid':
          // Both cursor rejections land here and both carry the same message:
          // a client that changed filters must not be able to tell a corrupt
          // cursor from one minted under another mode.
          return Promise.reject(new BadRequestException(COMMUNITY_CURSOR_INVALID_MESSAGE))
        default:
          return Promise.resolve(buildResolvedFeed())
      }
    },

    getPost: (): Promise<CommunityFeedItem> => {
      if (scenarioOf() === 'post-not-found') {
        return Promise.reject(new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE))
      }
      return Promise.resolve(buildPublishedItem())
    },

    /*
     * No rate-limit branch, matching the real service: the daily cap lives in
     * `publishPost` because allocation produces drafts and a draft is free. A
     * 429 modelled here would have been a fiction the contract then pinned.
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

    createChallenge: () => {
      if (scenarioOf() === 'challenge-overlap') {
        // The overlap check has to consider global (null-band) rows too, which
        // is a service property; what this records is the envelope it produces.
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

  return { mockCommunityService }
}

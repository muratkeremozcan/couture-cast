import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  COMMUNITY_ALT_TEXT_UNCONFIRMED_MESSAGE,
  COMMUNITY_CHALLENGE_NOT_FOUND_MESSAGE,
  COMMUNITY_CHALLENGE_OVERLAP_MESSAGE,
  COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE,
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE,
  COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE,
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
  COMMUNITY_POST_RATE_LIMITED_MESSAGE,
  COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  COMMUNITY_UPLOAD_NOT_COMPLETED_MESSAGE,
  COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE,
  communityChallengeCopySchema,
  defaultSupportedLocale,
  resolveAcceptLanguage,
  safeDecodeCommunityFeedCursor,
  type AllocateCommunityPostInput,
  type AllocateCommunityPostSession,
  type ClimateBand,
  type CommunityAuthorPostState,
  type CommunityBandUnresolvedReason,
  type CommunityChallenge as CommunityChallengeProjection,
  type CommunityFeed,
  type CommunityFeedCursorPayload,
  type CommunityFeedItem,
  type CommunityExperimentVariant,
  type CommunityFeedMode,
  type CommunityPlatform,
  type CreateCommunityChallengeInput,
  type EmbeddedCommunityChallenge,
  type PublishCommunityPostInput,
  type ReportCommunityPostInput,
  type ReportCommunityPostResponse,
  type SupportedLocale,
  type UpdateCommunityChallengeInput,
  type WithdrawCommunityPostResponse,
} from '@couture/api-client/contracts/http'
import {
  buildCommunityObjectPath,
  classifyClimateBand,
  parseCommunityObjectPath,
} from '@couture/utils'
import type { LookbookPost, Prisma } from '@prisma/client'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { GuardianService } from '../guardian/guardian.service.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import { WeatherQueryService } from '../weather/weather-query.service.js'
import { parseDailySummaries } from '../weather/weather.repository.js'
import { generateCommunityAuthorAlias } from './community-alias.js'
import { buildAltTextSuggestion } from './community-alt-text.js'
import {
  feedViewDedupeKey,
  postDedupeKey,
  resolveCommunityExperimentVariant,
} from './community-analytics.js'
import { CommunityRateLimitException } from './community-rate-limit.exception.js'
import {
  SupabaseCommunityStorageAdapter,
  type CommunityStorage,
} from './community-storage.adapter.js'
import {
  CommunityChallengeWindowError,
  CommunityRepository,
  type ChallengeRowWithZone,
  type CommunityChallengeWriteData,
} from './community.repository.js'

export interface GetFeedParams {
  userId: string
  platform: CommunityPlatform
  mode?: CommunityFeedMode
  cursor?: string
  limit?: number
  acceptLanguage?: string
}

const READ_URL_EXPIRES_IN_SECONDS = 900
const UPLOAD_URL_EXPIRES_IN_SECONDS = 900

/** The rolling 24-hour submission cap from the spec's rate-limit matrix row. */
export const DAILY_SUBMISSION_CAP = 10

/** Reports one account may file in a rolling 24 hours before it is throttled. */
export const DAILY_REPORT_CAP = 50

/** How long a moderator has to act on a report, per the moderation SLA. */
export const REPORT_SLA_HOURS = 24

/**
 * Statuses a post can be withdrawn from. A draft has never been submitted and an
 * already-withdrawn post has nothing left to withdraw, so both are rejected
 * rather than silently re-stamped.
 */
const WITHDRAWABLE_STATUSES = new Set([
  'pending_review',
  'published',
  'flagged',
  'consent_suspended',
])

const EXTENSION_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

@Injectable()
export class CommunityService {
  private readonly logger = new Logger(CommunityService.name)

  constructor(
    @Inject(CommunityRepository)
    private readonly repository: CommunityRepository,
    @Inject(FeatureFlagsService)
    private readonly featureFlagsService: FeatureFlagsService,
    @Inject(WeatherQueryService)
    private readonly weatherQueryService: WeatherQueryService,
    @Inject(TelemetryService)
    private readonly telemetryService: TelemetryService,
    @Inject(SupabaseCommunityStorageAdapter)
    private readonly storage: CommunityStorage,
    @Inject(GuardianService)
    private readonly guardianService: GuardianService
  ) {}

  async getFeed(params: GetFeedParams): Promise<CommunityFeed> {
    const { userId, platform, mode = 'auto', cursor, limit = 12, acceptLanguage } = params

    await this.assertReadEnabled(userId)

    // The assignment is resolved BEFORE the query and decides what is actually
    // served. Computing it afterwards, as this did, made both arms identical:
    // every viewer got whatever mode the client asked for, the variant was
    // reported to analytics and returned in the response, and nothing else read
    // it. A measured lift between two arms that receive the same feed is noise,
    // so the story's own advance condition — climate matching advances only on
    // at least 10% relative non-self card-open lift — could not be measured at
    // any traffic volume.
    const experimentVariant = resolveCommunityExperimentVariant(userId)
    const effectiveMode = this.resolveEffectiveMode(mode, experimentVariant)

    // The cursor is bound to the mode it was minted under, so a client that
    // changed filters gets the same stable 400 a malformed cursor produces and
    // simply restarts paging rather than paging one feed with another's keyset.
    // It binds to the EFFECTIVE mode: the assignment is stable per viewer, so
    // page two resolves to the same effective mode as page one whether the
    // client re-sends `auto` or echoes back the mode it was served.
    const decodedCursor = this.parseCursor(cursor, effectiveMode)
    const band = await this.resolveViewerBand(userId)

    const filterBand = this.resolveFilterBand(effectiveMode, band.viewerBand)

    const { posts, nextCursor } = await this.repository.findPublishedFeedPosts({
      filterBand,
      cursor: decodedCursor,
      limit,
      mode: effectiveMode,
    })

    const authorPosts = await this.repository.findAuthorPostStates(userId)

    const [items, authorStates] = await Promise.all([
      this.buildFeedItems(posts, userId),
      this.buildAuthorStates(authorPosts),
    ])

    const challengeBandTarget = filterBand ?? band.viewerBand ?? null
    const activeChallenge = await this.resolveActiveChallenge(
      challengeBandTarget,
      acceptLanguage
    )

    await this.recordFeedViewTelemetry({
      userId,
      platform,
      mode: effectiveMode,
      cursor,
      band,
      experimentVariant,
      itemCount: items.length,
    })

    return {
      items,
      authorStates,
      nextCursor,
      // The mode actually SERVED, not the one requested, so a client renders the
      // feed it received and the two experiment arms are distinguishable.
      mode: effectiveMode,
      viewerBand: band.viewerBand,
      bandResolved: band.bandResolved,
      bandUnresolvedReason: band.unresolvedReason,
      experimentVariant,
      activeChallenge,
    }
  }

  /**
   * Resolves one post the caller is allowed to see.
   *
   * This is what makes the matrix's "resolve visible target directly" and "poll
   * owned post until terminal" implementable: a deep link outside the first page
   * no longer has to be found by walking the feed, and an author can watch their
   * own post move through moderation without a socket. Anything the caller
   * cannot see is a 404 rather than a 403, so the endpoint does not confirm that
   * a hidden post exists.
   */
  async getPost(params: { userId: string; postId: string }): Promise<CommunityFeedItem> {
    const { userId, postId } = params

    await this.assertReadEnabled(userId)

    const post = await this.repository.findPostById(postId)
    const isVisible = post && (post.status === 'published' || post.user_id === userId)
    if (!post || !isVisible) {
      throw new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
    }

    const [item] = await this.buildFeedItems([post], userId)
    if (!item) {
      // NOT a 404. The row exists and the caller is allowed to see it; what
      // failed is our own storage. Answering "not found" tells a client the post
      // is gone and tells an operator nothing, so a missing object would look
      // exactly like a deleted one.
      throw new ServiceUnavailableException(COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE)
    }
    return item
  }

  /**
   * Read and write are separate gates because the beta rolls them out
   * separately: a band of viewers can browse before anyone can post. Both
   * default false in production until the beta gate passes.
   */
  private async assertReadEnabled(userId: string): Promise<void> {
    await this.assertFlagEnabled('community_read_enabled', userId)
  }

  private async assertWriteEnabled(userId: string): Promise<void> {
    await this.assertFlagEnabled('community_write_enabled', userId)
  }

  private async assertFlagEnabled(
    key: 'community_read_enabled' | 'community_write_enabled',
    userId: string
  ): Promise<void> {
    const enabled = await this.featureFlagsService.getFeatureFlag(key, userId)
    if (!enabled) {
      throw new ServiceUnavailableException(COMMUNITY_FEED_DISABLED_MESSAGE)
    }
  }

  private parseCursor(
    cursor: string | undefined,
    mode: CommunityFeedMode
  ): CommunityFeedCursorPayload | undefined {
    if (!cursor) {
      return undefined
    }

    const decodedResult = safeDecodeCommunityFeedCursor(cursor, mode)
    if (!decodedResult.success) {
      throw new BadRequestException(COMMUNITY_CURSOR_INVALID_MESSAGE)
    }

    return decodedResult.data
  }

  /**
   * Resolves the mode the viewer is actually served from the mode requested and
   * their stable experiment assignment.
   *
   * ONLY `auto` IS THE ARM THE EXPERIMENT VARIES. An explicit band literal, and
   * an explicit `all`, are user actions — a filter the person chose — and a
   * deliberate choice must win over an assignment, otherwise tapping a band chip
   * would silently not work for half the population. `auto` is the default
   * experience, which is exactly the thing the beta is trying to measure: does
   * matching the viewer's climate band beat showing every region.
   *
   * The assignment is derived from the user id rather than stored, so it is the
   * same on every request and every page without a lookup.
   */
  private resolveEffectiveMode(
    requestedMode: CommunityFeedMode,
    variant: CommunityExperimentVariant
  ): CommunityFeedMode {
    return requestedMode === 'auto' ? variant : requestedMode
  }

  /**
   * `auto` follows the viewer's own band and falls back to every region when it
   * cannot be resolved; `all` is a real requestable mode because the beta
   * experiment assigns half the viewers to it; a band literal pins the feed.
   */
  private resolveFilterBand(
    mode: CommunityFeedMode,
    viewerBand: ClimateBand | null
  ): ClimateBand | undefined {
    if (mode === 'all') {
      return undefined
    }
    if (mode === 'auto') {
      return viewerBand ?? undefined
    }
    return mode
  }

  /**
   * Walks the viewer's saved locations in order until one of them classifies,
   * and reports WHY it failed when none does.
   *
   * The spec's input for this row is "Ordered locations". Reading only the first
   * saved location meant a viewer whose primary city had no usable forecast fell
   * straight to "unresolved" and saw the all-regions feed, even with three other
   * saved cities that would have classified. The reason is the viewer-facing
   * half: clients render their localized banner from it, so it is populated from
   * the first location actually attempted rather than defaulted.
   */
  private async resolveViewerBand(userId: string): Promise<{
    viewerBand: ClimateBand | null
    bandResolved: boolean
    unresolvedReason: CommunityBandUnresolvedReason | null
  }> {
    const locations = await this.repository.findViewerLocations(userId)
    if (locations.length === 0) {
      return { viewerBand: null, bandResolved: false, unresolvedReason: 'no_location' }
    }

    let firstReason: CommunityBandUnresolvedReason | null = null
    const recordReason = (reason: CommunityBandUnresolvedReason) => {
      firstReason ??= reason
    }

    for (const location of locations) {
      const weatherResult = await this.weatherQueryService.getLatestWeather(
        location.location_key
      )

      // The 60-minute fresh/cached union is the story's freshness rule; a stale
      // or failed snapshot is not usable for classification.
      if (weatherResult.status === 'stale') {
        recordReason('weather_stale')
        continue
      }
      if (weatherResult.status !== 'fresh' && weatherResult.status !== 'cached') {
        recordReason('weather_unavailable')
        continue
      }
      if (!weatherResult.data?.daily_summaries) {
        recordReason('weather_malformed')
        continue
      }

      const dailySummaries = parseDailySummaries(weatherResult.data.daily_summaries)
      if (dailySummaries.length === 0) {
        recordReason('weather_malformed')
        continue
      }

      const classified = classifyClimateBand(dailySummaries)
      if (!classified) {
        recordReason('insufficient_usable_days')
        continue
      }

      return { viewerBand: classified, bandResolved: true, unresolvedReason: null }
    }

    return {
      viewerBand: null,
      bandResolved: false,
      unresolvedReason: firstReason ?? 'weather_unavailable',
    }
  }

  /**
   * Signs a whole page in one storage round trip and drops any item whose object
   * cannot be signed.
   *
   * Two defects closed here. The old code signed a URL per item, up to thirty
   * round trips for one page. And a post with no `image_object_path` was signed
   * as `placeholder-<id>.jpg`, an object that has never existed, so the client
   * rendered a broken image rather than an explicit unavailable state.
   *
   * `items` carries only published rows and its `imageAccess` is non-nullable, so
   * a public row whose media is gone is omitted; the author's own copy of that
   * post still appears in `authorStates`, where `imageAccess` is nullable and the
   * client renders the localized removed-content notice.
   */
  private async buildFeedItems(
    posts: LookbookPost[],
    viewerUserId: string
  ): Promise<CommunityFeedItem[]> {
    if (posts.length === 0) {
      return []
    }

    const expiresAtIso = this.readUrlExpiry()
    const [signedUrls, aliases] = await Promise.all([
      this.signPage(posts),
      this.repository.resolveAliases(
        posts.map((post) => post.user_id),
        generateCommunityAuthorAlias
      ),
    ])

    const items: CommunityFeedItem[] = []
    for (const post of posts) {
      const signedUrl = post.image_object_path
        ? signedUrls.get(post.image_object_path)
        : undefined

      if (!signedUrl) {
        // Omitted rather than failing the page for one bad object, but logged at
        // ERROR under a stable event name so it reaches the same log-based
        // alerting the maintenance sweeps use. A published row whose object
        // cannot be signed is an inconsistency between the database and storage,
        // not a normal state, and dropping it quietly is how that stays
        // invisible. The single-post read answers 503 for the same condition.
        this.logger.error(
          {
            event: 'community_media_unsignable',
            postId: post.id,
            status: post.status,
            hasObjectPath: Boolean(post.image_object_path),
          },
          'Published community post omitted from the feed: its image could not be signed'
        )
        continue
      }

      const isSelf = post.user_id === viewerUserId
      const alias = aliases.get(post.user_id)
      items.push({
        id: post.id,
        caption: post.caption ?? null,
        altText: post.alt_text ?? null,
        climateBand: post.climate_band ?? null,
        imageAccess: { url: signedUrl, expiresAt: expiresAtIso },
        publishedAt: post.published_at?.toISOString() ?? null,
        createdAt: post.created_at.toISOString(),
        status: post.status,
        challengeId: post.challenge_id ?? null,
        author: {
          displayName: isSelf ? 'You' : (alias ?? generateCommunityAuthorAlias()),
          isSelf,
        },
      })
    }

    return items
  }

  /**
   * The author's own non-published posts, unpaginated and in their own section.
   *
   * They are kept out of `items` because they have no `published_at` to keyset
   * on, so mixing them in would perturb the page boundaries and eat the page
   * limit. `moderationReason` rides along so an author sees a recovery state
   * instead of a post that simply stopped moving.
   */
  private async buildAuthorStates(
    posts: LookbookPost[]
  ): Promise<CommunityAuthorPostState[]> {
    if (posts.length === 0) {
      return []
    }

    const expiresAtIso = this.readUrlExpiry()
    const signedUrls = await this.signPage(posts)

    return posts.map((post) => {
      const signedUrl = post.image_object_path
        ? signedUrls.get(post.image_object_path)
        : undefined

      return {
        id: post.id,
        caption: post.caption ?? null,
        altText: post.alt_text ?? null,
        climateBand: post.climate_band ?? null,
        imageAccess: signedUrl ? { url: signedUrl, expiresAt: expiresAtIso } : null,
        createdAt: post.created_at.toISOString(),
        publishedAt: post.published_at?.toISOString() ?? null,
        status: post.status,
        challengeId: post.challenge_id ?? null,
        moderationReason: post.moderation_reason ?? null,
      }
    })
  }

  private async resolveAuthorAlias(userId: string): Promise<string> {
    return this.repository.resolveAlias(userId, generateCommunityAuthorAlias)
  }

  private readUrlExpiry(): string {
    return new Date(Date.now() + READ_URL_EXPIRES_IN_SECONDS * 1000).toISOString()
  }

  private async signPage(posts: LookbookPost[]): Promise<Map<string, string>> {
    const objectPaths = Array.from(
      new Set(
        posts
          .map((post) => post.image_object_path)
          .filter((path): path is string => Boolean(path))
      )
    )
    if (objectPaths.length === 0) {
      return new Map()
    }
    return this.storage.signReadUrls(objectPaths, READ_URL_EXPIRES_IN_SECONDS)
  }

  /**
   * A malformed `copy` blob drops the challenge to null instead of failing the
   * whole feed.
   *
   * The blob used to be cast straight to `Record<string, {title, body}>` and read
   * with `?? ''`, but `embeddedCommunityChallengeSchema` requires a non-empty
   * body — so one bad editorial row made `communityFeedResponseSchema.parse`
   * throw and returned 500 for every feed request, for every viewer, until
   * someone fixed the row. `communityChallengeCopySchema` already existed for
   * exactly this and was simply never used here.
   */
  private async resolveActiveChallenge(
    challengeBandTarget: ClimateBand | null,
    acceptLanguage?: string
  ): Promise<EmbeddedCommunityChallenge | null> {
    const challengeRow = await this.repository.findActiveChallenge(challengeBandTarget)
    if (!challengeRow) {
      return null
    }

    const copyResult = communityChallengeCopySchema.safeParse(challengeRow.copy)
    if (!copyResult.success) {
      this.logger.error(
        { challengeId: challengeRow.id, issues: copyResult.error.issues },
        'Community challenge copy failed validation; challenge omitted from feed'
      )
      return null
    }

    const copyRecord = copyResult.data
    const resolvedLocale = resolveAcceptLanguage(acceptLanguage) ?? defaultSupportedLocale
    const copyItem =
      copyRecord[resolvedLocale] ??
      copyRecord[defaultSupportedLocale] ??
      Object.values(copyRecord)[0]

    if (!copyItem) {
      return null
    }

    return {
      id: challengeRow.id,
      slug: challengeRow.slug,
      climateBand: challengeRow.climate_band ?? null,
      title: copyItem.title,
      body: copyItem.body,
      startsAt: challengeRow.starts_at.toISOString(),
      endsAt: challengeRow.ends_at.toISOString(),
      timeZone: challengeRow.time_zone,
    }
  }

  /**
   * Telemetry never blocks the request, but a failure is no longer silent.
   *
   * Every community telemetry call used to sit inside a bare `catch {}`. That is
   * what hid the report event throwing on every single call: the payload carried
   * a `postId` the `.strict()` validator rejects, the throw was swallowed, and
   * the event simply never fired while every test stayed green.
   */
  private async capture<T extends Parameters<TelemetryService['captureEvent']>[1]>(
    userId: string,
    eventType: T,
    properties: Parameters<TelemetryService['captureEvent']>[2] & object
  ): Promise<void> {
    try {
      await this.telemetryService.captureEvent(userId, eventType, properties as never)
    } catch (error: unknown) {
      this.logger.warn({ error, event: eventType }, 'Community telemetry capture failed')
    }
  }

  private async recordFeedViewTelemetry(params: {
    userId: string
    platform: CommunityPlatform
    mode: CommunityFeedMode
    cursor?: string
    band: { viewerBand: ClimateBand | null; bandResolved: boolean }
    experimentVariant: 'auto' | 'all'
    itemCount: number
  }): Promise<void> {
    await this.capture(params.userId, 'community_feed_viewed', {
      platform: params.platform,
      dedupeKey: feedViewDedupeKey({
        userId: params.userId,
        mode: params.mode,
        cursor: params.cursor,
      }),
      // The VIEWER's own resolved band, never the requested filter. Reporting the
      // filter here would make the unresolved-band guardrail unmeasurable,
      // because an unresolved viewer browsing `all` would look resolved.
      climateBand: params.band.viewerBand,
      bandResolved: params.band.bandResolved,
      filterMode: params.mode,
      experimentVariant: params.experimentVariant,
      itemCount: params.itemCount,
      isEmpty: params.itemCount === 0,
    })
  }

  async recordCardOpened(params: {
    userId: string
    postId: string
    platform: CommunityPlatform
  }): Promise<void> {
    const post = await this.repository.findPostById(params.postId)
    if (!post || post.status !== 'published') {
      throw new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
    }

    await this.capture(params.userId, 'community_card_opened', {
      platform: params.platform,
      dedupeKey: postDedupeKey(params.postId, 'community_card_opened'),
      climateBand: post.climate_band ?? null,
      isSelf: post.user_id === params.userId,
      experimentVariant: resolveCommunityExperimentVariant(params.userId),
    })
  }

  async allocatePost(params: {
    userId: string
    role?: string
    idempotencyKey: string
    platform: CommunityPlatform
    input: AllocateCommunityPostInput
  }): Promise<AllocateCommunityPostSession> {
    const { userId, role, idempotencyKey, platform, input } = params

    await this.assertWriteEnabled(userId)
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    const { viewerBand } = await this.resolveViewerBand(userId)
    const altTextSuggestion = buildAltTextSuggestion({
      climateBand: viewerBand,
      widthPx: input.widthPx,
      heightPx: input.heightPx,
      locale: input.locale,
    })

    const existingPost = await this.repository.findPostByIdempotencyKey(
      userId,
      idempotencyKey
    )
    if (existingPost) {
      const replayed = await this.replayAllocation(existingPost, input, altTextSuggestion)
      await this.recordAllocationTelemetry(userId, platform, existingPost.id, true)
      return replayed
    }

    const postId = randomUUID()
    // The upload session id is its own random value rather than the post id, so
    // it is the unguessable segment of the object path and the token publish
    // checks against.
    const uploadSessionId = randomUUID()
    const extension = EXTENSION_BY_CONTENT_TYPE[input.contentType]
    // No user id in the path: this object is served to every viewer through a
    // signed URL, and the story forbids user ids in object paths or signed URLs.
    const objectPath = buildCommunityObjectPath(postId, uploadSessionId, extension)

    const uploadSession = await this.storage.createUploadSession(
      objectPath,
      UPLOAD_URL_EXPIRES_IN_SECONDS
    )

    await this.repository.createPostDraft({
      id: postId,
      user_id: userId,
      status: 'draft',
      image_object_path: objectPath,
      image_content_type: input.contentType,
      image_checksum: input.sha256,
      image_byte_size: input.byteSize,
      upload_expires_at: new Date(uploadSession.expiresAt),
      idempotency_key: idempotencyKey,
      locale: input.locale,
    })

    await this.recordAllocationTelemetry(userId, platform, postId, false)

    return {
      postId,
      uploadSessionId,
      uploadUrl: uploadSession.uploadUrl,
      uploadToken: uploadSession.uploadToken,
      requiredHeaders: {
        'content-type': input.contentType,
      },
      expiresAt: uploadSession.expiresAt,
      altTextSuggestion,
      altTextSuggestionLocale: input.locale,
    }
  }

  private async recordAllocationTelemetry(
    userId: string,
    platform: CommunityPlatform,
    postId: string,
    replayed: boolean
  ): Promise<void> {
    await this.capture(userId, 'community_post_allocated', {
      platform,
      dedupeKey: postDedupeKey(postId, 'community_post_allocated'),
      replayed,
    })
  }

  /**
   * A replayed allocate hands back a session the client can actually use.
   *
   * The old replay returned a READ url in the `uploadUrl` field and the literal
   * string `'replayed-session-token'`, so a client retrying after a dropped
   * response could not upload — the exact case idempotency exists to serve. It
   * also compared only `sha256` and `byteSize`, so a replay that changed
   * `contentType` was accepted as matching.
   */
  private async replayAllocation(
    existingPost: LookbookPost,
    input: AllocateCommunityPostInput,
    altTextSuggestion: string
  ): Promise<AllocateCommunityPostSession> {
    const objectPath = existingPost.image_object_path
    const parsed = objectPath ? parseCommunityObjectPath(objectPath) : null

    if (
      existingPost.image_checksum !== input.sha256 ||
      existingPost.image_byte_size !== input.byteSize ||
      existingPost.image_content_type !== input.contentType ||
      !objectPath ||
      !parsed
    ) {
      throw new ConflictException(COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE)
    }

    const uploadSession = await this.storage.createUploadSession(
      objectPath,
      UPLOAD_URL_EXPIRES_IN_SECONDS
    )

    return {
      postId: existingPost.id,
      uploadSessionId: parsed.uploadSessionId,
      uploadUrl: uploadSession.uploadUrl,
      uploadToken: uploadSession.uploadToken,
      requiredHeaders: {
        'content-type': existingPost.image_content_type ?? input.contentType,
      },
      expiresAt: uploadSession.expiresAt,
      altTextSuggestion,
      altTextSuggestionLocale: input.locale,
    }
  }

  async publishPost(params: {
    userId: string
    role?: string
    platform: CommunityPlatform
    input: PublishCommunityPostInput
  }): Promise<CommunityFeedItem> {
    const { userId, role, platform, input } = params

    await this.assertWriteEnabled(userId)
    await this.guardianService.assertWardrobeUploadAllowed(userId, role)

    const { post, altText, objectPath } = await this.loadPublishablePost(userId, input)

    // A publish is idempotent on the post: replaying the same payload returns
    // the same result, and a changed payload is a conflict. The post's own
    // persisted payload is the replay predicate, which is stronger than a key to
    // response map because it also catches a second client publishing the same
    // post with different text.
    if (post.status !== 'draft') {
      return this.replayPublish(post, input, altText, userId)
    }

    if (post.upload_expires_at && post.upload_expires_at.getTime() < Date.now()) {
      throw new ConflictException(COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE)
    }

    // The bytes have to actually be in the bucket before a submission is
    // accepted. Without this the missing upload surfaced only at the very end,
    // when building the response item failed to sign the object, and came back
    // as a 503 whose documented meaning is "community write rollout is
    // disabled" — pointing whoever hit it at the feature flag instead of at
    // their own unfinished upload.
    const uploaded = await this.storage.signReadUrls(
      [objectPath],
      READ_URL_EXPIRES_IN_SECONDS
    )
    if (!uploaded.has(objectPath)) {
      throw new ConflictException(COMMUNITY_UPLOAD_NOT_COMPLETED_MESSAGE)
    }

    const challengeId = await this.resolveSubmissionChallenge(input.challengeId)
    const { viewerBand } = await this.resolveViewerBand(userId)

    // The cap is enforced HERE, atomically, rather than at allocate. Allocation
    // produces drafts, which are free by design; a submission is what counts.
    const result = await this.repository.publishWithinQuota({
      userId,
      postId: post.id,
      cap: DAILY_SUBMISSION_CAP,
      data: {
        altText,
        caption: input.caption?.trim() ?? null,
        climateBand: viewerBand ?? null,
        locale: input.locale,
        challengeId,
      },
    })

    if (result.kind === 'rate_limited') {
      throw new CommunityRateLimitException(
        COMMUNITY_POST_RATE_LIMITED_MESSAGE,
        result.retryAfterSeconds
      )
    }

    if (result.kind === 'not_draft') {
      const current = await this.repository.findPostById(post.id)
      if (!current) {
        throw new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
      }
      return this.replayPublish(current, input, altText, userId)
    }

    await this.capture(userId, 'community_post_submitted', {
      platform,
      dedupeKey: postDedupeKey(post.id, 'community_post_submitted'),
      climateBand: viewerBand ?? null,
      hasCaption: Boolean(input.caption?.trim()),
      hasChallenge: challengeId !== null,
    })

    return this.requireFeedItem(result.post, userId)
  }

  /**
   * Everything a publish must satisfy before its state is even considered:
   * the post exists and belongs to the caller, the upload session matches the
   * one baked into the object path, and the alt text is not blank.
   *
   * The session check is the interesting one. It was absent entirely, so a
   * client could publish a post carrying a session id belonging to a completely
   * different allocation.
   */
  private async loadPublishablePost(
    userId: string,
    input: PublishCommunityPostInput
  ): Promise<{ post: LookbookPost; altText: string; objectPath: string }> {
    const post = await this.repository.findPostById(input.postId)
    if (!post || post.user_id !== userId) {
      throw new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
    }

    const objectPath = post.image_object_path
    const parsedPath = objectPath ? parseCommunityObjectPath(objectPath) : null
    if (
      !objectPath ||
      !parsedPath ||
      parsedPath.uploadSessionId !== input.uploadSessionId
    ) {
      throw new ConflictException(COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE)
    }

    const altText = input.altText.trim()
    if (altText.length === 0) {
      throw new BadRequestException(COMMUNITY_ALT_TEXT_UNCONFIRMED_MESSAGE)
    }

    return { post, altText, objectPath }
  }

  /**
   * The replay half of publish. A post already past `draft` either carries the
   * payload being replayed, in which case the original result is returned, or it
   * does not, in which case the caller is trying to change a submission that has
   * already been accepted.
   */
  private async replayPublish(
    post: LookbookPost,
    input: PublishCommunityPostInput,
    altText: string,
    userId: string
  ): Promise<CommunityFeedItem> {
    const sameAltText = (post.alt_text ?? '') === altText
    const sameCaption = (post.caption ?? null) === (input.caption?.trim() ?? null)
    const sameLocale = (post.locale ?? null) === input.locale

    if (!sameAltText || !sameCaption || !sameLocale) {
      throw new ConflictException(COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE)
    }

    return this.requireFeedItem(post, userId)
  }

  private async requireFeedItem(
    post: LookbookPost,
    userId: string
  ): Promise<CommunityFeedItem> {
    const [feedItem] = await this.buildFeedItems([post], userId)
    if (!feedItem) {
      // Reaching here means the object was signable moments ago, during the
      // pre-flight check, and is not now. That is genuinely our outage.
      throw new ServiceUnavailableException(COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE)
    }
    return feedItem
  }

  /**
   * A submission may only join a challenge that is open at submission time. The
   * association is kept afterwards, including after the challenge closes, which
   * is what makes participation countable later.
   */
  private async resolveSubmissionChallenge(
    challengeId: string | undefined
  ): Promise<string | null> {
    if (!challengeId) {
      return null
    }

    const challenge = await this.repository.findChallengeById(challengeId)
    const now = Date.now()
    const isOpen =
      challenge &&
      challenge.is_active &&
      challenge.starts_at.getTime() <= now &&
      challenge.ends_at.getTime() >= now

    if (!isOpen) {
      throw new BadRequestException(COMMUNITY_CHALLENGE_NOT_FOUND_MESSAGE)
    }

    return challenge.id
  }

  async reportPost(params: {
    userId: string
    postId: string
    platform: CommunityPlatform
    input: ReportCommunityPostInput
  }): Promise<ReportCommunityPostResponse> {
    const { userId, postId, platform, input } = params

    await this.assertWriteEnabled(userId)

    // The subject alias is denormalized onto the report so the row stays
    // actionable after erasure nulls its `post_id`, and it is the pseudonym
    // rather than the author's id so the audit trail never carries a raw user
    // id either.
    const subject = await this.repository.findPostById(postId)
    const subjectAlias = subject
      ? await this.resolveAuthorAlias(subject.user_id)
      : 'unknown'

    const result = await this.repository.recordReport({
      postId,
      reporterId: userId,
      reason: input.reason,
      details: input.details,
      abuseLimit: DAILY_REPORT_CAP,
      slaHours: REPORT_SLA_HOURS,
      subjectAlias,
    })

    switch (result.kind) {
      case 'post_not_visible':
        throw new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
      case 'self_report':
        throw new ForbiddenException(COMMUNITY_SELF_REPORT_MESSAGE)
      case 'rate_limited':
        throw new CommunityRateLimitException(
          COMMUNITY_POST_RATE_LIMITED_MESSAGE,
          result.retryAfterSeconds
        )
      case 'reason_changed':
        // The matrix distinguishes these: a replay of the same reason is
        // idempotent, and only a CHANGED reason is a conflict.
        throw new ConflictException(COMMUNITY_REPORT_REASON_CHANGED_MESSAGE)
      case 'replayed':
        return { tracked: true }
      case 'created':
        break
    }

    await this.capture(userId, 'community_post_reported', {
      platform,
      // The dedupe key is scoped to the reporter as well as the post, so two
      // people reporting the same post stay two events.
      dedupeKey: postDedupeKey(`${postId}:${userId}`, 'community_post_reported'),
      reason: input.reason,
    })

    return { tracked: true }
  }

  async withdrawPost(params: {
    userId: string
    postId: string
    platform: CommunityPlatform
  }): Promise<WithdrawCommunityPostResponse> {
    const { userId, postId, platform } = params

    await this.assertWriteEnabled(userId)

    const post = await this.repository.findPostById(postId)
    if (!post) {
      throw new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
    }

    if (post.user_id !== userId) {
      throw new ForbiddenException('NOT_POST_AUTHOR')
    }

    // Withdrawal used to accept any status, so a draft that had never been
    // submitted could be "withdrawn" and an already-withdrawn post re-stamped.
    if (!WITHDRAWABLE_STATUSES.has(post.status)) {
      throw new ConflictException('POST_NOT_WITHDRAWABLE')
    }

    await this.repository.updatePost(postId, {
      status: 'withdrawn',
    })

    await this.capture(userId, 'community_post_withdrawn', {
      platform,
      dedupeKey: postDedupeKey(postId, 'community_post_withdrawn'),
      climateBand: post.climate_band ?? null,
    })

    return {
      tracked: true,
    }
  }

  async createChallenge(
    input: CreateCommunityChallengeInput
  ): Promise<CommunityChallengeProjection> {
    // The Monday-anchored, exactly-seven-day, valid-IANA-zone rules are enforced
    // by the contract schema, so the 400 arrives before this method runs.
    const startsAt = new Date(input.startsAt)
    const endsAt = new Date(input.endsAt)

    const result = await this.mapWindowError(() =>
      this.repository.createChallengeWithoutOverlap(
        input.climateBand ?? null,
        startsAt,
        endsAt,
        {
          slug: input.slug,
          climate_band: input.climateBand ?? null,
          starts_at: startsAt,
          ends_at: endsAt,
          time_zone: input.timeZone,
          copy: input.copy as Prisma.InputJsonValue,
          is_active: input.isActive,
        }
      )
    )

    if (result.kind === 'overlap') {
      throw new ConflictException(COMMUNITY_CHALLENGE_OVERLAP_MESSAGE)
    }

    return this.mapChallenge(result.challenge)
  }

  async updateChallenge(
    id: string,
    input: UpdateCommunityChallengeInput
  ): Promise<CommunityChallengeProjection> {
    const existing = await this.repository.findChallengeById(id)
    if (!existing) {
      throw new NotFoundException(COMMUNITY_CHALLENGE_NOT_FOUND_MESSAGE)
    }

    const startsAt = input.startsAt ? new Date(input.startsAt) : existing.starts_at
    const endsAt = input.endsAt ? new Date(input.endsAt) : existing.ends_at
    const climateBand =
      input.climateBand !== undefined ? input.climateBand : existing.climate_band

    const data: Prisma.CommunityChallengeUncheckedUpdateInput &
      CommunityChallengeWriteData = {
      slug: input.slug,
      climate_band: input.climateBand,
      starts_at: input.startsAt ? startsAt : undefined,
      ends_at: input.endsAt ? endsAt : undefined,
      time_zone: input.timeZone,
      copy: input.copy ? (input.copy as Prisma.InputJsonValue) : undefined,
      is_active: input.isActive,
    }

    const result = await this.mapWindowError(() =>
      this.repository.updateChallengeWithoutOverlap(
        id,
        climateBand ?? null,
        startsAt,
        endsAt,
        data
      )
    )

    if (result.kind === 'overlap') {
      throw new ConflictException(COMMUNITY_CHALLENGE_OVERLAP_MESSAGE)
    }

    return this.mapChallenge(result.challenge)
  }

  /**
   * The database's `CommunityChallenge_window_ordered` check is a malformed
   * request, not a conflict, so it becomes a 400. The contract already rejects
   * a bad window before the service runs; this covers a window that is only
   * invalid relative to a row the caller did not send.
   */
  private async mapWindowError<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error: unknown) {
      if (error instanceof CommunityChallengeWindowError) {
        throw new BadRequestException(COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE)
      }
      throw error
    }
  }

  /**
   * Mapping a persistence row to its public projection belongs here, not in the
   * controller: the controller's job is transport, and a service that returns raw
   * Prisma entities leaks the table shape past the module boundary.
   */
  private mapChallenge(challenge: ChallengeRowWithZone): CommunityChallengeProjection {
    return {
      id: challenge.id,
      slug: challenge.slug,
      climateBand: challenge.climate_band ?? null,
      startsAt: challenge.starts_at.toISOString(),
      endsAt: challenge.ends_at.toISOString(),
      timeZone: challenge.time_zone,
      copy: communityChallengeCopySchema.parse(challenge.copy),
      isActive: challenge.is_active,
      createdAt: challenge.created_at.toISOString(),
      updatedAt: challenge.updated_at.toISOString(),
    }
  }
}

/** Re-exported so the controller can name the locale type without a second import path. */
export type { SupportedLocale }

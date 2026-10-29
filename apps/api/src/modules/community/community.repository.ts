import type { CommunityAuthorizationBudget } from './community-availability.js'
import {
  assertCommunityDatabaseAccess,
  assertCommunityReadEligibility,
  assertCommunitySubjectPresent,
} from './community-access.service.js'
import {
  assertCommunitySubjectAvailable,
  guardCommunitySubject,
  guardCommunityPost,
  forgetCommunitySubject,
  communityPrivacyTransaction,
} from './community-privacy.js'
import { recordCommunityEngagement } from './community-engagement-intent.js'
import { sharedCommunityReportRetryAfter } from './community-report-limit.js'
import { eraseCommunityComments } from './community-comments.privacy.js'
import {
  findSpotlightLocation,
  type SpotlightAreaComponents,
  type SpotlightLocation,
} from './community-spotlight-area.js'
import { randomUUID } from 'node:crypto'
import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import {
  Prisma,
  PrismaClient,
  type CommunityChallenge,
  type CommunityModerationOutbox,
  type CommunityPostReport,
  type CommunityReportReason,
  type LookbookPost,
  type SavedLocation,
} from '@prisma/client'
import type { ClimateBand } from '@couture/utils'
import { COMMUNITY_CANARY_USER_ID_PREFIX } from './community-analytics.js'
import { buildCommunityContentSnapshot } from './community-audit-snapshot.js'
import {
  encodeCommunityFeedCursor,
  type CommunityFeedCursorPayload,
  type CommunityFeedMode,
  type CommunityReactionSummary,
  type SetCommunityReactionInput,
  type CommunityPlatform,
  communityReactionSummarySchema,
  COMMUNITY_REACTION_CONFLICT_MESSAGE,
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
} from '@couture/api-client/contracts/http'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

export interface FindFeedPostsParams {
  filterBand?: ClimateBand
  cursor?: CommunityFeedCursorPayload
  limit: number
  /** Stamped into the next cursor so it cannot be replayed under another filter. */
  mode: CommunityFeedMode
}

export interface FeedPostsResult {
  posts: LookbookPost[]
  nextCursor: string | null
}

export interface PublishPostData {
  altText: string
  caption: string | null
  climateBand: ClimateBand | null
  locale: string
  challengeId: string | null
  /** Story 6.6: normalized hierarchical area prefix stamped at submission. */
  area: SpotlightAreaComponents
}

/**
 * BLOCKED ON A COLUMN. `CommunityChallenge.time_zone` does not exist in
 * `packages/db/prisma/schema.prisma`, but the contract's challenge projection
 * and both admin inputs require `timeZone`: the window's Monday boundary and its
 * seven-day span are evaluated in that zone, so the value has to be stored with
 * the challenge rather than re-derived.
 *
 * Naming the gap in one place keeps the casts greppable instead of scattering
 * them through the query sites, and makes the failure loud rather than silent:
 * reading `time_zone` from a row that has no such column yields `undefined`, and
 * the response schema rejects it at the boundary. Fabricating a default here
 * would put a wrong Monday in a real challenge instead.
 */
export interface CommunityChallengeWriteData {
  time_zone?: string
}

export type ChallengeRowWithZone = CommunityChallenge & { time_zone: string }

export type PublishWithinQuotaResult =
  | { kind: 'published'; post: LookbookPost }
  | { kind: 'not_draft' }
  | { kind: 'rate_limited'; retryAfterSeconds: number }

export type RecordReportResult =
  | { kind: 'created' }
  | { kind: 'replayed' }
  | { kind: 'reason_changed'; existingReason: CommunityReportReason }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'post_not_visible' }
  | { kind: 'self_report' }

/**
 * The posts the public may see: published, with the publication time the feed
 * keys on, and not written by the operations canary.
 *
 * Every public read goes through this one rule, the feed's query and the
 * single-post, card-open and report checks alike, so a withdrawn, hidden or
 * still-screening post and a canary post are kept out by the same predicate.
 * The canary (`scripts/community-screening-canary.mjs`) publishes a synthetic
 * post through the real pipeline, and its refusal to run while the feed flag is
 * on cannot see a PostHog cohort that the flag service asks per viewer (Story
 * 6.2b final review, RF8). Excluding its account here keeps its post invisible
 * whatever the flags say; the refusal stays as defence in depth.
 */
export const PUBLICLY_VISIBLE_POST_WHERE = {
  status: 'published',
  published_at: { not: null },
  erasure_requested_at: null,
  anonymized_at: null,
  NOT: { user_id: { startsWith: COMMUNITY_CANARY_USER_ID_PREFIX } },
} as const satisfies Prisma.LookbookPostWhereInput

/** The same rule as `PUBLICLY_VISIBLE_POST_WHERE`, for a row already read. */
export function isPubliclyVisiblePost(post: {
  status: string
  published_at: Date | null
  user_id: string
  erasure_requested_at: Date | null
  anonymized_at: Date | null
}): boolean {
  return (
    post.status === 'published' &&
    post.published_at !== null &&
    post.erasure_requested_at == null &&
    post.anonymized_at == null &&
    !post.user_id.startsWith(COMMUNITY_CANARY_USER_ID_PREFIX)
  )
}

/**
 * The same rule as `PUBLICLY_VISIBLE_POST_WHERE`, inlined for raw SQL over the
 * `LookbookPost` alias given. The spotlight ranking and the Story 6.7b
 * sponsorship eligibility query both use it, and their integration suites pin
 * it to the Prisma predicate above.
 */
export function publiclyVisiblePostSql(alias: string): Prisma.Sql {
  const p = Prisma.raw(alias)
  return Prisma.sql`${p}.status = 'published' AND ${p}.published_at IS NOT NULL
    AND ${p}.erasure_requested_at IS NULL AND ${p}.anonymized_at IS NULL
    AND ${p}.user_id NOT LIKE ${`${COMMUNITY_CANARY_USER_ID_PREFIX}%`}`
}

/** Author-owned states that never appear in the public `items` array. */
const AUTHOR_STATE_STATUSES = [
  'draft',
  'uploading',
  'pending_review',
  'flagged',
  'review_failed',
  'withdrawn',
  'consent_suspended',
] as const

/** How many of the author's own non-published posts one response carries. */
const MAX_AUTHOR_STATES = 50

/** How many saved locations the band walk will try before giving up. */
const MAX_BAND_RESOLUTION_LOCATIONS = 5

/** The rolling submission window, in hours, per the spec's `(now-24h, now]`. */
export const SUBMISSION_WINDOW_HOURS = 24

/** Whether a P2002 names `field` among the columns of the violated unique index. */
function isUniqueViolationOn(
  error: Prisma.PrismaClientKnownRequestError,
  field: string
): boolean {
  const target = error.meta?.target
  return Array.isArray(target) ? target.includes(field) : target === field
}

function reactionEventType(previous: string | null, selection: string | null): string {
  if (selection === null) return 'community_reaction_removed'
  return previous === null ? 'community_reaction_added' : 'community_reaction_replaced'
}

function qualifiesForEngagement(
  changed: boolean,
  previous: string | null,
  selection: string | null
) {
  return changed && previous === null && selection !== null
}

@Injectable()
export class CommunityRepository {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}
  assertReadEligibility(member: string, budget: CommunityAuthorizationBudget) {
    return assertCommunityReadEligibility(this.prisma, member, budget)
  }
  assertSubjectAvailable(member: string, budget: CommunityAuthorizationBudget) {
    return assertCommunitySubjectPresent(this.prisma, member, budget)
  }

  /** One statement supplies every aggregate and viewer revision from one MVCC snapshot. */
  async reactionSummaries(
    postIds: string[],
    userId: string,
    tx: Prisma.TransactionClient = this.prisma
  ): Promise<Map<string, CommunityReactionSummary>> {
    if (postIds.length === 0) return new Map()
    const rows = await tx.$queryRaw<{ id: string; summary: unknown }[]>(Prisma.sql`
      SELECT p.id, jsonb_build_object(
        'counts', jsonb_build_object(
          'applause', COUNT(*) FILTER (WHERE r.selection = 'applause')::int,
          'love', COUNT(*) FILTER (WHERE r.selection = 'love')::int,
          'inspiration', COUNT(*) FILTER (WHERE r.selection = 'inspiration')::int),
        'total', COUNT(r.selection)::int,
        'viewerReaction', (SELECT v.selection FROM "CommunityReaction" v WHERE v.post_id = p.id AND v.user_id = ${userId}),
        'revision', COALESCE((SELECT v.revision FROM "CommunityReaction" v WHERE v.post_id = p.id AND v.user_id = ${userId}), 0),
        'generation', p.reaction_generation) AS summary
      FROM "LookbookPost" p LEFT JOIN "CommunityReaction" r ON r.post_id = p.id AND r.selection IS NOT NULL
      WHERE p.id IN (${Prisma.join(postIds)}) AND p.status = 'published' AND p.published_at IS NOT NULL
        AND p.erasure_requested_at IS NULL AND p.anonymized_at IS NULL
        AND p.user_id NOT LIKE 'canary-user-%'
      GROUP BY p.id
    `)
    return new Map(
      rows.map((row) => [row.id, communityReactionSummarySchema.parse(row.summary)])
    )
  }

  async setReaction(params: {
    userId: string
    postId: string
    input: SetCommunityReactionInput
    platform: CommunityPlatform
    assertEligible: (
      tx: Prisma.TransactionClient,
      participation: boolean
    ) => Promise<void>
  }): Promise<{ summary: CommunityReactionSummary } | { retryAfterSeconds: number }> {
    const { userId, postId, input, platform } = params
    return interactiveTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${userId}))`
      await assertCommunitySubjectAvailable(tx, userId)
      await tx.$queryRaw`SELECT id FROM "LookbookPost" WHERE id = ${postId} FOR UPDATE`
      await params.assertEligible(tx, false)
      const post = await tx.lookbookPost.findUnique({ where: { id: postId } })
      if (!post || !isPubliclyVisiblePost(post))
        throw new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
      const receipt = await tx.communityReactionReceipt.findUnique({
        where: {
          user_id_mutation_id: { user_id: userId, mutation_id: input.mutationId },
        },
      })
      const current = (await this.reactionSummaries([postId], userId, tx)).get(postId)
      if (!current) throw new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
      const conflict = () =>
        new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: COMMUNITY_REACTION_CONFLICT_MESSAGE,
          data: current,
        })
      if (receipt) {
        if (
          receipt.post_id !== postId ||
          receipt.selection !== input.selection ||
          receipt.base_revision !== input.baseRevision
        )
          throw conflict()
        return { summary: current }
      }
      if (current.revision !== input.baseRevision) throw conflict()
      const recent = await tx.communityReactionReceipt.findMany({
        where: { user_id: userId, created_at: { gt: new Date(Date.now() - 60_000) } },
        orderBy: { created_at: 'asc' },
        select: { created_at: true },
      })
      if (recent.length >= 60)
        return {
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(
              ((recent[0]?.created_at.getTime() ?? Date.now()) + 60_000 - Date.now()) /
                1000
            )
          ),
        }
      await params.assertEligible(tx, true)
      const changed = current.viewerReaction !== input.selection
      await tx.communityReaction.upsert({
        where: { user_id_post_id: { user_id: userId, post_id: postId } },
        create: {
          user_id: userId,
          post_id: postId,
          selection: input.selection,
          revision: 1,
        },
        update: { selection: input.selection, revision: { increment: 1 } },
      })
      if (changed) {
        if (!userId.startsWith(COMMUNITY_CANARY_USER_ID_PREFIX)) {
          await tx.communityReactionOutbox.create({
            data: {
              id: randomUUID(),
              user_id: userId,
              post_id: postId,
              event_type: reactionEventType(current.viewerReaction, input.selection),
              payload: {
                platform,
                isSelf: post.user_id === userId,
                selection: input.selection,
                previousSelection: current.viewerReaction,
              },
            },
          })
        }
      }
      await tx.communityReactionReceipt.create({
        data: {
          user_id: userId,
          post_id: postId,
          mutation_id: input.mutationId,
          selection: input.selection,
          base_revision: input.baseRevision,
        },
      })
      const summary = (await this.reactionSummaries([postId], userId, tx)).get(postId)
      if (!summary) throw new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
      if (qualifiesForEngagement(changed, current.viewerReaction, input.selection)) {
        await recordCommunityEngagement(tx, { actor: userId, post: postId })
      }
      return { summary }
    })
  }

  /**
   * The viewer's saved locations in preference order. The spec's band-resolution
   * input is "Ordered locations", so the caller walks this list until one of them
   * classifies rather than giving up on the first location that happens to have
   * no usable weather.
   */
  /** Story 6.6: the author's chosen location for area stamping. */
  findAreaLocation(userId: string): Promise<SpotlightLocation | null> {
    return findSpotlightLocation(this.prisma, userId)
  }

  async findViewerLocations(userId: string): Promise<SavedLocation[]> {
    return this.prisma.savedLocation.findMany({
      where: { user_id: userId },
      orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      take: MAX_BAND_RESOLUTION_LOCATIONS,
    })
  }

  /**
   * The public page: published rows only, keyed on `published_at, id`.
   *
   * Ordering on `created_at` was a correctness bug, not a style choice.
   * Moderation stamps `published_at` long after `created_at`, so a post that
   * clears screening an hour after it was drafted is inserted BEHIND a cursor the
   * reader has already consumed and is never seen at all. The two indexes the
   * database session rebuilt are on `published_at DESC, id DESC` for exactly this
   * query.
   */
  async findPublishedFeedPosts(params: FindFeedPostsParams): Promise<FeedPostsResult> {
    const { filterBand, cursor, limit, mode } = params

    const bandCondition = filterBand ? { climate_band: filterBand } : {}

    const cursorCondition = cursor
      ? {
          OR: [
            { published_at: { lt: new Date(cursor.publishedAt) } },
            {
              published_at: new Date(cursor.publishedAt),
              id: { lt: cursor.id },
            },
          ],
        }
      : {}

    const rows = await this.prisma.lookbookPost.findMany({
      where: {
        AND: [PUBLICLY_VISIBLE_POST_WHERE, bandCondition, cursorCondition],
      },
      orderBy: [{ published_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })

    const hasMore = rows.length > limit
    const posts = hasMore ? rows.slice(0, limit) : rows

    let nextCursor: string | null = null
    const lastPost = posts[posts.length - 1]
    if (hasMore && lastPost?.published_at) {
      // Encoded through the contract's own encoder rather than a hand-rolled
      // base64 of a hand-built object, so the encoder and the decoder cannot
      // drift apart.
      nextCursor = encodeCommunityFeedCursor({
        publishedAt: lastPost.published_at.toISOString(),
        id: lastPost.id,
        mode,
        // The band actually filtered on, which is a different value from `mode`
        // and has to travel separately. Under `auto` the band is derived per
        // request from weather guaranteed fresh only within 60 minutes, so it
        // can move between two pages of one scroll while `mode` stays `auto`
        // throughout. `null` records that this page was served unfiltered, a
        // state the reader can legitimately page through and one that must stay
        // distinguishable from a band that has since resolved.
        band: filterBand ?? null,
      })
    }

    return { posts, nextCursor }
  }

  /**
   * The caller's own posts that are not published, for the response's separate
   * author section. Unpaginated by design: these rows have no `published_at` to
   * keyset on, and there are never many of them because the submission cap is ten
   * a day.
   */
  async findAuthorPostStates(userId: string): Promise<LookbookPost[]> {
    return this.prisma.lookbookPost.findMany({
      where: {
        user_id: userId,
        status: { in: [...AUTHOR_STATE_STATUSES] as never },
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: MAX_AUTHOR_STATES,
    })
  }

  async findActiveChallenge(
    targetBand: ClimateBand | null,
    now: Date = new Date()
  ): Promise<ChallengeRowWithZone | null> {
    if (targetBand) {
      const bandChallenge = await this.prisma.communityChallenge.findFirst({
        where: {
          is_active: true,
          starts_at: { lte: now },
          ends_at: { gte: now },
          climate_band: targetBand,
        },
        orderBy: [{ starts_at: 'desc' }, { id: 'desc' }],
      })

      if (bandChallenge) {
        return bandChallenge as ChallengeRowWithZone
      }
    }

    const globalChallenge = await this.prisma.communityChallenge.findFirst({
      where: {
        is_active: true,
        starts_at: { lte: now },
        ends_at: { gte: now },
        climate_band: null,
      },
      orderBy: [{ starts_at: 'desc' }, { id: 'desc' }],
    })
    return globalChallenge as ChallengeRowWithZone | null
  }

  async findPostByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<LookbookPost | null> {
    return this.prisma.lookbookPost.findUnique({
      where: {
        user_id_idempotency_key: {
          user_id: userId,
          idempotency_key: idempotencyKey,
        },
      },
    })
  }

  async createPostDraft(
    data: Prisma.LookbookPostUncheckedCreateInput
  ): Promise<LookbookPost> {
    return interactiveTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${data.user_id}))`
      await assertCommunityDatabaseAccess(tx, data.user_id)
      const subject = await tx.communitySubject.findUnique({
        where: { member_id: data.user_id },
      })
      if (!subject) throw new ForbiddenException('Community account unavailable')
      return tx.lookbookPost.create({ data })
    })
  }

  async findPostById(postId: string): Promise<LookbookPost | null> {
    return this.prisma.lookbookPost.findUnique({
      where: { id: postId },
    })
  }

  /**
   * Withdraws a post and starts its erasure clock in one statement.
   *
   * Withdrawal used to write `status` alone, which left the whole erasure sweep
   * unreachable: `erasure_requested_at` had no producer anywhere in production
   * code, so a withdrawn post's image stayed in the bucket forever and the
   * 72-hour deadline never started, meaning `community_erasure_overdue` could
   * not fire even in principle.
   *
   * `COALESCE` rather than a plain assignment because the clock must never be
   * pushed back. Account erasure can already have stamped this row while it was
   * still `published`, in the window before the sweep picks it up; if the author
   * then withdraws it, a plain assignment would restart the 72 hours and turn a
   * deletion that was already running late into one that looks on time. Raw SQL
   * because Prisma cannot express "set this column only if it is null" in a
   * single `update`, and a read-then-write would race the sweep.
   *
   * `updated_at` is set by hand for the same reason: `@updatedAt` is applied by
   * the Prisma client, and this statement does not go through it.
   */
  async withdrawPostAndRequestErasure(postId: string, requestedAt: Date): Promise<void> {
    await communityPrivacyTransaction(this.prisma, async (tx) => {
      await guardCommunityPost(tx, postId)
      await tx.$executeRaw`
      UPDATE "LookbookPost"
      SET status = 'withdrawn'::"CommunityPostStatus",
          erasure_requested_at = COALESCE(erasure_requested_at, ${requestedAt}),
          updated_at = ${requestedAt}
      WHERE id = ${postId}
    `
    })
  }

  /**
   * Starts the erasure clock on every one of a member's posts that is not
   * already counting down, and reports how many rows that moved.
   *
   * Every status is in scope, including `withdrawn` and `draft`. A post
   * withdrawn before this code existed has an object in the bucket and no clock
   * at all, and a `draft` or `uploading` row can hold an uploaded object that
   * was never published. Erasure that skipped either would leave exactly the
   * bytes the request was about.
   */
  async requestErasureForUser(userId: string, requestedAt: Date): Promise<number> {
    return communityPrivacyTransaction(this.prisma, async (tx) => {
      await guardCommunitySubject(tx, userId)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${userId}))`
      await tx.$queryRaw`SELECT id FROM "LookbookPost" WHERE id IN (SELECT post_id FROM "CommunityReaction" WHERE user_id = ${userId}) OR id IN (SELECT post_id FROM "CommunityComment" WHERE user_id = ${userId}) OR user_id = ${userId} ORDER BY id FOR UPDATE`
      await eraseCommunityComments(tx, userId)
      await tx.communityReaction.deleteMany({ where: { user_id: userId } })
      await tx.communityReactionReceipt.deleteMany({ where: { user_id: userId } })
      await tx.communityReactionOutbox.deleteMany({ where: { user_id: userId } })
      const { count } = await tx.lookbookPost.updateMany({
        where: { user_id: userId, erasure_requested_at: null },
        data: { erasure_requested_at: requestedAt },
      })
      await forgetCommunitySubject(tx, userId, true)
      return count
    })
  }

  /**
   * Moves a draft to `pending_review`, writes its moderation outbox row, and
   * enforces the rolling submission cap — all in one transaction.
   *
   * THREE DEFECTS THIS SHAPE CLOSES. The cap used to be checked in the service
   * before an unrelated write, so two parallel requests both read nine and both
   * accepted. It counted rows by `created_at`, which is allocation time, so ten
   * drafts allocated yesterday and published today counted as zero. And it was
   * never applied at publish at all, so a client could allocate twenty drafts
   * under the cap and then publish all twenty.
   *
   * The engagement-member lock precedes the submission lock, keyed on the
   * submitting user, so same-user submissions serialise without serialising the
   * table. The window is `submitted_at > now() - 24 hours`, which is the spec's
   * exclusive lower bound, and `submitted_at` is stamped on ACCEPTANCE rather
   * than allocation so an idempotent replay counts once.
   */
  async publishWithinQuota(params: {
    userId: string
    postId: string
    cap: number
    data: PublishPostData
  }): Promise<PublishWithinQuotaResult> {
    const { userId, postId, cap, data } = params

    return interactiveTransaction(this.prisma, async (tx) => {
      // FIRST statement, always. Counting before locking is exactly the
      // check-then-act race the cap is supposed to close: two parallel requests
      // both read nine and both accept. The lock is per user and released at
      // commit, so it serialises one author's submissions without serialising
      // the table.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${userId}))`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_submission:' || ${userId}))`

      await tx.$queryRaw`SELECT id FROM "LookbookPost" WHERE id = ${postId} ORDER BY id FOR UPDATE`
      await assertCommunityDatabaseAccess(tx, userId)

      // `submitted_at`, not `created_at`. The row is created at allocate time
      // and a replayed allocate reuses it through the idempotency key, so
      // counting creation time would charge a retry against the cap. The bound
      // is exclusive, matching the spec's `(now-24h, now]`.
      const windowStart = new Date(Date.now() - SUBMISSION_WINDOW_HOURS * 60 * 60 * 1000)
      const accepted = await tx.lookbookPost.findMany({
        where: { user_id: userId, submitted_at: { gt: windowStart } },
        orderBy: { submitted_at: 'asc' },
        select: { submitted_at: true },
      })

      if (accepted.length >= cap) {
        return {
          kind: 'rate_limited' as const,
          retryAfterSeconds: retryAfterSecondsFrom(accepted[0]?.submitted_at ?? null),
        }
      }

      const submittedAt = new Date()
      const updated = await tx.lookbookPost.updateMany({
        where: {
          id: postId,
          user_id: userId,
          status: 'draft',
          erasure_requested_at: null,
          anonymized_at: null,
        },
        data: {
          status: 'pending_review',
          alt_text: data.altText,
          caption: data.caption,
          climate_band: data.climateBand,
          locale: data.locale,
          challenge_id: data.challengeId,
          area_country: data.area.country,
          area_region: data.area.region,
          area_city: data.area.city,
          submitted_at: submittedAt,
          // Stamped in the SAME statement that writes `alt_text`, on the
          // draft -> pending_review transition. The two have to move together:
          // a confirmation recorded separately from the text it confirms would
          // let an edit slip in between, and the row would then claim the
          // author approved wording they never saw. Moderation is what moves a
          // post from `pending_review` to `published`, so the stamp is always
          // strictly earlier than publication.
          alt_text_confirmed_at: submittedAt,
        },
      })

      if (updated.count !== 1) {
        return { kind: 'not_draft' as const }
      }

      await tx.communityModerationOutbox.upsert({
        where: { post_id: postId },
        create: { post_id: postId },
        update: {},
      })

      const post = await tx.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
      return { kind: 'published' as const, post }
    })
  }

  async createModerationOutbox(postId: string): Promise<CommunityModerationOutbox> {
    return this.prisma.communityModerationOutbox.upsert({
      where: { post_id: postId },
      create: { post_id: postId },
      update: {},
    })
  }

  async findReportByPostAndUser(
    postId: string,
    reporterId: string
  ): Promise<CommunityPostReport | null> {
    return this.prisma.communityPostReport.findUnique({
      where: { post_id_reporter_id: { post_id: postId, reporter_id: reporterId } },
    })
  }

  /**
   * Inserts a report from a row that is still visible, transactionally.
   *
   * The previous shape read the post, read any existing report, counted the
   * abuse window, and then inserted, all outside a transaction. Two concurrent
   * reports from the same reporter both missed the duplicate check and the second
   * hit the unique index as an unhandled `P2002`, which surfaced as a 500. The
   * post row is locked `FOR UPDATE` so its visibility cannot change between the
   * check and the insert, the advisory lock serialises one reporter's requests,
   * and `P2002` is still caught as the final backstop.
   *
   * The record lands on `CommunityPostReport`, not `ModerationEvent`. The old
   * code wrote `` `${reason}: ${details}` `` into ModerationEvent's `reason`
   * column, which destroyed the closed enum, put unbounded user text in an audit
   * field, and made a same-reason replay indistinguishable from a changed one.
   * `subject_alias` and `image_object_path` are denormalized onto the row so it
   * stays actionable and its object findable after erasure nulls `post_id`.
   */
  async recordReport(params: {
    postId: string
    reporterId: string
    reason: CommunityReportReason
    details?: string
    abuseLimit: number
    slaHours: number
    subjectAlias: string
  }): Promise<RecordReportResult> {
    const { postId, reporterId, reason, details, abuseLimit, slaHours, subjectAlias } =
      params

    try {
      return await interactiveTransaction(this.prisma, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_report:' || ${reporterId}))`

        const locked = await tx.$queryRaw<
          {
            user_id: string
            status: string
            published_at: Date | null
            erasure_requested_at: Date | null
            anonymized_at: Date | null
            image_object_path: string | null
            caption: string | null
            alt_text: string | null
            locale: string | null
            climate_band: string | null
          }[]
        >`
          SELECT user_id,
                 status::text AS status,
                 published_at,
                 erasure_requested_at,
                 anonymized_at,
                 image_object_path,
                 caption,
                 alt_text,
                 locale,
                 climate_band::text AS climate_band
          FROM "LookbookPost"
          WHERE id = ${postId}
          FOR UPDATE
        `

        const post = locked[0]
        if (!post || !isPubliclyVisiblePost(post)) {
          return { kind: 'post_not_visible' as const }
        }

        if (post.user_id === reporterId) {
          return { kind: 'self_report' as const }
        }

        const existing = await tx.communityPostReport.findUnique({
          where: { post_id_reporter_id: { post_id: postId, reporter_id: reporterId } },
        })

        if (existing) {
          // A replay of the same reason is idempotent; a different reason is a
          // conflict, because the audit record already committed to one.
          return existing.reason === reason
            ? { kind: 'replayed' as const }
            : { kind: 'reason_changed' as const, existingReason: existing.reason }
        }

        const retryAfterSeconds = await sharedCommunityReportRetryAfter(
          tx,
          reporterId,
          abuseLimit
        )
        if (retryAfterSeconds !== null)
          return { kind: 'rate_limited' as const, retryAfterSeconds }

        // Captured under the same `FOR UPDATE` lock that decided the post was
        // visible, so the snapshot is the content the reporter actually saw
        // rather than whatever the row holds by the time anyone reads the
        // report. Erasure nulls `post_id` and anonymization nulls the text, and
        // without this the surviving row said nothing about what was reported.
        const contentSnapshot = buildCommunityContentSnapshot(post, new Date())

        await tx.communityPostReport.create({
          data: {
            post_id: postId,
            reporter_id: reporterId,
            reason,
            details: details ?? null,
            subject_alias: subjectAlias,
            image_object_path: post.image_object_path,
            content_snapshot: contentSnapshot,
            sla_due_at: new Date(Date.now() + slaHours * 60 * 60 * 1000),
          },
        })

        // Append-only audit entry alongside the report. ModerationEvent lost its
        // UNIQUE (post_id, flagged_by_id), so a second actor on the same post is
        // a second row rather than a constraint violation.
        await tx.moderationEvent.create({
          data: {
            post_id: postId,
            flagged_by_id: reporterId,
            action: 'reported',
            reason,
            subject_alias: subjectAlias,
            image_object_path: post.image_object_path,
            content_snapshot: contentSnapshot,
          },
        })

        return { kind: 'created' as const }
      })
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Lost the race against a concurrent insert of the same (post, reporter).
        // The row that won carries whichever reason arrived first.
        const existing = await this.findReportByPostAndUser(postId, reporterId)
        return existing?.reason === reason
          ? { kind: 'replayed' }
          : { kind: 'reason_changed', existingReason: existing?.reason ?? 'other' }
      }
      throw error
    }
  }

  /**
   * The author's persisted pseudonym, created on first use.
   *
   * A stored alias replaces `sha256(userId).slice(0, 4)`, which gave 65,536
   * unsalted buckets over a guessable input: an attacker holding candidate user
   * ids could confirm authorship by hashing, and collisions arrived well below
   * the thousand-viewer beta. The unique constraint removes collisions outright
   * rather than making them unlikely, and the alias survives a secret rotation.
   *
   * `upsert` rather than find-then-create: two concurrent feed requests for a
   * first-time author would otherwise race on the unique index.
   */
  async resolveAlias(
    userId: string,
    generateAlias: () => string
  ): Promise<string | null> {
    const existing = await this.prisma.communityAlias.findUnique({
      where: { user_id: userId },
    })
    if (existing) {
      return existing.alias
    }

    try {
      const created = await this.prisma.communityAlias.create({
        data: { user_id: userId, alias: generateAlias() },
      })
      return created.alias
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // TWO RACES, TWO DIFFERENT ANSWERS.
        //
        // P2002, the unique index on `user_id`: another request minted an alias
        // for this author between the read above and this insert. Both were
        // right to try, one won, and the loser reads the winner's value. The
        // author exists and has an alias.
        if (error.code === 'P2002') {
          const raced = await this.prisma.communityAlias.findUnique({
            where: { user_id: userId },
          })
          if (raced) {
            return raced.alias
          }
          // The winner's row existed a moment ago and is gone now. Aliases are
          // only ever removed with their author (the relation cascades), so the
          // author was erased between the insert and this read: the same answer
          // as P2003 below. A collision on the generated `alias` itself is not
          // this case and still throws.
          if (isUniqueViolationOn(error, 'user_id')) {
            return null
          }
        }

        // P2003, the foreign key onto `User`: the author's account was deleted
        // while this page was being assembled. There is nothing to alias and
        // there never will be, so this returns null rather than throwing.
        //
        // THIS IS REACHABLE IN PRODUCTION, and Story 6.1 is what makes it so.
        // The feed is table-wide by design and returns other people's posts, so
        // a viewer's read genuinely races the account erasure this same story
        // ships with its 72-hour completion window. Throwing here turned one
        // stranger's deletion into a 500 for the whole page: every other item in
        // the response was lost because one author had gone.
        if (error.code === 'P2003') {
          return null
        }
      }
      throw error
    }
  }

  /** Resolves aliases for a whole page in one query, then fills any gaps. */
  async resolveAliases(
    userIds: readonly string[],
    generateAlias: () => string
  ): Promise<Map<string, string>> {
    const unique = Array.from(new Set(userIds))
    if (unique.length === 0) {
      return new Map()
    }

    const rows = await this.prisma.communityAlias.findMany({
      where: { user_id: { in: unique } },
    })
    const aliases = new Map(rows.map((row) => [row.user_id, row.alias]))

    for (const userId of unique) {
      if (!aliases.has(userId)) {
        const alias = await this.resolveAlias(userId, generateAlias)
        // An author who vanished mid-page is simply absent from the map. The
        // caller drops the item rather than inventing a name for a person who
        // no longer exists; see `buildFeedItems`.
        if (alias !== null) {
          aliases.set(userId, alias)
        }
      }
    }

    return aliases
  }

  async findChallengeById(challengeId: string): Promise<ChallengeRowWithZone | null> {
    const challenge = await this.prisma.communityChallenge.findUnique({
      where: { id: challengeId },
    })
    return challenge as ChallengeRowWithZone | null
  }

  /**
   * Overlap includes global rows in both directions.
   *
   * Equality on `climate_band` meant a band-scoped challenge never conflicted
   * with an overlapping global one and vice versa, so two challenges could both
   * be active for the same viewer at the same instant. A global challenge
   * (`climate_band IS NULL`) applies to every band, so it overlaps everything;
   * a band-scoped one overlaps its own band and any global row.
   */
  private overlapBandCondition(
    climateBand: ClimateBand | null
  ): Prisma.CommunityChallengeWhereInput {
    return climateBand
      ? { OR: [{ climate_band: climateBand }, { climate_band: null }] }
      : {}
  }

  async findOverlappingChallenge(
    climateBand: ClimateBand | null,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
    client: Prisma.TransactionClient | PrismaClient = this.prisma
  ): Promise<CommunityChallenge | null> {
    return client.communityChallenge.findFirst({
      where: {
        id: excludeId ? { not: excludeId } : undefined,
        is_active: true,
        starts_at: { lt: endsAt },
        ends_at: { gt: startsAt },
        ...this.overlapBandCondition(climateBand),
      },
    })
  }

  /**
   * Checks overlap, then inserts, with the database's own exclusion constraint
   * as the authority.
   *
   * SERIALIZABLE is not needed and is deliberately not used. The constraint
   * models each challenge as the SET of bands it occupies — a band-scoped row
   * takes one slot, a global row takes all six — so two admins racing on
   * overlapping windows cannot both commit regardless of isolation level. The
   * pre-check exists to return a clean 409 for the common case; the constraint
   * is what makes the guarantee true.
   *
   * `23P01` is the exclusion violation and maps to 409. `23514` is the
   * `CommunityChallenge_window_ordered` check and maps to 400: a window whose
   * end precedes its start is a malformed request, not a conflict.
   */
  async createChallengeWithoutOverlap(
    climateBand: ClimateBand | null,
    startsAt: Date,
    endsAt: Date,
    data: Prisma.CommunityChallengeUncheckedCreateInput & CommunityChallengeWriteData
  ): Promise<{ kind: 'created'; challenge: ChallengeRowWithZone } | { kind: 'overlap' }> {
    return mapChallengeConstraintErrors(() =>
      interactiveTransaction(this.prisma, async (tx) => {
        const overlap = await this.findOverlappingChallenge(
          climateBand,
          startsAt,
          endsAt,
          undefined,
          tx
        )
        if (overlap) {
          return { kind: 'overlap' as const }
        }
        return {
          kind: 'created' as const,
          challenge: (await tx.communityChallenge.create({
            data,
          })) as ChallengeRowWithZone,
        }
      })
    )
  }

  async updateChallengeWithoutOverlap(
    id: string,
    climateBand: ClimateBand | null,
    startsAt: Date,
    endsAt: Date,
    data: Prisma.CommunityChallengeUncheckedUpdateInput & CommunityChallengeWriteData
  ): Promise<{ kind: 'updated'; challenge: ChallengeRowWithZone } | { kind: 'overlap' }> {
    return mapChallengeConstraintErrors(() =>
      interactiveTransaction(this.prisma, async (tx) => {
        const overlap = await this.findOverlappingChallenge(
          climateBand,
          startsAt,
          endsAt,
          id,
          tx
        )
        if (overlap) {
          return { kind: 'overlap' as const }
        }
        return {
          kind: 'updated' as const,
          challenge: (await tx.communityChallenge.update({
            where: { id },
            data,
          })) as ChallengeRowWithZone,
        }
      })
    )
  }
}

/** Raised for `CommunityChallenge_window_ordered`, which the caller maps to 400. */
export class CommunityChallengeWindowError extends Error {
  constructor() {
    super('COMMUNITY_CHALLENGE_WINDOW_INVALID')
    this.name = 'CommunityChallengeWindowError'
  }
}

/**
 * Translates the two database constraints that guard challenge windows.
 *
 * Keyed on the SQLSTATE rather than on a constraint name, so renaming a
 * constraint cannot silently turn a 409 into a 500.
 */
/** One extra attempt after a deadlock; see `mapChallengeConstraintErrors`. */
const CHALLENGE_DEADLOCK_RETRY_LIMIT = 1

async function mapChallengeConstraintErrors<T extends { kind: string }>(
  work: () => Promise<T>
): Promise<T | { kind: 'overlap' }> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await work()
    } catch (error: unknown) {
      const sqlState = extractSqlState(error)
      if (sqlState === '23P01') {
        return { kind: 'overlap' }
      }
      if (sqlState === '23514') {
        throw new CommunityChallengeWindowError()
      }
      // A DEADLOCK IS THE OTHER WAY TWO OVERLAPPING WRITES CAN COLLIDE, and
      // without this it surfaced as a 500.
      //
      // Both callers pre-check with a SELECT and then INSERT inside one
      // transaction, so two concurrent writers both see an empty calendar and
      // both proceed; the GiST exclusion constraint is what actually serialises
      // them. Usually the second one blocks on the first and loses cleanly with
      // 23P01, which is the branch above. But when each transaction has already
      // written its own index entry before scanning for conflicts, each ends up
      // waiting on the other and PostgreSQL breaks the cycle by aborting one
      // with 40P01 — a raw `PrismaClientUnknownRequestError` that neither
      // branch above catches. Two admins creating overlapping challenges at the
      // same moment would get a 500 rather than the documented 409.
      //
      // Retrying is the correct response rather than mapping 40P01 onto
      // `overlap`: the aborted transaction wrote nothing, and a deadlock does
      // not by itself prove an overlap. On the retry the winner has committed,
      // so the pre-check SELECT sees it and returns `overlap` through the
      // ordinary path. Bounded to one extra attempt deliberately — a single
      // retry settles two-way contention, and retrying indefinitely would
      // paper over a genuine lock-ordering bug instead of surfacing it.
      if (sqlState === '40P01' && attempt < CHALLENGE_DEADLOCK_RETRY_LIMIT) {
        continue
      }
      throw error
    }
  }
}

/**
 * A SQLSTATE reaches us by two different routes, and reading only one of them
 * was a real defect: a backwards challenge window returned 500 where the
 * contract promises a 400.
 *
 * Measured against Prisma 6.19. An EXCLUSION violation (23P01) arrives as
 * `PrismaClientKnownRequestError` with the state in `meta.code`. A CHECK
 * violation (23514) arrives as `PrismaClientUnknownRequestError` with `code`
 * and `meta` BOTH undefined and the state present only inside the message, as
 * `PostgresError { code: "23514", ... }`. Reading `meta.code` alone therefore
 * made the 23514 branch unreachable while the 23P01 branch kept working, which
 * is why every overlap assertion passed and only the window one failed.
 *
 * Both routes are read here rather than only the one each error happens to use
 * today, because which route a given constraint takes is a Prisma
 * implementation detail that has already changed once.
 */
const SQLSTATE_IN_MESSAGE = /code:\s*"([0-9A-Z]{5})"/

function extractSqlState(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { code?: unknown } | undefined
    if (typeof meta?.code === 'string') {
      return meta.code
    }
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    return SQLSTATE_IN_MESSAGE.exec(error.message)?.[1] ?? null
  }

  return null
}

/**
 * Seconds until the oldest entry in the rolling window falls out of it, which is
 * the earliest instant the caller can succeed. Falls back to the full window when
 * there is nothing to measure from.
 */
function retryAfterSecondsFrom(oldest: Date | null): number {
  const windowMs = SUBMISSION_WINDOW_HOURS * 60 * 60 * 1000
  if (!oldest) {
    return SUBMISSION_WINDOW_HOURS * 60 * 60
  }
  const remainingMs = oldest.getTime() + windowMs - Date.now()
  return Math.max(1, Math.ceil(remainingMs / 1000))
}

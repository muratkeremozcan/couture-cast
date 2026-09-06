import type {
  ClimateBand,
  CommunityAlias,
  CommunityChallenge,
  CommunityModerationOutbox,
  CommunityPostReport,
  CommunityPostStatus,
  CommunityReportReason,
  LookbookPost,
  Prisma,
  PrismaClient,
} from '@prisma/client'
import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

type CommunityPrismaClient = PrismaClient | Prisma.TransactionClient

/**
 * Clock injection for the community factories.
 *
 * Every other timestamp in these fixtures is derived from one `now`, so a test
 * that needs a fixed point in time passes it once instead of overriding four
 * fields and hoping it caught them all. The default stays `new Date()` so
 * existing callers are unaffected, but the community feed orders by
 * `published_at, id` and its cursor is a timestamp, which makes wall-clock
 * defaults a source of order-dependent flake in exactly the tests that matter.
 */
export interface CommunityFactoryOptions {
  now?: Date
}

const resolveNow = (options: CommunityFactoryOptions | undefined): Date =>
  options?.now ?? new Date()

/**
 * Builds the opaque storage path for a post: `community/<postId>/<random>.<ext>`.
 *
 * There is deliberately no user id in it. The path is embedded in every signed
 * URL the API mints, and a signed URL is shared, logged and cached, so a user id
 * here would deanonymize the author to anyone downstream of the share. The story
 * states it as a hard boundary: "Never: Put user IDs in object paths or signed
 * URLs."
 */
export function buildCommunityObjectPath(postId: string, extension = 'jpg'): string {
  return `community/${postId}/${faker.string.alphanumeric(32)}.${extension}`
}

/**
 * The only shape a community object path may take:
 * `community/<postId>/<opaque token>.<ext>`, three segments, nothing else.
 *
 * The token segment allows hyphens because the API mints a UUID there while the
 * factory uses an alphanumeric token and the seed uses a hex digest; all three
 * are opaque, which is the property under test. What the pattern rules out is a
 * path with more or fewer segments, or a token that is not opaque at all.
 *
 * Exported so the seed and the factories are held to one rule by one assertion.
 * They were not, and that is the whole reason this exists: the factory's path
 * was rewritten to drop the user id and the seed's was left as
 * `community/<userId>/lookbook-N.jpg`, so the repository simultaneously did and
 * did not obey "Never: Put user IDs in object paths or signed URLs" depending on
 * which file you read. A shared pattern makes that split fail somewhere.
 */
export const COMMUNITY_OBJECT_PATH_PATTERN =
  /^community\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]+$/

/**
 * True when `identifier` appears anywhere in `path`.
 *
 * Used to assert a user id is absent. Substring rather than segment equality on
 * purpose: a path is leaky if it merely CONTAINS the id, and a decomposed or
 * concatenated id would slip past a segment-by-segment comparison.
 */
export function communityObjectPathContainsIdentifier(
  path: string,
  identifier: string
): boolean {
  return identifier.length > 0 && path.includes(identifier)
}

export interface LookbookPostFixture {
  id: string
  userId: string
  status: CommunityPostStatus
  caption?: string | null
  altText?: string | null
  imageObjectPath?: string | null
  imageContentType?: string | null
  imageChecksum?: string | null
  imageByteSize?: number | null
  uploadExpiresAt?: Date | null
  altTextConfirmedAt?: Date | null
  submittedAt?: Date | null
  publishedAt?: Date | null
  moderationReason?: string | null
  moderationEngineVersion?: string | null
  idempotencyKey?: string | null
  locationKey?: string | null
  locale?: string | null
  climateBand?: ClimateBand | null
  paletteInsightId?: string | null
  challengeId?: string | null
  erasureRequestedAt?: Date | null
  anonymizedAt?: Date | null
  objectsPurgedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

export type LookbookPostFactoryOverrides = Partial<LookbookPostFixture>

function buildDefaultLookbookPostFixture(now: Date): LookbookPostFixture {
  const id = faker.string.uuid()
  return {
    id,
    userId: faker.string.uuid(),
    status: 'published',
    caption: 'Curated layering look for temperate climate',
    altText: 'Full length photo of outfit with weather-appropriate layers',
    imageObjectPath: buildCommunityObjectPath(id),
    imageContentType: 'image/jpeg',
    imageChecksum: 'sha256:abcd1234abcd1234',
    imageByteSize: 102400,
    uploadExpiresAt: null,
    // The default fixture is `published`, and a published post is one whose
    // author confirmed the alt text that is stored on it, so the two defaults
    // have to agree the way `status` and `publishedAt` do.
    altTextConfirmedAt: now,
    submittedAt: now,
    // The database rejects a `published` row with a NULL `published_at`, and the
    // feed cursor is built on it, so the default status and the default
    // timestamp have to agree.
    publishedAt: now,
    moderationReason: null,
    moderationEngineVersion: '1.0.0',
    idempotencyKey: faker.string.uuid(),
    locationKey: 'us-il-chicago',
    locale: 'en-US',
    climateBand: 'temperate_dry',
    paletteInsightId: null,
    challengeId: null,
    erasureRequestedAt: null,
    anonymizedAt: null,
    objectsPurgedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function createLookbookPost(
  overrides: LookbookPostFactoryOverrides = {},
  options?: CommunityFactoryOptions
): LookbookPostFixture {
  const now = resolveNow(options)
  const defaults = buildDefaultLookbookPostFixture(now)
  const merged = createFactory<LookbookPostFixture>(() => defaults)(overrides)

  // A caller that overrides only the id still gets a path that matches it,
  // because a path pointing at some other post's folder is not a fixture any
  // test wants and the mismatch is invisible until a purge sweep misses it.
  if (overrides.imageObjectPath === undefined && overrides.id !== undefined) {
    merged.imageObjectPath = buildCommunityObjectPath(merged.id)
  }

  return merged
}

export function buildLookbookPostCreateInput(
  fixture: LookbookPostFixture
): Prisma.LookbookPostUncheckedCreateInput {
  return {
    id: fixture.id,
    user_id: fixture.userId,
    status: fixture.status,
    caption: fixture.caption,
    alt_text: fixture.altText,
    image_object_path: fixture.imageObjectPath,
    image_content_type: fixture.imageContentType,
    image_checksum: fixture.imageChecksum,
    image_byte_size: fixture.imageByteSize,
    upload_expires_at: fixture.uploadExpiresAt,
    alt_text_confirmed_at: fixture.altTextConfirmedAt,
    submitted_at: fixture.submittedAt,
    published_at: fixture.publishedAt,
    moderation_reason: fixture.moderationReason,
    moderation_engine_version: fixture.moderationEngineVersion,
    idempotency_key: fixture.idempotencyKey,
    location_key: fixture.locationKey,
    locale: fixture.locale,
    climate_band: fixture.climateBand,
    palette_insight_id: fixture.paletteInsightId,
    challenge_id: fixture.challengeId,
    erasure_requested_at: fixture.erasureRequestedAt,
    anonymized_at: fixture.anonymizedAt,
    objects_purged_at: fixture.objectsPurgedAt,
    created_at: fixture.createdAt,
    updated_at: fixture.updatedAt,
  }
}

export async function persistLookbookPost(
  prisma: CommunityPrismaClient,
  fixture: LookbookPostFixture
): Promise<LookbookPost> {
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(fixture),
  })

  registerCreatedEntity('lookbookPosts', post.id)
  return post
}

export interface CommunityChallengeFixture {
  id: string
  slug: string
  startsAt: Date
  endsAt: Date
  timeZone: string
  climateBand?: ClimateBand | null
  copy: Prisma.InputJsonValue
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export type CommunityChallengeFactoryOverrides = Partial<CommunityChallengeFixture>

function buildDefaultCommunityChallengeFixture(now: Date): CommunityChallengeFixture {
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  return {
    id: faker.string.uuid(),
    slug: 'challenge-' + faker.string.alphanumeric(8),
    startsAt: now,
    endsAt: nextWeek,
    // The window is Monday-anchored in a named zone; matches the Chicago
    // fixture city the rest of the seeded and factory data uses.
    timeZone: 'America/Chicago',
    climateBand: 'temperate_dry',
    copy: {
      'en-US': {
        title: 'Transitional Trench Challenge',
        body: 'Show us how you style light rain-ready outerwear for early autumn.',
      },
    },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function createCommunityChallenge(
  overrides: CommunityChallengeFactoryOverrides = {},
  options?: CommunityFactoryOptions
): CommunityChallengeFixture {
  const defaults = buildDefaultCommunityChallengeFixture(resolveNow(options))
  return createFactory<CommunityChallengeFixture>(() => defaults)(overrides)
}

export function buildCommunityChallengeCreateInput(
  fixture: CommunityChallengeFixture
): Prisma.CommunityChallengeUncheckedCreateInput {
  return {
    id: fixture.id,
    slug: fixture.slug,
    starts_at: fixture.startsAt,
    ends_at: fixture.endsAt,
    time_zone: fixture.timeZone,
    climate_band: fixture.climateBand,
    copy: fixture.copy,
    is_active: fixture.isActive,
    created_at: fixture.createdAt,
    updated_at: fixture.updatedAt,
  }
}

export async function persistCommunityChallenge(
  prisma: CommunityPrismaClient,
  fixture: CommunityChallengeFixture
): Promise<CommunityChallenge> {
  const challenge = await prisma.communityChallenge.create({
    data: buildCommunityChallengeCreateInput(fixture),
  })

  registerCreatedEntity('communityChallenges', challenge.id)
  return challenge
}

export interface CommunityAliasFixture {
  id: string
  userId: string
  alias: string
  createdAt: Date
}

export type CommunityAliasFactoryOverrides = Partial<CommunityAliasFixture>

function buildDefaultCommunityAliasFixture(now: Date): CommunityAliasFixture {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    // Word plus random suffix, matching the shape the API generates: readable
    // enough to appear in a feed, random enough that it reveals nothing about
    // the account behind it.
    alias: `${faker.word.adjective()}-${faker.string.alphanumeric(8)}`,
    createdAt: now,
  }
}

export function createCommunityAlias(
  overrides: CommunityAliasFactoryOverrides = {},
  options?: CommunityFactoryOptions
): CommunityAliasFixture {
  const defaults = buildDefaultCommunityAliasFixture(resolveNow(options))
  return createFactory<CommunityAliasFixture>(() => defaults)(overrides)
}

export function buildCommunityAliasCreateInput(
  fixture: CommunityAliasFixture
): Prisma.CommunityAliasUncheckedCreateInput {
  return {
    id: fixture.id,
    user_id: fixture.userId,
    alias: fixture.alias,
    created_at: fixture.createdAt,
  }
}

export async function persistCommunityAlias(
  prisma: CommunityPrismaClient,
  fixture: CommunityAliasFixture
): Promise<CommunityAlias> {
  const alias = await prisma.communityAlias.create({
    data: buildCommunityAliasCreateInput(fixture),
  })

  registerCreatedEntity('communityAliases', alias.id)
  return alias
}

export interface CommunityPostReportFixture {
  id: string
  postId?: string | null
  reporterId?: string | null
  reason: CommunityReportReason
  details?: string | null
  contentSnapshot?: Prisma.InputJsonValue | null
  subjectAlias?: string | null
  imageObjectPath?: string | null
  slaDueAt: Date
  createdAt: Date
  resolvedAt?: Date | null
}

export type CommunityPostReportFactoryOverrides = Partial<CommunityPostReportFixture>

/** Moderation service-level agreement: a report is due within 24 hours. */
const REPORT_SLA_MS = 24 * 60 * 60 * 1000

function buildDefaultCommunityPostReportFixture(now: Date): CommunityPostReportFixture {
  return {
    id: faker.string.uuid(),
    postId: faker.string.uuid(),
    reporterId: faker.string.uuid(),
    reason: 'harassment',
    details: 'Reported from the community feed',
    contentSnapshot: { caption: 'Curated layering look for temperate climate' },
    subjectAlias: `${faker.word.adjective()}-${faker.string.alphanumeric(8)}`,
    imageObjectPath: null,
    slaDueAt: new Date(now.getTime() + REPORT_SLA_MS),
    createdAt: now,
    resolvedAt: null,
  }
}

export function createCommunityPostReport(
  overrides: CommunityPostReportFactoryOverrides = {},
  options?: CommunityFactoryOptions
): CommunityPostReportFixture {
  const defaults = buildDefaultCommunityPostReportFixture(resolveNow(options))
  return createFactory<CommunityPostReportFixture>(() => defaults)(overrides)
}

export function buildCommunityPostReportCreateInput(
  fixture: CommunityPostReportFixture
): Prisma.CommunityPostReportUncheckedCreateInput {
  return {
    id: fixture.id,
    post_id: fixture.postId,
    reporter_id: fixture.reporterId,
    reason: fixture.reason,
    details: fixture.details,
    content_snapshot: fixture.contentSnapshot ?? undefined,
    subject_alias: fixture.subjectAlias,
    image_object_path: fixture.imageObjectPath,
    sla_due_at: fixture.slaDueAt,
    created_at: fixture.createdAt,
    resolved_at: fixture.resolvedAt,
  }
}

export async function persistCommunityPostReport(
  prisma: CommunityPrismaClient,
  fixture: CommunityPostReportFixture
): Promise<CommunityPostReport> {
  const report = await prisma.communityPostReport.create({
    data: buildCommunityPostReportCreateInput(fixture),
  })

  registerCreatedEntity('communityPostReports', report.id)
  return report
}

export interface CommunityModerationOutboxFixture {
  id: string
  postId: string
  attempts: number
  lastError?: string | null
  dispatchedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

export type CommunityModerationOutboxFactoryOverrides =
  Partial<CommunityModerationOutboxFixture>

function buildDefaultCommunityModerationOutboxFixture(
  now: Date
): CommunityModerationOutboxFixture {
  return {
    id: faker.string.uuid(),
    postId: faker.string.uuid(),
    attempts: 0,
    lastError: null,
    dispatchedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function createCommunityModerationOutbox(
  overrides: CommunityModerationOutboxFactoryOverrides = {},
  options?: CommunityFactoryOptions
): CommunityModerationOutboxFixture {
  const defaults = buildDefaultCommunityModerationOutboxFixture(resolveNow(options))
  return createFactory<CommunityModerationOutboxFixture>(() => defaults)(overrides)
}

export function buildCommunityModerationOutboxCreateInput(
  fixture: CommunityModerationOutboxFixture
): Prisma.CommunityModerationOutboxUncheckedCreateInput {
  return {
    id: fixture.id,
    post_id: fixture.postId,
    attempts: fixture.attempts,
    last_error: fixture.lastError,
    dispatched_at: fixture.dispatchedAt,
    created_at: fixture.createdAt,
    updated_at: fixture.updatedAt,
  }
}

export async function persistCommunityModerationOutbox(
  prisma: CommunityPrismaClient,
  fixture: CommunityModerationOutboxFixture
): Promise<CommunityModerationOutbox> {
  const entry = await prisma.communityModerationOutbox.create({
    data: buildCommunityModerationOutboxCreateInput(fixture),
  })

  registerCreatedEntity('communityModerationOutboxEntries', entry.id)
  return entry
}

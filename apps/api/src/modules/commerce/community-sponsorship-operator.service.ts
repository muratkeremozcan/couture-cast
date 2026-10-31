// Story 6.7b operator transaction owner: link, end, dry run and audit rows in `apps/api/src/modules/commerce/community-sponsorship-operator.service.ts`, entered through `scripts/community-sponsorship.ts`
import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { PUBLICLY_VISIBLE_POST_WHERE } from '../community/community.repository.js'
import { hasReachedAgeOfMajority } from '../guardian/guardian.service.js'
import {
  COMMUNITY_SPONSORSHIP_AGREEMENT_PATTERN,
  COMMUNITY_SPONSORSHIP_END_REASONS,
  COMMUNITY_SPONSORSHIP_ENDED_EVENT,
  COMMUNITY_SPONSORSHIP_LINK_REASONS,
  COMMUNITY_SPONSORSHIP_LINKED_EVENT,
  normalizeAgreementReference,
  type CommunitySponsorshipEndReason,
  type CommunitySponsorshipLinkReason,
} from './community-sponsorship.constants.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

export type CommunitySponsorshipRefusalCode =
  | 'reason_invalid'
  | 'agreement_invalid'
  | 'window_invalid'
  | 'window_in_past'
  | 'actor_auth_user_missing'
  | 'actor_not_admin'
  | 'actor_app_user_missing'
  | 'actor_identity_mismatch'
  | 'post_not_public'
  | 'author_not_adult'
  | 'offer_missing'
  | 'offer_not_garment'
  | 'link_already_open'
  | 'no_open_link'

/** A rule refused the command. Nothing was written. */
export class CommunitySponsorshipRefusal extends Error {
  constructor(
    readonly code: CommunitySponsorshipRefusalCode,
    message: string
  ) {
    super(message)
    this.name = 'CommunitySponsorshipRefusal'
  }
}

export type LinkCommunitySponsorshipInput = {
  readonly actorEmail: string
  readonly postId: string
  readonly offerId: string
  readonly reason: string
  readonly authorAgreement: string
  /** Defaults to the database clock's current UTC time. */
  readonly startsAt?: Date | undefined
  /** Defaults to NULL, an open-ended link. */
  readonly endsAt?: Date | undefined
  readonly dryRun: boolean
}

export type EndCommunitySponsorshipInput = {
  readonly actorEmail: string
  readonly postId: string
  readonly reason: string
  readonly dryRun: boolean
}

export type CommunitySponsorshipLinkOutcome = {
  readonly dryRun: boolean
  /** Null on a dry run, which writes nothing. */
  readonly sponsorshipId: string | null
  readonly actorUserId: string
  readonly postId: string
  readonly offerId: string
  readonly startsAt: Date
  readonly endsAt: Date | null
  readonly reason: CommunitySponsorshipLinkReason
  readonly authorAgreement: string
}

export type CommunitySponsorshipEndOutcome = {
  readonly dryRun: boolean
  readonly sponsorshipId: string
  readonly actorUserId: string
  readonly postId: string
  readonly offerId: string
  /** The database clock's time the link ended, or would end on a dry run. */
  readonly endedAt: Date
  readonly reason: CommunitySponsorshipEndReason
}

const linkReasonSchema = z.enum(COMMUNITY_SPONSORSHIP_LINK_REASONS)
const endReasonSchema = z.enum(COMMUNITY_SPONSORSHIP_END_REASONS)

const authUserRowSchema = z.object({
  email: z.string().nullable(),
  raw_app_meta_data: z.record(z.unknown()).nullable(),
})

/** Thrown inside a dry-run transaction so every read ran and nothing commits. */
class DryRunRollback extends Error {}

type Tx = Prisma.TransactionClient

/**
 * Story 6.7b: the owner's only way to create or end a community sponsorship
 * link. There is no HTTP route; `scripts/community-sponsorship.ts` wraps this
 * service, and the moderator console (Story 6.10) can call it through Nest.
 *
 * Every refusal is decided before any write, and the link and its `AuditLog`
 * row commit in one transaction, so a refused or failed command leaves nothing
 * behind. A dry run performs every read and check inside a transaction it then
 * rolls back.
 */
@Injectable()
export class CommunitySponsorshipOperatorService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async link(
    input: LinkCommunitySponsorshipInput
  ): Promise<CommunitySponsorshipLinkOutcome> {
    const reason = parseReason(linkReasonSchema, input.reason, 'link')
    const authorAgreement = normalizeAgreementReference(input.authorAgreement)
    if (!COMMUNITY_SPONSORSHIP_AGREEMENT_PATTERN.test(authorAgreement)) {
      throw new CommunitySponsorshipRefusal(
        'agreement_invalid',
        '--author-agreement must be an agr_ ULID, the id of the off-system author agreement record.'
      )
    }
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
      throw windowInvalid()
    }

    return this.runInTransaction(input.dryRun, async (tx) => {
      const now = await databaseNow(tx)
      const startsAt = input.startsAt ?? now
      const endsAt = input.endsAt ?? null
      if (endsAt && endsAt <= startsAt) throw windowInvalid()
      if (endsAt && endsAt <= now) {
        throw new CommunitySponsorshipRefusal(
          'window_in_past',
          '--ends-at is already in the past; the link would never be shown.'
        )
      }

      const actorUserId = await resolveAdminActor(tx, input.actorEmail)
      await assertSponsorablePost(tx, input.postId, now)
      await assertGarmentOffer(tx, input.offerId)

      const open = await tx.communityPostSponsorship.findFirst({
        where: { post_id: input.postId, ended_at: null },
        select: { id: true },
      })
      if (open) throw linkAlreadyOpen(open.id)

      const plan = {
        actorUserId,
        postId: input.postId,
        offerId: input.offerId,
        startsAt,
        endsAt,
        reason,
        authorAgreement,
      }
      if (input.dryRun) {
        return { ...plan, dryRun: true, sponsorshipId: null }
      }

      const created = await createLink(tx, plan)
      await tx.auditLog.create({
        data: {
          user_id: actorUserId,
          event_type: COMMUNITY_SPONSORSHIP_LINKED_EVENT,
          event_data: {
            sponsorshipId: created.id,
            postId: input.postId,
            offerId: input.offerId,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt?.toISOString() ?? null,
            reason,
            authorAgreement,
          },
        },
      })
      return { ...plan, dryRun: false, sponsorshipId: created.id }
    })
  }

  async end(
    input: EndCommunitySponsorshipInput
  ): Promise<CommunitySponsorshipEndOutcome> {
    const reason = parseReason(endReasonSchema, input.reason, 'end')

    return this.runInTransaction(input.dryRun, async (tx) => {
      const now = await databaseNow(tx)
      const actorUserId = await resolveAdminActor(tx, input.actorEmail)
      const open = await tx.communityPostSponsorship.findFirst({
        where: { post_id: input.postId, ended_at: null },
        select: { id: true, offer_id: true, starts_at: true, ends_at: true },
      })
      if (!open) {
        throw new CommunitySponsorshipRefusal(
          'no_open_link',
          `Post ${input.postId} has no open sponsorship link to end.`
        )
      }

      const outcome = {
        sponsorshipId: open.id,
        actorUserId,
        postId: input.postId,
        offerId: open.offer_id,
        endedAt: now,
        reason,
      }
      if (input.dryRun) {
        return { ...outcome, dryRun: true }
      }

      // Conditional on `ended_at IS NULL`, so a concurrent end cannot stamp the
      // row twice or write a second audit row.
      const ended = await tx.communityPostSponsorship.updateMany({
        where: { id: open.id, ended_at: null },
        data: { ended_at: now, ended_by_id: actorUserId, end_reason: reason },
      })
      if (ended.count !== 1) {
        throw new CommunitySponsorshipRefusal(
          'no_open_link',
          `Sponsorship ${open.id} was ended by another command first.`
        )
      }

      await tx.auditLog.create({
        data: {
          user_id: actorUserId,
          event_type: COMMUNITY_SPONSORSHIP_ENDED_EVENT,
          event_data: {
            sponsorshipId: open.id,
            postId: input.postId,
            offerId: open.offer_id,
            startsAt: open.starts_at.toISOString(),
            endsAt: open.ends_at?.toISOString() ?? null,
            endedAt: now.toISOString(),
            reason,
            authorAgreement: await findLinkedAgreement(tx, open.id),
          },
        },
      })
      return { ...outcome, dryRun: false }
    })
  }

  /**
   * One transaction for every read and write. A dry run throws a private
   * sentinel after building its outcome, so Prisma rolls back whatever ran and
   * the outcome is returned from outside the transaction.
   */
  private async runInTransaction<T>(
    dryRun: boolean,
    work: (tx: Tx) => Promise<T>
  ): Promise<T> {
    let planned: T | undefined
    try {
      return await interactiveTransaction(this.prisma, async (tx) => {
        const result = await work(tx)
        if (!dryRun) return result
        planned = result
        throw new DryRunRollback()
      })
    } catch (error: unknown) {
      if (error instanceof DryRunRollback && planned !== undefined) return planned
      throw error
    }
  }
}

function parseReason<T extends string>(
  schema: z.ZodEnum<[T, ...T[]]>,
  raw: string,
  command: 'link' | 'end'
): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new CommunitySponsorshipRefusal(
      'reason_invalid',
      `--reason for ${command} must be one of: ${schema.options.join(', ')}.`
    )
  }
  return parsed.data
}

function windowInvalid(): CommunitySponsorshipRefusal {
  return new CommunitySponsorshipRefusal(
    'window_invalid',
    '--ends-at must be later than --starts-at.'
  )
}

function linkAlreadyOpen(sponsorshipId: string): CommunitySponsorshipRefusal {
  return new CommunitySponsorshipRefusal(
    'link_already_open',
    `This post already has open sponsorship link ${sponsorshipId}; end it first.`
  )
}

/**
 * The database clock as a naive UTC timestamp, the same frame the window
 * columns are written and compared in.
 */
async function databaseNow(tx: Tx): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>(
    Prisma.sql`SELECT (now() AT TIME ZONE 'UTC') AS now`
  )
  const now = rows[0]?.now
  if (!(now instanceof Date)) throw new Error('database clock unavailable')
  return now
}

/**
 * The acting owner, resolved in the same Postgres the command writes to.
 *
 * The Supabase auth user's `app_metadata.app_role` must be `admin`, the same
 * claim the API authorizes requests on. It maps to the app `User` through
 * `app_metadata.app_user_id`, or by email when that is absent, and the two
 * identities must name the same email. Any gap refuses.
 */
async function resolveAdminActor(tx: Tx, actorEmail: string): Promise<string> {
  const email = actorEmail.trim().toLowerCase()
  const rows = await tx.$queryRaw<unknown[]>(Prisma.sql`
    SELECT email, raw_app_meta_data
    FROM auth.users
    WHERE lower(email) = ${email}
  `)
  if (rows.length !== 1) {
    throw new CommunitySponsorshipRefusal(
      'actor_auth_user_missing',
      'No single auth user has that --actor-email.'
    )
  }
  const authUser = authUserRowSchema.parse(rows[0])
  const appMetadata = authUser.raw_app_meta_data ?? {}
  if (appMetadata.app_role !== 'admin') {
    throw new CommunitySponsorshipRefusal(
      'actor_not_admin',
      'The --actor-email auth user does not carry app_role admin.'
    )
  }

  const appUserId =
    typeof appMetadata.app_user_id === 'string' && appMetadata.app_user_id.trim()
      ? appMetadata.app_user_id.trim()
      : undefined
  const appUser = await tx.user.findUnique({
    where: appUserId ? { id: appUserId } : { email },
    select: { id: true, email: true },
  })
  if (!appUser) {
    throw new CommunitySponsorshipRefusal(
      'actor_app_user_missing',
      'The --actor-email auth user has no app user.'
    )
  }
  if (appUser.email.toLowerCase() !== email) {
    throw new CommunitySponsorshipRefusal(
      'actor_identity_mismatch',
      'The auth user and its app user name different emails.'
    )
  }
  return appUser.id
}

/** The post must be publicly visible and written by an adult author. */
async function assertSponsorablePost(tx: Tx, postId: string, now: Date): Promise<void> {
  const post = await tx.lookbookPost.findFirst({
    where: { id: postId, ...PUBLICLY_VISIBLE_POST_WHERE },
    select: { user: { select: { profile: { select: { birthdate: true } } } } },
  })
  if (!post) {
    throw new CommunitySponsorshipRefusal(
      'post_not_public',
      `Post ${postId} is not publicly visible.`
    )
  }
  if (!hasReachedAgeOfMajority(post.user.profile?.birthdate, now)) {
    throw new CommunitySponsorshipRefusal(
      'author_not_adult',
      `The author of post ${postId} has not reached the age of majority.`
    )
  }
}

/** Only a garment offer can be linked; advisor offers belong to the advisor. */
async function assertGarmentOffer(tx: Tx, offerId: string): Promise<void> {
  const offer = await tx.affiliateOffer.findUnique({
    where: { id: offerId },
    select: { advisor_slot: true, garment_category: true },
  })
  if (!offer) {
    throw new CommunitySponsorshipRefusal(
      'offer_missing',
      `Offer ${offerId} does not exist.`
    )
  }
  if (offer.advisor_slot !== null || offer.garment_category === null) {
    throw new CommunitySponsorshipRefusal(
      'offer_not_garment',
      `Offer ${offerId} is not a garment offer.`
    )
  }
}

/**
 * Inserts the link. A concurrent command that opened a link on the same post
 * first trips the partial unique index; that is the same refusal as finding
 * the open link up front.
 */
async function createLink(
  tx: Tx,
  plan: {
    readonly actorUserId: string
    readonly postId: string
    readonly offerId: string
    readonly startsAt: Date
    readonly endsAt: Date | null
    readonly reason: CommunitySponsorshipLinkReason
  }
): Promise<{ id: string }> {
  try {
    return await tx.communityPostSponsorship.create({
      data: {
        post_id: plan.postId,
        offer_id: plan.offerId,
        starts_at: plan.startsAt,
        ends_at: plan.endsAt,
        created_by_id: plan.actorUserId,
        create_reason: plan.reason,
      },
      select: { id: true },
    })
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new CommunitySponsorshipRefusal(
        'link_already_open',
        'This post already has an open sponsorship link; end it first.'
      )
    }
    throw error
  }
}

/** The agreement reference recorded when this link was created, if any. */
async function findLinkedAgreement(
  tx: Tx,
  sponsorshipId: string
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ agreement: string | null }[]>(Prisma.sql`
    SELECT event_data->>'authorAgreement' AS agreement
    FROM "AuditLog"
    WHERE event_type = ${COMMUNITY_SPONSORSHIP_LINKED_EVENT}
      AND event_data->>'sponsorshipId' = ${sponsorshipId}
    ORDER BY "timestamp" DESC
    LIMIT 1
  `)
  return rows[0]?.agreement ?? null
}

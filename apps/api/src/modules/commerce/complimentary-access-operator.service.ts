// Story 6.14 operator transaction owner: grant, revoke, list, audit rows and flag-cache
// invalidation, entered through `scripts/complimentary-access.ts`.
import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import {
  communityPrivacyTransaction,
  guardCommunitySubject,
} from '../community/community-privacy.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'
import { resolveOperatorAdmin, type OperatorActorRefusalCode } from './operator-actor.js'

export const COMPLIMENTARY_ACCESS_GRANTED_EVENT = 'complimentary_access_granted'
export const COMPLIMENTARY_ACCESS_REVOKED_EVENT = 'complimentary_access_revoked'
export const COMPLIMENTARY_ACCESS_REASON_MAX = 200
/** What `list` prints for a granter whose account was erased. */
export const ERASED_OPERATOR_LABEL = '[erased]'

export type ComplimentaryAccessRefusalCode =
  | OperatorActorRefusalCode
  | 'actor_erasure_requested'
  | 'member_not_found'
  | 'member_erasure_requested'
  | 'already_granted'
  | 'no_active_grant'
  | 'invalid_reason'

/** A rule refused the command. Nothing was written. */
export class ComplimentaryAccessRefusal extends Error {
  constructor(
    readonly code: ComplimentaryAccessRefusalCode,
    message: string
  ) {
    super(message)
    this.name = 'ComplimentaryAccessRefusal'
  }
}

export type ComplimentaryAccessChangeInput = {
  readonly actorEmail: string
  readonly memberEmail: string
  readonly reason: string
  readonly dryRun: boolean
}

export type ComplimentaryAccessGrantOutcome = {
  readonly dryRun: boolean
  /** Null on a dry run, which writes nothing. */
  readonly grantId: string | null
  readonly actorUserId: string
  readonly memberId: string
}

export type ComplimentaryAccessRevokeOutcome = {
  readonly dryRun: boolean
  readonly grantId: string
  readonly actorUserId: string
  readonly memberId: string
}

export type ComplimentaryAccessListing = {
  readonly grants: readonly {
    readonly grantId: string
    readonly memberEmail: string
    readonly reason: string
    readonly granterEmail: string
    readonly grantedAt: Date
  }[]
}

type Tx = Prisma.TransactionClient

/** Thrown inside a dry-run transaction so every read ran and nothing commits. */
class DryRunRollback extends Error {}

/**
 * Story 6.14 D1, D7: one place builds both audit rows. `AuditLog` is immutable and holds the
 * actor and the grant id only; member, reason and time live on the grant row, which account
 * erasure deletes (6.13 ruled that no member id enters `AuditLog`).
 */
export function buildComplimentaryAccessAuditRow(
  actorUserId: string,
  event:
    | typeof COMPLIMENTARY_ACCESS_GRANTED_EVENT
    | typeof COMPLIMENTARY_ACCESS_REVOKED_EVENT,
  grantId: string
): Prisma.AuditLogUncheckedCreateInput {
  return { user_id: actorUserId, event_type: event, event_data: { grantId } }
}

/**
 * Story 6.14 D7: the owner's only way to grant or revoke complimentary full access. There is
 * no HTTP route. Every refusal is decided before any write. The grant row, its audit row and
 * the member's flag-cache invalidation commit in one transaction, so a refused or failed
 * command leaves nothing behind. A dry run performs every read and check, then rolls back.
 */
@Injectable()
export class ComplimentaryAccessOperatorService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async grant(
    input: ComplimentaryAccessChangeInput
  ): Promise<ComplimentaryAccessGrantOutcome> {
    const reason = parseReason(input.reason)
    try {
      return await this.runLocked(input.dryRun, async (tx) => {
        const { actorUserId, memberId } = await this.lockParties(tx, input)
        const active = await activeGrant(tx, memberId)
        if (active) throw alreadyGranted(active.id)
        const created = await tx.complimentaryAccessGrant.create({
          data: {
            member_id: memberId,
            reason,
            granted_by_id: actorUserId,
            granted_at: await databaseNow(tx),
          },
          select: { id: true },
        })
        await tx.auditLog.create({
          data: buildComplimentaryAccessAuditRow(
            actorUserId,
            COMPLIMENTARY_ACCESS_GRANTED_EVENT,
            created.id
          ),
        })
        await forgetCommunityReadGrant(tx, memberId)
        return {
          dryRun: input.dryRun,
          grantId: input.dryRun ? null : created.id,
          actorUserId,
          memberId,
        }
      })
    } catch (error: unknown) {
      // TEA-10: a concurrent grant that committed first surfaces as the partial unique index.
      if (isUniqueViolation(error)) throw alreadyGranted(null)
      throw error
    }
  }

  async revoke(
    input: ComplimentaryAccessChangeInput
  ): Promise<ComplimentaryAccessRevokeOutcome> {
    const reason = parseReason(input.reason)
    return this.runLocked(input.dryRun, async (tx) => {
      const { actorUserId, memberId } = await this.lockParties(tx, input)
      const active = await activeGrant(tx, memberId)
      if (!active) throw noActiveGrant()
      // TEA-10: the count decides, so a concurrent revoke that won answers no_active_grant.
      const revoked = await tx.complimentaryAccessGrant.updateMany({
        where: { id: active.id, revoked_at: null },
        data: {
          revoked_at: await databaseNow(tx),
          revoked_by_id: actorUserId,
          revoke_reason: reason,
        },
      })
      if (revoked.count !== 1) throw noActiveGrant()
      await tx.auditLog.create({
        data: buildComplimentaryAccessAuditRow(
          actorUserId,
          COMPLIMENTARY_ACCESS_REVOKED_EVENT,
          active.id
        ),
      })
      await forgetCommunityReadGrant(tx, memberId)
      return { dryRun: input.dryRun, grantId: active.id, actorUserId, memberId }
    })
  }

  async list(actorEmail: string): Promise<ComplimentaryAccessListing> {
    return interactiveTransaction(this.prisma, async (tx) => {
      await resolveActor(tx, actorEmail)
      const rows = await tx.complimentaryAccessGrant.findMany({
        where: { revoked_at: null },
        orderBy: { granted_at: 'asc' },
        select: {
          id: true,
          reason: true,
          granted_at: true,
          member: { select: { email: true } },
          granter: { select: { email: true } },
        },
      })
      return {
        grants: rows.map((row) => ({
          grantId: row.id,
          memberEmail: row.member.email,
          reason: row.reason,
          granterEmail: row.granter?.email ?? ERASED_OPERATOR_LABEL,
          grantedAt: row.granted_at,
        })),
      }
    })
  }

  /**
   * TEA-09, TEA-21: the actor's and the member's privacy guard and `community_member:` lock,
   * in sorted id order, the order account erasure takes them, before either erasure request is
   * read. A grant therefore cannot slip in beside a racing erasure, and an operator with a
   * pending erasure cannot write their id back onto a grant.
   */
  private async lockParties(
    tx: Tx,
    input: ComplimentaryAccessChangeInput
  ): Promise<{ actorUserId: string; memberId: string }> {
    const actorUserId = await resolveActor(tx, input.actorEmail)
    const member = await tx.user.findUnique({
      where: { email: input.memberEmail.trim().toLowerCase() },
      select: { id: true },
    })
    if (!member) {
      throw new ComplimentaryAccessRefusal(
        'member_not_found',
        'No app user has that --member-email.'
      )
    }
    const parties = [...new Set([actorUserId, member.id])].sort()
    // Both members' privacy guards in one call first, in the function's own order, as the push
    // send guard and notifications worker take them, so this command cannot deadlock with them.
    await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${Prisma.join(parties)}]::text[],ARRAY[]::text[],true)`
    for (const id of parties) {
      await guardCommunitySubject(tx, id)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${id}))`
    }
    const requests = await tx.moderationErasureRequest.findMany({
      where: { member_id: { in: [actorUserId, member.id] } },
      select: { member_id: true },
    })
    const requested = new Set(requests.map((row) => row.member_id))
    if (requested.has(actorUserId)) {
      throw new ComplimentaryAccessRefusal(
        'actor_erasure_requested',
        'The --actor-email account has a pending erasure request.'
      )
    }
    if (requested.has(member.id)) {
      throw new ComplimentaryAccessRefusal(
        'member_erasure_requested',
        'The --member-email account has a pending erasure request.'
      )
    }
    return { actorUserId, memberId: member.id }
  }

  private async runLocked<T>(dryRun: boolean, work: (tx: Tx) => Promise<T>): Promise<T> {
    let planned: T | undefined
    try {
      return await communityPrivacyTransaction(this.prisma, async (tx) => {
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

/**
 * The database clock as a naive UTC timestamp, the frame Prisma writes and reads, so grant and
 * revoke times come from one clock whatever the operator machine's clock says (6.7b pattern).
 */
async function databaseNow(tx: Tx): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>(
    Prisma.sql`SELECT (now() AT TIME ZONE 'UTC') AS now`
  )
  const now = rows[0]?.now
  if (!(now instanceof Date)) throw new Error('database clock unavailable')
  return now
}

function resolveActor(tx: Tx, actorEmail: string): Promise<string> {
  return resolveOperatorAdmin(
    tx,
    actorEmail,
    (code, message) => new ComplimentaryAccessRefusal(code, message)
  )
}

function activeGrant(tx: Tx, memberId: string) {
  return tx.complimentaryAccessGrant.findFirst({
    where: { member_id: memberId, revoked_at: null },
    select: { id: true },
  })
}

/**
 * TEA-01: delete the member's cached community read answer under the privacy guards, as
 * `community_forget_subject` does, so the next request evaluates afresh with no claim lease
 * left to wait out and no in-flight refresh able to write the old answer back.
 */
async function forgetCommunityReadGrant(tx: Tx, memberId: string): Promise<void> {
  await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${memberId}]::text[],ARRAY[]::text[],false)`
  await tx.$executeRaw`DELETE FROM "CommunityFlagEvaluation" WHERE member_id = ${memberId}`
}

function parseReason(raw: string): string {
  const reason = raw.trim()
  if (reason.length < 1 || reason.length > COMPLIMENTARY_ACCESS_REASON_MAX) {
    throw new ComplimentaryAccessRefusal(
      'invalid_reason',
      `--reason must be 1 to ${COMPLIMENTARY_ACCESS_REASON_MAX} characters.`
    )
  }
  return reason
}

function alreadyGranted(grantId: string | null): ComplimentaryAccessRefusal {
  return new ComplimentaryAccessRefusal(
    'already_granted',
    grantId
      ? `This member already has active grant ${grantId}; revoke it first.`
      : 'This member already has an active grant; revoke it first.'
  )
}

function noActiveGrant(): ComplimentaryAccessRefusal {
  return new ComplimentaryAccessRefusal(
    'no_active_grant',
    'This member has no active grant.'
  )
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

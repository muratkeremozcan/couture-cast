import { recordCommunityAttemptOutcome } from './community-operational-telemetry.js'
// Story 6.5 owner: bounded server-enforced handoff and durable uncertainty.
import { randomUUID } from 'node:crypto'
import { ForbiddenException } from '@nestjs/common'
import {
  Prisma,
  type PrismaClient,
  type CommunityDeliveryAttempt,
  type CommunityArtifactSubject,
  type CommunityNotificationIntent,
} from '@prisma/client'
import type { CommunityFlagEvaluationService } from '../feature-flags/community-flag-evaluation.service.js'
import { CommunityUnavailableException } from './community-availability.js'
import { assertCommunityDatabaseAccess } from './community-access.service.js'
import {
  CommunityPushProvider,
  type CommunityPushMessage,
} from './community-push-provider.js'
import {
  communityPushCopy,
  nextAllowedCommunityInstant,
  type CommunityPushOutcome,
} from './community-push-policy.js'
import { PUBLICLY_VISIBLE_POST_WHERE } from './community.repository.js'

type Delivery = Prisma.CommunityTokenDeliveryGetPayload<{
  include: { group: { include: { intents: true } } }
}>
type Context = CommunityArtifactSubject
type Authorization =
  | { status: 'send'; message: CommunityPushMessage }
  | {
      status: 'deferred' | 'suppressed' | 'expired'
      reason: string
      next?: Date
    }
const pending = ['pending', 'deferred', 'retryable_rejection']
const noCall = (reason: string, next?: Date): Authorization => ({
  status: 'deferred',
  reason: `no_call:${reason}`,
  next: next ?? new Date(Date.now() + 2000),
})

export class CommunitySendGuard {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly flags: Pick<CommunityFlagEvaluationService, 'evaluate'>,
    private readonly provider = new CommunityPushProvider()
  ) {}

  async verifyRuntime(): Promise<void> {
    const version = await this.prisma.$queryRaw<
      { version: number; privacy_version: number }[]
    >`
      SELECT current_setting('server_version_num')::integer AS version, privacy_version
      FROM "CommunityRuntimeCapability" WHERE id = 1
    `
    if (!version[0] || version[0].version < 170000 || version[0].privacy_version < 1)
      throw new Error('Community dispatch capability unavailable.')
    await this.prisma.$transaction(async (tx) => {
      await this.configure(tx)
      const [settings] = await tx.$queryRaw<
        { transaction: string; idle: string; statement: string; lock: string }[]
      >`
        SELECT current_setting('transaction_timeout') AS transaction,
          current_setting('idle_in_transaction_session_timeout') AS idle,
          current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock
      `
      const expected = {
        transaction: '3s',
        idle: '3s',
        statement: '500ms',
        lock: '250ms',
      }
      if (JSON.stringify(settings) !== JSON.stringify(expected))
        throw new Error('Community dispatch server timeouts ineffective.')
    })
  }

  private async configure(tx: Prisma.TransactionClient) {
    await tx.$executeRawUnsafe("SET LOCAL transaction_timeout = '3s'")
    await tx.$executeRawUnsafe("SET LOCAL idle_in_transaction_session_timeout = '3s'")
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '500ms'")
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '250ms'")
  }
  private contexts(tx: Prisma.TransactionClient, group: string) {
    return tx.communityArtifactSubject.findMany({
      where: { artifact_kind: 'group', artifact_id: group },
      orderBy: [{ member_id: 'asc' }, { role: 'asc' }],
    })
  }
  private async initiatedCount(tx: Prisma.TransactionClient, delivery: string) {
    return tx.communityDeliveryAttempt.count({
      where: {
        delivery_id: delivery,
        OR: [{ reason: null }, { NOT: { reason: { startsWith: 'no_call:' } } }],
      },
    })
  }

  private async claim(delivery: Delivery, contexts: Context[], owner: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL transaction_timeout = '500ms'")
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'")
      await this.lockPrivacy(tx, delivery, contexts)
      if (
        JSON.stringify(await this.contexts(tx, delivery.group_id)) !==
          JSON.stringify(contexts) ||
        !(await this.validSubjects(tx, contexts))
      )
        return null
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "CommunityTokenDelivery"
        WHERE id = ${delivery.id}::uuid AND status IN ('pending','deferred','retryable_rejection')
          AND next_attempt_at <= clock_timestamp() FOR UPDATE SKIP LOCKED`
      if (!locked.length) return null
      if ((await this.initiatedCount(tx, delivery.id)) >= 3) {
        await tx.communityTokenDelivery.update({
          where: { id: delivery.id },
          data: { status: 'failed' },
        })
        return null
      }
      const ordinal =
        (await tx.communityDeliveryAttempt.count({
          where: { delivery_id: delivery.id },
        })) + 1
      const [attempt] = await tx.$queryRaw<CommunityDeliveryAttempt[]>`
        INSERT INTO "CommunityDeliveryAttempt" (id,delivery_id,ordinal,status,lease_owner,lease_until,guard_until)
        VALUES (${randomUUID()}::uuid,${delivery.id}::uuid,${ordinal},'sending',${owner}::uuid,
          clock_timestamp()+interval '10 seconds',clock_timestamp()+interval '3 seconds') RETURNING *
      `
      await tx.communityTokenDelivery.update({
        where: { id: delivery.id },
        data: { status: 'sending' },
      })
      await tx.communityArtifactSubject.createMany({
        data: contexts.map((subject) => ({
          ...subject,
          artifact_kind: 'attempt',
          artifact_id: attempt!.id,
        })),
        skipDuplicates: true,
      })
      return attempt!
    })
  }

  async dispatch(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.communityTokenDelivery.findUnique({
      where: { id: deliveryId },
      include: { group: { include: { intents: true } } },
    })
    if (
      !delivery?.owner_id ||
      !delivery.group.post_id ||
      !pending.includes(delivery.status)
    )
      return
    let evaluation: Awaited<ReturnType<CommunityFlagEvaluationService['evaluate']>>
    try {
      evaluation = await this.flags.evaluate(delivery.owner_id)
    } catch (error) {
      if (!(error instanceof CommunityUnavailableException)) throw error
      const next = new Date(
        Math.min(
          delivery.group.expires_at.getTime(),
          Date.now() + Math.max(2, error.retryAfterSeconds) * 1000
        )
      )
      await this.prisma.communityTokenDelivery.updateMany({
        where: {
          id: delivery.id,
          owner_id: delivery.owner_id,
          binding_generation: delivery.binding_generation,
          status: { in: pending },
          next_attempt_at: delivery.next_attempt_at,
        },
        data: {
          status: delivery.group.expires_at <= new Date() ? 'expired' : 'deferred',
          next_attempt_at: next,
        },
      })
      return
    }
    if (!evaluation.value) {
      await this.suppress(deliveryId)
      return
    }
    const contexts = await this.contexts(this.prisma, delivery.group_id)
    if (!contexts.length) {
      await this.suppress(deliveryId)
      return
    }
    const owner = randomUUID()
    const attempt = await this.claim(delivery, contexts, owner)
    if (!attempt) return
    const abort = new AbortController()
    const deadline = performance.now() + 2000
    const timeout = setTimeout(() => abort.abort(), 2000)
    let invoked = false
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await this.configure(tx)
          await this.lock(tx, delivery, attempt, contexts)
          const authorization = await this.authorize(tx, delivery, contexts)
          if (authorization.status !== 'send') {
            await this.finish(tx, attempt, owner, authorization, authorization.next)
            return
          }
          if (abort.signal.aborted || performance.now() >= deadline)
            throw new Error('Community pre-send deadline')
          const [grant] = await tx.$queryRaw<{ valid: boolean }[]>`SELECT EXISTS (
            SELECT 1 FROM "CommunityFlagEvaluation" e JOIN "CommunitySubject" s ON s.member_id=e.member_id AND s.generation=e.subject_generation
            WHERE e.member_id=${delivery.owner_id} AND e.flag_key='community_read_enabled' AND e.remote_value=true AND e.expires_at>clock_timestamp()
          ) AS valid`
          if (!grant?.valid || abort.signal.aborted || performance.now() >= deadline)
            throw new CommunityUnavailableException()
          invoked = true
          const outcome = await this.provider.send(authorization.message, abort.signal)
          await this.complete(tx, attempt, owner, outcome)
        },
        { timeout: 3000, maxWait: 250 }
      )
    } catch {
      abort.abort()
      await this.prisma.$transaction((tx) =>
        this.finish(
          tx,
          attempt,
          owner,
          {
            status: invoked ? 'unknown' : 'deferred',
            reason: invoked ? 'handoff_uncertain' : 'no_call:guard_failure',
          },
          invoked ? undefined : new Date(Date.now() + 2000)
        )
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  private async lock(
    tx: Prisma.TransactionClient,
    delivery: Delivery,
    attempt: CommunityDeliveryAttempt,
    contexts: Context[]
  ) {
    await this.lockPrivacy(tx, delivery, contexts)
    await tx.$queryRaw`SELECT id FROM "PushToken" WHERE id = ${delivery.registration_id} FOR SHARE`
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "CommunityDeliveryAttempt" WHERE id = ${attempt.id}::uuid
      AND lease_owner = ${attempt.lease_owner}::uuid AND status = 'sending' AND lease_until > clock_timestamp() FOR UPDATE`
    if (!locked.length) throw new Error('Community attempt ownership lost')
  }

  private async lockPrivacy(
    tx: Prisma.TransactionClient,
    delivery: Delivery,
    contexts: Context[]
  ) {
    const members = [...new Set(contexts.map((s) => s.member_id))]
    await tx.$executeRaw(
      Prisma.sql`SELECT community_privacy_guards(ARRAY[${Prisma.join(members)}]::text[],ARRAY[${delivery.group.post_id}]::text[],false)`
    )
  }

  private async authorize(
    tx: Prisma.TransactionClient,
    delivery: Delivery,
    contexts: Context[]
  ): Promise<Authorization> {
    const currentContexts = await this.contexts(tx, delivery.group_id)
    if (JSON.stringify(currentContexts) !== JSON.stringify(contexts))
      return noCall('subjects_changed')
    if (!(await this.validSubjects(tx, contexts))) return noCall('subject_generation')
    const current = await tx.communityTokenDelivery.findUnique({
      where: { id: delivery.id },
      include: { group: { include: { intents: true } } },
    })
    if (!current?.owner_id || !current.group.post_id)
      return { status: 'suppressed', reason: 'no_call:missing_group' }
    const policy = await tx.notificationPreference.findUnique({
      where: { user_id: current.owner_id },
    })
    const preference = await tx.communityNotificationPreference.findUnique({
      where: { user_id: current.owner_id },
    })
    if (!policy?.push_enabled || !preference?.enabled)
      return { status: 'suppressed', reason: 'no_call:opt_out' }
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const now = clock!.now
    if (current.group.expires_at <= now)
      return { status: 'expired', reason: 'no_call:expired' }
    const flag = await tx.communityFlagEvaluation.findUnique({
      where: {
        member_id_flag_key: {
          member_id: current.owner_id,
          flag_key: 'community_read_enabled',
        },
      },
    })
    const recipient = contexts.find((subject) => subject.member_id === current.owner_id)
    if (
      !flag?.expires_at ||
      flag.expires_at <= now ||
      flag.subject_generation !== recipient?.generation
    )
      return noCall('unavailable')
    if (!flag.remote_value)
      return { status: 'suppressed', reason: 'no_call:read_disabled' }
    return this.authorizeSource(tx, current, preference.generation, policy, now)
  }

  private async authorizeSource(
    tx: Prisma.TransactionClient,
    current: Delivery,
    generation: number,
    policy: Prisma.NotificationPreferenceGetPayload<Record<string, never>>,
    now: Date
  ): Promise<Authorization> {
    const token = await tx.pushToken.findFirst({
      where: {
        id: current.registration_id,
        user_id: current.owner_id!,
        binding_generation: current.binding_generation,
        permission: 'granted',
        last_used_at: { gt: new Date(now.getTime() - 30 * 86_400_000) },
      },
    })
    const post = await tx.lookbookPost.findFirst({
      where: { id: current.group.post_id!, ...PUBLICLY_VISIBLE_POST_WHERE },
    })
    if (!token || !post)
      return { status: 'suppressed', reason: 'no_call:target_or_token' }
    const quiet = await this.quietAuthorization(tx, current, policy, now)
    if (quiet) return quiet
    const surviving = await this.contributors(tx, current, generation, now)
    if (!surviving.length) return { status: 'suppressed', reason: 'no_call:source' }
    if (!(await this.subjectsEligible(tx, current.group_id)))
      return { status: 'suppressed', reason: 'no_call:subject_eligibility' }
    const profile = await tx.userProfile.findUnique({
      where: { user_id: current.owner_id! },
    })
    const preferences = profile?.preferences
    const locale =
      preferences && typeof preferences === 'object' && !Array.isArray(preferences)
        ? preferences.locale
        : undefined
    const single = surviving.length === 1 ? surviving[0] : undefined
    const comment = single?.comment_id
      ? await tx.communityComment.findUnique({ where: { id: single.comment_id } })
      : null
    return {
      status: 'send',
      message: {
        to: token.token,
        ...communityPushCopy(locale, surviving.length > 1),
        data: {
          version: 1,
          notificationId: current.group_id,
          source: 'notification',
          type: 'community',
          cardId: post.id,
          ...(comment ? { commentId: comment.id } : {}),
          ...(comment?.parent_id ? { parentId: comment.parent_id } : {}),
          expiresAt: current.group.expires_at.toISOString(),
        },
      },
    }
  }

  private async quietAuthorization(
    tx: Prisma.TransactionClient,
    current: Delivery,
    policy: Prisma.NotificationPreferenceGetPayload<Record<string, never>>,
    now: Date
  ): Promise<Authorization | undefined> {
    const allowed = nextAllowedCommunityInstant(
      {
        quietHoursEnabled: policy.quiet_hours_enabled,
        quietHoursStart: policy.quiet_hours_start,
        quietHoursEnd: policy.quiet_hours_end,
        timezone: policy.timezone,
      },
      now,
      current.group.expires_at
    )
    if (allowed.status === 'deferred') {
      if (allowed.at.getTime() !== current.group.eligible_at.getTime()) {
        await tx.communityEligibilityChange.create({
          data: {
            group_id: current.group_id,
            policy_revision: policy.policy_revision,
            previous_eligible_at: current.group.eligible_at,
            eligible_at: allowed.at,
            reason: 'quiet_hours',
          },
        })
        await tx.communityNotificationGroup.update({
          where: { id: current.group_id },
          data: { eligible_at: allowed.at, next_attempt_at: allowed.at },
        })
      }
      return noCall('quiet_hours', allowed.at)
    }
    if (current.group.next_attempt_at > now)
      return noCall('spacing', current.group.next_attempt_at)
    if (allowed.status !== 'allowed')
      return { status: 'suppressed', reason: `no_call:${allowed.status}` }
  }

  private async subjectsEligible(tx: Prisma.TransactionClient, groupId: string) {
    const subjects = await this.contexts(tx, groupId)
    for (const subject of subjects) {
      try {
        await assertCommunityDatabaseAccess(tx, subject.member_id)
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error
        return false
      }
    }
    return true
  }

  private async contributors(
    tx: Prisma.TransactionClient,
    current: Delivery,
    generation: number,
    now: Date
  ) {
    const surviving: CommunityNotificationIntent[] = []
    for (const intent of current.group.intents) {
      if (!this.intentEligible(intent, current, generation, now)) continue
      if (await this.sourceEligible(tx, intent)) surviving.push(intent)
    }
    return surviving
  }
  private intentEligible(
    intent: CommunityNotificationIntent,
    current: Delivery,
    generation: number,
    now: Date
  ) {
    return (
      intent.deliverable &&
      !!intent.actor_id &&
      intent.recipient_id === current.owner_id &&
      intent.preference_generation === generation &&
      intent.expires_at > now
    )
  }
  private async sourceEligible(
    tx: Prisma.TransactionClient,
    intent: CommunityNotificationIntent
  ) {
    try {
      await assertCommunityDatabaseAccess(tx, intent.actor_id!)
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error
      return false
    }
    if (!intent.comment_id)
      return !!(await tx.communityReaction.findFirst({
        where: {
          user_id: intent.actor_id!,
          post_id: intent.post_id,
          selection: { not: null },
        },
      }))
    const comment = await tx.communityComment.findFirst({
      where: {
        id: intent.comment_id,
        user_id: intent.actor_id,
        status: 'published',
        post_id: intent.post_id,
      },
    })
    if (!comment) return false
    return (
      !comment.parent_id ||
      !!(await tx.communityComment.findFirst({
        where: { id: comment.parent_id, status: 'published' },
      }))
    )
  }
  private async validSubjects(tx: Prisma.TransactionClient, subjects: Context[]) {
    for (const subject of subjects) {
      const current = await tx.communitySubject.findUnique({
        where: { member_id: subject.member_id },
      })
      if (!current || current.generation !== subject.generation) return false
    }
    return true
  }
  private async suppress(id: string) {
    await this.prisma.communityTokenDelivery.updateMany({
      where: { id, status: { in: pending } },
      data: { status: 'suppressed' },
    })
  }
  private async finish(
    tx: Prisma.TransactionClient,
    attempt: CommunityDeliveryAttempt,
    owner: string,
    outcome: { status: string; reason?: string; ticketId?: string },
    next?: Date
  ): Promise<boolean> {
    const settled = await tx.communityDeliveryAttempt.updateMany({
      where: { id: attempt.id, lease_owner: owner, status: 'sending' },
      data: {
        status: outcome.status,
        reason: outcome.reason,
        completed_at: new Date(),
        ticket_id: outcome.ticketId,
      },
    })
    if (!settled.count) return false
    await recordCommunityAttemptOutcome(tx, attempt.id, outcome.status, outcome.reason)
    await tx.communityTokenDelivery.updateMany({
      where: { id: attempt.delivery_id, status: 'sending' },
      data: { status: outcome.status, ...(next ? { next_attempt_at: next } : {}) },
    })
    return true
  }
  private async complete(
    tx: Prisma.TransactionClient,
    attempt: CommunityDeliveryAttempt,
    owner: string,
    outcome: CommunityPushOutcome
  ) {
    const count = await this.initiatedCount(tx, attempt.delivery_id)
    const retry = outcome.status === 'retryable_rejection' && count < 3
    const failed =
      outcome.status === 'invalid_token' ||
      (outcome.status === 'retryable_rejection' && !retry)
    const settled = await this.finish(
      tx,
      attempt,
      owner,
      { ...outcome, status: failed ? 'failed' : outcome.status },
      retry ? new Date(Date.now() + (count === 1 ? 2000 : 10_000)) : undefined
    )
    if (settled && outcome.status === 'accepted') {
      await tx.communityDeliveryReceipt.create({
        data: {
          attempt_id: attempt.id,
          next_attempt_at: new Date(Date.now() + 15 * 60_000),
          expires_at: new Date(Date.now() + 86_400_000),
        },
      })
      const links = await tx.communityArtifactSubject.findMany({
        where: { artifact_kind: 'attempt', artifact_id: attempt.id },
      })
      await tx.communityArtifactSubject.createMany({
        data: links.map((link) => ({ ...link, artifact_kind: 'receipt' })),
        skipDuplicates: true,
      })
    }
  }
}

import { recordCommunityAttemptOutcome } from './community-operational-telemetry.js'
// Story 6.5 owner: durable grouping, immutable token fanout and uncertainty recovery.
import {
  Prisma,
  type PrismaClient,
  type CommunityArtifactSubject,
  type CommunityNotificationGroup,
  type CommunityNotificationIntent,
} from '@prisma/client'
import { nextAllowedCommunityInstant } from './community-push-policy.js'
import type { CommunitySendGuard } from './community-send-guard.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

function subjectSignature(links: CommunityArtifactSubject[]) {
  return JSON.stringify(
    links.map((link) => [link.member_id, link.generation, link.role]).sort()
  )
}
async function currentSubjectLinks(
  tx: Prisma.TransactionClient,
  kind: string,
  id: string,
  links: CommunityArtifactSubject[]
) {
  const current = await tx.communityArtifactSubject.findMany({
    where: { artifact_kind: kind, artifact_id: id },
  })
  if (subjectSignature(current) !== subjectSignature(links)) return false
  const members = await tx.communitySubject.findMany({
    where: { member_id: { in: links.map((link) => link.member_id) } },
  })
  return links.every((link) =>
    members.some(
      (member) =>
        member.member_id === link.member_id && member.generation === link.generation
    )
  )
}

function policyReconciliation(
  group: Pick<CommunityNotificationGroup, 'eligible_at' | 'snapshot_at'>,
  pushEnabled: boolean,
  allowed: ReturnType<typeof nextAllowedCommunityInstant>,
  now: Date
) {
  const eligible =
    allowed.status === 'deferred'
      ? allowed.at
      : group.eligible_at > now
        ? now
        : group.eligible_at
  const terminal = !pushEnabled || !('at' in allowed)
  const status = terminal
    ? allowed.status === 'expired'
      ? 'expired'
      : 'suppressed'
    : group.snapshot_at
      ? 'sending'
      : allowed.status === 'deferred'
        ? 'deferred'
        : 'pending'
  return { eligible, terminal, status }
}

export class CommunityNotificationsWorker {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sender: Pick<CommunitySendGuard, 'dispatch'>
  ) {}

  async group(): Promise<number> {
    const candidates = await this.prisma.communityNotificationIntent.findMany({
      where: { group_id: null, deliverable: true },
      orderBy: [{ qualification_recorded_at: 'asc' }, { id: 'asc' }],
      take: 100,
    })
    let count = 0
    for (const candidate of candidates) {
      if (!candidate.recipient_id) continue
      const links = await this.prisma.communityArtifactSubject.findMany({
        where: { artifact_kind: 'intent', artifact_id: candidate.id },
      })
      if (!links.length) continue
      count += await interactiveTransaction(
        this.prisma,
        async (tx) => {
          await tx.$executeRaw(
            Prisma.sql`SELECT community_privacy_guards(ARRAY[${Prisma.join([...new Set(links.map((l) => l.member_id))])}]::text[],ARRAY[${candidate.post_id}]::text[],false)`
          )
          if (!(await currentSubjectLinks(tx, 'intent', candidate.id, links))) return 0
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${candidate.recipient_id}))`
          const intent = await tx.communityNotificationIntent.findUnique({
            where: { id: candidate.id },
          })
          if (!intent?.deliverable || intent.group_id || intent.expires_at <= new Date())
            return 0
          const pref = await tx.communityNotificationPreference.findUnique({
            where: { user_id: candidate.recipient_id! },
          })
          if (!pref?.enabled || pref.generation !== candidate.preference_generation) {
            await tx.communityNotificationIntent.update({
              where: { id: candidate.id },
              data: { deliverable: false },
            })
            return 0
          }
          const account = await tx.notificationPreference.findUnique({
            where: { user_id: candidate.recipient_id! },
          })
          if (!account) {
            await tx.communityNotificationIntent.update({
              where: { id: candidate.id },
              data: { deliverable: false },
            })
            return 0
          }
          const original = nextAllowedCommunityInstant(
            {
              quietHoursEnabled: account.quiet_hours_enabled,
              quietHoursStart: account.quiet_hours_start,
              quietHoursEnd: account.quiet_hours_end,
              timezone: account.timezone,
            },
            intent.qualification_recorded_at,
            intent.expires_at
          )
          if (!('at' in original)) {
            await tx.communityNotificationIntent.update({
              where: { id: candidate.id },
              data: { deliverable: false },
            })
            return 0
          }
          const [attachable] = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM "CommunityNotificationGroup" WHERE recipient_id=${candidate.recipient_id}
              AND post_id=${candidate.post_id} AND snapshot_at IS NULL AND status IN ('pending','deferred')
            ORDER BY created_at,id LIMIT 1 FOR UPDATE`
          let group = attachable
            ? await tx.communityNotificationGroup.findUnique({
                where: { id: attachable.id },
              })
            : null
          if (!group) {
            const previous = await tx.communityNotificationGroup.findFirst({
              where: {
                recipient_id: candidate.recipient_id,
                post_id: candidate.post_id,
                snapshot_at: { not: null },
              },
              orderBy: { snapshot_at: 'desc' },
            })
            const due = new Date(
              Math.max(
                original.at.getTime(),
                original.status === 'deferred'
                  ? 0
                  : (previous?.snapshot_at?.getTime() ?? 0) + 30_000
              )
            )
            group = await tx.communityNotificationGroup.create({
              data: {
                recipient_id: candidate.recipient_id,
                post_id: candidate.post_id,
                status: original.status === 'deferred' ? 'deferred' : 'pending',
                eligible_at: original.at,
                policy_revision: account.policy_revision,
                next_attempt_at: due,
                expires_at: intent.expires_at,
              },
            })
          }
          await this.attach(
            tx,
            group,
            intent,
            links,
            account.policy_revision,
            original.status === 'deferred'
          )
          // Counted only once the attachment commits.
          return 1
        },
        { timeout: 1000, maxWait: 250 }
      )
    }
    return count
  }

  private async attach(
    tx: Prisma.TransactionClient,
    group: CommunityNotificationGroup,
    intent: CommunityNotificationIntent,
    links: CommunityArtifactSubject[],
    policyRevision: number,
    initialQuiet: boolean
  ) {
    if (intent.expires_at > group.expires_at)
      await tx.communityNotificationGroup.update({
        where: { id: group.id },
        data: { expires_at: intent.expires_at },
      })
    if (
      !(await tx.communityEligibilityChange.count({
        where: { group_id: group.id },
      }))
    )
      await tx.communityEligibilityChange.create({
        data: {
          group_id: group.id,
          policy_revision: policyRevision,
          previous_eligible_at: group.eligible_at,
          eligible_at: group.eligible_at,
          reason: initialQuiet ? 'qualified_quiet' : 'qualified',
        },
      })
    await tx.communityNotificationIntent.update({
      where: { id: intent.id },
      data: { group_id: group.id },
    })
    for (const link of links)
      await tx.communityArtifactSubject.createMany({
        data: [{ ...link, artifact_kind: 'group', artifact_id: group.id }],
        skipDuplicates: true,
      })
  }

  async fanout(): Promise<number> {
    const groups = await this.prisma.communityNotificationGroup.findMany({
      where: {
        status: { in: ['pending', 'deferred'] },
        snapshot_at: null,
        next_attempt_at: { lte: new Date() },
      },
      orderBy: [{ eligible_at: 'asc' }, { recipient_id: 'asc' }, { id: 'asc' }],
      take: 100,
    })
    let count = 0
    for (const candidate of groups) {
      let group = candidate
      if (!group.recipient_id || !group.post_id) continue
      const links = await this.prisma.communityArtifactSubject.findMany({
        where: { artifact_kind: 'group', artifact_id: group.id },
      })
      if (!links.length) continue
      count += await interactiveTransaction(
        this.prisma,
        async (tx) => {
          // Deliveries count only once this transaction commits.
          let created = 0
          await tx.$executeRaw(
            Prisma.sql`SELECT community_privacy_guards(ARRAY[${Prisma.join([...new Set(links.map((l) => l.member_id))])}]::text[],ARRAY[${group.post_id}]::text[],false)`
          )
          if (!(await currentSubjectLinks(tx, 'group', group.id, links))) return 0
          const claimed = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "CommunityNotificationGroup" WHERE id = ${group.id}::uuid AND snapshot_at IS NULL FOR UPDATE SKIP LOCKED`
          if (!claimed.length) return 0
          // Attachment and snapshot share this row lock. Rediscover privacy guards if its links changed.
          if (!(await currentSubjectLinks(tx, 'group', group.id, links))) return 0
          group = await tx.communityNotificationGroup.findUniqueOrThrow({
            where: { id: group.id },
          })
          const policy = await tx.notificationPreference.findUnique({
            where: { user_id: group.recipient_id! },
          })
          const preference = await tx.communityNotificationPreference.findUnique({
            where: { user_id: group.recipient_id! },
          })
          if (!policy?.push_enabled || !preference?.enabled) {
            await tx.communityNotificationGroup.update({
              where: { id: group.id },
              data: { status: 'suppressed' },
            })
            return 0
          }
          const allowed = nextAllowedCommunityInstant(
            {
              quietHoursEnabled: policy.quiet_hours_enabled,
              quietHoursStart: policy.quiet_hours_start,
              quietHoursEnd: policy.quiet_hours_end,
              timezone: policy.timezone,
            },
            new Date(),
            group.expires_at
          )
          if (allowed.status !== 'allowed') {
            if (
              allowed.status === 'deferred' &&
              allowed.at.getTime() !== group.eligible_at.getTime()
            )
              await tx.communityEligibilityChange.create({
                data: {
                  group_id: group.id,
                  policy_revision: policy.policy_revision,
                  previous_eligible_at: group.eligible_at,
                  eligible_at: allowed.at,
                  reason: 'quiet_hours',
                },
              })
            await tx.communityNotificationGroup.update({
              where: { id: group.id },
              data: {
                status:
                  allowed.status === 'deferred'
                    ? 'deferred'
                    : allowed.status === 'expired'
                      ? 'expired'
                      : 'suppressed',
                ...(allowed.status === 'deferred'
                  ? { next_attempt_at: allowed.at, eligible_at: allowed.at }
                  : {}),
              },
            })
            return 0
          }
          const registrations = await tx.pushToken.findMany({
            where: {
              user_id: group.recipient_id!,
              permission: 'granted',
              last_used_at: { gt: new Date(Date.now() - 30 * 86_400_000) },
            },
            orderBy: { id: 'asc' },
            take: 5,
          })
          for (const registration of registrations) {
            const delivery = await tx.communityTokenDelivery.create({
              data: {
                group_id: group.id,
                registration_id: registration.id,
                binding_generation: registration.binding_generation,
                owner_id: group.recipient_id,
                next_attempt_at: new Date(),
              },
            })
            for (const link of links)
              await tx.communityArtifactSubject.createMany({
                data: [{ ...link, artifact_kind: 'delivery', artifact_id: delivery.id }],
                skipDuplicates: true,
              })
            created++
          }
          await tx.communityNotificationGroup.update({
            where: { id: group.id },
            data: {
              snapshot_at: new Date(),
              status: registrations.length ? 'sending' : 'suppressed',
            },
          })
          return created
        },
        { timeout: 1000, maxWait: 250 }
      )
    }
    return count
  }

  // Policy edits alone may change eligibility. Provider/dependency retries keep the same clock.
  async reconcilePolicies(): Promise<number> {
    const candidates = await this.prisma.$queryRaw<
      { id: string; recipient_id: string }[]
    >`
      SELECT g.id,g.recipient_id FROM "CommunityNotificationGroup" g
      JOIN "NotificationPreference" p ON p.user_id = g.recipient_id
      WHERE g.policy_revision <> p.policy_revision AND g.status IN ('pending','deferred','sending')
        AND g.expires_at > clock_timestamp()
      ORDER BY g.eligible_at,g.id LIMIT 100
    `
    for (const candidate of candidates) {
      await interactiveTransaction(
        this.prisma,
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL transaction_timeout = '2s'")
          await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${candidate.recipient_id}]::text[],ARRAY[]::text[],false)`
          const [locked] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "CommunityNotificationGroup" WHERE id = ${candidate.id}::uuid FOR UPDATE SKIP LOCKED
        `
          if (!locked) return
          const group = await tx.communityNotificationGroup.findUnique({
            where: { id: candidate.id },
          })
          const policy = await tx.notificationPreference.findUnique({
            where: { user_id: candidate.recipient_id },
          })
          if (!group || !policy || group.policy_revision === policy.policy_revision)
            return
          const [clock] = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT clock_timestamp() AS now`
          const now = clock!.now
          const allowed = nextAllowedCommunityInstant(
            {
              quietHoursEnabled: policy.quiet_hours_enabled,
              quietHoursStart: policy.quiet_hours_start,
              quietHoursEnd: policy.quiet_hours_end,
              timezone: policy.timezone,
            },
            now,
            group.expires_at
          )
          const { eligible, terminal, status } = policyReconciliation(
            group,
            policy.push_enabled,
            allowed,
            now
          )
          await tx.communityEligibilityChange.create({
            data: {
              group_id: group.id,
              policy_revision: policy.policy_revision,
              previous_eligible_at: group.eligible_at,
              eligible_at: eligible,
              reason: !policy.push_enabled ? 'global_push_disabled' : allowed.status,
            },
          })
          const initialQuiet = await tx.communityEligibilityChange.findFirst({
            where: { group_id: group.id, reason: 'qualified_quiet' },
          })
          const previous = await tx.communityNotificationGroup.findFirst({
            where: {
              recipient_id: group.recipient_id,
              post_id: group.post_id,
              id: { not: group.id },
              snapshot_at: { not: null },
            },
            orderBy: { snapshot_at: 'desc' },
          })
          const next = new Date(
            Math.max(
              eligible.getTime(),
              initialQuiet ? 0 : (previous?.snapshot_at?.getTime() ?? 0) + 30000
            )
          )
          await tx.communityNotificationGroup.update({
            where: { id: group.id },
            data: {
              policy_revision: policy.policy_revision,
              eligible_at: eligible,
              next_attempt_at: next,
              status,
            },
          })
          if (terminal) {
            await tx.communityTokenDelivery.updateMany({
              where: {
                group_id: group.id,
                status: { in: ['pending', 'deferred', 'retryable_rejection'] },
              },
              data: { status: status === 'expired' ? 'expired' : 'suppressed' },
            })
          } else {
            await tx.$executeRaw`UPDATE "CommunityTokenDelivery" SET
            next_attempt_at = CASE WHEN status = 'retryable_rejection'
              THEN greatest(next_attempt_at,${next}) ELSE ${next} END,
            status = CASE WHEN status = 'retryable_rejection' THEN status ELSE 'deferred' END
            WHERE group_id = ${group.id}::uuid AND status IN ('pending','deferred','retryable_rejection')`
          }
        },
        { timeout: 2500, maxWait: 250 }
      )
    }
    return candidates.length
  }

  async dispatch(): Promise<void> {
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT d.id FROM "CommunityTokenDelivery" d JOIN "CommunityNotificationGroup" g ON g.id = d.group_id
      WHERE d.status IN ('pending','retryable_rejection','deferred') AND d.next_attempt_at <= clock_timestamp()
      ORDER BY g.eligible_at,
        row_number() OVER (PARTITION BY d.owner_id ORDER BY g.eligible_at,d.next_attempt_at,d.id),
        d.owner_id,d.id LIMIT 32
    `
    const outcomes = await Promise.allSettled(
      due.map((delivery) => this.sender.dispatch(delivery.id))
    )
    const failed = outcomes.filter((outcome) => outcome.status === 'rejected').length
    if (failed) throw new Error(`Community dispatch dependency failures: ${failed}`)
  }

  async recover(): Promise<void> {
    const attempts = await this.prisma.communityDeliveryAttempt.findMany({
      where: {
        status: 'sending',
        lease_until: { lt: new Date() },
        guard_until: { lt: new Date() },
      },
      orderBy: { started_at: 'asc' },
      take: 100,
    })
    for (const attempt of attempts) {
      await interactiveTransaction(this.prisma, async (tx) => {
        const expired = await tx.communityDeliveryAttempt.updateMany({
          where: {
            id: attempt.id,
            lease_owner: attempt.lease_owner,
            status: 'sending',
            lease_until: { lt: new Date() },
            guard_until: { lt: new Date() },
          },
          data: {
            status: 'unknown',
            reason: 'orphaned_handoff',
            completed_at: new Date(),
          },
        })
        if (expired.count) {
          await recordCommunityAttemptOutcome(
            tx,
            attempt.id,
            'unknown',
            'orphaned_handoff'
          )
          await tx.communityTokenDelivery.updateMany({
            where: { id: attempt.delivery_id, status: 'sending' },
            data: { status: 'unknown' },
          })
        }
      })
    }
    await this.prisma.communityNotificationIntent.updateMany({
      where: { expires_at: { lte: new Date() }, deliverable: true },
      data: { deliverable: false },
    })
    await this.prisma.communityNotificationGroup.updateMany({
      where: { expires_at: { lte: new Date() }, status: { in: ['pending', 'deferred'] } },
      data: { status: 'expired' },
    })
  }
}

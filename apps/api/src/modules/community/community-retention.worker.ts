// Story 6.5 owner: bounded deletion of inactive bindings/cache and terminal detail.
import { Prisma, type PrismaClient } from '@prisma/client'
import type { PushTokenRepository } from '../notifications/push-token.repository.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

export class CommunityRetentionWorker {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: PushTokenRepository
  ) {}
  async sweep() {
    const cutoff = new Date(Date.now() - 30 * 86_400_000)
    const inactive = await this.prisma.pushToken.findMany({
      where: { last_used_at: { lte: cutoff } },
      orderBy: { last_used_at: 'asc' },
      take: 500,
    })
    await this.tokens.deleteBindings(
      inactive.map((row) => ({
        registrationId: row.id,
        ownerId: row.user_id,
        bindingGeneration: row.binding_generation,
        token: row.token,
        inactiveBefore: cutoff,
      }))
    )
    await this.retainFlags()
    await interactiveTransaction(
      this.prisma,
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL transaction_timeout = '2s'")
        const groups = await tx.communityNotificationGroup.findMany({
          where: {
            created_at: { lt: cutoff },
            expires_at: { lt: new Date() },
            deliveries: {
              every: {
                status: {
                  in: ['accepted', 'unknown', 'suppressed', 'expired', 'failed'],
                },
                attempts: { every: { completed_at: { lt: cutoff } } },
              },
            },
          },
          orderBy: { expires_at: 'asc' },
          take: 500,
          select: {
            id: true,
            post_id: true,
            deliveries: { select: { id: true, attempts: { select: { id: true } } } },
          },
        })
        const groupIds = groups.map((group) => group.id).sort()
        const subjects = await tx.communityArtifactSubject.findMany({
          where: {
            artifact_kind: 'group',
            artifact_id: { in: groupIds },
          },
        })
        const members = [...new Set(subjects.map((subject) => subject.member_id))]
        const posts = [
          ...new Set(groups.flatMap((group) => (group.post_id ? [group.post_id] : []))),
        ]
        if (members.length || posts.length)
          await tx.$executeRaw(Prisma.sql`SELECT community_privacy_guards(
            ${members.length ? Prisma.sql`ARRAY[${Prisma.join(members)}]::text[]` : Prisma.sql`ARRAY[]::text[]`},
            ${posts.length ? Prisma.sql`ARRAY[${Prisma.join(posts)}]::text[]` : Prisma.sql`ARRAY[]::text[]`},false)`)
        for (const id of groupIds)
          await tx.$queryRaw`SELECT id FROM "CommunityNotificationGroup" WHERE id = ${id}::uuid FOR UPDATE NOWAIT`
        const deliveries = groups.flatMap((group) =>
          group.deliveries.map((delivery) => delivery.id)
        )
        const attempts = groups.flatMap((group) =>
          group.deliveries.flatMap((delivery) =>
            delivery.attempts.map((attempt) => attempt.id)
          )
        )
        await tx.communityArtifactSubject.deleteMany({
          where: {
            OR: [
              { artifact_kind: 'group', artifact_id: { in: groupIds } },
              { artifact_kind: 'delivery', artifact_id: { in: deliveries } },
              {
                artifact_kind: { in: ['attempt', 'receipt'] },
                artifact_id: { in: attempts },
              },
            ],
          },
        })
        await tx.communityNotificationGroup.deleteMany({
          where: { id: { in: groupIds } },
        })
        const obsolete = await tx.$queryRaw<{ id: string }[]>`
          SELECT i.id FROM "CommunityNotificationIntent" i
          WHERE NOT EXISTS (SELECT 1 FROM "LookbookPost" p WHERE p.id = i.post_id)
            OR (i.source_kind = 'comment' AND NOT EXISTS
              (SELECT 1 FROM "CommunityComment" c WHERE c.id = i.comment_id))
          ORDER BY i.id LIMIT 500 FOR UPDATE SKIP LOCKED
        `
        const obsoleteIds = obsolete.map((row) => row.id)
        await tx.communityArtifactSubject.deleteMany({
          where: {
            artifact_kind: 'intent',
            artifact_id: { in: obsoleteIds },
          },
        })
        await tx.communityNotificationIntent.deleteMany({
          where: { id: { in: obsoleteIds } },
        })
        await tx.$executeRaw`DELETE FROM "CommunityEngagementTelemetry" WHERE id IN (
        SELECT id FROM "CommunityEngagementTelemetry" WHERE created_at < ${cutoff} ORDER BY created_at LIMIT 500 FOR UPDATE SKIP LOCKED
      )`
        const appended = await tx.communityDomainOutbox.findMany({
          where: { appended_at: { lt: new Date(Date.now() - 48 * 3_600_000) } },
          orderBy: { appended_at: 'asc' },
          take: 500,
          select: { id: true },
        })
        const outboxIds = appended.map((row) => row.id)
        await tx.communityArtifactSubject.deleteMany({
          where: { artifact_kind: 'outbox', artifact_id: { in: outboxIds } },
        })
        await tx.communityDomainOutbox.deleteMany({ where: { id: { in: outboxIds } } })
      },
      { timeout: 2500, maxWait: 250 }
    )
  }
  private async retainFlags() {
    const cutoff = new Date(Date.now() - 86_400_000)
    const rows = await this.prisma.communityFlagEvaluation.findMany({
      where: { last_used_at: { lt: cutoff } },
      orderBy: { last_used_at: 'asc' },
      take: 500,
    })
    if (!rows.length) return
    const members = [...new Set(rows.map((row) => row.member_id))]
    await interactiveTransaction(
      this.prisma,
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL transaction_timeout = '2s'")
        await tx.$executeRaw(
          Prisma.sql`SELECT community_privacy_guards(ARRAY[${Prisma.join(members)}]::text[],ARRAY[]::text[],true)`
        )
        await tx.communityFlagEvaluation.deleteMany({
          where: { member_id: { in: members }, last_used_at: { lt: cutoff } },
        })
      },
      { timeout: 2500, maxWait: 250 }
    )
  }
}

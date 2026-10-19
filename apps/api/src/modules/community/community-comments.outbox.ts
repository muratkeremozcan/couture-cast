// Story 6.4 owner: comment work shares the existing worker and PostgreSQL sweeps.
import { createBaseLogger } from '../../logger/pino.config.js'
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import type { CommunityModerationQueue } from './community-moderation.queue.js'
import type { CommunityCommentsProcessor } from './community-comments.processor.js'

export class CommunityCommentsOutbox {
  private readonly logger = createBaseLogger().child({ feature: 'community-comments' })
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: CommunityModerationQueue,
    private readonly telemetry: TelemetryService,
    private readonly processor: CommunityCommentsProcessor
  ) {}

  async dispatchPending(): Promise<void> {
    const rows = await this.prisma.communityCommentScreeningOutbox.findMany({
      where: {
        dispatched_at: null,
        comment: { status: 'pending_screening' },
        OR: [
          { generation: 0, attempts: 0 },
          { updated_at: { lte: new Date(Date.now() - 30_000) } },
        ],
      },
      orderBy: { created_at: 'asc' },
      take: 100,
    })
    for (const row of rows) {
      try {
        await this.queue.enqueueComment(row.comment_id, row.generation)
        await this.prisma.communityCommentScreeningOutbox.updateMany({
          where: { id: row.id, generation: row.generation, dispatched_at: null },
          data: { dispatched_at: new Date(), attempts: { increment: 1 } },
        })
      } catch {
        this.logger.warn(
          {
            event: 'community_comment_enqueue_failed',
            reason: 'enqueue_failed',
            attempt: row.attempts + 1,
            pendingAgeMs: Math.max(0, Date.now() - row.created_at.getTime()),
          },
          'Comment screening dispatch deferred'
        )
        await this.prisma.communityCommentScreeningOutbox.updateMany({
          where: { id: row.id },
          data: { attempts: { increment: 1 } },
        })
      }
    }
    await this.deliverAnalytics()
  }

  async sweepStale(): Promise<void> {
    const rows = await this.prisma.communityComment.findMany({
      where: {
        status: 'pending_screening',
        created_at: { lt: new Date(Date.now() - 15 * 60_000) },
        OR: [
          { screening_outbox: { is: null } },
          {
            screening_outbox: {
              is: { updated_at: { lte: new Date(Date.now() - 15 * 60_000) } },
            },
          },
        ],
      },
      take: 100,
      orderBy: { created_at: 'asc' },
      select: { id: true },
    })
    for (const row of rows) await this.processor.markFailed(row.id, true)
    const cutoff = new Date(Date.now() - 30 * 86_400_000)
    const [expired, finished] = await Promise.all([
      this.prisma.communityCommentAnalyticsOutbox.findMany({
        where: { delivered_at: { lt: cutoff } },
        take: 100,
        select: { id: true },
      }),
      this.prisma.communityCommentScreeningOutbox.findMany({
        where: { comment: { status: { not: 'pending_screening' } } },
        take: 100,
        select: { id: true },
      }),
    ])
    await this.prisma.communityCommentAnalyticsOutbox.deleteMany({
      where: { id: { in: expired.map((row) => row.id) } },
    })
    await this.prisma.communityCommentScreeningOutbox.deleteMany({
      where: { id: { in: finished.map((row) => row.id) } },
    })
  }

  private async deliverAnalytics(): Promise<void> {
    const deadline = Date.now() + 1000
    for (let index = 0; index < 100 && Date.now() < deadline; index++) {
      const lease = randomUUID()
      const rows = await this.prisma.$queryRaw<
        {
          id: string
          actor: string
          event_type: string
          payload: unknown
          created_at: Date
          attempts: number
        }[]
      >`
        UPDATE "CommunityCommentAnalyticsOutbox" SET lease_id = ${lease}::uuid,
          lease_expires_at = now() + interval '30 seconds', attempts = attempts + 1
        WHERE id = (SELECT id FROM "CommunityCommentAnalyticsOutbox"
          WHERE delivered_at IS NULL AND next_attempt_at <= now()
            AND (lease_expires_at IS NULL OR lease_expires_at <= now())
          ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id,actor,event_type,payload,created_at,attempts`
      const row = rows[0]
      if (!row) break
      try {
        await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
            // Erasure deletes this subject. Keep its key live until delivery and settlement finish.
            const subject = await tx.$queryRaw<
              { actor: string }[]
            >`SELECT actor FROM "CommunityCommentAnalyticsSubject" WHERE actor = ${row.actor} FOR KEY SHARE`
            if (subject.length === 0) return
            const owned = await tx.$queryRaw<
              { id: string }[]
            >`SELECT id FROM "CommunityCommentAnalyticsOutbox"
            WHERE id = ${row.id}::uuid AND actor = ${row.actor} AND lease_id = ${lease}::uuid
              AND delivered_at IS NULL AND lease_expires_at > now() FOR UPDATE`
            if (owned.length === 0) return
            let delivered = false
            try {
              await this.telemetry.captureCommentEvent(
                row.id,
                row.actor,
                row.event_type,
                row.payload,
                row.created_at,
                {
                  transaction: tx,
                  signal: AbortSignal.timeout(3000),
                }
              )
              delivered = true
            } catch {
              this.deliveryFailed(row.attempts, row.created_at)
            }
            await tx.communityCommentAnalyticsOutbox.updateMany({
              where: { id: row.id, lease_id: lease, delivered_at: null },
              data: {
                lease_id: null,
                lease_expires_at: null,
                ...(delivered
                  ? { delivered_at: new Date() }
                  : {
                      next_attempt_at: new Date(
                        Date.now() +
                          Math.min(3_600_000, 1000 * 2 ** Math.min(row.attempts - 1, 12))
                      ),
                    }),
              },
            })
          },
          { maxWait: 1000, timeout: 5000 }
        )
      } catch {
        // A lost lease or database timeout remains recoverable after its bounded expiry.
        this.deliveryFailed(row.attempts, row.created_at)
      }
    }
  }

  private deliveryFailed(attempt: number, createdAt: Date): void {
    this.logger.warn(
      {
        event: 'community_comment_delivery_failed',
        reason: 'delivery_failed',
        attempt,
        pendingAgeMs: Math.max(0, Date.now() - createdAt.getTime()),
      },
      'Comment analytics delivery deferred'
    )
  }
}

// Story 6.4 owner: comment work shares the existing worker and PostgreSQL sweeps.
import { createBaseLogger } from '../../logger/pino.config.js'
import { analyticsDeliveryFailureReason } from './community-analytics-delivery.js'
import { randomUUID } from 'node:crypto'
import { COMMUNITY_BAN_MARKER_PREFIX } from '@couture/api-client/contracts/http'
import type { Prisma, PrismaClient } from '@prisma/client'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import type { CommunityModerationQueue } from './community-moderation.queue.js'
import type { CommunityCommentsProcessor } from './community-comments.processor.js'
import { singleRunTransaction } from '../../prisma/prisma-client.js'

const finishedScreening = {
  status: { not: 'pending_screening' },
  NOT: {
    status: 'held_for_review',
    screening_reason: { startsWith: COMMUNITY_BAN_MARKER_PREFIX },
  },
} satisfies Prisma.CommunityCommentWhereInput

export class CommunityCommentsOutbox {
  private readonly logger = createBaseLogger().child({ feature: 'community-comments' })
  private parkedReported = false
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: CommunityModerationQueue,
    private readonly telemetry: TelemetryService,
    private readonly processor: CommunityCommentsProcessor
  ) {}

  /** Returns how many rows the sweep moved forward; zero means it found nothing to do. */
  async dispatchPending(): Promise<number> {
    let progressed = 0
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
        progressed += 1
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
          where: { id: row.id, generation: row.generation },
          data: { attempts: { increment: 1 } },
        })
      }
    }
    return progressed + (await this.deliverAnalytics())
  }

  /** Returns how many comments and outbox rows the sweep moved or removed. */
  async sweepStale(): Promise<number> {
    let progressed = 0
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
      select: {
        id: true,
        screening_outbox: { select: { generation: true, updated_at: true } },
      },
    })
    for (const row of rows) {
      try {
        await this.processor.failStale(
          row.id,
          row.screening_outbox && {
            generation: row.screening_outbox.generation,
            updatedAt: row.screening_outbox.updated_at,
          }
        )
        progressed += 1
      } catch {
        this.logger.warn(
          { event: 'community_comment_stale_deferred', reason: 'dependency_unavailable' },
          'Stale comment screening deferred'
        )
      }
    }
    const cutoff = new Date(Date.now() - 30 * 86_400_000)
    const [expired, finished] = await Promise.all([
      this.prisma.communityCommentAnalyticsOutbox.findMany({
        where: { delivered_at: { lt: cutoff } },
        take: 100,
        select: { id: true },
      }),
      this.prisma.communityCommentScreeningOutbox.findMany({
        where: { comment: finishedScreening },
        take: 100,
        select: { id: true, generation: true },
      }),
    ])
    if (expired.length) {
      const purged = await this.prisma.communityCommentAnalyticsOutbox.deleteMany({
        where: { id: { in: expired.map((row) => row.id) } },
      })
      progressed += purged.count
    }
    // By generation and current status: recovery may have re-armed a row since it was selected, and
    // that row is live work. If recovery holds its row lock, the delete waits and then re-checks.
    // A comment a ban holds keeps its row, so re-arming it moves past every generation it has had.
    for (const row of finished) {
      const removed = await this.prisma.communityCommentScreeningOutbox.deleteMany({
        where: {
          id: row.id,
          generation: row.generation,
          comment: finishedScreening,
        },
      })
      progressed += removed.count
    }
    return progressed
  }

  private async deliverAnalytics(): Promise<number> {
    // An unconfigured sink cannot accept anything, so the rows stay parked, unleased and with their
    // attempts unchanged, until a configured process delivers them.
    if (!this.telemetry.acknowledgedDeliveryAvailable()) {
      if (!this.parkedReported) {
        this.parkedReported = true
        this.logger.warn(
          { event: 'community_comment_delivery_parked', reason: 'sink_unconfigured' },
          'Comment analytics delivery parked until the acknowledged sink is configured'
        )
      }
      return 0
    }
    let delivered = 0
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
        // The analytics capture happens before settlement commits; a re-run would resend it.
        const settled = await singleRunTransaction(
          this.prisma,
          async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
            // Erasure deletes this subject. Keep its key live until delivery and settlement finish.
            const subject = await tx.$queryRaw<
              { actor: string }[]
            >`SELECT actor FROM "CommunityCommentAnalyticsSubject" WHERE actor = ${row.actor} FOR KEY SHARE`
            if (subject.length === 0) return false
            const owned = await tx.$queryRaw<
              { id: string }[]
            >`SELECT id FROM "CommunityCommentAnalyticsOutbox"
            WHERE id = ${row.id}::uuid AND actor = ${row.actor} AND lease_id = ${lease}::uuid
              AND delivered_at IS NULL AND lease_expires_at > now() FOR UPDATE`
            if (owned.length === 0) return false
            let accepted = false
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
              accepted = true
            } catch (failure) {
              this.deliveryFailed(
                row.attempts,
                row.created_at,
                analyticsDeliveryFailureReason(failure)
              )
            }
            await tx.communityCommentAnalyticsOutbox.updateMany({
              where: { id: row.id, lease_id: lease, delivered_at: null },
              data: {
                lease_id: null,
                lease_expires_at: null,
                ...(accepted
                  ? { delivered_at: new Date() }
                  : {
                      next_attempt_at: new Date(
                        Date.now() +
                          Math.min(3_600_000, 1000 * 2 ** Math.min(row.attempts - 1, 12))
                      ),
                    }),
              },
            })
            return accepted
          },
          { maxWait: 1000, timeout: 5000 }
        )
        if (settled) delivered += 1
      } catch {
        // A lost lease or database timeout remains recoverable after its bounded expiry.
        this.deliveryFailed(row.attempts, row.created_at, 'settlement_failed')
      }
    }
    return delivered
  }

  private deliveryFailed(attempt: number, createdAt: Date, reason: string): void {
    this.logger.warn(
      {
        event: 'community_comment_delivery_failed',
        reason,
        attempt,
        pendingAgeMs: Math.max(0, Date.now() - createdAt.getTime()),
      },
      'Comment analytics delivery deferred'
    )
  }
}

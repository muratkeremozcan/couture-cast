// Story 6.3 outbox owner: lease, deliver, settle and retain in `apps/api/src/modules/community/community-reaction.outbox.ts`, which already carries a `Story 6.3 owner` comment
import { randomUUID } from 'node:crypto'
import { analyticsDeliveryFailureReason } from './community-analytics-delivery.js'
import { Inject, Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import { createBaseLogger } from '../../logger/pino.config.js'

const SWEEP_BUDGET_MS = 1000
const LEASE_MS = 30_000
const RETENTION_BATCH_SIZE = 100

interface ClaimedReaction {
  id: string
  user_id: string
  event_type: string
  payload: unknown
  attempts: number
  created_at: Date
}

/** Story 6.3 owner: committed leases, bounded sweeps, observable delivery, 30-day retention. */
@Injectable()
export class CommunityReactionOutboxDispatcher {
  private readonly logger = createBaseLogger().child({
    context: 'CommunityReactionOutbox',
  })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(TelemetryService) private readonly telemetry: TelemetryService
  ) {}

  async dispatchPending(): Promise<void> {
    const deadline = Date.now() + SWEEP_BUDGET_MS
    // Reserve bounded retention progress even while delivery remains continuously busy.
    await this.retainExpired(deadline)
    // At most one bounded HTTP delivery can extend beyond the sweep budget.
    for (let index = 0; index < 100 && Date.now() < deadline; index += 1) {
      const leaseId = randomUUID()
      const expiresAt = new Date(Date.now() + LEASE_MS)
      // One autocommitted statement claims work and releases every lock and connection.
      const rows = await this.prisma.$queryRaw<ClaimedReaction[]>`
        UPDATE "CommunityReactionOutbox" SET
          lease_id = ${leaseId}::uuid, lease_expires_at = ${expiresAt}, attempts = attempts + 1
        WHERE id = (
          SELECT id FROM "CommunityReactionOutbox"
          WHERE delivered_at IS NULL AND next_attempt_at <= now()
            AND (lease_expires_at IS NULL OR lease_expires_at <= now())
          ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
        ) RETURNING id,user_id,event_type,payload,attempts,created_at`
      const row = rows[0]
      if (!row) break
      let failure: unknown
      let failed = false
      try {
        await this.telemetry.captureReactionEvent(
          row.id,
          row.user_id,
          row.event_type,
          row.payload,
          row.created_at
        )
      } catch (error: unknown) {
        failure = error
        failed = true
      }
      if (failed)
        this.logger.warn(
          {
            event: 'community_reaction_delivery_failed',
            reason: analyticsDeliveryFailureReason(failure),
            attempt: row.attempts,
            pendingAgeMs: Math.max(0, Date.now() - row.created_at.getTime()),
          },
          'Community reaction analytics delivery deferred'
        )
      await this.prisma.communityReactionOutbox.updateMany({
        where: { id: row.id, lease_id: leaseId, delivered_at: null },
        data: {
          lease_id: null,
          lease_expires_at: null,
          ...(failed
            ? {
                next_attempt_at: new Date(
                  Date.now() +
                    Math.min(3_600_000, 1000 * 2 ** Math.min(row.attempts - 1, 12))
                ),
              }
            : { delivered_at: new Date() }),
        },
      })
    }
  }

  private async retainExpired(deadline: number): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    if (Date.now() >= deadline) return
    await this.prisma.$executeRaw`
      DELETE FROM "CommunityReactionReceipt" WHERE (user_id, mutation_id) IN (
        SELECT user_id, mutation_id FROM "CommunityReactionReceipt"
        WHERE created_at < ${cutoff} ORDER BY created_at
        LIMIT ${RETENTION_BATCH_SIZE} FOR UPDATE SKIP LOCKED
      )`
    if (Date.now() >= deadline) return
    await this.prisma.$executeRaw`
      DELETE FROM "CommunityReactionOutbox" WHERE id IN (
        SELECT id FROM "CommunityReactionOutbox"
        WHERE delivered_at < ${cutoff} ORDER BY delivered_at
        LIMIT ${RETENTION_BATCH_SIZE} FOR UPDATE SKIP LOCKED
      )`
  }
}

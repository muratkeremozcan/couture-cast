// Story 6.12 owner: the SLA read projection in `apps/api/src/modules/moderation/moderation-sla.service.ts`.
// Counts run in SQL and no case content leaves: the route writes no audit row for that reason.
import { Inject, Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import {
  MODERATION_SLA_RESOLUTION_WINDOW_DAYS,
  moderationSlaResponseSchema,
  type ModerationSlaChannel,
  type ModerationSlaResponse,
} from '@couture/api-client/contracts/http'
import {
  MODERATION_QUEUE_CLOCK,
  type ModerationQueueClock,
} from './moderation-decision-rules.js'
import { countModerationCases } from './moderation-queue.repository.js'
import { ModerationSlaRepository } from './moderation-sla.repository.js'
import { isModerationSlaMonitorStale } from './moderation-sla.rules.js'

@Injectable()
export class ModerationSlaService {
  private readonly repository: ModerationSlaRepository

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(MODERATION_QUEUE_CLOCK) private readonly clock: ModerationQueueClock
  ) {
    this.repository = new ModerationSlaRepository(prisma)
  }

  async summary(): Promise<ModerationSlaResponse> {
    const now = this.clock()
    const [monitor, queue, resolution, alerts, oldestPendingReviewAt, recentAlerts] =
      await Promise.all([
        this.repository.readMonitor(),
        countModerationCases(this.prisma, now),
        this.repository.resolutionCounts(now),
        this.repository.alertCounts(),
        this.repository.oldestPendingReviewAt(),
        this.repository.recentAlerts(),
      ])
    return moderationSlaResponseSchema.parse({
      data: {
        serverNow: now.toISOString(),
        monitor: {
          lastSweepAt: monitor?.last_sweep_at.toISOString() ?? null,
          stale: isModerationSlaMonitorStale(monitor?.last_sweep_at ?? null, now),
          channel: (monitor?.channel as ModerationSlaChannel | undefined) ?? null,
        },
        queue: {
          onTrack: queue.onTrack,
          atRisk: queue.atRisk,
          breached: queue.breached,
          escalated: queue.escalated,
          oldestDueAt: queue.oldestDueAt?.toISOString() ?? null,
        },
        resolution: { windowDays: MODERATION_SLA_RESOLUTION_WINDOW_DAYS, ...resolution },
        alerts,
        screening: {
          oldestPendingReviewAt: oldestPendingReviewAt?.toISOString() ?? null,
        },
        recentAlerts: recentAlerts.map((alert) => ({
          ...alert,
          slaDueAt: alert.slaDueAt.toISOString(),
          detectedAt: alert.detectedAt.toISOString(),
          deliveredAt: alert.deliveredAt?.toISOString() ?? null,
        })),
      },
    })
  }
}

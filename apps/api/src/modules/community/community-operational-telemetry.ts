// Story 6.5 owner: content-free durable outcomes and independent sink delivery.
import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  acknowledgedCaptureAvailable,
  type AnalyticsClient,
} from '../../analytics/analytics.service.js'
import { createBaseLogger } from '../../logger/pino.config.js'

/**
 * An idle backlog lane is recorded at most this often.
 * A lane that has work, or just drained, is recorded on every observation.
 */
export const COMMUNITY_IDLE_BACKLOG_RECORD_MS = 60 * 60 * 1000

export function communityBuildIdentity() {
  const value = process.env.COUTURE_BUILD_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? ''
  return /^[a-f0-9]{40,64}$/.test(value) ? value : 'unknown'
}
export async function recordCommunityAttemptOutcome(
  tx: Prisma.TransactionClient,
  id: string,
  outcome: string,
  reason?: string
) {
  await tx.$executeRaw`
    INSERT INTO "CommunityEngagementTelemetry" (id,event_type,outcome,reason,elapsed_ms,eligible_latency_ms,attempt_ordinal,build_identity)
    SELECT gen_random_uuid(),'community_push_outcome',${outcome},${reason ?? null},
      least(2147483647,greatest(0,extract(epoch FROM clock_timestamp()-a.started_at)*1000))::int,
      least(2147483647,greatest(0,extract(epoch FROM clock_timestamp()-g.eligible_at)*1000))::int,
      a.ordinal,${communityBuildIdentity()}
    FROM "CommunityDeliveryAttempt" a JOIN "CommunityTokenDelivery" d ON d.id = a.delivery_id
    JOIN "CommunityNotificationGroup" g ON g.id = d.group_id WHERE a.id = ${id}::uuid
  `
}
export class CommunityOperationalTelemetry {
  private readonly logger = createBaseLogger().child({ feature: 'community-telemetry' })
  private parkedReported = false
  /** Per lane: the count last recorded and when, so an idle lane is not recorded every minute. */
  private readonly recorded = new Map<string, { count: number; at: number }>()
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sink: Pick<
      AnalyticsClient,
      'captureAcknowledged' | 'acknowledgedCaptureConfigured'
    >,
    private readonly clock: () => number = Date.now
  ) {}
  /**
   * Observes both backlog lanes and records the ones worth a row.
   * A lane with work, or one whose count changed, is recorded every time.
   * An unchanged empty lane is recorded once an hour, so a missing hourly row still shows the
   * observer stopped, and an idle worker writes 48 rows a day where it wrote 2,880.
   */
  async backlog() {
    const rows = await this.prisma.$queryRaw<
      { lane: string; count: bigint; age: number }[]
    >`
      SELECT 'append' AS lane,count(*) AS count,
        coalesce(least(2147483647,greatest(0,extract(epoch FROM clock_timestamp()-min(created_at))*1000)),0)::int AS age
      FROM "CommunityDomainOutbox" WHERE appended_at IS NULL
      UNION ALL
      SELECT 'delivery',count(*),coalesce(least(2147483647,greatest(0,extract(epoch FROM clock_timestamp()-min(g.eligible_at))*1000)),0)::int
      FROM "CommunityTokenDelivery" d JOIN "CommunityNotificationGroup" g ON g.id = d.group_id
      WHERE d.status IN ('pending','deferred','retryable_rejection') AND d.next_attempt_at <= clock_timestamp()
    `
    const now = this.clock()
    for (const row of rows) {
      const count = Math.min(2147483647, Number(row.count))
      const last = this.recorded.get(row.lane)
      if (
        count === 0 &&
        last?.count === 0 &&
        now - last.at < COMMUNITY_IDLE_BACKLOG_RECORD_MS
      )
        continue
      await this.prisma.communityEngagementTelemetry.create({
        data: {
          event_type: 'community_backlog',
          outcome: row.lane,
          backlog_count: count,
          oldest_age_ms: row.age,
          build_identity: communityBuildIdentity(),
        },
      })
      this.recorded.set(row.lane, { count, at: now })
    }
  }
  /** Returns how many rows it delivered; zero means it found nothing it could deliver. */
  async deliver(): Promise<number> {
    // An unconfigured sink cannot accept anything, so the rows stay parked, unleased and with their
    // attempts unchanged, until a configured process delivers them or the 30-day detail retention
    // (`CommunityRetentionWorker`) removes them: these are content-free operational metrics, and
    // a month-old backlog reading has no use.
    if (!acknowledgedCaptureAvailable(this.sink)) {
      if (!this.parkedReported) {
        this.parkedReported = true
        this.logger.warn(
          { event: 'community_telemetry_delivery_parked', reason: 'sink_unconfigured' },
          'Community operational telemetry delivery parked until the acknowledged sink is configured'
        )
      }
      return 0
    }
    let delivered = 0
    const deadline = Date.now() + 1000
    for (let index = 0; index < 100 && Date.now() < deadline; index++) {
      const owner = randomUUID()
      const rows = await this.prisma.$queryRaw<
        Prisma.CommunityEngagementTelemetryGetPayload<Record<string, never>>[]
      >`
        UPDATE "CommunityEngagementTelemetry" SET lease_owner = ${owner}::uuid,
          lease_until = clock_timestamp()+interval '10 seconds', attempts = attempts+1
        WHERE id = (SELECT id FROM "CommunityEngagementTelemetry" WHERE delivered_at IS NULL
          AND next_attempt_at <= clock_timestamp() AND (lease_until IS NULL OR lease_until <= clock_timestamp())
          ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *
      `
      const row = rows[0]
      if (!row) return delivered
      let accepted = false
      try {
        if (!this.sink.captureAcknowledged) throw new Error('Telemetry sink unavailable')
        await this.sink.captureAcknowledged(
          {
            distinctId: 'community-operational',
            event: row.event_type,
            timestamp: row.created_at.toISOString(),
            properties: {
              $insert_id: row.id,
              outcome: row.outcome,
              reason: row.reason,
              elapsed_ms: row.elapsed_ms,
              eligible_latency_ms: row.eligible_latency_ms,
              attempt_ordinal: row.attempt_ordinal,
              backlog_count: row.backlog_count,
              oldest_age_ms: row.oldest_age_ms,
              build_identity: row.build_identity,
              $process_person_profile: false,
              $geoip_disable: true,
            },
          },
          { signal: AbortSignal.timeout(2000) }
        )
        accepted = true
      } catch {
        /* The durable row retains its identity and retries independently of dispatch. */
      }
      await this.prisma.communityEngagementTelemetry.updateMany({
        where: { id: row.id, lease_owner: owner, delivered_at: null },
        data: {
          lease_owner: null,
          lease_until: null,
          ...(accepted
            ? { delivered_at: new Date() }
            : {
                next_attempt_at: new Date(
                  Date.now() + Math.min(3_600_000, 1000 * 2 ** Math.min(row.attempts, 12))
                ),
              }),
        },
      })
      if (accepted) delivered += 1
    }
    return delivered
  }
}

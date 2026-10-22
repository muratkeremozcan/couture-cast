import { CommunityRetentionWorker } from './community-retention.worker.js'
import { CommunityOperationalTelemetry } from './community-operational-telemetry.js'
import type { AnalyticsClient } from '../../analytics/analytics.service.js'
// Story 6.5 owner: independent bounded loops; dispatch is frozen until capability verification.
import { PrismaClient } from '@prisma/client'
import { createBaseLogger } from '../../logger/pino.config.js'
import { CommunityFlagEvaluationService } from '../feature-flags/community-flag-evaluation.service.js'
import type { RemoteFeatureFlagProvider } from '../feature-flags/remote-feature-flag-provider.js'
import { PushTokenRepository } from '../notifications/push-token.repository.js'
import { CommunityStreamRepository } from './community-stream.repository.js'
import { CommunitySendGuard } from './community-send-guard.js'
import { CommunityNotificationsWorker } from './community-notifications.worker.js'
import { CommunityReceiptsWorker } from './community-receipts.worker.js'
import {
  CommunitySpotlightCache,
  createCommunitySpotlightRedis,
  type SpotlightRedis,
} from './community-spotlight-cache.js'
import { CommunitySpotlightInvalidator } from './community-spotlight-invalidator.js'

export interface CommunityEngagementRuntimeOptions {
  /** Story 6.6: the spotlight read model's Redis. Defaults to the ritual options. */
  spotlightRedis?: SpotlightRedis & { disconnect?: () => void }
}

export async function startCommunityEngagementRuntime(
  prisma: PrismaClient,
  remote: RemoteFeatureFlagProvider & Partial<AnalyticsClient>,
  role: 'general' | 'community' = 'general',
  options: CommunityEngagementRuntimeOptions = {}
) {
  const logger = createBaseLogger().child({ feature: 'community-engagement' })
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const running = new Set<Promise<unknown>>()
  let stopped = false
  const loop = (lane: string, interval: number, work: () => Promise<unknown>) => {
    const schedule = () => {
      if (stopped) return
      const timer = setTimeout(() => {
        timers.delete(timer)
        const flight = work()
          .catch(() => {
            logger.warn(
              { lane, reason: 'dependency_unavailable' },
              'community_loop_failed'
            )
          })
          .finally(() => {
            running.delete(flight)
            schedule()
          })
        running.add(flight)
      }, interval)
      timer.unref()
      timers.add(timer)
    }
    schedule()
  }
  const streams = new CommunityStreamRepository(prisma)
  const spotlightRedis =
    options.spotlightRedis ?? createCommunitySpotlightRedis({ eager: true })
  const spotlight = new CommunitySpotlightInvalidator(
    prisma,
    new CommunitySpotlightCache(spotlightRedis)
  )
  // Story 6.6: the spotlight invalidator runs in the same tick, after append.
  // It never throws and its pass is bounded, so a down or stalled Redis can
  // never block the append loop or shutdown, and an append failure still lets
  // it drain events that are already appended.
  const appendThenInvalidate = async () => {
    try {
      return await streams.append()
    } finally {
      await spotlight.processWithin()
    }
  }
  loop('append', 500, appendThenInvalidate)
  loop('stream-retention', 10_000, () => streams.retain())
  const retention = new CommunityRetentionWorker(prisma, new PushTokenRepository(prisma))
  loop('detail-retention', 10_000, () => retention.sweep())
  const telemetry = new CommunityOperationalTelemetry(prisma, remote)
  loop('backlog-observation', 60_000, () => telemetry.backlog())
  loop('operational-telemetry', 1000, () => telemetry.deliver())
  const { dispatch, guardPool } = await startDispatch(prisma, remote, role, loop)
  logger[dispatch.status === 'degraded' ? 'error' : 'info'](
    { dispatchStatus: dispatch.status, reason: dispatch.reason, role },
    'community_dispatch_readiness'
  )
  return {
    dispatch,
    close: async () => {
      stopped = true
      timers.forEach(clearTimeout)
      timers.clear()
      await Promise.allSettled(running)
      spotlightRedis.disconnect?.()
      await guardPool?.$disconnect()
    },
  }
}

export type CommunityDispatchReadiness = {
  status: 'disabled' | 'standby' | 'ready' | 'degraded'
  reason?:
    | 'owner_unconfigured'
    | 'guard_unconfigured'
    | 'guard_mismatch'
    | 'capability_unavailable'
}
type Loop = (lane: string, interval: number, work: () => Promise<unknown>) => void
async function startDispatch(
  prisma: PrismaClient,
  remote: RemoteFeatureFlagProvider,
  role: 'general' | 'community',
  loop: Loop
): Promise<{ dispatch: CommunityDispatchReadiness; guardPool?: PrismaClient }> {
  if (process.env.COMMUNITY_DISPATCH_ENABLED !== 'true')
    return { dispatch: { status: 'disabled' } }
  const owner = process.env.COMMUNITY_ENGAGEMENT_OWNER
  if (owner !== 'general' && owner !== 'community')
    return { dispatch: { status: 'degraded', reason: 'owner_unconfigured' } }
  if (owner !== role) return { dispatch: { status: 'standby' } }
  let reason: CommunityDispatchReadiness['reason'] = 'guard_unconfigured'
  let guardPool: PrismaClient | undefined
  try {
    const configured = process.env.COMMUNITY_GUARD_DATABASE_URL
    if (!configured) throw new Error('Guard configuration unavailable')
    reason = 'guard_mismatch'
    const url = new URL(configured)
    const primary = new URL(process.env.DATABASE_URL ?? '')
    if (url.hostname !== primary.hostname || url.pathname !== primary.pathname)
      throw new Error('Guard primary mismatch')
    url.searchParams.set('connection_limit', '36')
    url.searchParams.set('pool_timeout', '1')
    reason = 'capability_unavailable'
    guardPool = new PrismaClient({ datasources: { db: { url: url.toString() } } })
    const sender = new CommunitySendGuard(
      guardPool,
      new CommunityFlagEvaluationService(prisma, remote)
    )
    await sender.verifyRuntime()
    const notifications = new CommunityNotificationsWorker(prisma, sender)
    const receipts = new CommunityReceiptsWorker(prisma, new PushTokenRepository(prisma))
    loop('qualify-groups', 250, () => notifications.group())
    loop('policy-reconciliation', 250, () => notifications.reconcilePolicies())
    loop('fanout', 250, () => notifications.fanout())
    loop('dispatch', 50, () => notifications.dispatch())
    loop('recover', 1000, () => notifications.recover())
    loop('receipts', 30_000, () => receipts.sweep())
    return { dispatch: { status: 'ready' }, guardPool }
  } catch {
    await guardPool?.$disconnect().catch(() => undefined)
    return { dispatch: { status: 'degraded', reason } }
  }
}

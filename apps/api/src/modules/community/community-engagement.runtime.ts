import { CommunityRetentionWorker } from './community-retention.worker.js'
import { CommunityOperationalTelemetry } from './community-operational-telemetry.js'
import type { AnalyticsClient } from '../../analytics/analytics.service.js'
// Story 6.5 owner: independent bounded loops; dispatch is frozen until capability verification.
import type { PrismaClient } from '@prisma/client'
import { createPrismaClient } from '../../prisma/prisma-client.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { ComplimentaryAccessService } from '../feature-flags/complimentary-access.service.js'
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
import {
  IDLE_TICK,
  PROGRESS_TICK,
  startBackoffLoop,
  tickFromCount,
  type BackoffLoop,
  type IdleBackoffPolicy,
  type LoopTick,
} from './community-idle-backoff.js'

/**
 * Each lane's cadence while busy and its longest sleep while idle.
 *
 * - append: the API's sync and realtime paths append on their own (`assist`), so this lane is the
 *   backstop for Story 6.5's 10-second realtime bound; it rechecks at least every 10 seconds.
 * - retention lanes: 48-hour and 30-day windows, so ten minutes of idle lag changes nothing.
 * - backlog observation: fixed at one minute, the D8 metric's resolution.
 * - operational telemetry: PostHog delivery with no latency bound; a minute of idle lag.
 * - dispatch lanes: Story 6.5 dispatches within 60 seconds. Grouping wakes fanout and fanout wakes
 *   dispatch in this process, and fanout and dispatch sleep no longer than their earliest due row,
 *   so a quiet-hour exit herd starts when it falls due. The 5-second idle cap is the only lag a
 *   newly qualified intent can see.
 */
export const COMMUNITY_ENGAGEMENT_LOOPS = {
  append: { baseMs: 500, idleCapMs: 10_000 },
  streamRetention: { baseMs: 10_000, idleCapMs: 600_000 },
  detailRetention: { baseMs: 10_000, idleCapMs: 600_000 },
  backlogObservation: { baseMs: 60_000, idleCapMs: 60_000 },
  operationalTelemetry: { baseMs: 1000, idleCapMs: 60_000 },
  qualifyGroups: { baseMs: 250, idleCapMs: 5000 },
  policyReconciliation: { baseMs: 250, idleCapMs: 5000 },
  fanout: { baseMs: 250, idleCapMs: 5000 },
  dispatch: { baseMs: 50, idleCapMs: 5000 },
  recover: { baseMs: 1000, idleCapMs: 30_000 },
  receipts: { baseMs: 30_000, idleCapMs: 300_000 },
} as const satisfies Record<string, IdleBackoffPolicy>
const LOOPS = COMMUNITY_ENGAGEMENT_LOOPS

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
  const loops: BackoffLoop[] = []
  const running = new Set<Promise<unknown>>()
  const loop = (
    lane: string,
    policy: IdleBackoffPolicy,
    work: () => Promise<LoopTick>
  ) => {
    const started = startBackoffLoop({
      policy,
      work,
      onError: () => {
        logger.warn({ lane, reason: 'dependency_unavailable' }, 'community_loop_failed')
      },
      track: (flight) => {
        running.add(flight)
        void flight.finally(() => running.delete(flight))
      },
    })
    loops.push(started)
    return started
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
  //
  // An idle tick asks each side one cheap question first: is any outbox row waiting, and is the
  // spotlight cursor behind the stream? Only a yes opens the bounded append transaction or a pass.
  const appendThenInvalidate = async (): Promise<LoopTick> => {
    let appended = 0
    let failed = false
    let failure: unknown
    try {
      if (await streams.hasPending()) appended = await streams.append()
    } catch (error) {
      failed = true
      failure = error
    }
    const invalidation =
      appended > 0 || (await spotlight.hasWork())
        ? await spotlight.processWithin()
        : { status: 'idle' as const }
    if (failed) throw failure
    return appended > 0 ||
      invalidation.status === 'advanced' ||
      invalidation.status === 'resumed_at_head'
      ? PROGRESS_TICK
      : IDLE_TICK
  }
  loop('append', LOOPS.append, appendThenInvalidate)
  loop('stream-retention', LOOPS.streamRetention, async () =>
    tickFromCount(await streams.retain())
  )
  const retention = new CommunityRetentionWorker(prisma, new PushTokenRepository(prisma))
  loop('detail-retention', LOOPS.detailRetention, async () =>
    tickFromCount(await retention.sweep())
  )
  const telemetry = new CommunityOperationalTelemetry(prisma, remote)
  loop('backlog-observation', LOOPS.backlogObservation, async () => {
    await telemetry.backlog()
    return IDLE_TICK
  })
  loop('operational-telemetry', LOOPS.operationalTelemetry, async () =>
    tickFromCount(await telemetry.deliver())
  )
  const { dispatch, guardPool } = await startDispatch(prisma, remote, role, loop)
  logger[dispatch.status === 'degraded' ? 'error' : 'info'](
    { dispatchStatus: dispatch.status, reason: dispatch.reason, role },
    'community_dispatch_readiness'
  )
  return {
    dispatch,
    close: async () => {
      loops.forEach((started) => started.stop())
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
type Loop = (
  lane: string,
  policy: IdleBackoffPolicy,
  work: () => Promise<LoopTick>
) => BackoffLoop
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
    guardPool = createPrismaClient({ datasources: { db: { url: url.toString() } } })
    const sender = new CommunitySendGuard(
      guardPool,
      new CommunityFlagEvaluationService(
        prisma,
        remote,
        new ComplimentaryAccessService(prisma, remote)
      )
    )
    await sender.verifyRuntime()
    const notifications = new CommunityNotificationsWorker(prisma, sender)
    const receipts = new CommunityReceiptsWorker(prisma, new PushTokenRepository(prisma))
    const dispatchLoop = loop('dispatch', LOOPS.dispatch, async () => {
      if ((await notifications.dispatch()) > 0) return PROGRESS_TICK
      return { progressed: false, dueInMs: await notifications.nextDispatchDueInMs() }
    })
    const fanoutLoop = loop('fanout', LOOPS.fanout, async () => {
      if ((await notifications.fanout()) > 0) {
        dispatchLoop.wake()
        return PROGRESS_TICK
      }
      return { progressed: false, dueInMs: await notifications.nextFanoutDueInMs() }
    })
    loop('qualify-groups', LOOPS.qualifyGroups, async () => {
      if ((await notifications.group()) === 0) return IDLE_TICK
      fanoutLoop.wake()
      return PROGRESS_TICK
    })
    loop('policy-reconciliation', LOOPS.policyReconciliation, async () =>
      tickFromCount(await notifications.reconcilePolicies())
    )
    loop('recover', LOOPS.recover, async () =>
      tickFromCount(await notifications.recover())
    )
    loop('receipts', LOOPS.receipts, async () => tickFromCount(await receipts.sweep()))
    return { dispatch: { status: 'ready' }, guardPool }
  } catch {
    await guardPool?.$disconnect().catch(() => undefined)
    return { dispatch: { status: 'degraded', reason } }
  }
}

import { CommunityRetentionWorker } from './community-retention.worker.js'
import { CommunityOperationalTelemetry } from './community-operational-telemetry.js'
import type { AnalyticsClient } from '../../analytics/analytics.service.js'
// Story 6.5 owner: independent bounded loops; dispatch is frozen until capability verification.
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  createGuardPrismaClient,
  GuardDriverError,
} from '../../prisma/guard-prisma-client.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { ComplimentaryAccessService } from '../feature-flags/complimentary-access.service.js'
import { CommunityFlagEvaluationService } from '../feature-flags/community-flag-evaluation.service.js'
import type { RemoteFeatureFlagProvider } from '../feature-flags/remote-feature-flag-provider.js'
import { PushTokenRepository } from '../notifications/push-token.repository.js'
import {
  CommunityStreamRepository,
  isAppendDeferral,
} from './community-stream.repository.js'
import {
  CommunityDispatchPreflightError,
  CommunitySendGuard,
} from './community-send-guard.js'
import {
  COMMUNITY_DISPATCH_SEND_SLOTS,
  CommunityNotificationsWorker,
} from './community-notifications.worker.js'
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
    let deferred = false
    try {
      if (await streams.hasPending()) appended = await streams.append()
    } catch (error) {
      // Head contention, budget pressure or a pool wait means rows are waiting and the batch backed
      // off on its own; the append repository already logged it, so retry at the busy cadence.
      if (isAppendDeferral(error)) deferred = true
      else {
        failed = true
        failure = error
      }
    }
    const invalidation =
      appended > 0 || (await spotlight.hasWork())
        ? await spotlight.processWithin()
        : { status: 'idle' as const }
    if (failed) throw failure
    return deferred ||
      appended > 0 ||
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
  const { dispatch, guardPool, details } = await startDispatch(prisma, remote, role, loop)
  logger[dispatch.status === 'degraded' ? 'error' : 'info'](
    { dispatchStatus: dispatch.status, reason: dispatch.reason, role, ...details },
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
    | 'guard_unreachable'
    | 'capability_unavailable'
    | 'send_slots_invalid'
}

/**
 * The dispatch guard pool: one connection per send slot plus D10's four for control work, so
 * 14 at the default 10 slots and D10's 36 at 32. It runs on node-postgres
 * (prisma/guard-prisma-client.ts), so a query that is never answered ends and frees its
 * connection.
 *
 * Opening one guard connection (TCP, TLS and the pooler's startup) took 0.6 to 0.7 s on the
 * hosted worker while idle, 1.0 to 1.2 s with its two vCPUs busy and up to about 4 s with both
 * saturated (2026-11-11); 36 at once took about 2 s. A guard statement is bounded at 500 ms on
 * the server, and the slowest round trip measured under saturation was about 350 ms.
 *
 * - `acquireTimeoutMs` covers opening a connection under that load. With a driver adapter it is
 *   the only acquisition bound: Prisma's `maxWait` does not apply (measured).
 * - `queryTimeoutMs` is ten times the server's statement bound, so only a connection that
 *   stopped answering reaches it.
 * - The pool opens all its connections before the first send (`openCommunityGuardPool`) and
 *   keeps them while idle.
 */
export const COMMUNITY_GUARD_POOL = {
  controlConnections: 4,
  acquireTimeoutMs: 5000,
  queryTimeoutMs: 5000,
  /** Waits between preflight attempts after a connect failure; one more attempt than waits. */
  preflightBackoffMs: [1000, 2000, 4000],
  /** Longest a preflight attempt or the warm-up may take: one acquisition budget plus 5 s. */
  stepDeadlineMs: 10_000,
  /** Longest the close of a pool that failed its preflight may take. */
  closeDeadlineMs: 2000,
} as const

/**
 * `COMMUNITY_DISPATCH_SEND_SLOTS` as a slot count, the default when unset, or undefined when
 * it is not a whole number from 1 to 32: dispatch then stays off rather than guess.
 */
export function communityDispatchSendSlots(
  raw: string | undefined = process.env.COMMUNITY_DISPATCH_SEND_SLOTS
): number | undefined {
  const value = raw?.trim()
  if (!value) return COMMUNITY_DISPATCH_SEND_SLOTS.default
  if (!/^\d{1,2}$/.test(value)) return undefined
  const slots = Number(value)
  return slots >= 1 && slots <= COMMUNITY_DISPATCH_SEND_SLOTS.max ? slots : undefined
}

/** Guard pool connections for a slot count: one per slot plus the control connections. */
export const communityGuardConnections = (sendSlots: number) =>
  sendSlots + COMMUNITY_GUARD_POOL.controlConnections

/** The guard pool for a slot count, on the configured primary. */
export function createCommunityGuardPool(
  configured: string,
  sendSlots: number
): PrismaClient {
  return createGuardPrismaClient(configured, {
    max: communityGuardConnections(sendSlots),
    acquireTimeoutMs: COMMUNITY_GUARD_POOL.acquireTimeoutMs,
    queryTimeoutMs: COMMUNITY_GUARD_POOL.queryTimeoutMs,
  })
}

const CONNECT_FAILURE_CODES = new Set(['P1001', 'P1002', 'P1017', 'P2024'])

/** A preflight step that outlived `stepDeadlineMs`. */
class GuardStepTimeout extends Error {
  constructor() {
    super('Community dispatch guard step timed out.')
    this.name = 'GuardStepTimeout'
  }
}

function withinDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new GuardStepTimeout()),
      COMMUNITY_GUARD_POOL.stepDeadlineMs
    )
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

function prismaErrorCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code
  if (error instanceof Prisma.PrismaClientInitializationError) return error.errorCode
  return undefined
}

/**
 * True only when the guard pool could not hand out a connection: the database was
 * unreachable or closed the connection, the pool timed out opening one, or an interactive
 * transaction could not start in time. Every other failure is a real preflight answer.
 */
export function isGuardConnectFailure(error: unknown): boolean {
  if (error instanceof GuardStepTimeout || error instanceof GuardDriverError) return true
  const code = prismaErrorCode(error)
  if (code && CONNECT_FAILURE_CODES.has(code)) return true
  if (code === 'P2028')
    return (error as Error).message.includes('Unable to start a transaction')
  return (
    error instanceof Prisma.PrismaClientInitializationError &&
    error.message.includes('Timed out fetching a new connection from the connection pool')
  )
}

/** The warm-up held too few guard connections for even one send slot beside the control ones. */
class GuardCapacityShortfall extends Error {
  constructor() {
    super('Community dispatch guard capacity too small for one send slot.')
    this.name = 'GuardCapacityShortfall'
  }
}

class GuardUnreachableError extends Error {
  constructor(
    readonly attempts: number,
    readonly last: unknown
  ) {
    super('Community dispatch guard unreachable.')
    this.name = 'GuardUnreachableError'
  }
}

/** Readiness log fields that name a failure without its message, which can carry a host. */
type ReadinessDetails = {
  errorClass?: string
  errorCode?: string
  check?: string
  preflightAttempts?: number
  guardConnections?: number
  sendSlots?: number
  configuredSendSlots?: number
}

function failureDetails(error: unknown): ReadinessDetails {
  const cause = error instanceof GuardUnreachableError ? error.last : error
  const details: ReadinessDetails = {}
  const name = cause instanceof Error ? cause.constructor.name : typeof cause
  if (/^[A-Za-z]{1,64}$/.test(name)) details.errorClass = name
  const code = prismaErrorCode(cause)
  if (code && /^P\d{4}$/.test(code)) details.errorCode = code
  if (cause instanceof CommunityDispatchPreflightError) details.check = cause.check
  if (error instanceof GuardUnreachableError) details.preflightAttempts = error.attempts
  return details
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.()
  })

/**
 * Verifies the guard capability, retrying only connect failures with backoff, then opens up to
 * `connections` guard connections so no send has to. Returns how many it proved open at once;
 * the caller sizes the send slots to that, so a shortfall lowers concurrency instead of leaving
 * slots that would have to open a connection while a send waits for one.
 */
export async function openCommunityGuardPool(
  guardPool: PrismaClient,
  sender: Pick<CommunitySendGuard, 'verifyRuntime'>,
  connections: number
): Promise<{ attempts: number; connections: number }> {
  const waits = COMMUNITY_GUARD_POOL.preflightBackoffMs
  let attempts = 0
  for (;;) {
    attempts++
    try {
      await withinDeadline(sender.verifyRuntime())
      break
    } catch (error) {
      if (!isGuardConnectFailure(error)) throw error
      const wait = waits[attempts - 1]
      if (wait === undefined) throw new GuardUnreachableError(attempts, error)
      await pause(wait)
    }
  }
  const leases = await holdLeases(guardPool, connections)
  if (leases.held === 0) throw new GuardUnreachableError(attempts, leases.firstFailure)
  return { attempts, connections: leases.held }
}

/**
 * Opens up to `target` guard connections and proves how many it holds at once and can use
 * afterwards. Each lease is an interactive transaction that, after its first answer, waits until
 * every lease is held, every other lease has failed, or the step deadline passes; only then are
 * all released. A connection that one lease released can therefore never be counted again by
 * another. Only a lease whose COMMIT then succeeds within `closeDeadlineMs` counts: its
 * connection went back to the pool answering. A COMMIT that fails or is never answered leaves a
 * connection that cannot serve a send, so it is left out and the caller sizes the slots to the
 * rest, or reports the guard unreachable when none is left.
 */
async function holdLeases(
  guardPool: PrismaClient,
  target: number
): Promise<{ held: number; firstFailure?: unknown }> {
  let held = 0
  let failed = 0
  let committed = 0
  let releasing = false
  let firstFailure: unknown
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let decided!: () => void
  const allAccounted = new Promise<void>((resolve) => {
    decided = resolve
  })
  const account = () => {
    if (held + failed >= target) decided()
  }
  // A lease runs only `SELECT 1`, which calls no PL/pgSQL, so the pldbgapi2 retry inside
  // interactiveTransaction cannot repeat it and count it twice.
  const leases = Array.from({ length: target }, () => {
    let answered = false
    // A lease answered only after the release was never held together with the others.
    let together = false
    return interactiveTransaction(
      guardPool,
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS lease`
        answered = true
        together = !releasing
        held += 1
        account()
        await released
      },
      {
        timeout:
          COMMUNITY_GUARD_POOL.stepDeadlineMs + COMMUNITY_GUARD_POOL.closeDeadlineMs,
      }
    ).then(
      () => {
        if (together) committed += 1
      },
      (error: unknown) => {
        firstFailure ??= error
        // A lease that failed after it was counted as held is already accounted for.
        if (answered) return
        failed += 1
        account()
      }
    )
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    allAccounted,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, COMMUNITY_GUARD_POOL.stepDeadlineMs)
    }),
  ])
  clearTimeout(timer)
  releasing = true
  release()
  // Bounded: a COMMIT that is never answered settles only at the query bound.
  await Promise.race([Promise.all(leases), pause(COMMUNITY_GUARD_POOL.closeDeadlineMs)])
  const usable = committed
  return {
    held: usable,
    firstFailure: firstFailure ?? (usable === 0 ? new GuardStepTimeout() : undefined),
  }
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
): Promise<{
  dispatch: CommunityDispatchReadiness
  guardPool?: PrismaClient
  details?: ReadinessDetails
}> {
  if (process.env.COMMUNITY_DISPATCH_ENABLED !== 'true')
    return { dispatch: { status: 'disabled' } }
  const owner = process.env.COMMUNITY_ENGAGEMENT_OWNER
  if (owner !== 'general' && owner !== 'community')
    return { dispatch: { status: 'degraded', reason: 'owner_unconfigured' } }
  if (owner !== role) return { dispatch: { status: 'standby' } }
  const sendSlots = communityDispatchSendSlots()
  if (sendSlots === undefined)
    return { dispatch: { status: 'degraded', reason: 'send_slots_invalid' } }
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
    reason = 'capability_unavailable'
    guardPool = createCommunityGuardPool(configured, sendSlots)
    const sender = new CommunitySendGuard(
      guardPool,
      new CommunityFlagEvaluationService(
        prisma,
        remote,
        new ComplimentaryAccessService(prisma, remote)
      )
    )
    const opened = await openCommunityGuardPool(
      guardPool,
      sender,
      communityGuardConnections(sendSlots)
    )
    // Sends run only on connections proven open and usable: opening one takes 0.6 to 1.2 s on
    // the hosted worker, so a slot without one would spend its send budget opening it.
    const activeSlots = Math.min(
      sendSlots,
      opened.connections - COMMUNITY_GUARD_POOL.controlConnections
    )
    if (activeSlots < 1)
      throw new GuardUnreachableError(opened.attempts, new GuardCapacityShortfall())
    const notifications = new CommunityNotificationsWorker(prisma, sender, activeSlots)
    const receipts = new CommunityReceiptsWorker(prisma, new PushTokenRepository(prisma))
    // A pass that moved any delivery keeps the 50 ms cadence, even when other sends in the same
    // batch were rejected: a quiet-hour herd keeps its pace through partial failures.
    const dispatchLoop = loop('dispatch', LOOPS.dispatch, async () => {
      if ((await notifications.dispatch()).moved > 0) return PROGRESS_TICK
      return { progressed: false, dueInMs: await notifications.nextDispatchDueInMs() }
    })
    const fanoutLoop = loop('fanout', LOOPS.fanout, async () => {
      const pass = await notifications.fanoutReport()
      if (pass.deliveries > 0) dispatchLoop.wake()
      if (pass.groups > 0) return PROGRESS_TICK
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
    return {
      dispatch: { status: 'ready' },
      guardPool,
      details: {
        preflightAttempts: opened.attempts,
        guardConnections: opened.connections,
        sendSlots: activeSlots,
        configuredSendSlots: sendSlots,
      },
    }
  } catch (error) {
    // Bounded: $disconnect waits for in-flight queries, and a query that stopped answering ends
    // only at the guard pool's query bound, so startup does not wait for it.
    if (guardPool)
      await Promise.race([
        guardPool.$disconnect().catch(() => undefined),
        pause(COMMUNITY_GUARD_POOL.closeDeadlineMs),
      ])
    return {
      dispatch: {
        status: 'degraded',
        reason: error instanceof GuardUnreachableError ? 'guard_unreachable' : reason,
      },
      details: failureDetails(error),
    }
  }
}

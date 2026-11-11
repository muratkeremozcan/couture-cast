// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
import 'reflect-metadata'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import * as prismaModule from '@prisma/client'
import { type PrismaClient } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as logger from '../../logger/pino.config.js'
import * as flags from '../feature-flags/community-flag-evaluation.service.js'
import * as tokens from '../notifications/push-token.repository.js'
import * as streams from './community-stream.repository.js'
import * as send from './community-send-guard.js'
import * as notifications from './community-notifications.worker.js'
import * as receipts from './community-receipts.worker.js'
import * as retention from './community-retention.worker.js'
import * as telemetry from './community-operational-telemetry.js'
import * as spotlightCache from './community-spotlight-cache.js'
import * as spotlightInvalidator from './community-spotlight-invalidator.js'
import * as idleBackoff from './community-idle-backoff.js'
import * as prismaClient from '../../prisma/prisma-client.js'
import * as complimentaryAccess from '../feature-flags/complimentary-access.service.js'
import { startCommunityEngagementRuntime } from './community-engagement.runtime.js'

const poolConstructor = vi.hoisted(() => vi.fn())
vi.mock('@prisma/client', async (original) => ({
  ...(await original<typeof prismaModule>()),
  PrismaClient: class {
    constructor(options: unknown) {
      return poolConstructor(options) as PrismaClient
    }
  },
}))

// Only the external database boundary is controlled. Runtime and workers execute unchanged.
function databaseBoundary(capability: 'ready' | 'old-server' | 'bad-timeout' = 'ready') {
  const queries: string[] = []
  const delegate = () => ({
    findMany: vi.fn(() => Promise.resolve([])),
    deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
    create: vi.fn(() => Promise.resolve({})),
  })
  const db = {
    communityDomainOutbox: delegate(),
    communityStreamEvent: delegate(),
    communityArtifactSubject: delegate(),
    communityNotificationGroup: delegate(),
    communityNotificationIntent: delegate(),
    communityDeliveryAttempt: delegate(),
    communityDeliveryReceipt: delegate(),
    communityFlagEvaluation: delegate(),
    communityEngagementTelemetry: delegate(),
    pushToken: delegate(),
    $executeRaw: vi.fn(() => Promise.resolve(0)),
    $executeRawUnsafe: vi.fn(() => Promise.resolve(0)),
    $queryRaw: vi.fn((sql: TemplateStringsArray | { strings: readonly string[] }) => {
      const text = ('strings' in sql ? sql.strings : sql).join('?')
      queries.push(text)
      if (text.includes('server_version_num'))
        return Promise.resolve([
          { version: capability === 'old-server' ? 160000 : 170000, privacy_version: 1 },
        ])
      if (text.includes("current_setting('transaction_timeout')"))
        return Promise.resolve([
          {
            transaction: capability === 'bad-timeout' ? '0' : '3s',
            idle: '3s',
            statement: '500ms',
            lock: '250ms',
          },
        ])
      // The append loop's cheap pre-check: report a waiting row, so every tick opens the bounded
      // append transaction and the housekeeping assertions below see it.
      if (text.includes('AS pending')) return Promise.resolve([{ pending: true }])
      // The spotlight's cheap pre-check: report the cursor behind, so every tick runs a pass.
      if (text.includes('AS work')) return Promise.resolve([{ work: true }])
      if (text.includes("SELECT 'append' AS lane"))
        return Promise.resolve([
          { lane: 'append', count: 0n, age: 0 },
          { lane: 'delivery', count: 0n, age: 0 },
        ])
      return Promise.resolve([])
    }),
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(db)),
    $disconnect: vi.fn(() => Promise.resolve()),
  }
  // createPrismaClient extends the constructed pool; the stand-in is its own extension.
  Object.assign(db, { $extends: () => db })
  return { db, prisma: db as unknown as PrismaClient, queries }
}

// Negative control uses actual production source in memory, with one loop omitted.
function runtimeUnderTest(): typeof startCommunityEngagementRuntime {
  if (process.env.STORY65_RUNTIME_APPEND_MUTANT !== '1')
    return startCommunityEngagementRuntime
  const path = resolve(__dirname, 'community-engagement.runtime.ts')
  const source = readFileSync(path, 'utf8')
  const statement = "loop('append', LOOPS.append, appendThenInvalidate)"
  expect(source.split(statement)).toHaveLength(2)
  const code = transpileModule(source.replace(statement, 'void appendThenInvalidate'), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText
  const dependencies: Record<string, unknown> = {
    '@prisma/client': prismaModule,
    '../../logger/pino.config.js': logger,
    '../feature-flags/community-flag-evaluation.service.js': flags,
    '../notifications/push-token.repository.js': tokens,
    './community-stream.repository.js': streams,
    './community-send-guard.js': send,
    './community-notifications.worker.js': notifications,
    './community-receipts.worker.js': receipts,
    './community-retention.worker.js': retention,
    './community-operational-telemetry.js': telemetry,
    './community-spotlight-cache.js': spotlightCache,
    './community-spotlight-invalidator.js': spotlightInvalidator,
    './community-idle-backoff.js': idleBackoff,
    '../../prisma/prisma-client.js': prismaClient,
    '../feature-flags/complimentary-access.service.js': complimentaryAccess,
  }
  const exports = {} as {
    startCommunityEngagementRuntime: typeof startCommunityEngagementRuntime
  }
  runInNewContext(
    code,
    {
      exports,
      process,
      URL,
      setTimeout,
      clearTimeout,
      require: (id: string) => {
        if (!(id in dependencies)) throw new Error(`Unmapped runtime dependency: ${id}`)
        return dependencies[id]
      },
    },
    { filename: `${path}.append-omission-mutant` }
  )
  console.info(
    JSON.stringify({
      evidence: 'T03-runtime-negative-control',
      originalSha256: createHash('sha256').update(source).digest('hex'),
      mutation: 'omit append loop registration',
      canonicalSourceWritten: false,
    })
  )
  return exports.startCommunityEngagementRuntime
}

const remote = {
  getFeatureFlagValue: () => Promise.resolve(true),
  captureAcknowledged: () => Promise.resolve(),
}
const opened: Awaited<ReturnType<typeof startCommunityEngagementRuntime>>[] = []
let guard: ReturnType<typeof databaseBoundary>
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('COMMUNITY_DISPATCH_ENABLED', 'true')
  vi.stubEnv('COMMUNITY_ENGAGEMENT_OWNER', 'general')
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture:fixture@db.test/fixture')
  vi.stubEnv(
    'COMMUNITY_GUARD_DATABASE_URL',
    'postgresql://fixture:fixture@db.test/fixture?connection_limit=1'
  )
  guard = databaseBoundary()
  poolConstructor.mockReset().mockImplementation(() => guard.prisma)
})
afterEach(async () => {
  await Promise.all(opened.splice(0).map((runtime) => runtime.close()))
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
/** A spotlight Redis that answers nothing useful, so no test opens a socket. */
function idleSpotlightRedis() {
  return {
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve('OK' as const)),
    eval: vi.fn(() => Promise.resolve(1)),
    disconnect: vi.fn(),
  }
}
async function start(
  primary: ReturnType<typeof databaseBoundary>,
  role: 'general' | 'community'
) {
  const runtime = await runtimeUnderTest()(primary.prisma, remote, role, {
    spotlightRedis: idleSpotlightRedis(),
  })
  opened.push(runtime)
  return runtime
}
function assertHousekeeping(primary: ReturnType<typeof databaseBoundary>) {
  expect(primary.db.communityDomainOutbox.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { appended_at: null } })
  )
  expect(primary.db.communityStreamEvent.findMany).toHaveBeenCalled()
  expect(primary.db.pushToken.findMany).toHaveBeenCalled()
  expect(primary.db.communityFlagEvaluation.findMany).toHaveBeenCalled()
  expect(
    primary.queries.some((query) =>
      query.includes('UPDATE "CommunityEngagementTelemetry"')
    )
  ).toBe(true)
  expect(primary.db.communityEngagementTelemetry.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        event_type: 'community_backlog',
        outcome: 'append',
      }) as unknown,
    })
  )
}
function dispatchQueries(primary: ReturnType<typeof databaseBoundary>) {
  return primary.queries.filter((query) =>
    query.includes('SELECT d.id FROM "CommunityTokenDelivery"')
  )
}

describe('T03 actual engagement runtime composition', () => {
  it('retries a failed grouping sweep after one backed-off interval without overlapping passes', async () => {
    let release!: () => void
    const group = vi
      .spyOn(notifications.CommunityNotificationsWorker.prototype, 'group')
      .mockRejectedValueOnce(new Error('expired grouping transaction'))
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            release = () => resolve(1)
          })
      )
      .mockResolvedValue(0)
    try {
      await start(databaseBoundary(), 'general')
      await vi.advanceTimersByTimeAsync(250)
      expect(group).toHaveBeenCalledTimes(1)
      // A failed tick backs off like an idle one: 250 ms doubles to 500 ms.
      await vi.advanceTimersByTimeAsync(499)
      expect(group).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(group).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(2000)
      expect(group).toHaveBeenCalledTimes(2)
      // The hung pass grouped one intent, so the next pass runs at the base cadence.
      release()
      await vi.advanceTimersByTimeAsync(250)
      expect(group).toHaveBeenCalledTimes(3)
    } finally {
      group.mockRestore()
    }
  })

  it('wakes an idle dispatch lane for its earliest due delivery and when fanout produces work', async () => {
    const startedAt = Date.now()
    const dispatchCalls: number[] = []
    const fanoutCalls: number[] = []
    // The eighth idle pass learns that a deferred delivery falls due in 1,234 ms.
    const dueHints: (number | null)[] = [null, null, null, null, null, null, null, 1_234]
    let fanoutResults: number[] = []
    const dispatch = vi
      .spyOn(notifications.CommunityNotificationsWorker.prototype, 'dispatch')
      .mockImplementation(() => {
        dispatchCalls.push(Date.now() - startedAt)
        return Promise.resolve(0)
      })
    const dispatchDue = vi
      .spyOn(notifications.CommunityNotificationsWorker.prototype, 'nextDispatchDueInMs')
      .mockImplementation(() => Promise.resolve(dueHints.shift() ?? null))
    const fanout = vi
      .spyOn(notifications.CommunityNotificationsWorker.prototype, 'fanout')
      .mockImplementation(() => {
        fanoutCalls.push(Date.now() - startedAt)
        return Promise.resolve(fanoutResults.shift() ?? 0)
      })
    const fanoutDue = vi
      .spyOn(notifications.CommunityNotificationsWorker.prototype, 'nextFanoutDueInMs')
      .mockResolvedValue(null)
    try {
      await start(databaseBoundary(), 'general')
      await vi.advanceTimersByTimeAsync(15_100)
      // Idle: 50 ms doubling to the 5-second cap, then exactly the 1,234 ms the hint named,
      // then backing off again from there.
      expect(dispatchCalls).toEqual([
        50, 150, 350, 750, 1_550, 3_150, 6_350, 11_350, 12_584, 15_052,
      ])
      // Fanout creates deliveries: the dispatch lane runs in the same instant.
      fanoutResults = [2]
      const fanoutsBefore = fanoutCalls.length
      await vi.advanceTimersByTimeAsync(5_000)
      const producedAt = fanoutCalls[fanoutsBefore]!
      // A zero-delay timer fires one millisecond later, then the lane backs off from 50 ms again.
      expect(dispatchCalls.filter((at) => at > producedAt).slice(0, 3)).toEqual([
        producedAt + 1,
        producedAt + 101,
        producedAt + 301,
      ])
    } finally {
      dispatch.mockRestore()
      dispatchDue.mockRestore()
      fanout.mockRestore()
      fanoutDue.mockRestore()
    }
  })

  it.each(['general', 'community'] as const)(
    'selects exactly one dispatch pool when %s owns both running roles',
    async (owner) => {
      vi.stubEnv('COMMUNITY_ENGAGEMENT_OWNER', owner)
      const general = databaseBoundary()
      const community = databaseBoundary()
      const runtimes = {
        general: await start(general, 'general'),
        community: await start(community, 'community'),
      }
      expect(runtimes[owner].dispatch).toEqual({ status: 'ready' })
      expect(runtimes[owner === 'general' ? 'community' : 'general'].dispatch).toEqual({
        status: 'standby',
      })
      expect(poolConstructor).toHaveBeenCalledTimes(1)
      const configuration = poolConstructor.mock.calls[0]![0] as {
        datasources: { db: { url: string } }
      }
      const url = new URL(configuration.datasources.db.url)
      expect(url.searchParams.get('connection_limit')).toBe('36')
      expect(url.searchParams.get('pool_timeout')).toBe('1')
      await vi.advanceTimersByTimeAsync(60_001)
      assertHousekeeping(general)
      assertHousekeeping(community)
      expect(
        dispatchQueries(owner === 'general' ? general : community).length
      ).toBeGreaterThan(0)
      expect(dispatchQueries(owner === 'general' ? community : general)).toHaveLength(0)
      await Promise.all(opened.splice(0).map((runtime) => runtime.close()))
      expect(guard.db.$disconnect).toHaveBeenCalledTimes(1)
      const queries = general.queries.length + community.queries.length
      await vi.advanceTimersByTimeAsync(60_001)
      expect(general.queries.length + community.queries.length).toBe(queries)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('runs general-only selected dispatch and independent housekeeping', async () => {
    const primary = databaseBoundary()
    expect((await start(primary, 'general')).dispatch).toEqual({ status: 'ready' })
    await vi.advanceTimersByTimeAsync(60_001)
    assertHousekeeping(primary)
    expect(dispatchQueries(primary).length).toBeGreaterThan(0)
    expect(poolConstructor).toHaveBeenCalledTimes(1)
  })

  it.each(['general', 'community'] as const)(
    'keeps %s housekeeping when dispatch is disabled',
    async (role) => {
      vi.stubEnv('COMMUNITY_DISPATCH_ENABLED', 'false')
      const primary = databaseBoundary()
      expect((await start(primary, role)).dispatch).toEqual({ status: 'disabled' })
      await vi.advanceTimersByTimeAsync(60_001)
      assertHousekeeping(primary)
      expect(poolConstructor).not.toHaveBeenCalled()
      expect(dispatchQueries(primary)).toHaveLength(0)
    }
  )

  it('parks operational telemetry with no lease query while the sink is unconfigured', async () => {
    vi.stubEnv('COMMUNITY_DISPATCH_ENABLED', 'false')
    const primary = databaseBoundary()
    const runtime = await runtimeUnderTest()(
      primary.prisma,
      { getFeatureFlagValue: () => Promise.resolve(true) },
      'community',
      { spotlightRedis: idleSpotlightRedis() }
    )
    opened.push(runtime)
    await vi.advanceTimersByTimeAsync(60_001)
    expect(
      primary.queries.some((query) =>
        query.includes('UPDATE "CommunityEngagementTelemetry"')
      )
    ).toBe(false)
    expect(primary.db.communityEngagementTelemetry.create).toHaveBeenCalled()
  })

  it('backs an idle loop off to its cap and returns to the base cadence when work appears', async () => {
    vi.stubEnv('COMMUNITY_DISPATCH_ENABLED', 'false')
    const primary = databaseBoundary()
    let pending = false
    const checks: number[] = []
    vi.mocked(primary.db.$queryRaw).mockImplementation(
      (sql: TemplateStringsArray | { strings: readonly string[] }) => {
        const text = ('strings' in sql ? sql.strings : sql).join('?')
        if (text.includes('AS pending')) {
          checks.push(Date.now())
          return Promise.resolve([{ pending }])
        }
        if (text.includes("SELECT 'append' AS lane")) return Promise.resolve([])
        return Promise.resolve([])
      }
    )
    const start = Date.now()
    const runtime = await runtimeUnderTest()(primary.prisma, remote, 'community', {
      spotlightRedis: idleSpotlightRedis(),
    })
    opened.push(runtime)
    // Idle: 500 ms, then 1, 2, 4 and 8 seconds, then the 10-second cap.
    await vi.advanceTimersByTimeAsync(45_500)
    expect(checks.map((at) => at - start)).toEqual([
      500, 1500, 3500, 7500, 15_500, 25_500, 35_500, 45_500,
    ])
    // No idle check opened the append transaction.
    expect(primary.db.communityDomainOutbox.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { appended_at: null } })
    )
    // A waiting row is found on the next capped check, and the loop drops to 500 ms while it
    // appends.
    pending = true
    const append = vi
      .spyOn(streams.CommunityStreamRepository.prototype, 'append')
      .mockResolvedValue(1)
    try {
      await vi.advanceTimersByTimeAsync(11_000)
      expect(checks.map((at) => at - start).slice(8)).toEqual([55_500, 56_000, 56_500])
      expect(append).toHaveBeenCalledTimes(3)
    } finally {
      append.mockRestore()
    }
  })

  it('skips the spotlight pass on an idle tick whose cursor is at the head', async () => {
    vi.stubEnv('COMMUNITY_DISPATCH_ENABLED', 'false')
    const primary = databaseBoundary()
    const db = primary.db as typeof primary.db & Record<string, unknown>
    const head = vi.fn(() =>
      Promise.resolve({ epoch: 'epoch-1', sequence: 3n, retention_floor: 0n })
    )
    db.communityStreamHead = { findUnique: head }
    let cursorChecks = 0
    vi.mocked(primary.db.$queryRaw).mockImplementation(
      (sql: TemplateStringsArray | { strings: readonly string[] }) => {
        const text = ('strings' in sql ? sql.strings : sql).join('?')
        if (text.includes('AS pending')) return Promise.resolve([{ pending: false }])
        if (text.includes('AS work')) {
          cursorChecks += 1
          return Promise.resolve([{ work: false }])
        }
        return Promise.resolve([])
      }
    )
    const runtime = await runtimeUnderTest()(primary.prisma, remote, 'community', {
      spotlightRedis: idleSpotlightRedis(),
    })
    opened.push(runtime)
    await vi.advanceTimersByTimeAsync(60_001)
    // 0.5, 1.5, 3.5, 7.5, 15.5, 25.5, 35.5, 45.5 and 55.5 seconds: nine idle ticks, no pass.
    expect(cursorChecks).toBe(9)
    expect(head).not.toHaveBeenCalled()
  })

  it('6.6-UNIT-040 runs the spotlight invalidator in the same tick, after append', async () => {
    vi.stubEnv('COMMUNITY_DISPATCH_ENABLED', 'false')
    const primary = databaseBoundary()
    const order: string[] = []
    const db = primary.db as typeof primary.db & Record<string, unknown>
    vi.mocked(db.communityDomainOutbox.findMany).mockImplementation(() => {
      order.push('append')
      return Promise.resolve([])
    })
    db.communityStreamHead = {
      findUnique: vi.fn(() => {
        order.push('invalidate')
        return Promise.resolve({ epoch: 'epoch-1', sequence: 3n, retention_floor: 0n })
      }),
    }
    db.communitySpotlightCursor = {
      findUnique: vi.fn(() => Promise.resolve(null)),
      upsert: vi.fn(() => Promise.resolve({})),
    }
    const spotlightRedis = idleSpotlightRedis()
    const runtime = await runtimeUnderTest()(primary.prisma, remote, 'general', {
      spotlightRedis,
    })
    opened.push(runtime)
    await vi.advanceTimersByTimeAsync(501)
    expect(order.slice(0, 2)).toEqual(['append', 'invalidate'])
    expect(spotlightRedis.eval).toHaveBeenCalled()
    await runtime.close()
    opened.splice(opened.indexOf(runtime), 1)
    expect(spotlightRedis.disconnect).toHaveBeenCalledTimes(1)
  })

  it('6.6-UNIT-041 a stalled spotlight Redis never stalls the append loop or shutdown', async () => {
    vi.stubEnv('COMMUNITY_DISPATCH_ENABLED', 'false')
    const primary = databaseBoundary()
    const db = primary.db as typeof primary.db & Record<string, unknown>
    let appends = 0
    vi.mocked(db.communityDomainOutbox.findMany).mockImplementation(() => {
      appends += 1
      return Promise.resolve([])
    })
    db.communityStreamHead = {
      findUnique: vi.fn(() =>
        Promise.resolve({ epoch: 'epoch-1', sequence: 3n, retention_floor: 0n })
      ),
    }
    db.communitySpotlightCursor = {
      findUnique: vi.fn(() => Promise.resolve(null)),
      upsert: vi.fn(() => Promise.resolve({})),
    }
    // A server that accepted the connection and never answers again.
    const spotlightRedis = {
      ...idleSpotlightRedis(),
      eval: vi.fn(() => new Promise<never>(() => undefined)),
    }
    const runtime = await runtimeUnderTest()(primary.prisma, remote, 'general', {
      spotlightRedis,
    })
    opened.push(runtime)
    await vi.advanceTimersByTimeAsync(501)
    expect(appends).toBe(1)
    expect(spotlightRedis.eval).toHaveBeenCalledTimes(1)
    // One budget plus one backed-off interval later the loop appended again,
    // and the stalled pass was never doubled while it hung.
    await vi.advanceTimersByTimeAsync(2000 + 1001)
    expect(appends).toBe(2)
    expect(spotlightRedis.eval).toHaveBeenCalledTimes(1)
    const closing = runtime.close()
    await vi.advanceTimersByTimeAsync(2000)
    await closing
    opened.splice(opened.indexOf(runtime), 1)
    expect(spotlightRedis.disconnect).toHaveBeenCalledTimes(1)
  })

  const failures = [
    ['owner_unconfigured', 'owner'],
    ['guard_unconfigured', 'missing'],
    ['guard_mismatch', 'mismatch'],
    ['capability_unavailable', 'old-server'],
    ['capability_unavailable', 'bad-timeout'],
  ] as const
  describe.each(['general', 'community'] as const)(
    '%s dispatch prerequisite isolation',
    (role) => {
      it.each(failures)(
        'exposes %s for %s and retains every independent loop',
        async (reason, fault) => {
          vi.stubEnv('COMMUNITY_ENGAGEMENT_OWNER', role)
          if (fault === 'owner') vi.stubEnv('COMMUNITY_ENGAGEMENT_OWNER', '')
          if (fault === 'missing') vi.stubEnv('COMMUNITY_GUARD_DATABASE_URL', '')
          if (fault === 'mismatch')
            vi.stubEnv(
              'COMMUNITY_GUARD_DATABASE_URL',
              'postgresql://fixture:fixture@other.test/fixture'
            )
          if (fault === 'old-server' || fault === 'bad-timeout')
            guard = databaseBoundary(fault)
          const primary = databaseBoundary()
          const runtime = await start(primary, role)
          expect(runtime.dispatch).toEqual({ status: 'degraded', reason })
          const allocated = fault === 'old-server' || fault === 'bad-timeout'
          expect(poolConstructor).toHaveBeenCalledTimes(allocated ? 1 : 0)
          expect(guard.db.$disconnect).toHaveBeenCalledTimes(allocated ? 1 : 0)
          await vi.advanceTimersByTimeAsync(60_001)
          assertHousekeeping(primary)
          expect(dispatchQueries(primary)).toHaveLength(0)
          expect(primary.db.communityNotificationIntent.findMany).not.toHaveBeenCalled()
          await runtime.close()
          opened.splice(opened.indexOf(runtime), 1)
          expect(guard.db.$disconnect).toHaveBeenCalledTimes(allocated ? 1 : 0)
          expect(vi.getTimerCount()).toBe(0)
        }
      )
    }
  )
})

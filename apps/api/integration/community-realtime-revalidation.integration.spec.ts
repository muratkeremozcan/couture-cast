// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Story 6.5 owner (D1/D10): 100 sockets that connect together stay connected through
// revalidation and doorbells on a bounded database pool.
//
// Every socket revalidates its member at most eight seconds apart and immediately before a
// doorbell. When a whole instance's sockets connect at once (any deploy or restart), those
// checks used to fire together; on a bounded pool their transactions waited past the 2 s
// budget and the instance told healthy members it was unavailable.
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { until } from './helpers/community-engagement-harness.js'
import { createCommunityRealtimeServer } from '../src/realtime/community-realtime.server.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { CommunityAccessService } from '../src/modules/community/community-access.service.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { FeatureFlagsRepository } from '../src/modules/feature-flags/feature-flags.repository.js'

const SOCKETS = 100
const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
// The instance's own pool is deliberately small, so pool waits are the variable.
const poolUrl = new URL(db.url)
poolUrl.searchParams.set('connection_limit', '5')
const pool = new PrismaClient({
  datasources: { db: { url: poolUrl.toString() } },
  log: [{ level: 'query', emit: 'event' }],
})
const queryDurations = new Map<string, number[]>()
const transactionDurations = new Map<string, number[]>()
const settlementDurations = new Map<string, number[]>()
const pendingTransactions = new Map<object, { phase: string; started: number }>()
function phaseFor(query: string) {
  if (/^BEGIN/i.test(query)) return 'transaction-begin'
  if (/^COMMIT/i.test(query)) return 'transaction-commit'
  if (/^ROLLBACK/i.test(query)) return 'transaction-rollback'
  if (/SET LOCAL/.test(query)) return 'statement-control'
  if (/CommunityFlagEvaluation/.test(query))
    return /SELECT e\.\*/.test(query)
      ? 'flag-read'
      : /remote_value =/.test(query)
        ? 'flag-refresh'
        : 'flag-claim'
  if (/community_privacy_guards/.test(query)) return 'privacy-guard'
  if (/CommunitySubject/.test(query)) return 'subject'
  if (/UserProfile/.test(query)) return 'profile'
  return 'other'
}
pool.$on('query', (event) => {
  const phase = phaseFor(event.query)
  const values = queryDurations.get(phase) ?? []
  values.push(event.duration)
  queryDurations.set(phase, values)
})
const observedPool = new Proxy(pool, {
  get(target, key, receiver) {
    if (key === '$transaction')
      return async (
        work: (tx: PrismaClient) => Promise<unknown>,
        options?: { timeout?: number; maxWait?: number }
      ) => {
        const state = {
          phase: 'unknown',
          started: performance.now(),
          callbackFinishedAt: undefined as number | undefined,
        }
        let committed = false
        const token = {}
        pendingTransactions.set(token, state)
        try {
          const result = await target.$transaction(async (tx) => {
            try {
              return await work(
                new Proxy(tx, {
                  get(connection, method, context) {
                    if (method === 'communitySubject') state.phase = 'subject'
                    if (method === 'userProfile') state.phase = 'eligibility'
                    if (method === '$queryRaw' || method === '$executeRaw')
                      return (...args: unknown[]) => {
                        const phase = phaseFor(String(args[0]))
                        if (phase !== 'privacy-guard' && phase !== 'other')
                          state.phase = phase
                        return Reflect.apply(
                          Reflect.get(connection, method, context) as (
                            ...args: unknown[]
                          ) => unknown,
                          connection,
                          args
                        )
                      }
                    return Reflect.get(connection, method, context) as unknown
                  },
                }) as PrismaClient
              )
            } finally {
              state.callbackFinishedAt = performance.now()
            }
          }, options)
          committed = true
          return result
        } finally {
          pendingTransactions.delete(token)
          const values = transactionDurations.get(state.phase) ?? []
          values.push(performance.now() - state.started)
          transactionDurations.set(state.phase, values)
          if (state.callbackFinishedAt !== undefined) {
            const phase = `${state.phase}-${committed ? 'commit' : 'failure'}`
            const settlements = settlementDurations.get(phase) ?? []
            settlements.push(performance.now() - state.callbackFinishedAt)
            settlementDurations.set(phase, settlements)
          }
        }
      }
    return Reflect.get(target, key, receiver) as unknown
  },
})
function durations(values: Map<string, number[]>) {
  return Object.fromEntries(
    [...values].map(([phase, samples]) => {
      const sorted = samples.toSorted((a, b) => a - b)
      return [
        phase,
        {
          count: sorted.length,
          p50Ms: Math.round(sorted[Math.floor(sorted.length * 0.5)] ?? 0),
          p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
          maxMs: Math.round(sorted.at(-1) ?? 0),
          totalMs: Math.round(sorted.reduce((a, b) => a + b, 0)),
        },
      ]
    })
  )
}
const remote = { getFeatureFlagValue: vi.fn(() => Promise.resolve<unknown>(true)) }
const sockets: Socket[] = []
let runtime: ReturnType<typeof createCommunityRealtimeServer>

beforeAll(async () => {
  await db.migrate()
  vi.stubEnv('TEST_ENV', 'local')
  vi.stubEnv('COMMUNITY_FLAG_FIXTURE_MODE', 'false')
}, 30_000)
afterAll(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect())
  await runtime?.close()
  await pool.$disconnect()
  await prisma.$disconnect()
  await db.drop()
  vi.unstubAllEnvs()
})

function fixtureToken(member: string) {
  return `e30.${Buffer.from(
    JSON.stringify({
      sub: member,
      role: 'guardian',
      exp: Math.floor((Date.now() + 120_000) / 1000),
      e2e: 'couturecast-mobile-e2e',
    })
  ).toString('base64url')}.couturecast-mobile-e2e`
}

it('keeps 100 sockets that connect together connected through revalidation and doorbells', async () => {
  const access = new CommunityAccessService(
    observedPool,
    new FeatureFlagsService(
      new FeatureFlagsRepository(observedPool),
      remote,
      new CommunityFlagEvaluationService(observedPool, remote)
    )
  )
  runtime = createCommunityRealtimeServer(() =>
    Promise.resolve({
      prisma: observedPool,
      access,
      streams: new CommunityStreamRepository(observedPool),
      identity: new AccessTokenIdentityService(observedPool),
      origins: ['https://story65.synthetic.test'],
    })
  )
  await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`
  const members = await Promise.all(
    Array.from({ length: SOCKETS }, () =>
      persistUser(
        prisma,
        createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
      )
    )
  )
  const handshakes: {
    connected: boolean
    elapsedMs?: number
    error?: string
    status?: string
  }[] = []
  const histogram = monitorEventLoopDelay({ resolution: 10 })
  histogram.enable()
  const startedAtMs = Date.now()
  const started = performance.now()
  let rejectHandshake!: (error: Error) => void
  const failedHandshake = new Promise<never>((_, reject) => {
    rejectHandshake = reject
  })
  const backendStates = async () => {
    const rows = await prisma.$queryRaw<
      { state: string | null; wait_type: string | null; count: bigint }[]
    >`
      SELECT state, wait_event_type AS wait_type, count(*) FROM pg_stat_activity
      WHERE datname = current_database() GROUP BY state, wait_event_type`
    return rows.map((row) => ({
      state: row.state,
      waitType: row.wait_type,
      count: Number(row.count),
    }))
  }
  const beforeBackends = await backendStates()
  const controls: unknown[] = []
  const bells = new Map<Socket, number>()
  for (const member of members) {
    const socket = io(`${base}/community`, {
      path: '/api/realtime',
      addTrailingSlash: false,
      transports: ['websocket'],
      auth: { token: fixtureToken(member.id) },
      reconnection: false,
      forceNew: true,
    })
    const handshake: {
      connected: boolean
      elapsedMs?: number
      error?: string
      status?: string
    } = {
      connected: false,
    }
    handshakes.push(handshake)
    socket.once('connect', () => {
      handshake.connected = true
      handshake.elapsedMs = Math.round(performance.now() - started)
    })
    socket.once('connect_error', (error: Error & { data?: { status?: unknown } }) => {
      handshake.status =
        error.data?.status === 'denied' || error.data?.status === 'unavailable'
          ? error.data.status
          : 'missing_status'
      handshake.elapsedMs = Math.round(performance.now() - started)
      handshake.error = [
        'community connection unavailable.',
        'unavailable',
        'unauthorized',
        'forbidden',
        'timeout',
        'websocket error',
      ].includes(error.message.toLowerCase())
        ? error.message.toLowerCase()
        : 'other_connect_error'
      rejectHandshake(new Error(`socket_handshake_rejected:${handshake.error}`))
    })
    socket.on('community:availability', (payload: unknown) => controls.push(payload))
    socket.on('community:changed', () => bells.set(socket, (bells.get(socket) ?? 0) + 1))
    sockets.push(socket)
  }
  try {
    await Promise.race([
      until(
        () => Promise.resolve(sockets.filter((socket) => socket.connected).length),
        (count) => count === SOCKETS,
        20_000
      ),
      failedHandshake,
    ])
  } catch (error) {
    const afterBackends = await Promise.race([
      backendStates(),
      delay(2000).then(() => 'diagnostic_query_timeout'),
    ])
    console.error(
      'realtime_handshake_diagnostics',
      JSON.stringify({
        expected: SOCKETS,
        startedAtMs,
        observedAtMs: Date.now(),
        connected: sockets.filter((socket) => socket.connected).length,
        elapsedMs: Math.round(performance.now() - started),
        handshakes,
        eventLoopDelayMs: {
          max: Math.round(histogram.max / 1e6),
          p99: Math.round(histogram.percentile(99) / 1e6),
        },
        beforeBackends,
        afterBackends,
        queryDurations: durations(queryDurations),
        transactionDurations: durations(transactionDurations),
        settlementDurations: durations(settlementDurations),
        pendingTransactions: [...pendingTransactions.values()].map((state) => ({
          phase: state.phase,
          elapsedMs: Math.round(performance.now() - state.started),
        })),
      })
    )
    throw error
  } finally {
    histogram.disable()
  }
  console.info(
    'realtime_cold_handshakes',
    JSON.stringify({
      expected: SOCKETS,
      startedAtMs,
      observedAtMs: Date.now(),
      connected: sockets.filter((socket) => socket.connected).length,
      elapsedMs: Math.round(performance.now() - started),
      eventLoopDelayMs: {
        max: Math.round(histogram.max / 1e6),
        p99: Math.round(histogram.percentile(99) / 1e6),
      },
      queryDurations: durations(queryDurations),
      transactionDurations: durations(transactionDurations),
      settlementDurations: durations(settlementDurations),
    })
  )
  // Two full revalidation rounds (each at most eight seconds apart) plus a doorbell,
  // which revalidates every socket's member immediately before ringing it.
  await delay(4500)
  await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: members[0]!.id, status: 'published' })
    ),
  })
  await delay(5000)

  expect(controls).toEqual([])
  expect(sockets.filter((socket) => socket.connected)).toHaveLength(SOCKETS)
  expect([...bells.values()].filter((count) => count > 0)).toHaveLength(SOCKETS)
}, 60_000)

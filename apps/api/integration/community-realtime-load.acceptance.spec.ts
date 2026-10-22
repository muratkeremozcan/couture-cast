// Story 6.5 acceptance lane D (D10/PERF-001): realtime envelope under load.
//
// Two compiled API processes (`dist/src/main.js`, realtime attached as production attaches
// it) share one UUID PG17 database and an owned loopback Redis, behind a switchable TCP
// balancer. The compiled engagement runtime appends. 100 sockets per instance; 20 committed
// invalidations per second for 60 s plus a burst of 100; HTTP fallback clients poll with
// their realtime transport unreachable; one instance is killed mid-run.
import { randomUUID } from 'node:crypto'
import { createServer, type Server, type Socket as NetSocket, connect } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'
import { io, type Socket } from 'socket.io-client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  OwnedProcess,
  readySchema,
  until,
} from './helpers/community-engagement-harness.js'
import { usageCollector, writeEvidence } from './helpers/community-acceptance.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
// The compiled SDK, not the source alias, is what web and native ship.
import {
  CommunitySyncState,
  communitySyncClient,
  createApiClient,
} from '../../../packages/api-client/dist/index.js'

const SOCKETS_PER_INSTANCE = 100
const RATE = 20
const SECONDS = 60
const BURST = 100
const HEALTHY_BOUND_MS = 10_000
const FALLBACK_BOUND_MS = 20_000
const FALLBACK_CLIENTS = 10
const ORIGIN = 'https://story65.synthetic.test'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const repository = new CommunityRepository(prisma)
const children: OwnedProcess[] = []
const spawn = (file: string, variables: NodeJS.ProcessEnv = {}) => {
  const child = new OwnedProcess(file, variables)
  children.push(child)
  return child
}
const sockets: Socket[] = []
const states: CommunitySyncState[] = []
let balancer: { server: Server; port: number; target: number; peers: Set<NetSocket> }
let collector: Awaited<ReturnType<typeof usageCollector>>
const evidence: Record<string, unknown> = {}

/** A free loopback port for an owned child; the child binds it moments later. */
async function freePort() {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as { port: number }
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}
/** A TCP balancer: new connections go to the current target; switching models failover. */
async function startBalancer(target: number) {
  const peers = new Set<NetSocket>()
  const state = { target }
  const server = createServer((client) => {
    const upstream = connect(state.target, '127.0.0.1')
    peers.add(client)
    peers.add(upstream)
    const drop = () => {
      client.destroy()
      upstream.destroy()
      peers.delete(client)
      peers.delete(upstream)
    }
    client.on('error', drop).on('close', drop)
    upstream.on('error', drop).on('close', drop)
    client.pipe(upstream).pipe(client)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    server,
    port,
    peers,
    get target() {
      return state.target
    },
    set target(value: number) {
      state.target = value
    },
  }
}
function fixtureToken(member: string) {
  // Explicit local fixture-auth lane, as in the realtime integration spec.
  return `e30.${Buffer.from(
    JSON.stringify({
      sub: member,
      role: 'guardian',
      exp: Math.floor((Date.now() + 30 * 60_000) / 1000),
      e2e: 'couturecast-mobile-e2e',
    })
  ).toString('base64url')}.couturecast-mobile-e2e`
}
const active = () =>
  persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )
async function api(port: number, redis: string) {
  const child = spawn('community-api-process.mjs', {
    DATABASE_URL: database.url,
    REDIS_URL: redis,
    REDIS_TLS: 'false',
    PORT: String(port),
    HTTP_CORS_ORIGIN: ORIGIN,
    COMMUNITY_FLAG_FIXTURE_MODE: 'true',
    COMMUNITY_DISPATCH_ENABLED: 'false',
    COMMUNITY_NSFW_SCREENER: 'fixture',
    GARMENT_TAGGING_ENGINE: 'fixture',
    POSTHOG_API_KEY: '',
    SENTRY_DSN: '',
    OTEL_EXPORTER_OTLP_ENDPOINT: '',
  })
  const ready = readySchema.parse(await child.event('ready', 45_000))
  expect(ready.port).toBe(port)
  return { child, pid: ready.pid, port }
}

type Bell = { at: number; payload: unknown }
function socketFor(port: number, member: string, bells: Bell[], reconnect: boolean) {
  const socket = io(`http://127.0.0.1:${port}/community`, {
    path: '/api/realtime',
    addTrailingSlash: false,
    transports: ['websocket'],
    auth: { token: fixtureToken(member) },
    reconnection: reconnect,
    reconnectionDelay: 500,
    reconnectionDelayMax: 1000,
    forceNew: true,
    extraHeaders: { Origin: ORIGIN },
  })
  socket.on('community:changed', (payload: unknown) =>
    bells.push({ at: Date.now(), payload })
  )
  sockets.push(socket)
  return socket
}

const redisUrl = process.env.STORY65_OWNED_REDIS_URL
let instanceA: Awaited<ReturnType<typeof api>>
let instanceB: Awaited<ReturnType<typeof api>>

beforeAll(async () => {
  if (!redisUrl)
    throw new Error('STORY65_OWNED_REDIS_URL (owned loopback Redis) required')
  await database.migrate()
  const [server] = await prisma.$queryRaw<{ version: number }[]>`
    SELECT current_setting('server_version_num')::integer AS version`
  expect(server?.version).toBeGreaterThanOrEqual(170000)
  const remote = spawn('community-flag-remote.mjs')
  const flags = readySchema.parse(await remote.event('ready'))
  const recorder = spawn('community-provider-recorder.mjs')
  const provider = readySchema.parse(await recorder.event('ready'))
  // The runtime appends committed invalidations; dispatch stays off in this lane.
  const runtime = spawn('community-runtime-process.mjs', {
    DATABASE_URL: database.url,
    COMMUNITY_DISPATCH_ENABLED: 'false',
    STORY65_PROVIDER_ENDPOINT: `http://127.0.0.1:${provider.port}/push`,
    STORY65_FLAG_REMOTE_ENDPOINT: `http://127.0.0.1:${flags.port}/flag`,
  })
  const runtimeReady = readySchema.parse(await runtime.event('ready', 15_000))
  expect(await runtime.call('start', 'general')).toEqual({ status: 'disabled' })
  instanceA = await api(await freePort(), redisUrl)
  instanceB = await api(await freePort(), redisUrl)
  balancer = await startBalancer(instanceB.port)
  collector = await usageCollector(spawn, database.url)
  await collector.track({
    runtime: runtimeReady.pid,
    apiA: instanceA.pid,
    apiB: instanceB.pid,
  })
  evidence.postgres = server?.version
  await collector.start()
}, 180_000)

afterAll(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect())
  states.splice(0).forEach((state) => state.stop())
  balancer?.peers.forEach((peer) => peer.destroy())
  await new Promise<void>((resolve) =>
    balancer ? balancer.server.close(() => resolve()) : resolve()
  )
  evidence.usage = await collector?.stop().catch(() => null)
  await writeEvidence('lane-d-realtime-load', evidence)
  const outcomes = await Promise.allSettled(children.map((child) => child.close()))
  await prisma.$disconnect()
  await database.drop()
  expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([])
}, 120_000)

it('rings every socket within 10 s at 20/s plus a burst of 100, at most once a second, and falls back within 20 s', async () => {
  const posts = await Promise.all(
    Array.from({ length: 20 }, async () => {
      const author = await active()
      return prisma.lookbookPost.create({
        data: buildLookbookPostCreateInput(
          createLookbookPost({ userId: author.id, status: 'published' })
        ),
      })
    })
  )
  const actors = await Promise.all(Array.from({ length: 40 }, () => active()))
  const members = await Promise.all(
    Array.from({ length: 2 * SOCKETS_PER_INSTANCE + FALLBACK_CLIENTS }, () => active())
  )

  // 100 sockets direct to A; 100 through the balancer to B, reconnecting through it.
  const bellsOf = new Map<Socket, Bell[]>()
  const groupA: Socket[] = []
  const groupB: Socket[] = []
  for (const [index, member] of members.slice(0, 2 * SOCKETS_PER_INSTANCE).entries()) {
    const bells: Bell[] = []
    const viaBalancer = index >= SOCKETS_PER_INSTANCE
    const socket = socketFor(
      viaBalancer ? balancer.port : instanceA.port,
      member.id,
      bells,
      viaBalancer
    )
    bellsOf.set(socket, bells)
    ;(viaBalancer ? groupB : groupA).push(socket)
  }
  await until(
    () => Promise.resolve(sockets.filter((socket) => socket.connected).length),
    (count) => count === 2 * SOCKETS_PER_INSTANCE,
    30_000
  )

  // HTTP fallback clients: compiled SDK sync state, realtime unreachable, events via the
  // balancer. Every change callback is a fallback poll that found the commit.
  const deadRealtime = `http://127.0.0.1:${await freePort()}`
  const fallbackSeen: number[][] = []
  for (const member of members.slice(2 * SOCKETS_PER_INSTANCE)) {
    const seen: number[] = []
    fallbackSeen.push(seen)
    const token = fixtureToken(member.id)
    const state = new CommunitySyncState(
      communitySyncClient(
        createApiClient(`http://127.0.0.1:${balancer.port}`, { accessToken: () => token })
      ),
      'all',
      {
        rendered: () => [],
        rebuild: () => {
          seen.push(Date.now())
          return Promise.resolve()
        },
        changed: () => {
          seen.push(Date.now())
          return Promise.resolve()
        },
        apply: () => undefined,
        availability: () => undefined,
      }
    )
    states.push(state)
    state.start(deadRealtime, () => Promise.resolve(token))
  }
  await delay(3000)

  // Load: burst of 100 at t0, then 20/s for 60 s, rotating posts and actors.
  const commits: { at: number; sequence?: bigint }[] = []
  const commit = async (index: number) => {
    await repository.setReaction({
      userId: actors[index % actors.length]!.id,
      postId: posts[index % posts.length]!.id,
      platform: 'web',
      input: {
        selection: (['love', 'applause', 'inspiration'] as const)[index % 3]!,
        baseRevision: 0,
        mutationId: randomUUID(),
      },
      assertEligible: () => Promise.resolve(),
    })
    // Recorded after the commit returns: the bound runs from a durable write.
    commits.push({ at: Date.now() })
  }
  const started = Date.now()
  await Promise.all(Array.from({ length: BURST }, (_, index) => commit(index)))
  let killedAt = 0
  for (let second = 0; second < SECONDS; second++) {
    const tick = started + (second + 1) * 1000
    await delay(Math.max(0, tick - Date.now()))
    await Promise.all(
      Array.from({ length: RATE }, (_, index) => commit(BURST + second * RATE + index))
    )
    if (second === SECONDS / 2) {
      // Instance B dies; the balancer fails over to A for every new connection.
      balancer.target = instanceA.port
      instanceB.child.signal('SIGKILL')
      killedAt = Date.now()
    }
  }
  const lastCommit = Date.now()
  // Quiescence: every head has appended and every socket has had its last bell.
  await until(
    () => prisma.communityDomainOutbox.count({ where: { appended_at: null } }),
    (count) => count === 0,
    15_000
  )
  const appended = await prisma.communityDomainOutbox.findFirstOrThrow({
    orderBy: { appended_at: 'desc' },
  })
  const lastAppend = appended.appended_at!.getTime()
  await delay(HEALTHY_BOUND_MS)

  const latency = (bells: Bell[], at: number) => {
    const bell = bells.find((entry) => entry.at >= at)
    return bell ? bell.at - at : Number.POSITIVE_INFINITY
  }
  // Healthy sockets: every commit reaches every socket within 10 s.
  const healthy = groupA.map((socket) => {
    const bells = bellsOf.get(socket)!
    return Math.max(...commits.map((entry) => latency(bells, entry.at)))
  })
  // Failed-over sockets: commits after the kill reach them within the fallback bound.
  const failedOver = groupB.map((socket) => {
    const bells = bellsOf.get(socket)!
    return Math.max(
      ...commits
        .filter((entry) => entry.at > killedAt)
        .map((entry) => latency(bells, entry.at))
    )
  })
  const fallback = fallbackSeen.map((seen) =>
    Math.max(
      ...commits
        .filter((entry) => entry.at >= started)
        .map((entry) => {
          const next = seen.find((at) => at >= entry.at)
          return next === undefined ? Number.POSITIVE_INFINITY : next - entry.at
        })
    )
  )
  const window = (lastAppend + HEALTHY_BOUND_MS - started) / 1000
  const bellCounts = [...bellsOf.values()].map((bells) => bells.length)
  const payloads = [...bellsOf.values()].flat().map((bell) => bell.payload)
  const minimumInterval = Math.min(
    ...[...bellsOf.values()].flatMap((bells) =>
      bells.slice(1).map((bell, index) => bell.at - bells[index]!.at)
    )
  )
  const sort = (values: number[]) => [...values].sort((a, b) => a - b)
  evidence.load = {
    commits: commits.length,
    startedAt: started,
    killedAt,
    lastCommit,
    lastAppend,
    healthyMaxMs: sort(healthy),
    failedOverMaxMs: sort(failedOver),
    fallbackMaxMs: sort(fallback),
    bellCounts: { min: Math.min(...bellCounts), max: Math.max(...bellCounts) },
    minimumBellIntervalMs: minimumInterval,
  }

  expect(commits).toHaveLength(BURST + RATE * SECONDS)
  // Identifier-free doorbells only: nothing private can ride on them.
  expect(
    payloads.every(
      (payload) => JSON.stringify(payload) === '{"version":1,"type":"community:changed"}'
    )
  ).toBe(true)
  // The server rings each socket at most once per second.
  expect(Math.max(...bellCounts)).toBeLessThanOrEqual(Math.floor(window) + 1)
  expect(Math.max(...healthy)).toBeLessThanOrEqual(HEALTHY_BOUND_MS)
  expect(Math.max(...failedOver)).toBeLessThanOrEqual(FALLBACK_BOUND_MS)
  expect(Math.max(...fallback)).toBeLessThanOrEqual(FALLBACK_BOUND_MS)
}, 420_000)

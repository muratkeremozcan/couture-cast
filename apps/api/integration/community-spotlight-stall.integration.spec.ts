// Story 6.6: a Redis that accepted the connection and stopped answering. A
// pausable TCP proxy sits in front of the owned Redis, so the spotlight client
// connects and turns ready for real, then every later command meets silence.
import {
  connect,
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net'
import type Redis from 'ioredis'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { getRedisConfig } from '../src/config/redis.js'
import {
  CommunitySpotlightCache,
  SPOTLIGHT_REDIS_COMMAND_TIMEOUT_MS,
  createCommunitySpotlightRedis,
  type SpotlightRedis,
} from '../src/modules/community/community-spotlight-cache.js'
import {
  CommunitySpotlightInvalidator,
  SPOTLIGHT_INVALIDATOR_BUDGET_MS,
} from '../src/modules/community/community-spotlight-invalidator.js'
import { startCommunityEngagementRuntime } from '../src/modules/community/community-engagement.runtime.js'
import { spotlightTestContext } from './helpers/community-spotlight-context.js'

const ctx = spotlightTestContext('stall')

interface PausableRedis {
  url: string
  stall(): void
  resume(): void
  close(): Promise<void>
}

/**
 * Forwards bytes both ways. While stalled it holds them, the way a paused
 * server leaves them in its socket buffers, and `resume()` delivers them in
 * order, so the protocol stream stays intact.
 */
async function pausableRedisProxy(): Promise<PausableRedis> {
  const target = new URL(getRedisConfig().url)
  let stalled = false
  const held: (() => void)[] = []
  const sockets = new Set<Socket>()
  const server: Server = createServer((client) => {
    const upstream = connect(Number(target.port || 6379), target.hostname)
    for (const socket of [client, upstream]) {
      sockets.add(socket)
      socket.on('error', () => undefined)
      socket.on('close', () => {
        sockets.delete(socket)
        client.destroy()
        upstream.destroy()
      })
    }
    const forward = (to: Socket) => (chunk: Buffer) => {
      if (stalled) held.push(() => to.write(chunk))
      else to.write(chunk)
    }
    client.on('data', forward(upstream))
    upstream.on('data', forward(client))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const url = new URL(target.toString())
  url.hostname = '127.0.0.1'
  url.port = String(port)
  return {
    url: url.toString(),
    stall: () => {
      stalled = true
    },
    resume: () => {
      stalled = false
      for (const deliver of held.splice(0)) deliver()
    },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

const proxies: PausableRedis[] = []
const clients: Redis[] = []

async function stallableClient() {
  const proxy = await pausableRedisProxy()
  proxies.push(proxy)
  const client = createCommunitySpotlightRedis({ url: proxy.url })
  clients.push(client)
  await client.connect()
  await client.ping()
  return { proxy, client, redis: client as unknown as SpotlightRedis }
}

afterAll(async () => {
  for (const client of clients) client.disconnect()
  await Promise.all(proxies.map((proxy) => proxy.close()))
})

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now()
  const value = await work()
  return { value, ms: performance.now() - started }
}

describe('6.6 stalled spotlight Redis', () => {
  it('6.6-INT-060 page one and page two fall back to the database within the command timeout', async () => {
    const area = ctx.area('stalled-read')
    const cohort = await ctx.cohort(area, 5)
    const viewer = await ctx.member(area)
    const { proxy, redis } = await stallableClient()
    const service = ctx.serviceWith(redis)
    const read = (cursor?: string) =>
      service.getSpotlight({
        userId: viewer,
        platform: 'web',
        limit: 3,
        surface: 'community',
        reactions: true,
        ...(cursor ? { cursor } : {}),
      })

    // Healthy: the snapshot lands in Redis through the proxy.
    const warm = await read()
    expect(warm.items.map((item) => item.id)).toEqual(cohort.expectedOrder.slice(0, 3))

    proxy.stall()
    const first = await timed(() => read())
    expect(first.value.level).toBe('city')
    expect(first.value.items.map((item) => item.id)).toEqual(
      cohort.expectedOrder.slice(0, 3)
    )
    const second = await timed(() => read(first.value.nextCursor!))
    expect(second.value.items.map((item) => item.id)).toEqual(
      cohort.expectedOrder.slice(3)
    )
    expect(second.value.nextCursor).toBeNull()
    // Each read gives up on Redis after one command timeout, never hangs.
    for (const { ms } of [first, second])
      expect(ms).toBeLessThan(SPOTLIGHT_REDIS_COMMAND_TIMEOUT_MS * 4)
  })

  it('6.6-INT-061 the invalidator defers inside its budget and replays the events once Redis answers', async () => {
    const area = ctx.area('stalled-invalidator')
    const cohort = await ctx.cohort(area, 5)
    const { proxy, redis } = await stallableClient()
    const invalidator = new CommunitySpotlightInvalidator(
      ctx.prisma,
      new CommunitySpotlightCache(redis, ctx.prefix)
    )
    while ((await ctx.streams.append()) > 0) {
      // Drain the outbox the cohort wrote.
    }
    await expect(invalidator.processWithin()).resolves.toMatchObject({
      status: expect.stringMatching(/^(resumed_at_head|advanced|idle)$/) as string,
    })

    await ctx.react(cohort.authorIds[4]!, cohort.posts[0]!.id, 'applause')
    proxy.stall()
    const appended = await ctx.streams.append()
    expect(appended).toBeGreaterThan(0)
    const before = await ctx.prisma.communitySpotlightCursor.findUniqueOrThrow({
      where: { id: 'public' },
    })
    const deferred = await timed(() => invalidator.processWithin())
    expect(deferred.value).toEqual({ status: 'deferred', reason: 'redis_unavailable' })
    expect(deferred.ms).toBeLessThan(SPOTLIGHT_REDIS_COMMAND_TIMEOUT_MS * 4)
    await expect(
      ctx.prisma.communitySpotlightCursor.findUniqueOrThrow({ where: { id: 'public' } })
    ).resolves.toMatchObject({ position: before.position })

    proxy.resume()
    await expect(invalidator.processWithin()).resolves.toMatchObject({
      status: 'advanced',
    })
    const after = await ctx.prisma.communitySpotlightCursor.findUniqueOrThrow({
      where: { id: 'public' },
    })
    expect(after.position > before.position).toBe(true)
  })

  it('6.6-INT-062 the real engagement runtime keeps appending and shuts down while Redis stalls', async () => {
    vi.stubEnv('COMMUNITY_DISPATCH_ENABLED', 'false')
    const area = ctx.area('stalled-runtime')
    const cohort = await ctx.cohort(area, 5)
    while ((await ctx.streams.append()) > 0) {
      // Start from an empty outbox so every append below is the runtime's.
    }
    const { proxy, client } = await stallableClient()
    const remote = { getFeatureFlagValue: () => Promise.resolve<unknown>(true) }
    const runtime = await startCommunityEngagementRuntime(ctx.prisma, remote, 'general', {
      spotlightRedis: client,
    })
    try {
      proxy.stall()
      const appendedFor = (postId: string) =>
        ctx.prisma.communityStreamEvent.count({
          where: { stream_id: 'public', post_id: postId },
        })
      // Two reactions further apart than one invalidation budget: the second is
      // appended only if the loop came back after a pass that met the stall.
      for (const post of cohort.posts.slice(0, 2)) {
        const before = await appendedFor(post.id)
        await ctx.react(await ctx.member(), post.id, 'love')
        await vi.waitFor(
          async () => expect(await appendedFor(post.id)).toBeGreaterThan(before),
          { timeout: SPOTLIGHT_INVALIDATOR_BUDGET_MS * 3, interval: 100 }
        )
      }
    } finally {
      const closing = timed(() => runtime.close())
      const { ms } = await closing
      expect(ms).toBeLessThan(SPOTLIGHT_INVALIDATOR_BUDGET_MS + 1000)
      vi.unstubAllEnvs()
    }
  })
})

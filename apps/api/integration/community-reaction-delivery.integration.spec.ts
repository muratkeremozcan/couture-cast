import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { CommunityReactionOutboxDispatcher } from '../src/modules/community/community-reaction.outbox.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { PostHogService } from '../src/posthog/posthog.service.js'

import { reactionTestContext } from './helpers/community-reaction-context.js'

const { database, prisma, repository, input, fixture, mutate } = reactionTestContext()

describe('Story 6.3 durable reaction analytics delivery', () => {
  it('recovers analytics delivery with stable insertion IDs and privacy-safe properties', async () => {
    const { userId, postId } = await fixture()
    await mutate(userId, postId, input('love'))
    const capture = vi.fn().mockImplementation(() => {
      throw new Error('analytics unavailable')
    })
    const telemetry = new TelemetryService(prisma, {
      capture: vi.fn(),
      captureAcknowledged: capture,
    })
    const dispatcher = new CommunityReactionOutboxDispatcher(prisma, telemetry)
    await dispatcher.dispatchPending()
    const pending = await prisma.communityReactionOutbox.findFirstOrThrow({
      where: { post_id: postId },
    })
    expect(pending.delivered_at).toBeNull()
    expect(
      (await repository.reactionSummaries([postId], userId)).get(postId)?.total
    ).toBe(1)
    await prisma.communityReactionOutbox.update({
      where: { id: pending.id },
      data: { next_attempt_at: new Date(0) },
    })
    capture.mockImplementation(() => undefined)
    await dispatcher.dispatchPending()
    const delivered = await prisma.communityReactionOutbox.findUniqueOrThrow({
      where: { id: pending.id },
    })
    expect(delivered.delivered_at).not.toBeNull()
    const event = capture.mock.calls.find(
      (call) =>
        (call[0] as { properties: { $insert_id: string } }).properties.$insert_id ===
        pending.id
    )?.[0] as { distinctId: string; properties: Record<string, unknown> }
    expect(event.distinctId).not.toBe(userId)
    expect(event.properties).toMatchObject({
      $insert_id: pending.id,
      $ip: null,
      is_self: true,
    })
    expect(JSON.stringify(event)).not.toContain(userId)
    expect(await prisma.telemetryEvent.count({ where: { id: pending.id } })).toBe(1)
    await prisma.telemetryEvent.delete({ where: { id: pending.id } })
  })

  it('keeps delivery pending across real HTTP ingestion failures and accepts only a successful acknowledgement', async () => {
    const { userId, postId } = await fixture()
    await mutate(userId, postId, input('applause'))
    const row = await prisma.communityReactionOutbox.findFirstOrThrow({
      where: { post_id: postId },
    })
    const bodies: string[] = []
    let status = 503
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => {
        body += String(chunk)
      })
      request.on('end', () => {
        bodies.push(body)
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ status: status === 200 ? 1 : 0 }))
      })
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('No local ingestion port')
    const oldKey = process.env.POSTHOG_API_KEY
    const oldHost = process.env.POSTHOG_HOST
    process.env.POSTHOG_API_KEY = 'phc_synthetic_local_only'
    process.env.POSTHOG_HOST = `http://127.0.0.1:${address.port}`
    const adapter = new PostHogService()
    try {
      const dispatcher = new CommunityReactionOutboxDispatcher(
        prisma,
        new TelemetryService(prisma, adapter)
      )
      await dispatcher.dispatchPending()
      expect(
        (
          await prisma.communityReactionOutbox.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).delivered_at
      ).toBeNull()
      expect(
        (await repository.reactionSummaries([postId], userId)).get(postId)?.total
      ).toBe(1)
      status = 200
      await prisma.communityReactionOutbox.update({
        where: { id: row.id },
        data: { next_attempt_at: new Date(0) },
      })
      await dispatcher.dispatchPending()
      expect(
        (
          await prisma.communityReactionOutbox.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).delivered_at
      ).not.toBeNull()
      const attempts = bodies
        .map(
          (body) =>
            JSON.parse(body) as {
              uuid: string
              timestamp: string
              distinct_id: string
              properties: Record<string, unknown>
            }
        )
        .filter((body) => body.uuid === row.id)
      expect(attempts).toHaveLength(2)
      expect(attempts[0]?.uuid).toBe(attempts[1]?.uuid)
      expect(attempts[0]?.timestamp).toBe(row.created_at.toISOString())
      expect(attempts[1]?.timestamp).toBe(row.created_at.toISOString())
      expect(attempts[0]?.distinct_id).not.toBe(userId)
      expect(attempts[0]?.properties).toMatchObject({
        $ip: null,
        $geoip_disable: true,
        $process_person_profile: false,
      })
      await prisma.telemetryEvent.deleteMany({ where: { id: row.id } })
    } finally {
      adapter.onApplicationShutdown()
      if (oldKey === undefined) delete process.env.POSTHOG_API_KEY
      else process.env.POSTHOG_API_KEY = oldKey
      if (oldHost === undefined) delete process.env.POSTHOG_HOST
      else process.env.POSTHOG_HOST = oldHost
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  })

  it('caps indexed retention batches and continues cleanup while delivery exhausts each sweep', async () => {
    const { userId, postId } = await fixture()
    const [clock] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now()`
    let sweepNow = clock!.now.getTime()
    vi.spyOn(Date, 'now').mockImplementation(() => sweepNow)
    const expired = new Date(sweepNow - 31 * 24 * 60 * 60 * 1000)
    const cutoff = new Date(sweepNow - 30 * 24 * 60 * 60 * 1000)
    await prisma.communityReactionReceipt.createMany({
      data: Array.from({ length: 205 }, () => ({
        user_id: userId,
        post_id: postId,
        mutation_id: randomUUID(),
        selection: 'love',
        base_revision: 0,
        created_at: expired,
      })),
    })
    await prisma.communityReactionOutbox.createMany({
      data: Array.from({ length: 205 }, () => ({
        id: randomUUID(),
        user_id: userId,
        post_id: postId,
        event_type: 'community_reaction_added',
        payload: {},
        created_at: expired,
        delivered_at: expired,
      })),
    })
    const dueIds = Array.from({ length: 4 }, () => randomUUID())
    await prisma.communityReactionOutbox.createMany({
      data: dueIds.map((id) => ({
        id,
        user_id: userId,
        post_id: postId,
        event_type: 'community_reaction_added',
        payload: {},
        created_at: expired,
        next_attempt_at: new Date(0),
      })),
    })
    const captureReactionEvent = vi.fn(() => {
      sweepNow += 1050
      return Promise.resolve()
    })
    const dispatcher = new CommunityReactionOutboxDispatcher(prisma, {
      captureReactionEvent,
    } as unknown as TelemetryService)
    for (const remaining of [105, 5, 0]) {
      await dispatcher.dispatchPending()
      expect(
        await prisma.communityReactionReceipt.count({
          where: { user_id: userId, created_at: { lt: cutoff } },
        })
      ).toBe(remaining)
      expect(
        await prisma.communityReactionOutbox.count({
          where: { user_id: userId, delivered_at: { lt: cutoff } },
        })
      ).toBe(remaining)
    }
    expect(captureReactionEvent).toHaveBeenCalledTimes(3)
    expect(
      await prisma.communityReactionOutbox.count({
        where: { id: { in: dueIds }, delivered_at: null, attempts: 0 },
      })
    ).toBe(1)
  })

  it('releases a one-connection pool during slow delivery, bounds a sweep, and recovers an expired lease', async () => {
    const { userId, postId } = await fixture()
    await mutate(userId, postId, input('love'))
    const row = await prisma.communityReactionOutbox.findFirstOrThrow({
      where: { post_id: postId },
    })
    await mutate(userId, postId, input('applause', 1))
    const second = await prisma.communityReactionOutbox.findFirstOrThrow({
      where: { post_id: postId, id: { not: row.id } },
    })
    await prisma.communityReactionOutbox.update({
      where: { id: row.id },
      data: { next_attempt_at: new Date(0) },
    })
    await prisma.communityReactionOutbox.update({
      where: { id: second.id },
      data: { next_attempt_at: new Date(1) },
    })
    const url = new URL(database.url)
    url.searchParams.set('connection_limit', '1')
    url.searchParams.set('pool_timeout', '1')
    const single = new PrismaClient({ datasources: { db: { url: url.toString() } } })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const capture = vi.fn().mockImplementation(async () => {
      entered()
      await gate
      throw new Error('sink unavailable')
    })
    const dispatcher = new CommunityReactionOutboxDispatcher(
      single,
      new TelemetryService(single, { capture: vi.fn(), captureAcknowledged: capture })
    )
    const [clock] = await single.$queryRaw<{ now: Date }[]>`SELECT now()`
    let sweepNow = clock!.now.getTime()
    vi.spyOn(Date, 'now').mockImplementation(() => sweepNow)
    const dispatch = dispatcher.dispatchPending()
    try {
      await started
      // The telemetry upsert and this read must both acquire the sole connection.
      expect(await single.telemetryEvent.count({ where: { id: row.id } })).toBe(1)
      sweepNow += 1100
      release()
      await dispatch
      expect(capture).toHaveBeenCalledTimes(1)
      expect(
        await single.communityReactionOutbox.findUniqueOrThrow({
          where: { id: second.id },
        })
      ).toMatchObject({ attempts: 0, lease_id: null, delivered_at: null })
      expect(
        await single.communityReactionOutbox.findUniqueOrThrow({ where: { id: row.id } })
      ).toMatchObject({ delivered_at: null, lease_id: null, attempts: 1 })
      await single.communityReactionOutbox.update({
        where: { id: row.id },
        data: {
          lease_id: randomUUID(),
          // SQL clock and eligibility share the actual database timestamp.
          lease_expires_at: new Date(clock!.now.getTime() - 1),
          next_attempt_at: new Date(0),
        },
      })
      capture.mockResolvedValue(undefined)
      await dispatcher.dispatchPending()
      expect(
        await single.communityReactionOutbox.findUniqueOrThrow({ where: { id: row.id } })
      ).toMatchObject({
        delivered_at: expect.any(Date) as unknown,
        attempts: 2,
        lease_id: null,
      })
    } finally {
      release()
      await dispatch
      await single.$disconnect()
      await prisma.telemetryEvent.deleteMany({
        where: { id: { in: [row.id, second.id] } },
      })
    }
  })

  it('delivers a durable reaction row through the runtime sweep', async () => {
    const { createCommunityWorkerRuntime } = await import(
      '../src/modules/community/community-worker-runtime.js'
    )
    const { userId, postId } = await fixture()
    await mutate(userId, postId, input('love'))
    const row = await prisma.communityReactionOutbox.findFirstOrThrow({
      where: { post_id: postId },
    })
    await prisma.communityReactionOutbox.update({
      where: { id: row.id },
      data: { next_attempt_at: new Date(0) },
    })
    const acknowledged = vi.fn().mockResolvedValue(undefined)
    const runtime = await createCommunityWorkerRuntime({
      prisma,
      telemetryService: new TelemetryService(prisma, {
        capture: vi.fn(),
        captureAcknowledged: acknowledged,
      }),
      engine: { screenImage: vi.fn(), screenText: vi.fn(), moderatePost: vi.fn() },
      meter: {
        recordScreenerReadiness: vi.fn(),
        recordScreening: vi.fn(),
        recordAttemptFailure: vi.fn(),
        recordModelHealth: vi.fn(),
      },
    })
    try {
      await runtime.sweeps.dispatchPending()
      expect(
        (
          await prisma.communityReactionOutbox.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).delivered_at
      ).toBeInstanceOf(Date)
      expect(acknowledged).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({ $insert_id: row.id }) as unknown,
        })
      )
    } finally {
      await runtime.close()
      await prisma.telemetryEvent.deleteMany({ where: { id: row.id } })
    }
  })
})

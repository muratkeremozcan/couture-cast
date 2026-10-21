import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityNotificationsWorker } from '../src/modules/community/community-notifications.worker.js'
import { CommunitySendGuard } from '../src/modules/community/community-send-guard.js'
import { CommunityPushProvider } from '../src/modules/community/community-push-provider.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { CommunityOperationalTelemetry } from '../src/modules/community/community-operational-telemetry.js'
import { PushRegistrationService } from '../src/modules/notifications/push-registration.service.js'
import {
  guardCommunitySubject,
  forgetCommunitySubject,
} from '../src/modules/community/community-privacy.js'
import { CommunityReceiptsWorker } from '../src/modules/community/community-receipts.worker.js'
import { CommunityUnavailableException } from '../src/modules/community/community-availability.js'
import { PushTokenRepository } from '../src/modules/notifications/push-token.repository.js'

const db = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: db.url } } })
const flags = new CommunityFlagEvaluationService(prisma, {
  getFeatureFlagValue: () => Promise.resolve(true),
})
let server: Server
let endpoint: string
let mode: 'accepted' | 'ambiguous' = 'accepted'
const requests: unknown[] = []
const sender = () =>
  new CommunitySendGuard(prisma, flags, new CommunityPushProvider(fetch, endpoint))
const worker = () => new CommunityNotificationsWorker(prisma, sender())

beforeAll(async () => {
  await db.migrate()
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      const value: unknown = JSON.parse(body)
      requests.push(value)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify(
          mode === 'accepted'
            ? { data: { status: 'ok', id: `ticket-${requests.length}` } }
            : { data: { status: 'ok' } }
        )
      )
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/push`
}, 30_000)
beforeEach(async () => {
  mode = 'accepted'
  requests.length = 0
  await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 0 WHERE id = 1`
  await prisma.communityNotificationIntent.deleteMany()
  await prisma.communityNotificationGroup.deleteMany()
})
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  await prisma.$disconnect()
  await db.drop()
})

async function fixture(tokens = 1) {
  const author = await persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )
  const actor = await persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: author.id, status: 'published' })
    ),
  })
  await prisma.notificationPreference.create({ data: { user_id: author.id } })
  await prisma.communityNotificationPreference.create({
    data: { user_id: author.id, enabled: true },
  })
  const registrations = new PushRegistrationService(prisma)
  for (let index = 0; index < tokens; index++)
    await registrations.register(author.id, {
      token: `ExpoPushToken[synthetic_${randomUUID().replaceAll('-', '')}]`,
      installationId: randomUUID(),
      platform: 'ios',
      permission: 'granted',
    })
  await new CommunityRepository(prisma).setReaction({
    userId: actor.id,
    postId: post.id,
    platform: 'web',
    input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
    assertEligible: () => Promise.resolve(),
  })
  await worker().group()
  await worker().fanout()
  const deliveries = await prisma.communityTokenDelivery.findMany({
    where: { group: { post_id: post.id } },
  })
  await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 1 WHERE id = 1`
  return { author, actor, post, deliveries }
}

describe('Story 6.5 actual guarded provider boundary', () => {
  it('R04 later contributors extend group expiry and policy edits retain outside-quiet spacing', async () => {
    const { author, post } = await fixture()
    const previous = await prisma.communityNotificationGroup.findFirstOrThrow({
      where: { post_id: post.id },
    })
    const actor = await persistUser(
      prisma,
      createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
    )
    await new CommunityRepository(prisma).setReaction({
      userId: actor.id,
      postId: post.id,
      platform: 'web',
      input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
      assertEligible: () => Promise.resolve(),
    })
    await worker().group()
    const pending = await prisma.communityNotificationGroup.findFirstOrThrow({
      where: { post_id: post.id, snapshot_at: null },
    })
    const floor = previous.snapshot_at!.getTime() + 30000
    expect(pending.next_attempt_at.getTime()).toBeGreaterThanOrEqual(floor)
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${author.id}]::text[],ARRAY[]::text[],true)`
      await tx.notificationPreference.update({
        where: { user_id: author.id },
        data: { timezone: 'Europe/London' },
      })
    })
    await worker().reconcilePolicies()
    expect(
      (
        await prisma.communityNotificationGroup.findUniqueOrThrow({
          where: { id: pending.id },
        })
      ).next_attempt_at.getTime()
    ).toBeGreaterThanOrEqual(floor)
    const third = await persistUser(
      prisma,
      createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
    )
    await new CommunityRepository(prisma).setReaction({
      userId: third.id,
      postId: post.id,
      platform: 'web',
      input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
      assertEligible: () => Promise.resolve(),
    })
    const later = new Date(pending.expires_at.getTime() + 60000)
    await prisma.communityNotificationIntent.updateMany({
      where: { actor_id: third.id, post_id: post.id },
      data: { expires_at: later },
    })
    await worker().group()
    expect(
      (
        await prisma.communityNotificationGroup.findUniqueOrThrow({
          where: { id: pending.id },
        })
      ).expires_at
    ).toEqual(later)
  })

  it('R04 attachment holds the actual group row against a concurrent token snapshot', async () => {
    const { author, post } = await fixture()
    const add = async () => {
      const actor = await persistUser(
        prisma,
        createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
      )
      await new CommunityRepository(prisma).setReaction({
        userId: actor.id,
        postId: post.id,
        platform: 'web',
        input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
        assertEligible: () => Promise.resolve(),
      })
      return actor
    }
    await add()
    await worker().group()
    const pending = await prisma.communityNotificationGroup.findFirstOrThrow({
      where: { post_id: post.id, snapshot_at: null },
    })
    await prisma.communityNotificationGroup.update({
      where: { id: pending.id },
      data: { next_attempt_at: new Date(0) },
    })
    await add()
    const attaching = worker()
    // Pause only after production discovery/row locking; invoke the unchanged attachment body.
    const attach = Reflect.get(attaching, 'attach') as (
      ...args: unknown[]
    ) => Promise<void>
    let entered!: () => void
    let release!: () => void
    const seen = new Promise<void>((resolve) => {
      entered = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    Reflect.set(attaching, 'attach', async (...args: unknown[]) => {
      entered()
      await held
      await Reflect.apply(attach, attaching, args)
    })
    const grouping = attaching.group()
    try {
      await seen
      expect(await worker().fanout()).toBe(0)
      expect(
        (
          await prisma.communityNotificationGroup.findUniqueOrThrow({
            where: { id: pending.id },
          })
        ).snapshot_at
      ).toBeNull()
    } finally {
      release()
    }
    await grouping
    expect(
      await prisma.communityNotificationIntent.count({ where: { group_id: pending.id } })
    ).toBe(2)
    expect(await worker().fanout()).toBe(1)
    expect(
      (
        await prisma.communityNotificationGroup.findUniqueOrThrow({
          where: { id: pending.id },
        })
      ).snapshot_at
    ).not.toBeNull()
    expect(author.id).toBe(pending.recipient_id)
  })
  it('R05 unavailable evaluation durably moves no-call work out of the oldest due page', async () => {
    const { deliveries } = await fixture()
    const guarded = new CommunitySendGuard(prisma, {
      evaluate: () => Promise.reject(new CommunityUnavailableException(45)),
    })
    const initial = await prisma.communityTokenDelivery.findUniqueOrThrow({
      where: { id: deliveries[0]!.id },
    })
    await expect(guarded.dispatch(initial.id)).resolves.toBeUndefined()
    const current = await prisma.communityTokenDelivery.findUniqueOrThrow({
      where: { id: initial.id },
    })
    expect(current.next_attempt_at.getTime()).toBeGreaterThan(Date.now())
    expect(current.status).toBe('deferred')
    expect(
      await prisma.communityDeliveryAttempt.count({ where: { delivery_id: initial.id } })
    ).toBe(0)
    expect(requests).toHaveLength(0)
  })
  it('R05 invalid receipt cleanup survives a failed prune and retries the captured binding', async () => {
    const { deliveries } = await fixture()
    await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 1 WHERE id = 1`
    await sender().dispatch(deliveries[0]!.id)
    await prisma.communityDeliveryReceipt.updateMany({
      data: { next_attempt_at: new Date(0) },
    })
    const tokens = new PushTokenRepository(prisma)
    const prune = vi
      .spyOn(tokens, 'deleteBindings')
      .mockRejectedValueOnce(new Error('temporary database failure'))
    const receipts = new CommunityReceiptsWorker(prisma, tokens, () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              'ticket-1': { status: 'error', details: { error: 'DeviceNotRegistered' } },
            },
          }),
          { status: 200 }
        )
      )
    )
    await receipts.sweep().catch(() => undefined)
    expect(prune).toHaveBeenCalledTimes(1)
    expect(await prisma.communityDeliveryReceipt.findFirst()).toMatchObject({
      status: 'invalid_token_pending_prune',
    })
    await prisma.communityDeliveryReceipt.updateMany({
      data: { next_attempt_at: new Date(0) },
    })
    await receipts.sweep()
    expect(prune).toHaveBeenCalledTimes(2)
    expect(
      await prisma.pushToken.findUnique({ where: { id: deliveries[0]!.registration_id } })
    ).toBeNull()
  })

  it('R05 expired pending receipts settle without waiting for a later poll or resending', async () => {
    const { deliveries } = await fixture()
    await sender().dispatch(deliveries[0]!.id)
    await prisma.communityDeliveryReceipt.updateMany({
      data: {
        expires_at: new Date(Date.now() - 1),
        next_attempt_at: new Date(Date.now() + 3600000),
      },
    })
    const transport = vi.fn<typeof fetch>()
    await new CommunityReceiptsWorker(
      prisma,
      new PushTokenRepository(prisma),
      transport
    ).sweep()
    expect(await prisma.communityDeliveryReceipt.findFirst()).toMatchObject({
      status: 'receipt_unknown',
    })
    expect(transport).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
    expect(await prisma.communityDeliveryAttempt.count()).toBe(1)
  })
  it('R05 durable invalid receipt cleanup cannot prune a transferred binding on retry', async () => {
    const { deliveries, actor } = await fixture()
    await sender().dispatch(deliveries[0]!.id)
    await prisma.communityDeliveryReceipt.updateMany({
      data: { next_attempt_at: new Date(0) },
    })
    const old = await prisma.pushToken.findUniqueOrThrow({
      where: { id: deliveries[0]!.registration_id },
    })
    const tokens = new PushTokenRepository(prisma)
    const prune = vi
      .spyOn(tokens, 'deleteBindings')
      .mockRejectedValueOnce(new Error('temporary prune outage'))
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            'ticket-1': { status: 'error', details: { error: 'DeviceNotRegistered' } },
          },
        }),
        { status: 200 }
      )
    )
    const receipts = new CommunityReceiptsWorker(prisma, tokens, transport)
    await receipts.sweep()
    expect(await prisma.communityDeliveryReceipt.findFirst()).toMatchObject({
      status: 'invalid_token_pending_prune',
    })
    const transferred = await new PushRegistrationService(prisma).register(actor.id, {
      installationId: old.installation_id!,
      token: old.token,
      permission: 'granted',
      platform: 'ios',
      transfer: true,
      expectedBinding: {
        registrationId: old.id,
        bindingGeneration: old.binding_generation,
      },
    })
    await prisma.communityDeliveryReceipt.updateMany({
      data: { next_attempt_at: new Date(0) },
    })
    await receipts.sweep()
    expect(await prisma.communityDeliveryReceipt.findFirst()).toMatchObject({
      status: 'invalid_token',
    })
    expect(
      await prisma.pushToken.findUniqueOrThrow({ where: { id: old.id } })
    ).toMatchObject({
      user_id: actor.id,
      binding_generation: transferred.bindingGeneration,
    })
    expect(prune).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(requests).toHaveLength(1)
  })
  it('6.5-INT-012: durable accepted token outcomes cannot resend on replay', async () => {
    const { deliveries, author, actor, post } = await fixture(2)
    const guard = sender()
    await guard.verifyRuntime()
    await Promise.all(deliveries.map((delivery) => guard.dispatch(delivery.id)))
    expect(requests).toHaveLength(2)
    await Promise.all(deliveries.map((delivery) => guard.dispatch(delivery.id)))
    expect(requests).toHaveLength(2)
    expect(
      await prisma.communityDeliveryAttempt.count({ where: { status: 'accepted' } })
    ).toBe(2)
    expect(await prisma.communityDeliveryReceipt.count()).toBe(2)
    const data = JSON.stringify(requests)
    for (const forbidden of [
      author.id,
      actor.id,
      author.email,
      actor.email,
      'love',
      'alias',
      'media',
    ])
      expect(data).not.toContain(forbidden)
    expect(data).toContain(post.id)
  })

  it('6.5-INT-019: consent restoration cannot qualify the same reaction again', async () => {
    const { actor, author, post } = await fixture()
    await prisma.$transaction(async (tx) => {
      await guardCommunitySubject(tx, actor.id)
      await forgetCommunitySubject(tx, actor.id, false)
    })
    const repo = new CommunityRepository(prisma)
    for (const [baseRevision, selection] of [
      [1, null],
      [2, 'love'],
    ] as const) {
      await repo.setReaction({
        userId: actor.id,
        postId: post.id,
        platform: 'web',
        input: { selection, baseRevision, mutationId: randomUUID() },
        assertEligible: () => Promise.resolve(),
      })
    }
    expect(
      await prisma.communityNotificationIntent.count({ where: { post_id: post.id } })
    ).toBe(1)
    expect(
      await prisma.communityNotificationIntent.findFirst({ where: { post_id: post.id } })
    ).toMatchObject({ actor_id: actor.id, recipient_id: author.id, deliverable: false })
    await worker().dispatch()
    expect(requests).toHaveLength(0)
  })

  it('6.5-UNIT-006 integration: policy edits record eligibility changes and release frozen unsent deliveries', async () => {
    const { author, deliveries, post } = await fixture(2)
    const before = await prisma.communityNotificationGroup.findFirstOrThrow({
      where: { post_id: post.id },
    })
    const qualification = await prisma.communityNotificationIntent.findFirstOrThrow({
      where: { group_id: before.id },
    })
    const hour = new Date().getUTCHours()
    const hm = (h: number) => `${String(h % 24).padStart(2, '0')}:00`
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${author.id}]::text[],ARRAY[]::text[],true)`
      await tx.notificationPreference.update({
        where: { user_id: author.id },
        data: {
          quiet_hours_enabled: true,
          quiet_hours_start: hm(hour),
          quiet_hours_end: hm(hour + 2),
          timezone: 'UTC',
        },
      })
    })
    await worker().reconcilePolicies()
    const deferred = await prisma.communityNotificationGroup.findUniqueOrThrow({
      where: { id: before.id },
    })
    expect(deferred.eligible_at.getTime()).toBeGreaterThan(Date.now())
    expect(
      await prisma.communityTokenDelivery.findMany({ where: { group_id: before.id } })
    ).toEqual(
      expect.arrayContaining(
        deliveries.map(
          (delivery) =>
            expect.objectContaining({
              id: delivery.id,
              status: 'deferred',
              next_attempt_at: deferred.eligible_at,
            }) as unknown
        )
      )
    )
    await worker().dispatch()
    expect(requests).toHaveLength(0)
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${author.id}]::text[],ARRAY[]::text[],true)`
      await tx.notificationPreference.update({
        where: { user_id: author.id },
        data: { quiet_hours_enabled: false },
      })
    })
    await worker().reconcilePolicies()
    const released = await prisma.communityNotificationGroup.findUniqueOrThrow({
      where: { id: before.id },
    })
    expect(released.eligible_at.getTime()).toBeLessThanOrEqual(Date.now())
    expect(released.expires_at).toEqual(before.expires_at)
    expect(
      await prisma.communityNotificationIntent.findUnique({
        where: { id: qualification.id },
      })
    ).toMatchObject({
      qualification_recorded_at: qualification.qualification_recorded_at,
    })
    expect(
      await prisma.communityEligibilityChange.findMany({
        where: { group_id: before.id },
        orderBy: { recorded_at: 'asc' },
      })
    ).toMatchObject([
      {
        reason: 'qualified',
        previous_eligible_at: before.eligible_at,
        eligible_at: before.eligible_at,
      },
      {
        previous_eligible_at: before.eligible_at,
        eligible_at: deferred.eligible_at,
        reason: 'deferred',
      },
      {
        previous_eligible_at: deferred.eligible_at,
        eligible_at: released.eligible_at,
        reason: 'allowed',
      },
    ])
    await worker().dispatch()
    expect(requests).toHaveLength(2)
  })

  it('6.5-PERF-local telemetry: unknown sink acceptance replays the same anonymous event ID', async () => {
    await prisma.communityEngagementTelemetry.deleteMany()
    const { author, actor, post, deliveries } = await fixture()
    await sender().dispatch(deliveries[0]!.id)
    const sent: unknown[] = []
    const telemetry = new CommunityOperationalTelemetry(prisma, {
      captureAcknowledged: (event) => {
        sent.push(event)
        return sent.length === 1
          ? Promise.reject(new Error('fixture unknown acceptance'))
          : Promise.resolve()
      },
    })
    await telemetry.deliver()
    const pending = await prisma.communityEngagementTelemetry.findFirstOrThrow()
    expect(pending.delivered_at).toBeNull()
    await prisma.communityEngagementTelemetry.update({
      where: { id: pending.id },
      data: { next_attempt_at: new Date(0) },
    })
    await telemetry.deliver()
    expect(sent).toHaveLength(2)
    expect(sent[0]).toEqual(sent[1])
    for (const secret of [author.id, actor.id, post.id, author.email, actor.email])
      expect(JSON.stringify(sent)).not.toContain(secret)
    expect(
      await prisma.communityEngagementTelemetry.findUnique({ where: { id: pending.id } })
    ).toMatchObject({ attempts: 2, delivered_at: expect.any(Date) as Date })
  })

  it('6.5-INT-013: missing acceptance ticket is terminal unknown and never retries', async () => {
    const { deliveries } = await fixture()
    mode = 'ambiguous'
    await sender().dispatch(deliveries[0]!.id)
    expect(requests).toHaveLength(1)
    expect(
      await prisma.communityTokenDelivery.findUniqueOrThrow({
        where: { id: deliveries[0]!.id },
      })
    ).toMatchObject({ status: 'unknown' })
    await worker().recover()
    await worker().dispatch()
    expect(requests).toHaveLength(1)
  })

  it('6.5-INT-023: a delayed weather invalid-token cleanup cannot delete a transferred binding', async () => {
    const { author, actor } = await fixture()
    const old = await prisma.pushToken.findFirstOrThrow({ where: { user_id: author.id } })
    const captured = {
      registrationId: old.id,
      ownerId: old.user_id,
      bindingGeneration: old.binding_generation,
      token: old.token,
    }
    const transferred = await new PushRegistrationService(prisma).register(actor.id, {
      installationId: old.installation_id!,
      transfer: true,
      expectedBinding: {
        registrationId: old.id,
        bindingGeneration: old.binding_generation,
      },
      token: old.token,
      permission: 'granted',
      platform: 'ios',
    })
    expect(transferred.bindingGeneration).toBe(old.binding_generation + 1)
    expect(await new PushTokenRepository(prisma).deleteBindings([captured])).toBe(0)
    expect(
      await prisma.pushToken.findUniqueOrThrow({ where: { id: old.id } })
    ).toMatchObject({
      user_id: actor.id,
      binding_generation: transferred.bindingGeneration,
    })
  })
  it('6.5-INT-024: stale refresh and implicit transfer cannot rewrite a newer binding', async () => {
    const { author, actor } = await fixture()
    const old = await prisma.pushToken.findFirstOrThrow({ where: { user_id: author.id } })
    const registrations = new PushRegistrationService(prisma)
    const input = {
      installationId: old.installation_id!,
      token: old.token,
      permission: 'granted' as const,
      platform: 'ios' as const,
      expectedBinding: {
        registrationId: old.id,
        bindingGeneration: old.binding_generation,
      },
    }
    await expect(registrations.register(actor.id, input)).rejects.toMatchObject({
      status: 409,
    })
    const rotated = await registrations.register(author.id, {
      ...input,
      token: `ExpoPushToken[rotation_${randomUUID().replaceAll('-', '')}]`,
    })
    expect(rotated.bindingGeneration).toBe(old.binding_generation + 1)
    await expect(registrations.register(author.id, input)).rejects.toMatchObject({
      status: 409,
    })
    await expect(
      registrations.register(actor.id, { ...input, transfer: true })
    ).rejects.toMatchObject({ status: 409 })
    expect(await registrations.remove(author.id, old.id, old.binding_generation)).toEqual(
      { removed: false }
    )
    const current = await prisma.pushToken.findUniqueOrThrow({ where: { id: old.id } })
    expect(current).toMatchObject({
      user_id: author.id,
      binding_generation: rotated.bindingGeneration,
    })
    expect(current.token).not.toBe(old.token)
  })
})

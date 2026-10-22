// Story 6.5 acceptance lane B (D8): retention cutoffs and independent loop progress.
//
// The compiled runtime runs its own loops in an owned child. Each cutoff is seeded one minute
// inside and one minute outside by writing row timestamps; no process clock moves.
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createUser,
  persistUser,
} from '@couture/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  ledgerSchema,
  OwnedProcess,
  readySchema,
  until,
} from './helpers/community-engagement-harness.js'
import { usageCollector, writeEvidence } from './helpers/community-acceptance.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { PushRegistrationService } from '../src/modules/notifications/push-registration.service.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
// The runtime sweeps every 10 s; two passes plus a transaction bound the wait.
const SWEEP_WAIT = 25_000
// Receipts are looked up every 30 s.
const RECEIPT_WAIT = 40_000

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const repository = new CommunityRepository(prisma)
const registrations = new PushRegistrationService(prisma)
const children: OwnedProcess[] = []
const spawn = (file: string, variables: NodeJS.ProcessEnv = {}) => {
  const child = new OwnedProcess(file, variables)
  children.push(child)
  return child
}
let provider: OwnedProcess
let runtime: OwnedProcess
let collector: Awaited<ReturnType<typeof usageCollector>>
const evidence: Record<string, unknown> = {}

const active = () =>
  persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )
/** A recipient who has opted in, holds one granted binding and owns a post. */
async function recipient() {
  const user = await active()
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${user.id}]::text[],ARRAY[]::text[],true)`
    await tx.notificationPreference.create({ data: { user_id: user.id } })
    await tx.communityNotificationPreference.create({
      data: { user_id: user.id, enabled: true },
    })
  })
  const binding = await registrations.register(user.id, {
    token: `ExpoPushToken[synthetic_${randomUUID().replaceAll('-', '')}]`,
    installationId: randomUUID(),
    permission: 'granted',
    platform: 'ios',
  })
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: user.id, status: 'published' })
    ),
  })
  return { id: user.id, post: post.id, binding }
}
async function react(actor: string, post: string) {
  await repository.setReaction({
    userId: actor,
    postId: post,
    platform: 'web',
    input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
    assertEligible: () => Promise.resolve(),
  })
}
/** Waits for the runtime to append, group, fan out and hand off one notification. */
async function accepted(owner: string) {
  return until(
    () =>
      prisma.communityTokenDelivery.findFirst({
        where: { owner_id: owner, status: 'accepted' },
        include: { attempts: true, group: true },
      }),
    Boolean,
    20_000
  )
}

beforeAll(async () => {
  await database.migrate()
  const [server] = await prisma.$queryRaw<{ version: number }[]>`
    SELECT current_setting('server_version_num')::integer AS version`
  expect(server?.version).toBeGreaterThanOrEqual(170000)
  await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 1 WHERE id = 1`
  provider = spawn('community-provider-recorder.mjs')
  const recorder = readySchema.parse(await provider.event('ready'))
  const remote = spawn('community-flag-remote.mjs')
  const flags = readySchema.parse(await remote.event('ready'))
  runtime = spawn('community-runtime-process.mjs', {
    DATABASE_URL: database.url,
    COMMUNITY_GUARD_DATABASE_URL: database.url,
    COMMUNITY_DISPATCH_ENABLED: 'true',
    COMMUNITY_ENGAGEMENT_OWNER: 'general',
    STORY65_PROVIDER_ENDPOINT: `http://127.0.0.1:${recorder.port}/push`,
    STORY65_FLAG_REMOTE_ENDPOINT: `http://127.0.0.1:${flags.port}/flag`,
  })
  const ready = readySchema.parse(await runtime.event('ready', 15_000))
  expect(await runtime.call('start', 'general')).toEqual({ status: 'ready' })
  collector = await usageCollector(spawn, database.url)
  await collector.track({ runtime: ready.pid, provider: recorder.pid, flags: flags.pid })
  evidence.postgres = server?.version
  await collector.start()
}, 120_000)

afterAll(async () => {
  evidence.usage = await collector?.stop().catch(() => null)
  evidence.runtimeCounts = await runtime?.call('counts').catch(() => null)
  await writeEvidence('lane-b-retention', evidence)
  const outcomes = await Promise.allSettled(children.map((child) => child.close()))
  await prisma.$disconnect()
  await database.drop()
  expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([])
}, 120_000)

describe.sequential('retention cutoffs', () => {
  it('deletes exactly what is past each cutoff and keeps what is one minute inside it', async () => {
    const actor = await active()
    const [oldDetail, newDetail, oldToken, newToken] = await Promise.all([
      recipient(),
      recipient(),
      recipient(),
      recipient(),
    ])
    // Real notifications end to end, so the detail rows are the runtime's own.
    await react(actor.id, oldDetail.post)
    await react(actor.id, newDetail.post)
    const [oldDelivery, newDelivery] = await Promise.all([
      accepted(oldDetail.id),
      accepted(newDetail.id),
    ])
    const events = await until(
      () =>
        prisma.communityStreamEvent.findMany({
          orderBy: [{ stream_id: 'asc' }, { sequence: 'asc' }],
        }),
      (rows) => rows.length >= 4,
      10_000
    )
    const now = Date.now()
    const outside = (age: number) => new Date(now - age - MINUTE)
    const inside = (age: number) => new Date(now - age + MINUTE)

    // 48 h stream events and their appended outbox rows. Two per side on one stream.
    const stream = events[0]!.stream_id
    const lane = events.filter((event) => event.stream_id === stream)
    expect(lane.length).toBeGreaterThanOrEqual(2)
    const expiredEvents = lane.slice(0, Math.ceil(lane.length / 2))
    const keptEvents = lane.slice(expiredEvents.length)
    for (const [rows, at] of [
      [expiredEvents, outside(48 * HOUR)],
      [keptEvents, inside(48 * HOUR)],
    ] as const) {
      const ids = rows.map((row) => row.id)
      const outbox = rows.map((row) => row.source_outbox_id)
      await prisma.communityStreamEvent.updateMany({
        where: { id: { in: ids } },
        data: { appended_at: at },
      })
      await prisma.communityDomainOutbox.updateMany({
        where: { id: { in: outbox } },
        data: { appended_at: at },
      })
    }
    const floorBefore = (
      await prisma.communityStreamHead.findUniqueOrThrow({ where: { id: stream } })
    ).retention_floor

    // 30 d inactive bindings.
    await prisma.pushToken.update({
      where: { id: oldToken.binding.registrationId },
      data: { last_used_at: outside(30 * DAY) },
    })
    await prisma.pushToken.update({
      where: { id: newToken.binding.registrationId },
      data: { last_used_at: inside(30 * DAY) },
    })

    // 30 d terminal detail: group, delivery, attempt and their subject links.
    const terminal = async (
      delivery: NonNullable<Awaited<ReturnType<typeof accepted>>>,
      at: Date
    ) => {
      await prisma.communityNotificationGroup.update({
        where: { id: delivery.group_id },
        data: { created_at: at, expires_at: new Date(now - MINUTE) },
      })
      await prisma.communityDeliveryAttempt.updateMany({
        where: { delivery_id: delivery.id },
        data: { completed_at: at },
      })
    }
    await terminal(oldDelivery!, outside(30 * DAY))
    await terminal(newDelivery!, inside(30 * DAY))

    // 24 h flag cache, written by the production evaluator.
    const evaluator = new CommunityFlagEvaluationService(prisma, {
      getFeatureFlagValue: () => Promise.resolve(true),
    })
    const [oldFlag, newFlag] = [oldToken.id, newToken.id]
    await evaluator.evaluate(oldFlag)
    await evaluator.evaluate(newFlag)
    await prisma.communityFlagEvaluation.updateMany({
      where: { member_id: oldFlag },
      data: { last_used_at: outside(DAY) },
    })
    await prisma.communityFlagEvaluation.updateMany({
      where: { member_id: newFlag },
      data: { last_used_at: inside(DAY) },
    })

    // 30 d operational telemetry.
    const telemetry = (at: Date) =>
      prisma.communityEngagementTelemetry.create({
        data: {
          event_type: 'acceptance_cutoff',
          outcome: 'seeded',
          build_identity: 'lane-b',
          created_at: at,
          delivered_at: at,
        },
      })
    const oldTelemetry = await telemetry(outside(30 * DAY))
    const newTelemetry = await telemetry(inside(30 * DAY))

    const subjects = async (kind: string, ids: string[]) =>
      prisma.communityArtifactSubject.count({
        where: { artifact_kind: kind, artifact_id: { in: ids } },
      })
    const oldAttemptIds = oldDelivery!.attempts.map((attempt) => attempt.id)
    const started = Date.now()
    await until(
      async () => ({
        events: await prisma.communityStreamEvent.count({
          where: { id: { in: expiredEvents.map((row) => row.id) } },
        }),
        token: await prisma.pushToken.count({
          where: { id: oldToken.binding.registrationId },
        }),
        group: await prisma.communityNotificationGroup.count({
          where: { id: oldDelivery!.group_id },
        }),
        flag: await prisma.communityFlagEvaluation.count({
          where: { member_id: oldFlag },
        }),
        telemetry: await prisma.communityEngagementTelemetry.count({
          where: { id: oldTelemetry.id },
        }),
      }),
      (left) => Object.values(left).every((count) => count === 0),
      SWEEP_WAIT
    )
    const elapsed = Date.now() - started

    // Outside every cutoff: gone, with every subject link that pointed at it.
    expect(
      await prisma.communityDomainOutbox.count({
        where: { id: { in: expiredEvents.map((row) => row.source_outbox_id) } },
      })
    ).toBe(0)
    expect(
      await subjects(
        'event',
        expiredEvents.map((row) => row.id)
      )
    ).toBe(0)
    expect(
      await prisma.communityTokenDelivery.count({ where: { id: oldDelivery!.id } })
    ).toBe(0)
    expect(
      await prisma.communityDeliveryAttempt.count({
        where: { id: { in: oldAttemptIds } },
      })
    ).toBe(0)
    expect(await subjects('group', [oldDelivery!.group_id])).toBe(0)
    expect(await subjects('delivery', [oldDelivery!.id])).toBe(0)
    expect(await subjects('attempt', oldAttemptIds)).toBe(0)
    const floor = (
      await prisma.communityStreamHead.findUniqueOrThrow({ where: { id: stream } })
    ).retention_floor
    expect(floor).toBe(expiredEvents.at(-1)!.sequence)
    expect(floor).toBeGreaterThanOrEqual(floorBefore)

    // One minute inside every cutoff: untouched.
    expect(
      await prisma.communityStreamEvent.count({
        where: { id: { in: keptEvents.map((row) => row.id) } },
      })
    ).toBe(keptEvents.length)
    expect(
      await prisma.pushToken.count({ where: { id: newToken.binding.registrationId } })
    ).toBe(1)
    expect(
      await prisma.communityNotificationGroup.count({
        where: { id: newDelivery!.group_id },
      })
    ).toBe(1)
    expect(
      await prisma.communityTokenDelivery.count({ where: { id: newDelivery!.id } })
    ).toBe(1)
    expect(
      await prisma.communityFlagEvaluation.count({ where: { member_id: newFlag } })
    ).toBe(1)
    expect(
      await prisma.communityEngagementTelemetry.count({ where: { id: newTelemetry.id } })
    ).toBe(1)
    evidence.cutoffs = {
      sweptWithinMs: elapsed,
      stream: {
        expired: expiredEvents.length,
        kept: keptEvents.length,
        floor: floor.toString(),
      },
    }
  }, 120_000)

  it('keeps appending, sending, receipting and sweeping while analytics is held', async () => {
    await runtime.call('analytics', true)
    try {
      const actor = await active()
      const target = await recipient()
      const heldAt = Date.now()
      await react(actor.id, target.post)
      // Append and send progress with every analytics acknowledgement held.
      const delivery = await accepted(target.id)
      const appended = await prisma.communityDomainOutbox.findFirst({
        where: { post_id: target.post, appended_at: { not: null } },
      })
      expect(appended).not.toBeNull()
      const sentMs = delivery!.attempts[0]!.completed_at!.getTime() - heldAt
      // Receipt lookup progress: bring the first lookup forward to now.
      await prisma.communityDeliveryReceipt.updateMany({
        where: { attempt_id: delivery!.attempts[0]!.id },
        data: { next_attempt_at: new Date() },
      })
      const receipt = await until(
        () =>
          prisma.communityDeliveryReceipt.findFirst({
            where: { attempt_id: delivery!.attempts[0]!.id },
          }),
        (row) => row !== null && row.status !== 'pending',
        RECEIPT_WAIT
      )
      // Retention progress: a fresh expired telemetry row is swept.
      const expired = await prisma.communityEngagementTelemetry.create({
        data: {
          event_type: 'acceptance_cutoff',
          outcome: 'seeded',
          build_identity: 'lane-b',
          created_at: new Date(Date.now() - 30 * DAY - MINUTE),
        },
      })
      await until(
        () => prisma.communityEngagementTelemetry.count({ where: { id: expired.id } }),
        (count) => count === 0,
        SWEEP_WAIT
      )
      const held = (await runtime.call('counts')) as { analyticsHeld: number }
      expect(held.analyticsHeld).toBeGreaterThan(0)
      const ledger = ledgerSchema.parse(await provider.call('ledger'))
      evidence.stall = {
        sentMs,
        receipt: receipt?.status,
        analyticsHeld: held.analyticsHeld,
        ledger: ledger.length,
      }
    } finally {
      await runtime.call('analytics', false)
    }
  }, 120_000)
})

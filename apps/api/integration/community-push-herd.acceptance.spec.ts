// Story 6.5 acceptance lane C (D10/PERF-002): quiet-hour herd release and outages.
//
// N = max(500, H). H is an open input until a production cohort count exists, so N = 500.
// The compiled engagement runtime runs as production composes it, in an owned child, against
// a UUID PG17 database. Only Expo, the remote flag provider and analytics are local doubles.
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
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
import {
  dbClockSkew,
  usageCollector,
  writeEvidence,
} from './helpers/community-acceptance.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { PushRegistrationService } from '../src/modules/notifications/push-registration.service.js'

const HERD = Math.max(500, Number(process.env.STORY65_HERD_H ?? 0))
const BURST = 40
const SUSTAINED = 60
const EXPIRING = 10
const BOUND_MS = 60_000
// Currently observing DST (northern and southern) and fixed offsets, including :30 and :45.
const ZONES = [
  'UTC',
  'America/New_York',
  'Europe/London',
  'Australia/Sydney',
  'Pacific/Chatham',
  'Asia/Kolkata',
  'America/Sao_Paulo',
]

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
let runtimePid = 0
let collector: Awaited<ReturnType<typeof usageCollector>>
let skewMs = 0
let actors: string[] = []
const evidence: Record<string, unknown> = {
  herd: HERD,
  hInput: process.env.STORY65_HERD_H ?? 'open',
}

const dbNow = () => Date.now() + skewMs
const waitUntilDb = async (instant: number) => {
  const remaining = instant - dbNow()
  if (remaining > 0) await delay(remaining)
}
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        results[index] = await work(items[index]!, index)
      }
    })
  )
  return results
}
function localMinute(instant: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  return `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`
}
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null
  )
}
const summary = (values: number[]) => ({
  count: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  p99: percentile(values, 99),
  max: values.length ? Math.max(...values) : null,
})

/** A recipient with one granted iOS binding and a post of their own to be reacted to. */
async function recipient(quiet?: { zone: string; release: number }) {
  const user = await persistUser(
    prisma,
    createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
  )
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${user.id}]::text[],ARRAY[]::text[],true)`
    await tx.notificationPreference.create({
      data: {
        user_id: user.id,
        quiet_hours_enabled: Boolean(quiet),
        // Quiet for the three hours before the release minute, in the recipient's own zone.
        ...(quiet
          ? {
              quiet_hours_start: localMinute(quiet.release - 3 * 3_600_000, quiet.zone),
              quiet_hours_end: localMinute(quiet.release, quiet.zone),
              timezone: quiet.zone,
            }
          : {}),
      },
    })
    await tx.communityNotificationPreference.create({
      data: { user_id: user.id, enabled: true },
    })
  })
  await registrations.register(user.id, {
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
  return { id: user.id, post: post.id }
}
async function react(index: number, post: string) {
  await repository.setReaction({
    userId: actors[index % actors.length]!,
    postId: post,
    platform: 'web',
    input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
    assertEligible: () => Promise.resolve(),
  })
  return dbNow()
}
async function deliveriesFor(ids: string[]) {
  return prisma.communityTokenDelivery.findMany({
    where: { owner_id: { in: ids } },
    include: {
      group: { select: { eligible_at: true, status: true } },
      attempts: { select: { started_at: true, completed_at: true, status: true } },
    },
  })
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
  runtimePid = ready.pid
  expect(await runtime.call('start', 'general')).toEqual({ status: 'ready' })
  collector = await usageCollector(spawn, database.url)
  await collector.track({ runtime: ready.pid, provider: recorder.pid, flags: flags.pid })
  const clock = await dbClockSkew(prisma)
  skewMs = clock.skewMs
  evidence.clock = { ...clock, postgres: server?.version, runtimeBackend: ready.backend }
  actors = await mapLimit(Array.from({ length: 20 }), 10, async () => {
    const actor = await persistUser(
      prisma,
      createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
    )
    return actor.id
  })
  await collector.start()
}, 120_000)

afterAll(async () => {
  evidence.usage = await collector?.stop().catch(() => null)
  evidence.runtimeCounts = await runtime?.call('counts').catch(() => null)
  await writeEvidence('lane-c-herd', evidence)
  runtime?.signal('SIGCONT')
  const outcomes = await Promise.allSettled(children.map((child) => child.close()))
  await prisma.$disconnect()
  await database.drop()
  expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([])
}, 120_000)

type Outage = 'none' | 'worker-stall' | 'provider-stall'

async function scenario(outage: Outage) {
  const ledgerBefore = ledgerSchema.parse(await provider.call('ledger')).length
  // The release minute leaves room to build and qualify every fixture while still quiet.
  const release = Math.ceil((dbNow() + 210_000) / 60_000) * 60_000
  const herd = await mapLimit(Array.from({ length: HERD }), 16, (_, index) =>
    recipient({ zone: ZONES[index % ZONES.length]!, release })
  )
  const expiring =
    outage === 'worker-stall'
      ? await mapLimit(Array.from({ length: EXPIRING }), 8, () =>
          recipient({ zone: 'UTC', release })
        )
      : []
  const normal = await mapLimit(Array.from({ length: BURST + SUSTAINED }), 16, () =>
    recipient()
  )
  await mapLimit([...herd, ...expiring], 16, (target, index) => react(index, target.post))
  // Every herd group is qualified while quiet, with the release minute as its eligibility.
  const quietIds = [...herd, ...expiring].map((target) => target.id)
  await until(
    () =>
      prisma.communityNotificationGroup.count({
        where: { recipient_id: { in: quietIds }, status: 'deferred' },
      }),
    (count) => count === quietIds.length,
    Math.max(5000, release - dbNow() - 30_000)
  )
  const qualified = await prisma.communityNotificationGroup.findMany({
    where: { recipient_id: { in: quietIds } },
  })
  expect(qualified.every((group) => group.eligible_at.getTime() === release)).toBe(true)
  if (expiring.length) {
    // These lapse inside the outage; when the worker returns they must stay expired.
    const lapse = new Date(release + 10_000)
    const ids = expiring.map((target) => target.id)
    await prisma.communityNotificationIntent.updateMany({
      where: { recipient_id: { in: ids } },
      data: { expires_at: lapse },
    })
    await prisma.communityNotificationGroup.updateMany({
      where: { recipient_id: { in: ids } },
      data: { expires_at: lapse },
    })
  }
  expect(dbNow()).toBeLessThan(release - 15_000)

  let recovery = release
  const outageTimeline: Record<string, number> = {}
  if (outage === 'worker-stall') {
    await waitUntilDb(release - 10_000)
    runtime.signal('SIGSTOP')
    outageTimeline.stoppedAt = dbNow()
  }
  if (outage === 'provider-stall') {
    await waitUntilDb(release - 5000)
    await provider.call('mode', 'hold')
    outageTimeline.heldAt = dbNow()
  }
  await waitUntilDb(release)
  // Normal traffic: a burst of 40 at the release minute, then 1/s for 60 s.
  const burstCommits = await Promise.all(
    normal.slice(0, BURST).map((target, index) => react(index, target.post))
  )
  const sustainedCommits: number[] = []
  const sustained = (async () => {
    for (const [index, target] of normal.slice(BURST).entries()) {
      await waitUntilDb(release + (index + 1) * 1000)
      sustainedCommits.push(await react(index, target.post))
    }
  })()
  if (outage !== 'none') {
    await waitUntilDb(release + 20_000)
    if (outage === 'worker-stall') runtime.signal('SIGCONT')
    else await provider.call('release', 'accepted')
    recovery = dbNow()
    outageTimeline.recoveredAt = recovery
  }
  await sustained

  const herdIds = herd.map((target) => target.id)
  const normalIds = normal.map((target) => target.id)
  const expected = herdIds.length + normalIds.length
  const terminal = ['accepted', 'unknown', 'suppressed', 'expired', 'failed']
  await until(
    () =>
      prisma.communityTokenDelivery.count({
        where: { owner_id: { in: [...herdIds, ...normalIds] }, status: { in: terminal } },
      }),
    (count) => count === expected,
    Math.max(5000, recovery + BOUND_MS + 15_000 - dbNow())
  ).catch(() => undefined)

  const herdRows = await deliveriesFor(herdIds)
  const normalRows = await deliveriesFor(normalIds)
  const commitOf = new Map(
    normal.map((target, index) => [
      target.id,
      index < BURST ? burstCommits[index]! : sustainedCommits[index - BURST]!,
    ])
  )
  const measure = (
    rows: typeof herdRows,
    origin: (row: (typeof herdRows)[number]) => number
  ) =>
    rows.map((row) => {
      const first = row.attempts[0]
      return {
        status: row.status,
        attempts: row.attempts.length,
        dispatchMs: first ? first.started_at.getTime() - origin(row) : null,
        terminalMs: first?.completed_at
          ? first.completed_at.getTime() - origin(row)
          : null,
      }
    })
  // The bound runs from the first allowed instant, or from recovery when an outage held it.
  const herdMeasured = measure(herdRows, (row) =>
    Math.max(row.group.eligible_at.getTime(), recovery)
  )
  const normalMeasured = measure(normalRows, (row) =>
    Math.max(commitOf.get(row.owner_id!)!, recovery)
  )
  const changes = await prisma.communityEligibilityChange.findMany({
    where: { group: { recipient_id: { in: herdIds } } },
  })
  const expiredGroups = expiring.length
    ? await prisma.communityNotificationGroup.findMany({
        where: { recipient_id: { in: expiring.map((target) => target.id) } },
        include: { deliveries: true },
      })
    : []
  const ledger = ledgerSchema.parse(await provider.call('ledger')).slice(ledgerBefore)
  const counts = (rows: { status: string }[]) =>
    rows.reduce<Record<string, number>>((all, row) => {
      all[row.status] = (all[row.status] ?? 0) + 1
      return all
    }, {})
  const result = {
    outage,
    release,
    recovery,
    outageTimeline,
    herd: {
      deliveries: herdRows.length,
      statuses: counts(herdRows),
      dispatch: summary(
        herdMeasured.flatMap((row) => (row.dispatchMs === null ? [] : [row.dispatchMs]))
      ),
      terminal: summary(
        herdMeasured.flatMap((row) => (row.terminalMs === null ? [] : [row.terminalMs]))
      ),
      overdue: herdMeasured.filter(
        (row) => row.terminalMs === null || row.terminalMs > BOUND_MS
      ).length,
    },
    normal: {
      deliveries: normalRows.length,
      statuses: counts(normalRows),
      dispatch: summary(
        normalMeasured.flatMap((row) => (row.dispatchMs === null ? [] : [row.dispatchMs]))
      ),
      terminal: summary(
        normalMeasured.flatMap((row) => (row.terminalMs === null ? [] : [row.terminalMs]))
      ),
      overdue: normalMeasured.filter(
        (row) => row.terminalMs === null || row.terminalMs > BOUND_MS
      ).length,
    },
    eligibilityReasons: counts(changes.map((change) => ({ status: change.reason }))),
    expired: expiredGroups.map((group) => ({
      status: group.status,
      deliveries: group.deliveries.length,
    })),
    ledger: {
      requests: ledger.length,
      accepted: ledger.filter((entry) => entry.accepted).length,
    },
  }
  ;(evidence.scenarios ??= []) as unknown[]
  ;(evidence.scenarios as unknown[]).push(result)

  // One delivery per token, every one terminal, none sent twice, all inside the bound.
  expect(herdRows).toHaveLength(HERD)
  expect(normalRows).toHaveLength(BURST + SUSTAINED)
  expect([...herdMeasured, ...normalMeasured].every((row) => row.attempts === 1)).toBe(
    true
  )
  expect(result.herd.overdue).toBe(0)
  expect(result.normal.overdue).toBe(0)
  // Qualification fixed the release minute; nothing reset eligibility afterwards.
  expect(changes.every((change) => change.reason === 'qualified_quiet')).toBe(true)
  expect(changes.every((change) => change.eligible_at.getTime() === release)).toBe(true)
  if (outage !== 'provider-stall') {
    expect(result.herd.statuses).toEqual({ accepted: HERD })
    expect(result.normal.statuses).toEqual({ accepted: BURST + SUSTAINED })
    expect(result.ledger.requests).toBe(HERD + BURST + SUSTAINED)
  }
  for (const group of expiredGroups) {
    expect(group.status).toBe('expired')
    expect(group.deliveries).toEqual([])
  }
  return result
}

describe.sequential('quiet-hour herd of max(500, H) due tokens', () => {
  it('dispatches every released token within 60 s alongside normal traffic', async () => {
    await scenario('none')
  }, 600_000)

  it('drains the backlog within 60 s of a stalled worker resuming; expired work stays expired', async () => {
    expect(runtimePid).toBeGreaterThan(0)
    await scenario('worker-stall')
  }, 600_000)

  it('settles every token within 60 s of a held provider releasing, without a resend', async () => {
    await scenario('provider-stall')
  }, 600_000)
})

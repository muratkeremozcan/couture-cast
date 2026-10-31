// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Story 6.5 acceptance lane A (D1/PERF-003): real wall-clock 45/60 flag cache timeline.
//
// Two compiled evaluator processes with their own pools share one UUID database and one
// loopback remote provider. Nothing here moves a clock: phases wait for real DB time.
import { setTimeout as delay } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'
import { createUser, persistUser } from '@couture/testing'
import { z } from 'zod'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import {
  OwnedProcess,
  readySchema,
  until,
} from './helpers/community-engagement-harness.js'
import {
  dbClockSkew,
  usageCollector,
  writeEvidence,
} from './helpers/community-acceptance.js'

const evaluationSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('granted'),
    value: z.boolean(),
    expiresAt: z.number(),
    wall: z.number(),
    elapsedMs: z.number(),
  }),
  z.object({
    outcome: z.literal('unavailable'),
    retryAfterSeconds: z.number(),
    wall: z.number(),
    elapsedMs: z.number(),
  }),
])
type Evaluation = z.infer<typeof evaluationSchema> & { instance: number }
const callSchema = z.array(
  z.object({
    member: z.string(),
    mode: z.string(),
    at: z.number(),
    wall: z.number(),
    endedAt: z.number().nullable(),
    outcome: z.string().nullable(),
  })
)

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const children: OwnedProcess[] = []
const spawn = (file: string, variables: NodeJS.ProcessEnv = {}) => {
  const child = new OwnedProcess(file, variables)
  children.push(child)
  return child
}
let remote: OwnedProcess
let endpoint: string
let instances: OwnedProcess[]
let collector: Awaited<ReturnType<typeof usageCollector>>
let skewMs = 0
let clockBoundMs = 0
const evidence: Record<string, unknown> = {}

function instance() {
  return spawn('community-flag-instance.mjs', {
    STORY65_WORKER_DATABASE_URL: database.url,
    STORY65_FLAG_REMOTE_ENDPOINT: endpoint,
  })
}
/** Local wall time expressed on the DB clock that stamps claims and expiries. */
const dbNow = () => Date.now() + skewMs
const waitUntilDb = async (instant: number) => {
  const remaining = instant - dbNow()
  if (remaining > 0) await delay(remaining)
}
const member = async () =>
  (
    await persistUser(
      prisma,
      createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
    )
  ).id
const row = (id: string) =>
  prisma.communityFlagEvaluation.findFirstOrThrow({
    where: { member_id: id, flag_key: 'community_read_enabled' },
  })
const calls = async (id: string) =>
  callSchema.parse(await remote.call('calls')).filter((call) => call.member === id)
const mode = (id: string, value: string) =>
  remote.call('mode', { member: id, mode: value })
async function evaluate(index: number, id: string, into: Evaluation[]) {
  const result = {
    ...evaluationSchema.parse(await instances[index]!.call('evaluate', id)),
    instance: index,
  }
  into.push(result)
  // Every authorization answers inside the 2 s request bound, granted or not.
  expect(result.elapsedMs).toBeLessThanOrEqual(2000)
  return result
}

beforeAll(async () => {
  await database.migrate()
  const [server] = await prisma.$queryRaw<{ version: number }[]>`
    SELECT current_setting('server_version_num')::integer AS version`
  expect(server?.version).toBeGreaterThanOrEqual(170000)
  remote = spawn('community-flag-remote.mjs')
  const ready = readySchema.parse(await remote.event('ready'))
  endpoint = `http://127.0.0.1:${ready.port}/flag`
  instances = [instance(), instance()]
  const pids = await Promise.all(
    instances.map(
      async (child) => readySchema.parse(await child.event('ready', 10_000)).pid
    )
  )
  collector = await usageCollector(spawn, database.url)
  await collector.track({ remote: ready.pid, instanceA: pids[0], instanceB: pids[1] })
  const clock = await dbClockSkew(prisma)
  skewMs = clock.skewMs
  clockBoundMs = clock.boundMs
  evidence.clock = { ...clock, postgres: server?.version }
  await collector.start()
}, 60_000)

afterAll(async () => {
  evidence.usage = await collector?.stop().catch(() => null)
  evidence.remoteCalls = await remote?.call('calls').catch(() => null)
  await writeEvidence('lane-a-cache-timeline', evidence)
  const outcomes = await Promise.allSettled(children.map((child) => child.close()))
  await prisma.$disconnect()
  await database.drop()
  expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([])
}, 60_000)

/**
 * One member's full cycle: cold success, cached reads to 45 s, a failed refresh at 45 s that
 * keeps the original 60 s expiry and the 45 s claim cadence, unavailability from 60 s, and
 * recovery at the next eligible claim.
 */
async function cacheCycle(id: string, offsetMs: number) {
  const records: Evaluation[] = []
  await delay(offsetMs)
  let tick = 0
  const next = () => evaluate(tick++ % 2, id, records)

  const cold = await next()
  expect(cold).toMatchObject({ outcome: 'granted', value: true })
  const first = await row(id)
  const origin = first.remote_evaluated_at!.getTime()
  expect(first.expires_at!.getTime()).toBe(origin + 60_000)
  expect(await calls(id)).toHaveLength(1)

  // Phase 1: cached until the 45 s refresh point, on both instances, without a remote call.
  while (dbNow() < origin + 43_500) {
    expect(await next()).toMatchObject({ outcome: 'granted', value: true })
    await delay(1000)
  }
  expect(await calls(id)).toHaveLength(1)

  // Phase 2: the refresh at 45 s fails. The grant holds to its original 60 s expiry.
  await mode(id, 'fail')
  const granted: Evaluation[] = []
  while (dbNow() < origin + 58_000) {
    granted.push(await next())
    await delay(1000)
  }
  expect(granted.every((record) => record.outcome === 'granted')).toBe(true)
  const afterFailure = await calls(id)
  expect(afterFailure).toHaveLength(2)
  const failedRefresh = afterFailure[1]!
  expect(failedRefresh.mode).toBe('fail')
  expect(failedRefresh.wall + skewMs).toBeGreaterThanOrEqual(origin + 45_000 - 50)
  expect(failedRefresh.wall + skewMs).toBeLessThan(origin + 47_000)
  const held = await row(id)
  expect(held.remote_evaluated_at!.getTime()).toBe(origin)
  expect(held.expires_at!.getTime()).toBe(origin + 60_000)
  expect(held.remote_value).toBe(true)
  expect(held.refresh_owner).toBeNull()
  const nextClaim = held.next_claim_at.getTime()
  // The failed claim keeps the cadence it was given: 45 s after the claim itself.
  expect(Math.abs(nextClaim - 45_000 - (failedRefresh.wall + skewMs))).toBeLessThan(1000)

  // The 60 s boundary itself, sampled every 200 ms on DB time. The clock bound covers the
  // local-to-DB estimate; a request that starts clearly before expiry is granted and one
  // that starts clearly after it is not.
  const margin = 100 + clockBoundMs
  const boundary: Evaluation[] = []
  while (dbNow() < origin + 61_000) {
    boundary.push(await next())
    await delay(200)
  }
  for (const record of boundary) {
    const start = record.wall + skewMs
    if (start < origin + 60_000 - margin) expect(record.outcome).toBe('granted')
    if (start >= origin + 60_000 + margin) expect(record.outcome).toBe('unavailable')
  }

  // Phase 3: from 60 s nothing is granted and nothing is asked until the next claim.
  const unavailable: Evaluation[] = []
  while (dbNow() < nextClaim - 4000) {
    const result = await next()
    unavailable.push(result)
    expect(result.outcome).toBe('unavailable')
    if (result.outcome === 'unavailable') {
      const expected = Math.ceil((nextClaim - (result.wall + skewMs)) / 1000)
      expect(Math.abs(result.retryAfterSeconds - expected)).toBeLessThanOrEqual(1)
    }
    await delay(1000)
  }
  expect(await calls(id)).toHaveLength(2)

  // Phase 4: the provider recovers before the next eligible claim; access returns at it.
  await mode(id, 'true')
  let recovered: Evaluation | undefined
  while (dbNow() < nextClaim + 5000) {
    const result = await next()
    if (result.outcome === 'granted') {
      recovered = result
      break
    }
    await delay(500)
  }
  expect(recovered).toMatchObject({ outcome: 'granted', value: true })
  const final = await calls(id)
  expect(final).toHaveLength(3)
  expect(final[2]!.wall + skewMs).toBeGreaterThanOrEqual(nextClaim - 50)

  const grantedBoundary = records.filter(
    (record) => record.outcome === 'granted' && record.wall + skewMs < origin + 60_000
  )
  const firstUnavailable = records.find((record) => record.outcome === 'unavailable')!
  // No grant ever starts at or after the original expiry until the recovery claim.
  expect(
    records.filter(
      (record) =>
        record.outcome === 'granted' &&
        record.wall + skewMs >= origin + 60_000 &&
        record !== recovered
    )
  ).toEqual([])
  return {
    member: id,
    origin,
    expiresAt: origin + 60_000,
    failedRefreshAtMs: failedRefresh.wall + skewMs - origin,
    nextClaimAtMs: nextClaim - origin,
    lastGrantBeforeExpiryMs: Math.max(
      ...grantedBoundary.map((r) => r.wall + skewMs - origin)
    ),
    unavailableOnsetMs: firstUnavailable.wall + skewMs - origin,
    recoveredAtMs: recovered!.wall + skewMs - origin,
    unavailableIntervalMs: recovered!.wall - firstUnavailable.wall,
    maxElapsedMs: Math.max(...records.map((record) => record.elapsedMs)),
    remoteCalls: final.map((call) => ({
      mode: call.mode,
      atMs: call.wall + skewMs - origin,
      durationMs: call.endedAt === null ? null : call.endedAt - call.at,
    })),
    evaluations: records.map((record) => ({
      ...record,
      atMs: record.wall + skewMs - origin,
    })),
  }
}

/** A remote answer that cannot arrive inside the 1 s deadline is never stored. */
async function deadlineCase(remoteMode: 'late' | 'hang') {
  const id = await member()
  await mode(id, remoteMode)
  const records: Evaluation[] = []
  const result = await evaluate(0, id, records)
  expect(result.outcome).toBe('unavailable')
  const [call] = await calls(id)
  await until(
    async () => (await calls(id))[0]?.endedAt ?? null,
    (ended) => ended !== null,
    3000
  )
  const [ended] = await calls(id)
  expect(ended!.outcome).toBe('aborted')
  // The invocation deadline is 1 s from the call; the abort reaches the network by then.
  expect(ended!.endedAt! - call!.at).toBeLessThan(1150)
  // Past the late answer and past the 2 s claim lease, nothing was stored or left owned.
  await delay(2500)
  const stored = await row(id)
  expect(stored.remote_value).toBeNull()
  expect(stored.expires_at).toBeNull()
  expect(stored.refresh_owner).toBeNull()
  const second = await evaluate(1, id, records)
  expect(second.outcome).toBe('unavailable')
  expect(await calls(id)).toHaveLength(1)
  return { mode: remoteMode, records, callDurationMs: ended!.endedAt! - call!.at }
}

async function falseCase() {
  const id = await member()
  await mode(id, 'false')
  const records: Evaluation[] = []
  expect(await evaluate(0, id, records)).toMatchObject({
    outcome: 'granted',
    value: false,
  })
  expect((await row(id)).remote_value).toBe(false)
  expect(await evaluate(1, id, records)).toMatchObject({
    outcome: 'granted',
    value: false,
  })
  expect(await calls(id)).toHaveLength(1)
  return { records }
}

/** An owner killed mid-claim leaves no value; its lease lapses and the next claim recovers. */
async function abandonedCase() {
  const id = await member()
  await mode(id, 'hang')
  const doomed = instance()
  const { pid } = readySchema.parse(await doomed.event('ready', 10_000))
  const pending = doomed.call('evaluate', id).catch((error: unknown) => String(error))
  await until(
    () => calls(id),
    (list) => list.length === 1,
    5000
  )
  const claimed = await row(id)
  expect(claimed.refresh_owner).not.toBeNull()
  doomed.signal('SIGKILL')
  expect(await pending).toMatch(/exited/)
  await until(
    async () => (await calls(id))[0]?.outcome ?? null,
    (outcome) => outcome === 'aborted'
  )
  await waitUntilDb(claimed.refresh_until!.getTime() + 250)
  const lapsed = await row(id)
  expect(lapsed.remote_value).toBeNull()
  expect(lapsed.expires_at).toBeNull()
  const records: Evaluation[] = []
  const blocked = await evaluate(0, id, records)
  expect(blocked.outcome).toBe('unavailable')
  expect(await calls(id)).toHaveLength(1)
  await mode(id, 'true')
  await waitUntilDb(lapsed.next_claim_at.getTime() + 100)
  expect(await evaluate(1, id, records)).toMatchObject({
    outcome: 'granted',
    value: true,
  })
  expect(await calls(id)).toHaveLength(2)
  return { killedPid: pid, records, nextClaimAt: lapsed.next_claim_at.getTime() }
}

it('holds a cached grant to its original 60 s expiry across a failed 45 s refresh and recovers at the next claim', async () => {
  const members = await Promise.all([member(), member(), member()])
  const [cycles, late, hang, falsy, abandoned] = await Promise.all([
    Promise.all(members.map((id, index) => cacheCycle(id, index * 333))),
    deadlineCase('late'),
    deadlineCase('hang'),
    falseCase(),
    abandonedCase(),
  ])
  evidence.cycles = cycles
  evidence.races = { late, hang, false: falsy, abandoned }
  for (const cycle of cycles) {
    expect(cycle.unavailableOnsetMs).toBeGreaterThanOrEqual(60_000)
    expect(cycle.lastGrantBeforeExpiryMs).toBeLessThan(60_000)
    expect(cycle.maxElapsedMs).toBeLessThanOrEqual(2000)
  }
}, 240_000)

import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { Prisma, PrismaClient } from '@prisma/client'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { postgresError } from '../src/prisma/postgres-error.js'
import {
  AppendBudgetExceeded,
  appendFailure,
  CommunityStreamRepository,
  type AppendReport,
} from '../src/modules/community/community-stream.repository.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
// An append is bounded by its own timeouts: 100 ms maxWait and the 750 ms transaction,
// then on failure the 50 ms maxWait and 150 ms telemetry transaction, 1.05 s. The slowest
// append measured 2026-10-27 took 0.53 s idle and 1.21 s across ten runs at load average
// 34 to 87 on 14 cores. 3 s is 2.5x that, so an append that never settles fails in
// seconds, naming its test and attempt, where R01 alone would otherwise wait 90 s.
const APPEND_DEADLINE_MS = 3_000
class AppendDeadlineExceeded extends Error {
  override name = 'AppendDeadlineExceeded'
}
let slowestAppend = { label: '', ms: 0 }
/** Every append in this file settles within the deadline or fails naming its attempt. */
function bounded(repository: CommunityStreamRepository) {
  const test = expect.getState().currentTestName ?? 'unnamed test'
  let attempt = 0
  // The appender logs every deferral; its durable retry row is written in a 150 ms
  // best-effort transaction that a loaded host drops (0 rows for 1 failure at load
  // average 108), so the log is the observation that holds at any load.
  type Deferral = { reason: string; nextBatchLimit: number }
  type Warn = (fields: Deferral, message: string) => void
  const deferrals: Deferral[] = []
  const logger = Reflect.get(repository, 'logger') as { warn: Warn }
  const warn = logger.warn.bind(logger) as Warn
  logger.warn = (fields, message) => {
    if (message === 'Community append deferred') deferrals.push({ ...fields })
    warn(fields, message)
  }
  async function settle(): Promise<PromiseSettledResult<AppendReport>> {
    const label = `${test}: append attempt ${++attempt}`
    const started = performance.now()
    // The deadline aborts the append it gives up on, so it cannot write afterwards.
    const abort = new AbortController()
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        repository.appendWithReport(abort.signal).then(
          (value) => ({ status: 'fulfilled', value }) as const,
          (reason: unknown) => ({ status: 'rejected', reason }) as const
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = new AppendDeadlineExceeded(
              `${label} did not settle within ${APPEND_DEADLINE_MS} ms`
            )
            abort.abort(error)
            reject(error)
          }, APPEND_DEADLINE_MS)
        }),
      ])
    } finally {
      clearTimeout(timer)
      const ms = Math.round(performance.now() - started)
      if (ms > slowestAppend.ms) slowestAppend = { label, ms }
    }
  }
  // The product's append loop retries a budget deferral. Twelve in a row halve any
  // limit to one and keep failing there, so the twelfth is thrown.
  async function retrying(): Promise<AppendReport> {
    for (let deferred = 1; ; deferred++) {
      const outcome = await settle()
      if (outcome.status === 'fulfilled') return outcome.value
      if (appendFailure(outcome.reason) !== 'budget_pressure' || deferred >= 12)
        throw outcome.reason
    }
  }
  return {
    repository,
    deferrals,
    settle,
    async append() {
      return (await retrying()).count
    },
    /** A burst can take more than one batch on a loaded host, so drain it. */
    async drain() {
      let appended = 0
      while (await backlog()) appended += (await retrying()).count
      return appended
    },
  }
}
const backlog = () => prisma.communityDomainOutbox.count({ where: { appended_at: null } })
// One appender per test: its adaptive batch limit is per-instance state, and a test that
// drove it into budget pressure must not shrink the next test's batches.
let stream: ReturnType<typeof bounded>
const clients: Client[] = []
async function connection() {
  const client = new Client({ connectionString: database.url })
  await client.connect()
  clients.push(client)
  return client
}
function candidatePreparationLatency(
  delayMs: number,
  onCandidate?: () => void
): PrismaClient {
  if (!delayMs && !onCandidate) return prisma
  return new Proxy(prisma, {
    get(target, key, receiver) {
      if (key === '$transaction')
        return (
          work: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options?: {
            timeout?: number
            maxWait?: number
            isolationLevel?: Prisma.TransactionIsolationLevel
          }
        ) =>
          target.$transaction(
            (tx) =>
              work(
                new Proxy(tx, {
                  get(connection, property, connectionReceiver) {
                    if (property === '$executeRawUnsafe')
                      return async (query: string, ...values: unknown[]) => {
                        if (query === 'SAVEPOINT community_candidate') {
                          onCandidate?.()
                          if (delayMs)
                            await connection.$executeRaw`SELECT pg_sleep(${delayMs / 1000})`
                        }
                        return connection.$executeRawUnsafe(query, ...values)
                      }
                    return Reflect.get(
                      connection,
                      property,
                      connectionReceiver
                    ) as unknown
                  },
                })
              ),
            options
          )
      return Reflect.get(target, key, receiver) as unknown
    },
  })
}
async function fixture() {
  const user = await prisma.user.create({
    data: { email: `stream-${randomUUID()}@synthetic.test` },
  })
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({ userId: user.id, status: 'published' })
    ),
  })
  return { user, post }
}

beforeAll(async () => {
  await database.migrate()
  const [version] = await prisma.$queryRaw<
    { version: number }[]
  >`SELECT current_setting('server_version_num')::int AS version`
  expect(version!.version).toBeGreaterThanOrEqual(170000)
}, 30_000)
beforeEach(async () => {
  stream = bounded(new CommunityStreamRepository(prisma))
  await prisma.communityStreamEvent.deleteMany()
  await prisma.communityDomainOutbox.deleteMany()
})
afterAll(async () => {
  await Promise.all(
    clients.map(async (client) => {
      await client.query('ROLLBACK')
      await client.end()
    })
  )
  await prisma.$disconnect()
  await database.drop()
  console.info(JSON.stringify({ evidence: 'append-deadline', slowestAppend }))
  // Measured over 10 s at load average 95 (2026-10-27); same budget as setup.
}, 30_000)

describe('Story 6.5 committed stream append', () => {
  it('6.5-PERF-local: a burst of100 makes bounded append progress without timeout rollback', async () => {
    const user = await prisma.user.create({
      data: { email: `burst-${randomUUID()}@synthetic.test` },
    })
    await prisma.lookbookPost.createMany({
      data: Array.from({ length: 100 }, () =>
        buildLookbookPostCreateInput(
          createLookbookPost({ userId: user.id, status: 'published' })
        )
      ),
    })
    // The appender stops preparing at its 150 ms window and gives up at its 400 ms
    // completion budget so that it never reaches the server's 450 ms statement and
    // 500 ms transaction timeouts. A loaded host can exhaust that budget, which the
    // append loop retries; a server timeout rollback is what this burst must never hit.
    const started = performance.now()
    const batches: { count: number; elapsedMs: number }[] = []
    let guarded = 0
    while (await backlog()) {
      const before = performance.now()
      const outcome = await stream.settle()
      if (outcome.status === 'rejected') {
        if (!(outcome.reason instanceof AppendBudgetExceeded)) throw outcome.reason
        expect(++guarded, 'completion budget deferrals in a row').toBeLessThan(12)
        continue
      }
      guarded = 0
      batches.push({ count: outcome.value.count, elapsedMs: performance.now() - before })
      expect(outcome.value.count).toBeGreaterThan(0)
    }
    expect(await prisma.communityStreamEvent.count()).toBe(100)
    console.info(
      JSON.stringify({
        evidence: '6.5-PERF-local-append100',
        elapsedMs: performance.now() - started,
        deferrals: stream.deferrals.length,
        batches,
      })
    )
    // The appender sizes each batch from real elapsed time, so a loaded host takes more,
    // smaller batches; progress per append is the invariant. Measured 0.5 s idle, 3.2 to
    // 8.4 s at load average 70 to 196 on 14 cores (2026-10-28) and 16.1 s at 204; 60 s
    // is 3.7x the slowest, and the per-append deadline names a hang long before it.
  }, 60_000)
  it('R01 adapts after slow append writes and exposes every aborted batch', async () => {
    const priorTelemetry = await prisma.communityEngagementTelemetry.findMany({
      select: { id: true },
    })
    const { user } = await fixture()
    await prisma.lookbookPost.createMany({
      data: Array.from({ length: 39 }, () =>
        buildLookbookPostCreateInput(
          createLookbookPost({ userId: user.id, status: 'published' })
        )
      ),
    })
    // The first stream-event insert sleeps past the append's 450 ms statement
    // timeout, so the first append overruns whatever batch it prepared. Sizing
    // the overrun from 20 ms per row alone depended on the 150 ms preparation
    // window filling about 23 rows; a loaded CI runner prepared fewer, every
    // batch fit, and no append failed (Story 1.2b R30). A sequence counts the
    // inserts because it survives the aborted transaction; every later insert
    // keeps the 20 ms cost the adaptation is measured against.
    await prisma.$executeRawUnsafe('CREATE SEQUENCE story65_slow_event_inserts')
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION story65_slow_event_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('story65_slow_event_inserts') = 1 THEN PERFORM pg_sleep(0.6); ELSE PERFORM pg_sleep(0.02); END IF; RETURN NEW; END $$"
    )
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER story65_slow_event BEFORE INSERT ON "CommunityStreamEvent" FOR EACH ROW EXECUTE FUNCTION story65_slow_event_write()'
    )
    let failures = 0
    // Worst case that still recovers: a failure halves the ready limit (25, 12, 6, 3, 1)
    // and a success at limit 1 commits one row and raises it to 3. If every append
    // above one row fails, the 40 rows take 4 halvings, 40 one-row successes and 39
    // failures between them: 83 attempts. The old bound of 12 covered only an idle
    // host, where the first insert's 0.6 s overrun is the one failure. An appender
    // that never recovers stops at the 83rd attempt and fails the drained check below,
    // inside the test timeout set at the end of this case.
    let attempts = 0
    try {
      while (
        attempts < 83 &&
        (await prisma.communityDomainOutbox.count({ where: { appended_at: null } }))
      ) {
        attempts++
        if ((await stream.settle()).status === 'rejected') failures++
      }
      expect(
        await prisma.communityDomainOutbox.count({ where: { appended_at: null } }),
        `rows left after ${attempts} appends, ${failures} failed (bound 83)`
      ).toBe(0)
      expect(await prisma.communityStreamEvent.count()).toBe(40)
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER story65_slow_event ON "CommunityStreamEvent"'
      )
      await prisma.$executeRawUnsafe('DROP FUNCTION story65_slow_event_write()')
      await prisma.$executeRawUnsafe('DROP SEQUENCE story65_slow_event_inserts')
    }
    expect(failures).toBeGreaterThan(0)
    expect(stream.deferrals).toHaveLength(failures)
    // Durable retry rows are best effort, but each one written mirrors a deferral.
    const retryRows = await prisma.communityEngagementTelemetry.findMany({
      where: {
        id: { notIn: priorTelemetry.map((row) => row.id) },
        event_type: 'community_append_retry',
      },
      select: { reason: true, backlog_count: true },
    })
    expect(
      stream.deferrals.map(({ reason, nextBatchLimit }) => ({
        reason,
        backlog_count: nextBatchLimit,
      }))
    ).toEqual(expect.arrayContaining(retryRows))
    // The first failure is the 0.6 s overrun at the full limit of 25, so it reports the
    // halved limit. The preparation window alone also shrinks batches on a slow host,
    // which is why only this deferral proves the halving.
    expect(stream.deferrals[0]).toEqual({ reason: 'budget_pressure', nextBatchLimit: 12 })
    await prisma.lookbookPost.createMany({
      data: Array.from({ length: 250 }, () =>
        buildLookbookPostCreateInput(
          createLookbookPost({ userId: user.id, status: 'published' })
        )
      ),
    })
    // Host load alone can push an append past its completion budget (one in about 100
    // appends at load average 102), and the append loop retries that deferral. Each one
    // halves the limit, and 12 committed batches raise any limit back to 25 (1 + 2 x 12),
    // so this phase tops the backlog up until 12 batches have committed since the last
    // deferral. More than 12 deferrals here means the appender is not recovering.
    const recovered: number[] = []
    let deferrals = 0
    const retryDeferral = (reason: unknown) => {
      if (appendFailure(reason) !== 'budget_pressure') throw reason
      expect(++deferrals, 'budget deferrals while recovering').toBeLessThanOrEqual(12)
    }
    for (let committed = 0; committed < 12 || (await backlog()); ) {
      if (!(await backlog()))
        await prisma.lookbookPost.createMany({
          data: Array.from({ length: 25 }, () =>
            buildLookbookPostCreateInput(
              createLookbookPost({ userId: user.id, status: 'published' })
            )
          ),
        })
      const outcome = await stream.settle()
      if (outcome.status === 'fulfilled') {
        recovered.push(outcome.value.count)
        if (outcome.value.count) committed++
      } else {
        retryDeferral(outcome.reason)
        committed = 0
      }
    }
    await prisma.lookbookPost.createMany({
      data: Array.from({ length: 25 }, () =>
        buildLookbookPostCreateInput(
          createLookbookPost({ userId: user.id, status: 'published' })
        )
      ),
    })
    // A busy preparation window may select fewer rows than the recovered ceiling.
    // Observe the actual appender's capacity under a NOWAIT collision.
    const held = await connection()
    await held.query('BEGIN')
    await held.query('SELECT id FROM "CommunityStreamHead" WHERE id=$1 FOR UPDATE', [
      'public',
    ])
    try {
      expect((await stream.settle()).status).toBe('rejected')
      expect(stream.deferrals.at(-1)).toEqual({
        reason: 'head_contention',
        nextBatchLimit: 25,
      })
    } finally {
      await held.query('ROLLBACK')
    }
    let restored = 0
    while (await backlog()) {
      const outcome = await stream.settle()
      if (outcome.status === 'fulfilled') restored += outcome.value.count
      else retryDeferral(outcome.reason)
    }
    expect(restored).toBe(25)
    console.info(
      JSON.stringify({
        evidence: 'A03-budget-pressure-recovery',
        failures,
        recovered,
        deferrals,
        restoredBatch: 25,
      })
    )
    // Timeout from the recovering worst case above. A failed append costs at most its
    // 150 ms preparation window, the 450 ms statement timeout and the 150 ms telemetry
    // transaction, 0.75 s; a success took at most 0.46 s at load average 15. 43
    // failures and 40 successes are 51 s, and the rest of this case took 7.7 s loaded,
    // so about 59 s. 90 s is 1.5x that, and an appender that never recovers (83
    // failures, about 62 s) reaches the attempt bound first.
  }, 90_000)

  // The 150 ms preparation window closes once a batch has spent it, so with at least
  // 20 ms of real latency per candidate no batch can exceed eight (eight candidates are
  // already 160 ms). Without injected latency a batch holds at most the 25-event ready
  // limit. How many batches a burst takes follows the host's load, so the bound is per
  // batch: the per-batch maximum holds at any load. Efficiency is checked by why each
  // batch stopped, which the appender reports: timing a whole append includes its
  // commit, and a two-row appender at 20 ms ran 14 of 49 batches past 150 ms under load.
  // Batch sizes are load-shaped: without latency the largest fell from 25 idle to 5 at
  // load average 102 on 14 cores (2026-10-27), so no size is an efficiency bound.
  it.each([
    [0, 25],
    [20, 8],
  ])(
    'A03 routine head contention preserves capacity and commits 100 contiguous events with %ims real candidate latency',
    async (delayMs, maxBatch) => {
      const { post, user } = await fixture()
      const priorTelemetry = await prisma.communityEngagementTelemetry.findMany({
        select: { id: true },
      })
      const appender = bounded(
        new CommunityStreamRepository(candidatePreparationLatency(delayMs))
      )
      const held = await connection()
      await held.query('BEGIN')
      await held.query('SELECT id FROM "CommunityStreamHead" WHERE id=$1 FOR UPDATE', [
        'public',
      ])
      try {
        for (let attempt = 0; attempt < 5; attempt++)
          expect((await appender.settle()).status).toBe('rejected')
      } finally {
        await held.query('ROLLBACK')
      }
      const retries = await prisma.communityEngagementTelemetry.findMany({
        where: {
          id: { notIn: priorTelemetry.map((row) => row.id) },
          event_type: 'community_append_retry',
        },
        select: { reason: true, backlog_count: true },
      })
      expect(retries).toHaveLength(5)
      expect(retries).toEqual(
        Array.from({ length: 5 }, () => ({
          reason: 'head_contention',
          backlog_count: 25,
        }))
      )
      await prisma.lookbookPost.createMany({
        data: Array.from({ length: 99 }, () =>
          buildLookbookPostCreateInput(
            createLookbookPost({ userId: user.id, status: 'published' })
          )
        ),
      })
      const start = performance.now()
      const steps: (AppendReport | 'budget_pressure')[] = []
      try {
        while (await backlog()) {
          const outcome = await appender.settle()
          if (outcome.status === 'fulfilled') steps.push(outcome.value)
          else if (appendFailure(outcome.reason) === 'budget_pressure') {
            steps.push('budget_pressure')
            expect(
              steps.filter((step) => step === 'budget_pressure').length,
              'budget deferrals in the burst'
            ).toBeLessThanOrEqual(12)
          } else throw outcome.reason
        }
        const reports = steps.filter((step) => step !== 'budget_pressure')
        const batches = reports.map((report) => report.count)
        expect(Math.min(...batches)).toBeGreaterThanOrEqual(1)
        expect(Math.max(...batches)).toBeLessThanOrEqual(maxBatch)
        // Contention left the limit at 25. After it, every committed batch raises the
        // limit by two up to 25 and every budget deferral halves it.
        const limits: number[] = []
        steps.reduce((limit, step) => {
          if (step === 'budget_pressure') return Math.max(1, Math.floor(limit / 2))
          limits.push(limit)
          return step.count ? Math.min(25, limit + 2) : limit
        }, 25)
        expect(reports.map((report) => report.limit)).toEqual(limits)
        // A batch ends only when its preparation window closes or its ready limit
        // fills; only the batch that drains the backlog may end for running out.
        expect(
          reports
            .slice(0, -1)
            .flatMap((report, index) =>
              (report.stop === 'window' && report.preparedMs >= 150) ||
              (report.stop === 'limit' && report.ready === report.limit)
                ? []
                : [{ batch: index + 1, ...report }]
            ),
          'batches that ended before their window closed or their limit filled'
        ).toEqual([])
        const events = await prisma.communityStreamEvent.findMany({
          where: { stream_id: 'public' },
          select: { source_outbox_id: true, sequence: true, post_id: true },
          orderBy: { sequence: 'asc' },
        })
        expect(events).toHaveLength(100)
        expect(new Set(events.map((event) => event.source_outbox_id)).size).toBe(100)
        expect(
          events.every(
            (event, index) => event.sequence === events[0]!.sequence + BigInt(index)
          )
        ).toBe(true)
        expect(events.filter((event) => event.post_id === post.id)).toHaveLength(1)
        expect(
          await prisma.communityStreamEvent.count({ where: { post_id: post.id } })
        ).toBe(1)
      } finally {
        const telemetry = await prisma.communityEngagementTelemetry.findMany({
          where: {
            event_type: { in: ['community_append_retry', 'community_append_contention'] },
          },
          select: { reason: true, elapsed_ms: true, backlog_count: true },
          take: 100,
          orderBy: { created_at: 'desc' },
        })
        console.info(
          JSON.stringify({
            evidence: 'A03-contention-burst',
            elapsedMs: Math.round(performance.now() - start),
            steps: steps.map((step) =>
              step === 'budget_pressure'
                ? step
                : `${step.count}/${step.limit} ${step.stop} ${Math.round(step.preparedMs)}ms`
            ),
            telemetry,
          })
        )
      }
    },
    // 100 candidates at 20 ms is 2 s of injected latency alone. Measured 6.0 to 8.5 s
    // at load average 70 to 196 on 14 cores (2026-10-28); one run at load 204 passed the
    // old 20 s cap. 60 s is 3x that, and the per-append deadline names a hang sooner.
    60_000
  )
  it('6.5-INT-001: reverse source commit order and aborted source cannot leave a skipped cursor', async () => {
    const a = await fixture()
    const b = await fixture()
    await stream.drain()
    const before = await prisma.communityStreamHead.findUniqueOrThrow({
      where: { id: 'public' },
    })
    const writer = await connection()
    await writer.query('BEGIN')
    await writer.query('UPDATE "LookbookPost" SET status = \'withdrawn\' WHERE id = $1', [
      a.post.id,
    ])
    await prisma.lookbookPost.update({
      where: { id: b.post.id },
      data: { status: 'withdrawn' },
    })
    expect(await stream.append()).toBe(1)
    const mid = await prisma.communityStreamHead.findUniqueOrThrow({
      where: { id: 'public' },
    })
    expect(mid.sequence).toBe(before.sequence + 1n)
    await writer.query('COMMIT')
    expect(await stream.append()).toBe(1)
    const after = await prisma.communityStreamHead.findUniqueOrThrow({
      where: { id: 'public' },
    })
    expect(after.sequence).toBe(mid.sequence + 1n)
    expect(await stream.append()).toBe(0)
    await writer.query('BEGIN')
    await writer.query('UPDATE "LookbookPost" SET status = \'published\' WHERE id = $1', [
      a.post.id,
    ])
    await writer.query('ROLLBACK')
    expect(await stream.append()).toBe(0)
  })

  it('6.5-INT-002: concurrent appenders allocate unique committed counters and roll back on busy head', async () => {
    await fixture()
    const locker = await connection()
    await locker.query('BEGIN')
    await locker.query(
      'SELECT id FROM "CommunityStreamHead" WHERE id = \'public\' FOR UPDATE'
    )
    expect((await stream.settle()).status).toBe('rejected')
    expect(
      await prisma.communityDomainOutbox.count({ where: { appended_at: null } })
    ).toBe(1)
    await locker.query('ROLLBACK')
    // Either concurrent appender may defer on the other's head lock or on a loaded
    // host's budget; a retry finishes the row. Two events would mean a double append.
    await Promise.all([stream.settle(), stream.settle()])
    await stream.drain()
    const events = await prisma.communityStreamEvent.findMany()
    expect(events).toHaveLength(1)
    expect(new Set(events.map((e) => e.source_outbox_id)).size).toBe(1)
  })

  it('6.5-INT-003: a busy oldest subject permits unrelated append and recovers after release', async () => {
    const a = await fixture()
    const b = await fixture()
    const locker = await connection()
    await locker.query('BEGIN')
    await locker.query('SELECT pg_advisory_xact_lock(65001,hashtext($1))', [a.user.id])
    expect(await stream.append()).toBe(1)
    expect((await prisma.communityStreamEvent.findMany())[0]!.post_id).toBe(b.post.id)
    await locker.query('ROLLBACK')
    expect(await stream.append()).toBe(1)
    expect(await prisma.communityStreamEvent.count()).toBe(2)
  })

  it('a SQL timeout in an append model operation defers the batch as budget pressure', async () => {
    const a = await fixture()
    await fixture()
    // A busy candidate makes the append record contention with a model create; the
    // trigger holds that insert past the 450 ms statement and 500 ms transaction
    // timeouts. Prisma raises either one from a model operation as an unknown request
    // error, which the append once reported as a dependency failure.
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION story65_slow_contention() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'community_append_contention' THEN PERFORM pg_sleep(1); END IF; RETURN NEW; END $$"
    )
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER story65_slow_contention BEFORE INSERT ON "CommunityEngagementTelemetry" FOR EACH ROW EXECUTE FUNCTION story65_slow_contention()'
    )
    const locker = await connection()
    await locker.query('BEGIN')
    await locker.query('SELECT pg_advisory_xact_lock(65001,hashtext($1))', [a.user.id])
    try {
      const outcome = await stream.settle()
      expect(outcome.status).toBe('rejected')
      const reason: unknown = outcome.status === 'rejected' ? outcome.reason : undefined
      expect(reason).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError)
      const code = postgresError(reason)?.code
      console.info(JSON.stringify({ evidence: 'append-model-timeout', code }))
      expect(['57014', '25P04']).toContain(code)
      expect(stream.deferrals).toEqual([
        { reason: 'budget_pressure', nextBatchLimit: 12 },
      ])
      expect(await prisma.communityStreamEvent.count()).toBe(0)
    } finally {
      await locker.query('ROLLBACK')
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER story65_slow_contention ON "CommunityEngagementTelemetry"'
      )
      await prisma.$executeRawUnsafe('DROP FUNCTION story65_slow_contention()')
    }
  })

  it('an aborted append rolls its batch back and writes nothing afterwards', async () => {
    await fixture()
    await fixture()
    await fixture()
    const priorTelemetry = await prisma.communityEngagementTelemetry.findMany({
      select: { id: true },
    })
    // Abort while the first candidate is prepared. It becomes ready all the same, so
    // without the abort this append would go on to write it, at any load.
    const abort = new AbortController()
    let candidates = 0
    const appender = new CommunityStreamRepository(
      candidatePreparationLatency(0, () => {
        if (++candidates === 1) abort.abort(new Error('append abandoned'))
      })
    )
    await expect(appender.appendWithReport(abort.signal)).rejects.toThrow(
      'append abandoned'
    )
    expect(candidates).toBe(1)
    expect(await backlog()).toBe(3)
    expect(await prisma.communityStreamEvent.count()).toBe(0)
    expect(
      await prisma.communityEngagementTelemetry.count({
        where: { id: { notIn: priorTelemetry.map((row) => row.id) } },
      })
    ).toBe(0)
    // The same appender with a live signal still appends all three; a loaded host's
    // window can split them across batches.
    let appended = 0
    while (await backlog())
      appended += (await appender.appendWithReport(new AbortController().signal)).count
    expect(appended).toBe(3)
  })

  it('6.5-INT-004: savepoint rollback releases only candidate guards and row locks', async () => {
    const { user, post } = await fixture()
    const candidate = await prisma.communityDomainOutbox.findFirstOrThrow({
      where: { post_id: post.id },
    })
    const owner = await connection()
    const contender = await connection()
    await owner.query('BEGIN')
    const pid = Number(
      (await owner.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid
    )
    await owner.query("SELECT pg_advisory_xact_lock_shared(65001,hashtext('retained'))")
    await owner.query('SAVEPOINT candidate')
    await owner.query('SELECT pg_advisory_xact_lock_shared(65001,hashtext($1))', [
      user.id,
    ])
    await owner.query('SELECT id FROM "CommunityDomainOutbox" WHERE id = $1 FOR UPDATE', [
      candidate.id,
    ])
    const locks = async () =>
      (
        await contender.query<{ key: string }>(
          `SELECT objid::bigint::text AS key FROM pg_locks
      WHERE pid = $1 AND locktype = 'advisory' AND classid = 65001 AND objsubid = 2`,
          [pid]
        )
      ).rows
    expect(await locks()).toHaveLength(2)
    await owner.query('ROLLBACK TO SAVEPOINT candidate')
    expect(await locks()).toHaveLength(1)
    await contender.query('BEGIN')
    await contender.query('SELECT pg_advisory_xact_lock(65001,hashtext($1))', [user.id])
    expect(
      (
        await contender.query<{ key: string }>(
          'SELECT id FROM "CommunityDomainOutbox" WHERE id = $1 FOR UPDATE NOWAIT',
          [candidate.id]
        )
      ).rows
    ).toHaveLength(1)
    await contender.query('ROLLBACK')
    await owner.query('ROLLBACK')
  })

  it('6.5-INT-008: private status stays private; hidden source becomes identifier-free resync', async () => {
    const { user, post } = await fixture()
    await stream.drain()
    await prisma.communityStreamEvent.deleteMany()
    await prisma.communityComment.create({
      data: {
        post_id: post.id,
        user_id: user.id,
        body: 'Synthetic pending comment',
        locale: 'en-US',
        platform: 'web',
      },
    })
    expect(await stream.append()).toBe(1)
    const privateEvent = await prisma.communityStreamEvent.findFirstOrThrow()
    expect(privateEvent.kind).toBe('comment.status')
    expect(privateEvent.stream_id).not.toBe('public')
    await prisma.lookbookPost.update({
      where: { id: post.id },
      data: { status: 'withdrawn' },
    })
    await stream.drain()
    const removal = await prisma.communityStreamEvent.findFirstOrThrow({
      where: { stream_id: 'public' },
    })
    expect(removal).toMatchObject({
      kind: 'resync',
      post_id: null,
      comment_id: null,
      parent_id: null,
    })
  })

  it('6.5-INT-009: client database roles cannot read or write stream, preference or subject artifacts', async () => {
    const client = await connection()
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE authenticated')
    await expect(client.query('SELECT * FROM "CommunityDomainOutbox"')).rejects.toThrow(
      /permission denied/
    )
    await client.query('ROLLBACK')
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE anon')
    await expect(
      client.query('SELECT * FROM "CommunityNotificationPreference"')
    ).rejects.toThrow(/permission denied/)
    await client.query('ROLLBACK')
  })
})

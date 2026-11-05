// Learning path Step 52: Moderation SLA monitoring and escalation.
// Story 6.12 test owner: a retry, a restart, a second worker and a dead worker, on real Postgres.
// I-D-RETRY, -RESTART, -CONCURRENT, -SKIP-LOCKED, -LEASE, -CRASH-AFTER-POST, -NO-TX-OVER-POST,
// -FENCE, -DELIVERED-ONCE, -BULLMQ, -BACKLOG-SLOW. Latches and an injected clock, no real waits.
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Queue } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { queueConfigs } from '../src/config/queues.js'
import { createModerationOpsChannel } from '../src/modules/moderation/moderation-sla.channel.js'
import { createWorker, defaultWorkerOptions } from '../src/workers/base.worker.js'
import { createMaintenanceProcessor } from '../src/workers/maintenance.processor.js'
import { MODERATION_SLA_SWEEP_JOB_NAME } from '../src/workers/maintenance.scheduler.js'
import {
  SLA_HOUR_MS,
  SLA_MINUTE_MS,
  SLA_SECOND_MS,
  aroundRawQueries,
  moderationSlaTestContext,
  refuseWrites,
} from './helpers/moderation-sla-harness.js'

/** `createWorker` writes its `JobFailure` row through this client, so it has to be this file's. */
const workerPrisma = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../src/workers/prisma.js', () => ({
  getPrismaClient: () => workerPrisma.client,
  disconnectPrismaClient: () => Promise.resolve(),
}))

vi.setConfig({ testTimeout: 60_000 })

const NOW = new Date('2026-11-05T12:00:00.000Z')
const ctx = moderationSlaTestContext({ now: NOW })
const { prisma, clock, alerts, alertByKey, slaKey, seedCase, sweep, capture } = ctx
const inMs = (ms: number) => new Date(NOW.getTime() + ms)
const LEASE_MS = 60 * SLA_SECOND_MS
const repoRoot = path.resolve(__dirname, '../../..')

describe('I-D-RETRY: the same sweep twice', () => {
  it('writes one row per key and sends once', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const job = sweep()
    await job.run()
    await job.run()
    expect(await alerts()).toHaveLength(1)
    expect(capture().received).toHaveLength(1)
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.attempts).toBe(1)
  })
})

describe('I-D-RESTART: a new process over the same state', () => {
  it('writes and sends nothing new', async () => {
    await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    await sweep().run()
    const restarted = ctx.newClient()
    await sweep({ prisma: restarted }).run()
    expect(await alerts()).toHaveLength(1)
    expect(capture().received).toHaveLength(1)
  })
})

describe('I-D-CONCURRENT: two workers at once', () => {
  it('writes one row per key, and the receiver sees each id once', async () => {
    const seeds = await Promise.all(
      Array.from({ length: 20 }, () => seedCase({ dueAt: inMs(SLA_HOUR_MS) }))
    )
    const other = ctx.newClient()
    await Promise.all([sweep().run(), sweep({ prisma: other }).run()])
    const rows = await alerts()
    expect(rows).toHaveLength(seeds.length)
    const ids = capture().idsReceived()
    expect(ids).toHaveLength(seeds.length)
    expect(new Set(ids).size).toBe(seeds.length)
    expect(rows.every((row) => row.delivery === 'delivered' && row.attempts === 1)).toBe(
      true
    )
  })
})

describe('I-D-SKIP-LOCKED: a row another transaction holds', () => {
  it('does not wait on it, delivers the rest, and delivers it after release', async () => {
    const seeds = await Promise.all(
      [1, 2, 3].map(() => seedCase({ dueAt: inMs(SLA_HOUR_MS) }))
    )
    capture().respondWith(500)
    await sweep().run()
    capture().reset()
    clock.advance(SLA_MINUTE_MS)
    const held = (await alertByKey(slaKey(seeds[0]!, 'at_risk')))!

    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let locked!: () => void
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve
    })
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ModerationSlaAlert" WHERE id = ${held.id} FOR UPDATE`
        locked()
        await released
      },
      { timeout: 45_000, maxWait: 5_000 }
    )
    await isLocked
    try {
      // A waiting claim would hang here until the holder lets go, which is after this returns.
      const result = await sweep({ prisma: ctx.newClient() }).run()
      // A claim that waited on the lock would surface as an error here, whichever row sorts first.
      expect(result).toMatchObject({ delivered: 2, errors: 0 })
      const ids = capture().idsReceived()
      expect(ids).toHaveLength(2)
      expect(ids).not.toContain(held.id)
    } finally {
      release()
      await holder
    }
    await sweep().run()
    expect(capture().idsReceived()).toContain(held.id)
    expect((await alerts()).every((row) => row.delivery === 'delivered')).toBe(true)
  })
})

describe('I-D-LEASE: the 60-second claim', () => {
  async function claimedByAnother() {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    capture().respondWith(500)
    await sweep().run()
    capture().reset()
    const key = slaKey(seeded, 'at_risk')
    const row = (await alertByKey(key))!
    // What a worker leaves behind when it dies between its claim and its outcome write.
    const leaseUntil = inMs(LEASE_MS)
    await prisma.moderationSlaAlert.update({
      where: { id: row.id },
      data: { lease_until: leaseUntil, attempts: 2, next_attempt_at: NOW },
    })
    return { key, id: row.id, leaseUntil }
  }

  it('skips the row at the lease end exactly', async () => {
    const { leaseUntil } = await claimedByAnother()
    clock.at(leaseUntil)
    await sweep().run()
    expect(capture().received).toEqual([])
  })

  it('reclaims it 1 ms later and increments attempts at the claim', async () => {
    const { key, id, leaseUntil } = await claimedByAnother()
    clock.at(new Date(leaseUntil.getTime() + 1))
    let attemptsDuringSend: number | undefined
    capture().script((_request, response) => {
      void prisma.moderationSlaAlert.findUniqueOrThrow({ where: { id } }).then((row) => {
        attemptsDuringSend = row.attempts
        response.statusCode = 200
        response.end('{}')
      })
    })
    await sweep().run()
    expect(attemptsDuringSend).toBe(3)
    expect(capture().idsReceived()).toEqual([id])
    expect((await alertByKey(key))!.delivery).toBe('delivered')
  })
})

describe('U-S-CLOCK: one read for state, a fresh read for each lease (TEA-01)', () => {
  it('computes a later row lease from the clock at its claim', async () => {
    await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const leases: number[] = []
    const channel = {
      kind: 'webhook' as const,
      deliver: async (payload: { id: string }) => {
        const row = await prisma.moderationSlaAlert.findUniqueOrThrow({
          where: { id: payload.id },
        })
        leases.push(row.lease_until!.getTime() - clock.now().getTime())
        clock.advance(20 * SLA_SECOND_MS)
        return 'delivered' as const
      },
    }
    await sweep({ channel: channel as never }).run()
    expect(leases).toEqual([LEASE_MS, LEASE_MS])
    for (const row of await alerts()) {
      // State facts keep the single sweep read, however long delivery took.
      expect(row.detected_at.getTime()).toBe(NOW.getTime())
    }
  })
})

describe('I-D-CRASH-AFTER-POST: a worker dies with its POST in flight', () => {
  const children: ReturnType<typeof spawn>[] = []
  afterAll(() => {
    for (const child of children) child.kill('SIGKILL')
  })

  it('resends after the lease with the same id, and the row ends delivered', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    capture().hang()
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join(__dirname, 'support/moderation-sla-crash-worker.ts'),
        ctx.database.url,
        capture().url,
        NOW.toISOString(),
      ],
      // apps/api holds the tsconfig whose decorator settings tsx needs.
      { cwd: path.join(repoRoot, 'apps/api'), stdio: ['ignore', 'inherit', 'inherit'] }
    )
    children.push(child)
    const exited = new Promise<never>((_resolve, reject) => {
      child.once('exit', (code) =>
        reject(new Error(`crash worker exited early: ${code}`))
      )
    })
    await Promise.race([capture().waitForRequests(1), exited])
    exited.catch(() => undefined)
    const first = capture().received[0]!
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))

    const key = slaKey(seeded, 'at_risk')
    const abandoned = (await alertByKey(key))!
    expect(abandoned.delivery).toBe('pending')
    expect(abandoned.attempts).toBe(1)
    expect(abandoned.lease_until?.getTime()).toBe(inMs(LEASE_MS).getTime())

    capture().reset()
    clock.at(inMs(LEASE_MS))
    await sweep().run()
    expect(capture().received).toEqual([])

    clock.at(inMs(LEASE_MS + 1))
    await sweep().run()
    const second = capture().received[0]!
    expect(second.body.id).toBe(first.body.id)
    expect(second.headers['idempotency-key']).toBe(first.headers['idempotency-key'])
    expect(second.headers['idempotency-key']).toBe(abandoned.id)
    expect(second.raw).toBe(first.raw)
    const finished = (await alertByKey(key))!
    expect(finished).toMatchObject({ delivery: 'delivered', attempts: 2 })
    expect(finished.lease_until).toBeNull()
  })
})

describe('I-D-NO-TX-OVER-POST: no transaction spans the send (TEA-01)', () => {
  it('leaves the row free to lock while the receiver holds the POST', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    capture().hang()
    const running = sweep().run()
    await capture().waitForRequests(1)
    const row = (await alertByKey(slaKey(seeded, 'at_risk')))!
    // Throws 55P03 if the sweep still holds its claim lock.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ModerationSlaAlert" WHERE id = ${row.id} FOR UPDATE NOWAIT`
    })
    expect(row.lease_until).not.toBeNull()
    capture().releaseParked()
    await running
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.delivery).toBe('delivered')
  })
})

describe('I-D-FENCE: a stale claimant cannot overwrite an outcome (TEA-01)', () => {
  it('keeps delivered when the first worker reports a failure after a later worker delivered', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    let finishStale!: (code: 'http_5xx') => void
    let enteredStale!: () => void
    const stale = new Promise<void>((resolve) => {
      enteredStale = resolve
    })
    const staleChannel = {
      kind: 'webhook' as const,
      deliver: () =>
        new Promise<'http_5xx'>((resolve) => {
          finishStale = resolve
          enteredStale()
        }),
    }
    const first = sweep({ channel: staleChannel as never }).run()
    await stale

    clock.at(inMs(LEASE_MS + 1))
    await sweep({ prisma: ctx.newClient() }).run()
    expect((await alertByKey(key))!).toMatchObject({ delivery: 'delivered', attempts: 2 })

    finishStale('http_5xx')
    await first
    const row = (await alertByKey(key))!
    expect(row).toMatchObject({
      delivery: 'delivered',
      attempts: 2,
      last_error_code: null,
    })
    expect(await prisma.jobFailure.count()).toBe(0)
  })
})

describe('I-D-FENCE at the third attempt: a stale failure raises no alarm', () => {
  it('writes no JobFailure when the row was delivered by a later worker', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    capture().respondWith(500)
    await sweep().run()
    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    clock.advance(2 * SLA_MINUTE_MS)
    capture().reset()

    let finishStale!: (code: 'http_5xx') => void
    let enteredStale!: () => void
    const stale = new Promise<void>((resolve) => {
      enteredStale = resolve
    })
    const first = sweep({
      channel: {
        kind: 'webhook' as const,
        deliver: () =>
          new Promise<'http_5xx'>((resolve) => {
            finishStale = resolve
            enteredStale()
          }),
      } as never,
    }).run()
    await stale
    // A later claim that delivered and moved the fence, with no interruption of its own to report.
    const claimed = (await alertByKey(key))!
    await prisma.moderationSlaAlert.update({
      where: { id: claimed.id },
      data: {
        attempts: claimed.attempts + 1,
        delivery: 'delivered',
        delivered_at: NOW,
        lease_until: null,
        last_error_code: null,
      },
    })

    finishStale('http_5xx')
    await first
    expect((await alertByKey(key))!).toMatchObject({
      delivery: 'delivered',
      last_error_code: null,
      failure_escalated_at: null,
    })
    expect(await prisma.jobFailure.findMany()).toEqual([])
    expect(ctx.logs.named('moderation_sla_delivery_failed')).toEqual([])
  })
})

describe('I-D-DELIVERED-ONCE: a delivered alert stays sent', () => {
  it('sends nothing on three more sweeps, past any lease', async () => {
    await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    await sweep().run()
    for (const later of [LEASE_MS + 1, 2 * LEASE_MS, 3 * LEASE_MS]) {
      clock.at(inMs(later))
      await sweep().run()
    }
    expect(capture().received).toHaveLength(1)
  })
})

describe('I-D-BACKLOG-SLOW: a hanging channel and a second worker', () => {
  it('sends no alert twice, the budget ends the claim loop, and the monitor is stamped', async () => {
    await Promise.all(
      Array.from({ length: 30 }, () => seedCase({ dueAt: inMs(SLA_HOUR_MS) }))
    )
    const sent: string[] = []
    const slowChannel = {
      kind: 'webhook' as const,
      deliver: (payload: { id: string }) => {
        sent.push(payload.id)
        // Each failed send costs the 5 seconds D8 allows, on the injected clock.
        clock.advance(5 * SLA_SECOND_MS)
        return Promise.resolve('timeout' as const)
      },
    }
    await Promise.all([
      sweep({ channel: slowChannel as never }).run(),
      sweep({ channel: slowChannel as never, prisma: ctx.newClient() }).run(),
    ])
    expect(new Set(sent).size).toBe(sent.length)
    expect(sent.length).toBeLessThan(30)
    const untouched = (await alerts()).filter((row) => row.attempts === 0)
    expect(untouched.length).toBe(30 - sent.length)
    expect(untouched.every((row) => row.delivery === 'pending')).toBe(true)
    expect(
      await prisma.moderationSlaMonitor.findUnique({ where: { id: 'default' } })
    ).not.toBeNull()
  })
})

describe('U-S-BUDGET: the 45-second claim budget (TEA-01)', () => {
  it('stops claiming once 45 seconds have passed since the sweep began', async () => {
    await Promise.all(
      Array.from({ length: 12 }, () => seedCase({ dueAt: inMs(SLA_HOUR_MS) }))
    )
    const sent: string[] = []
    const channel = {
      kind: 'webhook' as const,
      deliver: (payload: { id: string }) => {
        sent.push(payload.id)
        clock.advance(5 * SLA_SECOND_MS)
        return Promise.resolve('delivered' as const)
      },
    }
    await sweep({ channel: channel as never }).run()
    // Elapsed 0, 5, ... 40 seconds claim. At exactly 45 the budget is spent.
    expect(sent).toHaveLength(9)
    expect((await alerts()).filter((row) => row.delivery === 'pending')).toHaveLength(3)
    expect(
      (await prisma.moderationSlaMonitor.findUnique({ where: { id: 'default' } }))
        ?.last_sweep_at
    ).toBeTruthy()
  })
})

describe('U-S-BUDGET: delivery has its own share of every run (CX-2)', () => {
  /** The real detection queries, each 23 seconds long, so detection alone takes 46 seconds. */
  const slowDetection = () =>
    aroundRawQueries(prisma, (_query, run) => {
      clock.advance(23 * SLA_SECOND_MS)
      return run()
    })

  it('sends in the same run when detection took longer than the budget', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const result = await sweep({ prisma: slowDetection() }).run()
    expect(result).toMatchObject({ recorded: 1, delivered: 1, errors: 0 })
    expect(capture().received).toHaveLength(1)
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.delivery).toBe('delivered')
  })

  it('never sends an at-risk alert whose deadline passed during the scan (R2-1)', async () => {
    // Due 30 seconds after the sweep's clock read, inside the 46 seconds detection takes.
    const seeded = await seedCase({ dueAt: inMs(30 * SLA_SECOND_MS) })
    const first = await sweep({ prisma: slowDetection() }).run()
    expect(first).toMatchObject({ recorded: 1, delivered: 0, superseded: 1, errors: 0 })
    expect(capture().received).toEqual([])
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.delivery).toBe('superseded')

    await sweep().run()
    expect(capture().received.map((request) => request.body.kind)).toEqual(['breached'])
    expect((await alertByKey(slaKey(seeded, 'breached')))!.delivery).toBe('delivered')
    // The state fact keeps the sweep's own clock read, however long the scan took.
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.detected_at.getTime()).toBe(
      NOW.getTime()
    )
  })

  it('supersedes a later row whose deadline passes while earlier rows send (R2-1)', async () => {
    await seedCase({ dueAt: inMs(10 * SLA_SECOND_MS) })
    await seedCase({ dueAt: inMs(5 * SLA_SECOND_MS) })
    const channel = {
      kind: 'webhook' as const,
      deliver: vi.fn(() => {
        clock.advance(20 * SLA_SECOND_MS)
        return Promise.resolve('delivered' as const)
      }),
    }
    const result = await sweep({ channel: channel as never }).run()
    expect(channel.deliver).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ delivered: 1, superseded: 1 })
    const rows = await alerts()
    expect(rows.map((row) => row.delivery).sort()).toEqual(['delivered', 'superseded'])
  })

  it('works through a backlog over repeated slow sweeps, a bounded batch at a time', async () => {
    await Promise.all(
      Array.from({ length: 12 }, () => seedCase({ dueAt: inMs(SLA_HOUR_MS) }))
    )
    const sent: string[] = []
    const channel = {
      kind: 'webhook' as const,
      deliver: (payload: { id: string }) => {
        sent.push(payload.id)
        clock.advance(5 * SLA_SECOND_MS)
        return Promise.resolve('delivered' as const)
      },
    }
    const perRun: number[] = []
    for (let run = 0; run < 2; run++) {
      const before = sent.length
      await sweep({ channel: channel as never, prisma: slowDetection() }).run()
      perRun.push(sent.length - before)
    }
    // Elapsed 0, 5, ... 40 seconds of delivery claim, and at exactly 45 the share is spent.
    expect(perRun).toEqual([9, 3])
    expect(new Set(sent).size).toBe(12)
    expect((await alerts()).every((row) => row.delivery === 'delivered')).toBe(true)
  })
})

describe('I-D-BULLMQ: the general bootstrap path on real Redis', () => {
  it('retries a failed claim through attempts, and writes the fixed text to JobFailure (CX-3)', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const queueName = `moderation-sla-${randomUUID().slice(0, 8)}`
    const production = queueConfigs.find((config) => config.name === 'maintenance')!
    workerPrisma.client = prisma
    const allow = await refuseWrites(prisma, {
      table: 'ModerationSlaAlert',
      event: 'UPDATE',
    })
    const sweepOnce = vi.fn(() => sweep().run())
    const processor = createMaintenanceProcessor({
      admin: {} as never,
      featureFlags: {} as never,
      guardian: {} as never,
      telemetry: {} as never,
      wardrobeRetention: {} as never,
      community: { sweepModerationSla: sweepOnce } as never,
      logger: ctx.logs.logger as never,
    })
    const queue = new Queue(queueName, production.options)
    const worker = createWorker(queueName, processor, defaultWorkerOptions(1))
    let allowed = false
    worker.on('failed', () => {
      if (!allowed) {
        allowed = true
        void allow()
      }
    })
    try {
      await worker.waitUntilReady()
      const done = new Promise<void>((resolve) => {
        worker.once('completed', () => resolve())
      })
      await queue.add(MODERATION_SLA_SWEEP_JOB_NAME, {})
      await done
      await vi.waitFor(async () => {
        expect(await prisma.jobFailure.count({ where: { queue_name: queueName } })).toBe(
          1
        )
      })
    } finally {
      await worker.close()
      await queue.obliterate({ force: true })
      await queue.close()
      if (!allowed) await allow()
    }
    expect(allowed).toBe(true)
    expect(sweepOnce).toHaveBeenCalledTimes(2)
    const [failure] = await prisma.jobFailure.findMany({
      where: { queue_name: queueName },
    })
    expect(failure!.error_message).toBe('moderation_sla_claim_failed')
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.delivery).toBe('delivered')
    expect(capture().received).toHaveLength(1)
  })

  it('retries an injected first failure through attempts, with one row per key', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const queueName = `moderation-sla-${randomUUID().slice(0, 8)}`
    const production = queueConfigs.find((config) => config.name === 'maintenance')!
    workerPrisma.client = prisma
    const broken = new PrismaClient({
      datasourceUrl: 'postgresql://x:CANARYSECRET@127.0.0.1:1/none',
    })
    const sweepOnce = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() =>
        sweep({
          prisma: broken,
          channel: createModerationOpsChannel({
            url: capture().tokenUrl('CANARYSECRET'),
          }),
        }).run()
      )
      .mockImplementation(() =>
        sweep({
          channel: createModerationOpsChannel({
            url: capture().tokenUrl('CANARYSECRET'),
          }),
        }).run()
      )
    const processor = createMaintenanceProcessor({
      admin: {} as never,
      featureFlags: {} as never,
      guardian: {} as never,
      telemetry: {} as never,
      wardrobeRetention: {} as never,
      community: { sweepModerationSla: sweepOnce } as never,
      logger: ctx.logs.logger as never,
    })
    // The production queue options and worker factory, so a queue that stopped retrying fails here.
    const queue = new Queue(queueName, production.options)
    const worker = createWorker(queueName, processor, defaultWorkerOptions(1))
    try {
      await worker.waitUntilReady()
      const done = new Promise<void>((resolve) => {
        worker.once('completed', () => resolve())
      })
      await queue.add(MODERATION_SLA_SWEEP_JOB_NAME, {})
      await done
      await vi.waitFor(async () => {
        expect(await prisma.jobFailure.count({ where: { queue_name: queueName } })).toBe(
          1
        )
      })
    } finally {
      await worker.close()
      await queue.obliterate({ force: true })
      await queue.close()
      await broken.$disconnect()
    }
    const [failure] = await prisma.jobFailure.findMany({
      where: { queue_name: queueName },
    })
    expect(failure!.attempts).toBe(1)
    for (const surface of [JSON.stringify(failure), ctx.logs.text()]) {
      expect(surface).not.toContain('CANARYSECRET')
      expect(surface).not.toContain(capture().url)
    }
    expect(sweepOnce).toHaveBeenCalledTimes(2)
    expect(await alerts()).toHaveLength(1)
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.delivery).toBe('delivered')
    expect(capture().received).toHaveLength(1)
  })
})

// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Queue } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import {
  WARDROBE_MAINTENANCE_ENV,
  WARDROBE_MAINTENANCE_TASKS,
  WardrobeMaintenanceLoop,
  acquireWardrobeMaintenanceLock,
  assertGeneralWorkerMayRunWardrobeMaintenance,
  lockedWardrobeRetention,
  removeWardrobeMaintenanceSchedulers,
  wardrobeMaintenanceEnabled,
  type MaintenanceLockRedis,
} from './wardrobe-maintenance'

/** One Redis shared by every copy under test: `SET key value PX ttl NX`, keys expire by hand. */
function sharedRedis() {
  const keys = new Map<string, { value: string; ttlMs: number }>()
  const calls: [string, string, number][] = []
  const set = vi.fn(
    (key: string, value: string, _mode: 'PX', ttlMs: number, _flag: 'NX') => {
      calls.push([key, value, ttlMs])
      if (keys.has(key)) return Promise.resolve(null)
      keys.set(key, { value, ttlMs })
      return Promise.resolve('OK' as const)
    }
  )
  const redis: MaintenanceLockRedis = { set }
  return { redis, set, keys, calls, expireAll: () => keys.clear() }
}

function timers() {
  const pending: { callback: () => void; ms: number; cleared: boolean }[] = []
  return {
    pending,
    setTimer: (callback: () => void, ms: number) => {
      const entry = { callback, ms, cleared: false }
      pending.push(entry)
      return Object.assign(entry as unknown as NodeJS.Timeout, { unref: () => undefined })
    },
    clearTimer: (timer: NodeJS.Timeout) => {
      ;(timer as unknown as { cleared: boolean }).cleared = true
    },
    live: () => pending.filter((entry) => !entry.cleared),
  }
}

const flush = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function retention() {
  return {
    purgeExpiredAndDeletedGarments: vi.fn().mockResolvedValue(undefined),
    drainDeletions: vi.fn().mockResolvedValue(3),
  }
}

function loopFor(
  redis: MaintenanceLockRedis,
  sweeps = retention(),
  clock = timers(),
  log = logger(),
  holder = 'copy-a'
) {
  const loop = new WardrobeMaintenanceLoop({
    retention: sweeps,
    redis,
    logger: log,
    holder,
    random: () => 0,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  return { loop, sweeps, clock, log }
}

describe('WARDROBE_MAINTENANCE_ENABLED', () => {
  it('is on only for the literal true', () => {
    expect(WARDROBE_MAINTENANCE_ENV).toBe('WARDROBE_MAINTENANCE_ENABLED')
    expect(wardrobeMaintenanceEnabled({ WARDROBE_MAINTENANCE_ENABLED: 'true' })).toBe(
      true
    )
    expect(wardrobeMaintenanceEnabled({ WARDROBE_MAINTENANCE_ENABLED: ' true ' })).toBe(
      true
    )
    for (const value of [undefined, '', 'false', '1', 'TRUE', 'yes']) {
      expect(wardrobeMaintenanceEnabled({ WARDROBE_MAINTENANCE_ENABLED: value })).toBe(
        false
      )
    }
  })

  it('refuses the general worker where the wardrobe worker owns wardrobe maintenance', () => {
    expect(() =>
      assertGeneralWorkerMayRunWardrobeMaintenance({
        WARDROBE_MAINTENANCE_ENABLED: 'true',
      })
    ).toThrow(/owner of the wardrobe retention purge and deletion drain/)
    expect(() => assertGeneralWorkerMayRunWardrobeMaintenance({})).not.toThrow()
    expect(() =>
      assertGeneralWorkerMayRunWardrobeMaintenance({
        WARDROBE_MAINTENANCE_ENABLED: 'false',
      })
    ).not.toThrow()
  })

  it('has the general bootstrap check it before it opens a queue', () => {
    const source = readFileSync(path.resolve(__dirname, 'bootstrap.ts'), 'utf8')
    const start = source.slice(source.indexOf('export async function startWorkers('))
    const guard = start.indexOf('assertGeneralWorkerMayRunWardrobeMaintenance()')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(start.indexOf('createQueues()'))
  })

  it('refuses one process and starts the other under distinct environments', () => {
    // The hosted service's environment and a general worker's, as two separate deployments.
    const hostedEnv = { WARDROBE_MAINTENANCE_ENABLED: 'true' }
    const generalEnv = {}
    expect(wardrobeMaintenanceEnabled(hostedEnv)).toBe(true)
    expect(wardrobeMaintenanceEnabled(generalEnv)).toBe(false)
    expect(() => assertGeneralWorkerMayRunWardrobeMaintenance(hostedEnv)).toThrow()
    expect(() => assertGeneralWorkerMayRunWardrobeMaintenance(generalEnv)).not.toThrow()
  })
})

describe('removeWardrobeMaintenanceSchedulers', () => {
  it('removes exactly the two wardrobe schedulers from the shared queue by id', async () => {
    const removeJobScheduler = vi.fn((_id: string) => Promise.resolve(true))
    await removeWardrobeMaintenanceSchedulers({ removeJobScheduler } as unknown as Queue)

    expect(removeJobScheduler.mock.calls.map((call) => call[0]).toSorted()).toEqual([
      'wardrobe-deletion-drain',
      'wardrobe-retention-purge',
    ])
  })
})

describe('acquireWardrobeMaintenanceLock', () => {
  it('sets wardrobe-maintenance:<task> with NX and the interval less a margin', async () => {
    const { redis, set, calls } = sharedRedis()

    expect(
      await acquireWardrobeMaintenanceLock(redis, 'wardrobe-retention-purge', 'a')
    ).toBe(true)
    expect(calls).toEqual([
      ['wardrobe-maintenance:wardrobe-retention-purge', 'a', 3_300_000],
    ])
    expect(set).toHaveBeenCalledWith(
      'wardrobe-maintenance:wardrobe-retention-purge',
      'a',
      'PX',
      3_300_000,
      'NX'
    )
    expect(
      await acquireWardrobeMaintenanceLock(redis, 'wardrobe-retention-purge', 'b')
    ).toBe(false)
  })

  it('locks each task for less than its interval, by more than the jitter', () => {
    for (const task of Object.values(WARDROBE_MAINTENANCE_TASKS)) {
      expect(task.lockMs).toBeLessThan(task.intervalMs)
      expect(task.intervalMs - task.lockMs).toBeGreaterThan(task.jitterMs)
    }
    expect(WARDROBE_MAINTENANCE_TASKS['wardrobe-retention-purge'].intervalMs).toBe(
      3_600_000
    )
    expect(WARDROBE_MAINTENANCE_TASKS['wardrobe-deletion-drain'].intervalMs).toBe(900_000)
  })
})

describe('WardrobeMaintenanceLoop', () => {
  it('schedules the purge hourly and the drain every 15 minutes, first shortly after start', () => {
    const { loop, clock } = loopFor(sharedRedis().redis)
    loop.start()

    expect(clock.live().map((timer) => timer.ms)).toEqual([60_000, 30_000])
  })

  it('does not schedule twice when started twice', () => {
    const { loop, clock } = loopFor(sharedRedis().redis)
    loop.start()
    loop.start()
    expect(clock.live()).toHaveLength(2)
  })

  it('runs a tick under the lock, logs its completion event and schedules the next', async () => {
    const shared = sharedRedis()
    const { loop, clock, sweeps, log } = loopFor(shared.redis)
    loop.start()

    clock.live()[1]?.callback()
    await flush()

    expect(sweeps.drainDeletions).toHaveBeenCalledOnce()
    expect(sweeps.purgeExpiredAndDeletedGarments).not.toHaveBeenCalled()
    expect(shared.calls).toEqual([
      ['wardrobe-maintenance:wardrobe-deletion-drain', 'copy-a', 840_000],
    ])
    expect(log.info).toHaveBeenCalledWith(
      { job: 'wardrobe-deletion-drain', result: 3 },
      'wardrobe_deletion_drain_completed'
    )
    expect(clock.live().map((timer) => timer.ms)).toContain(900_000)
  })

  it('runs the retention purge, which carries the handoff re-enqueue, on its own event', async () => {
    const { loop, clock, sweeps, log } = loopFor(sharedRedis().redis)
    loop.start()

    clock.live()[0]?.callback()
    await flush()

    expect(sweeps.purgeExpiredAndDeletedGarments).toHaveBeenCalledOnce()
    expect(sweeps.drainDeletions).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledWith(
      { job: 'wardrobe-retention-purge', result: undefined },
      'wardrobe_retention_purge_completed'
    )
    expect(clock.live().map((timer) => timer.ms)).toContain(3_600_000)
  })

  it('skips the tick when another copy holds the lock, and tries again next interval', async () => {
    const shared = sharedRedis()
    const first = loopFor(shared.redis, retention(), timers(), logger(), 'copy-a')
    const second = loopFor(shared.redis, retention(), timers(), logger(), 'copy-b')
    first.loop.start()
    second.loop.start()

    first.clock.live()[1]?.callback()
    await flush()
    second.clock.live()[1]?.callback()
    await flush()

    expect(first.sweeps.drainDeletions).toHaveBeenCalledOnce()
    expect(second.sweeps.drainDeletions).not.toHaveBeenCalled()
    expect(second.log.info).toHaveBeenCalledWith(
      { task: 'wardrobe-deletion-drain' },
      'wardrobe_maintenance_skipped_lock_held'
    )
    expect(second.clock.live().map((timer) => timer.ms)).toContain(900_000)

    // The lock expiring lets the second copy take the next tick.
    shared.expireAll()
    second.clock.live().at(-1)?.callback()
    await flush()
    expect(second.sweeps.drainDeletions).toHaveBeenCalledOnce()
  })

  it('keeps looping after a failed purge, logs its event, and still runs the drain', async () => {
    const sweeps = retention()
    const failure = new Error('database unavailable')
    sweeps.purgeExpiredAndDeletedGarments.mockRejectedValueOnce(failure)
    const { loop, clock, log } = loopFor(sharedRedis().redis, sweeps)
    loop.start()

    clock.live()[0]?.callback()
    clock.live()[1]?.callback()
    await flush()

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure, job: 'wardrobe-retention-purge' }),
      'wardrobe_retention_purge_failed'
    )
    expect(sweeps.drainDeletions).toHaveBeenCalledOnce()
    expect(clock.live().map((timer) => timer.ms)).toEqual(
      expect.arrayContaining([3_600_000, 900_000])
    )
  })

  it('logs a failed drain under its own event and keeps the loop', async () => {
    const sweeps = retention()
    const failure = new Error('storage unavailable')
    sweeps.drainDeletions.mockRejectedValueOnce(failure)
    const { loop, clock, log } = loopFor(sharedRedis().redis, sweeps)
    loop.start()

    clock.live()[1]?.callback()
    await flush()

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure, job: 'wardrobe-deletion-drain' }),
      'wardrobe_deletion_drain_failed'
    )
    expect(clock.live().map((timer) => timer.ms)).toContain(900_000)
  })

  it('skips a tick it cannot lock, rather than running it unguarded', async () => {
    const lockFailure = new Error('redis down')
    const redis: MaintenanceLockRedis = { set: vi.fn().mockRejectedValue(lockFailure) }
    const { loop, clock, sweeps, log } = loopFor(redis)
    loop.start()

    clock.live()[1]?.callback()
    await flush()

    expect(sweeps.drainDeletions).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: lockFailure, task: 'wardrobe-deletion-drain' }),
      'wardrobe_maintenance_lock_failed'
    )
    expect(clock.live().map((timer) => timer.ms)).toContain(900_000)
  })

  it('never runs two ticks at once', async () => {
    const sweeps = retention()
    let releasePurge: () => void = () => undefined
    sweeps.purgeExpiredAndDeletedGarments.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releasePurge = resolve
      })
    )
    const { loop, clock } = loopFor(sharedRedis().redis, sweeps)
    loop.start()

    clock.live()[0]?.callback()
    clock.live()[1]?.callback()
    await flush()
    expect(sweeps.purgeExpiredAndDeletedGarments).toHaveBeenCalledOnce()
    expect(sweeps.drainDeletions).not.toHaveBeenCalled()

    releasePurge()
    await flush()
    expect(sweeps.drainDeletions).toHaveBeenCalledOnce()
  })

  it('stops scheduling, clears its timers and waits for the tick in flight', async () => {
    const sweeps = retention()
    let releaseDrain: () => void = () => undefined
    sweeps.drainDeletions.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        releaseDrain = () => resolve(0)
      })
    )
    const { loop, clock } = loopFor(sharedRedis().redis, sweeps)
    loop.start()
    clock.live()[1]?.callback()
    await flush()

    let stopped = false
    const stopping = loop.stop().then(() => {
      stopped = true
    })
    await flush()
    expect(stopped).toBe(false)

    releaseDrain()
    await stopping
    expect(stopped).toBe(true)
    expect(clock.live()).toHaveLength(0)
  })

  it('keeps no BullMQ queue or scheduler: it only reads and writes its own Redis lock keys', () => {
    const source = readFileSync(
      path.resolve(__dirname, 'wardrobe-maintenance.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/upsertJobScheduler|new Worker\(|createWorker|new Queue\(/)
  })
})

describe('lockedWardrobeRetention (the general worker, in development)', () => {
  it('runs a sweep only when it takes the lock a hosted loop would take', async () => {
    const shared = sharedRedis()
    const sweeps = retention()
    const locked = lockedWardrobeRetention(sweeps, shared.redis, logger(), 'general')

    await locked.purgeExpiredAndDeletedGarments()
    expect(sweeps.purgeExpiredAndDeletedGarments).toHaveBeenCalledOnce()

    // A hosted worker's loop now finds the same lock held and skips.
    const hosted = loopFor(shared.redis, retention(), timers(), logger(), 'hosted')
    hosted.loop.start()
    hosted.clock.live()[0]?.callback()
    await flush()
    expect(hosted.sweeps.purgeExpiredAndDeletedGarments).not.toHaveBeenCalled()
  })

  it('skips the job, answering nothing done, while another copy holds the lock', async () => {
    const shared = sharedRedis()
    await acquireWardrobeMaintenanceLock(
      shared.redis,
      'wardrobe-deletion-drain',
      'hosted'
    )
    const sweeps = retention()
    const log = logger()
    const locked = lockedWardrobeRetention(sweeps, shared.redis, log, 'general')

    await expect(locked.drainDeletions()).resolves.toBe(0)
    expect(sweeps.drainDeletions).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledWith(
      { task: 'wardrobe-deletion-drain' },
      'wardrobe_maintenance_skipped_lock_held'
    )
  })
})

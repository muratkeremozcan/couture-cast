// Learning path Step 40: Community screening release gate and hosted worker.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-40-community-screening-release-gate-and-hosted-worker
// Story 6.2b review (RF15): the worker's presence heartbeat refreshes, expires
// on its TTL when refreshes stop, and is removed on a graceful shutdown.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Worker } from 'bullmq'
import {
  closeWithHeartbeat,
  COMMUNITY_WORKER_HEARTBEAT_INTERVAL_MS,
  COMMUNITY_WORKER_HEARTBEAT_LOG_EVENTS,
  COMMUNITY_WORKER_HEARTBEAT_PREFIX,
  COMMUNITY_WORKER_HEARTBEAT_STOP_TIMEOUT_MS,
  COMMUNITY_WORKER_HEARTBEAT_TTL_SECONDS,
  CommunityWorkerHeartbeat,
  communityWorkerHeartbeatKey,
  type HeartbeatLogger,
} from './community-worker-heartbeat.js'
import { COMMUNITY_SHUTDOWN_TIMEOUT_MS } from '../../workers/community.bootstrap.js'

/**
 * A Redis that honours `SET ... EX` against the (faked) clock, so a key that is
 * not refreshed is gone once its TTL passes. `mode` makes every command fail or
 * never answer, the way a dropped connection with an offline queue does.
 */
class TtlRedis {
  readonly entries = new Map<string, { value: string; expiresAt: number }>()
  readonly log: string[] = []
  mode: 'up' | 'failing' | 'hanging' = 'up'

  private answer<T>(command: string, apply: () => T): Promise<T> {
    if (this.mode === 'failing') {
      return Promise.reject(new Error('Connection is closed.'))
    }
    if (this.mode === 'hanging') return new Promise<T>(() => undefined)
    this.log.push(command)
    return Promise.resolve(apply())
  }

  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown> {
    expect(mode).toBe('EX')
    return this.answer(`set ${key}`, () => {
      this.entries.set(key, { value, expiresAt: Date.now() + seconds * 1000 })
      return 'OK'
    })
  }

  del(key: string): Promise<unknown> {
    return this.answer(`del ${key}`, () => (this.entries.delete(key) ? 1 : 0))
  }

  /** What GET would answer now. */
  live(key: string): string | null {
    const entry = this.entries.get(key)
    if (!entry || entry.expiresAt <= Date.now()) return null
    return entry.value
  }
}

function recordingLogger() {
  const lines: { level: string; event: unknown }[] = []
  const logger: HeartbeatLogger = {
    info: (details) =>
      lines.push({ level: 'info', event: (details as { event?: unknown }).event }),
    warn: (details) =>
      lines.push({ level: 'warn', event: (details as { event?: unknown }).event }),
  }
  return { lines, logger }
}

const name = 'community-worker@abc123'

function heartbeatOn(redis: TtlRedis, logger: HeartbeatLogger) {
  return new CommunityWorkerHeartbeat({
    redis: () => Promise.resolve(redis),
    workerName: name,
    commitSha: 'abc123',
    instanceId: 'instance-1',
    pid: 4242,
    now: () => new Date('2026-10-17T12:00:00.000Z'),
    logger,
  })
}

describe('community worker heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-17T12:00:00.000Z') })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keys each worker process by name and instance, valued with its build and start', async () => {
    const redis = new TtlRedis()
    const { logger, lines } = recordingLogger()
    const heartbeat = heartbeatOn(redis, logger)

    await expect(heartbeat.start()).resolves.toBe(true)

    expect(heartbeat.key).toBe(`${COMMUNITY_WORKER_HEARTBEAT_PREFIX}${name}:instance-1`)
    expect(heartbeat.key).toBe(communityWorkerHeartbeatKey(name, 'instance-1'))
    expect(JSON.parse(redis.live(heartbeat.key) ?? 'null')).toEqual({
      name,
      commitSha: 'abc123',
      startedAt: '2026-10-17T12:00:00.000Z',
      pid: 4242,
    })
    expect(lines).toEqual([
      { level: 'info', event: COMMUNITY_WORKER_HEARTBEAT_LOG_EVENTS.started },
    ])
    await heartbeat.stop()
  })

  it('gives two replicas of one image two keys', () => {
    const { logger } = recordingLogger()
    const options = {
      redis: () => Promise.resolve(new TtlRedis()),
      workerName: name,
      commitSha: 'abc123',
      logger,
    }
    const first = new CommunityWorkerHeartbeat(options)
    const second = new CommunityWorkerHeartbeat(options)
    expect(first.instanceId).not.toBe(second.instanceId)
    expect(first.key).not.toBe(second.key)
  })

  it('refreshes inside its TTL, so a healthy worker never reads as absent', async () => {
    expect(COMMUNITY_WORKER_HEARTBEAT_INTERVAL_MS * 3).toBe(
      COMMUNITY_WORKER_HEARTBEAT_TTL_SECONDS * 1000
    )
    const redis = new TtlRedis()
    const { logger } = recordingLogger()
    const heartbeat = heartbeatOn(redis, logger)
    await heartbeat.start()

    for (let tick = 0; tick < 20; tick += 1) {
      await vi.advanceTimersByTimeAsync(COMMUNITY_WORKER_HEARTBEAT_INTERVAL_MS)
      expect(redis.live(heartbeat.key)).not.toBeNull()
    }
    expect(redis.log.filter((line) => line.startsWith('set'))).toHaveLength(21)
    await heartbeat.stop()
  })

  it('expires on its TTL once refreshes stop landing, and never throws over a missed one', async () => {
    const redis = new TtlRedis()
    const { logger, lines } = recordingLogger()
    const heartbeat = heartbeatOn(redis, logger)
    await heartbeat.start()
    const lastWriteAt = Date.now()

    redis.mode = 'failing'
    await vi.advanceTimersByTimeAsync(COMMUNITY_WORKER_HEARTBEAT_INTERVAL_MS)
    await expect(heartbeat.beat()).resolves.toBe(false)
    expect(lines.at(-1)).toEqual({
      level: 'warn',
      event: COMMUNITY_WORKER_HEARTBEAT_LOG_EVENTS.refreshFailed,
    })

    // Still live just before the TTL from the last refresh that landed...
    await vi.advanceTimersByTimeAsync(
      lastWriteAt + COMMUNITY_WORKER_HEARTBEAT_TTL_SECONDS * 1000 - 1 - Date.now()
    )
    expect(redis.live(heartbeat.key)).not.toBeNull()
    // ...and gone at it.
    await vi.advanceTimersByTimeAsync(1)
    expect(redis.live(heartbeat.key)).toBeNull()
    expect(lines.filter((line) => line.level === 'warn').length).toBeGreaterThanOrEqual(3)

    // The next refresh that lands brings it back.
    redis.mode = 'up'
    await expect(heartbeat.beat()).resolves.toBe(true)
    expect(redis.live(heartbeat.key)).not.toBeNull()
    await heartbeat.stop()
  })

  it('bounds a refresh that never answers and does not stack refreshes behind it', async () => {
    const redis = new TtlRedis()
    const { logger, lines } = recordingLogger()
    const heartbeat = heartbeatOn(redis, logger)
    redis.mode = 'hanging'
    const first = heartbeat.start()
    expect(heartbeat.beat()).toBe(first)

    await vi.advanceTimersByTimeAsync(5_000)
    await expect(first).resolves.toBe(false)
    expect(lines).toEqual([
      { level: 'warn', event: COMMUNITY_WORKER_HEARTBEAT_LOG_EVENTS.refreshFailed },
    ])
    redis.mode = 'up'
    await heartbeat.stop()
  })

  it('deletes the key and stops refreshing on shutdown', async () => {
    const redis = new TtlRedis()
    const { logger, lines } = recordingLogger()
    const heartbeat = heartbeatOn(redis, logger)
    await heartbeat.start()

    await heartbeat.stop()
    expect(redis.live(heartbeat.key)).toBeNull()
    expect(redis.log.at(-1)).toBe(`del ${heartbeat.key}`)
    expect(lines.at(-1)).toEqual({
      level: 'info',
      event: COMMUNITY_WORKER_HEARTBEAT_LOG_EVENTS.removed,
    })

    await vi.advanceTimersByTimeAsync(COMMUNITY_WORKER_HEARTBEAT_INTERVAL_MS * 3)
    await expect(heartbeat.beat()).resolves.toBe(false)
    expect(redis.live(heartbeat.key)).toBeNull()
    expect(heartbeat.stop()).toBe(heartbeat.stop())
  })

  it('deletes after a refresh still in flight, so nothing re-creates the key', async () => {
    const redis = new TtlRedis()
    const { logger } = recordingLogger()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const heartbeat = new CommunityWorkerHeartbeat({
      redis: async () => {
        await gate
        return redis
      },
      workerName: name,
      commitSha: 'abc123',
      instanceId: 'instance-1',
      logger,
    })
    const refreshing = heartbeat.start()
    const stopping = heartbeat.stop()
    release()
    await Promise.all([refreshing, stopping])

    expect(redis.log).toEqual([`set ${heartbeat.key}`, `del ${heartbeat.key}`])
    expect(redis.live(heartbeat.key)).toBeNull()
  })

  it('gives up removing inside its budget, well within the shutdown deadline', async () => {
    expect(COMMUNITY_WORKER_HEARTBEAT_STOP_TIMEOUT_MS).toBeLessThan(
      COMMUNITY_SHUTDOWN_TIMEOUT_MS / 5
    )
    const redis = new TtlRedis()
    const { logger, lines } = recordingLogger()
    const heartbeat = heartbeatOn(redis, logger)
    await heartbeat.start()

    redis.mode = 'hanging'
    const stopping = heartbeat.stop()
    await vi.advanceTimersByTimeAsync(COMMUNITY_WORKER_HEARTBEAT_STOP_TIMEOUT_MS)
    await expect(stopping).resolves.toBeUndefined()
    expect(lines.at(-1)).toEqual({
      level: 'warn',
      event: COMMUNITY_WORKER_HEARTBEAT_LOG_EVENTS.removeFailed,
    })
  })

  it('refuses a refresh interval that does not fit inside the TTL', () => {
    const { logger } = recordingLogger()
    expect(
      () =>
        new CommunityWorkerHeartbeat({
          redis: () => Promise.resolve(new TtlRedis()),
          workerName: name,
          commitSha: null,
          ttlSeconds: 30,
          intervalMs: 30_000,
          logger,
        })
    ).toThrow(/refresh more often than it expires/)
  })
})

describe('closing the worker with its heartbeat', () => {
  function fakeWorker(order: string[]) {
    const close = vi.fn((force?: boolean) => {
      order.push(force ? 'worker.close(force)' : 'worker.close')
      return Promise.resolve()
    })
    return { worker: { close } as unknown as Worker, close }
  }

  it('removes the heartbeat before the worker stops and closes its connection', async () => {
    const order: string[] = []
    const { worker, close } = fakeWorker(order)
    const heartbeat = {
      stop: vi.fn(() => {
        order.push('heartbeat.stop')
        return Promise.resolve()
      }),
    } as unknown as CommunityWorkerHeartbeat

    closeWithHeartbeat(worker, heartbeat)
    await worker.close()

    expect(order).toEqual(['heartbeat.stop', 'worker.close'])
    expect(close).toHaveBeenCalledWith(false)
  })

  it('does not hold a forced close for the removal', async () => {
    const order: string[] = []
    const { worker } = fakeWorker(order)
    const heartbeat = {
      stop: vi.fn(() => {
        order.push('heartbeat.stop')
        return new Promise<void>(() => undefined)
      }),
    } as unknown as CommunityWorkerHeartbeat

    closeWithHeartbeat(worker, heartbeat)
    await worker.close(true)

    expect(order).toEqual(['heartbeat.stop', 'worker.close(force)'])
  })
})

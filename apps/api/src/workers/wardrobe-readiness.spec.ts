// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WardrobeWorkerNotReadyError,
  checkWardrobeWorkerReadiness,
} from './wardrobe-readiness'

const ok = () => Promise.resolve('ok')

afterEach(() => {
  vi.useRealTimers()
})

describe('checkWardrobeWorkerReadiness', () => {
  it('resolves with each check run once when the database, Redis and storage answer', async () => {
    const database = vi.fn(ok)
    const redis = vi.fn(ok)
    const storage = vi.fn(ok)

    const checked = await checkWardrobeWorkerReadiness({ database, redis, storage })

    expect(Object.keys(checked).toSorted()).toEqual(['database', 'redis', 'storage'])
    expect(database).toHaveBeenCalledOnce()
    expect(redis).toHaveBeenCalledOnce()
    expect(storage).toHaveBeenCalledOnce()
  })

  it('names every failing check by the error class only, never its message', async () => {
    class ConnectionRefused extends Error {}
    const secret = 'postgresql://user:hunter2@db.example.com'
    const error = await checkWardrobeWorkerReadiness({
      database: () => Promise.reject(new ConnectionRefused(secret)),
      redis: ok,
      storage: () => Promise.reject(new TypeError('service role key invalid')),
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(WardrobeWorkerNotReadyError)
    expect((error as WardrobeWorkerNotReadyError).failures).toEqual([
      { check: 'database', reason: 'ConnectionRefused' },
      { check: 'storage', reason: 'TypeError' },
    ])
    expect((error as Error).message).not.toContain('hunter2')
    expect((error as Error).message).not.toContain('service role key')
  })

  it('fails a check that does not answer within its bound', async () => {
    vi.useFakeTimers()
    const result = checkWardrobeWorkerReadiness({
      database: ok,
      redis: () => new Promise(() => undefined),
      storage: ok,
      timeoutMs: 1_000,
    }).catch((caught: unknown) => caught)

    await vi.advanceTimersByTimeAsync(1_000)

    const error = await result
    expect(error).toBeInstanceOf(WardrobeWorkerNotReadyError)
    expect((error as WardrobeWorkerNotReadyError).failures).toEqual([
      { check: 'redis', reason: 'no answer within 1000 ms' },
    ])
  })

  it('runs in the bootstrap before any queue, worker or storage-using consumer is created', () => {
    const source = readFileSync(path.resolve(__dirname, 'wardrobe.bootstrap.ts'), 'utf8')
    const start = source.slice(
      source.indexOf('export async function startWardrobeWorker(')
    )
    const config = start.indexOf('assertHostedWardrobeConfig(')
    const policy = start.indexOf('resolveGuardianConsentPolicy()')
    const readiness = start.indexOf('checkWardrobeWorkerReadiness(')
    const ready = start.indexOf("'wardrobe_worker_ready'")
    const queues = start.indexOf('createQueues()')
    const firstWorker = start.indexOf('createWorker(')
    expect(config).toBeGreaterThan(-1)
    expect(config).toBeLessThan(policy)
    expect(policy).toBeLessThan(readiness)
    expect(readiness).toBeLessThan(ready)
    expect(ready).toBeLessThan(queues)
    expect(queues).toBeLessThan(firstWorker)
    // The started line is a different event, logged only after the consumers exist.
    expect(start.indexOf('Dedicated wardrobe worker started')).toBeGreaterThan(
      firstWorker
    )
  })

  it('checks the database, Redis and the wardrobe-images bucket the jobs depend on', () => {
    const source = readFileSync(path.resolve(__dirname, 'wardrobe.bootstrap.ts'), 'utf8')
    expect(source).toContain('$queryRaw`SELECT 1`')
    expect(source).toContain('pingRedisOnce()')
    expect(source).toContain('.checkReadable()')
  })
})

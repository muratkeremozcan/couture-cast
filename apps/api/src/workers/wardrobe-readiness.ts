import Redis from 'ioredis'
import { getRedisConfig, redisOptionsFromConfig } from '../config/redis'

/**
 * Readiness of the hosted wardrobe worker: bounded one-shot checks of what its jobs need, run
 * before any consumer starts. Process start is not readiness: Prisma connects lazily, the
 * storage adapter accepts a missing key, and BullMQ retries a dead Redis forever, so without
 * these a service with a bad database credential or a missing Supabase key would print its
 * started line and then spend every job's retries on configuration faults.
 */
export const READINESS_CHECK_TIMEOUT_MS = 10_000

export type ReadinessCheckName = 'database' | 'redis' | 'storage'

export class WardrobeWorkerNotReadyError extends Error {
  constructor(readonly failures: { check: ReadinessCheckName; reason: string }[]) {
    super(
      `Wardrobe worker is not ready: ${failures
        .map((failure) => `${failure.check} (${failure.reason})`)
        .join(', ')}`
    )
    this.name = 'WardrobeWorkerNotReadyError'
  }
}

export type WardrobeReadinessDeps = {
  /** `SELECT 1` against the worker's database. */
  database: () => Promise<unknown>
  /** `PING` on a connection configured like the workers' own. */
  redis: () => Promise<unknown>
  /** A one-entry read of the `wardrobe-images` bucket. */
  storage: () => Promise<unknown>
  timeoutMs?: number
}

/**
 * Only the error's class goes in the reason: a connection error's message can carry a host, a
 * user or a key.
 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error
}

async function bounded(
  check: () => Promise<unknown>,
  timeoutMs: number
): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined
  try {
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
    })
    const outcome = await Promise.race([
      Promise.resolve()
        .then(check)
        .then(() => 'ok' as const),
      timedOut,
    ])
    return outcome === 'ok' ? null : `no answer within ${timeoutMs} ms`
  } catch (error) {
    return reasonOf(error)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Runs the three checks together; resolves with each one's duration or throws every failure. */
export async function checkWardrobeWorkerReadiness(
  deps: WardrobeReadinessDeps
): Promise<Record<ReadinessCheckName, number>> {
  const timeoutMs = deps.timeoutMs ?? READINESS_CHECK_TIMEOUT_MS
  const names: ReadinessCheckName[] = ['database', 'redis', 'storage']
  const results = await Promise.all(
    names.map(async (check) => {
      const startedAt = Date.now()
      const failure = await bounded(deps[check], timeoutMs)
      return { check, failure, ms: Date.now() - startedAt }
    })
  )
  const failures = results.flatMap(({ check, failure }) =>
    failure === null ? [] : [{ check, reason: failure }]
  )
  if (failures.length > 0) throw new WardrobeWorkerNotReadyError(failures)
  return Object.fromEntries(results.map(({ check, ms }) => [check, ms])) as Record<
    ReadinessCheckName,
    number
  >
}

/**
 * A short-lived Redis client for the `PING`, built from the same configuration BullMQ's workers
 * use but with a bounded retry and connect time, because the workers' own options retry a dead
 * Redis forever.
 */
export async function pingRedisOnce(): Promise<void> {
  const config = getRedisConfig()
  const client = new Redis(config.url, {
    ...redisOptionsFromConfig(config),
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    retryStrategy: () => null,
    enableOfflineQueue: true,
  })
  client.on('error', () => undefined)
  try {
    await client.ping()
  } finally {
    client.disconnect()
  }
}

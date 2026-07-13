export const DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS = 30_000

export interface ShutdownWorker {
  close(force?: boolean): Promise<void>
}

export interface ShutdownQueue {
  close(): Promise<void>
  disconnect(): Promise<void>
}

export interface ShutdownRedisClient {
  quit(): Promise<unknown>
  disconnect(reconnect?: boolean): void
}

export interface WorkerShutdownResources {
  workers: readonly ShutdownWorker[]
  queues: readonly ShutdownQueue[]
  redisClients: readonly ShutdownRedisClient[]
  disconnectPrisma: () => Promise<void>
}

export interface WorkerShutdownOptions {
  timeoutMs?: number
}

export class WorkerShutdownTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Worker shutdown exceeded ${timeoutMs}ms`)
    this.name = 'WorkerShutdownTimeoutError'
  }
}

async function settlePhase(
  operations: readonly (() => Promise<unknown>)[],
  errors: unknown[]
): Promise<void> {
  const results = await Promise.allSettled(
    operations.map((operation) => Promise.resolve().then(operation))
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      errors.push(result.reason)
    }
  }
}

async function closeGracefully(
  resources: WorkerShutdownResources,
  isExpired: () => boolean
): Promise<void> {
  const errors: unknown[] = []

  await settlePhase(
    resources.workers.map((worker) => () => worker.close()),
    errors
  )
  if (isExpired()) return

  await settlePhase(
    resources.queues.map((queue) => () => queue.close()),
    errors
  )
  if (isExpired()) return

  await settlePhase(
    resources.redisClients.map((client) => () => client.quit()),
    errors
  )
  if (isExpired()) return

  await settlePhase([resources.disconnectPrisma], errors)

  if (errors.length === 1) {
    throw errors[0]
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Multiple worker resources failed to close')
  }
}

function invokeFallback(operation: () => unknown): void {
  try {
    void Promise.resolve(operation()).catch(() => undefined)
  } catch {
    // The deadline error remains the primary shutdown failure. Every other
    // fallback is still attempted even if one resource throws synchronously.
  }
}

function forceDisconnect(resources: WorkerShutdownResources): void {
  for (const worker of resources.workers) {
    invokeFallback(() => worker.close(true))
  }
  for (const queue of resources.queues) {
    invokeFallback(() => queue.disconnect())
  }
  for (const client of resources.redisClients) {
    invokeFallback(() => client.disconnect(false))
  }
  invokeFallback(resources.disconnectPrisma)
}

export async function shutdownWorkerResources(
  resources: WorkerShutdownResources,
  options: WorkerShutdownOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Worker shutdown timeout must be a positive number')
  }

  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const gracefulShutdown = closeGracefully(resources, () => expired)
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true
      forceDisconnect(resources)
      reject(new WorkerShutdownTimeoutError(timeoutMs))
    }, timeoutMs)
  })

  try {
    await Promise.race([gracefulShutdown, deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

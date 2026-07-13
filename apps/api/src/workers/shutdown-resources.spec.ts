import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  shutdownWorkerResources,
  WorkerShutdownTimeoutError,
} from './shutdown-resources.js'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })

  return { promise, resolve }
}

describe('shutdownWorkerResources', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drains workers before closing queues, Redis, and Prisma in dependency order', async () => {
    const order: string[] = []
    const workerDrain = deferred()
    const shutdown = shutdownWorkerResources(
      {
        workers: [
          {
            close: vi.fn(() => {
              order.push('worker')
              return workerDrain.promise
            }),
          },
        ],
        queues: [
          {
            close: vi.fn(() => {
              order.push('queue')
              return Promise.resolve()
            }),
            disconnect: vi.fn(() => Promise.resolve()),
          },
        ],
        redisClients: [
          {
            quit: vi.fn(() => {
              order.push('redis')
              return Promise.resolve('OK')
            }),
            disconnect: vi.fn(),
          },
        ],
        disconnectPrisma: vi.fn(() => {
          order.push('prisma')
          return Promise.resolve()
        }),
      },
      { timeoutMs: 30_000 }
    )

    await vi.waitFor(() => expect(order).toEqual(['worker']))
    workerDrain.resolve()
    await shutdown

    expect(order).toEqual(['worker', 'queue', 'redis', 'prisma'])
  })

  it('continues through later shutdown phases when a graceful close rejects', async () => {
    const order: string[] = []
    const shutdown = shutdownWorkerResources(
      {
        workers: [
          {
            close: vi.fn(() => {
              order.push('worker')
              return Promise.reject(new Error('worker close failed'))
            }),
          },
        ],
        queues: [
          {
            close: vi.fn(() => {
              order.push('queue')
              return Promise.resolve()
            }),
            disconnect: vi.fn(() => Promise.resolve()),
          },
        ],
        redisClients: [
          {
            quit: vi.fn(() => {
              order.push('redis')
              return Promise.resolve('OK')
            }),
            disconnect: vi.fn(),
          },
        ],
        disconnectPrisma: vi.fn(() => {
          order.push('prisma')
          return Promise.resolve()
        }),
      },
      { timeoutMs: 30_000 }
    )

    await expect(shutdown).rejects.toThrow('worker close failed')
    expect(order).toEqual(['worker', 'queue', 'redis', 'prisma'])
  })

  it('forces disconnection and returns when graceful shutdown exceeds its deadline', async () => {
    vi.useFakeTimers()
    const neverDrains = new Promise<void>(() => undefined)
    const workerClose = vi.fn((force?: boolean) =>
      force ? Promise.resolve() : neverDrains
    )
    const queueClose = vi.fn(() => Promise.resolve())
    const queueDisconnect = vi.fn(() => Promise.resolve())
    const redisQuit = vi.fn(() => Promise.resolve('OK'))
    const redisDisconnect = vi.fn()
    const prismaDisconnect = vi.fn(() => Promise.resolve())
    const shutdown = shutdownWorkerResources(
      {
        workers: [{ close: workerClose }],
        queues: [{ close: queueClose, disconnect: queueDisconnect }],
        redisClients: [{ quit: redisQuit, disconnect: redisDisconnect }],
        disconnectPrisma: prismaDisconnect,
      },
      { timeoutMs: 30_000 }
    )
    const rejection = expect(shutdown).rejects.toEqual(
      new WorkerShutdownTimeoutError(30_000)
    )

    await vi.advanceTimersByTimeAsync(30_000)
    await rejection

    expect(workerClose).toHaveBeenNthCalledWith(1)
    expect(workerClose).toHaveBeenNthCalledWith(2, true)
    expect(queueClose).not.toHaveBeenCalled()
    expect(queueDisconnect).toHaveBeenCalledOnce()
    expect(redisQuit).not.toHaveBeenCalled()
    expect(redisDisconnect).toHaveBeenCalledOnce()
    expect(prismaDisconnect).toHaveBeenCalledOnce()
  })
})

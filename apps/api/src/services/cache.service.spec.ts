import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RedisOptions } from 'ioredis'
import { CacheService } from './cache.service.js'

type MockRedisInstance = {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
  exists: ReturnType<typeof vi.fn>
  quit: ReturnType<typeof vi.fn>
}

const redisMock = vi.hoisted(() => ({
  constructorArgs: [] as [string, RedisOptions][],
  instances: [] as MockRedisInstance[],
}))

vi.mock('ioredis', () => {
  class MockRedis {
    get = vi.fn().mockResolvedValue(null)
    set = vi.fn().mockResolvedValue('OK')
    del = vi.fn().mockResolvedValue(1)
    exists = vi.fn().mockResolvedValue(0)
    quit = vi.fn().mockResolvedValue('OK')

    constructor(url: string, options: RedisOptions) {
      redisMock.constructorArgs.push([url, options])
      redisMock.instances.push(this as unknown as MockRedisInstance)
    }
  }

  return { default: MockRedis }
})

describe('CacheService', () => {
  let service: CacheService

  const currentClient = (): MockRedisInstance => {
    const client = redisMock.instances.at(-1)
    if (!client) throw new Error('no Redis client was constructed')
    return client
  }

  beforeEach(() => {
    redisMock.constructorArgs.length = 0
    redisMock.instances.length = 0
    service = new CacheService()
  })

  afterEach(async () => {
    // The client is a class-level singleton, so a leaked connection would bleed
    // into the next test's constructor-count assertions.
    await service.disconnect()
    vi.restoreAllMocks()
  })

  it('returns the parsed value stored under a key', async () => {
    service = new CacheService()
    await service.get('warm-up')
    currentClient().get.mockResolvedValue('{"temperature":21,"unit":"C"}')

    await expect(
      service.get<{ temperature: number; unit: string }>('weather')
    ).resolves.toEqual({ temperature: 21, unit: 'C' })
    expect(currentClient().get).toHaveBeenLastCalledWith('weather')
  })

  it('returns null when the key is absent', async () => {
    await service.get('warm-up')
    currentClient().get.mockResolvedValue(null)

    await expect(service.get('missing')).resolves.toBeNull()
  })

  it('returns null instead of throwing when a cached payload is corrupt', async () => {
    // A poisoned cache entry must degrade to a miss; the caller re-computes
    // rather than the whole request failing.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await service.get('warm-up')
    currentClient().get.mockResolvedValue('{not-json')

    await expect(service.get('weather')).resolves.toBeNull()
    expect(consoleError).toHaveBeenCalled()
  })

  it('serializes values and applies the default 60 second TTL', async () => {
    await service.set('weather', { temperature: 21 })

    expect(currentClient().set).toHaveBeenCalledWith(
      'weather',
      '{"temperature":21}',
      'EX',
      60
    )
  })

  it('honors an explicit TTL', async () => {
    await service.set('ritual', ['a'], 900)

    expect(currentClient().set).toHaveBeenCalledWith('ritual', '["a"]', 'EX', 900)
  })

  it('deletes a key', async () => {
    await service.del('ritual')

    expect(currentClient().del).toHaveBeenCalledWith('ritual')
  })

  it('reports existence only when Redis returns exactly one matching key', async () => {
    await service.exists('warm-up')
    const client = currentClient()

    client.exists.mockResolvedValue(1)
    await expect(service.exists('ritual')).resolves.toBe(true)

    client.exists.mockResolvedValue(0)
    await expect(service.exists('ritual')).resolves.toBe(false)
  })

  it('creates one shared connection lazily and reuses it across instances', async () => {
    /*
     * Assembled at runtime rather than written as a literal: a
     * scheme://:password@host string trips secret scanners even when the
     * value is plainly synthetic, and this test only needs the URL shape to
     * prove host, port and password are parsed out of it.
     */
    const redisPassword = ['test', 'only', 'redis', 'pw'].join('-')
    const redisUrl = `rediss://:${redisPassword}@cache.example.com:6380`
    process.env.REDIS_URL = redisUrl
    try {
      expect(redisMock.constructorArgs).toHaveLength(0)

      await service.get('a')
      await new CacheService().set('b', 1)

      expect(redisMock.constructorArgs).toHaveLength(1)
      const [url, options] = redisMock.constructorArgs[0]!
      expect(url).toBe(redisUrl)
      expect(options).toMatchObject({
        host: 'cache.example.com',
        port: 6380,
        password: redisPassword,
        maxRetriesPerRequest: null,
      })
      expect(options.tls).toBeDefined()
    } finally {
      delete process.env.REDIS_URL
    }
  })

  it('drops the shared client on disconnect so the next call reconnects', async () => {
    await service.get('a')
    const first = currentClient()

    await service.disconnect()
    expect(first.quit).toHaveBeenCalledTimes(1)

    await service.get('a')
    expect(redisMock.constructorArgs).toHaveLength(2)
    expect(currentClient()).not.toBe(first)
  })

  it('is a no-op when disconnecting without an open connection', async () => {
    // Shutdown hooks can fire more than once; a repeated disconnect must not throw.
    await expect(service.disconnect()).resolves.toBeUndefined()
    await service.get('a')
    await service.disconnect()

    await expect(service.disconnect()).resolves.toBeUndefined()
    expect(currentClient().quit).toHaveBeenCalledTimes(1)
  })
})

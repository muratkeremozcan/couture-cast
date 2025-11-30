import Redis from 'ioredis'
import { getRedisConfig, redisOptionsFromConfig } from '../config/redis'

export class CacheService {
  private static client: Redis | null = null

  private get client(): Redis {
    if (!CacheService.client) {
      const redisConfig = getRedisConfig()
      CacheService.client = new Redis(
        redisConfig.url,
        redisOptionsFromConfig(redisConfig)
      )
    }
    return CacheService.client
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key)
    if (!value) return null
    try {
      return JSON.parse(value) as T
    } catch (err) {
      console.error(`Failed to parse cached value for key "${key}":`, err)
      return null
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = 60): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  }

  async del(key: string): Promise<void> {
    await this.client.del(key)
  }

  async exists(key: string): Promise<boolean> {
    const count = await this.client.exists(key)
    return count === 1
  }

  async disconnect(): Promise<void> {
    if (CacheService.client) {
      await CacheService.client.quit()
      CacheService.client = null
    }
  }
}

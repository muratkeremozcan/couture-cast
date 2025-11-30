import Redis from 'ioredis'
import { getRedisConfig, redisOptionsFromConfig } from '../config/redis'

export class CacheService {
  private client: Redis

  constructor() {
    const redisConfig = getRedisConfig()
    this.client = new Redis(redisOptionsFromConfig(redisConfig))
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key)
    return value ? (JSON.parse(value) as T) : null
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
    await this.client.quit()
  }
}

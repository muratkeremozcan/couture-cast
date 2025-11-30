import type { RedisOptions } from 'ioredis'

type RedisConfig = {
  url: string
  tls?: boolean
}

export function getRedisConfig(): RedisConfig {
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  const tls = process.env.REDIS_TLS === 'true'
  return { url, tls }
}

export function redisOptionsFromConfig(config: RedisConfig): RedisOptions {
  const options: RedisOptions = {
    maxRetriesPerRequest: null,
  }

  if (config.tls) {
    options.tls = {}
  }

  return options
}

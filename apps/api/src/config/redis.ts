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
  try {
    const parsed = new URL(config.url)
    options.host = parsed.hostname
    options.port = parsed.port ? Number(parsed.port) : 6379
    if (parsed.password) {
      options.password = parsed.password
    }
    if (parsed.protocol === 'rediss:') {
      options.tls = {}
    }
  } catch (err) {
    // fallback: leave options as-is
    console.error('Failed to parse REDIS_URL, falling back to defaults', err)
  }

  if (config.tls) {
    options.tls = options.tls || {}
  }

  return options
}

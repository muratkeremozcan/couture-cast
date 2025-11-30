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

  if (config.url.startsWith('redis://')) {
    const [, hostPort] = config.url.split('redis://')
    if (hostPort) {
      const [host, port] = hostPort.split(':')
      options.host = host
      options.port = port ? Number(port) : 6379
    }
  }

  if (config.tls) {
    options.tls = {}
  }

  return options
}

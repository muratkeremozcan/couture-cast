import type { AlertWeatherEvent } from '@couture/api-client'
import { describe, expect, it, vi } from 'vitest'

import { ALERT_WEATHER_RELAY_CHANNEL } from '../gateway/alert-weather-relay.service.js'
import { RedisAlertRealtimePublisher } from './redis-alert-realtime.publisher.js'

const event: AlertWeatherEvent = {
  version: '1',
  timestamp: '2026-07-13T14:30:00.000Z',
  userId: 'user-1',
  data: {
    alertType: 'severe',
    location: 'Chicago',
    message: 'Severe thunderstorm warning.',
    severity: 'critical',
  },
}

describe('RedisAlertRealtimePublisher', () => {
  it('publishes a validated relay message for API gateway subscribers', async () => {
    const redis = { publish: vi.fn().mockResolvedValue(2) }
    const publisher = new RedisAlertRealtimePublisher(redis)

    await expect(publisher.publish('event-1', 'user-1', event)).resolves.toBe(true)

    expect(redis.publish).toHaveBeenCalledTimes(1)
    const [channel, serialized] = redis.publish.mock.calls[0] as [string, string]
    expect(channel).toBe(ALERT_WEATHER_RELAY_CHANNEL)
    expect(JSON.parse(serialized)).toEqual({ channel: 'alert:weather', event })
  })

  it('reports zero subscribers as no accepted realtime delivery', async () => {
    const redis = { publish: vi.fn().mockResolvedValue(0) }
    const publisher = new RedisAlertRealtimePublisher(redis)

    await expect(publisher.publish('event-1', 'user-1', event)).resolves.toBe(false)
  })

  it('rejects a Redis publish that exceeds its explicit deadline', async () => {
    const redis = { publish: vi.fn(() => new Promise<number>(() => undefined)) }
    const publisher = new RedisAlertRealtimePublisher(redis, 5)

    await expect(publisher.publish('event-1', 'user-1', event)).rejects.toMatchObject({
      name: 'AlertRealtimePublishTimeoutError',
    })
  })

  it('rejects a mismatched event owner before publishing', async () => {
    const redis = { publish: vi.fn().mockResolvedValue(0) }
    const publisher = new RedisAlertRealtimePublisher(redis)

    await expect(publisher.publish('event-1', 'user-2', event)).rejects.toThrow(
      'Alert relay user does not match event user'
    )
    expect(redis.publish).not.toHaveBeenCalled()
  })
})

import type { AlertWeatherEvent } from '@couture/api-client'

import {
  ALERT_WEATHER_RELAY_CHANNEL,
  serializeAlertWeatherRelayMessage,
} from '../gateway/alert-weather-relay.service.js'
import { AlertRealtimePublisher } from './alert-fanout.types.js'

export interface RedisAlertPublisherClient {
  publish(channel: string, message: string): Promise<number>
}

export const ALERT_REALTIME_PUBLISH_TIMEOUT_MS = 2_000

export class AlertRealtimePublishTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Redis alert publish exceeded ${timeoutMs}ms`)
    this.name = 'AlertRealtimePublishTimeoutError'
  }
}

export class RedisAlertRealtimePublisher extends AlertRealtimePublisher {
  constructor(
    private readonly redis: RedisAlertPublisherClient,
    private readonly publishTimeoutMs = ALERT_REALTIME_PUBLISH_TIMEOUT_MS
  ) {
    super()
    if (!Number.isFinite(publishTimeoutMs) || publishTimeoutMs <= 0) {
      throw new Error('publishTimeoutMs must be a positive finite number')
    }
  }

  async publish(
    eventId: string,
    userId: string,
    payload: AlertWeatherEvent
  ): Promise<boolean> {
    void eventId
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const subscriberCount = await Promise.race([
        this.redis.publish(
          ALERT_WEATHER_RELAY_CHANNEL,
          serializeAlertWeatherRelayMessage(userId, payload)
        ),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new AlertRealtimePublishTimeoutError(this.publishTimeoutMs)),
            this.publishTimeoutMs
          )
          timeout.unref?.()
        }),
      ])
      return subscriberCount > 0
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}

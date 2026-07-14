import { alertWeatherEventSchema, type AlertWeatherEvent } from '@couture/api-client'
import { Inject, Injectable } from '@nestjs/common'
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import Redis from 'ioredis'
import type { Logger } from 'pino'
import { z } from 'zod'

import { getRedisConfig, redisOptionsFromConfig } from '../../config/redis.js'
import { AlertWeatherGateway } from './gateway.gateway.js'
import { GATEWAY_LOGGER } from './gateway.constants.js'

export const ALERT_WEATHER_RELAY_CHANNEL = 'alert-weather-events'
export const ALERT_WEATHER_REDIS_SUBSCRIBER = Symbol('ALERT_WEATHER_REDIS_SUBSCRIBER')

export const alertWeatherRelayMessageSchema = z
  .object({
    channel: z.literal('alert:weather'),
    event: alertWeatherEventSchema,
  })
  .strict()

export interface AlertWeatherRedisSubscriber {
  readonly status: string
  connect(): Promise<unknown>
  subscribe(channel: string): Promise<unknown>
  unsubscribe(channel: string): Promise<unknown>
  on(event: 'message', listener: (channel: string, message: string) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close' | 'end', listener: () => void): unknown
  off(event: 'message', listener: (channel: string, message: string) => void): unknown
  off(event: 'error', listener: (error: Error) => void): unknown
  off(event: 'close' | 'end', listener: () => void): unknown
  quit(): Promise<unknown>
}

export function serializeAlertWeatherRelayMessage(
  userId: string,
  event: AlertWeatherEvent
) {
  const parsedEvent = alertWeatherEventSchema.parse(event)
  if (parsedEvent.userId !== userId) {
    throw new Error('Alert relay user does not match event user')
  }

  return JSON.stringify(
    alertWeatherRelayMessageSchema.parse({
      channel: 'alert:weather',
      event: parsedEvent,
    })
  )
}

export const alertWeatherRedisSubscriberProvider = {
  provide: ALERT_WEATHER_REDIS_SUBSCRIBER,
  useFactory: (): AlertWeatherRedisSubscriber | null => {
    if (process.env.NODE_ENV === 'test') {
      return null
    }

    const config = getRedisConfig()
    return new Redis(config.url, {
      ...redisOptionsFromConfig(config),
      connectTimeout: 5_000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    })
  },
}

@Injectable()
export class AlertWeatherRelayService implements OnModuleInit, OnModuleDestroy {
  private subscribed = false
  private destroyed = false
  private listenersAttached = false
  private connectionEpoch = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private subscribePromise: Promise<void> | undefined
  private readonly messageListener = (channel: string, message: string) => {
    this.handleMessage(channel, message)
  }
  private readonly errorListener = (error: Error) => {
    this.handleConnectionLoss('error', error)
  }
  private readonly closeListener = () => {
    this.handleConnectionLoss('close')
  }
  private readonly endListener = () => {
    this.handleConnectionLoss('end')
  }

  constructor(
    @Inject(ALERT_WEATHER_REDIS_SUBSCRIBER)
    private readonly subscriber: AlertWeatherRedisSubscriber | null,
    @Inject(AlertWeatherGateway) private readonly gateway: AlertWeatherGateway,
    @Inject(GATEWAY_LOGGER) private readonly logger: Logger
  ) {}

  onModuleInit(): void {
    if (!this.subscriber || this.listenersAttached) {
      return
    }

    this.subscriber.on('message', this.messageListener)
    this.subscriber.on('error', this.errorListener)
    this.subscriber.on('close', this.closeListener)
    this.subscriber.on('end', this.endListener)
    this.listenersAttached = true
    void this.subscribe()
  }

  private subscribe(): Promise<void> {
    if (!this.subscriber || this.destroyed) {
      return Promise.resolve()
    }
    if (this.subscribePromise) return this.subscribePromise

    this.subscribePromise = this.performSubscribe().finally(() => {
      this.subscribePromise = undefined
    })
    return this.subscribePromise
  }

  private async performSubscribe(): Promise<void> {
    if (!this.subscriber || this.destroyed) return
    const connectionEpoch = this.connectionEpoch
    try {
      if (['wait', 'end'].includes(this.subscriber.status)) {
        await this.subscriber.connect()
      }
      if (this.destroyed) {
        return
      }
      await this.subscriber.subscribe(ALERT_WEATHER_RELAY_CHANNEL)
      if (this.destroyed || connectionEpoch !== this.connectionEpoch) {
        this.subscribed = false
        this.scheduleRetry()
        return
      }
      this.subscribed = true
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = undefined
      }
    } catch (error) {
      this.subscribed = false
      this.logger.error(
        { error: error instanceof Error ? error.message : 'unknown' },
        'alert_weather_relay_subscribe_failed'
      )
      this.scheduleRetry()
    }
  }

  private handleConnectionLoss(event: 'error' | 'close' | 'end', error?: Error): void {
    if (this.destroyed) return
    this.connectionEpoch += 1
    this.subscribed = false
    this.logger.warn(
      {
        event,
        ...(error ? { error: error.message } : {}),
      },
      'alert_weather_relay_connection_lost'
    )
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.destroyed || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.subscribe()
    }, 5_000)
    this.retryTimer.unref?.()
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) {
      return
    }

    try {
      this.destroyed = true
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = undefined
      }
      await this.subscribePromise
      if (this.subscribed) {
        await this.subscriber.unsubscribe(ALERT_WEATHER_RELAY_CHANNEL)
        this.subscribed = false
      }
    } finally {
      if (this.listenersAttached) {
        this.subscriber.off('message', this.messageListener)
        this.subscriber.off('error', this.errorListener)
        this.subscriber.off('close', this.closeListener)
        this.subscriber.off('end', this.endListener)
        this.listenersAttached = false
      }
      await this.subscriber.quit()
    }
  }

  handleMessage(channel: string, rawMessage: string): boolean {
    if (channel !== ALERT_WEATHER_RELAY_CHANNEL) {
      return false
    }

    let candidate: unknown
    try {
      candidate = JSON.parse(rawMessage)
    } catch {
      this.logger.warn({ channel }, 'alert_weather_relay_message_rejected')
      return false
    }

    const message = alertWeatherRelayMessageSchema.safeParse(candidate)
    if (!message.success) {
      this.logger.warn(
        { channel, issueCount: message.error.issues.length },
        'alert_weather_relay_message_rejected'
      )
      return false
    }

    this.gateway.emitWeatherAlert(message.data.event.userId, message.data.event)
    return true
  }
}

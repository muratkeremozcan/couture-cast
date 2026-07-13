import type { AlertWeatherEvent } from '@couture/api-client'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ALERT_WEATHER_RELAY_CHANNEL,
  AlertWeatherRelayService,
  alertWeatherRedisSubscriberProvider,
  serializeAlertWeatherRelayMessage,
} from './alert-weather-relay.service.js'

const event: AlertWeatherEvent = {
  version: '1',
  timestamp: '2026-07-13T14:30:00.000Z',
  userId: 'user-1',
  data: {
    alertType: 'temperature',
    location: 'New York',
    message: 'Temperature will rise.',
    severity: 'warning',
  },
}
const logger = pino({ level: 'silent' })

describe('AlertWeatherRelayService', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects malformed relay messages without broadcasting', () => {
    const gateway = { emitWeatherAlert: vi.fn() }
    const service = new AlertWeatherRelayService(null, gateway as never, logger)

    expect(service.handleMessage(ALERT_WEATHER_RELAY_CHANNEL, '{bad-json')).toBe(false)
    expect(
      service.handleMessage(
        ALERT_WEATHER_RELAY_CHANNEL,
        JSON.stringify({ channel: 'alert:weather', event: { ...event, userId: '' } })
      )
    ).toBe(false)
    expect(service.handleMessage('other-channel', JSON.stringify({ event }))).toBe(false)
    expect(gateway.emitWeatherAlert).not.toHaveBeenCalled()
  })

  it('validates and relays a weather alert only to its event user', () => {
    const gateway = { emitWeatherAlert: vi.fn() }
    const service = new AlertWeatherRelayService(null, gateway as never, logger)

    expect(
      service.handleMessage(
        ALERT_WEATHER_RELAY_CHANNEL,
        serializeAlertWeatherRelayMessage('user-1', event)
      )
    ).toBe(true)
    expect(gateway.emitWeatherAlert).toHaveBeenCalledWith('user-1', event)
  })

  it('rejects publisher identity mismatches', () => {
    expect(() => serializeAlertWeatherRelayMessage('user-2', event)).toThrow(
      'Alert relay user does not match event user'
    )
  })

  it('subscribes on module init and closes the Redis client on destroy', async () => {
    const listenerCalls: ((channel: string, message: string) => void)[] = []
    const subscriber = {
      status: 'wait',
      connect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(1),
      unsubscribe: vi.fn().mockResolvedValue(0),
      on: vi.fn(
        (_event: 'message', listener: (channel: string, message: string) => void) => {
          listenerCalls.push(listener)
        }
      ),
      off: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK'),
    }
    const gateway = { emitWeatherAlert: vi.fn() }
    const service = new AlertWeatherRelayService(
      subscriber as never,
      gateway as never,
      logger
    )

    service.onModuleInit()
    await vi.waitFor(() => {
      expect(subscriber.subscribe).toHaveBeenCalledWith(ALERT_WEATHER_RELAY_CHANNEL)
    })
    listenerCalls[0]?.(
      ALERT_WEATHER_RELAY_CHANNEL,
      serializeAlertWeatherRelayMessage('user-1', event)
    )
    await service.onModuleDestroy()

    expect(subscriber.connect).toHaveBeenCalledOnce()
    expect(gateway.emitWeatherAlert).toHaveBeenCalledWith('user-1', event)
    expect(subscriber.unsubscribe).toHaveBeenCalledWith(ALERT_WEATHER_RELAY_CHANNEL)
    expect(subscriber.off).toHaveBeenCalledWith('message', expect.any(Function))
    expect(subscriber.quit).toHaveBeenCalledOnce()
  })

  it('keeps API startup non-blocking when Redis is unavailable', async () => {
    const unavailableLogger = pino({ level: 'silent' })
    const errorSpy = vi.spyOn(unavailableLogger, 'error')
    const subscriber = {
      status: 'wait',
      connect: vi.fn().mockRejectedValue(new Error('redis unavailable')),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK'),
    }
    const service = new AlertWeatherRelayService(
      subscriber as never,
      { emitWeatherAlert: vi.fn() } as never,
      unavailableLogger
    )

    expect(() => service.onModuleInit()).not.toThrow()
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        { error: 'redis unavailable' },
        'alert_weather_relay_subscribe_failed'
      )
    })
    await service.onModuleDestroy()

    expect(subscriber.subscribe).not.toHaveBeenCalled()
    expect(subscriber.quit).toHaveBeenCalledOnce()
  })

  it('recovers after error, close, and end events without duplicate work', async () => {
    vi.useFakeTimers()
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    const subscriber = {
      status: 'ready',
      connect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(1),
      unsubscribe: vi.fn().mockResolvedValue(0),
      on: vi.fn((name: string, listener: (...args: unknown[]) => void) => {
        const eventListeners = listeners.get(name) ?? new Set()
        eventListeners.add(listener)
        listeners.set(name, eventListeners)
      }),
      off: vi.fn((name: string, listener: (...args: unknown[]) => void) => {
        listeners.get(name)?.delete(listener)
      }),
      quit: vi.fn().mockResolvedValue('OK'),
    }
    const emit = (name: string, ...args: unknown[]) => {
      listeners.get(name)?.forEach((listener) => listener(...args))
    }
    const service = new AlertWeatherRelayService(
      subscriber as never,
      { emitWeatherAlert: vi.fn() } as never,
      logger
    )

    service.onModuleInit()
    await Promise.resolve()
    await Promise.resolve()
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1)
    expect(subscriber.on.mock.calls.map(([name]) => name)).toEqual([
      'message',
      'error',
      'close',
      'end',
    ])

    subscriber.status = 'end'
    emit('error', new Error('redis socket failed'))
    emit('close')
    emit('end')
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(subscriber.connect).toHaveBeenCalledTimes(1)
    expect(subscriber.subscribe).toHaveBeenCalledTimes(2)

    subscriber.status = 'ready'
    emit('close')
    emit('end')
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(subscriber.subscribe).toHaveBeenCalledTimes(3)

    await service.onModuleDestroy()
    expect(subscriber.off.mock.calls.map(([name]) => name)).toEqual([
      'message',
      'error',
      'close',
      'end',
    ])
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('alert weather Redis subscriber provider', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not open an external Redis connection in test mode', () => {
    vi.stubEnv('NODE_ENV', 'test')

    expect(alertWeatherRedisSubscriberProvider.useFactory()).toBeNull()
  })
})

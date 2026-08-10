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

  const createDeferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  const createSubscriberStub = () => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    const subscriber = {
      status: 'wait',
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

    return {
      subscriber,
      emit: (name: string, ...args: unknown[]) => {
        listeners.get(name)?.forEach((listener) => listener(...args))
      },
      listenerFor: (name: string) => [...(listeners.get(name) ?? [])][0],
    }
  }

  it('stays inert when no Redis subscriber is configured', async () => {
    // Tests and local runs boot without Redis; the relay must not break startup.
    const service = new AlertWeatherRelayService(
      null,
      { emitWeatherAlert: vi.fn() } as never,
      logger
    )

    expect(() => service.onModuleInit()).not.toThrow()
    await expect(service.onModuleDestroy()).resolves.toBeUndefined()
  })

  it('attaches its listeners only once across repeated init calls', async () => {
    const { subscriber } = createSubscriberStub()
    const service = new AlertWeatherRelayService(
      subscriber as never,
      { emitWeatherAlert: vi.fn() } as never,
      logger
    )

    service.onModuleInit()
    service.onModuleInit()

    await vi.waitFor(() => {
      expect(subscriber.subscribe).toHaveBeenCalledTimes(1)
    })
    // Duplicate listeners would broadcast every alert twice.
    expect(subscriber.on).toHaveBeenCalledTimes(4)
    await service.onModuleDestroy()
  })

  it('quits a subscriber it never attached listeners to', async () => {
    const { subscriber } = createSubscriberStub()
    const service = new AlertWeatherRelayService(
      subscriber as never,
      { emitWeatherAlert: vi.fn() } as never,
      logger
    )

    await service.onModuleDestroy()

    expect(subscriber.off).not.toHaveBeenCalled()
    expect(subscriber.unsubscribe).not.toHaveBeenCalled()
    expect(subscriber.quit).toHaveBeenCalledOnce()
  })

  it('reports an unknown reason when the subscribe failure is not an Error', async () => {
    const failingLogger = pino({ level: 'silent' })
    const errorSpy = vi.spyOn(failingLogger, 'error')
    const { subscriber } = createSubscriberStub()
    subscriber.connect.mockRejectedValue('redis said no')
    const service = new AlertWeatherRelayService(
      subscriber as never,
      { emitWeatherAlert: vi.fn() } as never,
      failingLogger
    )

    service.onModuleInit()

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        { error: 'unknown' },
        'alert_weather_relay_subscribe_failed'
      )
    })
    await service.onModuleDestroy()
  })

  it('discards a subscribe that completed against a stale connection', async () => {
    // The socket dropped while the subscribe was in flight, so the SUBSCRIBE
    // landed on a connection that is already gone and must be retried.
    vi.useFakeTimers()
    const connectDeferred = createDeferred<void>()
    const { subscriber, emit } = createSubscriberStub()
    subscriber.connect.mockReturnValue(connectDeferred.promise)
    const service = new AlertWeatherRelayService(
      subscriber as never,
      { emitWeatherAlert: vi.fn() } as never,
      logger
    )

    service.onModuleInit()
    await Promise.resolve()
    emit('error', new Error('socket reset'))
    expect(vi.getTimerCount()).toBe(1)

    // The retry fires while the first attempt is still connecting, so it must
    // reuse the in-flight promise rather than starting a second connect.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(subscriber.subscribe).not.toHaveBeenCalled()
    expect(subscriber.connect).toHaveBeenCalledTimes(1)

    connectDeferred.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(subscriber.subscribe).toHaveBeenCalledTimes(2)

    await service.onModuleDestroy()
  })

  it('abandons an in-flight subscribe when the module is destroyed', async () => {
    const connectDeferred = createDeferred<void>()
    const { subscriber } = createSubscriberStub()
    subscriber.connect.mockReturnValue(connectDeferred.promise)
    const service = new AlertWeatherRelayService(
      subscriber as never,
      { emitWeatherAlert: vi.fn() } as never,
      logger
    )

    service.onModuleInit()
    await Promise.resolve()
    const destroyed = service.onModuleDestroy()
    connectDeferred.resolve()
    await destroyed

    // Subscribing after shutdown would leak a live Redis subscription.
    expect(subscriber.subscribe).not.toHaveBeenCalled()
    expect(subscriber.unsubscribe).not.toHaveBeenCalled()
    expect(subscriber.quit).toHaveBeenCalledOnce()
  })

  it('ignores connection events that arrive after shutdown', async () => {
    vi.useFakeTimers()
    const { subscriber, listenerFor } = createSubscriberStub()
    const service = new AlertWeatherRelayService(
      subscriber as never,
      { emitWeatherAlert: vi.fn() } as never,
      logger
    )

    service.onModuleInit()
    await vi.advanceTimersByTimeAsync(0)
    const closeListener = listenerFor('close')
    await service.onModuleDestroy()

    // ioredis can emit a trailing close after quit; rescheduling here would
    // resurrect a timer on a torn-down module.
    expect(() => closeListener?.()).not.toThrow()
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

  it('builds a lazy, fail-fast subscriber outside test mode', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('REDIS_URL', 'redis://relay.example.com:6390')

    const subscriber = alertWeatherRedisSubscriberProvider.useFactory()

    try {
      expect(subscriber).not.toBeNull()
      const options = (subscriber as unknown as { options: Record<string, unknown> })
        .options
      expect(options).toMatchObject({
        host: 'relay.example.com',
        port: 6390,
        lazyConnect: true,
        connectTimeout: 5_000,
      })
      // Returning null from retryStrategy stops ioredis reconnecting forever; the
      // relay owns its own five-second retry loop instead.
      expect((options.retryStrategy as () => number | null)()).toBeNull()
    } finally {
      ;(subscriber as unknown as { disconnect(): void } | null)?.disconnect()
    }
  })
})

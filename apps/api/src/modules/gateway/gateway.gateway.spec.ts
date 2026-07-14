import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { Namespace, Server, Socket } from 'socket.io'

import { ConnectionManager } from './connection-manager.service'
import {
  AlertWeatherGateway,
  EventsGateway,
  alertUserRoom,
  buildAlertGatewayOptions,
  buildGatewayOptions,
  createAuthMiddleware,
  namespacePattern,
} from './gateway.gateway'

describe('gateway options', () => {
  it('keeps the generic gateway scoped to lookbook and ritual', () => {
    const options = buildGatewayOptions({ corsOrigin: undefined })

    expect(options.namespace).toEqual(namespacePattern)
    expect(namespacePattern.test('/lookbook')).toBe(true)
    expect(namespacePattern.test('/ritual')).toBe(true)
    expect(namespacePattern.test('/alert:weather')).toBe(false)
  })

  it('uses a static alert namespace', () => {
    expect(buildAlertGatewayOptions().namespace).toBe('/alert:weather')
  })

  it('builds CORS origins from env list', () => {
    const options = buildGatewayOptions({
      corsOrigin: 'http://localhost:3000, https://app.example.com',
    })

    expect(options.cors).toMatchObject({
      origin: ['http://localhost:3000', 'https://app.example.com'],
      credentials: true,
    })
  })
})

describe('auth middleware', () => {
  it('rejects connections without a token', async () => {
    const identity = { resolveUserId: vi.fn() }
    const middleware = createAuthMiddleware(identity)
    const next = vi.fn()

    middleware({ handshake: { auth: {} } } as unknown as Socket, next)

    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(expect.any(Error)))
    expect(identity.resolveUserId).not.toHaveBeenCalled()
  })

  it('rejects invalid tokens', async () => {
    const identity = {
      resolveUserId: vi.fn().mockRejectedValue(new Error('invalid token')),
    }
    const middleware = createAuthMiddleware(identity)
    const next = vi.fn()

    middleware(
      {
        handshake: { auth: { token: 'bad' }, headers: {} },
        data: {},
      } as unknown as Socket,
      next
    )

    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(expect.any(Error)))
  })

  it('uses the verified identity and ignores a spoofed handshake user id', async () => {
    const identity = { resolveUserId: vi.fn().mockResolvedValue('verified-user') }
    const middleware = createAuthMiddleware(identity)
    const next = vi.fn()
    const socket = {
      handshake: {
        auth: { token: 'abc', userId: 'spoofed-user' },
        headers: {},
      },
      data: {},
    } as unknown as Socket

    middleware(socket, next)

    await vi.waitFor(() => expect(next).toHaveBeenCalledWith())
    expect(socket.data).toEqual({ userId: 'verified-user' })
  })

  it('accepts a verified token via Authorization header', async () => {
    const identity = { resolveUserId: vi.fn().mockResolvedValue('verified-user') }
    const middleware = createAuthMiddleware(identity)
    const next = vi.fn()

    middleware(
      {
        handshake: { auth: {}, headers: { authorization: 'Bearer xyz' } },
        data: {},
      } as unknown as Socket,
      next
    )

    await vi.waitFor(() => expect(next).toHaveBeenCalledWith())
  })
})

describe('EventsGateway', () => {
  it('registers verified auth middleware on init', () => {
    const logger = pino({ level: 'silent' })
    const manager = new ConnectionManager(logger)
    const identity = { resolveUserId: vi.fn() }
    const gateway = new EventsGateway(manager, logger, identity as never)
    const middlewareCalls: Parameters<Server['use']>[0][] = []
    const server = {
      use(fn: Parameters<Server['use']>[0]) {
        middlewareCalls.push(fn)
        return this as unknown as Server
      },
    } as unknown as Server

    gateway.afterInit(server)

    expect(middlewareCalls).toHaveLength(1)
    expect(typeof middlewareCalls[0]).toBe('function')
  })
})

describe('AlertWeatherGateway', () => {
  it('joins a verified user to the server-owned room', async () => {
    const logger = pino({ level: 'silent' })
    const manager = new ConnectionManager(logger)
    const identity = { resolveUserId: vi.fn() }
    const gateway = new AlertWeatherGateway(manager, logger, identity as never)
    const join = vi.fn().mockResolvedValue(undefined)
    const socket = {
      id: 'socket-1',
      data: { userId: 'verified-user' },
      handshake: { auth: { userId: 'spoofed-user' }, headers: {}, query: {} },
      nsp: { name: '/alert:weather' },
      join,
    } as unknown as Socket

    await gateway.handleConnection(socket)

    expect(join).toHaveBeenCalledWith(alertUserRoom('verified-user'))
  })

  it('emits weather alerts only through the target user room', () => {
    const logger = pino({ level: 'silent' })
    const manager = new ConnectionManager(logger)
    const identity = { resolveUserId: vi.fn() }
    const gateway = new AlertWeatherGateway(manager, logger, identity as never)
    const emit = vi.fn()
    const to = vi.fn().mockReturnValue({ emit })
    const broadcast = vi.fn()
    gateway.server = { to, emit: broadcast } as unknown as Namespace
    const event = {
      version: '1',
      timestamp: '2026-07-13T14:30:00.000Z',
      userId: 'verified-user',
      data: {
        alertType: 'severe' as const,
        location: 'New York',
        message: 'Severe weather warning.',
        severity: 'critical' as const,
      },
    }

    gateway.emitWeatherAlert('verified-user', event)

    expect(to).toHaveBeenCalledWith(alertUserRoom('verified-user'))
    expect(emit).toHaveBeenCalledWith('alert:weather', event)
    expect(broadcast).not.toHaveBeenCalled()
  })
})

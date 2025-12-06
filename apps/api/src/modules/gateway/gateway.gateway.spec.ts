import { describe, expect, it, vi } from 'vitest'
import type { Server, Socket } from 'socket.io'

import {
  EventsGateway,
  buildGatewayOptions,
  createAuthMiddleware,
  namespacePattern,
} from './gateway.gateway'

describe('gateway options', () => {
  it('uses namespace pattern for lookbook/ritual/alert', () => {
    const options = buildGatewayOptions({ corsOrigin: undefined })

    expect(options.namespace).toEqual(namespacePattern)
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
  it('rejects connections without a token', () => {
    const middleware = createAuthMiddleware()
    const next = vi.fn()

    middleware({ handshake: { auth: {} } } as unknown as Socket, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
  })

  it('accepts token via auth payload', () => {
    const middleware = createAuthMiddleware()
    const next = vi.fn()

    middleware(
      { handshake: { auth: { token: 'abc' }, headers: {} } } as unknown as Socket,
      next
    )

    expect(next).toHaveBeenCalledWith()
  })

  it('accepts token via Authorization header', () => {
    const middleware = createAuthMiddleware()
    const next = vi.fn()

    middleware(
      {
        handshake: { auth: {}, headers: { authorization: 'Bearer xyz' } },
      } as unknown as Socket,
      next
    )

    expect(next).toHaveBeenCalledWith()
  })
})

describe('EventsGateway', () => {
  it('registers auth middleware on init', () => {
    const gateway = new EventsGateway()
    const middlewareCalls: Parameters<Server['use']>[0][] = []
    const server = {
      use(fn: Parameters<Server['use']>[0]) {
        middlewareCalls.push(fn)
      },
    }

    gateway.afterInit(server)

    expect(middlewareCalls).toHaveLength(1)
    expect(typeof middlewareCalls[0]).toBe('function')
  })
})

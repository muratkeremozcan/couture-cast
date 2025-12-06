import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { Server, Socket } from 'socket.io'

import { ConnectionManager } from './connection-manager.service'
import { EventsGateway } from './gateway.gateway'

type MockSocket = Pick<Socket, 'id' | 'emit' | 'handshake' | 'nsp'> & {
  data?: Record<string, unknown>
}

const baseSocket = (): MockSocket => ({
  id: 'socket-1',
  emit: vi.fn(),
  nsp: { name: '/lookbook' } as unknown as Socket['nsp'],
  handshake: {
    auth: { token: 'token-123', userId: 'user-42' },
    headers: { 'x-request-id': 'req-abc', authorization: 'Bearer token-123' },
    query: {},
    time: new Date().toISOString(),
    address: '::1',
    xdomain: false,
    secure: false,
    issued: Date.now(),
    url: '/',
  },
})

describe('ConnectionManager', () => {
  it('tracks retries with exponential backoff and activates fallback after max attempts', () => {
    const logger = pino({ level: 'silent' })
    const manager = new ConnectionManager(logger)
    const socket = baseSocket()
    const retryCounts = (manager as unknown as { retryCounts: Map<string, number> })
      .retryCounts

    manager.handleConnect(socket as Socket)

    const attempt1 = manager.handleDisconnect(socket as Socket)
    const attempt2 = manager.handleDisconnect(socket as Socket)
    const attempt3 = manager.handleDisconnect(socket as Socket)
    const attempt4 = manager.handleDisconnect(socket as Socket)
    const attempt5 = manager.handleDisconnect(socket as Socket)
    const attempt6 = manager.handleDisconnect(socket as Socket)

    expect(attempt1).toMatchObject({ shouldRetry: true, delayMs: 1000, attempt: 1 })
    expect(attempt2).toMatchObject({ shouldRetry: true, delayMs: 3000, attempt: 2 })
    expect(attempt3).toMatchObject({ shouldRetry: true, delayMs: 9000, attempt: 3 })
    expect(attempt4).toMatchObject({ shouldRetry: true, delayMs: 9000, attempt: 4 })
    expect(attempt5).toMatchObject({ shouldRetry: true, delayMs: 9000, attempt: 5 })
    expect(attempt6.shouldRetry).toBe(false)
    expect(attempt6.activatePolling).toBe(true)
    expect(retryCounts.has(socket.id)).toBe(false)
  })

  it('resets retry count on reconnect and logs structured fields', () => {
    const logger = pino({ level: 'silent' })
    const infoSpy = vi.spyOn(logger, 'info')
    const manager = new ConnectionManager(logger)
    const socket = baseSocket()

    manager.handleDisconnect(socket as Socket)
    manager.handleConnect(socket as Socket)

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-abc',
        userId: 'user-42',
        namespace: '/lookbook',
      }),
      'socket_connected'
    )
  })
})

describe('EventsGateway lifecycle', () => {
  it('emits retry metadata and fallback events on disconnects', () => {
    const logger = pino({ level: 'silent' })
    const warnSpy = vi.spyOn(logger, 'warn')
    const manager = new ConnectionManager(logger)
    const gateway = new EventsGateway(manager, logger)
    const socket = baseSocket()

    const server = { use: vi.fn() } satisfies Pick<Server, 'use'>
    gateway.afterInit(server as unknown as Server)
    gateway.handleConnection(socket as Socket)

    const first = gateway.handleDisconnect(socket as Socket)
    const second = gateway.handleDisconnect(socket as Socket)
    const third = gateway.handleDisconnect(socket as Socket)
    const fourth = gateway.handleDisconnect(socket as Socket)
    const fifth = gateway.handleDisconnect(socket as Socket)
    const sixth = gateway.handleDisconnect(socket as Socket)

    expect(first?.payload).toMatchObject({ delayMs: 1000, attempt: 1 })
    expect(second?.payload).toMatchObject({ delayMs: 3000, attempt: 2 })
    expect(third?.payload).toMatchObject({ delayMs: 9000, attempt: 3 })
    expect(fourth?.payload).toMatchObject({ delayMs: 9000, attempt: 4 })
    expect(fifth?.payload).toMatchObject({ delayMs: 9000, attempt: 5 })
    expect(sixth?.event).toBe('connection:fallback')
    expect(socket.emit).toHaveBeenCalledWith('connection:retry', first?.payload)
    expect(socket.emit).toHaveBeenCalledWith('connection:retry', second?.payload)
    expect(socket.emit).toHaveBeenCalledWith('connection:retry', third?.payload)
    expect(socket.emit).toHaveBeenCalledWith('connection:retry', fourth?.payload)
    expect(socket.emit).toHaveBeenCalledWith('connection:retry', fifth?.payload)
    expect(socket.emit).toHaveBeenCalledWith('connection:fallback', sixth?.payload)
    expect(warnSpy).toHaveBeenCalled()
  })
})

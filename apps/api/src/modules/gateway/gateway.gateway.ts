import { Inject } from '@nestjs/common'
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets'
import type { Logger } from 'pino'
import type { Server, Socket, ExtendedError } from 'socket.io'
import { createBaseLogger } from '../../logger/pino.config'
// Value import required so Nest can reflect the provider token
import { ConnectionManager, type DisconnectResult } from './connection-manager.service'

/**
 * Story 0.5 (Tasks 1-5): realtime + push integration overview.
 *
 * Realtime gateway handles low-latency delivery for active sessions, while push notifications
 * cover background/offline delivery. If realtime remains unstable, clients fall back to polling.
 *
 * Problems solved:
 * - Latency: socket channels deliver updates faster than request/response polling.
 * - Reliability: retry + backoff absorbs temporary network drops.
 * - Offline fallback: explicit polling activation keeps event delivery available.
 *
 * Setup flow:
 * 1) Apply socket auth middleware so each connection carries a token.
 * 2) Track connect/disconnect lifecycle state in ConnectionManager.
 * 3) Emit retry/fallback hints on disconnect so clients know the next step.
 * 4) Persist push tokens and deliver pushes for users not actively connected.
 * 5) Use polling as the final delivery safety net when realtime is unavailable.
 *
 * Alternatives:
 * - SSE for one-way server updates with lower protocol complexity.
 * - Polling-only architecture with simpler ops but higher latency/load.
 * - Message brokers (for example NATS/Kafka) for larger fan-out and stronger guarantees.
 *
 * Namespaces map to ADR-007 surface areas:
 * - lookbook -> new posts
 * - ritual -> ritual updates
 * - alert -> weather alerts
 */
export const namespacePattern = /^\/(lookbook|ritual|alert)$/

type BuildGatewayOptionsArgs = {
  corsOrigin?: string | string[]
}

type MiddlewareFn = Parameters<Server['use']>[0]
type ServerLike = { use: (fn: MiddlewareFn) => void }
type TokenSocket = Omit<Socket, 'data'> & { data: Record<string, unknown> }

export const GATEWAY_LOGGER = Symbol('GATEWAY_LOGGER')

function parseCorsOrigin(origin?: string | string[]) {
  if (!origin) return true
  if (Array.isArray(origin)) return origin.map((value) => value.trim()).filter(Boolean)

  const entries = origin
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return entries.length ? entries : true
}

export function buildGatewayOptions(config: BuildGatewayOptionsArgs = {}) {
  return {
    namespace: namespacePattern,
    cors: {
      origin: parseCorsOrigin(config.corsOrigin ?? process.env.SOCKET_IO_CORS_ORIGIN),
      credentials: true,
    },
    serveClient: false,
  }
}

function extractAuthToken(socket: Socket) {
  const auth = socket.handshake.auth as Record<string, unknown> | undefined
  const authToken = typeof auth?.token === 'string' ? auth.token : undefined
  const bearer = socket.handshake.headers?.authorization
  const query = socket.handshake.query
  const queryToken =
    typeof query?.token === 'string'
      ? query.token
      : Array.isArray(query?.token)
        ? query.token[0]
        : undefined

  if (typeof authToken === 'string' && authToken.trim()) return authToken
  if (typeof bearer === 'string' && bearer.startsWith('Bearer '))
    return bearer.slice('Bearer '.length)
  if (typeof queryToken === 'string' && queryToken.trim()) return queryToken

  return undefined
}

export function createAuthMiddleware() {
  return (socket: Socket, next: (err?: ExtendedError) => void) => {
    const token = extractAuthToken(socket)

    if (!token) {
      return next(new Error('Missing Socket.io auth token'))
    }

    const tokenSocket = socket as TokenSocket
    const existingData: Record<string, unknown> = tokenSocket.data ?? {}
    tokenSocket.data = { ...existingData, token }
    return next()
  }
}

function emitDisconnectResult(socket: Socket, result: DisconnectResult) {
  // Server-side guidance for client recovery path: retry first, then polling fallback.
  if (result.shouldRetry) {
    const payload = { delayMs: result.delayMs, attempt: result.attempt }
    socket.emit('connection:retry', payload)
    return { event: 'connection:retry', payload }
  }

  // 4) Persist push tokens and deliver pushes for users not actively connected.
  // 5) Use polling as the final delivery safety net when realtime is unavailable.
  const payload = { activatePolling: result.activatePolling, attempt: result.attempt }
  socket.emit('connection:fallback', payload)
  return { event: 'connection:fallback', payload }
}

@WebSocketGateway(buildGatewayOptions())
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    @Inject(ConnectionManager) private readonly connectionManager: ConnectionManager,
    @Inject(GATEWAY_LOGGER) private readonly logger: Logger
  ) {}

  @WebSocketServer()
  server!: Server

  afterInit(server: ServerLike) {
    // 1) Apply socket auth middleware so each connection carries a token.
    server.use(createAuthMiddleware())
  }

  handleConnection(socket: Socket) {
    // 2) Track connect/disconnect lifecycle state in ConnectionManager.
    this.connectionManager.handleConnect(socket)
  }

  handleDisconnect(socket: Socket) {
    // 3) Emit retry/fallback hints on disconnect so clients know the next step.
    const result = this.connectionManager.handleDisconnect(socket)
    this.logger.warn(
      { attempt: result.attempt, namespace: socket.nsp?.name },
      'socket_disconnected'
    )
    return emitDisconnectResult(socket, result)
  }
}

export const gatewayLoggerProvider = {
  provide: GATEWAY_LOGGER,
  useFactory: () =>
    createBaseLogger().child({ feature: 'gateway', loggerName: 'gateway' }),
}

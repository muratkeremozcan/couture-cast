import { alertWeatherEventSchema, type AlertWeatherEvent } from '@couture/api-client'
import { Inject } from '@nestjs/common'
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets'
import type { Logger } from 'pino'
import type { ExtendedError, Namespace, Server, Socket } from 'socket.io'

import { createBaseLogger } from '../../logger/pino.config'
import { AccessTokenIdentityService } from '../auth/access-token-identity.service.js'
import { ConnectionManager, type DisconnectResult } from './connection-manager.service'
import {
  GATEWAY_LOGGER,
  readVerifiedSocketUserId,
  writeVerifiedSocketUserId,
} from './gateway.constants.js'

/**
 * The alert namespace is static so Socket.IO can expose a dedicated, authenticated
 * delivery boundary. Generic realtime surfaces remain on their own namespaces.
 */
export const namespacePattern = /^\/(lookbook|ritual)$/
export const ALERT_NAMESPACE = '/alert:weather'
export const ALERT_WEATHER_EVENT = 'alert:weather'

type BuildGatewayOptionsArgs = {
  corsOrigin?: string | string[]
}

type MiddlewareFn = Parameters<Server['use']>[0]
type ServerLike = { use: (fn: MiddlewareFn) => void }
export type AccessTokenIdentityResolver = Pick<
  AccessTokenIdentityService,
  'resolveUserId'
>

function parseCorsOrigin(origin?: string | string[]) {
  if (!origin) return true
  if (Array.isArray(origin)) return origin.map((value) => value.trim()).filter(Boolean)

  const entries = origin
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return entries.length ? entries : true
}

function buildCorsOptions(config: BuildGatewayOptionsArgs) {
  return {
    origin: parseCorsOrigin(config.corsOrigin ?? process.env.SOCKET_IO_CORS_ORIGIN),
    credentials: true,
  }
}

export function buildGatewayOptions(config: BuildGatewayOptionsArgs = {}) {
  return {
    namespace: namespacePattern,
    cors: buildCorsOptions(config),
    serveClient: false,
  }
}

export function buildAlertGatewayOptions(config: BuildGatewayOptionsArgs = {}) {
  return {
    namespace: ALERT_NAMESPACE,
    cors: buildCorsOptions(config),
    serveClient: false,
  }
}

function extractAuthToken(socket: Socket) {
  const auth = socket.handshake.auth as Record<string, unknown> | undefined
  const authToken = typeof auth?.token === 'string' ? auth.token.trim() : ''
  if (authToken) {
    return authToken
  }

  const authorization: unknown = (
    socket.handshake.headers as Record<string, unknown> | undefined
  )?.authorization
  const header: unknown = Array.isArray(authorization)
    ? (authorization as unknown[])[0]
    : authorization
  const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null
  const bearerToken = match?.[1]?.trim()
  return bearerToken || undefined
}

export function createAuthMiddleware(identityResolver: AccessTokenIdentityResolver) {
  return (socket: Socket, next: (err?: ExtendedError) => void) => {
    const token = extractAuthToken(socket)
    if (!token) {
      next(new Error('Missing Socket.io auth token'))
      return
    }

    void identityResolver
      .resolveUserId(token)
      .then((userId) => {
        socket.data = writeVerifiedSocketUserId(socket.data as unknown, userId)
        next()
      })
      .catch(() => {
        next(new Error('Invalid Socket.io auth token'))
      })
  }
}

function emitDisconnectResult(socket: Socket, result: DisconnectResult) {
  if (result.shouldRetry) {
    const payload = { delayMs: result.delayMs, attempt: result.attempt }
    socket.emit('connection:retry', payload)
    return { event: 'connection:retry', payload }
  }

  const payload = { activatePolling: result.activatePolling, attempt: result.attempt }
  socket.emit('connection:fallback', payload)
  return { event: 'connection:fallback', payload }
}

function handleDisconnect(
  socket: Socket,
  connectionManager: ConnectionManager,
  logger: Logger
) {
  const result = connectionManager.handleDisconnect(socket)
  logger.warn(
    { attempt: result.attempt, namespace: socket.nsp?.name },
    'socket_disconnected'
  )
  return emitDisconnectResult(socket, result)
}

export function alertUserRoom(userId: string) {
  return `alert:user:${userId}`
}

@WebSocketGateway(buildGatewayOptions())
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    @Inject(ConnectionManager) private readonly connectionManager: ConnectionManager,
    @Inject(GATEWAY_LOGGER) private readonly logger: Logger,
    @Inject(AccessTokenIdentityService)
    private readonly identityResolver: AccessTokenIdentityService
  ) {}

  @WebSocketServer()
  server!: Server

  afterInit(server: ServerLike) {
    server.use(createAuthMiddleware(this.identityResolver))
  }

  handleConnection(socket: Socket) {
    this.connectionManager.handleConnect(socket)
  }

  handleDisconnect(socket: Socket) {
    return handleDisconnect(socket, this.connectionManager, this.logger)
  }
}

@WebSocketGateway(buildAlertGatewayOptions())
export class AlertWeatherGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    @Inject(ConnectionManager) private readonly connectionManager: ConnectionManager,
    @Inject(GATEWAY_LOGGER) private readonly logger: Logger,
    @Inject(AccessTokenIdentityService)
    private readonly identityResolver: AccessTokenIdentityService
  ) {}

  @WebSocketServer()
  server!: Namespace

  afterInit(server: ServerLike) {
    server.use(createAuthMiddleware(this.identityResolver))
  }

  async handleConnection(socket: Socket) {
    const userId = readVerifiedSocketUserId(socket.data as unknown)
    if (!userId) {
      socket.disconnect(true)
      return
    }

    await socket.join(alertUserRoom(userId))
    this.connectionManager.handleConnect(socket)
  }

  handleDisconnect(socket: Socket) {
    return handleDisconnect(socket, this.connectionManager, this.logger)
  }

  emitWeatherAlert(userId: string, event: AlertWeatherEvent) {
    const parsedEvent = alertWeatherEventSchema.parse(event)
    if (parsedEvent.userId !== userId) {
      throw new Error('Alert target user does not match event user')
    }

    this.server.to(alertUserRoom(userId)).emit(ALERT_WEATHER_EVENT, parsedEvent)
  }
}

export { GATEWAY_LOGGER } from './gateway.constants.js'

export const gatewayLoggerProvider = {
  provide: GATEWAY_LOGGER,
  useFactory: () =>
    createBaseLogger().child({ feature: 'gateway', loggerName: 'gateway' }),
}

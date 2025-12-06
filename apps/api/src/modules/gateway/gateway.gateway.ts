import type { Server, Socket, ExtendedError } from 'socket.io'
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'

/**
 * Namespaces map to ADR-007 surface areas:
 * - lookbook → new posts
 * - ritual → ritual updates
 * - alert → weather alerts
 */
export const namespacePattern = /^\/(lookbook|ritual|alert)$/

type BuildGatewayOptionsArgs = {
  corsOrigin?: string | string[]
}

type MiddlewareFn = Parameters<Server['use']>[0]
type ServerLike = { use: (fn: MiddlewareFn) => void }
type TokenSocket = Omit<Socket, 'data'> & { data: Record<string, unknown> }

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

@WebSocketGateway(buildGatewayOptions())
export class EventsGateway {
  @WebSocketServer()
  server!: Server

  afterInit(server: ServerLike) {
    server.use(createAuthMiddleware())
  }
}

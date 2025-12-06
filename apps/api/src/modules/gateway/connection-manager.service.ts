import type { Socket } from 'socket.io'
import type { Logger } from 'pino'

export type DisconnectResult =
  | {
      shouldRetry: true
      delayMs: number
      attempt: number
      activatePolling?: false
    }
  | {
      shouldRetry: false
      delayMs?: number
      attempt: number
      activatePolling: true
    }

export type GatewayContext = {
  requestId?: string
  userId?: string
  namespace: string
}

const defaultBackoff = [1000, 3000, 9000]
const defaultMaxRetries = 5

export class ConnectionManager {
  private readonly backoffDelays: number[]
  private readonly maxRetries: number
  private readonly retryCounts = new Map<string, number>()

  constructor(
    private readonly logger: Logger,
    opts?: { backoff?: number[]; maxRetries?: number }
  ) {
    this.backoffDelays = opts?.backoff ?? defaultBackoff
    this.maxRetries = opts?.maxRetries ?? defaultMaxRetries
  }

  get maxRetryAttempts() {
    return this.maxRetries
  }

  handleConnect(socket: Socket): GatewayContext {
    this.retryCounts.set(socket.id, 0)
    const context = this.extractContext(socket)

    this.logger.info(context, 'socket_connected')
    return context
  }

  handleDisconnect(socket: Socket): DisconnectResult {
    const previousAttempts = this.retryCounts.get(socket.id) ?? 0
    const attempt = previousAttempts + 1
    this.retryCounts.set(socket.id, attempt)

    const context = this.extractContext(socket)
    const delayMs =
      this.backoffDelays[Math.min(attempt - 1, this.backoffDelays.length - 1)] ??
      this.backoffDelays[this.backoffDelays.length - 1] ??
      0

    if (attempt > this.maxRetries) {
      this.logger.warn({ ...context, attempt, activatePolling: true }, 'socket_fallback')
      return { shouldRetry: false, attempt, activatePolling: true }
    }

    this.logger.warn({ ...context, attempt, delayMs }, 'socket_disconnected')
    return { shouldRetry: true, delayMs, attempt, activatePolling: false }
  }

  private extractContext(socket: Socket): GatewayContext {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined
    const requestIdHeader = socket.handshake.headers?.['x-request-id']
    const requestIdQuery = socket.handshake.query?.requestId
    const requestId =
      typeof requestIdHeader === 'string'
        ? requestIdHeader
        : typeof requestIdQuery === 'string'
          ? requestIdQuery
          : undefined

    const userId = typeof auth?.userId === 'string' ? auth.userId : undefined

    return {
      requestId,
      userId,
      namespace: socket.nsp?.name ?? 'unknown',
    }
  }
}

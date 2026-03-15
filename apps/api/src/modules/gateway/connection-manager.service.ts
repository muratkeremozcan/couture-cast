import type { Socket } from 'socket.io'
import type { Logger } from 'pino'

/**
 * Story 0.5 owner file: connection lifecycle tracking.
 *
 * Why this exists:
 * - Socket disconnect events are frequent and ambiguous (tab sleep, wifi switch, app background).
 * - We need server-visible retry state to give clients consistent recovery instructions.
 *
 * Reliability model:
 * - Retry with bounded backoff for transient failures.
 * - After max retries, activate polling fallback to preserve delivery continuity.
 *
 * Alternative:
 * - Rely only on client-side auto-reconnect, which is simpler but gives less server control/observability.
 *
 * Ownership anchor:
 * - Story 0.5 Task 2 owner: decide retry vs fallback based on connection lifecycle state.
 *
 * Flow refs:
 * - S0.5/T1: gateway wiring calls into this service on connect/disconnect.
 * - S0.5/T5: once retries are exhausted, the caller activates polling fallback.
 */
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
  // Per-socket lifecycle state used to decide retry vs fallback on disconnect.
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
    // Flow ref S0.5/T2: a new session starts with zero retries.
    this.retryCounts.set(socket.id, 0)
    const context = this.extractContext(socket)

    this.logger.info(context, 'socket_connected')
    return context
  }

  handleDisconnect(socket: Socket): DisconnectResult {
    // Flow ref S0.5/T2: increment attempt state before choosing retry vs fallback.
    const previousAttempts = this.retryCounts.get(socket.id) ?? 0
    const attempt = previousAttempts + 1
    this.retryCounts.set(socket.id, attempt)

    const context = this.extractContext(socket)
    const delayMs =
      this.backoffDelays[Math.min(attempt - 1, this.backoffDelays.length - 1)] ??
      this.backoffDelays[this.backoffDelays.length - 1] ??
      0

    if (attempt > this.maxRetries) {
      this.retryCounts.delete(socket.id)
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

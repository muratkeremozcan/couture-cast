import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { AuthenticatedRequest } from '../modules/auth/security.types'

/** Task 5 (AC #3): request-scoped logging context.
 * Why this exists:
 * - Structured logs need stable request metadata even after execution moves across async boundaries.
 * - HTTP middleware, auth guards, and downstream services all need the same requestId/userId/feature fields.
 * - Reusing inbound request IDs keeps API logs aligned with upstream callers and websocket conventions.
 * Alternatives:
 * - Pass context manually through every service call, which is noisy and easy to miss.
 * - Store fields directly on req only, which does not help code running later outside the immediate handler.
 * Setup steps (where we did this):
 *   1) normalize or generate x-request-id for every request.
 *   2) infer stable feature metadata from the routed path.
 *   3) store request context in AsyncLocalStorage so later logs can read it automatically.
 */
export type RequestContext = {
  feature?: string
  requestId: string
  userId?: string
}

type RequestLike = Pick<Request, 'headers' | 'originalUrl' | 'url'> & {
  auth?: { userId?: string }
  id?: string | number | object
}

const REQUEST_ID_HEADER = 'x-request-id'
const requestContextStorage = new AsyncLocalStorage<RequestContext>()

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return normalizeHeaderValue(value[0])
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

export function resolveRequestId(value?: string | string[]): string {
  // 1) normalize or generate x-request-id for every request.
  return normalizeHeaderValue(value) ?? randomUUID()
}

export function inferFeatureFromPath(path?: string): string {
  // 2) infer stable feature metadata from the routed path.
  if (!path) {
    return 'api'
  }

  const pathname = path.split('?')[0] ?? path
  const segments = pathname.split('/').filter(Boolean)

  if (segments[0] === 'api' && segments[1] === 'v1') {
    return segments[2] ?? 'api'
  }

  return segments[0] ?? 'api'
}

export function extractUserId(request: RequestLike): string | undefined {
  return request.auth?.userId ?? normalizeHeaderValue(request.headers['x-user-id'])
}

export function createRequestContext(request: RequestLike): RequestContext {
  const requestId =
    typeof request.id === 'string' || typeof request.id === 'number'
      ? String(request.id)
      : resolveRequestId(request.headers[REQUEST_ID_HEADER])

  return {
    requestId,
    userId: extractUserId(request),
    feature: inferFeatureFromPath(request.originalUrl ?? request.url),
  }
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore()
}

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  // 3) store request context in AsyncLocalStorage so later logs can read it automatically.
  return requestContextStorage.run({ ...context }, callback)
}

export function updateRequestContext(context: Partial<RequestContext>) {
  const currentContext = requestContextStorage.getStore()
  if (!currentContext) {
    return
  }

  Object.assign(currentContext, context)
}

export function bindRequestContext(
  request: Request,
  response: Response,
  next: NextFunction
) {
  const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER])
  request.id = requestId
  response.setHeader(REQUEST_ID_HEADER, requestId)

  const authRequest = request as AuthenticatedRequest
  const context = createRequestContext({
    headers: request.headers,
    originalUrl: request.originalUrl,
    url: request.url,
    auth: authRequest.auth,
    id: requestId,
  })

  runWithRequestContext(context, next)
}

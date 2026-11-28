// Step 11 request-context owner: searchable owner anchor
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { AuthenticatedRequest } from '../modules/auth/security.types'
import { COMMUNITY_AUTHORIZATION_BUDGET_MS } from '../modules/community/community-authorization-budget.js'

/** Story 0.7 support file: request-scoped logging context.
 * Why this exists:
 * - Structured logs need stable request metadata even after execution moves across async boundaries.
 * - HTTP middleware, auth guards, and downstream services all need the same requestId/userId/feature fields.
 * - Reusing inbound request IDs keeps API logs aligned with upstream callers and websocket conventions.
 * Alternatives:
 * - Pass context manually through every service call, which is noisy and easy to miss.
 * - Store fields directly on req only, which does not help code running later outside the immediate handler.
 * Flow refs:
 * - S0.7/T5/1: request IDs are normalized once at the boundary instead of per logger call.
 * - S0.7/T5/2: later logs read request metadata from AsyncLocalStorage rather than manual parameter threading.
 */
export type RequestContext = {
  feature?: string
  requestId: string
  userId?: string
  suppressAccountContext?: boolean
  communityAuthorizationDeadline?: number
}

type RequestLike = Pick<Request, 'headers' | 'originalUrl' | 'url'> & {
  auth?: { userId?: string }
  method?: string
  path?: string
  id?: string | number | object
}

const REQUEST_ID_HEADER = 'x-request-id'
const requestContextStorage = new AsyncLocalStorage<RequestContext>()
export const LOOK_IDEAS_ROUTE = '/api/v1/personalization/look-ideas'

export const PHOTO_AI_CONSENT_ROUTE = '/api/v1/privacy/photo-ai-consent'

export function isPrivateAccountRoute(path: string | undefined): boolean {
  const normalized = path?.split('?')[0]?.replace(/\/+$/, '').toLowerCase()
  return (
    normalized === LOOK_IDEAS_ROUTE ||
    normalized === PHOTO_AI_CONSENT_ROUTE ||
    normalized === `${PHOTO_AI_CONSENT_ROUTE}/revoke`
  )
}

export function isPrivateAccountRequest(
  request: Pick<RequestLike, 'path' | 'originalUrl' | 'url'>
) {
  return isPrivateAccountRoute(request.path ?? request.originalUrl ?? request.url)
}

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
  // Flow ref S0.7/T5/1: normalize or generate x-request-id for every request.
  return normalizeHeaderValue(value) ?? randomUUID()
}

export function inferFeatureFromPath(path?: string): string {
  // Flow ref S0.7/T5/2: infer stable feature metadata once so downstream logs
  // reuse the same feature label.
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
  if (isPrivateAccountRequest(request)) return undefined
  return request.auth?.userId ?? normalizeHeaderValue(request.headers['x-user-id'])
}

export function createRequestContext(request: RequestLike): RequestContext {
  const requestId =
    typeof request.id === 'string' || typeof request.id === 'number'
      ? String(request.id)
      : resolveRequestId(request.headers[REQUEST_ID_HEADER])

  const path = (request.originalUrl ?? request.url).split('?')[0] ?? ''
  const communityRead =
    path.startsWith('/api/v1/community/') &&
    (request.method === 'GET' || path.endsWith('/targets/resolve'))
  return {
    requestId,
    ...(isPrivateAccountRequest(request) && { suppressAccountContext: true }),
    ...(communityRead
      ? {
          communityAuthorizationDeadline:
            performance.now() + COMMUNITY_AUTHORIZATION_BUDGET_MS,
        }
      : {}),
    userId: extractUserId(request),
    feature: inferFeatureFromPath(request.originalUrl ?? request.url),
  }
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore()
}

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  // Flow ref S0.7/T5/2: store request context in AsyncLocalStorage so later
  // logs can read it automatically.
  return requestContextStorage.run({ ...context }, callback)
}

export function updateRequestContext(context: Partial<RequestContext>) {
  const currentContext = requestContextStorage.getStore()
  if (!currentContext) {
    return
  }

  Object.assign(currentContext, context)
  if (currentContext.suppressAccountContext) delete currentContext.userId
}

export function bindRequestContext(
  request: Request,
  response: Response,
  next: NextFunction
) {
  const privateRoute = isPrivateAccountRequest(request)
  const requestId = resolveRequestId(
    privateRoute ? undefined : request.headers[REQUEST_ID_HEADER]
  )
  request.id = requestId
  response.setHeader(REQUEST_ID_HEADER, requestId)
  if (privateRoute) {
    response.setHeader('Cache-Control', 'private, no-store')
  }

  const authRequest = request as AuthenticatedRequest
  const context = createRequestContext({
    headers: request.headers,
    method: request.method,
    originalUrl: request.originalUrl,
    path: request.path,
    url: request.url,
    auth: authRequest.auth,
    id: requestId,
  })

  runWithRequestContext(context, next)
}

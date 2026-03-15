import pinoHttp from 'pino-http'
import type { Request, Response } from 'express'
import type { HttpLogger } from 'pino-http'
import type { Logger } from 'pino'
import { createBaseLogger } from './pino.config'
import { extractUserId, inferFeatureFromPath, resolveRequestId } from './request-context'

/** Story 0.7 support file: HTTP request/response logging middleware.
 * Why this exists:
 * - API logs should capture one consistent lifecycle for every HTTP request without repeating code in controllers.
 * - We need request IDs, feature metadata, duration, and user context attached at the HTTP boundary.
 * - `pino-http` gives request/response logging while still using the shared Pino contract from pino.config.ts.
 * Alternatives:
 * - Manual controller/service logging, which misses framework-level failures and duplicates boilerplate.
 * - Nest interceptors only, which still leave request-id generation and HTTP log formatting to custom code.
 * Flow refs:
 * - S0.7/T5/1: attach or reuse x-request-id on the HTTP boundary.
 * - S0.7/T5/2: shape request/response log payloads with feature, path, status, and user context.
 * - S0.7/T5/3: reuse the shared Pino base logger so HTTP logs match the rest of the API log contract.
 */
type EnvVars = Record<string, string | undefined>
type CreateRequestLoggerOptions = {
  env?: EnvVars
  logger?: Logger
}

function extractDurationMs(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = (value as { durationMs?: unknown; responseTime?: unknown }).durationMs
  if (typeof candidate === 'number') {
    return candidate
  }

  const responseTime = (value as { responseTime?: unknown }).responseTime
  return typeof responseTime === 'number' ? responseTime : undefined
}

export function createRequestLoggerMiddleware(
  options: CreateRequestLoggerOptions = {}
): HttpLogger<Request, Response> {
  // Flow ref S0.7/T5/3: reuse the shared Pino base logger so HTTP logs match
  // the rest of the API log contract.
  const env = options.env ?? process.env
  return pinoHttp<Request, Response>({
    logger: options.logger ?? createBaseLogger({ env }),
    customAttributeKeys: {
      req: 'request',
      res: 'response',
      err: 'error',
      reqId: 'requestId',
      responseTime: 'durationMs',
    },
    genReqId(request, response) {
      // Flow ref S0.7/T5/1: attach or reuse x-request-id on the HTTP boundary.
      const requestId = resolveRequestId(request.headers['x-request-id'])
      request.id = requestId
      response.setHeader('x-request-id', requestId)
      return requestId
    },
    customReceivedMessage() {
      return 'request_received'
    },
    customSuccessMessage() {
      return 'request_completed'
    },
    customErrorMessage() {
      return 'request_failed'
    },
    customReceivedObject(request) {
      // Flow ref S0.7/T5/2: shape request/response log payloads with feature,
      // path, status, and user context.
      return {
        feature: inferFeatureFromPath(request.originalUrl ?? request.url),
        method: request.method,
        path: request.originalUrl ?? request.url,
      }
    },
    customSuccessObject(request, response, value) {
      return {
        durationMs: extractDurationMs(value),
        feature: inferFeatureFromPath(request.originalUrl ?? request.url),
        method: request.method,
        path: request.originalUrl ?? request.url,
        statusCode: response.statusCode,
        userId: extractUserId(request),
      }
    },
    customErrorObject(request, response, error, value) {
      return {
        durationMs: extractDurationMs(value),
        error,
        feature: inferFeatureFromPath(request.originalUrl ?? request.url),
        method: request.method,
        path: request.originalUrl ?? request.url,
        statusCode: response.statusCode,
        userId: extractUserId(request),
      }
    },
    quietReqLogger: true,
    quietResLogger: true,
  })
}

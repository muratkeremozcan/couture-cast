import express from 'express'
import request from 'supertest'
import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { AuthenticatedRequest } from '../modules/auth/security.types'
import { bindRequestContext, updateRequestContext } from './request-context'
import { createBaseLogger } from './pino.config'
import { createRequestLoggerMiddleware } from './request-logger.middleware'

class MemoryStream extends Writable {
  readonly chunks: string[] = []

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    this.chunks.push(chunk.toString())
    callback()
  }
}

function parseLogs(stream: MemoryStream) {
  return stream.chunks
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => JSON.parse(entry) as Record<string, unknown>)
}

describe('request-logger middleware', () => {
  it('logs request/response lifecycle and returns an x-request-id header', async () => {
    const stream = new MemoryStream()
    const app = express()
    const env = { LOG_LEVEL: 'info' }
    const logger = createBaseLogger({ destination: stream, env })
    const httpLogger = createRequestLoggerMiddleware({ env, logger })

    app.use(bindRequestContext)
    app.use(httpLogger)
    app.use((req, _res, next) => {
      const authenticatedRequest = req as AuthenticatedRequest
      authenticatedRequest.auth = {
        role: 'guardian',
        token: 'token-123',
        userId: 'guardian-123',
      }
      updateRequestContext({ userId: authenticatedRequest.auth.userId })
      next()
    })
    app.get('/api/v1/auth/guardian-consent', (_req, res) => {
      res.status(200).json({ tracked: true })
    })

    const response = await request(app).get('/api/v1/auth/guardian-consent')

    expect(response.status).toBe(200)
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )

    const logs = parseLogs(stream)
    expect(logs).toHaveLength(2)
    expect(logs[0]).toMatchObject({
      feature: 'auth',
      message: 'request_received',
      path: '/api/v1/auth/guardian-consent',
      requestId: response.headers['x-request-id'],
    })
    expect(logs[1]).toMatchObject({
      feature: 'auth',
      message: 'request_completed',
      requestId: response.headers['x-request-id'],
      statusCode: 200,
      userId: 'guardian-123',
    })
    expect(logs[1]?.durationMs).toEqual(expect.any(Number))
  })
})

// Learning path Step 11: API observability with structured logging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-11-api-observability-with-structured-logging
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Step 80 covers private telemetry on the look ideas route.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-80-ai-written-look-ideas
// Learning path Step 81: Photo AI consent and processor approval.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-81-photo-ai-consent-and-processor-approval
import express from 'express'
import request from 'supertest'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthenticatedRequest } from '../modules/auth/security.types'
import {
  bindRequestContext,
  LOOK_IDEAS_ROUTE,
  updateRequestContext,
} from './request-context'
import { createBaseLogger } from './pino.config'
import { createRequestLoggerMiddleware } from './request-logger.middleware'
import { listenHttpHandler } from '../testing/loopback-http-app.js'

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
  const listening: (() => Promise<void>)[] = []
  afterEach(async () => {
    await Promise.all(listening.splice(0).map((close) => close()))
  })
  /** Binds the app on 127.0.0.1 and returns its URL for supertest. */
  async function serve(app: express.Express) {
    const served = await listenHttpHandler(app)
    listening.push(served.close)
    return served.url
  }

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

    const response = await request(await serve(app)).get('/api/v1/auth/guardian-consent')

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

  it('strips query values from logged paths', async () => {
    const stream = new MemoryStream()
    const app = express()
    const env = { LOG_LEVEL: 'info' }
    const logger = createBaseLogger({ destination: stream, env })

    app.use(createRequestLoggerMiddleware({ env, logger }))
    app.get('/api/v1/wardrobe/garments', (_req, res) => {
      res.status(200).json({ data: [] })
    })

    await request(await serve(app)).get('/api/v1/wardrobe/garments?token=secret')

    const logs = parseLogs(stream)
    expect(logs).toHaveLength(2)
    for (const log of logs) {
      expect(log.path).toBe('/api/v1/wardrobe/garments')
      expect(JSON.stringify(log)).not.toContain('token=secret')
    }
  })

  it.each(['path', 'parsed URL'])(
    'keeps look-ideas account and content fields out of %s error and outcome logs',
    async (form) => {
      const stream = new MemoryStream()
      const app = express()
      const env = { LOG_LEVEL: 'info' }
      const logger = createBaseLogger({ destination: stream, env })
      const generation = createBaseLogger({
        destination: stream,
        env: { NODE_ENV: 'production' },
        includeRequestMetadata: false,
        productionLevel: 'info',
      })

      if (form === 'parsed URL') {
        app.use((req, _res, next) => {
          req.originalUrl = new URL(req.originalUrl, 'https://fixture.invalid').href
          next()
        })
      }
      app.use(bindRequestContext)
      app.use(createRequestLoggerMiddleware({ env, logger }))
      app.post(LOOK_IDEAS_ROUTE, (req, res) => {
        const authenticated = req as AuthenticatedRequest
        authenticated.auth = {
          role: 'guardian',
          token: 'synthetic-look-token',
          userId: 'synthetic-look-account',
        }
        updateRequestContext({ userId: authenticated.auth.userId })
        generation.info(
          { outcome: 'unavailable', durationMs: 5 },
          'look_ideas_generation'
        )
        res.status(503).json({ message: 'synthetic-response-detail' })
      })

      const response = await request(await serve(app))
        .post(`${LOOK_IDEAS_ROUTE}?city=synthetic-location`)
        .set('x-user-id', 'synthetic-header-member')
        .set('x-request-id', 'synthetic-request-id')
        .send({ note: 'synthetic-request-content' })
        .expect(503)
        .expect('Cache-Control', 'private, no-store')
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i)

      const logs = parseLogs(stream)
      expect(logs).toHaveLength(3)
      const outcome = logs.find(({ message }) => message === 'look_ideas_generation')
      expect(outcome).toMatchObject({
        outcome: 'unavailable',
        durationMs: 5,
      })
      expect(outcome).not.toHaveProperty('requestId')
      for (const log of logs) {
        expect(log).not.toHaveProperty('userId')
        expect(log).not.toHaveProperty('error')
        expect(JSON.stringify(log)).not.toContain('synthetic-')
      }
    }
  )

  it.each([200, 503])(
    'keeps photo AI revocation identifiers out of %i logs',
    async (status) => {
      const path = '/api/v1/privacy/photo-ai-consent'
      const grant = 'cb6499c1-b8f1-4199-8891-ee5161829c21'
      const stream = new MemoryStream()
      const app = express()
      const env = { LOG_LEVEL: 'info' }
      const logger = createBaseLogger({ destination: stream, env })
      app.use(bindRequestContext)
      app.use(createRequestLoggerMiddleware({ env, logger }))
      app.post(`${path}/revoke`, (req, res) => {
        const authenticated = req as AuthenticatedRequest
        authenticated.auth = {
          role: 'teen',
          token: 'synthetic-photo-bearer',
          userId: 'synthetic-photo-member',
        }
        updateRequestContext({ userId: authenticated.auth.userId })
        res.status(status).json({ detail: 'synthetic-photo-detail' })
      })

      await request(await serve(app))
        .post(`${path}/revoke?objectKey=synthetic-photo-object`)
        .set('x-user-id', 'synthetic-photo-header')
        .set('x-request-id', 'synthetic-photo-correlation')
        .send({ grantId: grant })
        .expect(status)

      const logs = parseLogs(stream)
      expect(logs).toHaveLength(2)
      expect(logs[0]).toMatchObject({ message: 'request_received', method: 'POST' })
      expect(logs[1]).toMatchObject({ statusCode: status })
      for (const log of logs) {
        expect(log).not.toHaveProperty('userId')
        expect(log).not.toHaveProperty('error')
        expect(JSON.stringify(log)).not.toContain(grant)
        expect(JSON.stringify(log)).not.toContain('synthetic-photo-')
      }
    }
  )
})

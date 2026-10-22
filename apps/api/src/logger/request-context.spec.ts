// Learning path Step 11: API observability with structured logging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-11-api-observability-with-structured-logging
import { describe, expect, it } from 'vitest'
import {
  createRequestContext,
  extractUserId,
  inferFeatureFromPath,
  resolveRequestId,
  runWithRequestContext,
  updateRequestContext,
  getRequestContext,
} from './request-context'

describe('request-context', () => {
  it('reuses an inbound request id when present', () => {
    expect(resolveRequestId('req-123')).toBe('req-123')
  })

  it('generates a UUID when request id is missing', () => {
    expect(resolveRequestId(undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  })

  it('infers a feature from versioned api paths', () => {
    expect(inferFeatureFromPath('/api/v1/auth/guardian-consent')).toBe('auth')
    expect(inferFeatureFromPath('/api/v1')).toBe('api')
  })

  it('prefers authenticated user context over headers', () => {
    expect(
      extractUserId({
        auth: { userId: 'guardian-123' },
        headers: { 'x-user-id': 'header-user' },
        originalUrl: '/api/v1/auth/guardian-consent',
        url: '/api/v1/auth/guardian-consent',
      })
    ).toBe('guardian-123')
  })

  it('isolates and updates async request context', async () => {
    const first = runWithRequestContext(
      {
        feature: 'auth',
        requestId: 'req-1',
      },
      () => {
        updateRequestContext({ userId: 'guardian-123' })
        return Promise.resolve(getRequestContext())
      }
    )

    const second = runWithRequestContext(
      {
        feature: 'events',
        requestId: 'req-2',
      },
      () => Promise.resolve(getRequestContext())
    )

    await expect(first).resolves.toMatchObject({
      feature: 'auth',
      requestId: 'req-1',
      userId: 'guardian-123',
    })
    await expect(second).resolves.toMatchObject({
      feature: 'events',
      requestId: 'req-2',
    })
  })

  it('creates request context from route and auth state', () => {
    expect(
      createRequestContext({
        auth: { userId: 'guardian-123' },
        headers: {},
        id: 'req-99',
        originalUrl: '/api/v1/auth/guardian-consent',
        url: '/api/v1/auth/guardian-consent',
      })
    ).toEqual({
      feature: 'auth',
      requestId: 'req-99',
      userId: 'guardian-123',
    })
  })

  it('uses the first value of a repeated request id header', () => {
    expect(resolveRequestId([' req-first ', 'req-second'])).toBe('req-first')
  })

  it('generates a request id when the inbound header is blank', () => {
    expect(resolveRequestId('   ')).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('infers a feature from unversioned and empty paths', () => {
    expect(inferFeatureFromPath(undefined)).toBe('api')
    expect(inferFeatureFromPath('/health?probe=1')).toBe('health')
    expect(inferFeatureFromPath('/api/v2/events')).toBe('api')
    expect(inferFeatureFromPath('/')).toBe('api')
  })

  it('falls back to the user id header when the request is not authenticated', () => {
    expect(
      extractUserId({
        headers: { 'x-user-id': ' header-user ' },
        originalUrl: '/api/v1/events',
        url: '/api/v1/events',
      })
    ).toBe('header-user')
  })

  it('stringifies a numeric request id and reads the header when no id is set', () => {
    expect(
      createRequestContext({
        headers: {},
        id: 42,
        originalUrl: '/health',
        url: '/health',
      })
    ).toMatchObject({ requestId: '42', feature: 'health' })
    expect(
      createRequestContext({
        headers: { 'x-request-id': 'inbound-7' },
        originalUrl: '/health',
        url: '/health',
      }).requestId
    ).toBe('inbound-7')
  })

  it('gives community reads, and only them, an authorization deadline', () => {
    const context = (method: string, path: string) =>
      createRequestContext({ headers: {}, method, originalUrl: path, url: path })
    const before = performance.now()
    const read = context('GET', '/api/v1/community/feed?cursor=1')
    expect(read.communityAuthorizationDeadline).toBeGreaterThanOrEqual(before + 1950)
    expect(read.communityAuthorizationDeadline).toBeLessThanOrEqual(
      performance.now() + 1950
    )
    expect(
      context('POST', '/api/v1/community/targets/resolve').communityAuthorizationDeadline
    ).toBeDefined()
    expect(
      context('POST', '/api/v1/community/posts/p1/reactions')
        .communityAuthorizationDeadline
    ).toBeUndefined()
    expect(
      context('GET', '/api/v1/ritual').communityAuthorizationDeadline
    ).toBeUndefined()
  })

  it('ignores context updates outside a request', () => {
    expect(() => updateRequestContext({ userId: 'nobody' })).not.toThrow()
    expect(getRequestContext()).toBeUndefined()
  })
})

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
})

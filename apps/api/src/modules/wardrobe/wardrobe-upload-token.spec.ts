import { afterEach, describe, expect, it } from 'vitest'
import {
  generateUploadToken,
  requireUploadTokenSecret,
  verifyUploadToken,
} from './wardrobe-upload-token'

describe('wardrobe upload token', () => {
  const originalSecret = process.env.WARDROBE_UPLOAD_TOKEN_SECRET
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.WARDROBE_UPLOAD_TOKEN_SECRET = originalSecret
    process.env.NODE_ENV = originalNodeEnv
  })

  it('generates a token that verifies for its exact inputs and rejects any single changed input', () => {
    const secret = 'a'.repeat(32)
    const token = generateUploadToken(
      'session-1',
      'user-1',
      '2026-08-09T10:00:00.000Z',
      secret
    )

    expect(
      verifyUploadToken(token, 'session-1', 'user-1', '2026-08-09T10:00:00.000Z', secret)
    ).toBe(true)
    expect(
      verifyUploadToken(token, 'session-2', 'user-1', '2026-08-09T10:00:00.000Z', secret)
    ).toBe(false)
    expect(
      verifyUploadToken(token, 'session-1', 'user-2', '2026-08-09T10:00:00.000Z', secret)
    ).toBe(false)
    expect(
      verifyUploadToken(token, 'session-1', 'user-1', '2026-08-09T11:00:00.000Z', secret)
    ).toBe(false)
    expect(
      verifyUploadToken(
        token,
        'session-1',
        'user-1',
        '2026-08-09T10:00:00.000Z',
        'b'.repeat(32)
      )
    ).toBe(false)
  })

  describe('requireUploadTokenSecret', () => {
    it('returns the configured secret when it is at least 32 characters', () => {
      process.env.WARDROBE_UPLOAD_TOKEN_SECRET = 'x'.repeat(32)
      expect(requireUploadTokenSecret()).toBe('x'.repeat(32))
    })

    it('falls back to the test-only secret in an allowed test environment', () => {
      process.env.WARDROBE_UPLOAD_TOKEN_SECRET = undefined
      process.env.NODE_ENV = 'test'
      expect(requireUploadTokenSecret()).toBe('test-only-wardrobe-upload-token-secret')
    })

    it('throws outside a test environment with no configured secret', () => {
      process.env.WARDROBE_UPLOAD_TOKEN_SECRET = undefined
      process.env.NODE_ENV = 'production'
      expect(() => requireUploadTokenSecret()).toThrow(
        'WARDROBE_UPLOAD_TOKEN_SECRET must contain at least 32 characters'
      )
    })
  })
})

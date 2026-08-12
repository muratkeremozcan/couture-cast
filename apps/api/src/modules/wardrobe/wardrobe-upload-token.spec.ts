// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
import { afterEach, describe, expect, it } from 'vitest'
import {
  generateUploadToken,
  requireUploadTokenSecret,
  verifyUploadToken,
} from './wardrobe-upload-token'

describe('verifyUploadToken byte-length safety', () => {
  it('4.4-UNIT-02 rejects a multi-byte token instead of throwing a RangeError', () => {
    const secret = 'x'.repeat(32)
    const expected = generateUploadToken('session-1', 'user-1', 'expiry', secret)
    // Same code-point length as the real token, different byte length: the
    // string-length guard let this through to `timingSafeEqual`, which throws
    // a RangeError on mismatched buffer lengths -- a 500 for a forged token.
    const multiByte = 'é'.repeat(expected.length)

    expect(() =>
      verifyUploadToken(multiByte, 'session-1', 'user-1', 'expiry', secret)
    ).not.toThrow()
    expect(verifyUploadToken(multiByte, 'session-1', 'user-1', 'expiry', secret)).toBe(
      false
    )
  })
})

describe('wardrobe upload token', () => {
  const originalSecret = process.env.WARDROBE_UPLOAD_TOKEN_SECRET
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    // Direct assignment is not a safe restore: `process.env.X = undefined`
    // coerces to the *string* `"undefined"` rather than deleting the key, so
    // a test that starts from an unset variable must delete it explicitly to
    // avoid leaking a truthy-but-bogus value into later tests/files.
    if (originalSecret === undefined) delete process.env.WARDROBE_UPLOAD_TOKEN_SECRET
    else process.env.WARDROBE_UPLOAD_TOKEN_SECRET = originalSecret
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
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
      delete process.env.WARDROBE_UPLOAD_TOKEN_SECRET
      process.env.NODE_ENV = 'test'
      expect(requireUploadTokenSecret()).toBe('test-only-wardrobe-upload-token-secret')
    })

    it('throws outside a test environment with no configured secret', () => {
      delete process.env.WARDROBE_UPLOAD_TOKEN_SECRET
      process.env.NODE_ENV = 'production'
      expect(() => requireUploadTokenSecret()).toThrow(
        'WARDROBE_UPLOAD_TOKEN_SECRET must contain at least 32 characters'
      )
    })
  })
})

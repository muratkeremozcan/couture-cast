// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mintClickToken, requireClickTokenSecret } from './commerce-click-token.js'

describe('commerce click token', () => {
  const originalSecret = process.env.COMMERCE_CLICK_TOKEN_SECRET
  const originalNodeEnv = process.env.NODE_ENV
  const originalTestEnv = process.env.TEST_ENV

  beforeEach(() => {
    delete process.env.COMMERCE_CLICK_TOKEN_SECRET
  })

  afterEach(() => {
    process.env.COMMERCE_CLICK_TOKEN_SECRET = originalSecret
    process.env.NODE_ENV = originalNodeEnv
    process.env.TEST_ENV = originalTestEnv
    if (originalSecret === undefined) {
      delete process.env.COMMERCE_CLICK_TOKEN_SECRET
    }
    if (originalTestEnv === undefined) {
      delete process.env.TEST_ENV
    }
  })

  describe('requireClickTokenSecret', () => {
    it('uses a configured secret of at least 32 characters', () => {
      process.env.COMMERCE_CLICK_TOKEN_SECRET = 'a'.repeat(32)

      expect(requireClickTokenSecret()).toBe('a'.repeat(32))
    })

    it('trims surrounding whitespace before measuring the length', () => {
      process.env.COMMERCE_CLICK_TOKEN_SECRET = `  ${'b'.repeat(32)}  `

      expect(requireClickTokenSecret()).toBe('b'.repeat(32))
    })

    it('falls back to the test-only secret when the configured one is too short', () => {
      process.env.COMMERCE_CLICK_TOKEN_SECRET = 'too-short'

      expect(requireClickTokenSecret()).toBe('test-only-commerce-click-token-secret')
    })

    it('falls back to the test-only secret when none is configured', () => {
      expect(requireClickTokenSecret()).toBe('test-only-commerce-click-token-secret')
    })

    it('refuses to invent a secret outside test and local environments', () => {
      process.env.NODE_ENV = 'production'
      process.env.TEST_ENV = 'preview'

      expect(() => requireClickTokenSecret()).toThrow(
        'COMMERCE_CLICK_TOKEN_SECRET must contain at least 32 characters'
      )
    })
  })

  describe('mintClickToken', () => {
    const secret = 'c'.repeat(32)

    it('is an HMAC-SHA256 over the row id, base64url encoded', () => {
      expect(mintClickToken('click-1', secret)).toBe(
        createHmac('sha256', secret).update('click-1').digest('base64url')
      )
    })

    it('produces only URL-safe characters, so no percent-encoding is needed', () => {
      for (const id of [
        'click-1',
        'click-2',
        'a'.repeat(64),
        '00000000-0000-4000-8000-000000000000',
      ]) {
        expect(mintClickToken(id, secret)).toMatch(/^[A-Za-z0-9_-]+$/)
      }
    })

    it('is deterministic for the same id and secret', () => {
      expect(mintClickToken('click-1', secret)).toBe(mintClickToken('click-1', secret))
    })

    it('does not reveal the row id', () => {
      expect(mintClickToken('click-1', secret)).not.toContain('click-1')
    })

    it('changes with the id and with the secret', () => {
      expect(mintClickToken('click-1', secret)).not.toBe(
        mintClickToken('click-2', secret)
      )
      expect(mintClickToken('click-1', secret)).not.toBe(
        mintClickToken('click-1', 'd'.repeat(32))
      )
    })
  })
})

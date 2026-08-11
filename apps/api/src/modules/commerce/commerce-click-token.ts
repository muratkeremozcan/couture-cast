import { createHmac } from 'node:crypto'
import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'

/**
 * Story 5.1 decision 7: the client-facing click token.
 *
 * `AffiliateClick.id` never leaves this process. What reaches a partner URL, and
 * what the conversion webhook joins on, is an HMAC-SHA256 over that id. A raw
 * cuid in a third-party URL, combined with the webhook's "an unknown token still
 * returns 200" rule, would let any holder of a partner secret attribute revenue
 * to guessed identifiers.
 *
 * The secret-resolution shape is deliberately identical to
 * `requireUploadTokenSecret` in `wardrobe-upload-token.ts`: a >= 32 character
 * guard, then an `allowsTestOnlySecrets()` fallback so local runs and the test
 * suite work without a real secret, then a hard failure. Copying that shape
 * rather than inventing one keeps every signing path in this API auditable in
 * the same way.
 */
export function requireClickTokenSecret(): string {
  const configuredSecret = process.env.COMMERCE_CLICK_TOKEN_SECRET?.trim()
  if (configuredSecret && configuredSecret.length >= 32) {
    return configuredSecret
  }
  if (allowsTestOnlySecrets()) {
    return 'test-only-commerce-click-token-secret'
  }
  throw new Error('COMMERCE_CLICK_TOKEN_SECRET must contain at least 32 characters')
}

/**
 * base64url so the value drops straight into a URL with no percent-encoding:
 * its alphabet is `A-Za-z0-9-_`, every character of which is safe in a query
 * value and in a path segment.
 */
export function mintClickToken(clickId: string, secret: string): string {
  return createHmac('sha256', secret).update(clickId).digest('base64url')
}

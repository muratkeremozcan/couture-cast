// Extracted from wardrobe.service.ts (Story 4.1) when Story 4.4 needed the
// exact same signed-upload-token protocol for "My Form" photo bytes. The
// secret and algorithm are generic across every upload kind this API
// signs, so this lives in its own module rather than being duplicated.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { allowsTestOnlySecrets } from '../../config/runtime-environment'

export function requireUploadTokenSecret(): string {
  const configuredSecret = process.env.WARDROBE_UPLOAD_TOKEN_SECRET?.trim()
  if (configuredSecret && configuredSecret.length >= 32) {
    return configuredSecret
  }
  if (allowsTestOnlySecrets()) {
    return 'test-only-wardrobe-upload-token-secret'
  }
  throw new Error('WARDROBE_UPLOAD_TOKEN_SECRET must contain at least 32 characters')
}

export function generateUploadToken(
  uploadSessionId: string,
  userId: string,
  expiresAtIso: string,
  secret: string
): string {
  const data = `${uploadSessionId}.${userId}.${expiresAtIso}`
  return createHmac('sha256', secret).update(data).digest('base64url')
}

export function verifyUploadToken(
  token: string,
  uploadSessionId: string,
  userId: string,
  expiresAtIso: string,
  secret: string
): boolean {
  const expected = generateUploadToken(uploadSessionId, userId, expiresAtIso, secret)
  // Compare buffer byte lengths, not string lengths: a caller-supplied token
  // containing multi-byte characters can match `expected` in code points while
  // differing in bytes, and `timingSafeEqual` throws a RangeError on unequal
  // buffer lengths -- turning a forged token into a 500 instead of a 403.
  const candidate = Buffer.from(token, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  if (candidate.length !== expectedBytes.length) {
    return false
  }
  return timingSafeEqual(candidate, expectedBytes)
}

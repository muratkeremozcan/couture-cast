// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIGNED_UPLOAD_LIFETIME_MS, signedUploadExpiry } from './signed-upload-expiry'

const FIXTURE_NOW = new Date('2026-11-19T15:00:00.000Z')
const CLOCK_SKEW_MS = 60 * 1000

/** A token shaped like the one storage signs: only the payload's `exp` claim is read. */
function tokenWithPayload(payload: unknown): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
}

function secondsFromNow(ms: number): number {
  return Math.floor((FIXTURE_NOW.getTime() + ms) / 1000)
}

describe('signedUploadExpiry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXTURE_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('documents a two-hour token lifetime', () => {
    expect(SIGNED_UPLOAD_LIFETIME_MS).toBe(2 * 60 * 60 * 1000)
  })

  it('reads the expiry of a token signed for the documented lifetime', () => {
    const exp = secondsFromNow(SIGNED_UPLOAD_LIFETIME_MS)

    expect(signedUploadExpiry(tokenWithPayload({ exp }))).toEqual(new Date(exp * 1000))
  })

  /** The storage server's clock may run a little ahead of this one. */
  it('accepts a token up to one minute past the documented lifetime', () => {
    const exp = secondsFromNow(SIGNED_UPLOAD_LIFETIME_MS + CLOCK_SKEW_MS)

    expect(signedUploadExpiry(tokenWithPayload({ exp }))).toEqual(new Date(exp * 1000))
  })

  it('refuses a token signed for longer than the lifetime plus skew', () => {
    const exp = secondsFromNow(SIGNED_UPLOAD_LIFETIME_MS + CLOCK_SKEW_MS + 1000)

    expect(signedUploadExpiry(tokenWithPayload({ exp }))).toBeNull()
  })

  it.each([
    ['one that has already expired', tokenWithPayload({ exp: secondsFromNow(-1000) })],
    ['one expiring this instant', tokenWithPayload({ exp: secondsFromNow(0) })],
    ['one with no payload segment', 'header-only'],
    ['one whose payload is not JSON', 'header.%%%.signature'],
    ['one with no exp claim', tokenWithPayload({ sub: 'storage' })],
    ['one whose exp is not a number', tokenWithPayload({ exp: '1763571600' })],
    ['one whose payload is JSON null', tokenWithPayload(null)],
  ])('refuses %s', (_label, token) => {
    expect(signedUploadExpiry(token)).toBeNull()
  })
})

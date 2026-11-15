// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 E1 and V1: the request rule the guest journeys assert on.
import { describe, expect, it } from 'vitest'
import { isAllowedGuestPreviewRequest } from './guest-preview-requests'

const LOCAL = 'http://localhost:3005'
const PREVIEW = 'https://couture-cast-web-git-feat-x.vercel.app'
const allowed = (method: string, url: string, webOrigin: string) =>
  isAllowedGuestPreviewRequest({ method, url }, webOrigin)

describe('guest preview request allowlist', () => {
  it('allows only safe methods from the web origin outside /api/ and /ingest/', () => {
    expect(allowed('GET', `${LOCAL}/preview?view=wardrobe`, LOCAL)).toBe(true)
    expect(allowed('GET', `${LOCAL}/_next/static/chunk.js`, LOCAL)).toBe(true)
    expect(allowed('POST', `${LOCAL}/preview`, LOCAL)).toBe(false)
    expect(allowed('GET', `${LOCAL}/api/v1/ritual`, LOCAL)).toBe(false)
    expect(allowed('GET', `${LOCAL}/ingest/e/`, LOCAL)).toBe(false)
    expect(allowed('GET', 'http://localhost:4000/api/v1/ritual', LOCAL)).toBe(false)
    expect(allowed('POST', 'http://127.0.0.1:54321/rest/v1/garment_items', LOCAL)).toBe(
      false
    )
  })

  it('allows the safe methods GET, HEAD and OPTIONS on the web origin, and no write', () => {
    for (const base of [LOCAL, PREVIEW]) {
      for (const method of ['GET', 'HEAD', 'OPTIONS'])
        expect(allowed(method, `${base}/preview`, base), `${method} ${base}`).toBe(true)
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
        expect(allowed(method, `${base}/preview`, base), `${method} ${base}`).toBe(false)
      for (const method of ['HEAD', 'OPTIONS'])
        for (const path of ['/api/v1/ritual', '/ingest/e/'])
          expect(allowed(method, `${base}${path}`, base), `${method} ${path}`).toBe(false)
    }
  })

  it('exempts the Vercel toolbar only on a Vercel preview deployment (V1)', () => {
    expect(allowed('POST', 'https://vercel.live/login/validate', PREVIEW)).toBe(true)
    expect(
      allowed('GET', 'https://vercel.live/_next-live/feedback/feedback.js', PREVIEW)
    ).toBe(true)
  })

  it('keeps vercel.live outside the toolbar paths, or off a preview, on the allowlist', () => {
    expect(allowed('GET', 'https://vercel.live/other/path', PREVIEW)).toBe(false)
    expect(allowed('POST', 'https://vercel.live/login-validate', PREVIEW)).toBe(false)
    expect(allowed('POST', 'https://vercel.live/login/validate', LOCAL)).toBe(false)
    expect(
      allowed('POST', 'https://vercel.live/login/validate', 'https://couturecast.app')
    ).toBe(false)
    expect(allowed('POST', 'https://evil.vercel.live/login/validate', PREVIEW)).toBe(
      false
    )
    expect(allowed('POST', 'http://vercel.live/login/validate', PREVIEW)).toBe(false)
  })
})

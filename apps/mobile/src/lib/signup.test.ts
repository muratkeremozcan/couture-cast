import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { server } from '../test-utils/msw/server'
import { SignupRefusedError, submitMobileSignup } from './signup'

const activeSignup = {
  userId: 'user-1',
  age: 30,
  accountStatus: 'active' as const,
  guardianConsentRequired: false as const,
}

describe('submitMobileSignup', () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  })

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
  })

  it('posts the validated payload and returns the adult account variant', async () => {
    let body: unknown
    server.use(
      http.post('*/api/v1/auth/signup', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(activeSignup, { status: 201 })
      })
    )

    const result = await submitMobileSignup({
      email: 'adult@example.com',
      birthdate: '1996-02-29',
    })

    expect(body).toEqual({ email: 'adult@example.com', birthdate: '1996-02-29' })
    expect(result).toEqual(activeSignup)
  })

  /**
   * The response is a discriminated union: a teen signup must arrive with both
   * halves agreeing, and the parse is what enforces that on the client.
   */
  it('returns the guardian-consent variant for a minor', async () => {
    server.use(
      http.post('*/api/v1/auth/signup', () =>
        HttpResponse.json(
          {
            userId: 'user-2',
            age: 14,
            accountStatus: 'pending_guardian_consent',
            guardianConsentRequired: true,
          },
          { status: 201 }
        )
      )
    )

    const result = await submitMobileSignup({
      email: 'teen@example.com',
      birthdate: '2012-01-01',
    })

    expect(result.accountStatus).toBe('pending_guardian_consent')
    expect(result.guardianConsentRequired).toBe(true)
  })

  /** A response whose two halves disagree is unrepresentable and must not pass. */
  it('rejects a response that claims consent is required on an active account', async () => {
    server.use(
      http.post('*/api/v1/auth/signup', () =>
        HttpResponse.json(
          { ...activeSignup, guardianConsentRequired: true },
          { status: 201 }
        )
      )
    )

    await expect(
      submitMobileSignup({ email: 'adult@example.com', birthdate: '1990-01-01' })
    ).rejects.toThrow()
  })

  /**
   * `2026-02-31` matches the YYYY-MM-DD pattern but is not a real date. The
   * client-side parse has to reject it before a request is spent.
   */
  it('rejects an impossible calendar birthdate before any request leaves the device', async () => {
    const requested = vi.fn()
    server.use(
      http.post('*/api/v1/auth/signup', () => {
        requested()
        return HttpResponse.json(activeSignup, { status: 201 })
      })
    )

    await expect(
      submitMobileSignup({ email: 'adult@example.com', birthdate: '2026-02-31' })
    ).rejects.toThrow()
    expect(requested).not.toHaveBeenCalled()
  })

  it('surfaces the API error message on a rejected signup', async () => {
    server.use(
      http.post('*/api/v1/auth/signup', () =>
        HttpResponse.json(
          { message: 'Signups under 13 are not permitted' },
          { status: 403 }
        )
      )
    )

    await expect(
      submitMobileSignup({ email: 'child@example.com', birthdate: '2020-01-01' })
    ).rejects.toThrow('Signups under 13 are not permitted')
  })

  /** A gateway that returns HTML must still produce a usable message. */
  it('falls back to a status-based message when the error body is not JSON', async () => {
    server.use(
      http.post('*/api/v1/auth/signup', () =>
        HttpResponse.text('<html>502 Bad Gateway</html>', { status: 502 })
      )
    )

    await expect(
      submitMobileSignup({ email: 'adult@example.com', birthdate: '1990-01-01' })
    ).rejects.toThrow('Signup failed with status 502')
  })

  it('marks a 403 as a refusal of the person and other failures as retryable', async () => {
    server.use(
      http.post('*/api/v1/auth/signup', async ({ request }) => {
        const { email } = (await request.json()) as { email: string }
        return email.startsWith('refused')
          ? HttpResponse.json(
              { statusCode: 403, message: 'You must be 13 or older', error: 'Forbidden' },
              { status: 403 }
            )
          : HttpResponse.json(
              { statusCode: 400, message: 'Email already registered' },
              { status: 400 }
            )
      })
    )
    const refused = submitMobileSignup({
      email: 'refused@example.com',
      birthdate: '2000-01-15',
    })
    await expect(refused).rejects.toBeInstanceOf(SignupRefusedError)
    await expect(refused).rejects.toThrow('You must be 13 or older')
    const taken = submitMobileSignup({
      email: 'taken@example.com',
      birthdate: '2000-01-15',
    })
    await expect(taken).rejects.toThrow('Email already registered')
    await expect(taken).rejects.not.toBeInstanceOf(SignupRefusedError)
  })
})

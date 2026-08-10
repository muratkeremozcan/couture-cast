import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../test-utils/msw/runtime'
import { submitWebSignup } from './signup'

describe('submitWebSignup', () => {
  it('posts the signup payload and returns an active adult account', async () => {
    const seen = vi.fn<(body: unknown, contentType: string | null) => void>()
    useMswHandlers(
      http.post('/api/v1/auth/signup', async ({ request }) => {
        seen(await request.json(), request.headers.get('content-type'))
        return HttpResponse.json(
          {
            userId: 'user-1',
            age: 30,
            accountStatus: 'active',
            guardianConsentRequired: false,
          },
          { status: 201 }
        )
      })
    )

    const result = await submitWebSignup({
      email: 'adult@example.test',
      birthdate: '1996-05-04',
    })

    expect(result.accountStatus).toBe('active')
    expect(result.guardianConsentRequired).toBe(false)
    expect(seen).toHaveBeenCalledWith(
      { email: 'adult@example.test', birthdate: '1996-05-04' },
      'application/json'
    )
  })

  /**
   * The under-16 branch is the whole reason this endpoint has a discriminated
   * union: the caller must be able to route to the guardian-consent flow from
   * the response alone.
   */
  it('returns the pending-guardian-consent variant for a teen signup', async () => {
    useMswHandlers(
      http.post('/api/v1/auth/signup', () =>
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

    const result = await submitWebSignup({
      email: 'teen@example.test',
      birthdate: '2012-01-31',
    })

    expect(result.accountStatus).toBe('pending_guardian_consent')
    expect(result.guardianConsentRequired).toBe(true)
  })

  /**
   * `2026-02-31` matches the YYYY-MM-DD pattern but is not a real date. The
   * contract rejects it at runtime, so the browser must too rather than letting
   * an impossible birthdate decide a consent gate.
   */
  it('rejects an impossible calendar birthdate before calling the API', async () => {
    const requested = vi.fn()
    useMswHandlers(
      http.post('/api/v1/auth/signup', () => {
        requested()
        return HttpResponse.json({}, { status: 201 })
      })
    )

    await expect(
      submitWebSignup({ email: 'teen@example.test', birthdate: '2026-02-31' })
    ).rejects.toThrow()
    expect(requested).not.toHaveBeenCalled()
  })

  it('rejects a malformed email before calling the API', async () => {
    const requested = vi.fn()
    useMswHandlers(
      http.post('/api/v1/auth/signup', () => {
        requested()
        return HttpResponse.json({}, { status: 201 })
      })
    )

    await expect(
      submitWebSignup({ email: 'nope', birthdate: '1996-05-04' })
    ).rejects.toThrow()
    expect(requested).not.toHaveBeenCalled()
  })

  it('surfaces the server-provided message when signup is refused', async () => {
    useMswHandlers(
      http.post('/api/v1/auth/signup', () =>
        HttpResponse.json({ message: 'Email already registered' }, { status: 409 })
      )
    )

    await expect(
      submitWebSignup({ email: 'taken@example.test', birthdate: '1996-05-04' })
    ).rejects.toThrow('Email already registered')
  })

  /** Some error envelopes carry a code but no prose; the form still needs copy to show. */
  it('falls back to a status message when the error body carries no message', async () => {
    useMswHandlers(
      http.post('/api/v1/auth/signup', () =>
        HttpResponse.json({ statusCode: 400, error: 'Bad Request' }, { status: 400 })
      )
    )

    await expect(
      submitWebSignup({ email: 'adult@example.test', birthdate: '1996-05-04' })
    ).rejects.toThrow('Signup failed with status 400')
  })

  /** An upstream proxy failure returns no JSON at all; the user still needs a message. */
  it('falls back to a status message when the error body is not JSON', async () => {
    useMswHandlers(
      http.post(
        '/api/v1/auth/signup',
        () => new HttpResponse('service unavailable', { status: 503 })
      )
    )

    await expect(
      submitWebSignup({ email: 'adult@example.test', birthdate: '1996-05-04' })
    ).rejects.toThrow('Signup failed with status 503')
  })

  /**
   * A response claiming an active account while still demanding guardian consent
   * is contradictory. The union must reject it rather than let the UI pick one.
   */
  it('rejects a success response that mixes the two account variants', async () => {
    useMswHandlers(
      http.post('/api/v1/auth/signup', () =>
        HttpResponse.json(
          {
            userId: 'user-3',
            age: 14,
            accountStatus: 'active',
            guardianConsentRequired: true,
          },
          { status: 201 }
        )
      )
    )

    await expect(
      submitWebSignup({ email: 'teen@example.test', birthdate: '2012-01-31' })
    ).rejects.toThrow()
  })
})

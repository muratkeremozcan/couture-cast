import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../test-utils/msw/runtime'
import {
  acceptGuardianInvitationFromWeb,
  inviteGuardianFromWeb,
  revokeGuardianConsentFromWeb,
} from './guardian'

const invitationResponse = {
  invitationId: 'inv-1',
  teenId: 'teen-1',
  guardianEmail: 'guardian@example.test',
  consentLevel: 'read_only',
  expiresAt: '2026-08-17T09:00:00.000Z',
  invitationLink: 'https://couturecast.test/guardian/accept?token=abc',
  deliveryQueued: true,
}

const acceptResponse = {
  teenId: 'teen-1',
  teenEmail: 'teen@example.test',
  guardianId: 'guardian-1',
  guardianEmail: 'guardian@example.test',
  consentLevel: 'full_access',
  grantedAt: '2026-08-10T09:00:00.000Z',
}

const revokeResponse = {
  guardianId: 'guardian-1',
  teenId: 'teen-1',
  revokedAt: '2026-08-10T09:05:00.000Z',
  remainingActiveGuardians: 0,
  sessionInvalidated: true,
  notificationQueued: true,
}

describe('inviteGuardianFromWeb', () => {
  it('posts the invitation as JSON with credentials and returns the parsed response', async () => {
    const seen = vi.fn<(body: unknown, contentType: string | null) => void>()
    useMswHandlers(
      http.post('/api/v1/guardian/invitations', async ({ request }) => {
        seen(await request.json(), request.headers.get('content-type'))
        return HttpResponse.json(invitationResponse, { status: 201 })
      })
    )

    const result = await inviteGuardianFromWeb({
      teenId: 'teen-1',
      guardianEmail: 'guardian@example.test',
      consentLevel: 'read_only',
    })

    expect(result.invitationId).toBe('inv-1')
    expect(result.deliveryQueued).toBe(true)
    expect(seen).toHaveBeenCalledWith(
      {
        teenId: 'teen-1',
        guardianEmail: 'guardian@example.test',
        consentLevel: 'read_only',
      },
      'application/json'
    )
  })

  /**
   * Consent invitations are a fail-closed surface: an invalid teen id or email
   * must never reach the API, because a half-formed invitation is a consent
   * record nobody asked for.
   */
  it('rejects locally invalid input before any request leaves the browser', async () => {
    const requested = vi.fn()
    useMswHandlers(
      http.post('/api/v1/guardian/invitations', () => {
        requested()
        return HttpResponse.json(invitationResponse, { status: 201 })
      })
    )

    await expect(
      inviteGuardianFromWeb({
        teenId: '',
        guardianEmail: 'not-an-email',
        consentLevel: 'read_only',
      })
    ).rejects.toThrow()
    expect(requested).not.toHaveBeenCalled()
  })

  it('surfaces the server-provided message when the request fails', async () => {
    useMswHandlers(
      http.post('/api/v1/guardian/invitations', () =>
        HttpResponse.json({ message: 'Teen account is not eligible' }, { status: 400 })
      )
    )

    await expect(
      inviteGuardianFromWeb({
        teenId: 'teen-1',
        guardianEmail: 'guardian@example.test',
        consentLevel: 'read_only',
      })
    ).rejects.toThrow('Teen account is not eligible')
  })

  /** A gateway or proxy failure returns HTML, not JSON; the user still needs a message. */
  it('falls back to a status message when the error body is not JSON', async () => {
    useMswHandlers(
      http.post(
        '/api/v1/guardian/invitations',
        () => new HttpResponse('<html>Bad Gateway</html>', { status: 502 })
      )
    )

    await expect(
      inviteGuardianFromWeb({
        teenId: 'teen-1',
        guardianEmail: 'guardian@example.test',
        consentLevel: 'read_only',
      })
    ).rejects.toThrow('Guardian request failed with status 502')
  })

  /** A 200 with a missing field is still a broken contract, not a usable invitation. */
  it('rejects a success response that does not satisfy the contract', async () => {
    useMswHandlers(
      http.post('/api/v1/guardian/invitations', () =>
        HttpResponse.json(
          { ...invitationResponse, invitationLink: undefined },
          { status: 201 }
        )
      )
    )

    await expect(
      inviteGuardianFromWeb({
        teenId: 'teen-1',
        guardianEmail: 'guardian@example.test',
        consentLevel: 'read_only',
      })
    ).rejects.toThrow()
  })
})

describe('acceptGuardianInvitationFromWeb', () => {
  it('posts the token and returns the granted consent link', async () => {
    const seen = vi.fn<(body: unknown) => void>()
    useMswHandlers(
      http.post('/api/v1/guardian/accept', async ({ request }) => {
        seen(await request.json())
        return HttpResponse.json(acceptResponse)
      })
    )

    const result = await acceptGuardianInvitationFromWeb({ token: 'signed-token' })

    expect(result.consentLevel).toBe('full_access')
    expect(result.guardianId).toBe('guardian-1')
    expect(seen).toHaveBeenCalledWith({ token: 'signed-token' })
  })

  it('rejects an empty token without calling the API', async () => {
    const requested = vi.fn()
    useMswHandlers(
      http.post('/api/v1/guardian/accept', () => {
        requested()
        return HttpResponse.json(acceptResponse)
      })
    )

    await expect(acceptGuardianInvitationFromWeb({ token: '' })).rejects.toThrow()
    expect(requested).not.toHaveBeenCalled()
  })

  /** Expired or replayed tokens are the common failure here and must stay legible. */
  it('surfaces the server message when the token is rejected', async () => {
    useMswHandlers(
      http.post('/api/v1/guardian/accept', () =>
        HttpResponse.json({ message: 'Invitation has expired' }, { status: 400 })
      )
    )

    await expect(
      acceptGuardianInvitationFromWeb({ token: 'expired-token' })
    ).rejects.toThrow('Invitation has expired')
  })

  it('falls back to a status message when the error body has no message field', async () => {
    useMswHandlers(
      http.post('/api/v1/guardian/accept', () =>
        HttpResponse.json({ statusCode: 404 }, { status: 404 })
      )
    )

    await expect(
      acceptGuardianInvitationFromWeb({ token: 'unknown-token' })
    ).rejects.toThrow('Guardian request failed with status 404')
  })
})

describe('revokeGuardianConsentFromWeb', () => {
  it('posts the guardian/teen pair and returns the revocation outcome', async () => {
    const seen = vi.fn<(body: unknown) => void>()
    useMswHandlers(
      http.post('/api/v1/guardian/revoke', async ({ request }) => {
        seen(await request.json())
        return HttpResponse.json(revokeResponse)
      })
    )

    const result = await revokeGuardianConsentFromWeb({
      guardianId: 'guardian-1',
      teenId: 'teen-1',
    })

    // Losing the last guardian must invalidate the teen session; that flag is the
    // observable half of the consent-gate rule.
    expect(result.remainingActiveGuardians).toBe(0)
    expect(result.sessionInvalidated).toBe(true)
    expect(seen).toHaveBeenCalledWith({ guardianId: 'guardian-1', teenId: 'teen-1' })
  })

  it('surfaces a forbidden revoke attempt as an actionable error', async () => {
    useMswHandlers(
      http.post('/api/v1/guardian/revoke', () =>
        HttpResponse.json(
          { message: 'Authenticated guardian does not match' },
          { status: 403 }
        )
      )
    )

    await expect(
      revokeGuardianConsentFromWeb({ guardianId: 'other', teenId: 'teen-1' })
    ).rejects.toThrow('Authenticated guardian does not match')
  })

  it('rejects a response whose remaining-guardian count is not a valid count', async () => {
    useMswHandlers(
      http.post('/api/v1/guardian/revoke', () =>
        HttpResponse.json({ ...revokeResponse, remainingActiveGuardians: -1 })
      )
    )

    await expect(
      revokeGuardianConsentFromWeb({ guardianId: 'guardian-1', teenId: 'teen-1' })
    ).rejects.toThrow()
  })
})

import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { server } from '../test-utils/msw/server'
import {
  acceptGuardianInvitationFromMobile,
  inviteGuardianFromMobile,
  revokeGuardianConsentFromMobile,
} from './guardian'

const invitation = {
  invitationId: 'inv-1',
  teenId: 'teen-1',
  guardianEmail: 'guardian@example.com',
  consentLevel: 'read_only' as const,
  expiresAt: '2026-08-16T00:00:00.000Z',
  invitationLink: 'https://couture.example/guardian/accept?token=abc',
  deliveryQueued: true,
}

describe('mobile guardian consent API wrappers', () => {
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  })

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
  })

  it('sends the invitation payload as JSON and returns the parsed invitation', async () => {
    let contentType: string | null = null
    let body: unknown
    server.use(
      http.post('*/api/v1/guardian/invitations', async ({ request }) => {
        contentType = request.headers.get('content-type')
        body = await request.json()
        return HttpResponse.json(invitation, { status: 201 })
      })
    )

    const result = await inviteGuardianFromMobile({
      teenId: 'teen-1',
      guardianEmail: 'guardian@example.com',
      consentLevel: 'read_only',
    })

    expect(contentType).toBe('application/json')
    expect(body).toEqual({
      teenId: 'teen-1',
      guardianEmail: 'guardian@example.com',
      consentLevel: 'read_only',
    })
    expect(result).toEqual(invitation)
  })

  /**
   * `deliveryQueued: false` is the degraded-email path: the invitation still
   * exists and the link is still usable, so the wrapper must return it rather
   * than treat a queue failure as a failed invitation.
   */
  it('returns a usable invitation even when email delivery could not be queued', async () => {
    server.use(
      http.post('*/api/v1/guardian/invitations', () =>
        HttpResponse.json({ ...invitation, deliveryQueued: false }, { status: 201 })
      )
    )

    const result = await inviteGuardianFromMobile({
      teenId: 'teen-1',
      guardianEmail: 'guardian@example.com',
      consentLevel: 'full_access',
    })

    expect(result.deliveryQueued).toBe(false)
    expect(result.invitationLink).toBe(invitation.invitationLink)
  })

  it('rejects an invalid guardian email before a request leaves the device', async () => {
    const requested = vi.fn()
    server.use(
      http.post('*/api/v1/guardian/invitations', () => {
        requested()
        return HttpResponse.json(invitation, { status: 201 })
      })
    )

    await expect(
      inviteGuardianFromMobile({
        teenId: 'teen-1',
        guardianEmail: 'not-an-email',
        consentLevel: 'read_only',
      })
    ).rejects.toThrow()
    expect(requested).not.toHaveBeenCalled()
  })

  it('surfaces the API message when the teen is not eligible', async () => {
    server.use(
      http.post('*/api/v1/guardian/invitations', () =>
        HttpResponse.json({ message: 'Teen account was not found' }, { status: 404 })
      )
    )

    await expect(
      inviteGuardianFromMobile({
        teenId: 'missing',
        guardianEmail: 'guardian@example.com',
        consentLevel: 'read_only',
      })
    ).rejects.toThrow('Teen account was not found')
  })

  /** A proxy-generated HTML error still has to become a readable message. */
  it('falls back to a status message when the invitation error body is not JSON', async () => {
    server.use(
      http.post('*/api/v1/guardian/invitations', () =>
        HttpResponse.text('gateway timeout', { status: 504 })
      )
    )

    await expect(
      inviteGuardianFromMobile({
        teenId: 'teen-1',
        guardianEmail: 'guardian@example.com',
        consentLevel: 'read_only',
      })
    ).rejects.toThrow('Guardian request failed with status 504')
  })

  it('accepts an invitation and returns the granted consent link', async () => {
    let body: unknown
    server.use(
      http.post('*/api/v1/guardian/accept', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          teenId: 'teen-1',
          teenEmail: 'teen@example.com',
          guardianId: 'guardian-1',
          guardianEmail: 'guardian@example.com',
          consentLevel: 'full_access',
          grantedAt: '2026-08-09T00:00:00.000Z',
        })
      })
    )

    const result = await acceptGuardianInvitationFromMobile({ token: 'signed-token' })

    expect(body).toEqual({ token: 'signed-token' })
    expect(result.consentLevel).toBe('full_access')
    expect(result.guardianId).toBe('guardian-1')
  })

  it('reports an expired acceptance token with the API message', async () => {
    server.use(
      http.post('*/api/v1/guardian/accept', () =>
        HttpResponse.json({ message: 'Invitation has expired' }, { status: 410 })
      )
    )

    await expect(
      acceptGuardianInvitationFromMobile({ token: 'expired-token' })
    ).rejects.toThrow('Invitation has expired')
  })

  it('falls back to a status message when the accept error body is not JSON', async () => {
    server.use(
      http.post('*/api/v1/guardian/accept', () =>
        HttpResponse.text('nope', { status: 500 })
      )
    )

    await expect(
      acceptGuardianInvitationFromMobile({ token: 'signed-token' })
    ).rejects.toThrow('Guardian request failed with status 500')
  })

  /**
   * Revocation is the safety-critical path: the caller needs to know whether the
   * teen still has another active guardian and whether sessions were killed.
   */
  it('revokes consent and reports the resulting session and guardian state', async () => {
    let body: unknown
    server.use(
      http.post('*/api/v1/guardian/revoke', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          guardianId: 'guardian-1',
          teenId: 'teen-1',
          revokedAt: '2026-08-09T00:00:00.000Z',
          remainingActiveGuardians: 0,
          sessionInvalidated: true,
          notificationQueued: false,
        })
      })
    )

    const result = await revokeGuardianConsentFromMobile({
      guardianId: 'guardian-1',
      teenId: 'teen-1',
    })

    expect(body).toEqual({ guardianId: 'guardian-1', teenId: 'teen-1' })
    expect(result.remainingActiveGuardians).toBe(0)
    expect(result.sessionInvalidated).toBe(true)
    expect(result.notificationQueued).toBe(false)
  })

  it('rejects a revoke request that is missing the teen id', async () => {
    const requested = vi.fn()
    server.use(
      http.post('*/api/v1/guardian/revoke', () => {
        requested()
        return HttpResponse.json({}, { status: 200 })
      })
    )

    await expect(
      revokeGuardianConsentFromMobile({ guardianId: 'guardian-1', teenId: '' })
    ).rejects.toThrow()
    expect(requested).not.toHaveBeenCalled()
  })

  it('surfaces the API message when revocation is forbidden', async () => {
    server.use(
      http.post('*/api/v1/guardian/revoke', () =>
        HttpResponse.json({ message: 'GUARDIAN_CONSENT_REQUIRED' }, { status: 403 })
      )
    )

    await expect(
      revokeGuardianConsentFromMobile({ guardianId: 'guardian-1', teenId: 'teen-1' })
    ).rejects.toThrow('GUARDIAN_CONSENT_REQUIRED')
  })

  it('falls back to a status message when the revoke error body is not JSON', async () => {
    server.use(
      http.post('*/api/v1/guardian/revoke', () => HttpResponse.text('', { status: 503 }))
    )

    await expect(
      revokeGuardianConsentFromMobile({ guardianId: 'guardian-1', teenId: 'teen-1' })
    ).rejects.toThrow('Guardian request failed with status 503')
  })
})

import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type {
  GuardianConsentRevokeResponse,
  ConsentLevel,
  GuardianInvitationAcceptResponse,
  GuardianInvitationResponse,
} from '../../contracts/http'
import { GuardianController } from './guardian.controller'
import type { GuardianService } from './guardian.service'
import type { RequestAuthContext } from '../auth/security.types'

const createController = () => {
  const inviteGuardian =
    vi.fn<
      (
        teenId: string,
        guardianEmail: string,
        consentLevel: ConsentLevel
      ) => Promise<GuardianInvitationResponse>
    >()
  const acceptInvitation =
    vi.fn<
      (token: string, ipAddress?: string) => Promise<GuardianInvitationAcceptResponse>
    >()
  const revokeConsent =
    vi.fn<
      (
        guardianId: string,
        teenId: string,
        ipAddress?: string
      ) => Promise<GuardianConsentRevokeResponse>
    >()
  const guardianService = {
    inviteGuardian,
    acceptInvitation,
    revokeConsent,
  } as unknown as GuardianService

  return {
    inviteGuardian,
    acceptInvitation,
    revokeConsent,
    guardianService,
    controller: new GuardianController(guardianService),
  }
}

describe('GuardianController', () => {
  const guardianAuthContext: RequestAuthContext = {
    token: 'guardian-token',
    userId: 'guardian-1',
    role: 'guardian',
  }

  it('creates guardian invitations for valid payloads', async () => {
    const { controller, inviteGuardian } = createController()
    inviteGuardian.mockResolvedValue({
      invitationId: 'invitation-1',
      teenId: 'teen-1',
      guardianEmail: 'guardian@example.com',
      consentLevel: 'read_only',
      expiresAt: '2026-04-24T00:00:00.000Z',
      invitationLink: 'https://app.couturecast.test/guardian/accept?token=abc',
      deliveryQueued: true,
    })

    const result = await controller.inviteGuardian({
      teenId: 'teen-1',
      guardianEmail: 'guardian@example.com',
      consentLevel: 'read_only',
    })

    expect(inviteGuardian).toHaveBeenCalledWith(
      'teen-1',
      'guardian@example.com',
      'read_only'
    )
    expect(result.deliveryQueued).toBe(true)
  })

  it('rejects invalid invitation payloads', () => {
    const { controller } = createController()

    expect(() =>
      controller.inviteGuardian({
        teenId: '',
        guardianEmail: 'not-an-email',
      })
    ).toThrow(BadRequestException)
  })

  it('accepts invitations with the caller IP address', async () => {
    const { controller, acceptInvitation } = createController()
    acceptInvitation.mockResolvedValue({
      teenId: 'teen-2',
      teenEmail: 'teen2@example.com',
      guardianId: 'guardian-2',
      guardianEmail: 'guardian2@example.com',
      consentLevel: 'full_access',
      grantedAt: '2026-04-17T06:00:00.000Z',
    })

    const result = await controller.acceptInvitation({ token: 'signed-token' }, {
      headers: {},
      ip: '203.0.113.44',
    } as never)

    expect(acceptInvitation).toHaveBeenCalledWith('signed-token', '203.0.113.44')
    expect(result.guardianId).toBe('guardian-2')
  })

  it('prefers the leftmost forwarded IP when present', async () => {
    const { controller, acceptInvitation } = createController()
    acceptInvitation.mockResolvedValue({
      teenId: 'teen-2',
      teenEmail: 'teen2@example.com',
      guardianId: 'guardian-2',
      guardianEmail: 'guardian2@example.com',
      consentLevel: 'full_access',
      grantedAt: '2026-04-17T06:00:00.000Z',
    })

    await controller.acceptInvitation({ token: 'signed-token' }, {
      headers: {
        'x-forwarded-for': '198.51.100.10, 203.0.113.44',
      },
      ip: '10.0.0.1',
    } as never)

    expect(acceptInvitation).toHaveBeenCalledWith('signed-token', '198.51.100.10')
  })

  it('rejects invalid accept payloads', () => {
    const { controller } = createController()

    expect(() =>
      controller.acceptInvitation({ token: '' }, {
        headers: {},
        ip: '127.0.0.1',
      } as never)
    ).toThrow(BadRequestException)
  })

  it('revokes guardian consent for matching authenticated guardians', async () => {
    const { controller, revokeConsent } = createController()
    revokeConsent.mockResolvedValue({
      guardianId: 'guardian-1',
      teenId: 'teen-9',
      revokedAt: '2026-04-21T13:00:00.000Z',
      remainingActiveGuardians: 0,
      sessionInvalidated: true,
      notificationQueued: true,
    })

    const result = await controller.revokeConsent(
      guardianAuthContext,
      {
        guardianId: 'guardian-1',
        teenId: 'teen-9',
      },
      {
        headers: {},
        ip: '203.0.113.88',
      } as never
    )

    expect(revokeConsent).toHaveBeenCalledWith('guardian-1', 'teen-9', '203.0.113.88')
    expect(result.sessionInvalidated).toBe(true)
  })

  it('rejects invalid revoke payloads', () => {
    const { controller, revokeConsent } = createController()

    expect(() =>
      controller.revokeConsent(
        guardianAuthContext,
        {
          guardianId: '',
          teenId: 'teen-9',
        },
        {
          headers: {},
          ip: '203.0.113.88',
        } as never
      )
    ).toThrow(BadRequestException)
    expect(revokeConsent).not.toHaveBeenCalled()
  })

  it('rejects revoke requests when guardian identity does not match', () => {
    const { controller, revokeConsent } = createController()

    expect(() =>
      controller.revokeConsent(
        guardianAuthContext,
        {
          guardianId: 'guardian-2',
          teenId: 'teen-9',
        },
        {
          headers: {},
          ip: '203.0.113.88',
        } as never
      )
    ).toThrow(ForbiddenException)
    expect(revokeConsent).not.toHaveBeenCalled()
  })
})

import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type {
  ConsentLevel,
  GuardianInvitationAcceptResponse,
  GuardianInvitationResponse,
} from '../../contracts/http'
import { GuardianController } from './guardian.controller'
import type { GuardianService } from './guardian.service'

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
  const guardianService = {
    inviteGuardian,
    acceptInvitation,
  } as unknown as GuardianService

  return {
    inviteGuardian,
    acceptInvitation,
    guardianService,
    controller: new GuardianController(guardianService),
  }
}

describe('GuardianController', () => {
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
})

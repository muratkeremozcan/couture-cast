import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { GuardianController } from './guardian.controller'
import type { GuardianService } from './guardian.service'

const createController = () => {
  const inviteGuardian = vi.fn()
  const acceptInvitation = vi.fn()
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

    const result = await controller.acceptInvitation(
      { token: 'signed-token' },
      '203.0.113.44'
    )

    expect(acceptInvitation).toHaveBeenCalledWith('signed-token', '203.0.113.44')
    expect(result.guardianId).toBe('guardian-2')
  })

  it('rejects invalid accept payloads', () => {
    const { controller } = createController()

    expect(() => controller.acceptInvitation({ token: '' }, '127.0.0.1')).toThrow(
      BadRequestException
    )
  })
})

import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGuardianProfileFixture,
  createTeenProfileFixture,
  resetCleanupRegistry,
} from '../../../test/factories.js'
import type { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import type { RequestAuthContext } from './security.types'

const createController = () => {
  const signUp = vi.fn()
  const grantGuardianConsent = vi.fn().mockReturnValue({ tracked: true })
  const service = {
    signUp,
    grantGuardianConsent,
  } as unknown as AuthService

  return { controller: new AuthController(service), signUp, grantGuardianConsent }
}

describe('AuthController', () => {
  const guardian = createGuardianProfileFixture()
  const alternateGuardian = createGuardianProfileFixture({
    id: 'guardian-9',
    email: 'guardian9@example.com',
    displayName: 'Morgan Blake',
  })
  const teen = createTeenProfileFixture()
  const guardianAuthContext: RequestAuthContext = {
    token: 'token-123',
    userId: guardian.id,
    role: 'guardian',
  }

  afterEach(() => {
    resetCleanupRegistry()
  })

  it('passes valid signup payloads through to the auth service', () => {
    const payload = {
      email: 'new-user@example.com',
      birthdate: '2010-04-15',
    }
    const { controller, signUp } = createController()
    signUp.mockReturnValue({
      userId: 'user-1',
      age: 16,
      accountStatus: 'active',
      guardianConsentRequired: false,
    })

    const result = controller.signUp(payload)

    expect(signUp).toHaveBeenCalledWith(payload)
    expect(result).toEqual({
      userId: 'user-1',
      age: 16,
      accountStatus: 'active',
      guardianConsentRequired: false,
    })
  })

  it('rejects invalid signup payloads', () => {
    const { controller, signUp } = createController()

    expect(() =>
      controller.signUp({
        email: 'not-an-email',
        birthdate: '04/15/2010',
      })
    ).toThrow(BadRequestException)
    expect(signUp).not.toHaveBeenCalled()
  })

  it('records guardian consent for valid payloads', () => {
    const { controller, grantGuardianConsent } = createController()
    const payload = {
      guardianId: guardian.id,
      teenId: teen.id,
      consentLevel: 'full',
      timestamp: '2026-03-04T10:00:00.000Z',
    }

    const result = controller.grantGuardianConsent(guardianAuthContext, payload)

    expect(grantGuardianConsent).toHaveBeenCalledWith(payload)
    expect(result).toEqual({ tracked: true })
  })

  it('rejects invalid payloads', () => {
    const { controller, grantGuardianConsent } = createController()

    expect(() =>
      controller.grantGuardianConsent(guardianAuthContext, {
        guardianId: '',
        teenId: teen.id,
        consentLevel: 'full',
      })
    ).toThrow(BadRequestException)
    expect(grantGuardianConsent).not.toHaveBeenCalled()
  })

  it('rejects consent payloads when guardian identity does not match', () => {
    const { controller, grantGuardianConsent } = createController()

    expect(() =>
      controller.grantGuardianConsent(guardianAuthContext, {
        guardianId: alternateGuardian.id,
        teenId: teen.id,
        consentLevel: 'full',
      })
    ).toThrow(ForbiddenException)
    expect(grantGuardianConsent).not.toHaveBeenCalled()
  })

  it('allows admin to record consent on behalf of guardian', () => {
    const { controller, grantGuardianConsent } = createController()
    const payload = {
      guardianId: alternateGuardian.id,
      teenId: teen.id,
      consentLevel: 'full',
      timestamp: '2026-03-04T10:00:00.000Z',
    }

    const result = controller.grantGuardianConsent(
      {
        token: 'admin-token',
        userId: 'admin-1',
        role: 'admin',
      },
      payload
    )

    expect(grantGuardianConsent).toHaveBeenCalledWith(payload)
    expect(result).toEqual({ tracked: true })
  })
})

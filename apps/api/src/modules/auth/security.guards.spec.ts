import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type {
  AccessTokenIdentity,
  AccessTokenIdentityService,
} from './access-token-identity.service.js'
import type { GuardianConsentStateService } from './guardian-consent-state.service'
import { RequestAuthGuard } from './security.guards'

function createExecutionContext(headers: Record<string, string>) {
  const request = { headers } as {
    auth?: { token: string; userId: string; role: AccessTokenIdentity['role'] }
    headers: Record<string, string>
  }

  return {
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext,
    request,
  }
}

function createGuard(
  identity: AccessTokenIdentity = { userId: 'guardian-1', role: 'guardian' },
  teenAccessAllowed = true
) {
  const canTeenAccess = vi.fn().mockResolvedValue(teenAccessAllowed)
  const guardianConsentStateService = {
    canTeenAccess,
  } as unknown as GuardianConsentStateService
  const resolveIdentity = vi.fn().mockResolvedValue(identity)
  const accessTokenIdentityService = {
    resolveIdentity,
  } as unknown as AccessTokenIdentityService

  return {
    canTeenAccess,
    guard: new RequestAuthGuard(guardianConsentStateService, accessTokenIdentityService),
    resolveIdentity,
  }
}

describe('RequestAuthGuard', () => {
  it('attaches server-verified identity and ignores spoofable identity headers', async () => {
    const { guard, canTeenAccess, resolveIdentity } = createGuard()
    const { context, request } = createExecutionContext({
      authorization: 'Bearer guardian-token',
      'x-user-id': 'spoofed-user',
      'x-user-role': 'admin',
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(resolveIdentity).toHaveBeenCalledWith('guardian-token', expect.anything())
    expect(request.auth).toEqual({
      token: 'guardian-token',
      userId: 'guardian-1',
      role: 'guardian',
    })
    expect(canTeenAccess).not.toHaveBeenCalled()
  })

  it('blocks verified teen requests when guardian consent is still required', async () => {
    const { guard, canTeenAccess } = createGuard(
      { userId: 'teen-1', role: 'teen' },
      false
    )
    const { context } = createExecutionContext({
      authorization: 'Bearer teen-token',
      'x-user-id': 'spoofed-guardian',
      'x-user-role': 'guardian',
    })

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException)
    expect(canTeenAccess).toHaveBeenCalledWith('teen-1')
  })

  it('allows verified teen requests once guardian consent is no longer required', async () => {
    const { guard, canTeenAccess } = createGuard({ userId: 'teen-1', role: 'teen' })
    const { context } = createExecutionContext({
      authorization: 'bearer teen-token',
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(canTeenAccess).toHaveBeenCalledWith('teen-1')
  })

  it('rejects requests without a bearer token before identity resolution', async () => {
    const { guard, resolveIdentity } = createGuard()
    const { context } = createExecutionContext({
      'x-user-id': 'guardian-1',
      'x-user-role': 'guardian',
    })

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException)
    expect(resolveIdentity).not.toHaveBeenCalled()
  })

  it('normalizes identity resolver failures to an unauthorized response', async () => {
    const { guard, resolveIdentity } = createGuard()
    resolveIdentity.mockRejectedValueOnce(new Error('upstream details'))
    const { context } = createExecutionContext({
      authorization: 'Bearer invalid-token',
    })

    await expect(guard.canActivate(context)).rejects.toThrow('Invalid access token')
  })
})

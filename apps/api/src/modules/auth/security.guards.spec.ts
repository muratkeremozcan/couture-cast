// Learning path Step 41: Curated reactions.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-41-curated-reactions
import 'reflect-metadata'
import {
  API_ALLOW_PENDING_GUARDIAN_TEEN_KEY,
  API_TRANSACTIONAL_CONSENT_KEY,
} from './security.decorators'
import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common'
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
      getHandler: () => createExecutionContext,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext,
    request,
  }
}

function createGuard(
  identity: AccessTokenIdentity = { userId: 'guardian-1', role: 'guardian' },
  teenAccessAllowed = true,
  teenNonUploadAccessAllowed = true
) {
  const canTeenAccess = vi.fn().mockResolvedValue(teenAccessAllowed)
  const canTeenAccessNonUploadSurface = vi
    .fn()
    .mockResolvedValue(teenNonUploadAccessAllowed)
  const guardianConsentStateService = {
    canTeenAccess,
    canTeenAccessNonUploadSurface,
  } as unknown as GuardianConsentStateService
  const resolveIdentity = vi.fn().mockResolvedValue(identity)
  const accessTokenIdentityService = {
    resolveIdentity,
  } as unknown as AccessTokenIdentityService

  return {
    canTeenAccess,
    canTeenAccessNonUploadSurface,
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

describe('Story 6.3 consent-loss retractions', () => {
  it('delegates marked reaction eligibility to the locked handler after verifying authentication', async () => {
    const { guard, canTeenAccess } = createGuard(
      { userId: 'teen-1', role: 'teen' },
      false
    )
    const handler = () => undefined
    const request: {
      headers: Record<string, string>
      body: { selection: string | null }
    } = {
      headers: { authorization: 'Bearer teen-token' },
      body: { selection: null },
    }
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
    } as unknown as ExecutionContext
    Reflect.defineMetadata(API_TRANSACTIONAL_CONSENT_KEY, true, handler)
    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(canTeenAccess).not.toHaveBeenCalled()
    request.body.selection = 'love'
    await expect(guard.canActivate(context)).resolves.toBe(true)
    request.body.selection = null
    Reflect.deleteMetadata(API_TRANSACTIONAL_CONSENT_KEY, handler)
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('allows guardian-pending teen on non-upload surfaces while still blocking suspended teens', async () => {
    const handler = () => undefined
    Reflect.defineMetadata(API_ALLOW_PENDING_GUARDIAN_TEEN_KEY, true, handler)
    const request = { headers: { authorization: 'Bearer teen-token' } }
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => class DummyController {},
    } as unknown as ExecutionContext

    const pendingAllowed = createGuard(
      { userId: 'teen-pending', role: 'teen' },
      false,
      true
    )
    await expect(pendingAllowed.guard.canActivate(context)).resolves.toBe(true)
    expect(pendingAllowed.canTeenAccessNonUploadSurface).toHaveBeenCalledWith(
      'teen-pending'
    )
    expect(pendingAllowed.canTeenAccess).not.toHaveBeenCalled()

    const suspendedBlocked = createGuard(
      { userId: 'teen-suspended', role: 'teen' },
      false,
      false
    )
    await expect(suspendedBlocked.guard.canActivate(context)).rejects.toThrow(
      ForbiddenException
    )
    expect(suspendedBlocked.canTeenAccessNonUploadSurface).toHaveBeenCalledWith(
      'teen-suspended'
    )
  })
})

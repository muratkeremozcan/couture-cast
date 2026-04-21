import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { GuardianConsentStateService } from './guardian-consent-state.service'
import { RequestAuthGuard } from './security.guards'

function createExecutionContext(headers: Record<string, string>) {
  const request = { headers } as const

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext
}

function createGuard(teenAccessAllowed = true) {
  const canTeenAccess = vi.fn().mockResolvedValue(teenAccessAllowed)
  const guardianConsentStateService = {
    canTeenAccess,
  } as unknown as GuardianConsentStateService

  return {
    canTeenAccess,
    guard: new RequestAuthGuard(guardianConsentStateService),
  }
}

describe('RequestAuthGuard', () => {
  it('attaches authenticated guardian context from request headers', async () => {
    const { guard, canTeenAccess } = createGuard()
    const context = createExecutionContext({
      authorization: 'Bearer guardian-token',
      'x-user-id': 'guardian-1',
      'x-user-role': 'guardian',
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(canTeenAccess).not.toHaveBeenCalled()
  })

  it('blocks teen requests when guardian consent is still required', async () => {
    const { guard, canTeenAccess } = createGuard(false)
    const context = createExecutionContext({
      authorization: 'Bearer teen-token',
      'x-user-id': 'teen-1',
      'x-user-role': 'teen',
    })

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException)
    expect(canTeenAccess).toHaveBeenCalledWith('teen-1')
  })

  it('allows teen requests once guardian consent is no longer required', async () => {
    const { guard, canTeenAccess } = createGuard(true)
    const context = createExecutionContext({
      authorization: 'Bearer teen-token',
      'x-user-id': 'teen-1',
      'x-user-role': 'teen',
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(canTeenAccess).toHaveBeenCalledWith('teen-1')
  })

  it('rejects requests with missing authentication headers', async () => {
    const { guard } = createGuard()
    const context = createExecutionContext({
      authorization: 'Bearer teen-token',
      'x-user-role': 'teen',
    })

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException)
  })
})

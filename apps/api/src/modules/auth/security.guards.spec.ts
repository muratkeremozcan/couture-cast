import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { RequestAuthGuard } from './security.guards'

function createExecutionContext(headers: Record<string, string>) {
  const request = { headers } as const

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext
}

function createGuard(preferences: unknown = null) {
  const findUnique = vi.fn().mockResolvedValue({
    profile: preferences === undefined ? null : { preferences },
  })
  const prisma = {
    user: {
      findUnique,
    },
  } as unknown as PrismaClient

  return {
    guard: new RequestAuthGuard(prisma),
    findUnique,
  }
}

describe('RequestAuthGuard', () => {
  it('attaches authenticated guardian context from request headers', async () => {
    const { guard, findUnique } = createGuard(undefined)
    const context = createExecutionContext({
      authorization: 'Bearer guardian-token',
      'x-user-id': 'guardian-1',
      'x-user-role': 'guardian',
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('blocks teen requests when guardian consent is still required', async () => {
    const { guard } = createGuard({
      compliance: {
        accountStatus: 'pending_guardian_consent',
        guardianConsentRequired: true,
      },
    })
    const context = createExecutionContext({
      authorization: 'Bearer teen-token',
      'x-user-id': 'teen-1',
      'x-user-role': 'teen',
    })

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException)
  })

  it('allows teen requests once guardian consent is no longer required', async () => {
    const { guard, findUnique } = createGuard({
      compliance: {
        accountStatus: 'active',
        guardianConsentRequired: false,
      },
    })
    const context = createExecutionContext({
      authorization: 'Bearer teen-token',
      'x-user-id': 'teen-1',
      'x-user-role': 'teen',
    })

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'teen-1' },
      select: {
        profile: {
          select: {
            preferences: true,
          },
        },
      },
    })
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

import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { PREMIUM_REQUIRED_MESSAGE } from '../../contracts/http.js'
import { PremiumEntitlementGuard } from './premium-entitlement.guard.js'
import type { PremiumEntitlementService } from './premium-entitlement.service.js'

/**
 * Story 5.2: the guard's three answers, unit level. The same paths are proven
 * over real HTTP in the integration suite; this keeps them covered in the CI
 * unit tier.
 */

function contextFor(auth: { userId: string } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext
}

function guardWith(hasAccess: boolean) {
  const entitlements = { hasPremiumAccess: vi.fn().mockResolvedValue(hasAccess) }
  return {
    guard: new PremiumEntitlementGuard(
      entitlements as unknown as PremiumEntitlementService
    ),
    entitlements,
  }
}

describe('PremiumEntitlementGuard', () => {
  it('passes an entitled user through', async () => {
    const { guard, entitlements } = guardWith(true)

    await expect(guard.canActivate(contextFor({ userId: 'user-1' }))).resolves.toBe(true)
    expect(entitlements.hasPremiumAccess).toHaveBeenCalledWith('user-1')
  })

  it('answers 403 with the exported message for a non-entitled user', async () => {
    const { guard } = guardWith(false)

    const attempt = guard.canActivate(contextFor({ userId: 'user-1' }))
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException)
    await expect(attempt).rejects.toMatchObject({ message: PREMIUM_REQUIRED_MESSAGE })
  })

  it('answers 401, never anonymous-premium, when no auth context exists', async () => {
    // Reaching the guard without RequestAuthGuard is a wiring bug; the answer
    // is unauthenticated, and the entitlement service is never even asked.
    const { guard, entitlements } = guardWith(true)

    await expect(guard.canActivate(contextFor(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException
    )
    expect(entitlements.hasPremiumAccess).not.toHaveBeenCalled()
  })
})

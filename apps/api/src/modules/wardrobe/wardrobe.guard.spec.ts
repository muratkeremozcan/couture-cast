// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
import type { ExecutionContext } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { GuardianService } from '../guardian/guardian.service'
import { WardrobeUploadGuard } from './wardrobe.guard'

describe('WardrobeUploadGuard', () => {
  const mockAssertAllowed = vi.fn()
  const mockGuardianService = {
    assertWardrobeUploadAllowed: mockAssertAllowed,
  } as unknown as GuardianService

  const guard = new WardrobeUploadGuard(mockGuardianService)

  it('returns false when auth context is missing', async () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as unknown as ExecutionContext

    expect(await guard.canActivate(mockContext)).toBe(false)
  })

  it('calls guardianService and returns true when auth is valid', async () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          auth: { userId: 'user_1', role: 'teen' },
        }),
      }),
    } as unknown as ExecutionContext

    expect(await guard.canActivate(mockContext)).toBe(true)
    expect(mockAssertAllowed).toHaveBeenCalledWith('user_1', 'teen')
  })
})

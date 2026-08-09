/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/unbound-method */
import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import type { RequestAuthContext } from '../auth/security.types.js'
import { WardrobeOnboardingController } from './wardrobe-onboarding.controller.js'
import type { WardrobeOnboardingService } from './wardrobe-onboarding.service.js'

describe('WardrobeOnboardingController', () => {
  const stateResponse = {
    data: {
      status: 'in_progress' as const,
      currentStep: 'capture' as const,
      usedStarterWardrobe: false,
      garmentsCapturedCount: 0,
      startedAt: '2026-08-09T10:00:00.000Z',
      completedAt: null,
      revision: 1,
    },
  }

  const createMockService = () =>
    ({
      getState: vi.fn().mockResolvedValue({
        response: stateResponse,
        etag: '"onboarding:user-1:1"',
      }),
      advanceStep: vi.fn().mockResolvedValue({ response: stateResponse, isNoOp: false }),
    }) as unknown as WardrobeOnboardingService

  const createMockRes = () => {
    const headers: Record<string, string> = {}
    return {
      setHeader: vi.fn((key: string, val: string) => {
        headers[key.toLowerCase()] = val
      }),
      headers,
    } as unknown as Response & { headers: Record<string, string> }
  }

  const auth: RequestAuthContext = { token: 'tok', userId: 'user-1', role: 'teen' }

  it('4.4-UNIT-CTRL-01 GET applies the ETag header from the service response', async () => {
    const service = createMockService()
    const controller = new WardrobeOnboardingController(service)
    const res = createMockRes()

    const result = await controller.getState(auth, res)

    expect(result).toBe(stateResponse)
    expect(res.headers.etag).toBe('"onboarding:user-1:1"')
  })

  it('4.4-UNIT-CTRL-02 PATCH parses the body, forwards If-Match, and stamps a fresh ETag', async () => {
    const service = createMockService()
    const controller = new WardrobeOnboardingController(service)
    const res = createMockRes()

    const result = await controller.advanceStep(
      auth,
      '"onboarding:user-1:0"',
      { targetStep: 'capture' },
      res
    )

    expect(service.advanceStep).toHaveBeenCalledWith('user-1', '"onboarding:user-1:0"', {
      targetStep: 'capture',
    })
    expect(result).toBe(stateResponse)
    expect(res.headers.etag).toBe('"onboarding:user-1:1"')
  })

  it('4.4-UNIT-CTRL-03 PATCH rejects a malformed body before reaching the service', async () => {
    const service = createMockService()
    const controller = new WardrobeOnboardingController(service)
    const res = createMockRes()

    await expect(
      controller.advanceStep(
        auth,
        '"onboarding:user-1:0"',
        { targetStep: 'not-a-step' },
        res
      )
    ).rejects.toThrow()
    expect(service.advanceStep).not.toHaveBeenCalled()
  })
})

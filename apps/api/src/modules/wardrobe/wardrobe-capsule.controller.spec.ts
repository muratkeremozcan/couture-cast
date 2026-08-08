/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/unbound-method */
import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import type { RequestAuthContext } from '../auth/security.types.js'
import { WardrobeCapsuleController } from './wardrobe-capsule.controller.js'
import type { WardrobeCapsuleService } from './wardrobe-capsule.service.js'

describe('WardrobeCapsuleController', () => {
  const createMockService = () =>
    ({
      createCapsule: vi.fn().mockResolvedValue({
        data: { id: 'capsule-1', revision: 1 },
        isReplay: false,
      }),
      listCapsules: vi.fn().mockResolvedValue({
        data: [{ id: 'capsule-1', revision: 1 }],
        total: 1,
        limit: 20,
        offset: 0,
      }),
      getCapsule: vi.fn().mockResolvedValue({
        data: { id: 'capsule-1', revision: 1 },
      }),
      updateCapsule: vi.fn().mockResolvedValue({
        data: { id: 'capsule-1', revision: 2 },
      }),
      setFavoriteStatus: vi.fn().mockResolvedValue({
        data: { id: 'capsule-1', revision: 2 },
      }),
      deleteCapsule: vi.fn().mockResolvedValue(undefined),
    }) as unknown as WardrobeCapsuleService

  const createMockRes = () => {
    const headers: Record<string, string> = {}
    return {
      setHeader: vi.fn((key: string, val: string) => {
        headers[key.toLowerCase()] = val
      }),
      status: vi.fn().mockReturnThis(),
      getHeader: (key: string) => headers[key.toLowerCase()],
      headers,
    } as unknown as Response & { headers: Record<string, string> }
  }

  const validActor: RequestAuthContext = { token: 'tok', userId: 'user-1', role: 'teen' }

  it('4.3-UNIT-CTRL-01 throws UnauthorizedException if req.auth is missing', async () => {
    const service = createMockService()
    const controller = new WardrobeCapsuleController(service)
    const res = createMockRes()

    await expect(
      controller.createCapsule(
        {} as any,
        'user-1',
        undefined,
        { name: 'Capsule', occasions: ['casual'], garmentIds: ['g-1', 'g-2'] },
        res
      )
    ).rejects.toThrow(UnauthorizedException)
  })

  it('4.3-UNIT-CTRL-02 creates capsule, sets the ETag, and returns 201', async () => {
    const service = createMockService()
    const controller = new WardrobeCapsuleController(service)
    const res = createMockRes()
    const req = { auth: validActor } as any

    const result = await controller.createCapsule(
      req,
      'user-1',
      '3f1e8c2a-9b47-4d21-8f6e-5a0c7d3b1e94',
      { name: 'My Capsule', occasions: ['work'], garmentIds: ['g-1', 'g-2'] },
      res
    )

    expect(result.data.id).toBe('capsule-1')
    expect(res.setHeader).toHaveBeenCalledWith('ETag', '"capsule:capsule-1:1"')
    expect(res.status).toHaveBeenCalledWith(201)
    /**
     * `isReplay` is transport metadata, not part of the strict response schema
     * clients parse against. Returning it broke every client-side create.
     */
    expect(result).not.toHaveProperty('isReplay')
  })

  it('4.3-UNIT-CTRL-03 returns 200 for an idempotent replay', async () => {
    const service = createMockService()
    vi.mocked(service.createCapsule).mockResolvedValue({
      data: { id: 'capsule-1', revision: 1 },
      isReplay: true,
    } as never)
    const controller = new WardrobeCapsuleController(service)
    const res = createMockRes()
    const req = { auth: validActor } as any

    await controller.createCapsule(
      req,
      'user-1',
      '3f1e8c2a-9b47-4d21-8f6e-5a0c7d3b1e94',
      { name: 'My Capsule', occasions: ['work'], garmentIds: ['g-1', 'g-2'] },
      res
    )

    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('4.3-UNIT-CTRL-04 rejects a non-UUIDv4 Idempotency-Key', async () => {
    const service = createMockService()
    const controller = new WardrobeCapsuleController(service)
    const res = createMockRes()
    const req = { auth: validActor } as any

    await expect(
      controller.createCapsule(
        req,
        'user-1',
        'not-a-uuid',
        { name: 'My Capsule', occasions: ['work'], garmentIds: ['g-1', 'g-2'] },
        res
      )
    ).rejects.toThrow(BadRequestException)
  })

  it('4.3-UNIT-CTRL-05 lists capsules', async () => {
    const service = createMockService()
    const controller = new WardrobeCapsuleController(service)
    const req = { auth: validActor } as any

    const result = await controller.listCapsules(req, 'user-1', { limit: 20, offset: 0 })

    expect(result.total).toBe(1)
  })
})

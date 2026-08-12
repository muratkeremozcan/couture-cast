// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
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

  /**
   * `Idempotency-Key` is optional. Omitting it must reach the service as
   * `undefined` so the create is treated as a fresh request, not rejected.
   */
  it('4.3-UNIT-CTRL-06 accepts a create with no Idempotency-Key at all', async () => {
    const service = createMockService()
    const controller = new WardrobeCapsuleController(service)
    const res = createMockRes()
    const req = { auth: validActor } as any
    const body = { name: 'My Capsule', occasions: ['work'], garmentIds: ['g-1', 'g-2'] }

    await controller.createCapsule(req, 'user-1', undefined, body, res)

    expect(service.createCapsule).toHaveBeenCalledWith(
      validActor,
      'user-1',
      { ...body, isFavorite: false },
      undefined
    )
  })

  /**
   * A supplied-but-blank header is a client bug, not an omission. Treating it as
   * omitted would silently drop the caller's replay protection.
   */
  it('4.3-UNIT-CTRL-07 rejects a blank Idempotency-Key rather than treating it as absent', async () => {
    const service = createMockService()
    const controller = new WardrobeCapsuleController(service)
    const res = createMockRes()
    const req = { auth: validActor } as any

    await expect(
      controller.createCapsule(
        req,
        'user-1',
        '   ',
        { name: 'My Capsule', occasions: ['work'], garmentIds: ['g-1', 'g-2'] },
        res
      )
    ).rejects.toThrow('Idempotency-Key must not be empty when supplied')
    expect(service.createCapsule).not.toHaveBeenCalled()
  })

  /** A UUIDv1 is a valid UUID but not the v4 the contract requires. */
  it('4.3-UNIT-CTRL-08 rejects a non-v4 UUID Idempotency-Key', async () => {
    const service = createMockService()
    const controller = new WardrobeCapsuleController(service)
    const res = createMockRes()
    const req = { auth: validActor } as any

    await expect(
      controller.createCapsule(
        req,
        'user-1',
        '3f1e8c2a-9b47-1d21-8f6e-5a0c7d3b1e94',
        { name: 'My Capsule', occasions: ['work'], garmentIds: ['g-1', 'g-2'] },
        res
      )
    ).rejects.toThrow('Idempotency-Key must be a UUID v4')
  })

  it('4.3-UNIT-CTRL-09 rejects a create body that violates the canonical contract', async () => {
    const service = createMockService()
    const controller = new WardrobeCapsuleController(service)
    const res = createMockRes()
    const req = { auth: validActor } as any

    await expect(
      controller.createCapsule(req, 'user-1', undefined, { name: 'Solo' }, res)
    ).rejects.toThrow()
    expect(service.createCapsule).not.toHaveBeenCalled()
  })

  it('4.3-UNIT-CTRL-09a requires authentication before listing capsules', async () => {
    const service = createMockService()
    const controller = new WardrobeCapsuleController(service)

    await expect(
      controller.listCapsules({} as any, 'user-1', { limit: 20, offset: 0 })
    ).rejects.toThrow(UnauthorizedException)
    expect(service.listCapsules).not.toHaveBeenCalled()
  })

  it('4.3-UNIT-CTRL-10 rejects an owner id longer than the contract allows', async () => {
    const service = createMockService()
    const controller = new WardrobeCapsuleController(service)
    const req = { auth: validActor } as any

    await expect(
      controller.listCapsules(req, 'u'.repeat(129), { limit: 20, offset: 0 })
    ).rejects.toThrow()
    expect(service.listCapsules).not.toHaveBeenCalled()
  })

  describe('getCapsule', () => {
    it('4.3-UNIT-CTRL-11 stamps the ETag from the returned revision', async () => {
      const service = createMockService()
      const controller = new WardrobeCapsuleController(service)
      const res = createMockRes()
      const req = { auth: validActor } as any

      const result = await controller.getCapsule(req, 'user-1', 'capsule-1', res)

      expect(result.data.id).toBe('capsule-1')
      expect(res.headers.etag).toBe('"capsule:capsule-1:1"')
      expect(service.getCapsule).toHaveBeenCalledWith(validActor, 'user-1', 'capsule-1')
    })

    it('4.3-UNIT-CTRL-12 requires authentication', async () => {
      const service = createMockService()
      const controller = new WardrobeCapsuleController(service)
      const res = createMockRes()

      await expect(
        controller.getCapsule({} as any, 'user-1', 'capsule-1', res)
      ).rejects.toThrow(UnauthorizedException)
    })

    it('4.3-UNIT-CTRL-13 rejects an empty capsule id path segment', async () => {
      const service = createMockService()
      const controller = new WardrobeCapsuleController(service)
      const res = createMockRes()
      const req = { auth: validActor } as any

      await expect(controller.getCapsule(req, 'user-1', '', res)).rejects.toThrow()
      expect(service.getCapsule).not.toHaveBeenCalled()
    })
  })

  describe('updateCapsule', () => {
    it('4.3-UNIT-CTRL-14 forwards If-Match untouched and stamps the new revision', async () => {
      const service = createMockService()
      const controller = new WardrobeCapsuleController(service)
      const res = createMockRes()
      const req = { auth: validActor } as any

      const result = await controller.updateCapsule(
        req,
        'user-1',
        'capsule-1',
        '"capsule:capsule-1:1"',
        { name: 'Renamed' },
        res
      )

      expect(result.data.revision).toBe(2)
      /** Precondition semantics belong to the service, so the header passes through raw. */
      expect(service.updateCapsule).toHaveBeenCalledWith(
        validActor,
        'user-1',
        'capsule-1',
        '"capsule:capsule-1:1"',
        { name: 'Renamed' }
      )
      expect(res.headers.etag).toBe('"capsule:capsule-1:2"')
    })

    it('4.3-UNIT-CTRL-15 requires authentication', async () => {
      const service = createMockService()
      const controller = new WardrobeCapsuleController(service)
      const res = createMockRes()

      await expect(
        controller.updateCapsule(
          {} as any,
          'user-1',
          'capsule-1',
          '*',
          { name: 'Renamed' },
          res
        )
      ).rejects.toThrow(UnauthorizedException)
    })

    it('4.3-UNIT-CTRL-16 rejects an unknown field on the update body', async () => {
      const service = createMockService()
      const controller = new WardrobeCapsuleController(service)
      const res = createMockRes()
      const req = { auth: validActor } as any

      await expect(
        controller.updateCapsule(req, 'user-1', 'capsule-1', '*', { revision: 9 }, res)
      ).rejects.toThrow()
      expect(service.updateCapsule).not.toHaveBeenCalled()
    })
  })

  describe('setFavoriteStatus', () => {
    it('4.3-UNIT-CTRL-17 forwards the favorite flag and stamps the new revision', async () => {
      const service = createMockService()
      const controller = new WardrobeCapsuleController(service)
      const res = createMockRes()
      const req = { auth: validActor } as any

      const result = await controller.setFavoriteStatus(
        req,
        'user-1',
        'capsule-1',
        '"capsule:capsule-1:1"',
        { isFavorite: true },
        res
      )

      expect(result.data.revision).toBe(2)
      expect(service.setFavoriteStatus).toHaveBeenCalledWith(
        validActor,
        'user-1',
        'capsule-1',
        '"capsule:capsule-1:1"',
        { isFavorite: true }
      )
      expect(res.headers.etag).toBe('"capsule:capsule-1:2"')
    })

    it('4.3-UNIT-CTRL-18 requires authentication', async () => {
      const service = createMockService()
      const controller = new WardrobeCapsuleController(service)
      const res = createMockRes()

      await expect(
        controller.setFavoriteStatus(
          {} as any,
          'user-1',
          'capsule-1',
          '*',
          { isFavorite: true },
          res
        )
      ).rejects.toThrow(UnauthorizedException)
    })

    it('4.3-UNIT-CTRL-19 rejects a non-boolean favorite flag', async () => {
      const service = createMockService()
      const controller = new WardrobeCapsuleController(service)
      const res = createMockRes()
      const req = { auth: validActor } as any

      await expect(
        controller.setFavoriteStatus(
          req,
          'user-1',
          'capsule-1',
          '*',
          { isFavorite: 'yes' },
          res
        )
      ).rejects.toThrow()
      expect(service.setFavoriteStatus).not.toHaveBeenCalled()
    })
  })

  describe('deleteCapsule', () => {
    it('4.3-UNIT-CTRL-20 forwards If-Match to the service and returns no body', async () => {
      const service = createMockService()
      const controller = new WardrobeCapsuleController(service)
      const req = { auth: validActor } as any

      const result = await controller.deleteCapsule(
        req,
        'user-1',
        'capsule-1',
        '"capsule:capsule-1:1"'
      )

      expect(result).toBeUndefined()
      expect(service.deleteCapsule).toHaveBeenCalledWith(
        validActor,
        'user-1',
        'capsule-1',
        '"capsule:capsule-1:1"'
      )
    })

    it('4.3-UNIT-CTRL-21 requires authentication', async () => {
      const service = createMockService()
      const controller = new WardrobeCapsuleController(service)

      await expect(
        controller.deleteCapsule({} as any, 'user-1', 'capsule-1', '*')
      ).rejects.toThrow(UnauthorizedException)
      expect(service.deleteCapsule).not.toHaveBeenCalled()
    })

    it('4.3-UNIT-CTRL-22 rejects a capsule id longer than the contract allows', async () => {
      const service = createMockService()
      const controller = new WardrobeCapsuleController(service)
      const req = { auth: validActor } as any

      await expect(
        controller.deleteCapsule(req, 'user-1', 'c'.repeat(129), '*')
      ).rejects.toThrow()
      expect(service.deleteCapsule).not.toHaveBeenCalled()
    })
  })
})

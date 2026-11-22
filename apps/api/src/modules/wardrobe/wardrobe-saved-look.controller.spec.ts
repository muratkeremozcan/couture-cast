// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import { BadRequestException, HttpStatus, UnauthorizedException } from '@nestjs/common'
import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedRequest } from '../auth/security.types.js'
import { WardrobeSavedLookController } from './wardrobe-saved-look.controller.js'
import type { WardrobeSavedLookService } from './wardrobe-saved-look.service.js'

function createResponse() {
  const setHeader = vi.fn()
  const status = vi.fn()
  return {
    res: { setHeader, status } as unknown as Response,
    setHeader,
    status,
  }
}

function makeContract() {
  return {
    id: 'sl-1',
    ownerUserId: 'user-1',
    source: 'home_sample' as const,
    lookId: 'look-01',
    weather: 'mild-dry',
    title: null,
    anchorGarmentId: null,
    anchorSnapshot: null,
    composition: [
      {
        slotIndex: 0,
        category: 'top' as const,
        kind: 'catalog' as const,
        itemId: 'sample:g:top-1',
        label: null,
        missing: false,
        imageAccess: null,
      },
    ],
    swaps: {},
    collection: 'all',
    comfort: {
      runsColdWarm: 'neutral' as const,
      windTolerance: 'medium' as const,
      precipPreparedness: 'medium' as const,
    },
    availabilityStatus: 'ready' as const,
    missingGarmentIds: [],
    needsReviewReasons: [],
    revision: 0,
    createdAt: '2026-11-22T01:00:00.000Z',
    updatedAt: '2026-11-22T01:00:00.000Z',
  }
}

describe('WardrobeSavedLookController', () => {
  it('validates auth, payload, UUID v4 Idempotency-Key, and sets ETag + status on create', async () => {
    const service = {
      createSavedLook: vi.fn(),
      listSavedLooks: vi.fn(),
      getSavedLook: vi.fn(),
      deleteSavedLook: vi.fn(),
    }
    const controller = new WardrobeSavedLookController(
      service as unknown as WardrobeSavedLookService
    )
    const req = {
      auth: { userId: 'user-1', role: 'teen', token: 'tok' },
    } as AuthenticatedRequest
    const { res, setHeader, status } = createResponse()

    await expect(
      controller.createSavedLook({} as AuthenticatedRequest, undefined, {}, res)
    ).rejects.toThrow(UnauthorizedException)

    await expect(
      controller.createSavedLook(req, undefined, { invalid: true }, res)
    ).rejects.toThrow(BadRequestException)

    const validBody = {
      source: 'home_sample',
      lookId: 'look-01',
      weather: 'mild-dry',
      composition: [
        { slotIndex: 0, category: 'top', kind: 'catalog', itemId: 'sample:g:top-1' },
      ],
      swaps: {},
      collection: 'all',
      comfort: {
        runsColdWarm: 'neutral',
        windTolerance: 'medium',
        precipPreparedness: 'medium',
      },
    }

    await expect(
      controller.createSavedLook(req, 'not-a-uuid', validBody, res)
    ).rejects.toThrow(BadRequestException)

    service.createSavedLook.mockResolvedValueOnce({
      data: makeContract(),
      isReplay: false,
    })
    const created = await controller.createSavedLook(
      req,
      '11111111-1111-4111-8111-111111111111',
      validBody,
      res
    )
    expect(created.data.id).toBe('sl-1')
    expect(setHeader).toHaveBeenCalledWith('ETag', '"saved-look:sl-1:0"')
    expect(status).toHaveBeenCalledWith(HttpStatus.CREATED)

    service.createSavedLook.mockResolvedValueOnce({
      data: makeContract(),
      isReplay: true,
    })
    await controller.createSavedLook(
      req,
      '11111111-1111-4111-8111-111111111111',
      validBody,
      res
    )
    expect(status).toHaveBeenCalledWith(HttpStatus.OK)
  })

  it('lists, gets with ETag, and deletes saved looks', async () => {
    const service = {
      createSavedLook: vi.fn(),
      listSavedLooks: vi.fn().mockResolvedValue({
        data: [makeContract()],
        total: 1,
        limit: 50,
        offset: 0,
      }),
      getSavedLook: vi.fn().mockResolvedValue({ data: makeContract() }),
      deleteSavedLook: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new WardrobeSavedLookController(
      service as unknown as WardrobeSavedLookService
    )
    const req = {
      auth: { userId: 'user-1', role: 'guardian', token: 'tok' },
    } as unknown as AuthenticatedRequest
    const { res, setHeader } = createResponse()

    const listed = await controller.listSavedLooks(req, { source: 'home_sample' })
    expect(listed.total).toBe(1)

    const fetched = await controller.getSavedLook(req, 'sl-1', res)
    expect(fetched.data.id).toBe('sl-1')
    expect(setHeader).toHaveBeenCalledWith('ETag', '"saved-look:sl-1:0"')

    await expect(
      controller.deleteSavedLook(req, 'sl-1', '"saved-look:sl-1:0"')
    ).resolves.toBeUndefined()
    expect(service.deleteSavedLook).toHaveBeenCalledWith(
      req.auth,
      'sl-1',
      '"saved-look:sl-1:0"'
    )
  })
})

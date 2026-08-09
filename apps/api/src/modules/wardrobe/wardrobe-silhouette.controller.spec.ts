/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/unbound-method */
import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import type { RequestAuthContext } from '../auth/security.types.js'
import { WardrobeSilhouetteController } from './wardrobe-silhouette.controller.js'
import type { WardrobeSilhouetteService } from './wardrobe-silhouette.service.js'

describe('WardrobeSilhouetteController', () => {
  const profileResponse = {
    data: {
      mode: 'default_mannequin' as const,
      heightSlider: 50,
      buildSlider: 50,
      myForm: null,
      revision: 1,
      updatedAt: '2026-08-09T10:00:00.000Z',
    },
  }

  const uploadUrlResponse = {
    data: {
      uploadSessionId: 'session-1',
      uploadUrl:
        'http://localhost:3001/api/v1/wardrobe/silhouette/my-form/uploads/session-1',
      uploadToken: 'token',
      requiredHeaders: { 'content-type': 'image/png' as const },
      expiresAt: '2026-08-09T10:15:00.000Z',
    },
  }

  const createMockService = () =>
    ({
      getProfile: vi.fn().mockResolvedValue({
        response: profileResponse,
        etag: '"silhouette:user-1:1"',
      }),
      updateSliders: vi
        .fn()
        .mockResolvedValue({ response: profileResponse, isNoOp: false }),
      createMyFormUploadUrl: vi
        .fn()
        .mockResolvedValue({ replayed: false, response: uploadUrlResponse }),
      uploadMyFormBytes: vi.fn().mockResolvedValue(undefined),
      commitMyForm: vi
        .fn()
        .mockResolvedValue({ replayed: false, response: profileResponse }),
      deleteMyForm: vi.fn().mockResolvedValue({ response: profileResponse }),
    }) as unknown as WardrobeSilhouetteService

  const createMockRes = () => {
    const headers: Record<string, string> = {}
    return {
      setHeader: vi.fn((key: string, val: string) => {
        headers[key.toLowerCase()] = val
      }),
      status: vi.fn().mockReturnThis(),
      headers,
    } as unknown as Response & { headers: Record<string, string> }
  }

  const auth: RequestAuthContext = { token: 'tok', userId: 'user-1', role: 'teen' }

  it('4.4-UNIT-CTRL-04 GET applies the ETag header', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const res = createMockRes()

    const result = await controller.getProfile(auth, res)

    expect(result).toBe(profileResponse)
    expect(res.headers.etag).toBe('"silhouette:user-1:1"')
  })

  it('4.4-UNIT-CTRL-05 PUT parses sliders, forwards If-Match, and stamps a fresh ETag', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const res = createMockRes()

    await controller.updateSliders(
      auth,
      '"silhouette:user-1:0"',
      { heightSlider: 40, buildSlider: 60 },
      res
    )

    expect(service.updateSliders).toHaveBeenCalledWith(
      'user-1',
      '"silhouette:user-1:0"',
      {
        heightSlider: 40,
        buildSlider: 60,
      }
    )
    expect(res.headers.etag).toBe('"silhouette:user-1:1"')
  })

  it('4.4-UNIT-CTRL-06 POST upload-url rejects a non-UUID idempotency key before reaching the service', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const res = createMockRes()

    await expect(
      controller.createMyFormUploadUrl(
        auth,
        'not-a-uuid',
        {
          fileSizeBytes: 100,
          mimeType: 'image/png',
          sha256: '0'.repeat(64),
          widthPx: 300,
          heightPx: 800,
        },
        res
      )
    ).rejects.toThrow()
    expect(service.createMyFormUploadUrl).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-CTRL-06 POST upload-url returns 201 for a fresh allocation and 200 for a replay', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const validBody = {
      fileSizeBytes: 100,
      mimeType: 'image/png' as const,
      sha256: '0'.repeat(64),
      widthPx: 300,
      heightPx: 800,
    }
    const idempotencyKey = '4b6b3b0a-1c8a-4a9e-8b8e-1a2b3c4d5e6f'

    const freshRes = createMockRes()
    await controller.createMyFormUploadUrl(auth, idempotencyKey, validBody, freshRes)
    expect(freshRes.status).toHaveBeenCalledWith(201)
    ;(service.createMyFormUploadUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      replayed: true,
      response: uploadUrlResponse,
    })
    const replayRes = createMockRes()
    await controller.createMyFormUploadUrl(auth, idempotencyKey, validBody, replayRes)
    expect(replayRes.status).toHaveBeenCalledWith(200)
  })

  it('4.4-UNIT-CTRL-07 PUT bytes rejects a missing upload token before reaching the service', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const request = { body: Buffer.from('bytes') } as unknown as Request

    await expect(
      controller.uploadMyFormBytes(auth, 'session-1', '', 'image/png', '5', request)
    ).rejects.toThrow('Missing upload token header')
    expect(service.uploadMyFormBytes).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-CTRL-07 PUT bytes rejects an unsupported mime type before reaching the service', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const request = { body: Buffer.from('bytes') } as unknown as Request

    await expect(
      controller.uploadMyFormBytes(
        auth,
        'session-1',
        'token',
        'application/pdf',
        '5',
        request
      )
    ).rejects.toThrow()
    expect(service.uploadMyFormBytes).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-CTRL-08 POST commit rejects a non-UUID idempotency key before reaching the service', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const res = createMockRes()

    await expect(
      controller.commitMyForm(
        auth,
        'not-a-uuid',
        { uploadSessionId: 'session-1', confirmsBasewearGuidance: true },
        res
      )
    ).rejects.toThrow()
    expect(service.commitMyForm).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-CTRL-08 POST commit stamps a fresh ETag on success', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const res = createMockRes()

    await controller.commitMyForm(
      auth,
      '4b6b3b0a-1c8a-4a9e-8b8e-1a2b3c4d5e6f',
      { uploadSessionId: 'session-1', confirmsBasewearGuidance: true },
      res
    )
    expect(res.headers.etag).toBe('"silhouette:user-1:1"')
  })

  it('4.4-UNIT-CTRL-08 POST commit returns 201 for a fresh commit and 200 for a replay', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const idempotencyKey = '4b6b3b0a-1c8a-4a9e-8b8e-1a2b3c4d5e6f'
    const body = { uploadSessionId: 'session-1', confirmsBasewearGuidance: true as const }

    const freshRes = createMockRes()
    await controller.commitMyForm(auth, idempotencyKey, body, freshRes)
    expect(freshRes.status).toHaveBeenCalledWith(201)
    ;(service.commitMyForm as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      replayed: true,
      response: profileResponse,
    })
    const replayRes = createMockRes()
    await controller.commitMyForm(auth, idempotencyKey, body, replayRes)
    expect(replayRes.status).toHaveBeenCalledWith(200)
  })

  it('4.4-UNIT-CTRL-09 DELETE forwards If-Match and stamps a fresh ETag', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const res = createMockRes()

    await controller.deleteMyForm(auth, '"silhouette:user-1:3"', res)

    expect(service.deleteMyForm).toHaveBeenCalledWith('user-1', '"silhouette:user-1:3"')
    expect(res.headers.etag).toBe('"silhouette:user-1:1"')
  })
})

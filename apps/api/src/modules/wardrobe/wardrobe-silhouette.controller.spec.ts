/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/unbound-method */
import { PayloadTooLargeException, type ExecutionContext } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import type { Request, Response } from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { WardrobeUploadGuard } from './wardrobe.guard.js'
import { MAX_SILHOUETTE_PHOTO_BYTES } from './wardrobe-silhouette-image-validation.js'
import { WardrobeSilhouetteController } from './wardrobe-silhouette.controller.js'
import { WardrobeSilhouetteService } from './wardrobe-silhouette.service.js'

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

  /**
   * The mock-`res` case above only proves the controller *asks* for 200/201.
   * Whether the wire agrees is Nest's decision, not ours: it applies the
   * route's default status before the handler runs and then hands the
   * adapter `undefined`, which is the only reason a `res.status()` call
   * inside a `@Res({ passthrough: true })` handler survives instead of being
   * overwritten back to a POST's 201. That is framework behavior this
   * codebase now depends on but does not own, so pin it with a real HTTP
   * round trip -- otherwise a Nest upgrade could silently turn every replay
   * back into a 201 with all the spec-level assertions still green.
   */
  it('4.4-UNIT-CTRL-08 POST commit answers a real 201 fresh and a real 200 on replay', async () => {
    const service = createMockService()
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [WardrobeSilhouetteController],
      providers: [{ provide: WardrobeSilhouetteService, useValue: service }],
    })
      .overrideGuard(RequestAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ auth: RequestAuthContext }>().auth = auth
          return true
        },
      })
      .overrideGuard(WardrobeUploadGuard)
      .useValue({ canActivate: () => true })
      .compile()

    const app = moduleFixture.createNestApplication()
    await app.init()

    try {
      const postCommit = () =>
        request(app.getHttpServer() as Parameters<typeof request>[0])
          .post('/api/v1/wardrobe/silhouette/my-form/commit')
          .set('Idempotency-Key', '4b6b3b0a-1c8a-4a9e-8b8e-1a2b3c4d5e6f')
          .send({ uploadSessionId: 'session-1', confirmsBasewearGuidance: true })

      const fresh = await postCommit()
      expect(fresh.status).toBe(201)
      expect(fresh.headers.etag).toBe('"silhouette:user-1:1"')
      ;(service.commitMyForm as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        replayed: true,
        response: profileResponse,
      })
      const replay = await postCommit()
      expect(replay.status).toBe(200)
      expect(replay.headers.etag).toBe('"silhouette:user-1:1"')
    } finally {
      await app.close()
    }
  })

  /**
   * A rejected payload must name the offending field. A bare "Bad Request" gives
   * a client nothing to correct, and the contract publishes this message prefix.
   */
  it('4.4-UNIT-CTRL-05a PUT names the slider field that failed validation', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const res = createMockRes()

    await expect(
      controller.updateSliders(auth, '*', { heightSlider: 400, buildSlider: 50 }, res)
    ).rejects.toThrow(/Invalid silhouette sliders: heightSlider/)
    expect(service.updateSliders).not.toHaveBeenCalled()
  })

  /** A whole-body failure has no field path, so it is reported against the request. */
  it('4.4-UNIT-CTRL-05b PUT reports a non-object body against the request itself', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const res = createMockRes()

    await expect(
      controller.updateSliders(auth, '*', 'not-an-object', res)
    ).rejects.toThrow(/Invalid silhouette sliders: request/)
  })

  it('4.4-UNIT-CTRL-06a POST upload-url rejects a declaration outside the contract', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const res = createMockRes()

    await expect(
      controller.createMyFormUploadUrl(
        auth,
        '4b6b3b0a-1c8a-4a9e-8b8e-1a2b3c4d5e6f',
        {
          fileSizeBytes: 100,
          mimeType: 'image/gif',
          sha256: '0'.repeat(64),
          widthPx: 300,
          heightPx: 800,
        },
        res
      )
    ).rejects.toThrow(/Invalid upload declaration: mimeType/)
    expect(service.createMyFormUploadUrl).not.toHaveBeenCalled()
  })

  it('4.4-UNIT-CTRL-08a POST commit rejects a payload outside the contract', async () => {
    const service = createMockService()
    const controller = new WardrobeSilhouetteController(service)
    const res = createMockRes()

    await expect(
      controller.commitMyForm(
        auth,
        '4b6b3b0a-1c8a-4a9e-8b8e-1a2b3c4d5e6f',
        { uploadSessionId: 'session-1', confirmsBasewearGuidance: false },
        res
      )
    ).rejects.toThrow(/Invalid commit payload: confirmsBasewearGuidance/)
    expect(service.commitMyForm).not.toHaveBeenCalled()
  })

  describe('4.4-UNIT-CTRL-07 PUT my-form bytes', () => {
    it('forwards the declared length and body to the service', async () => {
      const service = createMockService()
      const controller = new WardrobeSilhouetteController(service)
      const body = Buffer.from('silhouette-bytes')
      const req = { body } as unknown as Request

      await controller.uploadMyFormBytes(
        auth,
        'session-1',
        'token',
        'image/png',
        String(body.length),
        req
      )

      expect(service.uploadMyFormBytes).toHaveBeenCalledWith(
        'session-1',
        'token',
        'user-1',
        'teen',
        'image/png',
        body.length,
        body
      )
    })

    /**
     * `req.body` is only a Buffer when the raw-body parser matched. Anything else
     * must arrive as empty bytes so the declared-length check rejects it, rather
     * than as a value the image verifier would choke on.
     */
    it('substitutes empty bytes when the raw body is not a Buffer', async () => {
      const service = createMockService()
      const controller = new WardrobeSilhouetteController(service)
      const req = { body: { parsed: 'json' } } as unknown as Request

      await controller.uploadMyFormBytes(
        auth,
        'session-1',
        'token',
        'image/jpeg',
        '0',
        req
      )

      const forwarded = (service.uploadMyFormBytes as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[6] as unknown
      expect(Buffer.isBuffer(forwarded)).toBe(true)
      expect(forwarded).toHaveLength(0)
    })

    it('forwards an absent content-length header as undefined', async () => {
      const service = createMockService()
      const controller = new WardrobeSilhouetteController(service)
      const req = { body: Buffer.alloc(4) } as unknown as Request

      await controller.uploadMyFormBytes(
        auth,
        'session-1',
        'token',
        'image/webp',
        undefined,
        req
      )

      expect(
        (service.uploadMyFormBytes as ReturnType<typeof vi.fn>).mock.calls[0]?.[5]
      ).toBeUndefined()
    })

    /**
     * A non-numeric Content-Length parses to NaN. Forwarding NaN would make the
     * service's declared-length comparison pass by accident.
     */
    it('drops an unparseable content-length rather than forwarding NaN', async () => {
      const service = createMockService()
      const controller = new WardrobeSilhouetteController(service)
      const req = { body: Buffer.alloc(4) } as unknown as Request

      await controller.uploadMyFormBytes(
        auth,
        'session-1',
        'token',
        'image/png',
        'not-a-number',
        req
      )

      expect(
        (service.uploadMyFormBytes as ReturnType<typeof vi.fn>).mock.calls[0]?.[5]
      ).toBeUndefined()
    })

    /** The ceiling is enforced before any bytes are read or stored. */
    it('rejects a declared length above the photo ceiling', async () => {
      const service = createMockService()
      const controller = new WardrobeSilhouetteController(service)
      const req = { body: Buffer.alloc(4) } as unknown as Request

      await expect(
        controller.uploadMyFormBytes(
          auth,
          'session-1',
          'token',
          'image/png',
          String(MAX_SILHOUETTE_PHOTO_BYTES + 1),
          req
        )
      ).rejects.toThrow(PayloadTooLargeException)
      expect(service.uploadMyFormBytes).not.toHaveBeenCalled()
    })

    it('rejects an empty upload session path segment', async () => {
      const service = createMockService()
      const controller = new WardrobeSilhouetteController(service)
      const req = { body: Buffer.alloc(4) } as unknown as Request

      await expect(
        controller.uploadMyFormBytes(auth, '', 'token', 'image/png', '4', req)
      ).rejects.toThrow()
      expect(service.uploadMyFormBytes).not.toHaveBeenCalled()
    })
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

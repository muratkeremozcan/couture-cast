// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/unbound-method */
import type { ExecutionContext } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import type { Response } from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { listenHttpApp } from '../../testing/loopback-http-app.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { WardrobeUploadGuard } from './wardrobe.guard.js'
import { WardrobeSilhouetteController } from './wardrobe-silhouette.controller.js'
import { WardrobeSilhouetteService } from './wardrobe-silhouette.service.js'

describe('WardrobeSilhouetteController', () => {
  /** A well-formed idempotency key; the exact value is never asserted on. */
  const VALID_IDEMPOTENCY_KEY = '4b6b3b0a-1c8a-4a9e-8b8e-1a2b3c4d5e6f'

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
        'https://storage.test/storage/v1/object/upload/sign/wardrobe-images/user-1/silhouette/session-1.png?token=signed',
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

  describe('getProfile', () => {
    it('4.4-UNIT-CTRL-04 GET applies the ETag header', async () => {
      const service = createMockService()
      const controller = new WardrobeSilhouetteController(service)
      const res = createMockRes()

      const result = await controller.getProfile(auth, res)

      expect(result).toBe(profileResponse)
      expect(res.headers.etag).toBe('"silhouette:user-1:1"')
    })
  })

  describe('updateSliders', () => {
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
  })

  describe('createMyFormUploadUrl', () => {
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

      const freshRes = createMockRes()
      await controller.createMyFormUploadUrl(
        auth,
        VALID_IDEMPOTENCY_KEY,
        validBody,
        freshRes
      )
      expect(freshRes.status).toHaveBeenCalledWith(201)
      ;(service.createMyFormUploadUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        replayed: true,
        response: uploadUrlResponse,
      })
      const replayRes = createMockRes()
      await controller.createMyFormUploadUrl(
        auth,
        VALID_IDEMPOTENCY_KEY,
        validBody,
        replayRes
      )
      expect(replayRes.status).toHaveBeenCalledWith(200)
    })

    it('4.4-UNIT-CTRL-06a POST upload-url rejects a declaration outside the contract', async () => {
      const service = createMockService()
      const controller = new WardrobeSilhouetteController(service)
      const res = createMockRes()

      await expect(
        controller.createMyFormUploadUrl(
          auth,
          VALID_IDEMPOTENCY_KEY,
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
  })

  describe('4.4-UNIT-CTRL-07 My Form bytes go straight to storage', () => {
    /**
     * The byte relay through this API is gone: a Vercel Function refuses a body over about
     * 4.5 MB, so clients PUT to the storage signed URL from upload-url instead.
     */
    it('serves no PUT route for My Form bytes', async () => {
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

      try {
        const baseUrl = await listenHttpApp(app)
        const response = await request(baseUrl)
          .put('/api/v1/wardrobe/silhouette/my-form/uploads/session-1')
          .set('Content-Type', 'image/png')
          .set('X-Upload-Token', 'token')
          .send(Buffer.from('silhouette-bytes'))

        expect(response.status).toBe(404)
      } finally {
        await app.close()
      }
    })
  })

  describe('commitMyForm', () => {
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
        VALID_IDEMPOTENCY_KEY,
        { uploadSessionId: 'session-1', confirmsBasewearGuidance: true },
        res
      )
      expect(res.headers.etag).toBe('"silhouette:user-1:1"')
    })

    it('4.4-UNIT-CTRL-08 POST commit returns 201 for a fresh commit and 200 for a replay', async () => {
      const service = createMockService()
      const controller = new WardrobeSilhouetteController(service)
      const body = {
        uploadSessionId: 'session-1',
        confirmsBasewearGuidance: true as const,
      }

      const freshRes = createMockRes()
      await controller.commitMyForm(auth, VALID_IDEMPOTENCY_KEY, body, freshRes)
      expect(freshRes.status).toHaveBeenCalledWith(201)
      ;(service.commitMyForm as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        replayed: true,
        response: profileResponse,
      })
      const replayRes = createMockRes()
      await controller.commitMyForm(auth, VALID_IDEMPOTENCY_KEY, body, replayRes)
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

      try {
        // Handing supertest the bare server makes it listen(0) on the dual-stack
        // wildcard and then request 127.0.0.1. macOS can give that wildcard a port
        // another process already holds on 127.0.0.1, and that more specific
        // listener answers instead: a 401, 404 or reset from an unrelated local
        // process, a few times per 10,000 requests on a developer machine. A listener
        // bound to 127.0.0.1 owns its port or fails to bind, so every request
        // reaches this app.
        const baseUrl = await listenHttpApp(app)
        const postCommit = () =>
          request(baseUrl)
            .post('/api/v1/wardrobe/silhouette/my-form/commit')
            .set('Idempotency-Key', VALID_IDEMPOTENCY_KEY)
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

    it('4.4-UNIT-CTRL-08a POST commit rejects a payload outside the contract', async () => {
      const service = createMockService()
      const controller = new WardrobeSilhouetteController(service)
      const res = createMockRes()

      await expect(
        controller.commitMyForm(
          auth,
          VALID_IDEMPOTENCY_KEY,
          { uploadSessionId: 'session-1', confirmsBasewearGuidance: false },
          res
        )
      ).rejects.toThrow(/Invalid commit payload: confirmsBasewearGuidance/)
      expect(service.commitMyForm).not.toHaveBeenCalled()
    })
  })

  describe('deleteMyForm', () => {
    it('4.4-UNIT-CTRL-09 DELETE forwards If-Match and stamps a fresh ETag', async () => {
      const service = createMockService()
      const controller = new WardrobeSilhouetteController(service)
      const res = createMockRes()

      await controller.deleteMyForm(auth, '"silhouette:user-1:3"', res)

      expect(service.deleteMyForm).toHaveBeenCalledWith('user-1', '"silhouette:user-1:3"')
      expect(res.headers.etag).toBe('"silhouette:user-1:1"')
    })
  })
})

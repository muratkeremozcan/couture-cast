// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Story 4.4 Task 7 step 1 owner: prove the silhouette-slider and "My Form"
// Zod schemas parse and reject correctly, mirroring wardrobe-contract.spec.ts's
// structure.
import { beforeAll, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  commitSilhouettePhotoInputSchema,
  createSilhouetteUploadUrlInputSchema,
  createSilhouetteUploadUrlResponseSchema,
  generateHttpOpenApiDocument,
  silhouetteMyFormSchema,
  silhouetteProfileResponseSchema,
  silhouetteProfileSchema,
  updateSilhouetteSlidersInputSchema,
} from '../src/contracts/http'

const VALID_SHA256 = 'ba9d325931fa708929de6fdc7d90728bf50bffbc1cbfcaa7e2e2275c175dc0b3'

function buildUploadInput(overrides: Record<string, unknown> = {}) {
  return {
    fileSizeBytes: 2048576,
    mimeType: 'image/png',
    sha256: VALID_SHA256,
    widthPx: 1024,
    heightPx: 1536,
    ...overrides,
  }
}

function buildSilhouetteProfile(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'default_mannequin',
    heightSlider: 50,
    buildSlider: 50,
    myForm: null,
    revision: 1,
    updatedAt: '2026-08-09T09:05:00.000Z',
    ...overrides,
  }
}

function buildMyForm(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ready',
    failureReason: null,
    committedAt: '2026-08-09T09:10:00.000Z',
    imageAccess: {
      url: 'https://example.test/silhouette-my-form.png',
      expiresAt: '2026-08-09T09:25:00.000Z',
    },
    ...overrides,
  }
}

function expectIssuePath(schema: z.ZodType, input: unknown, expectedPath: string): void {
  const result = schema.safeParse(input)
  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(
      expectedPath
    )
  }
}

describe('Wardrobe Silhouette HTTP Contracts', () => {
  describe('Schema Validation', () => {
    it('validates the default mannequin profile shape', () => {
      const profile = buildSilhouetteProfile()
      expect(silhouetteProfileSchema.parse(profile)).toEqual(profile)
      expect(silhouetteProfileResponseSchema.parse({ data: profile }).data.mode).toBe(
        'default_mannequin'
      )
    })

    it('validates a ready My Form profile with image access', () => {
      const profile = buildSilhouetteProfile({ mode: 'my_form', myForm: buildMyForm() })
      expect(silhouetteProfileSchema.parse(profile).myForm?.status).toBe('ready')
    })

    it('validates every documented My Form failure reason (decision 5)', () => {
      const reasons = [
        'contrast',
        'privacy_violation',
        'timeout',
        'storage_error',
      ] as const
      for (const failureReason of reasons) {
        // committedAt stays set on a failed attempt: silhouette-photo.processor.ts's
        // failure branch never clears my_form_committed_at (only a full DELETE
        // does), because the record was already committed before processing
        // failed. A failed My Form attempt never switches the profile's active
        // `mode` either (see wardrobe-silhouette-contract.spec.ts's sibling
        // profile-level test and the Pact interactions), which is a
        // profile-level fact, not part of this myForm sub-object.
        const myForm = buildMyForm({
          status: 'failed',
          failureReason,
          committedAt: '2026-08-09T09:10:00.000Z',
          imageAccess: null,
        })
        expect(silhouetteMyFormSchema.parse(myForm).failureReason).toBe(failureReason)
      }
    })

    it('validates the slider PUT input', () => {
      const input = { heightSlider: 62, buildSlider: 40 }
      expect(updateSilhouetteSlidersInputSchema.parse(input)).toEqual(input)
    })

    it('validates the My Form upload-url input and response', () => {
      const input = buildUploadInput()
      expect(createSilhouetteUploadUrlInputSchema.parse(input)).toEqual(input)

      const response = {
        data: {
          uploadSessionId: 'a3d7f1e2-9c5b-4a6d-8e1f-3b5d7f9a1c3e',
          uploadUrl: 'https://api.example/wardrobe/silhouette/uploads/a3d7f1e2',
          uploadToken: 'token_456',
          requiredHeaders: { 'content-type': 'image/png' },
          expiresAt: '2026-08-09T09:15:00.000Z',
        },
      }
      expect(
        createSilhouetteUploadUrlResponseSchema.parse(response).data.uploadSessionId
      ).toBe('a3d7f1e2-9c5b-4a6d-8e1f-3b5d7f9a1c3e')
    })

    it('requires the basewear confirmation on the commit input (decision 8)', () => {
      const commit = {
        uploadSessionId: 'a3d7f1e2-9c5b-4a6d-8e1f-3b5d7f9a1c3e',
        confirmsBasewearGuidance: true as const,
      }
      expect(commitSilhouettePhotoInputSchema.parse(commit)).toEqual(commit)
    })
  })

  describe('Security & Boundary Rejection', () => {
    it('rejects client-injected fields on the slider PUT input', () => {
      const result = updateSilhouetteSlidersInputSchema.safeParse({
        heightSlider: 50,
        buildSlider: 50,
        userId: 'client-injected-user-id',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'unrecognized_keys', keys: ['userId'] }),
          ])
        )
      }
    })

    it('rejects slider values outside the 0-100 integer range', () => {
      expectIssuePath(
        updateSilhouetteSlidersInputSchema,
        { heightSlider: -1, buildSlider: 50 },
        'heightSlider'
      )
      expectIssuePath(
        updateSilhouetteSlidersInputSchema,
        { heightSlider: 50, buildSlider: 101 },
        'buildSlider'
      )
      expectIssuePath(
        updateSilhouetteSlidersInputSchema,
        { heightSlider: 50.5, buildSlider: 50 },
        'heightSlider'
      )
    })

    it('rejects a My Form commit that does not confirm basewear guidance', () => {
      expectIssuePath(
        commitSilhouettePhotoInputSchema,
        {
          uploadSessionId: 'a3d7f1e2-9c5b-4a6d-8e1f-3b5d7f9a1c3e',
          confirmsBasewearGuidance: false,
        },
        'confirmsBasewearGuidance'
      )
      expectIssuePath(
        commitSilhouettePhotoInputSchema,
        { uploadSessionId: 'a3d7f1e2-9c5b-4a6d-8e1f-3b5d7f9a1c3e' },
        'confirmsBasewearGuidance'
      )
    })

    it('rejects an undocumented My Form failure reason', () => {
      expectIssuePath(
        silhouetteMyFormSchema,
        buildMyForm({ status: 'failed', failureReason: 'inappropriate_content' }),
        'failureReason'
      )
    })

    it('rejects My Form lifecycle combinations the real pipeline can never produce (HIGH 3, bmad-code-review)', () => {
      // Grounded in wardrobe-silhouette.service.ts/silhouette-photo.processor.ts
      // rather than guessed: committedAt is set exactly once, at commit, and
      // never cleared by a later failure; failureReason is set if and only if
      // status is failed; imageAccess is set if and only if status is ready.
      expectIssuePath(
        silhouetteMyFormSchema,
        buildMyForm({ status: 'ready', failureReason: 'contrast' }),
        'failureReason'
      )
      expectIssuePath(
        silhouetteMyFormSchema,
        buildMyForm({
          status: 'failed',
          failureReason: null,
          committedAt: '2026-08-09T09:10:00.000Z',
          imageAccess: null,
        }),
        'failureReason'
      )
      expectIssuePath(
        silhouetteMyFormSchema,
        buildMyForm({ status: 'ready', imageAccess: null }),
        'imageAccess'
      )
      expectIssuePath(
        silhouetteMyFormSchema,
        buildMyForm({
          status: 'processing',
          failureReason: null,
          committedAt: '2026-08-09T09:10:00.000Z',
        }),
        'imageAccess'
      )
      expectIssuePath(
        silhouetteMyFormSchema,
        buildMyForm({
          status: 'bytes_uploaded',
          failureReason: null,
          imageAccess: null,
        }),
        'committedAt'
      )
      expectIssuePath(
        silhouetteMyFormSchema,
        buildMyForm({
          status: 'pending_upload',
          failureReason: null,
          imageAccess: null,
        }),
        'committedAt'
      )
    })

    it('rejects an invalid sha256 or unsupported MIME type on the upload declaration', () => {
      expectIssuePath(
        createSilhouetteUploadUrlInputSchema,
        buildUploadInput({ sha256: 'not-a-sha256' }),
        'sha256'
      )
      expectIssuePath(
        createSilhouetteUploadUrlInputSchema,
        buildUploadInput({ mimeType: 'image/gif' }),
        'mimeType'
      )
    })

    it('rejects file size and dimensions outside the declared upload bounds', () => {
      expectIssuePath(
        createSilhouetteUploadUrlInputSchema,
        buildUploadInput({ fileSizeBytes: 0 }),
        'fileSizeBytes'
      )
      expectIssuePath(
        createSilhouetteUploadUrlInputSchema,
        buildUploadInput({ widthPx: 255 }),
        'widthPx'
      )
    })
  })

  describe('OpenAPI Registration', () => {
    // Shared across the three tests below: generateHttpOpenApiDocument()
    // rebuilds the entire registry (every register*Contracts slice, not just
    // wardrobe) and runs the full OpenAPI document generator each call, and
    // its output does not change between these tests. Computing it once in
    // beforeAll avoids paying that cost three times over.
    let spec: ReturnType<typeof generateHttpOpenApiDocument>

    beforeAll(() => {
      spec = generateHttpOpenApiDocument()
    })

    it('registers the silhouette and My Form routes with the documented status codes', () => {
      const routes = [
        {
          method: 'get',
          path: '/api/v1/wardrobe/silhouette',
          statuses: ['200', '401', '403'],
        },
        {
          method: 'put',
          path: '/api/v1/wardrobe/silhouette',
          statuses: ['200', '400', '401', '403', '412', '428'],
        },
        {
          method: 'post',
          path: '/api/v1/wardrobe/silhouette/my-form/upload-url',
          statuses: ['200', '201', '400', '401', '403', '409'],
        },
        {
          method: 'put',
          path: '/api/v1/wardrobe/silhouette/my-form/uploads/{uploadSessionId}',
          statuses: ['204', '400', '401', '403', '404'],
        },
        {
          method: 'post',
          path: '/api/v1/wardrobe/silhouette/my-form/commit',
          statuses: ['200', '201', '400', '401', '403', '404', '409'],
        },
        {
          method: 'delete',
          path: '/api/v1/wardrobe/silhouette/my-form',
          statuses: ['200', '401', '403', '412', '428'],
        },
      ] as const

      for (const route of routes) {
        const operation = spec.paths?.[route.path]?.[route.method]
        expect(
          operation?.security,
          `${route.method.toUpperCase()} ${route.path}`
        ).toEqual([{ bearerAuth: [] }])
        expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(
          [...route.statuses].sort()
        )
      }

      const commitOperation =
        spec.paths?.['/api/v1/wardrobe/silhouette/my-form/commit']?.post
      expect(commitOperation?.requestBody).toMatchObject({
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CommitSilhouettePhotoInput' },
          },
        },
      })

      const deleteOperation = spec.paths?.['/api/v1/wardrobe/silhouette/my-form']?.delete
      expect(deleteOperation?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'if-match', in: 'header', required: true }),
        ])
      )
    })

    it('requires If-Match on the slider PUT and Idempotency-Key on My Form upload-url/commit', () => {
      const sliderPut = spec.paths?.['/api/v1/wardrobe/silhouette']?.put
      expect(sliderPut?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'if-match', in: 'header', required: true }),
        ])
      )

      const uploadUrlPost =
        spec.paths?.['/api/v1/wardrobe/silhouette/my-form/upload-url']?.post
      expect(uploadUrlPost?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'idempotency-key',
            in: 'header',
            required: true,
          }),
        ])
      )

      const commitPost = spec.paths?.['/api/v1/wardrobe/silhouette/my-form/commit']?.post
      expect(commitPost?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'idempotency-key',
            in: 'header',
            required: true,
          }),
        ])
      )
    })

    it('declares the raw My Form upload token/content-type headers and binary body (HIGH 4, bmad-code-review)', () => {
      const uploadBytesPut =
        spec.paths?.['/api/v1/wardrobe/silhouette/my-form/uploads/{uploadSessionId}']?.put
      expect(uploadBytesPut?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'x-upload-token',
            in: 'header',
            required: true,
          }),
          expect.objectContaining({ name: 'content-type', in: 'header', required: true }),
        ])
      )
      expect(uploadBytesPut?.requestBody).toMatchObject({
        required: true,
        content: {
          'image/jpeg': { schema: { type: 'string', format: 'binary' } },
          'image/png': { schema: { type: 'string', format: 'binary' } },
          'image/webp': { schema: { type: 'string', format: 'binary' } },
        },
      })
    })

    it('does not require `error` on the 428 precondition-required envelope', () => {
      // `parseSilhouetteIfMatchHeader` raises a bare `HttpException`, which
      // Nest serializes with no `error` reason phrase -- unlike the 412
      // envelope, whose Nest exception class always adds one.
      const schema = spec.components?.schemas?.['SilhouettePreconditionRequiredError'] as
        | { required?: string[] }
        | undefined

      expect(schema?.required).toEqual(expect.arrayContaining(['statusCode', 'message']))
      expect(schema?.required).not.toContain('error')
    })
  })
})

// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Production follow-up 2026-11-19 (tester report "Upload fail"). A phone photo is 3 to 8 MB, and
// a Vercel Function refuses a request body over about 4.5 MB with 413 FUNCTION_PAYLOAD_TOO_LARGE
// before the app sees it. The local API has no such cap, so every local and CI upload passed
// while production failed for the tester. Direct-to-storage uploads (#260) took the bytes out of
// the function; the local specs hold the contract against local storage, with the cap emulated.
// These two cases hold it on a deployment, where the cap is real:
//
// - DEPLOYED-UP-01 (every environment, no member, writes nothing): the allocation route exists
//   and is guarded. A deployment still on the old upload route answers 404 here, and the daily
//   production status run turns red on it.
// - DEPLOYED-UP-02 (the Vercel preview lane only, because it writes a member and a garment):
//   a photo of about 5 MB, over the cap, is allocated, put straight to the storage host the API
//   signed, committed and listed. The bytes never reach the API's host; on the old route this
//   body would have been refused with 413 before the commit.
//
// What stays out of reach of a deployed run, and where it is held instead:
// - The processing step (the wardrobe worker moving the garment to `awaiting_tags` with the
//   manual tagging engine) needs a running worker. The preview has none, and production status
//   runs read-only checks (no upload), so the build-time worker drill in
//   `Dockerfile.wardrobe-worker` and the worker specs hold it.
// - The browser half on a phone viewport (picker, crop, upload) needs a signed-in browser
//   session on the deployed web. The local specs hold it (G-1, G-4, G-5 in
//   wardrobe-garment-capture-phone.spec.ts, with the cap emulated).
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createGarmentItemResponseSchema,
  createGarmentUploadUrlResponseSchema,
  garmentListResponseSchema,
  signupResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { buildUniqueId, resolveApiBaseUrl } from '../support/helpers/api-test'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
import { writePhoneJpegWithin } from '../support/helpers/phone-camera-photo'
import { VERCEL_FUNCTION_MAX_BODY_BYTES } from '../support/helpers/vercel-function-body-limit'

const ALLOCATE_PATH = '/api/v1/wardrobe/upload-url'
const GARMENTS_PATH = '/api/v1/wardrobe/garments'
/** Over the cap by about 150 KB, under what a tester's phone sends. */
const PHOTO_MIN_BYTES = VERCEL_FUNCTION_MAX_BODY_BYTES + 150_000
const PHOTO_MAX_BYTES = 6_500_000
/** A 12 MP portrait frame: the pixel size of the tester's phone photos. */
const PHOTO_WIDTH = 3024
const PHOTO_HEIGHT = 4032

test.describe('Garment upload on a deployment', () => {
  // The case that writes signs in as its API-created member, not the default persisted session.
  test.use({ authSessionEnabled: false })

  test('DEPLOYED-UP-01: the direct-upload route is deployed and guarded, so a signed-out allocation answers 401 from the API, never 404', async ({
    apiRequest,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })

    const response = await apiRequest({
      method: 'POST',
      path: ALLOCATE_PATH,
      baseUrl,
      headers: { 'Idempotency-Key': randomUUID() },
      body: {
        fileSizeBytes: PHOTO_MIN_BYTES,
        mimeType: 'image/jpeg',
        sha256: '0'.repeat(64),
        widthPx: PHOTO_WIDTH,
        heightPx: PHOTO_HEIGHT,
      },
    })

    // The API's own refusal body: a 401 or 404 from anything in front of the API cannot pass.
    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing or invalid bearer token',
    })
  })

  test('DEPLOYED-UP-02: a phone photo over the Vercel body cap goes straight to storage and commits, and the API never carries its bytes', async ({
    apiRequest,
  }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.environment !== 'preview',
      'Writes a member and a garment: the preview lane only. Production status runs read-only checks; local runs have the S-* storage specs.'
    )
    const baseUrl = resolveApiBaseUrl(testInfo)
    const apiOrigin = new URL(baseUrl).origin
    const dir = await mkdtemp(path.join(os.tmpdir(), 'deployed-upload-'))
    let accessToken: string | undefined
    let garmentId: string | undefined
    let cleanupError: Error | undefined
    try {
      const photoPath = path.join(dir, 'phone-photo.jpg')
      await writePhoneJpegWithin(photoPath, {
        width: PHOTO_WIDTH,
        height: PHOTO_HEIGHT,
        minBytes: PHOTO_MIN_BYTES,
        maxBytes: PHOTO_MAX_BYTES,
      })
      const bytes = await readFile(photoPath)
      // The premise of the whole case: this body is one a Vercel Function would refuse.
      expect(bytes.byteLength).toBeGreaterThan(VERCEL_FUNCTION_MAX_BODY_BYTES)

      const signup = await apiRequest({
        method: 'POST',
        path: '/api/v1/auth/signup',
        baseUrl,
        body: {
          email: `${buildUniqueId('deployed-upload', testInfo)}@example.com`,
          birthdate: '1990-06-15',
        },
      })
      expect(signup.status).toBe(201)
      const { userId } = signupResponseSchema.parse(signup.body)
      accessToken = localE2EAccessToken(userId)
      const headers = { Authorization: `Bearer ${accessToken}` }

      const allocation = await apiRequest({
        method: 'POST',
        path: ALLOCATE_PATH,
        baseUrl,
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        body: {
          fileSizeBytes: bytes.byteLength,
          mimeType: 'image/jpeg',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          widthPx: PHOTO_WIDTH,
          heightPx: PHOTO_HEIGHT,
        },
      })
      expect(allocation.status, JSON.stringify(allocation.body)).toBe(201)
      const session = createGarmentUploadUrlResponseSchema.parse(allocation.body).data
      garmentId = session.garmentId

      // The bytes go to the storage host the API signed, not to the API's own host.
      const signed = new URL(session.uploadUrl)
      expect(signed.origin, 'bytes must not go to the API host').not.toBe(apiOrigin)
      expect(signed.pathname).toMatch(
        new RegExp(
          `^/storage/v1/object/upload/sign/wardrobe-images/staging/${userId}/garment/${session.uploadSessionId}\\.(jpg|jpeg)$`
        )
      )
      expect(signed.searchParams.get('token')).toBeTruthy()

      const put = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: new Uint8Array(bytes),
        // A redirect could carry the bytes to a host the check above never saw.
        redirect: 'error',
      })
      expect(put.status, await put.text()).toBe(200)

      const commit = await apiRequest({
        method: 'POST',
        path: GARMENTS_PATH,
        baseUrl,
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        body: {
          garmentId: session.garmentId,
          uploadSessionId: session.uploadSessionId,
          hasCropping: true,
          hasBgCleanup: false,
        },
      })
      expect(commit.status, JSON.stringify(commit.body)).toBe(201)
      expect(createGarmentItemResponseSchema.parse(commit.body).data.id).toBe(
        session.garmentId
      )

      const list = await apiRequest({
        method: 'GET',
        path: GARMENTS_PATH,
        baseUrl,
        headers,
      })
      expect(list.status).toBe(200)
      expect(
        garmentListResponseSchema.parse(list.body).data.map((garment) => garment.id)
      ).toContain(session.garmentId)
    } finally {
      await rm(dir, { recursive: true, force: true })
      // The member's garment goes. The cleanup's own failure is reported only when the case
      // passed, so it never hides the failure that matters.
      if (accessToken && garmentId) {
        cleanupError = await apiRequest({
          method: 'DELETE',
          path: `${GARMENTS_PATH}/${garmentId}`,
          baseUrl,
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(
          (removed) =>
            removed.status === 204
              ? undefined
              : new Error(`Garment cleanup answered ${removed.status}`),
          (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
        )
      }
    }
    if (cleanupError) throw cleanupError
  })
})

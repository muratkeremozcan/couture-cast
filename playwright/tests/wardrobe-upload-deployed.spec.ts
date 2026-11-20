// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Production follow-up 2026-11-19 (tester report "Upload fail"). Probes against the production
// API on 2026-11-19 reproduced the failing class: a Vercel Function refuses a request body over
// about 4.5 MB (4,494,359 bytes got 413 FUNCTION_PAYLOAD_TOO_LARGE, 4,492,812 did not), and a
// phone photo is 3 to 8 MB. No request trace ties that class to the tester's own attempt. The
// local API has no such cap, so every local and CI upload passed. Direct-to-storage uploads
// (#260) take the bytes out of the function; the local specs hold the contract against local
// storage with the cap emulated. These cases hold the server-side upload path on a deployment,
// where the cap is real. Each runs against the deployment the project metadata names, with bare
// requests: no inherited API credentials, no redirects followed, no member on the read-only ones.
//
// - DEPLOYED-UP-01 (every environment, so the daily production status run reads it; writes
//   nothing): the allocation route is mounted and guarded. A signed-out call with an invalid
//   declaration answers the API's own 401 before any validation or write. This is a route and
//   auth smoke: the pre-#260 relay deployment mounted the same allocation route and answers the
//   same 401.
// - DEPLOYED-UP-02 (every environment, writes nothing): the relay's byte route is gone. The old
//   `PUT /api/v1/wardrobe/uploads/:uploadSessionId` answered 401 behind the auth guard; with the
//   route removed the API answers 404. A deployment that brings the relay back turns this red.
// - DEPLOYED-UP-03 (the Vercel preview lane only, because it writes a member and a garment): a
//   JPEG of about 5 MB, over the cap, is allocated, put straight at the storage host the API
//   signed, committed and listed, and the API's host never carries its bytes. The case first
//   proves the API it is about to write to is a preview deployment.
//
// What stays out of reach of a deployed run, and where it is held instead:
// - The processing step (the wardrobe worker moving the garment to `awaiting_tags` with the
//   manual tagging engine) needs a running worker. The preview has none, and production status
//   runs read-only checks (no upload), so the build-time worker drill in
//   `Dockerfile.wardrobe-worker` and the worker specs hold it.
// - The browser half on a phone viewport (picker, crop, upload) needs a signed-in browser
//   session on the deployed web. The local specs hold it (G-1, G-4, G-5 in
//   wardrobe-garment-capture-phone.spec.ts, with the cap emulated).
//
// Retention: DEPLOYED-UP-03's synthetic member stays in the preview database like every other
// preview spec's signup (that database is shared and has no per-run teardown); its garment is
// deleted.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { TestInfo } from '@playwright/test'
import {
  createGarmentItemResponseSchema,
  createGarmentUploadUrlResponseSchema,
  garmentListResponseSchema,
  signupResponseSchema,
} from '@couture/api-client/contracts/http'
import { VERCEL_BYPASS_STATE_PATH } from '../global-setup-vercel-bypass'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { buildUniqueId, resolveApiBaseUrl } from '../support/helpers/api-test'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'
import { writePhoneJpegWithin } from '../support/helpers/phone-camera-photo'
import { VERCEL_FUNCTION_MAX_BODY_BYTES } from '../support/helpers/vercel-function-body-limit'

const ALLOCATE_PATH = '/api/v1/wardrobe/upload-url'
const GARMENTS_PATH = '/api/v1/wardrobe/garments'
/** The relay's byte route that #260 removed. */
const REMOVED_RELAY_PATH = '/api/v1/wardrobe/uploads'
/** Over the cap by about 150 KB, under what a tester's phone sends. */
const PHOTO_MIN_BYTES = VERCEL_FUNCTION_MAX_BODY_BYTES + 150_000
const PHOTO_MAX_BYTES = 6_500_000
/** A 12 MP portrait frame: the pixel size of the tester's phone photos. */
const PHOTO_WIDTH = 3024
const PHOTO_HEIGHT = 4032

const environmentOf = (testInfo: TestInfo) =>
  testInfo.project.metadata?.environment as string | undefined

/**
 * The deployment-protection cookies global setup minted for this host, as a Cookie header.
 * Tests never hold the bypass secret itself (a trace would copy it); a protected preview takes
 * the cookie, and every other environment has none.
 */
function deploymentCookie(baseUrl: string): Record<string, string> {
  const { hostname } = new URL(baseUrl)
  let state: { cookies?: { name: string; value: string; domain: string }[] }
  try {
    state = JSON.parse(readFileSync(VERCEL_BYPASS_STATE_PATH, 'utf8')) as typeof state
  } catch {
    return {}
  }
  const cookies = (state.cookies ?? []).filter((cookie) => {
    const domain = cookie.domain.replace(/^\./, '')
    return hostname === domain || hostname.endsWith(`.${domain}`)
  })
  return cookies.length === 0
    ? {}
    : { cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') }
}

/**
 * One request to the deployment with nothing inherited: no service-role header the merged
 * request fixture would add, no cookie jar beyond the deployment-protection cookie of a
 * protected preview, and no redirect followed, so the bytes and the writes cannot leave the
 * host that was checked.
 */
function deployed(
  testInfo: TestInfo,
  baseUrl: string,
  pathname: string,
  init: { method: string; headers?: Record<string, string>; body?: unknown }
): Promise<Response> {
  return fetch(new URL(pathname, baseUrl), {
    method: init.method,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(environmentOf(testInfo) === 'preview' ? deploymentCookie(baseUrl) : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'error',
  })
}

async function jsonOf(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** Refuses to go on unless the API at `baseUrl` says it is the couturecast preview API. */
async function expectPreviewApi(testInfo: TestInfo, baseUrl: string) {
  const health = await deployed(testInfo, baseUrl, '/api/health', { method: 'GET' })
  expect(health.status, 'API health').toBe(200)
  expect(await jsonOf(health), 'API identity').toMatchObject({
    service: 'couturecast-api',
    environment: 'preview',
  })
}

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error))

test.describe('Garment upload on a deployment', () => {
  // The case that writes signs in as its API-created member, not the default persisted session.
  test.use({ authSessionEnabled: false })

  test('DEPLOYED-UP-01: the allocation route is mounted and guarded, so a signed-out call with an invalid declaration answers 401 from the API, never 404 or a validation error', async ({}, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })

    const response = await deployed(testInfo, baseUrl, ALLOCATE_PATH, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      // Invalid on purpose: were the auth guard ever skipped, this reaches validation, never a
      // write, and the answer is a 400 instead of the 401 below.
      body: { fileSizeBytes: -1, mimeType: 'text/plain', sha256: 'not-a-digest' },
    })

    // The API's own refusal body: a 401 or 404 from anything in front of the API cannot pass.
    expect(response.status).toBe(401)
    expect(await jsonOf(response)).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing or invalid bearer token',
    })
  })

  test('DEPLOYED-UP-02: the relay byte route is gone, so a signed-out PUT to the old upload path answers 404, not the 401 the guarded relay gave', async ({}, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })

    // No bytes and no credentials: the old route sat behind the auth guard, so a deployment
    // that still has it answers 401 here.
    const response = await deployed(
      testInfo,
      baseUrl,
      `${REMOVED_RELAY_PATH}/${randomUUID()}`,
      { method: 'PUT' }
    )

    expect(response.status).toBe(404)
  })

  test('DEPLOYED-UP-03: a phone photo over the Vercel body cap goes straight to storage and commits, and the API never carries its bytes', async ({}, testInfo) => {
    test.skip(
      environmentOf(testInfo) !== 'preview',
      'Writes a member and a garment: the preview lane only. Production status runs read-only checks; local runs have the S-* storage specs.'
    )
    const baseUrl = resolveApiBaseUrl(testInfo)
    const apiOrigin = new URL(baseUrl).origin
    // Before any write: the target is a preview API, whatever URL a manual run was given.
    await expectPreviewApi(testInfo, baseUrl)

    const dir = await mkdtemp(path.join(os.tmpdir(), 'deployed-upload-'))
    const cleanupErrors: Error[] = []
    let accessToken: string | undefined
    let garmentId: string | undefined
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

      const signup = await deployed(testInfo, baseUrl, '/api/v1/auth/signup', {
        method: 'POST',
        body: {
          email: `${buildUniqueId('deployed-upload', testInfo)}@example.com`,
          birthdate: '1990-06-15',
        },
      })
      expect(signup.status).toBe(201)
      const { userId } = signupResponseSchema.parse(await jsonOf(signup))
      accessToken = localE2EAccessToken(userId)
      const headers = { Authorization: `Bearer ${accessToken}` }

      const allocation = await deployed(testInfo, baseUrl, ALLOCATE_PATH, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        body: {
          fileSizeBytes: bytes.byteLength,
          mimeType: 'image/jpeg',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          widthPx: PHOTO_WIDTH,
          heightPx: PHOTO_HEIGHT,
        },
      })
      const allocationBody = await jsonOf(allocation)
      expect(allocation.status, JSON.stringify(allocationBody)).toBe(201)
      // Remember the garment before anything else is read from the answer, so cleanup still
      // finds it when the rest of the answer is not what the contract says.
      const issued = (allocationBody as { data?: { garmentId?: unknown } } | null)?.data
        ?.garmentId
      if (typeof issued === 'string' && issued.length > 0) garmentId = issued
      const session = createGarmentUploadUrlResponseSchema.parse(allocationBody).data

      // The bytes go to the storage host, not to the API's own host: an https Supabase
      // storage origin (the configured one when the run knows it), at this session's key.
      const signed = new URL(session.uploadUrl)
      expect(signed.origin, 'bytes must not go to the API host').not.toBe(apiOrigin)
      expect(signed.protocol).toBe('https:')
      const configuredStorage = process.env.SUPABASE_URL?.trim()
      if (configuredStorage) {
        expect(signed.origin, 'configured storage origin').toBe(
          new URL(configuredStorage).origin
        )
      } else {
        expect(signed.hostname, 'storage host').toMatch(/\.supabase\.co$/)
      }
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
        // A redirect could carry the bytes to a host the checks above never saw.
        redirect: 'error',
      })
      expect(put.status, await put.text()).toBe(200)

      const commit = await deployed(testInfo, baseUrl, GARMENTS_PATH, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        body: {
          garmentId: session.garmentId,
          uploadSessionId: session.uploadSessionId,
          hasCropping: true,
          hasBgCleanup: false,
        },
      })
      const commitBody = await jsonOf(commit)
      expect(commit.status, JSON.stringify(commitBody)).toBe(201)
      expect(createGarmentItemResponseSchema.parse(commitBody).data.id).toBe(
        session.garmentId
      )

      const list = await deployed(testInfo, baseUrl, GARMENTS_PATH, {
        method: 'GET',
        headers,
      })
      expect(list.status).toBe(200)
      expect(
        garmentListResponseSchema
          .parse(await jsonOf(list))
          .data.map((garment) => garment.id)
      ).toContain(session.garmentId)
    } finally {
      // Local and remote cleanup run independently, and each failure is attached to the case
      // result so none hides the failure that matters.
      await rm(dir, { recursive: true, force: true }).catch((error: unknown) => {
        cleanupErrors.push(asError(error))
      })
      if (accessToken && garmentId) {
        await deployed(testInfo, baseUrl, `${GARMENTS_PATH}/${garmentId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(
          (removed) => {
            if (removed.status !== 204)
              cleanupErrors.push(new Error(`Garment cleanup answered ${removed.status}`))
          },
          (error: unknown) => {
            cleanupErrors.push(asError(error))
          }
        )
      }
      if (cleanupErrors.length > 0) {
        await testInfo.attach('cleanup-errors', {
          body: cleanupErrors.map((error) => error.message).join('\n'),
          contentType: 'text/plain',
        })
      }
    }
    // Reached only when the case itself passed; a failed case carries the attachment above
    // beside its own error.
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Cleanup after the deployed upload failed')
    }
  })
})

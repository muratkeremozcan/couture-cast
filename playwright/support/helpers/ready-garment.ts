// Story 7.5: seeds a ready garment for a fresh member through the real public endpoints
// (declare, upload bytes to storage, commit, wait for the worker, confirm tags), the same path
// the app uses. Used by playwright/tests/wardrobe-garment-detail.spec.ts.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
  createGarmentItemResponseSchema,
  createGarmentUploadUrlResponseSchema,
  garmentListResponseSchema,
  signupResponseSchema,
  updateGarmentTagsResponseSchema,
  type GarmentItemContract,
  type UpdateGarmentTagsInput,
} from '@couture/api-client/contracts/http'
import { expect } from '@playwright/test'
import type { ApiRequestFixtureParams } from '@seontechnologies/playwright-utils/api-request'
import { recurse } from '@seontechnologies/playwright-utils/recurse'
import { localE2EAccessToken } from './local-e2e-token'
import { configuredStorageOrigin } from './storage-upload-url'

export const READY_GARMENT_FIXTURE = path.resolve(
  __dirname,
  '../../../apps/api/test/fixtures/garment-tagging/neutral-top.png'
)

/** The classic apiRequest fixture shape (the fixture is overloaded; see capsule-session.ts). */
type ApiRequestFn = <T = unknown>(
  params: ApiRequestFixtureParams
) => Promise<{ status: number; body: T }>

export type SeededMember = { userId: string; accessToken: string }

export async function signUpAdultMember(
  apiRequest: ApiRequestFn,
  apiBaseUrl: string,
  email: string
): Promise<SeededMember> {
  const signup = await apiRequest({
    method: 'POST',
    path: '/api/v1/auth/signup',
    baseUrl: apiBaseUrl,
    body: { email, birthdate: '1990-06-15' },
  })
  expect(signup.status).toBe(201)
  const { userId } = signupResponseSchema.parse(signup.body)
  return { userId, accessToken: localE2EAccessToken(userId) }
}

/** Uploads the fixture photo, waits for analysis and confirms `tags`, returning the ready garment. */
export async function seedReadyGarment(
  apiRequest: ApiRequestFn,
  apiBaseUrl: string,
  member: SeededMember,
  tags: UpdateGarmentTagsInput
): Promise<GarmentItemContract> {
  const auth = { Authorization: `Bearer ${member.accessToken}` }
  const bytes = await readFile(READY_GARMENT_FIXTURE)
  const { width, height } = await sharp(bytes).metadata()

  const allocation = await apiRequest({
    method: 'POST',
    path: '/api/v1/wardrobe/upload-url',
    baseUrl: apiBaseUrl,
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    body: {
      fileSizeBytes: bytes.byteLength,
      mimeType: 'image/png',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      widthPx: width,
      heightPx: height,
    },
  })
  expect(allocation.status).toBe(201)
  const session = createGarmentUploadUrlResponseSchema.parse(allocation.body).data

  // Signed uploads carry no app credentials, so the PUT is a bare fetch to the storage host.
  expect(new URL(session.uploadUrl).origin, 'storage origin').toBe(
    configuredStorageOrigin()
  )
  const put = await fetch(session.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: new Uint8Array(bytes),
    redirect: 'error',
  })
  expect(put.status, await put.clone().text()).toBe(200)

  const committed = await apiRequest({
    method: 'POST',
    path: '/api/v1/wardrobe/garments',
    baseUrl: apiBaseUrl,
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    body: {
      garmentId: session.garmentId,
      uploadSessionId: session.uploadSessionId,
      hasCropping: false,
      hasBgCleanup: false,
    },
  })
  expect(committed.status).toBe(201)
  const garmentId = createGarmentItemResponseSchema.parse(committed.body).data.id

  await recurse(
    () =>
      apiRequest({
        method: 'GET',
        path: '/api/v1/wardrobe/garments',
        baseUrl: apiBaseUrl,
        headers: auth,
      }),
    ({ status, body }) => {
      const parsed = garmentListResponseSchema.safeParse(body)
      return (
        status === 200 &&
        parsed.success &&
        parsed.data.data.some(
          (garment) => garment.id === garmentId && garment.status === 'awaiting_tags'
        )
      )
    },
    { timeout: 20_000, interval: 250, log: 'Waiting for wardrobe worker analysis' }
  )

  const confirmed = await apiRequest({
    method: 'PATCH',
    path: `/api/v1/wardrobe/garments/${garmentId}/tags`,
    baseUrl: apiBaseUrl,
    headers: auth,
    body: tags,
  })
  expect(confirmed.status).toBe(200)
  const garment = updateGarmentTagsResponseSchema.parse(confirmed.body).data
  expect(garment.status).toBe('ready')
  return garment
}

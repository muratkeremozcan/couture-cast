import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import type {
  CommitSilhouettePhotoInput,
  CreateSilhouetteUploadUrlInput,
} from '@couture/api-client'
import {
  createSilhouetteUploadUrlResponseSchema,
  silhouetteProfileResponseSchema,
  type SilhouettePhotoFailureReason,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  isoTimestamp,
  pactEventHeaders,
  pactTeenHeaders,
  string,
  type CreateClient,
} from './shared'
import {
  ONBOARDING_OWNER_ID,
  SILHOUETTE_COMMITTED_AT,
  SILHOUETTE_COMMIT_IDEMPOTENCY_KEY,
  SILHOUETTE_IMAGE_EXPIRY,
  SILHOUETTE_SHA256,
  SILHOUETTE_TEEN_ID,
  SILHOUETTE_UPLOAD_EXPIRY,
  SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY,
  SILHOUETTE_UPLOAD_SESSION_ID,
  silhouetteETagFor,
  silhouetteProfileBody,
} from './wardrobe-fixtures'
import {
  verifyWardrobeErrorInteraction,
  type WardrobeErrorInteraction,
} from './wardrobe-onboarding'

// --- Silhouette sliders (ownership: owner reading/writing own profile) -----

export async function verifySilhouetteProfileInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Silhouette profile exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to read the silhouette profile')
    .withRequest(
      'GET',
      '/api/v1/wardrobe/silhouette',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(1)) },
        body: {
          data: silhouetteProfileBody(1, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSilhouetteGet()

      expect(silhouetteProfileResponseSchema.parse(response)).toMatchObject({
        data: { mode: 'default_mannequin', heightSlider: 50, buildSlider: 50 },
      })
    })
}

export async function verifyUpdateSilhouetteSlidersInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Silhouette profile exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to save silhouette slider values')
    .withRequest(
      'PUT',
      '/api/v1/wardrobe/silhouette',
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': silhouetteETagFor(1) },
        body: { heightSlider: 62, buildSlider: 40 },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(2)) },
        body: {
          data: silhouetteProfileBody(2, {
            mode: 'default_mannequin',
            heightSlider: 62,
            buildSlider: 40,
            myForm: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSilhouettePut({
        ifMatch: silhouetteETagFor(1),
        updateSilhouetteSlidersInput: { heightSlider: 62, buildSlider: 40 },
      })

      expect(silhouetteProfileResponseSchema.parse(response).data).toMatchObject({
        heightSlider: 62,
        buildSlider: 40,
      })
    })
}

/**
 * AC4's safe-no-op replay requirement, for silhouette sliders. Grounded in
 * `wardrobe-silhouette.service.ts`'s `updateSliders`: a PUT whose slider
 * values (and implicit `mode: 'default_mannequin'`) exactly match the
 * existing row is an `isIdenticalReplay`, returned unchanged rather than
 * incrementing. "Silhouette profile exists for user" implies
 * `heightSlider: 50, buildSlider: 50` at revision 1
 * (`verifySilhouetteProfileInteraction`'s fixture); resending those same
 * values is exactly the identical-replay condition.
 */
export async function verifyUpdateSilhouetteSlidersReplayInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Silhouette profile exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a repeated identical silhouette slider save')
    .withRequest(
      'PUT',
      '/api/v1/wardrobe/silhouette',
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': silhouetteETagFor(1) },
        body: { heightSlider: 50, buildSlider: 50 },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(1)) },
        body: {
          data: silhouetteProfileBody(1, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSilhouettePut({
        ifMatch: silhouetteETagFor(1),
        updateSilhouetteSlidersInput: { heightSlider: 50, buildSlider: 50 },
      })

      const parsed = silhouetteProfileResponseSchema.parse(response).data
      expect(parsed).toMatchObject({ heightSlider: 50, buildSlider: 50 })
      expect(parsed.revision).toBe(1)
    })
}

/**
 * "Guardian access" for onboarding/silhouette (decision 11) is the
 * `WardrobeUploadGuard` consent gate, not a guardian dashboard route:
 * proven here for both a read and a write by a teen actor.
 */
export const silhouetteGuardianErrorInteractions: WardrobeErrorInteraction[] = [
  {
    description:
      'a request from a teen without active guardian consent to read the silhouette profile',
    method: 'GET',
    path: '/api/v1/wardrobe/silhouette',
    state: 'Guardian consent is not active for teen silhouette access',
    stateParams: { userId: SILHOUETTE_TEEN_ID },
    headers: pactTeenHeaders,
    status: 403,
    code: 'GUARDIAN_CONSENT_REQUIRED',
    reason: 'Forbidden',
  },
  {
    description:
      'a request from a teen without active guardian consent to save silhouette sliders',
    method: 'PUT',
    path: '/api/v1/wardrobe/silhouette',
    state: 'Guardian consent is not active for teen silhouette access',
    stateParams: { userId: SILHOUETTE_TEEN_ID },
    headers: { ...pactTeenHeaders, 'If-Match': silhouetteETagFor(0) },
    body: { heightSlider: 50, buildSlider: 50 },
    status: 403,
    code: 'GUARDIAN_CONSENT_REQUIRED',
    reason: 'Forbidden',
  },
]

export async function verifySilhouetteStalePreconditionInteraction(pact: PactV4) {
  await verifyWardrobeErrorInteraction(pact, {
    description:
      'a request to save silhouette sliders with a stale revision precondition',
    method: 'PUT',
    path: '/api/v1/wardrobe/silhouette',
    state: 'Silhouette profile exists for user at a newer revision',
    stateParams: { userId: ONBOARDING_OWNER_ID },
    headers: { ...pactEventHeaders, 'If-Match': silhouetteETagFor(1) },
    body: { heightSlider: 62, buildSlider: 40 },
    status: 412,
    code: 'SILHOUETTE_REVISION_MISMATCH',
    reason: 'Precondition Failed',
  })
}

// --- "My Form" photo pipeline -----------------------------------------------

/** Shared by the upload-url interaction and its idempotent-replay counterpart below. */
const myFormUploadUrlRequestBody: CreateSilhouetteUploadUrlInput = {
  fileSizeBytes: 2048576,
  mimeType: 'image/png',
  sha256: SILHOUETTE_SHA256,
  widthPx: 1024,
  heightPx: 1536,
}

export async function verifyMyFormUploadUrlInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Silhouette profile exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to allocate a My Form upload session')
    .withRequest(
      'POST',
      '/api/v1/wardrobe/silhouette/my-form/upload-url',
      setJsonContent({
        headers: {
          ...pactEventHeaders,
          'Idempotency-Key': SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY,
        },
        body: myFormUploadUrlRequestBody,
      })
    )
    .willRespondWith(
      201,
      setJsonContent({
        body: {
          data: {
            uploadSessionId: string(SILHOUETTE_UPLOAD_SESSION_ID),
            uploadUrl: string(
              `https://api.example/wardrobe/silhouette/uploads/${SILHOUETTE_UPLOAD_SESSION_ID}`
            ),
            uploadToken: string('token_my_form_upload'),
            requiredHeaders: { 'content-type': string('image/png') },
            expiresAt: isoTimestamp(SILHOUETTE_UPLOAD_EXPIRY),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeSilhouetteMyFormUploadUrlPost({
        idempotencyKey: SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY,
        createSilhouetteUploadUrlInput: myFormUploadUrlRequestBody,
      })

      expect(
        createSilhouetteUploadUrlResponseSchema.parse(response).data.uploadSessionId
      ).toBe(SILHOUETTE_UPLOAD_SESSION_ID)
    })
}

/**
 * Idempotent-replay coverage for My Form upload-url allocation, grounded in
 * `WardrobeSilhouetteService.createMyFormUploadUrl`'s real
 * `existing.my_form_upload_idempotency_key === idempotencyKey` branch: a
 * repeated request with the same idempotency key returns the same session
 * unchanged, and the controller's `res.status(result.replayed ? 200 : 201)`
 * branches to 200.
 */
export async function verifyMyFormUploadUrlReplayInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A My Form upload session was already allocated for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving(
      'a repeated My Form upload session allocation with the same idempotency key'
    )
    .withRequest(
      'POST',
      '/api/v1/wardrobe/silhouette/my-form/upload-url',
      setJsonContent({
        headers: {
          ...pactEventHeaders,
          'Idempotency-Key': SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY,
        },
        body: myFormUploadUrlRequestBody,
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            uploadSessionId: string(SILHOUETTE_UPLOAD_SESSION_ID),
            uploadUrl: string(
              `https://api.example/wardrobe/silhouette/uploads/${SILHOUETTE_UPLOAD_SESSION_ID}`
            ),
            uploadToken: string('token_my_form_upload'),
            requiredHeaders: { 'content-type': string('image/png') },
            expiresAt: isoTimestamp(SILHOUETTE_UPLOAD_EXPIRY),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeSilhouetteMyFormUploadUrlPost({
        idempotencyKey: SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY,
        createSilhouetteUploadUrlInput: myFormUploadUrlRequestBody,
      })

      expect(
        createSilhouetteUploadUrlResponseSchema.parse(response).data.uploadSessionId
      ).toBe(SILHOUETTE_UPLOAD_SESSION_ID)
    })
}

/** Shared by the commit interaction and its idempotent-replay counterpart below. */
const myFormCommitRequestBody: CommitSilhouettePhotoInput = {
  uploadSessionId: SILHOUETTE_UPLOAD_SESSION_ID,
  confirmsBasewearGuidance: true,
}

export async function verifyMyFormCommitInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'My Form photo bytes are uploaded and awaiting commit for user',
        params: {
          userId: ONBOARDING_OWNER_ID,
          uploadSessionId: SILHOUETTE_UPLOAD_SESSION_ID,
        },
      })
    )
    .uponReceiving('a request to commit the uploaded My Form photo for processing')
    .withRequest(
      'POST',
      '/api/v1/wardrobe/silhouette/my-form/commit',
      setJsonContent({
        headers: {
          ...pactEventHeaders,
          'Idempotency-Key': SILHOUETTE_COMMIT_IDEMPOTENCY_KEY,
        },
        body: myFormCommitRequestBody,
      })
    )
    .willRespondWith(
      // A first commit: the controller's
      // `res.status(result.replayed ? 200 : 201)` answers 201 here.
      201,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(2)) },
        body: {
          // `mode` stays `default_mannequin` while the photo is still
          // `processing`: AC2/decision 5 say a *ready* photo becomes the
          // active silhouette mode, and a failed attempt never switches it
          // either (see the failure-reason interactions below) — so an
          // in-flight commit can't jump ahead of that rule and switch mode
          // before the pipeline has produced a `ready` result.
          data: silhouetteProfileBody(2, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: {
              status: 'processing',
              failureReason: null,
              committedAt: SILHOUETTE_COMMITTED_AT,
              imageAccess: null,
            },
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeSilhouetteMyFormCommitPost({
        idempotencyKey: SILHOUETTE_COMMIT_IDEMPOTENCY_KEY,
        commitSilhouettePhotoInput: myFormCommitRequestBody,
      })

      const parsed = silhouetteProfileResponseSchema.parse(response).data
      expect(parsed.myForm?.status).toBe('processing')
      expect(parsed.mode).toBe('default_mannequin')
    })
}

/**
 * Idempotent-replay coverage for My Form commit, grounded in
 * `WardrobeSilhouetteService.commitMyForm`'s real
 * `profile.my_form_commit_idempotency_key === idempotencyKey` branch: a
 * repeated commit with the same idempotency key returns the existing row
 * unchanged (same revision, same `committedAt`), no re-processing. Expects
 * 200, not 201: like upload-url, `commitMyForm` returns
 * `CommitResult['replayed']` and the controller applies
 * `res.status(result.replayed ? 200 : 201)`, so a replay answers 200 while
 * a first commit answers 201. Both statuses are registered on the contract.
 */
export async function verifyMyFormCommitReplayInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A My Form photo commit was already processed for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a repeated My Form commit with the same idempotency key')
    .withRequest(
      'POST',
      '/api/v1/wardrobe/silhouette/my-form/commit',
      setJsonContent({
        headers: {
          ...pactEventHeaders,
          'Idempotency-Key': SILHOUETTE_COMMIT_IDEMPOTENCY_KEY,
        },
        body: myFormCommitRequestBody,
      })
    )
    .willRespondWith(
      // A replay: the controller's `res.status(result.replayed ? 200 : 201)`
      // answers 200 here, where a first commit answers 201.
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(2)) },
        body: {
          data: silhouetteProfileBody(2, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: {
              status: 'processing',
              failureReason: null,
              committedAt: SILHOUETTE_COMMITTED_AT,
              imageAccess: null,
            },
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeSilhouetteMyFormCommitPost({
        idempotencyKey: SILHOUETTE_COMMIT_IDEMPOTENCY_KEY,
        commitSilhouettePhotoInput: myFormCommitRequestBody,
      })

      const parsed = silhouetteProfileResponseSchema.parse(response).data
      expect(parsed.myForm?.status).toBe('processing')
      expect(parsed.revision).toBe(2)
    })
}

export async function verifyMyFormReadyInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A My Form photo is ready for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to read a ready My Form photo')
    .withRequest(
      'GET',
      '/api/v1/wardrobe/silhouette',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(3)) },
        body: {
          data: silhouetteProfileBody(3, {
            mode: 'my_form',
            heightSlider: 50,
            buildSlider: 50,
            myForm: {
              status: 'ready',
              failureReason: null,
              committedAt: SILHOUETTE_COMMITTED_AT,
              imageAccess: {
                url: 'https://example.test/silhouette-my-form.png',
                expiresAt: SILHOUETTE_IMAGE_EXPIRY,
              },
            },
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSilhouetteGet()

      expect(silhouetteProfileResponseSchema.parse(response).data.myForm).toMatchObject({
        status: 'ready',
        failureReason: null,
      })
    })
}

export const myFormFailureReasons = [
  'contrast',
  'privacy_violation',
  'timeout',
  'storage_error',
] as const satisfies readonly SilhouettePhotoFailureReason[]

/**
 * Covers one documented "My Form" failure reason (decision 5/9). Exported as
 * a single-interaction function, driven by `it.each(myFormFailureReasons)`
 * in each pacttest file, rather than looping over all four reasons inside
 * one exported function/`it()` — PactV4's FFI non-deterministically drops an
 * interaction when more than one `addInteraction()...executeTest()` chain is
 * awaited inside a single test body (see `verifyWardrobeErrorInteraction`'s
 * doc comment above).
 */
export async function verifyMyFormFailureInteraction(
  pact: PactV4,
  createClient: CreateClient,
  failureReason: SilhouettePhotoFailureReason
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A My Form photo failed for user',
        params: { userId: ONBOARDING_OWNER_ID, reason: failureReason },
      })
    )
    .uponReceiving(`a request to read a My Form photo that failed with ${failureReason}`)
    .withRequest(
      'GET',
      '/api/v1/wardrobe/silhouette',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(2)) },
        body: {
          // A failed My Form attempt never switches the active mode; the
          // previous mannequin sliders remain in effect (AC2/decision 5).
          // `committedAt` stays set: silhouette-photo.processor.ts's failure
          // branch never clears `my_form_committed_at` (only a full DELETE
          // does) because the record was already committed before
          // processing failed.
          data: silhouetteProfileBody(2, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: {
              status: 'failed',
              failureReason,
              committedAt: SILHOUETTE_COMMITTED_AT,
              imageAccess: null,
            },
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSilhouetteGet()

      expect(silhouetteProfileResponseSchema.parse(response).data.myForm).toMatchObject({
        status: 'failed',
        failureReason,
        committedAt: SILHOUETTE_COMMITTED_AT,
      })
    })
}

/**
 * Decision 6: a `privacy_violation` verdict on a teen's photo additionally
 * writes a `ModerationEvent` and queues a guardian notification through the
 * durable `EventEnvelope` outbox. That side effect is invisible to the HTTP
 * response by design (decision 8/the 4.4-UNIT-001 analytics fixtures prove
 * the same "never leaks photo/moderation detail" rule) — the teen sees the
 * identical `failed`/`privacy_violation` shape any other actor would. This
 * interaction exists as its own case, with its own provider state, so a
 * wired provider can additionally assert the outbox row once Task 3/4 land;
 * the response-shape assertion here only proves no leakage.
 */
export async function verifyMyFormGuardianNotificationInteraction(
  pact: PactV4,
  createTeenClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A My Form photo failed privacy_violation for a teen and queued a guardian notification',
        params: { userId: SILHOUETTE_TEEN_ID },
      })
    )
    .uponReceiving(
      'a request from a teen to read a My Form photo that failed privacy_violation and notified their guardian'
    )
    .withRequest(
      'GET',
      '/api/v1/wardrobe/silhouette',
      setJsonContent({ headers: pactTeenHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(2)) },
        body: {
          data: silhouetteProfileBody(2, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: {
              status: 'failed',
              failureReason: 'privacy_violation',
              committedAt: SILHOUETTE_COMMITTED_AT,
              imageAccess: null,
            },
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createTeenClient(mockServer).apiV1WardrobeSilhouetteGet()

      expect(silhouetteProfileResponseSchema.parse(response).data.myForm).toMatchObject({
        status: 'failed',
        failureReason: 'privacy_violation',
        committedAt: SILHOUETTE_COMMITTED_AT,
      })
    })
}

export async function verifyMyFormDeleteInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A My Form photo exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving(
      'a request to delete the My Form photo and revert to the default mannequin'
    )
    .withRequest(
      'DELETE',
      '/api/v1/wardrobe/silhouette/my-form',
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': silhouetteETagFor(3) },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(silhouetteETagFor(4)) },
        body: {
          data: silhouetteProfileBody(4, {
            mode: 'default_mannequin',
            heightSlider: 50,
            buildSlider: 50,
            myForm: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeSilhouetteMyFormDelete(
        {
          ifMatch: silhouetteETagFor(3),
        }
      )

      expect(silhouetteProfileResponseSchema.parse(response).data).toMatchObject({
        mode: 'default_mannequin',
        myForm: null,
      })
    })
}

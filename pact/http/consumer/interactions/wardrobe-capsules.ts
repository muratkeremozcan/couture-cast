import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import type { CreateOutfitCapsuleInput } from '@couture/api-client'
import {
  outfitCapsuleListResponseSchema,
  outfitCapsuleResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  eachLike,
  isoTimestamp,
  like,
  nullValue,
  pactEventHeaders,
  string,
  type CreateClient,
} from './shared'

/* ------------------------------------------------------------------------- *
 * Story 4.3 outfit capsules
 *
 * Pact covers request and response understanding, status codes, headers, and
 * error envelopes. Authorization rules, ranking, cache behaviour, and races
 * stay in the API and integration suites. One interaction per test.
 * ------------------------------------------------------------------------- */

export const CAPSULE_OWNER_ID = 'guardian-1'
const CAPSULE_ID = '00000000-0000-4000-8000-0000000000c1'
const CAPSULE_GARMENT_A = '00000000-0000-4000-8000-0000000000a1'
const CAPSULE_GARMENT_B = '00000000-0000-4000-8000-0000000000a2'
const CAPSULE_IDEMPOTENCY_KEY = '3f1e8c2a-9b47-4d21-8f6e-5a0c7d3b1e94'

/** The strong validator this API issues and requires back on every mutation. */
const capsuleETagFor = (revision: number) => `"capsule:${CAPSULE_ID}:${revision}"`

const capsuleBody = (revision: number) => ({
  id: string(CAPSULE_ID),
  ownerUserId: string(CAPSULE_OWNER_ID),
  name: string('Work capsule'),
  description: nullValue(),
  occasions: eachLike('work'),
  isFavorite: like(false),
  revision: like(revision),
  availabilityStatus: string('ready'),
  unavailableGarmentCount: like(0),
  garments: eachLike({
    id: string(CAPSULE_GARMENT_A),
    category: string('top'),
    material: string('cotton'),
    comfortRange: string('mild'),
    imageAccess: nullValue(),
    availabilityStatus: string('ready'),
    garmentOrder: like(0),
  }),
  createdAt: isoTimestamp('2026-08-07T10:00:00.000Z'),
  updatedAt: isoTimestamp('2026-08-07T10:00:00.000Z'),
})

/** Shared by the create interaction and its idempotent-replay counterpart below. */
const capsuleCreateRequestBody: CreateOutfitCapsuleInput = {
  name: 'Work capsule',
  occasions: ['work'],
  garmentIds: [CAPSULE_GARMENT_A, CAPSULE_GARMENT_B],
  isFavorite: false,
}

export async function verifyCreateCapsuleInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Two ready and active garments exist for owner',
        params: { userId: CAPSULE_OWNER_ID },
      })
    )
    .uponReceiving('a request to create an outfit capsule')
    .withRequest(
      'POST',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'Idempotency-Key': CAPSULE_IDEMPOTENCY_KEY },
        body: capsuleCreateRequestBody,
      })
    )
    .willRespondWith(
      201,
      setJsonContent({
        headers: {
          ETag: string(capsuleETagFor(1)),
          'Cache-Control': string('private, no-store'),
        },
        body: { data: capsuleBody(1) },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeOwnerUserIdCapsulesPost({
        ownerUserId: CAPSULE_OWNER_ID,
        idempotencyKey: CAPSULE_IDEMPOTENCY_KEY,
        createOutfitCapsuleInput: capsuleCreateRequestBody,
      })

      expect(outfitCapsuleResponseSchema.parse(response)).toBeDefined()
    })
}

/** An identical replay is a 200 against the capsule the first request created. */
export async function verifyCapsuleIdempotentReplayInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A capsule already exists for the idempotency key',
        params: { userId: CAPSULE_OWNER_ID, capsuleId: CAPSULE_ID },
      })
    )
    .uponReceiving('a replayed capsule creation with the same idempotency key')
    .withRequest(
      'POST',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'Idempotency-Key': CAPSULE_IDEMPOTENCY_KEY },
        body: capsuleCreateRequestBody,
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(capsuleETagFor(1)) },
        body: { data: capsuleBody(1) },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeOwnerUserIdCapsulesPost({
        ownerUserId: CAPSULE_OWNER_ID,
        idempotencyKey: CAPSULE_IDEMPOTENCY_KEY,
        createOutfitCapsuleInput: capsuleCreateRequestBody,
      })

      expect(outfitCapsuleResponseSchema.parse(response)).toBeDefined()
    })
}

export async function verifyListCapsulesInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Capsules exist for owner',
        params: { userId: CAPSULE_OWNER_ID },
      })
    )
    .uponReceiving('a request to list and filter outfit capsules')
    .withRequest(
      'GET',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules`,
      setJsonContent({
        headers: pactEventHeaders,
        query: { limit: '20', offset: '0', occasion: 'work', isFavorite: 'false' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: eachLike(capsuleBody(1)),
          total: like(1),
          limit: like(20),
          offset: like(0),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeOwnerUserIdCapsulesGet(
        {
          ownerUserId: CAPSULE_OWNER_ID,
          limit: 20,
          offset: 0,
          occasion: 'work',
          isFavorite: false,
        }
      )

      expect(outfitCapsuleListResponseSchema.parse(response)).toBeDefined()
    })
}

export async function verifyCapsuleDetailInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A capsule exists for owner',
        params: { userId: CAPSULE_OWNER_ID, capsuleId: CAPSULE_ID },
      })
    )
    .uponReceiving('a request to read one outfit capsule')
    .withRequest(
      'GET',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}`,
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(capsuleETagFor(1)) },
        body: { data: capsuleBody(1) },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdGet({
        ownerUserId: CAPSULE_OWNER_ID,
        capsuleId: CAPSULE_ID,
      })

      expect(outfitCapsuleResponseSchema.parse(response)).toBeDefined()
    })
}

export async function verifyUpdateCapsuleInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A capsule exists for owner',
        params: { userId: CAPSULE_OWNER_ID, capsuleId: CAPSULE_ID },
      })
    )
    .uponReceiving('a request to rename an outfit capsule with a current precondition')
    .withRequest(
      'PATCH',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': capsuleETagFor(1) },
        body: { name: 'Renamed capsule' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(capsuleETagFor(2)) },
        body: { data: capsuleBody(2) },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdPatch({
        ownerUserId: CAPSULE_OWNER_ID,
        capsuleId: CAPSULE_ID,
        ifMatch: capsuleETagFor(1),
        updateOutfitCapsuleInput: { name: 'Renamed capsule' },
      })

      expect(outfitCapsuleResponseSchema.parse(response)).toBeDefined()
    })
}

export async function verifyFavoriteCapsuleInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A capsule exists for owner',
        params: { userId: CAPSULE_OWNER_ID, capsuleId: CAPSULE_ID },
      })
    )
    .uponReceiving('a request to set the favorite state of an outfit capsule')
    .withRequest(
      'PATCH',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}/favorite`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': capsuleETagFor(1) },
        body: { isFavorite: true },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(capsuleETagFor(2)) },
        body: { data: capsuleBody(2) },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdFavoritePatch({
        ownerUserId: CAPSULE_OWNER_ID,
        capsuleId: CAPSULE_ID,
        ifMatch: capsuleETagFor(1),
        favoriteOutfitCapsuleInput: { isFavorite: true },
      })

      expect(outfitCapsuleResponseSchema.parse(response)).toBeDefined()
    })
}

export async function verifyDeleteCapsuleInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A capsule exists for owner',
        params: { userId: CAPSULE_OWNER_ID, capsuleId: CAPSULE_ID },
      })
    )
    .uponReceiving('a request to delete an outfit capsule')
    .withRequest(
      'DELETE',
      `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': capsuleETagFor(1) },
      })
    )
    .willRespondWith(204)
    .executeTest(async (mockServer: V3MockServer) => {
      await createClient(mockServer).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdDelete({
        ownerUserId: CAPSULE_OWNER_ID,
        capsuleId: CAPSULE_ID,
        ifMatch: capsuleETagFor(1),
      })
    })
}

/**
 * Documented capsule error envelopes. These pin the status and error shape the
 * clients branch on: stale and missing preconditions, ineligible garments,
 * idempotency-key reuse, and the masked 404 for an unauthorized owner.
 *
 * Exported alongside a single-interaction `verifyCapsuleErrorInteraction` (in
 * place of the earlier grouped `verifyCapsuleErrorInteractions` that looped
 * `addInteraction()...executeTest()` inside one `it()`) so each pacttest file
 * drives one `it.each(...)` row per interaction -- PactV4's Rust FFI
 * non-deterministically drops an interaction when more than one such chain
 * is awaited inside a single test body. See the identical fix and rationale
 * on `suggestGarmentTagsErrorInteractions`/`updateGarmentTagsErrorInteractions`
 * above, from the same dedicated bmad-tea test-architecture review pass.
 */
export type CapsuleErrorInteraction = {
  description: string
  method: 'POST' | 'PATCH' | 'DELETE' | 'GET'
  path: string
  state: string
  headers: Record<string, string>
  body?: Record<string, unknown>
  status: number
  code: string
  /** Nest's reason phrase, carried in `error`. Null when none is emitted. */
  reason: string | null
}

export const capsuleErrorInteractions: CapsuleErrorInteraction[] = [
  {
    description: 'rejects a stale precondition with 412',
    method: 'PATCH',
    path: `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}`,
    state: 'A capsule exists for owner at a newer revision',
    headers: { ...pactEventHeaders, 'If-Match': capsuleETagFor(1) },
    body: { name: 'Stale rename' },
    status: 412,
    code: 'CAPSULE_REVISION_MISMATCH',
    reason: 'Precondition Failed',
  },
  {
    description: 'requires a precondition with 428',
    method: 'PATCH',
    path: `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}`,
    state: 'A capsule exists for owner',
    headers: pactEventHeaders,
    body: { name: 'Unconditional rename' },
    status: 428,
    code: 'PRECONDITION_REQUIRED',
    /**
     * 428 is raised as a bare HttpException rather than a named Nest exception,
     * so the response carries no `error` reason phrase. Pinning one here would
     * describe an envelope the provider never sends.
     */
    reason: null,
  },
  {
    description: 'rejects an ineligible garment with 409',
    method: 'POST',
    path: `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules`,
    state: 'A garment pending deletion exists for owner',
    headers: pactEventHeaders,
    body: {
      name: 'Ineligible capsule',
      occasions: ['work'],
      garmentIds: [CAPSULE_GARMENT_A, CAPSULE_GARMENT_B],
      isFavorite: false,
    },
    status: 409,
    code: 'GARMENT_NOT_CAPSULE_ELIGIBLE',
    reason: 'Conflict',
  },
  {
    description: 'rejects idempotency key reuse with a changed payload',
    method: 'POST',
    path: `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules`,
    state: 'A capsule already exists for the idempotency key',
    headers: { ...pactEventHeaders, 'Idempotency-Key': CAPSULE_IDEMPOTENCY_KEY },
    body: {
      name: 'A different capsule',
      occasions: ['casual'],
      garmentIds: [CAPSULE_GARMENT_A, CAPSULE_GARMENT_B],
      isFavorite: true,
    },
    status: 409,
    code: 'IDEMPOTENCY_KEY_REUSED',
    reason: 'Conflict',
  },
  {
    description: 'masks an unauthorized owner relationship as 404',
    method: 'GET',
    path: `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules/${CAPSULE_ID}`,
    state: 'The actor has no relationship with the owner',
    headers: pactEventHeaders,
    status: 404,
    code: 'NOT_FOUND',
    reason: 'Not Found',
  },
]

export async function verifyCapsuleErrorInteraction(
  pact: PactV4,
  interaction: CapsuleErrorInteraction
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: interaction.state,
        params: { userId: CAPSULE_OWNER_ID, capsuleId: CAPSULE_ID },
      })
    )
    .uponReceiving(`a capsule request that ${interaction.description}`)
    .withRequest(
      interaction.method,
      interaction.path,
      setJsonContent({
        headers: interaction.headers,
        ...(interaction.body ? { body: interaction.body } : {}),
      })
    )
    /**
     * The canonical envelope is Nest's default shape from
     * `packages/api-client/src/contracts/http/common.ts`: `error` is the
     * reason phrase string and the machine-readable code travels in
     * `message`. An earlier version of this contract declared a nested
     * `{ error: { code, message } }` object, which no endpoint in this API
     * emits, so provider verification could never have passed.
     */
    .willRespondWith(
      interaction.status,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          statusCode: like(interaction.status),
          message: string(interaction.code),
          ...(interaction.reason ? { error: string(interaction.reason) } : {}),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The interaction must actually be issued. An empty callback leaves the
      // declared request unsent, and Pact fails the whole test with
      // "expected but not received" rather than recording the contract.
      //
      // The generated SDK throws on these statuses, so the request goes out
      // directly: the point is to pin the status and error envelope the
      // clients branch on, not the SDK's error-handling.
      const response = await fetch(`${mockServer.url}${interaction.path}`, {
        method: interaction.method,
        headers: interaction.body
          ? { ...interaction.headers, 'Content-Type': 'application/json' }
          : interaction.headers,
        ...(interaction.body ? { body: JSON.stringify(interaction.body) } : {}),
      })

      expect(response.status).toBe(interaction.status)

      const payload = (await response.json()) as {
        statusCode?: number
        message?: string
        error?: string
      }
      expect(payload.statusCode).toBe(interaction.status)
      expect(payload.message).toBe(interaction.code)
      expect(payload.error).toBe(interaction.reason ?? undefined)
    })
}

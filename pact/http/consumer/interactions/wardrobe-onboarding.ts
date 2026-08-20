import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import { wardrobeOnboardingStateResponseSchema } from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import { like, pactEventHeaders, string, type CreateClient } from './shared'
import {
  ONBOARDING_OWNER_ID,
  ONBOARDING_STARTED_AT,
  onboardingETagFor,
  onboardingStateBody,
} from './wardrobe-fixtures'

// --- Onboarding state machine (ownership: owner reading/writing own state) -

export async function verifyOnboardingStateInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Wardrobe onboarding state exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to read existing wardrobe onboarding progress')
    .withRequest(
      'GET',
      '/api/v1/wardrobe/onboarding',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(onboardingETagFor(1)) },
        body: {
          data: onboardingStateBody(1, {
            status: 'in_progress',
            currentStep: 'capture',
            usedStarterWardrobe: false,
            garmentsCapturedCount: 1,
            startedAt: ONBOARDING_STARTED_AT,
            completedAt: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeOnboardingGet()

      expect(wardrobeOnboardingStateResponseSchema.parse(response)).toMatchObject({
        data: { status: 'in_progress', currentStep: 'capture' },
      })
    })
}

export async function verifyOnboardingVirtualDefaultInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'No wardrobe onboarding state exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to read onboarding progress before any row exists')
    .withRequest(
      'GET',
      '/api/v1/wardrobe/onboarding',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(onboardingETagFor(0)) },
        body: {
          data: onboardingStateBody(0, {
            status: 'not_started',
            currentStep: 'permission',
            usedStarterWardrobe: false,
            garmentsCapturedCount: 0,
            startedAt: null,
            completedAt: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeOnboardingGet()

      expect(wardrobeOnboardingStateResponseSchema.parse(response)).toEqual({
        data: {
          status: 'not_started',
          currentStep: 'permission',
          usedStarterWardrobe: false,
          garmentsCapturedCount: 0,
          startedAt: null,
          completedAt: null,
          revision: 0,
        },
      })
    })
}

export async function verifyPatchOnboardingStateInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Wardrobe onboarding state exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a request to advance the onboarding state machine one step')
    .withRequest(
      'PATCH',
      '/api/v1/wardrobe/onboarding',
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': onboardingETagFor(1) },
        body: { targetStep: 'tagging' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(onboardingETagFor(2)) },
        body: {
          data: onboardingStateBody(2, {
            status: 'in_progress',
            currentStep: 'tagging',
            usedStarterWardrobe: false,
            garmentsCapturedCount: 1,
            startedAt: ONBOARDING_STARTED_AT,
            completedAt: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeOnboardingPatch({
        ifMatch: onboardingETagFor(1),
        updateWardrobeOnboardingStateInput: { targetStep: 'tagging' },
      })

      expect(wardrobeOnboardingStateResponseSchema.parse(response).data.currentStep).toBe(
        'tagging'
      )
    })
}

/**
 * AC4: "a repeated identical mutation is a safe no-op that changes no
 * revision or telemetry." Grounded in
 * `wardrobe-onboarding.service.ts`'s `advanceExistingState`: a PATCH whose
 * `targetStep`/`usedStarterWardrobe` exactly match the current row is an
 * `isIdenticalReplay`, returned unchanged (same revision, same ETag) rather
 * than incrementing. `verifyPatchOnboardingStateInteraction`'s "Wardrobe
 * onboarding state exists for user" fixture implies `currentStep: 'capture'`
 * at revision 1 (that interaction advances it to `'tagging'`); replaying
 * with `targetStep: 'capture'` (the *current* step, not the next one) is
 * exactly the identical-replay condition.
 */
export async function verifyOnboardingReplayInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'Wardrobe onboarding state exists for user',
        params: { userId: ONBOARDING_OWNER_ID },
      })
    )
    .uponReceiving('a repeated identical onboarding step transition')
    .withRequest(
      'PATCH',
      '/api/v1/wardrobe/onboarding',
      setJsonContent({
        headers: { ...pactEventHeaders, 'If-Match': onboardingETagFor(1) },
        body: { targetStep: 'capture' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { ETag: string(onboardingETagFor(1)) },
        body: {
          data: onboardingStateBody(1, {
            status: 'in_progress',
            currentStep: 'capture',
            usedStarterWardrobe: false,
            garmentsCapturedCount: 1,
            startedAt: ONBOARDING_STARTED_AT,
            completedAt: null,
          }),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1WardrobeOnboardingPatch({
        ifMatch: onboardingETagFor(1),
        updateWardrobeOnboardingStateInput: { targetStep: 'capture' },
      })

      const parsed = wardrobeOnboardingStateResponseSchema.parse(response).data
      expect(parsed.currentStep).toBe('capture')
      expect(parsed.revision).toBe(1)
    })
}

/**
 * Shared documented-error-envelope interaction for the Story 4.4 routes.
 * Mirrors `verifySmartTagErrorInteraction`/`capsuleErrorInteractions`, but
 * generalized over both new tables' state params in one place instead of
 * duplicating the helper a third time.
 *
 * Exported, along with the interaction tables below, so each pacttest file
 * can drive one `it.each(...)` row per interaction rather than looping over
 * the table inside a single `it()` — PactV4's Rust FFI non-deterministically
 * drops an interaction when more than one `addInteraction()...executeTest()`
 * chain is awaited inside one test body, so "one interaction per test" (the
 * task's own wording) means one per `it()`, not one per exported function.
 */
export type WardrobeErrorInteraction = {
  description: string
  method: 'GET' | 'PATCH' | 'PUT' | 'POST' | 'DELETE'
  path: string
  state: string
  stateParams: Record<string, unknown>
  headers: Record<string, string>
  body?: Record<string, unknown>
  status: number
  code: string
  /**
   * Nest's reason phrase, carried in `error`. `null` for the 428 case: real
   * provider verification confirmed `parseOnboardingIfMatchHeader`/
   * `parseSilhouetteIfMatchHeader` raise a bare `HttpException` for a
   * missing `If-Match`, which carries no `error` field at all — mirroring
   * `CapsuleErrorInteraction`'s identical, already-documented 428 case.
   */
  reason: string | null
}

export async function verifyWardrobeErrorInteraction(
  pact: PactV4,
  interaction: WardrobeErrorInteraction
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({ name: interaction.state, params: interaction.stateParams })
    )
    .uponReceiving(interaction.description)
    .withRequest(
      interaction.method,
      interaction.path,
      setJsonContent({
        headers: interaction.headers,
        ...(interaction.body ? { body: interaction.body } : {}),
      })
    )
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

export const onboardingErrorInteractions: WardrobeErrorInteraction[] = [
  {
    description: 'a request that skips ahead to an unreachable onboarding step',
    method: 'PATCH',
    path: '/api/v1/wardrobe/onboarding',
    state: 'Wardrobe onboarding state exists for user',
    stateParams: { userId: ONBOARDING_OWNER_ID },
    headers: { ...pactEventHeaders, 'If-Match': onboardingETagFor(1) },
    body: { targetStep: 'complete' },
    status: 409,
    code: 'INVALID_STEP_TRANSITION',
    reason: 'Conflict',
  },
  {
    description: 'a request with a stale onboarding revision precondition',
    method: 'PATCH',
    path: '/api/v1/wardrobe/onboarding',
    state: 'Wardrobe onboarding state exists for user at a newer revision',
    stateParams: { userId: ONBOARDING_OWNER_ID },
    headers: { ...pactEventHeaders, 'If-Match': onboardingETagFor(1) },
    body: { targetStep: 'tagging' },
    status: 412,
    code: 'ONBOARDING_REVISION_MISMATCH',
    reason: 'Precondition Failed',
  },
  {
    description: 'a request to advance onboarding without an If-Match precondition',
    method: 'PATCH',
    path: '/api/v1/wardrobe/onboarding',
    state: 'Wardrobe onboarding state exists for user',
    stateParams: { userId: ONBOARDING_OWNER_ID },
    headers: pactEventHeaders,
    body: { targetStep: 'tagging' },
    status: 428,
    code: 'PRECONDITION_REQUIRED',
    // 428 is raised as a bare HttpException, not a named Nest exception, so
    // the response carries no `error` reason phrase — confirmed against the
    // real provider (see the capsule 428 case's identical, pre-existing note).
    reason: null,
  },
]

import { ResponseError, withRequestDeadline } from '@couture/api-client'
import {
  type GarmentItemContract,
  type GarmentWithTags,
  type GarmentUsageResponse,
  type UpdateGarmentTagsInput,
  type SuggestGarmentTagsData,
  type CreateOutfitCapsuleInput,
  type UpdateOutfitCapsuleInput,
  type ListOutfitCapsulesQuery,
  type OutfitCapsuleContract,
  type WardrobeOnboardingStateContract,
  type UpdateWardrobeOnboardingStateInput,
  type SilhouetteProfileContract,
  type UpdateSilhouetteSlidersInput,
  type CreateSilhouetteUploadUrlInput,
  type CreateSilhouetteUploadUrlResponse,
  type CommitSilhouettePhotoInput,
  userProfileResponseSchema,
  garmentListClientResponseSchema,
  updateGarmentTagsClientResponseSchema,
  garmentUsageResponseSchema,
  suggestGarmentTagsResponseSchema,
  outfitCapsuleResponseSchema,
  outfitCapsuleListResponseSchema,
  wardrobeOnboardingStateResponseSchema,
  silhouetteProfileResponseSchema,
  createSilhouetteUploadUrlResponseSchema,
} from '@couture/api-client/contracts/http'
import { createMobileApiClient } from './api-client'
import { waitForPoll } from './native-utils'
import { throwUploadStepError } from './upload-attempts'

/** A wardrobe API refusal: its code when the API named one, and its HTTP status. */
export type WardrobeMobileError = Error & { code?: string; status?: number }

async function actionableWardrobeError(error: unknown, fallback: string): Promise<Error> {
  if (error instanceof ResponseError) {
    try {
      const payload = (await error.response.json()) as {
        error?: string | { code?: string; message?: string }
        code?: string
        message?: string
      }
      const message =
        (typeof payload.error === 'object' ? payload.error.message : undefined) ??
        payload.message ??
        `Wardrobe request failed with status ${error.response.status}`
      const normalized = new Error(message) as WardrobeMobileError
      normalized.code =
        (typeof payload.error === 'object' ? payload.error.code : undefined) ??
        payload.code ??
        ([
          'GARMENT_ANALYSIS_PENDING',
          'TAGGING_INFERENCE_UNAVAILABLE',
          'CONCURRENT_TAG_UPDATE',
          'GARMENT_TAGS_CHANGED',
          'GUARDIAN_CONSENT_REQUIRED',
          'GARMENT_NOT_FOUND',
        ].includes(message)
          ? message
          : undefined)
      normalized.status = error.response.status
      return normalized
    } catch {
      const normalized = new Error(
        `Wardrobe request failed with status ${error.response.status}`
      ) as WardrobeMobileError
      normalized.status = error.response.status
      return normalized
    }
  }
  return error instanceof Error ? error : new Error(fallback)
}

async function withRequestTimeout<T>(
  signal: AbortSignal | undefined,
  request: (requestSignal: AbortSignal) => Promise<T>,
  timeoutMs = 15_000
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort(signal?.reason)

  if (signal?.aborted) {
    abortFromCaller()
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true })
  }

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    return await request(controller.signal)
  } catch (error) {
    if (timedOut) {
      throw new Error('Wardrobe request timed out. Please try again.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

/**
 * Story CC-7.5 D1: garment reads and tag updates opt in to `colorFamily` with
 * `x-couture-garment-color: 1`, so photos carry color plus category labels ("Blue top").
 */
export async function listGarmentsFromMobile(
  accessToken: string,
  signal?: AbortSignal,
  { today = false }: { today?: boolean } = {}
): Promise<GarmentWithTags[]> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeGarmentsGet(
        {
          xCoutureGarmentColor: '1',
          xCoutureGarmentSubtype: '1',
          ...(today ? { xCoutureTodayWardrobe: '1' as const } : {}),
        },
        { signal: requestSignal }
      )
    )
    return garmentListClientResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load your wardrobe.')
  }
}

const GARMENT_POLL_OFFSETS_MS = [1_000, 2_000, 4_000, 8_000]

/**
 * Polls the wardrobe list until `garmentId` leaves `processing`, or the
 * schedule below is exhausted. `onUpdate` fires with every refreshed list so
 * a caller can keep its own garment state in sync while polling runs. A shared
 * list reader may return null for a superseded result; continue to the next offset.
 *
 * Every offset is measured from a single `startedAt`, not from the previous
 * tick, so the four checks land at roughly +1s/+2s/+4s/+8s (~8s total) no
 * matter how long each network round-trip takes. A prior version of this
 * logic was duplicated across the wardrobe hub and onboarding screens, and
 * one copy drifted to measuring each offset from the previous tick instead
 * (an additive ~15s schedule) — this is the single implementation both now
 * share, so that class of divergence can't recur.
 */
export async function pollGarmentUntilSettled(
  accessToken: string,
  garmentId: string,
  signal: AbortSignal,
  onUpdate: ((garments: GarmentItemContract[]) => void) | undefined,
  /** Test-only override for the poll cadence. */
  offsetsMs: readonly number[] = GARMENT_POLL_OFFSETS_MS,
  loadList: (
    accessToken: string,
    signal: AbortSignal
  ) => Promise<GarmentItemContract[] | null> = listGarmentsFromMobile
): Promise<GarmentItemContract | undefined> {
  const startedAt = Date.now()
  for (const offsetMs of offsetsMs) {
    await waitForPoll(Math.max(0, startedAt + offsetMs - Date.now()), signal)
    const persisted = await loadList(accessToken, signal)
    if (!persisted) continue
    onUpdate?.(persisted)
    const current = persisted.find((garment) => garment.id === garmentId)
    if (current && current.status !== 'processing') {
      return current
    }
    if (!current) {
      return undefined
    }
  }
  return undefined
}

export async function suggestGarmentTagsFromMobile(
  accessToken: string,
  garmentId: string,
  signal?: AbortSignal
): Promise<SuggestGarmentTagsData> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeGarmentsGarmentIdSuggestTagsPost(
        { garmentId },
        { signal: requestSignal }
      )
    )
    return suggestGarmentTagsResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load smart suggestions.')
  }
}

export async function updateGarmentTagsFromMobile(
  accessToken: string,
  garmentId: string,
  tags: UpdateGarmentTagsInput,
  signal?: AbortSignal
): Promise<GarmentWithTags> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeGarmentsGarmentIdTagsPatch(
        {
          garmentId,
          updateGarmentTagsInput: tags,
          xCoutureGarmentColor: '1',
          xCoutureGarmentSubtype: '1',
        },
        { signal: requestSignal }
      )
    )
    return updateGarmentTagsClientResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to save garment tags.')
  }
}

/**
 * Story CC-7.6 D2/D3: the saved looks and capsules deleting the garment affects. A 404
 * (`GARMENT_NOT_FOUND`: unknown, another member's, no longer ready, or already being deleted)
 * resolves `null`, which the closet treats as already gone.
 */
export async function getGarmentUsageFromMobile(
  accessToken: string,
  garmentId: string,
  signal?: AbortSignal
): Promise<GarmentUsageResponse | null> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeGarmentsGarmentIdUsageGet({ garmentId }, { signal: requestSignal })
    )
    return garmentUsageResponseSchema.parse(response)
  } catch (error) {
    const failure = (await actionableWardrobeError(
      error,
      'Unable to check where this piece is used.'
    )) as WardrobeMobileError
    // Only the API's own answer means gone; a route-level 404 (a deploy without the route)
    // is a failure like any other.
    if (failure.status === 404 && failure.code === 'GARMENT_NOT_FOUND') return null
    throw failure
  }
}

/** Story CC-7.6: requests the garment's deletion (204, idempotent). */
export async function deleteGarmentFromMobile(
  accessToken: string,
  garmentId: string,
  signal?: AbortSignal
): Promise<void> {
  try {
    await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeGarmentsGarmentIdDelete({ garmentId }, { signal: requestSignal })
    )
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to delete this piece.')
  }
}

/**
 * Resolves the signed-in application user from the authenticated profile. Capsule routes
 * take an explicit owner segment so guardians and admins can act for another
 * user; the signed-in user is simply the default owner.
 */
export async function resolveOwnerUserId(accessToken: string): Promise<string> {
  try {
    const response = await withRequestDeadline(5000, [], (signal) =>
      createMobileApiClient({ accessToken }).apiV1UserProfileGet({ signal })
    )
    return userProfileResponseSchema.parse(response).user.id
  } catch (error) {
    if (error instanceof ResponseError && [401, 403].includes(error.response.status))
      throw new ResponseError(
        error.response,
        'Your session could not be verified. Sign in again.'
      )
    throw error
  }
}

/** The strong entity tag the API issues and requires back on every mutation. */
export function capsuleETag(capsuleId: string, revision: number): string {
  return `"capsule:${capsuleId}:${revision}"`
}

export interface MobileCapsulePage {
  items: OutfitCapsuleContract[]
  total: number
  limit: number
  offset: number
}

export async function listCapsulesFromMobile(
  accessToken: string,
  ownerUserId: string,
  query?: ListOutfitCapsulesQuery,
  signal?: AbortSignal
): Promise<MobileCapsulePage> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({ accessToken }).apiV1WardrobeOwnerUserIdCapsulesGet(
        { ownerUserId, limit: 20, offset: 0, ...query },
        { signal: requestSignal }
      )
    )
    const parsed = outfitCapsuleListResponseSchema.parse(response)
    return {
      items: parsed.data,
      total: parsed.total,
      limit: parsed.limit,
      offset: parsed.offset,
    }
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load capsules.')
  }
}

/**
 * Story CC-7.12 D6: one capsule, for a Looks tile whose capsule is outside the manager's first
 * page. A 404 (removed or another member's) throws with `status` 404.
 */
export async function getCapsuleFromMobile(
  accessToken: string,
  ownerUserId: string,
  capsuleId: string,
  signal?: AbortSignal
): Promise<OutfitCapsuleContract> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({ accessToken }).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdGet(
        { ownerUserId, capsuleId },
        { signal: requestSignal }
      )
    )
    return outfitCapsuleResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load capsule detail.')
  }
}

/**
 * `idempotencyKey` is required rather than generated internally so a retry after
 * a timeout replays the original request instead of creating a second capsule.
 */
export async function createCapsuleFromMobile(
  accessToken: string,
  ownerUserId: string,
  input: CreateOutfitCapsuleInput,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<OutfitCapsuleContract> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({ accessToken }).apiV1WardrobeOwnerUserIdCapsulesPost(
        { ownerUserId, idempotencyKey, createOutfitCapsuleInput: input },
        { signal: requestSignal }
      )
    )
    return outfitCapsuleResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to save the capsule.')
  }
}

export async function updateCapsuleFromMobile(
  accessToken: string,
  ownerUserId: string,
  capsuleId: string,
  input: UpdateOutfitCapsuleInput,
  ifMatch: string,
  signal?: AbortSignal
): Promise<OutfitCapsuleContract> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdPatch(
        { ownerUserId, capsuleId, ifMatch, updateOutfitCapsuleInput: input },
        { signal: requestSignal }
      )
    )
    return outfitCapsuleResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to save the capsule.')
  }
}

export async function favoriteCapsuleFromMobile(
  accessToken: string,
  ownerUserId: string,
  capsuleId: string,
  isFavorite: boolean,
  ifMatch: string,
  signal?: AbortSignal
): Promise<OutfitCapsuleContract> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdFavoritePatch(
        {
          ownerUserId,
          capsuleId,
          ifMatch,
          favoriteOutfitCapsuleInput: { isFavorite },
        },
        { signal: requestSignal }
      )
    )
    return outfitCapsuleResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to update favorite status.')
  }
}

export async function deleteCapsuleFromMobile(
  accessToken: string,
  ownerUserId: string,
  capsuleId: string,
  ifMatch: string,
  signal?: AbortSignal
): Promise<void> {
  try {
    await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdDelete(
        { ownerUserId, capsuleId, ifMatch },
        { signal: requestSignal }
      )
    )
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to delete the capsule.')
  }
}

// ---------------------------------------------------------------------------
// Story 4.4: wardrobe onboarding state machine and silhouette profile.
// Routes are self-scoped to the caller's own `auth.userId` (decision 11), so
// unlike capsules there is no `ownerUserId` path segment here.
// ---------------------------------------------------------------------------

/**
 * The onboarding row is one-per-user with no separate entity id in the response
 * body, so the strong entity tag is built from the caller's own user id (decoded
 * from the bearer token via {@link resolveOwnerUserId}) plus the row's revision,
 * matching the format the API documents: `"onboarding:<userId>:<revision>"`.
 */
export function onboardingETag(userId: string, revision: number): string {
  return `"onboarding:${userId}:${revision}"`
}

/** Same shape as {@link onboardingETag}, for the sibling singleton-per-user table. */
export function silhouetteETag(userId: string, revision: number): string {
  return `"silhouette:${userId}:${revision}"`
}

export async function getWardrobeOnboardingStateFromMobile(
  accessToken: string,
  signal?: AbortSignal
): Promise<WardrobeOnboardingStateContract> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({ accessToken }).apiV1WardrobeOnboardingGet({
        signal: requestSignal,
      })
    )
    return wardrobeOnboardingStateResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load your onboarding progress.')
  }
}

export async function updateWardrobeOnboardingStateFromMobile(
  accessToken: string,
  input: UpdateWardrobeOnboardingStateInput,
  ifMatch: string,
  signal?: AbortSignal
): Promise<WardrobeOnboardingStateContract> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({ accessToken }).apiV1WardrobeOnboardingPatch(
        { ifMatch, updateWardrobeOnboardingStateInput: input },
        { signal: requestSignal }
      )
    )
    return wardrobeOnboardingStateResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to save this onboarding step.')
  }
}

export async function getSilhouetteProfileFromMobile(
  accessToken: string,
  signal?: AbortSignal
): Promise<SilhouetteProfileContract> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({ accessToken }).apiV1WardrobeSilhouetteGet({
        signal: requestSignal,
      })
    )
    return silhouetteProfileResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load your silhouette profile.')
  }
}

export async function updateSilhouetteSlidersFromMobile(
  accessToken: string,
  input: UpdateSilhouetteSlidersInput,
  ifMatch: string,
  signal?: AbortSignal
): Promise<SilhouetteProfileContract> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({ accessToken }).apiV1WardrobeSilhouettePut(
        { ifMatch, updateSilhouetteSlidersInput: input },
        { signal: requestSignal }
      )
    )
    return silhouetteProfileResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to save your silhouette sliders.')
  }
}

export async function createSilhouetteUploadUrlFromMobile(
  accessToken: string,
  input: CreateSilhouetteUploadUrlInput,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<CreateSilhouetteUploadUrlResponse['data']> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({ accessToken }).apiV1WardrobeSilhouetteMyFormUploadUrlPost(
        { idempotencyKey, createSilhouetteUploadUrlInput: input },
        { signal: requestSignal }
      )
    )
    return createSilhouetteUploadUrlResponseSchema.parse(response).data
  } catch (error) {
    // The API's status and code ride along on the surfaced error for the upload attempt runner.
    return throwUploadStepError(error, (raw) =>
      actionableWardrobeError(raw, 'Unable to start the My Form upload.')
    )
  }
}

export async function commitSilhouettePhotoFromMobile(
  accessToken: string,
  input: CommitSilhouettePhotoInput,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<SilhouetteProfileContract> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({ accessToken }).apiV1WardrobeSilhouetteMyFormCommitPost(
        { idempotencyKey, commitSilhouettePhotoInput: input },
        { signal: requestSignal }
      )
    )
    return silhouetteProfileResponseSchema.parse(response).data
  } catch (error) {
    return throwUploadStepError(error, (raw) =>
      actionableWardrobeError(raw, 'Unable to save your My Form photo.')
    )
  }
}

export async function deleteSilhouettePhotoFromMobile(
  accessToken: string,
  ifMatch: string,
  signal?: AbortSignal
): Promise<SilhouetteProfileContract> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({ accessToken }).apiV1WardrobeSilhouetteMyFormDelete(
        { ifMatch },
        { signal: requestSignal }
      )
    )
    return silhouetteProfileResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to remove your My Form photo.')
  }
}

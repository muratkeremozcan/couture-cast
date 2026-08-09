import { ResponseError } from '@couture/api-client'
import {
  type GarmentItemContract,
  type SuggestGarmentTagsData,
  type GarmentCategory,
  type GarmentMaterial,
  type GarmentComfortRange,
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
  garmentListResponseSchema,
  suggestGarmentTagsResponseSchema,
  updateGarmentTagsResponseSchema,
  outfitCapsuleResponseSchema,
  outfitCapsuleListResponseSchema,
  wardrobeOnboardingStateResponseSchema,
  silhouetteProfileResponseSchema,
  createSilhouetteUploadUrlResponseSchema,
} from '@couture/api-client/contracts/http'
import { createMobileApiClient } from './api-client'

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
      const normalized = new Error(message) as Error & { code?: string }
      normalized.code =
        (typeof payload.error === 'object' ? payload.error.code : undefined) ??
        payload.code ??
        (['GARMENT_ANALYSIS_PENDING', 'TAGGING_INFERENCE_UNAVAILABLE'].includes(message)
          ? message
          : undefined)
      return normalized
    } catch {
      return new Error(`Wardrobe request failed with status ${error.response.status}`)
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

export async function listGarmentsFromMobile(
  accessToken: string,
  signal?: AbortSignal
): Promise<GarmentItemContract[]> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeGarmentsGet({ signal: requestSignal })
    )
    return garmentListResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load your wardrobe.')
  }
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
  tags: {
    category: GarmentCategory
    material?: GarmentMaterial | null
    comfortRange: GarmentComfortRange
  },
  signal?: AbortSignal
): Promise<GarmentItemContract> {
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createMobileApiClient({
        accessToken,
      }).apiV1WardrobeGarmentsGarmentIdTagsPatch(
        { garmentId, updateGarmentTagsInput: tags },
        { signal: requestSignal }
      )
    )
    return updateGarmentTagsResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to save garment tags.')
  }
}

/**
 * Resolves the signed-in user from the bearer token's `sub` claim. Capsule routes
 * take an explicit owner segment so guardians and admins can act for another
 * user; the signed-in user is simply the default owner.
 */
export function resolveOwnerUserId(accessToken: string): string {
  const payloadSegment = accessToken.split('.')[1]
  if (!payloadSegment) {
    throw new Error('Your session token is malformed. Sign in again.')
  }

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const claims = JSON.parse(
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8')
    ) as { sub?: unknown }
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new Error('missing sub claim')
    }
    return claims.sub
  } catch {
    throw new Error('Your session token is malformed. Sign in again.')
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
    throw await actionableWardrobeError(error, 'Unable to start the My Form upload.')
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
    throw await actionableWardrobeError(error, 'Unable to save your My Form photo.')
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

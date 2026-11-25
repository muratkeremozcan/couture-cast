'use client'

import {
  uploadGarmentBytes,
  WARDROBE_UPLOAD_CACHE_CONTROL,
  parseGarmentListWithColorResponse,
  parseUpdateGarmentTagsWithColorResponse,
  suggestGarmentTagsResponseSchema,
  outfitCapsuleResponseSchema,
  outfitCapsuleListResponseSchema,
  userProfileResponseSchema,
  wardrobeOnboardingStateResponseSchema,
  silhouetteProfileResponseSchema,
  createSilhouetteUploadUrlResponseSchema,
  type GarmentCategory,
  type GarmentMaterial,
  type GarmentComfortRange,
  type GarmentItemContract,
  type GarmentWithColor,
  type SuggestGarmentTagsData,
  type OutfitCapsuleContract,
  type CreateOutfitCapsuleInput,
  type UpdateOutfitCapsuleInput,
  type ListOutfitCapsulesQuery,
  type WardrobeOnboardingStateContract,
  type UpdateWardrobeOnboardingStateInput,
  type SilhouetteProfileContract,
  type UpdateSilhouetteSlidersInput,
  type UploadAttemptSession,
} from '@couture/api-client/contracts/http'
import { ResponseError } from '@couture/api-client'
import { createWebApiClient, resolveWebApiBaseUrl } from './api-client'
import { removePlainGarmentBackground } from './garment-background'
import { readStorage, WEB_ACCESS_TOKEN_STORAGE_KEY } from './browser-persistence'
import {
  createUploadAttempts,
  preparedImageFingerprint,
  resolveUploadBearer,
  runTrackedUpload,
  throwUploadStepError,
} from './upload-attempts'

export { WEB_ACCESS_TOKEN_STORAGE_KEY } from './browser-persistence'

export type GarmentUploadState =
  | 'preparing'
  | 'requesting_upload'
  | 'uploading'
  | 'verifying'
  | 'processing'

export interface UploadGarmentImageInput {
  imagePreview: string
  /**
   * The session captured when the member opened the camera or file picker that produced
   * `imagePreview` (`currentUploadSession`). The upload resolves its bearer for that account
   * and refuses once the signed-in account changed.
   */
  uploadSession: UploadAttemptSession
  aspectRatio: '1:1' | '4:3'
  useBgCleanup: boolean
  prepared?: PreparedImage
  signal?: AbortSignal
  onStateChange?: (state: GarmentUploadState) => void
  onProgress?: (percentage: number) => void
}

export type PreparedImage = {
  blob: Blob
  heightPx: number
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  sha256: string
  widthPx: number
  backgroundRemoved?: boolean
}

export class WardrobeRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    /** The HTTP status of an API refusal; absent for local and network failures. */
    readonly status?: number
  ) {
    super(message)
    this.name = 'WardrobeRequestError'
  }
}

type GarmentUploadAllocation = {
  garmentId: string
  uploadSessionId: string
  uploadUrl: string
  uploadToken: string
}

type PhotoUploadAllocation = {
  uploadSessionId: string
  uploadUrl: string
  uploadToken: string
}

/**
 * Open garment and My Form upload attempts, kept across the member's retries in this tab and
 * scoped to the signed-in account; see `runTrackedUpload`. Each attempt gets fresh keys.
 */
const garmentUploadAttempts = createUploadAttempts<GarmentUploadAllocation>(() =>
  generateIdempotencyKey()
)
const myFormUploadAttempts = createUploadAttempts<PhotoUploadAllocation>(() =>
  generateIdempotencyKey()
)

function readAccessToken(): string {
  const token = readStorage('session', WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim()
  if (!token) {
    throw new WardrobeRequestError(
      'Your session expired. Sign in again before adding a garment.',
      'SIGNED_OUT'
    )
  }
  return token
}

/**
 * Resolves the signed-in user's id from the API.
 *
 * Capsule routes take an explicit owner path segment so guardians and admins can
 * act for another user. The signed-in user is the default owner, and the server
 * is the only authority on who that is.
 *
 * This deliberately does not decode the bearer token. Reading the `sub` claim
 * client-side couples the page to one token format, and the identity it derives
 * is whatever the client chooses to believe rather than what the API enforces.
 */
export async function resolveCurrentUserId(): Promise<string> {
  const accessToken = readAccessToken()

  try {
    const profile = await createWebApiClient({ accessToken }).apiV1UserProfileGet()
    const userId = userProfileResponseSchema.parse(profile).user.id
    if (userId.length === 0) {
      throw new Error('empty user id')
    }
    return userId
  } catch (error: unknown) {
    throw new WardrobeRequestError(
      'Unable to confirm your account. Sign in again.',
      error instanceof Error ? error.message : undefined
    )
  }
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(
        new WardrobeRequestError(
          'The selected image could not be decoded.',
          'IMAGE_UNREADABLE'
        )
      )
    image.src = source
  })
}

/** Quality for the lossy encodings below: no visible loss at garment-card sizes. */
const PREPARED_IMAGE_QUALITY = 0.9

/**
 * The format a prepared upload is encoded in. JPEG wherever nothing is transparent: a 12 MP
 * phone photo prepared as PNG came to 5 MB or more. WebP when background cleanup has cut the
 * garment out, because JPEG has no alpha. A browser that cannot encode WebP hands back PNG,
 * which the upload contract also accepts.
 */
export function preparedImageEncoding(useBgCleanup: boolean): {
  mimeType: 'image/jpeg' | 'image/webp'
  quality: number
} {
  return {
    mimeType: useBgCleanup ? 'image/webp' : 'image/jpeg',
    quality: PREPARED_IMAGE_QUALITY,
  }
}

/**
 * How `prepareGarmentImage` encodes. `compact` is `preparedImageEncoding`, for uploads whose
 * commit verifies the bytes (garments, My Form, selfies). `source` keeps the picked file's own
 * format at quality 0.92, as before the 2026-11-19 change: community posts keep a PNG as PNG,
 * transparency included, because the community pipeline re-encodes them itself.
 */
export type PreparedImageEncodingChoice = 'compact' | 'source'

/** The format and quality `prepareGarmentImage` asks the canvas for. */
async function resolveEncoding(
  imagePreview: string,
  useBgCleanup: boolean,
  choice: PreparedImageEncodingChoice
): Promise<{ mimeType: string; quality: number }> {
  if (choice === 'compact') return preparedImageEncoding(useBgCleanup)
  if (useBgCleanup) return { mimeType: 'image/png', quality: 0.92 }
  const sourceBlob = await fetch(imagePreview).then((response) => response.blob())
  return { mimeType: sourceBlob.type, quality: 0.92 }
}

function toBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
          return
        }
        reject(
          new WardrobeRequestError(
            'The selected image could not be prepared.',
            'IMAGE_UNREADABLE'
          )
        )
      },
      mimeType,
      quality
    )
  })
}

/**
 * Exported because `palette-advisor.ts` uploads a selfie through the same
 * allocate -> PUT bytes -> commit lifecycle and needs the identical
 * client-side preparation: centre crop to a fixed aspect, cap the long edge at
 * 2048px, reject anything under the server's 256px floor, encode as
 * `preparedImageEncoding` says, and compute the SHA-256 the allocate call
 * declares. A second copy would be the third
 * canvas-crop implementation in this app and would drift from the server's
 * `verifyGarmentImage` checks the moment either side moved.
 *
 * The name still says "garment" because that is what every existing caller
 * uploads; nothing about the function is garment-specific.
 */
export async function prepareGarmentImage(
  imagePreview: string,
  aspectRatio: '1:1' | '4:3',
  useBgCleanup: boolean,
  encodingChoice: PreparedImageEncodingChoice
): Promise<PreparedImage> {
  const [image, encoding] = await Promise.all([
    loadImage(imagePreview),
    resolveEncoding(imagePreview, useBgCleanup, encodingChoice),
  ])
  const sourceWidth = image.naturalWidth
  const sourceHeight = image.naturalHeight
  const targetRatio = aspectRatio === '1:1' ? 1 : 3 / 4
  const sourceRatio = sourceWidth / sourceHeight
  const cropWidth = sourceRatio > targetRatio ? sourceHeight * targetRatio : sourceWidth
  const cropHeight = sourceRatio > targetRatio ? sourceHeight : sourceWidth / targetRatio
  const scale = Math.min(1, 2048 / Math.max(cropWidth, cropHeight))
  const outputWidth = Math.round(cropWidth * scale)
  const outputHeight = Math.round(cropHeight * scale)
  if (outputWidth < 256 || outputHeight < 256) {
    throw new WardrobeRequestError(
      'Choose an image at least 256 pixels wide and tall.',
      'IMAGE_TOO_SMALL'
    )
  }

  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = outputHeight
  const context = canvas.getContext('2d', { willReadFrequently: useBgCleanup })
  if (!context) {
    throw new WardrobeRequestError(
      'Image preparation is unavailable in this browser.',
      'IMAGE_PREPARATION_UNAVAILABLE'
    )
  }
  if (encodingChoice === 'compact' && encoding.mimeType === 'image/jpeg') {
    // JPEG has no alpha: a transparent source would otherwise come out black.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, outputWidth, outputHeight)
  }
  context.drawImage(
    image,
    (sourceWidth - cropWidth) / 2,
    (sourceHeight - cropHeight) / 2,
    cropWidth,
    cropHeight,
    0,
    0,
    outputWidth,
    outputHeight
  )
  const cleanup = useBgCleanup ? removePlainGarmentBackground(context) : null
  const finalEncoding =
    cleanup && !cleanup.hasTransparency && encodingChoice === 'compact'
      ? preparedImageEncoding(false)
      : encoding
  const blob = await toBlob(canvas, finalEncoding.mimeType, finalEncoding.quality)
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) {
    throw new WardrobeRequestError(
      'The prepared image format is unsupported.',
      'IMAGE_PREPARATION_UNAVAILABLE'
    )
  }
  if (blob.size > 10 * 1024 * 1024) {
    throw new WardrobeRequestError(
      'The prepared image exceeds the 10 MiB limit.',
      'IMAGE_TOO_LARGE'
    )
  }
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')

  return {
    blob,
    widthPx: outputWidth,
    heightPx: outputHeight,
    mimeType: blob.type as PreparedImage['mimeType'],
    sha256,
    backgroundRemoved: Boolean(cleanup?.removed),
  }
}

async function readError(response: Response): Promise<Error> {
  try {
    const payload = (await response.json()) as {
      error?: string | { code?: string; message?: string }
      code?: string
      message?: string
    }
    const message =
      (typeof payload.error === 'object' ? payload.error.message : undefined) ??
      payload.message ??
      `Wardrobe request failed with status ${response.status}`
    const knownCode = [
      'GARMENT_ANALYSIS_PENDING',
      'TAGGING_INFERENCE_UNAVAILABLE',
      'CONCURRENT_TAG_UPDATE',
      'GUARDIAN_CONSENT_REQUIRED',
    ].includes(message)
      ? message
      : undefined
    return new WardrobeRequestError(
      message,
      (typeof payload.error === 'object' ? payload.error.code : undefined) ??
        payload.code ??
        knownCode,
      response.status
    )
  } catch {
    return new WardrobeRequestError(
      `Wardrobe request failed with status ${response.status}`,
      undefined,
      response.status
    )
  }
}

async function withRequestTimeout<T>(
  signal: AbortSignal | undefined,
  request: (requestSignal: AbortSignal) => Promise<T>,
  timeoutMs = 15_000
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort(signal?.reason)
  if (signal?.aborted) abortFromCaller()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await request(controller.signal)
  } catch (error) {
    if (timedOut) {
      throw new WardrobeRequestError(
        'Wardrobe request timed out. Please try again.',
        'REQUEST_TIMEOUT'
      )
    }
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

async function actionableWardrobeError(error: unknown, fallback: string): Promise<Error> {
  if (error instanceof ResponseError) {
    return readError(error.response)
  }
  return error instanceof Error ? error : new Error(fallback)
}

export async function uploadGarmentImageFromWeb({
  imagePreview,
  aspectRatio,
  useBgCleanup,
  prepared,
  signal,
  onStateChange,
  onProgress,
  uploadSession,
}: UploadGarmentImageInput): Promise<GarmentItemContract> {
  // The bearer of the account the photo was picked under; an account change from the pick on
  // refuses here, and while the image is prepared or uploaded it fences this run.
  const accessToken = await resolveUploadBearer(uploadSession, readAccessToken)
  onStateChange?.('preparing')
  onProgress?.(10)
  const image =
    prepared ??
    (await prepareGarmentImage(imagePreview, aspectRatio, useBgCleanup, 'compact'))
  const hasBgCleanup = image.backgroundRemoved ?? false

  const api = createWebApiClient({ accessToken })
  // A retry of the same prepared image (the member taps Use This Image again after a failure)
  // is the same attempt: same garment session, same commit key.
  const attemptId = `${preparedImageFingerprint({
    sha256: image.sha256,
    fileSizeBytes: image.blob.size,
    mimeType: image.mimeType,
    widthPx: image.widthPx,
    heightPx: image.heightPx,
  })}:${hasBgCleanup ? 'cleanup' : 'original'}`
  const garment = await runTrackedUpload(
    garmentUploadAttempts,
    uploadSession,
    attemptId,
    {
      allocate: async (idempotencyKey) => {
        onStateChange?.('requesting_upload')
        onProgress?.(25)
        try {
          return (
            await api.apiV1WardrobeUploadUrlPost(
              {
                idempotencyKey,
                createGarmentUploadUrlInput: {
                  fileSizeBytes: image.blob.size,
                  mimeType: image.mimeType,
                  sha256: image.sha256,
                  widthPx: image.widthPx,
                  heightPx: image.heightPx,
                },
              },
              { signal }
            )
          ).data
        } catch (error) {
          return throwUploadStepError(error, (raw) =>
            actionableWardrobeError(raw, 'Unable to allocate garment upload.')
          )
        }
      },
      upload: async (allocation) => {
        onStateChange?.('uploading')
        onProgress?.(35)
        await uploadGarmentBytes({
          cacheControl: WARDROBE_UPLOAD_CACHE_CONTROL,
          // Commit verifies the stored bytes' sha256, so an object a lost answer left is safe.
          acceptExistingObject: true,
          uploadUrl: allocation.uploadUrl,
          apiBaseUrl: resolveWebApiBaseUrl(),
          uploadToken: allocation.uploadToken,
          bearerToken: accessToken,
          mimeType: image.mimeType,
          body: image.blob,
          signal,
          timeoutMs: 30_000,
          onProgress: () => onProgress?.(80),
        })
      },
      commit: async (allocation, idempotencyKey) => {
        onStateChange?.('verifying')
        onProgress?.(90)
        try {
          return (
            await api.apiV1WardrobeGarmentsPost(
              {
                idempotencyKey,
                createGarmentItemInput: {
                  garmentId: allocation.garmentId,
                  uploadSessionId: allocation.uploadSessionId,
                  hasCropping: true,
                  hasBgCleanup,
                },
              },
              { signal }
            )
          ).data
        } catch (error) {
          return throwUploadStepError(error, (raw) =>
            actionableWardrobeError(raw, 'Unable to commit garment upload.')
          )
        }
      },
    }
  )
  onStateChange?.('processing')
  onProgress?.(100)
  return garment
}

/**
 * Story CC-7.5 D1: every garment read and tag update opts in to `colorFamily` with
 * `x-couture-garment-color: 1`, so photos carry color plus category alt text ("Blue top").
 */
export async function listGarmentsFromWeb(
  signal?: AbortSignal
): Promise<GarmentWithColor[]> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1WardrobeGarmentsGet({ xCoutureGarmentColor: '1' }, { signal })
    return parseGarmentListWithColorResponse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load your wardrobe.')
  }
}

export async function suggestGarmentTagsFromWeb(
  garmentId: string,
  signal?: AbortSignal
): Promise<SuggestGarmentTagsData> {
  const accessToken = readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createWebApiClient({
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

export async function updateGarmentTagsFromWeb(
  garmentId: string,
  tags: {
    category: GarmentCategory
    material?: GarmentMaterial | null
    comfortRange: GarmentComfortRange
  },
  signal?: AbortSignal
): Promise<GarmentWithColor> {
  const accessToken = readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createWebApiClient({ accessToken }).apiV1WardrobeGarmentsGarmentIdTagsPatch(
        { garmentId, updateGarmentTagsInput: tags, xCoutureGarmentColor: '1' },
        { signal: requestSignal }
      )
    )
    return parseUpdateGarmentTagsWithColorResponse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to save garment tags.')
  }
}

export interface CapsulePage {
  items: OutfitCapsuleContract[]
  total: number
  limit: number
  offset: number
}

/** Returns the page plus its totals, so the caller can show what is not shown. */
export async function listCapsulesFromWeb(
  ownerUserId: string,
  query?: ListOutfitCapsulesQuery,
  signal?: AbortSignal
): Promise<CapsulePage> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1WardrobeOwnerUserIdCapsulesGet(
      { ownerUserId, limit: 50, offset: 0, ...query },
      { signal }
    )
    const parsed = outfitCapsuleListResponseSchema.parse(response)
    return {
      items: parsed.data,
      total: parsed.total,
      limit: parsed.limit,
      offset: parsed.offset,
    }
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load outfit capsules.')
  }
}

export async function getCapsuleFromWeb(
  ownerUserId: string,
  capsuleId: string,
  signal?: AbortSignal
): Promise<OutfitCapsuleContract> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdGet(
      { ownerUserId, capsuleId },
      { signal }
    )
    return outfitCapsuleResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load capsule detail.')
  }
}

/**
 * `idempotencyKey` is required rather than generated here. Minting a fresh key
 * per call meant a retry after a timeout created a second capsule, which is
 * exactly what the server-side idempotency machinery exists to prevent. The
 * caller generates one key when the form opens and reuses it for every attempt.
 */
export async function createCapsuleFromWeb(
  ownerUserId: string,
  input: CreateOutfitCapsuleInput,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<OutfitCapsuleContract> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1WardrobeOwnerUserIdCapsulesPost(
      {
        ownerUserId,
        idempotencyKey,
        createOutfitCapsuleInput: input,
      },
      { signal }
    )
    return outfitCapsuleResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to create outfit capsule.')
  }
}

export async function updateCapsuleFromWeb(
  ownerUserId: string,
  capsuleId: string,
  input: UpdateOutfitCapsuleInput,
  ifMatchHeader: string,
  signal?: AbortSignal
): Promise<OutfitCapsuleContract> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdPatch(
      {
        ownerUserId,
        capsuleId,
        ifMatch: ifMatchHeader,
        updateOutfitCapsuleInput: input,
      },
      { signal }
    )
    return outfitCapsuleResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to update outfit capsule.')
  }
}

export async function favoriteCapsuleFromWeb(
  ownerUserId: string,
  capsuleId: string,
  isFavorite: boolean,
  ifMatchHeader: string,
  signal?: AbortSignal
): Promise<OutfitCapsuleContract> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdFavoritePatch(
      {
        ownerUserId,
        capsuleId,
        ifMatch: ifMatchHeader,
        favoriteOutfitCapsuleInput: { isFavorite },
      },
      { signal }
    )
    return outfitCapsuleResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to update favorite status.')
  }
}

export async function deleteCapsuleFromWeb(
  ownerUserId: string,
  capsuleId: string,
  ifMatchHeader: string,
  signal?: AbortSignal
): Promise<void> {
  const accessToken = readAccessToken()
  try {
    await createWebApiClient({
      accessToken,
    }).apiV1WardrobeOwnerUserIdCapsulesCapsuleIdDelete(
      {
        ownerUserId,
        capsuleId,
        ifMatch: ifMatchHeader,
      },
      { signal }
    )
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to delete outfit capsule.')
  }
}

// ---------------------------------------------------------------------------
// Story 4.4: wardrobe onboarding state machine and silhouette profile
// ---------------------------------------------------------------------------

/** The strong entity tag the onboarding API issues and requires back on every mutation. */
export function onboardingETag(userId: string, revision: number): string {
  return `"onboarding:${userId}:${revision}"`
}

/** The strong entity tag the silhouette API issues and requires back on every mutation. */
export function silhouetteETag(userId: string, revision: number): string {
  return `"silhouette:${userId}:${revision}"`
}

export async function getOnboardingStateFromWeb(
  signal?: AbortSignal
): Promise<WardrobeOnboardingStateContract> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1WardrobeOnboardingGet({ signal })
    return wardrobeOnboardingStateResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load your onboarding progress.')
  }
}

/**
 * `ifMatch` is required and built by the caller from the previously read
 * state's revision (see `onboardingETag`), mirroring the capsule revision
 * discipline. The server treats a replay of the same target step as a safe
 * no-op, so this is also the correct call to make on retry.
 */
export async function advanceOnboardingStepFromWeb(
  input: UpdateWardrobeOnboardingStateInput,
  ifMatch: string,
  signal?: AbortSignal
): Promise<WardrobeOnboardingStateContract> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1WardrobeOnboardingPatch(
      { ifMatch, updateWardrobeOnboardingStateInput: input },
      { signal }
    )
    return wardrobeOnboardingStateResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to save this step.')
  }
}

export async function getSilhouetteProfileFromWeb(
  signal?: AbortSignal
): Promise<SilhouetteProfileContract> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1WardrobeSilhouetteGet({ signal })
    return silhouetteProfileResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to load your silhouette profile.')
  }
}

export async function updateSilhouetteSlidersFromWeb(
  input: UpdateSilhouetteSlidersInput,
  ifMatch: string,
  signal?: AbortSignal
): Promise<SilhouetteProfileContract> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1WardrobeSilhouettePut(
      { ifMatch, updateSilhouetteSlidersInput: input },
      { signal }
    )
    return silhouetteProfileResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to save silhouette sliders.')
  }
}

/**
 * With `uploadSession` (the account the shown profile was read under), the bearer is resolved
 * for that account and the call refuses with `UploadSessionChangedError` once another account is
 * signed in, so one account's photo is never removed with the next account's revision or token.
 */
export async function deleteMyFormPhotoFromWeb(
  ifMatch: string,
  signal?: AbortSignal,
  uploadSession?: UploadAttemptSession
): Promise<SilhouetteProfileContract> {
  const accessToken = uploadSession
    ? await resolveUploadBearer(uploadSession, readAccessToken)
    : readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1WardrobeSilhouetteMyFormDelete({ ifMatch }, { signal })
    return silhouetteProfileResponseSchema.parse(response).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to remove My Form photo.')
  }
}

export interface UploadMyFormPhotoInput {
  imagePreview: string
  /**
   * The literal `true` the server's commit contract requires. Required here
   * (not defaulted) so the safety confirmation decision 8 of the story
   * describes is actually plumbed through from whatever UI checkbox state
   * gated this call, rather than this exported wrapper silently asserting
   * confirmation on every caller's behalf.
   */
  confirmsBasewearGuidance: true
  /**
   * The session captured when the member opened the file picker that produced `imagePreview`
   * (`currentUploadSession`); the confirmation above belongs to it as well. The upload resolves
   * its bearer for that account and refuses once the signed-in account changed.
   */
  uploadSession: UploadAttemptSession
  signal?: AbortSignal
  onStateChange?: (state: GarmentUploadState) => void
  onProgress?: (percentage: number) => void
}

/** True when `error` is the server's revision/If-Match precondition failure. */
export function isStaleRevisionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('ONBOARDING_REVISION_MISMATCH') ||
      error.message.includes('SILHOUETTE_REVISION_MISMATCH'))
  )
}

/**
 * `crypto.randomUUID()` requires a secure context and a reasonably modern
 * browser; guard it so an unsupported environment surfaces the same
 * actionable-error path as any other failure instead of a raw `TypeError`.
 */
export function generateIdempotencyKey(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error(
      'Unable to start this upload in this browser. Try a different browser.'
    )
  }
  return crypto.randomUUID()
}

/**
 * "My Form" photos are portrait-framed full-body shots, not garment crops, so
 * this always prepares a `4:3` (portrait) image with background cleanup
 * disabled; the server's contrast/moderation heuristics need the original
 * background, not a matted one.
 */
export async function uploadMyFormPhotoFromWeb({
  imagePreview,
  confirmsBasewearGuidance,
  signal,
  onStateChange,
  onProgress,
  uploadSession,
}: UploadMyFormPhotoInput): Promise<SilhouetteProfileContract> {
  const accessToken = await resolveUploadBearer(uploadSession, readAccessToken)
  onStateChange?.('preparing')
  onProgress?.(10)
  const image = await prepareGarmentImage(imagePreview, '4:3', false, 'compact')

  const api = createWebApiClient({ accessToken })
  // The prepared bytes name the attempt, so Retry (or picking the same photo again) resumes it
  // with its keys while its outcome is ambiguous: commit first, re-send the bytes only when the
  // server reports them missing. Once the server ends the attempt (expired, rejected), it is
  // forgotten and the next Retry starts over with fresh keys.
  const attemptId = preparedImageFingerprint({
    sha256: image.sha256,
    fileSizeBytes: image.blob.size,
    mimeType: image.mimeType,
    widthPx: image.widthPx,
    heightPx: image.heightPx,
  })
  const profile = await runTrackedUpload(myFormUploadAttempts, uploadSession, attemptId, {
    allocate: async (allocateKey) => {
      onStateChange?.('requesting_upload')
      onProgress?.(25)
      try {
        return createSilhouetteUploadUrlResponseSchema.parse(
          await api.apiV1WardrobeSilhouetteMyFormUploadUrlPost(
            {
              idempotencyKey: allocateKey,
              createSilhouetteUploadUrlInput: {
                fileSizeBytes: image.blob.size,
                mimeType: image.mimeType,
                sha256: image.sha256,
                widthPx: image.widthPx,
                heightPx: image.heightPx,
              },
            },
            { signal }
          )
        ).data
      } catch (error) {
        return throwUploadStepError(error, (raw) =>
          actionableWardrobeError(raw, 'Unable to allocate My Form upload.')
        )
      }
    },
    upload: async (allocation) => {
      onStateChange?.('uploading')
      onProgress?.(35)
      try {
        await uploadGarmentBytes({
          cacheControl: WARDROBE_UPLOAD_CACHE_CONTROL,
          // Commit verifies the stored bytes' sha256, so an object a lost answer left is safe.
          acceptExistingObject: true,
          uploadUrl: allocation.uploadUrl,
          apiBaseUrl: resolveWebApiBaseUrl(),
          uploadToken: allocation.uploadToken,
          bearerToken: accessToken,
          mimeType: image.mimeType,
          body: image.blob,
          signal,
          timeoutMs: 30_000,
          onProgress: () => onProgress?.(80),
        })
      } catch (error) {
        throw await actionableWardrobeError(
          error,
          'Unable to upload the photo. Try again.'
        )
      }
    },
    commit: async (allocation, commitKey) => {
      onStateChange?.('verifying')
      onProgress?.(90)
      try {
        return silhouetteProfileResponseSchema.parse(
          await api.apiV1WardrobeSilhouetteMyFormCommitPost(
            {
              idempotencyKey: commitKey,
              commitSilhouettePhotoInput: {
                uploadSessionId: allocation.uploadSessionId,
                confirmsBasewearGuidance,
              },
            },
            { signal }
          )
        ).data
      } catch (error) {
        return throwUploadStepError(error, (raw) =>
          actionableWardrobeError(raw, 'Unable to commit My Form upload.')
        )
      }
    },
  })
  onStateChange?.('processing')
  onProgress?.(100)
  return profile
}

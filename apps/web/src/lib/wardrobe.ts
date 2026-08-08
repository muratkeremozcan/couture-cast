'use client'

import {
  uploadGarmentBytes,
  garmentListResponseSchema,
  suggestGarmentTagsResponseSchema,
  updateGarmentTagsResponseSchema,
  outfitCapsuleResponseSchema,
  outfitCapsuleListResponseSchema,
  type GarmentCategory,
  type GarmentMaterial,
  type GarmentComfortRange,
  type GarmentItemContract,
  type SuggestGarmentTagsData,
  type OutfitCapsuleContract,
  type CreateOutfitCapsuleInput,
  type UpdateOutfitCapsuleInput,
  type ListOutfitCapsulesQuery,
} from '@couture/api-client/contracts/http'
import { ResponseError } from '@couture/api-client'
import { createWebApiClient } from './api-client'

export const WEB_ACCESS_TOKEN_STORAGE_KEY = 'couturecast.access-token'

export type GarmentUploadState =
  | 'preparing'
  | 'requesting_upload'
  | 'uploading'
  | 'verifying'
  | 'processing'

export interface UploadGarmentImageInput {
  imagePreview: string
  aspectRatio: '1:1' | '4:3'
  useBgCleanup: boolean
  signal?: AbortSignal
  onStateChange?: (state: GarmentUploadState) => void
  onProgress?: (percentage: number) => void
}

type PreparedImage = {
  blob: Blob
  heightPx: number
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  sha256: string
  widthPx: number
}

export class WardrobeRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message)
    this.name = 'WardrobeRequestError'
  }
}

function readAccessToken(): string {
  const token = window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim()
  if (!token) {
    throw new Error('Your session expired. Sign in again before adding a garment.')
  }
  return token
}

/**
 * Resolves the signed-in user's id from the bearer token's `sub` claim.
 *
 * Capsule routes take an explicit owner path segment so guardians and admins can
 * act for another user. The signed-in user is the default owner, and it must
 * come from the session rather than a hardcoded value.
 */
export function resolveCurrentUserId(): string {
  const token = readAccessToken()
  const payloadSegment = token.split('.')[1]
  if (!payloadSegment) {
    throw new Error('Your session token is malformed. Sign in again.')
  }

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const claims = JSON.parse(window.atob(padded)) as { sub?: unknown }
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new Error('missing sub claim')
    }
    return claims.sub
  } catch {
    throw new Error('Your session token is malformed. Sign in again.')
  }
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The selected image could not be decoded.'))
    image.src = source
  })
}

function toBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
          return
        }
        reject(new Error('The selected image could not be prepared.'))
      },
      mimeType,
      0.92
    )
  })
}

function removeCornerMatchedBackground(context: CanvasRenderingContext2D): void {
  const { width, height } = context.canvas
  const pixels = context.getImageData(0, 0, width, height)
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + width - 1) * 4,
  ]
  const background = corners.reduce(
    (color, offset) => {
      color.red += pixels.data[offset] ?? 0
      color.green += pixels.data[offset + 1] ?? 0
      color.blue += pixels.data[offset + 2] ?? 0
      return color
    },
    { red: 0, green: 0, blue: 0 }
  )
  background.red /= corners.length
  background.green /= corners.length
  background.blue /= corners.length

  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const red = (pixels.data[offset] ?? 0) - background.red
    const green = (pixels.data[offset + 1] ?? 0) - background.green
    const blue = (pixels.data[offset + 2] ?? 0) - background.blue
    const distance = Math.sqrt(red * red + green * green + blue * blue)
    if (distance <= 28) {
      pixels.data[offset + 3] = 0
    } else if (distance < 72) {
      pixels.data[offset + 3] = Math.round(((distance - 28) / 44) * 255)
    }
  }
  context.putImageData(pixels, 0, 0)
}

async function prepareGarmentImage(
  imagePreview: string,
  aspectRatio: '1:1' | '4:3',
  useBgCleanup: boolean
): Promise<PreparedImage> {
  const [image, sourceBlob] = await Promise.all([
    loadImage(imagePreview),
    fetch(imagePreview).then((response) => response.blob()),
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
    throw new Error('Choose an image at least 256 pixels wide and tall.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = outputHeight
  const context = canvas.getContext('2d', { willReadFrequently: useBgCleanup })
  if (!context) {
    throw new Error('Image preparation is unavailable in this browser.')
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
  if (useBgCleanup) {
    removeCornerMatchedBackground(context)
  }

  const requestedMimeType = useBgCleanup ? 'image/png' : sourceBlob.type
  const blob = await toBlob(canvas, requestedMimeType)
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) {
    throw new Error('The prepared image format is unsupported.')
  }
  if (blob.size > 10 * 1024 * 1024) {
    throw new Error('The prepared image exceeds the 10 MiB limit.')
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
    ].includes(message)
      ? message
      : undefined
    return new WardrobeRequestError(
      message,
      (typeof payload.error === 'object' ? payload.error.code : undefined) ??
        payload.code ??
        knownCode
    )
  } catch {
    return new Error(`Wardrobe request failed with status ${response.status}`)
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
    if (timedOut) throw new Error('Wardrobe request timed out. Please try again.')
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
  signal,
  onStateChange,
  onProgress,
}: UploadGarmentImageInput): Promise<GarmentItemContract> {
  const accessToken = readAccessToken()
  onStateChange?.('preparing')
  onProgress?.(10)
  const image = await prepareGarmentImage(imagePreview, aspectRatio, useBgCleanup)

  onStateChange?.('requesting_upload')
  onProgress?.(25)
  const api = createWebApiClient({ accessToken })
  let allocation
  try {
    allocation = (
      await api.apiV1WardrobeUploadUrlPost(
        {
          idempotencyKey: crypto.randomUUID(),
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
    throw await actionableWardrobeError(error, 'Unable to allocate garment upload.')
  }

  onStateChange?.('uploading')
  onProgress?.(35)
  await uploadGarmentBytes({
    uploadUrl: allocation.uploadUrl,
    uploadToken: allocation.uploadToken,
    bearerToken: accessToken,
    mimeType: image.mimeType,
    body: image.blob,
    signal,
    timeoutMs: 30_000,
    onProgress: () => onProgress?.(80),
  })

  onStateChange?.('verifying')
  onProgress?.(90)
  let garment
  try {
    garment = (
      await api.apiV1WardrobeGarmentsPost(
        {
          idempotencyKey: crypto.randomUUID(),
          createGarmentItemInput: {
            garmentId: allocation.garmentId,
            uploadSessionId: allocation.uploadSessionId,
            hasCropping: true,
            hasBgCleanup: useBgCleanup,
          },
        },
        { signal }
      )
    ).data
  } catch (error) {
    throw await actionableWardrobeError(error, 'Unable to commit garment upload.')
  }
  onStateChange?.('processing')
  onProgress?.(100)
  return garment
}

export async function listGarmentsFromWeb(
  signal?: AbortSignal
): Promise<GarmentItemContract[]> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1WardrobeGarmentsGet({ signal })
    return garmentListResponseSchema.parse(response).data
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
): Promise<GarmentItemContract> {
  const accessToken = readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      createWebApiClient({ accessToken }).apiV1WardrobeGarmentsGarmentIdTagsPatch(
        { garmentId, updateGarmentTagsInput: tags },
        { signal: requestSignal }
      )
    )
    return updateGarmentTagsResponseSchema.parse(response).data
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

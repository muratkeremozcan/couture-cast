import { withRequestDeadline } from '@couture/api-client'
import {
  createGarmentItemResponseSchema,
  createGarmentUploadUrlResponseSchema,
  uploadGarmentBytes,
  WARDROBE_UPLOAD_CACHE_CONTROL,
  type UploadAttemptSession,
} from '@couture/api-client/contracts/http'
import { resolveMobileApiBaseUrl } from './api-client'
import { sha256Hex } from './expo-native-helpers'
import type { PreparedGarmentImage } from './garment-capture-image'
import { resolveMobileAccessToken } from './mobile-auth'
import {
  createUploadAttempts,
  preparedImageFingerprint,
  resolveUploadBearer,
  runTrackedUpload,
  throwUploadStepError,
} from './upload-attempts'

const garmentUploadAttempts = createUploadAttempts<{
  garmentId: string
  uploadSessionId: string
  uploadUrl: string
  uploadToken: string
}>()

const MAX_GARMENT_BYTES = 10 * 1024 * 1024
const GARMENT_REQUEST_DEADLINE_MS = 15_000

export class GarmentUploadError extends Error {
  constructor(readonly kind: 'image_too_large' | 'sign_in_required') {
    super(kind)
  }
}

type UploadPhase = 'preparing' | 'requesting' | 'uploading' | 'verifying'

type GarmentUploadOptions = {
  prepared: PreparedGarmentImage
  uploadSession: UploadAttemptSession
  signal: AbortSignal
  attemptId?: string
  onStateChange?: (state: UploadPhase) => void
}

async function readPreparedGarment({
  file,
  mimeType,
  width,
  height,
}: PreparedGarmentImage) {
  const bytes = await file.bytes()
  if (bytes.byteLength > MAX_GARMENT_BYTES) {
    throw new GarmentUploadError('image_too_large')
  }
  const declaration = {
    fileSizeBytes: bytes.byteLength,
    mimeType,
    widthPx: width,
    heightPx: height,
    sha256: await sha256Hex(bytes),
  }
  return { bytes, declaration }
}

export async function garmentImageFingerprint(
  image: PreparedGarmentImage
): Promise<string> {
  const { declaration } = await readPreparedGarment(image)
  return garmentFingerprint(declaration, image.backgroundRemoved)
}

function garmentFingerprint(
  declaration: Parameters<typeof preparedImageFingerprint>[0],
  backgroundRemoved: boolean
) {
  return `${preparedImageFingerprint(declaration)}:${backgroundRemoved ? 'cleanup' : 'original'}`
}

async function responseError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { message?: string }
    return new Error(body.message ?? `Wardrobe request failed with ${response.status}`)
  } catch {
    return new Error(`Wardrobe request failed with ${response.status}`)
  }
}

export async function uploadGarmentImageFromMobile({
  prepared,
  uploadSession,
  signal,
  attemptId,
  onStateChange,
}: GarmentUploadOptions) {
  onStateChange?.('preparing')
  const { bytes, declaration } = await readPreparedGarment(prepared)
  const accessToken = await resolveUploadBearer(uploadSession, resolveMobileAccessToken)
  if (!accessToken) throw new GarmentUploadError('sign_in_required')

  const assertActive = () => {
    if (signal.aborted) throw new Error('Upload cancelled')
  }
  const post = async (
    path: 'garments' | 'upload-url',
    body: object,
    idempotencyKey: string
  ) => {
    assertActive()
    return withRequestDeadline(
      GARMENT_REQUEST_DEADLINE_MS,
      [signal],
      async (requestSignal) => {
        const response = await fetch(
          `${resolveMobileApiBaseUrl()}/api/v1/wardrobe/${path}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(body),
            signal: requestSignal,
          }
        )
        if (!response.ok) return throwUploadStepError(response, responseError)
        return response.json() as Promise<unknown>
      }
    )
  }

  const fingerprint = garmentFingerprint(declaration, prepared.backgroundRemoved)
  const trackedId = attemptId ? `${attemptId}:${fingerprint}` : fingerprint
  assertActive()
  const garment = await runTrackedUpload(
    garmentUploadAttempts,
    uploadSession,
    trackedId,
    {
      allocate: async (idempotencyKey) => {
        onStateChange?.('requesting')
        return createGarmentUploadUrlResponseSchema.parse(
          await post('upload-url', declaration, idempotencyKey)
        ).data
      },
      upload: async (allocation) => {
        assertActive()
        onStateChange?.('uploading')
        await uploadGarmentBytes({
          cacheControl: WARDROBE_UPLOAD_CACHE_CONTROL,
          acceptExistingObject: true,
          uploadUrl: allocation.uploadUrl,
          uploadToken: allocation.uploadToken,
          bearerToken: accessToken,
          mimeType: prepared.mimeType,
          body: bytes.buffer,
          signal,
        })
      },
      commit: async (allocation, idempotencyKey) => {
        onStateChange?.('verifying')
        return createGarmentItemResponseSchema.parse(
          await post(
            'garments',
            {
              garmentId: allocation.garmentId,
              uploadSessionId: allocation.uploadSessionId,
              hasCropping: true,
              hasBgCleanup: prepared.backgroundRemoved,
            },
            idempotencyKey
          )
        ).data
      },
    }
  )
  assertActive()
  return { garment, accessToken }
}

// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import {
  isUploadInProgressCode,
  uploadAttemptEnding,
  UploadSessionChangedError,
} from '@couture/api-client/contracts/http'
import { uploadFailureOf } from './upload-attempts'
import { WardrobeRequestError } from './wardrobe'

/** The catalog keys of `wardrobe.capture.errors`, one per failure a member can act on. */
export type GarmentUploadErrorKey =
  | 'failed'
  | 'sessionChanged'
  | 'signedOut'
  | 'consentRequired'
  | 'uploadRestricted'
  | 'sessionExpired'
  | 'inProgress'
  | 'imageRejected'
  | 'imageUnreadable'
  | 'imageTooSmall'
  | 'preparationUnavailable'
  | 'imageTooLarge'
  | 'timeout'
  | 'serviceUnavailable'

/** Codes this module puts on the client-side failures of a garment upload. */
const CLIENT_UPLOAD_ERROR_KEYS: Record<string, GarmentUploadErrorKey> = {
  SIGNED_OUT: 'signedOut',
  IMAGE_UNREADABLE: 'imageUnreadable',
  IMAGE_TOO_SMALL: 'imageTooSmall',
  IMAGE_PREPARATION_UNAVAILABLE: 'preparationUnavailable',
  IMAGE_TOO_LARGE: 'imageTooLarge',
  REQUEST_TIMEOUT: 'timeout',
}

/** An error's own code: a `WardrobeRequestError` code, or a message that is itself a code. */
function errorCodeOf(error: unknown): string | null {
  if (error instanceof WardrobeRequestError && error.code) return error.code
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message))
    return error.message
  return null
}

/**
 * The `wardrobe.capture.errors` key for a failed garment upload. The member never sees raw error
 * text: client-side failures carry this module's codes, API failures the status and code
 * `throwUploadStepError` recorded (or the code the error names itself), and anything else (a
 * network fault, a storage PUT refused) reads as the generic retry copy.
 */
export function garmentUploadErrorKey(error: unknown): GarmentUploadErrorKey {
  if (error instanceof UploadSessionChangedError) return 'sessionChanged'
  const failure = uploadFailureOf(error)
  const code = failure?.code ?? errorCodeOf(error)
  const status = failure?.status ?? null
  return keyForCode(code) ?? keyForAnswer(status, code) ?? 'failed'
}

/**
 * Codes that name their failure whatever the status (or with no API answer at all). Only the
 * guardian participation check's explicit `GUARDIAN_CONSENT_REQUIRED` asks for a guardian;
 * `WARDROBE_UPLOAD_FORBIDDEN` means the garment itself can no longer take an upload (a legal
 * hold, a pending deletion), which no guardian can change, so it reads as a neutral restriction.
 */
const CODE_KEYS: Record<string, GarmentUploadErrorKey> = {
  ...CLIENT_UPLOAD_ERROR_KEYS,
  GUARDIAN_CONSENT_REQUIRED: 'consentRequired',
  WARDROBE_UPLOAD_FORBIDDEN: 'uploadRestricted',
  UNSUPPORTED_IMAGE_TYPE: 'imageRejected',
  INVALID_UPLOAD_DECLARATION: 'imageRejected',
  STORAGE_UNAVAILABLE: 'serviceUnavailable',
  STORAGE_PERMISSION_DENIED: 'serviceUnavailable',
}

function keyForCode(code: string | null): GarmentUploadErrorKey | null {
  if (!code) return null
  if (isUploadInProgressCode(code)) return 'inProgress'
  return CODE_KEYS[code] ?? null
}

/** The key an API answer's status and code give, once no code named the failure itself. */
function keyForAnswer(
  status: number | null,
  code: string | null
): GarmentUploadErrorKey | null {
  if (status === 401) return 'signedOut'
  // A 403 that names no consent denial is a restriction the member cannot fix through a guardian.
  if (status === 403) return 'uploadRestricted'
  const ending = uploadAttemptEnding(status, code)
  if (ending === 'session') return 'sessionExpired'
  if (ending === 'rejected' || code?.startsWith('IMAGE_')) return 'imageRejected'
  if (status !== null && status >= 500) return 'serviceUnavailable'
  return null
}

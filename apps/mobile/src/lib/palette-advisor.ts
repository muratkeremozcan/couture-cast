// Story 5.4 Task 8 owner: the mobile app's colour palette & beauty/accessory advisor
// client.
//
// The mobile counterpart of `apps/web/src/lib/palette-advisor.ts`, and deliberately the
// same shape: the same six-member failure taxonomy, the same `.strict()` envelope
// parsing at the trust boundary, the same "the reason travels and the words do not"
// rule. What differs is only what always differs between the two surfaces — the bearer
// token comes from `resolveMobileAccessToken` rather than `sessionStorage`, and every
// request goes through `withRequestTimeout`, the 15-second helper `commerce.ts` exports
// and every mobile network call in this app already uses.
import {
  commitPaletteSelfieResponseSchema,
  createPaletteSelfieUploadUrlResponseSchema,
  deletePaletteAdvisorResponseSchema,
  paletteAdvisorProfileResponseSchema,
  setPaletteConsentResponseSchema,
  updateAdvisorRecommendationResponseSchema,
  uploadGarmentBytes,
  PALETTE_ANALYSIS_DISABLED_MESSAGE,
  PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE,
  PALETTE_CONSENT_REQUIRED_MESSAGE,
  type PaletteAdvisorProfile,
  type UpdateAdvisorRecommendationInput,
} from '@couture/api-client/contracts/http'
import { ResponseError } from '@couture/api-client'
import { createMobileApiClient } from './api-client'
import { withRequestTimeout } from './commerce'
import { resolveMobileAccessToken } from './mobile-auth'

/**
 * Why a call failed, in terms the screen can act on without reading English prose.
 *
 * The two 403 members are the reason this union is six-wide rather than four.
 * `PremiumEntitlementGuard` and the service's consent check both answer 403 and mean
 * completely different things to a reader: one is "subscribe", the other is "grant the
 * consent the screen is already showing you". The status code alone cannot separate
 * them, so `reasonForResponse` reads the server's own message constants — imported from
 * the contract, never retyped — to tell them apart.
 */
export type PaletteAdvisorFailureReason =
  | 'signed_out'
  | 'not_entitled'
  | 'no_consent'
  | 'analysis_disabled'
  | 'in_progress'
  | 'unknown'

/**
 * Thrown for every failure these wrappers surface, so a caller can tell an API failure
 * apart from a programming error without matching on message text.
 */
export class PaletteAdvisorRequestError extends Error {
  readonly reason: PaletteAdvisorFailureReason

  constructor(reason: PaletteAdvisorFailureReason, message: string) {
    super(message)
    this.name = 'PaletteAdvisorRequestError'
    this.reason = reason
  }
}

/**
 * Fallback for a call made with no session. Developer-facing, with no catalog entry:
 * the screen reads the `signed_out` reason and renders its own translated locked copy.
 */
export const PALETTE_ADVISOR_SIGNED_OUT_MESSAGE =
  'Sign in to use the colour palette advisor.'

async function readAccessToken(): Promise<string> {
  const token = (await resolveMobileAccessToken())?.trim()
  if (!token) {
    throw new PaletteAdvisorRequestError('signed_out', PALETTE_ADVISOR_SIGNED_OUT_MESSAGE)
  }
  return token
}

function advisorClient(accessToken: string) {
  return createMobileApiClient({ accessToken })
}

async function readServerMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json()
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message?: unknown }).message
        : undefined
    return typeof message === 'string' && message.trim().length > 0 ? message : fallback
  } catch {
    return fallback
  }
}

/**
 * Status plus server message, mapped onto a reason.
 *
 * An unrecognised 403 falls back to `not_entitled`, the conservative answer: it renders
 * the locked panel rather than inviting a consent grant that would be rejected again.
 */
function reasonForResponse(status: number, message: string): PaletteAdvisorFailureReason {
  if (status === 401) return 'signed_out'
  if (status === 403) {
    return message.includes(PALETTE_CONSENT_REQUIRED_MESSAGE)
      ? 'no_consent'
      : 'not_entitled'
  }
  if (status === 409) {
    return message.includes(PALETTE_ANALYSIS_IN_PROGRESS_MESSAGE)
      ? 'in_progress'
      : 'unknown'
  }
  if (status === 503) {
    return message.includes(PALETTE_ANALYSIS_DISABLED_MESSAGE)
      ? 'analysis_disabled'
      : 'unknown'
  }
  return 'unknown'
}

async function advisorError(
  error: unknown,
  fallback: string
): Promise<PaletteAdvisorRequestError> {
  if (error instanceof PaletteAdvisorRequestError) {
    return error
  }
  if (error instanceof ResponseError) {
    const message = await readServerMessage(error.response, fallback)
    return new PaletteAdvisorRequestError(
      reasonForResponse(error.response.status, message),
      message
    )
  }
  // Anything else is a transport failure, a timeout, an abort, or a contract-parse
  // failure. The message those carry is the useful one for a log; the reason stays
  // `unknown` so the screen falls back to its own translated copy.
  return new PaletteAdvisorRequestError(
    'unknown',
    error instanceof Error ? error.message : fallback
  )
}

/**
 * The reason behind a rejection from this module, for UI code that has to choose a
 * translated string or a state transition.
 */
export function paletteAdvisorFailureReason(error: unknown): PaletteAdvisorFailureReason {
  return error instanceof PaletteAdvisorRequestError ? error.reason : 'unknown'
}

export async function getPaletteAdvisorFromMobile(
  signal?: AbortSignal
): Promise<PaletteAdvisorProfile> {
  const accessToken = await readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      advisorClient(accessToken).apiV1CommercePremiumPaletteGet({
        signal: requestSignal,
      })
    )
    return paletteAdvisorProfileResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to load your colour palette.')
  }
}

/**
 * Grants or revokes palette-analysis consent.
 *
 * `granted: false` is not a flag flip: the server runs the same erase path as `DELETE`
 * (Decision 5/9), which is why this returns the freshly resolved profile.
 */
export async function setPaletteConsentFromMobile(
  granted: boolean,
  signal?: AbortSignal
): Promise<PaletteAdvisorProfile> {
  const accessToken = await readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      advisorClient(accessToken).apiV1CommercePremiumPaletteConsentPost(
        { setPaletteConsentInput: { granted } },
        { signal: requestSignal }
      )
    )
    return setPaletteConsentResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to update palette analysis consent.')
  }
}

export async function analyzeWardrobePaletteFromMobile(
  signal?: AbortSignal
): Promise<PaletteAdvisorProfile> {
  const accessToken = await readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      advisorClient(accessToken).apiV1CommercePremiumPaletteAnalyzePost(
        { analyzePaletteInput: { source: 'wardrobe' } },
        { signal: requestSignal }
      )
    )
    return paletteAdvisorProfileResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to analyze your wardrobe palette.')
  }
}

export async function updateAdvisorRecommendationFromMobile(
  input: UpdateAdvisorRecommendationInput,
  signal?: AbortSignal
): Promise<PaletteAdvisorProfile> {
  const accessToken = await readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      advisorClient(accessToken).apiV1CommercePremiumPaletteRecommendationsPut(
        { updateAdvisorRecommendationInput: input },
        { signal: requestSignal }
      )
    )
    return updateAdvisorRecommendationResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to save this recommendation.')
  }
}

/**
 * Erases the derived palette, revokes consent, drops every saved/dismissed row and
 * purges any retained selfie object. Reachable without entitlement by design.
 */
export async function erasePaletteAdvisorFromMobile(
  signal?: AbortSignal
): Promise<PaletteAdvisorProfile> {
  const accessToken = await readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      advisorClient(accessToken).apiV1CommercePremiumPaletteDelete({
        signal: requestSignal,
      })
    )
    return deletePaletteAdvisorResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to erase your colour palette.')
  }
}

/**
 * A whole image is on the wire here, not a JSON body, so the 15-second
 * `withRequestTimeout` default that governs every other call in this module would abort
 * a legitimate upload on a slow connection. 30 seconds is the same budget the web
 * surface gives the identical request.
 */
const SELFIE_UPLOAD_TIMEOUT_MS = 30_000

/** Coarse progress states for the three-step selfie upload, for the screen's status line. */
export type PaletteSelfieUploadState = 'requesting_upload' | 'uploading' | 'committing'

export interface UploadPaletteSelfieInput {
  /** The prepared, re-encoded bytes. The caller owns picking and re-encoding. */
  bytes: Uint8Array<ArrayBuffer>
  /** Must match what `bytes` actually is: the server re-decodes and rejects a mismatch. */
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  widthPx: number
  heightPx: number
  /** Lowercase hex SHA-256 of `bytes`, which the server re-computes and compares. */
  sha256: string
  /**
   * Reused across the allocate and commit requests of one upload attempt, and across
   * any retry of that attempt, so a retry replays the first session rather than
   * allocating a second.
   */
  idempotencyKey: string
  signal?: AbortSignal
  onStateChange?: (state: PaletteSelfieUploadState) => void
}

/**
 * Uploads one selfie through allocate -> PUT bytes -> commit, and returns the profile
 * with the analysis moved to `processing`.
 *
 * The bytes go through `uploadGarmentBytes`, the shared raw-byte uploader every other
 * mobile image upload in this app already uses. It is not garment-specific: it takes an
 * absolute upload URL, the upload token and a bearer, which is exactly this route's
 * contract.
 *
 * Nothing here retains the image. The server purges the object the moment the analysis
 * terminates (Decision 8), and the local file belongs to the picker's cache.
 */
export async function uploadPaletteSelfieFromMobile({
  bytes,
  mimeType,
  widthPx,
  heightPx,
  sha256,
  idempotencyKey,
  signal,
  onStateChange,
}: UploadPaletteSelfieInput): Promise<PaletteAdvisorProfile> {
  const accessToken = await readAccessToken()
  const client = advisorClient(accessToken)

  onStateChange?.('requesting_upload')
  let allocation
  try {
    allocation = createPaletteSelfieUploadUrlResponseSchema.parse(
      await withRequestTimeout(signal, (requestSignal) =>
        client.apiV1CommercePremiumPaletteSelfieUploadUrlPost(
          {
            idempotencyKey,
            createPaletteSelfieUploadUrlInput: {
              fileSizeBytes: bytes.byteLength,
              mimeType,
              sha256,
              widthPx,
              heightPx,
            },
          },
          { signal: requestSignal }
        )
      )
    ).data
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to allocate a selfie upload.')
  }

  onStateChange?.('uploading')
  try {
    await uploadGarmentBytes({
      uploadUrl: allocation.uploadUrl,
      uploadToken: allocation.uploadToken,
      bearerToken: accessToken,
      mimeType,
      body: bytes.buffer,
      signal,
      timeoutMs: SELFIE_UPLOAD_TIMEOUT_MS,
    })
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to upload the photo. Try again.')
  }

  onStateChange?.('committing')
  try {
    return commitPaletteSelfieResponseSchema.parse(
      await withRequestTimeout(signal, (requestSignal) =>
        client.apiV1CommercePremiumPaletteSelfieCommitPost(
          {
            idempotencyKey,
            commitPaletteSelfieInput: { uploadSessionId: allocation.uploadSessionId },
          },
          { signal: requestSignal }
        )
      )
    ).data
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to start the palette analysis.')
  }
}

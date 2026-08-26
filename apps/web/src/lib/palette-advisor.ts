// Story 5.4 Task 7 owner: the web app's colour palette & beauty/accessory
// advisor client.
//
// Mirrors `premium-theme.ts` deliberately: the same `sessionStorage` bearer
// token, the same `.strict()`-envelope message reading, Zod-parsed responses at
// the trust boundary, and — the part that matters most here — a classified
// failure reason rather than a server-supplied English string. Every message
// this module can surface (`PALETTE_CONSENT_REQUIRED_MESSAGE`,
// `PALETTE_ANALYSIS_DISABLED_MESSAGE`, `PREMIUM_REQUIRED_MESSAGE`, a transport
// error's text) is untranslated English, and rendering any of them would show a
// `tr-TR` or `de-DE` reader English on exactly the paths the ten catalogs
// already carry translated copy for. So the reason travels and the words do
// not: `palette-advisor-panel.tsx` maps each member onto a
// `commerce.premium.palette.*` key or onto a state change.
//
// No timeout wrapper, following `premium-theme.ts` (Decision 14): the web app
// has no shared `withRequestTimeout`, and copying `wardrobe.ts`'s private one
// here would make it the third copy. Callers pass an `AbortSignal` instead.
'use client'

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
import { createWebApiClient } from './api-client'
import {
  generateIdempotencyKey,
  prepareGarmentImage,
  WEB_ACCESS_TOKEN_STORAGE_KEY,
} from './wardrobe'

// One sessionStorage truth for "is there a web session": the commerce, premium
// and premium-theme helpers all read the same key, and a fourth copy of the
// check would let them drift.
export { hasWebSession } from './commerce'

/**
 * Why a call failed, in terms the panel can act on without reading English
 * prose.
 *
 * The two 403 members are the reason this union is six-wide rather than four.
 * `PremiumEntitlementGuard` and the service's consent check both answer 403,
 * and they mean completely different things to a reader: one is "subscribe",
 * the other is "tick the consent box you already have in front of you". The
 * status code alone cannot separate them, so `reasonForResponse` reads the
 * server's own message constants — imported from the contract, never retyped —
 * to tell them apart.
 */
export type PaletteAdvisorFailureReason =
  | 'signed_out'
  | 'not_entitled'
  | 'no_consent'
  | 'analysis_disabled'
  | 'in_progress'
  | 'unknown'

/**
 * Thrown for every failure these wrappers surface, so a caller can tell an API
 * failure apart from a programming error without matching on message text.
 *
 * `message` is developer-facing throughout: it carries the server's own text
 * when there is one so a log line or a test failure names the real cause. UI
 * code reads {@link PaletteAdvisorRequestError.reason} instead.
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
 * Fallback for a call made with no session. The panel checks `hasWebSession()`
 * first and renders the locked panel instead, so this string is a guard against
 * a caller that skipped that check rather than user-facing copy — which is why
 * it has no catalog entry and why the panel reads the `signed_out` reason
 * rather than this text.
 */
export const PALETTE_ADVISOR_SIGNED_OUT_MESSAGE =
  'Sign in to use the colour palette advisor.'

function readAccessToken(): string {
  const token =
    typeof window === 'undefined'
      ? null
      : (window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? null)
  if (!token) {
    throw new PaletteAdvisorRequestError('signed_out', PALETTE_ADVISOR_SIGNED_OUT_MESSAGE)
  }
  return token
}

/**
 * The shared error envelope is `.strict()` over `{ statusCode, message, error }`
 * with no `code` field, so the message is the whole of what the server tells us.
 */
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
 * 401 and 403 are separated deliberately, and the two 403 shapes are separated
 * from each other. The guard order (Decision 10) makes this deterministic: a
 * non-entitled caller is rejected pre-handler by `PremiumEntitlementGuard` with
 * `PREMIUM_REQUIRED_MESSAGE`, so a 403 carrying
 * `PALETTE_CONSENT_REQUIRED_MESSAGE` is always "entitled, has not consented".
 * An unrecognised 403 falls back to `not_entitled`, the conservative answer:
 * it renders the locked panel rather than inviting a consent grant that would
 * be rejected again.
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
  // `readAccessToken` already threw a classified error; re-wrapping it would
  // lose the `signed_out` reason and re-open the untranslated-message path.
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
  // Anything else is a transport failure, an abort, or a contract-parse
  // failure. The message those carry is the useful one for a log; the reason
  // stays `unknown` so the panel falls back to its own translated copy.
  return new PaletteAdvisorRequestError(
    'unknown',
    error instanceof Error ? error.message : fallback
  )
}

/**
 * The reason behind a rejection from this module, for UI code that has to
 * choose a translated string or a state transition.
 *
 * Anything that is not one of this module's own errors reads as `unknown`,
 * which is the conservative answer: the caller shows its generic translated
 * message rather than guessing at entitlement, consent or flag state from a
 * failure it cannot classify.
 */
export function paletteAdvisorFailureReason(error: unknown): PaletteAdvisorFailureReason {
  return error instanceof PaletteAdvisorRequestError ? error.reason : 'unknown'
}

/**
 * Reads entitlement, the kill switch, consent, the current analysis and the
 * resolved recommendations in one round trip, so the panel never has to combine
 * two endpoints and never has two moments in time to disagree about.
 */
export async function getPaletteAdvisorFromWeb(
  signal?: AbortSignal
): Promise<PaletteAdvisorProfile> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommercePremiumPaletteGet({ signal })
    return paletteAdvisorProfileResponseSchema.parse(response).data
  } catch (error: unknown) {
    // Developer-facing. The panel renders `commerce.premium.palette.loadError`.
    throw await advisorError(error, 'Unable to load your colour palette.')
  }
}

/**
 * Grants or revokes palette-analysis consent.
 *
 * `granted: false` is not a flag flip: the server runs the same erase path as
 * `DELETE` (Decision 5/9), which is why this returns the freshly resolved
 * profile rather than a boolean. Callers replace their whole view from it.
 */
export async function setPaletteConsentFromWeb(
  granted: boolean,
  signal?: AbortSignal
): Promise<PaletteAdvisorProfile> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommercePremiumPaletteConsentPost(
      { setPaletteConsentInput: { granted } },
      { signal }
    )
    return setPaletteConsentResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to update palette analysis consent.')
  }
}

/**
 * Starts a wardrobe-sourced derivation. No image is uploaded: the server reads
 * the `PaletteInsights` rows story 4.2's colour processor already wrote.
 */
export async function analyzeWardrobePaletteFromWeb(
  signal?: AbortSignal
): Promise<PaletteAdvisorProfile> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommercePremiumPaletteAnalyzePost(
      { analyzePaletteInput: { source: 'wardrobe' } },
      { signal }
    )
    return paletteAdvisorProfileResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to analyze your wardrobe palette.')
  }
}

/**
 * Saves, dismisses, or clears one recommendation. `action: null` clears the row
 * so "never acted" and "un-saved" stay the same state, which is what makes the
 * panel's undo control a real reversal rather than a third stored value.
 */
export async function updateAdvisorRecommendationFromWeb(
  input: UpdateAdvisorRecommendationInput,
  signal?: AbortSignal
): Promise<PaletteAdvisorProfile> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommercePremiumPaletteRecommendationsPut(
      { updateAdvisorRecommendationInput: input },
      { signal }
    )
    return updateAdvisorRecommendationResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to save this recommendation.')
  }
}

/**
 * Erases the derived palette, revokes consent, drops every saved/dismissed row
 * and purges any retained selfie object.
 *
 * Deliberately reachable without entitlement: the route mounts no
 * `PremiumEntitlementGuard`, because a lapsed subscriber must always be able to
 * delete their data (Decision 9).
 */
export async function erasePaletteAdvisorFromWeb(
  signal?: AbortSignal
): Promise<PaletteAdvisorProfile> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommercePremiumPaletteDelete({ signal })
    return deletePaletteAdvisorResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to erase your colour palette.')
  }
}

/** Coarse progress states for the three-step selfie upload, for the panel's status line. */
export type PaletteSelfieUploadState =
  | 'preparing'
  | 'requesting_upload'
  | 'uploading'
  | 'committing'

export interface UploadPaletteSelfieInput {
  /** An object URL or data URL for the chosen image. */
  imagePreview: string
  /**
   * Reused across the allocate and commit requests of one upload attempt, and
   * across any retry of that attempt. Minting a fresh key per call is the bug
   * story 4.3's review found in `capsule-builder-modal.tsx`: a retry after a
   * timeout allocates a second upload session instead of replaying the first.
   */
  idempotencyKey: string
  signal?: AbortSignal
  onStateChange?: (state: PaletteSelfieUploadState) => void
}

/**
 * Uploads one selfie through allocate -> PUT bytes -> commit, and returns the
 * profile with the analysis moved to `processing`.
 *
 * The bytes are prepared with `prepareGarmentImage(preview, '4:3', false)`, the
 * same call `uploadMyFormPhotoFromWeb` makes: portrait framing, no background
 * matting (the server's skin-chroma gate needs the original pixels), long edge
 * capped at 2048px and a 256px floor that matches the contract's own bounds.
 *
 * Nothing here retains the image. The server purges the object the moment the
 * analysis terminates (Decision 8), and this function holds only an object URL
 * the caller owns.
 */
export async function uploadPaletteSelfieFromWeb({
  imagePreview,
  idempotencyKey,
  signal,
  onStateChange,
}: UploadPaletteSelfieInput): Promise<PaletteAdvisorProfile> {
  const accessToken = readAccessToken()
  const api = createWebApiClient({ accessToken })

  onStateChange?.('preparing')
  let image
  try {
    image = await prepareGarmentImage(imagePreview, '4:3', false)
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to prepare this photo.')
  }

  onStateChange?.('requesting_upload')
  let allocation
  try {
    allocation = createPaletteSelfieUploadUrlResponseSchema.parse(
      await api.apiV1CommercePremiumPaletteSelfieUploadUrlPost(
        {
          idempotencyKey,
          createPaletteSelfieUploadUrlInput: {
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
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to allocate a selfie upload.')
  }

  onStateChange?.('uploading')
  try {
    await uploadGarmentBytes({
      uploadUrl: allocation.uploadUrl,
      uploadToken: allocation.uploadToken,
      bearerToken: accessToken,
      mimeType: image.mimeType,
      body: image.blob,
      signal,
      timeoutMs: 30_000,
    })
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to upload the photo. Try again.')
  }

  onStateChange?.('committing')
  try {
    return commitPaletteSelfieResponseSchema.parse(
      await api.apiV1CommercePremiumPaletteSelfieCommitPost(
        {
          idempotencyKey,
          commitPaletteSelfieInput: { uploadSessionId: allocation.uploadSessionId },
        },
        { signal }
      )
    ).data
  } catch (error: unknown) {
    throw await advisorError(error, 'Unable to start the palette analysis.')
  }
}

export { generateIdempotencyKey }

// Story 6.1 Task 5 owner: the web app's community feed client.
//
// Mirrors `palette-advisor.ts` and `premium.ts` deliberately, and three things
// about that shape are load-bearing rather than stylistic:
//
// - **It goes through `createWebApiClient`.** Every other web feature does, and
//   that factory is the only place `credentials: 'include'` is set. The first
//   draft of the community grid built `new CommunityApi(new Configuration(...))`
//   inline, which dropped cookie auth on every community call and left a bearer
//   token out of `sessionStorage` as the sole credential.
// - **The reason travels and the words do not.** Every message this module can
//   produce is untranslated English -- the server's own
//   `COMMUNITY_AGE_GATE_DENIED_MESSAGE`, `COMMUNITY_POST_RATE_LIMITED_MESSAGE`,
//   `COMMUNITY_REPORT_REASON_CHANGED_MESSAGE` and friends, or a transport
//   error's text -- and rendering any of them would show a `tr-TR` or `de-DE`
//   reader English on exactly the paths the ten catalogs carry copy for. So
//   callers map a {@link CommunityFailureReason} onto a `community.error.*` key.
// - **A failed byte upload aborts the publish.** The draft wrapped the PUT in
//   `try { ... } catch { /* Simulated in tests */ }` and published anyway, so a
//   storage failure produced a post whose object was never written. Upload
//   failure now throws `upload_failed` and nothing is published.
'use client'

import {
  allocateCommunityPostResponseSchema,
  communityFeedResponseSchema,
  communityPostResponseSchema,
  publishCommunityPostResponseSchema,
  reportCommunityPostResponseSchema,
  uploadGarmentBytes,
  withdrawCommunityPostResponseSchema,
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  type CommunityFeed,
  type CommunityFeedItem,
  type CommunityFeedMode,
  type CommunityReportReason,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'
import { ResponseError } from '@couture/api-client'
import { createWebApiClient } from './api-client'
import {
  generateIdempotencyKey,
  prepareGarmentImage,
  WEB_ACCESS_TOKEN_STORAGE_KEY,
} from './wardrobe'

// One sessionStorage truth for "is there a web session": the commerce, premium,
// premium-theme and palette-advisor helpers all read the same key, and a fifth
// copy of the check would let them drift.
export { hasWebSession } from './commerce'
export { generateIdempotencyKey }

/**
 * Why a community call failed, in terms the grid can act on without reading
 * English prose.
 *
 * There is deliberately no `already_reported` member. A duplicate report of the
 * SAME reason answers 200 -- `community.repository.ts` replays the stored row,
 * and the P2002 race resolves the same way -- so the only 409 a reporter can
 * provoke is a changed reason, which is `reason_changed`. This union carried an
 * `already_reported` member until the constant behind it turned out to be
 * thrown by nothing; the branch read as defensive depth and was really a
 * classifier for a status the server never sends.
 */
export type CommunityFailureReason =
  | 'signed_out'
  | 'age_gate'
  | 'rate_limited'
  | 'not_found'
  | 'reason_changed'
  | 'self_report'
  | 'disabled'
  | 'upload_failed'
  | 'image_too_small'
  | 'unknown'

/**
 * Thrown for every failure these wrappers surface, so a caller can tell an API
 * failure apart from a programming error without matching on message text.
 *
 * `message` is developer-facing throughout: it carries the server's own text
 * when there is one so a log line or a failing assertion names the real cause.
 * UI code reads {@link CommunityRequestError.reason} instead, and
 * {@link CommunityRequestError.retryAfterSeconds} when the reason is
 * `rate_limited`.
 */
export class CommunityRequestError extends Error {
  readonly reason: CommunityFailureReason
  /** Seconds until the next post is allowed, from the 429 `Retry-After` header. */
  readonly retryAfterSeconds?: number

  constructor(
    reason: CommunityFailureReason,
    message: string,
    retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'CommunityRequestError'
    this.reason = reason
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * Fallback for a call made with no session. The grid checks `hasWebSession()`
 * before offering the compose and report affordances, so this string guards a
 * caller that skipped that check rather than being user-facing copy -- which is
 * why it has no catalog entry and why callers read the `signed_out` reason.
 */
export const COMMUNITY_SIGNED_OUT_MESSAGE = 'Sign in to take part in the community.'

function readAccessToken(): string {
  const token =
    typeof window === 'undefined'
      ? null
      : (window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? null)
  if (!token) {
    throw new CommunityRequestError('signed_out', COMMUNITY_SIGNED_OUT_MESSAGE)
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

/** `Retry-After` is delta-seconds on this API. A missing or unparsable value is dropped. */
function readRetryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('retry-after')
  if (!header) {
    return undefined
  }
  const seconds = Number.parseInt(header, 10)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

function reasonForResponse(status: number, message: string): CommunityFailureReason {
  if (status === 401) return 'signed_out'
  if (status === 403) {
    if (message.includes(COMMUNITY_AGE_GATE_DENIED_MESSAGE)) return 'age_gate'
    // `community.service.ts` throws the self-report refusal as a
    // `ForbiddenException`, not a conflict. Classifying it under 409 -- which is
    // where the first draft put it -- left `self_report` and its catalog string
    // unreachable, so reporting your own post read "We could not send your
    // report." instead of saying why it was refused.
    if (message.includes(COMMUNITY_SELF_REPORT_MESSAGE)) return 'self_report'
    return 'unknown'
  }
  if (status === 404) return 'not_found'
  if (status === 409) {
    if (message.includes(COMMUNITY_REPORT_REASON_CHANGED_MESSAGE)) return 'reason_changed'
    return 'unknown'
  }
  if (status === 429) return 'rate_limited'
  if (status === 503) {
    return message.includes(COMMUNITY_FEED_DISABLED_MESSAGE) ? 'disabled' : 'unknown'
  }
  return 'unknown'
}

async function communityError(
  error: unknown,
  fallback: string
): Promise<CommunityRequestError> {
  // `readAccessToken` and the upload step already threw classified errors;
  // re-wrapping either would lose its reason.
  if (error instanceof CommunityRequestError) {
    return error
  }
  if (error instanceof ResponseError) {
    const message = await readServerMessage(error.response, fallback)
    return new CommunityRequestError(
      reasonForResponse(error.response.status, message),
      message,
      readRetryAfterSeconds(error.response)
    )
  }
  // Anything else is a transport failure, an abort, or a contract-parse
  // failure. The message those carry is the useful one for a log; the reason
  // stays `unknown` so the caller falls back to its own translated copy.
  return new CommunityRequestError(
    'unknown',
    error instanceof Error ? error.message : fallback
  )
}

/**
 * The reason behind a rejection from this module, for UI code that has to
 * choose a translated string or a state change.
 */
export function communityFailureReason(error: unknown): CommunityFailureReason {
  return error instanceof CommunityRequestError ? error.reason : 'unknown'
}

/** Seconds until posting is allowed again, when the failure was a 429. */
export function communityRetryAfterSeconds(error: unknown): number | undefined {
  return error instanceof CommunityRequestError ? error.retryAfterSeconds : undefined
}

export interface CommunityFeedRequest {
  mode: CommunityFeedMode
  /**
   * Keyset cursor from a previous page IN THE SAME MODE. The cursor embeds the
   * mode it was minted under and the server answers 400 for a mismatch, so a
   * mode change must restart paging rather than carry the cursor across.
   */
  cursor?: string
  limit?: number
  signal?: AbortSignal
}

export async function getCommunityFeedFromWeb({
  mode,
  cursor,
  limit = 12,
  signal,
}: CommunityFeedRequest): Promise<CommunityFeed> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({ accessToken }).apiV1CommunityFeedGet(
      { xCouturePlatform: 'web', mode, cursor, limit },
      { signal }
    )
    return communityFeedResponseSchema.parse(response).data
  } catch (error: unknown) {
    // Developer-facing. The grid renders `community.error.load`.
    throw await communityError(error, 'Unable to load the community feed.')
  }
}

/**
 * Reads one post directly, which is how a deep link resolves its target: the
 * referenced card can sit far outside the first page, and the server answers
 * 404 for anything the caller cannot see, so an invisible target is a
 * `not_found` rather than a silent fall-through to an unrelated filter.
 */
export async function getCommunityPostFromWeb(
  postId: string,
  signal?: AbortSignal
): Promise<CommunityFeedItem> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommunityPostsPostIdGet({ postId, xCouturePlatform: 'web' }, { signal })
    return communityPostResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await communityError(error, 'Unable to load this community post.')
  }
}

/**
 * True when the post exists and the caller can see it. Used by the deep-link
 * handler, which needs a yes/no rather than an error: a missing target is an
 * expected outcome there, not a failure to report.
 */
export async function isCommunityPostVisibleFromWeb(
  postId: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    await getCommunityPostFromWeb(postId, signal)
    return true
  } catch {
    return false
  }
}

export async function reportCommunityPostFromWeb(
  postId: string,
  reason: CommunityReportReason,
  details?: string,
  signal?: AbortSignal
): Promise<void> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommunityPostsPostIdReportPost(
      {
        postId,
        xCouturePlatform: 'web',
        reportCommunityPostInput: { reason, details: details?.trim() || undefined },
      },
      { signal }
    )
    reportCommunityPostResponseSchema.parse(response)
  } catch (error: unknown) {
    throw await communityError(error, 'Unable to submit this report.')
  }
}

export async function withdrawCommunityPostFromWeb(
  postId: string,
  signal?: AbortSignal
): Promise<void> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommunityPostsPostIdWithdrawPost(
      { postId, xCouturePlatform: 'web' },
      { signal }
    )
    withdrawCommunityPostResponseSchema.parse(response)
  } catch (error: unknown) {
    throw await communityError(error, 'Unable to withdraw this post.')
  }
}

/** Coarse progress states for the three-step publish, for the compose form's status line. */
export type CommunityPublishState =
  | 'preparing'
  | 'allocating'
  | 'uploading'
  | 'publishing'

/**
 * The exact text `prepareGarmentImage` throws when the cropped output falls
 * under the contract's 256px floor (`apps/web/src/lib/wardrobe.ts`). Kept here
 * as a named constant with this pointer rather than inlined, so the coupling is
 * visible if that throw is ever reworded.
 */
const IMAGE_BELOW_MINIMUM_EDGE_MESSAGE =
  'Choose an image at least 256 pixels wide and tall.'

export interface AllocateCommunityLookInput {
  /** An object URL or data URL for the chosen image. */
  imagePreview: string
  /** Locale the server generates the alt-text suggestion in. */
  locale: SupportedLocale
  /**
   * Reused across the allocate, upload and publish requests of one attempt, and
   * across any retry of that attempt. Minting a fresh key per call allocates a
   * second upload session instead of replaying the first.
   */
  idempotencyKey: string
  signal?: AbortSignal
  onStateChange?: (state: CommunityPublishState) => void
}

export interface AllocatedCommunityLook {
  postId: string
  uploadSessionId: string
  /** Server-generated starting point. The author edits it and must confirm it. */
  altTextSuggestion: string
  altTextSuggestionLocale: SupportedLocale
}

/**
 * Prepares the bytes, allocates the session and uploads the object, then hands
 * back the server's alt-text suggestion for the author to edit and confirm.
 *
 * Split from {@link publishCommunityLookFromWeb} on purpose: the suggestion is
 * generated server-side and has to reach the form BEFORE the author confirms
 * it, and the spec forbids publishing unconfirmed alt text. Doing the whole
 * thing in one call would either publish the suggestion unconfirmed or throw
 * the uploaded object away when the author edits it.
 */
export async function allocateCommunityLookFromWeb({
  imagePreview,
  locale,
  idempotencyKey,
  signal,
  onStateChange,
}: AllocateCommunityLookInput): Promise<AllocatedCommunityLook> {
  const accessToken = readAccessToken()
  const api = createWebApiClient({ accessToken })

  onStateChange?.('preparing')
  let image
  try {
    image = await prepareGarmentImage(imagePreview, '4:3', false)
  } catch (error: unknown) {
    // `prepareGarmentImage` enforces the same 256px floor the contract's
    // `allocateCommunityPostInputSchema` declares, and it is the only failure
    // here the reader can act on, so it gets its own reason and its own
    // catalog string instead of the generic upload error. Matched on the
    // message because `apps/web/src/lib/wardrobe.ts` does not export it; the
    // mobile client raises `image_too_small` structurally instead.
    if (error instanceof Error && error.message === IMAGE_BELOW_MINIMUM_EDGE_MESSAGE) {
      throw new CommunityRequestError('image_too_small', error.message)
    }
    throw await communityError(error, 'Unable to prepare this photo.')
  }

  onStateChange?.('allocating')
  let session
  try {
    session = allocateCommunityPostResponseSchema.parse(
      await api.apiV1CommunityPostsAllocatePost(
        {
          idempotencyKey,
          xCouturePlatform: 'web',
          allocateCommunityPostInput: {
            locale,
            contentType: image.mimeType,
            byteSize: image.blob.size,
            sha256: image.sha256,
            widthPx: image.widthPx,
            heightPx: image.heightPx,
          },
        },
        { signal }
      )
    ).data
  } catch (error: unknown) {
    throw await communityError(error, 'Unable to allocate an upload session.')
  }

  onStateChange?.('uploading')
  try {
    await uploadGarmentBytes({
      uploadUrl: session.uploadUrl,
      uploadToken: session.uploadToken,
      bearerToken: accessToken,
      mimeType: image.mimeType,
      body: image.blob,
      signal,
      timeoutMs: 30_000,
    })
  } catch (error: unknown) {
    // Never fall through to publish: a post whose object was never written
    // renders as a permanently broken card that moderation cannot screen.
    throw new CommunityRequestError(
      'upload_failed',
      error instanceof Error ? error.message : 'Unable to upload the photo.'
    )
  }

  return {
    postId: session.postId,
    uploadSessionId: session.uploadSessionId,
    altTextSuggestion: session.altTextSuggestion,
    altTextSuggestionLocale: session.altTextSuggestionLocale,
  }
}

export interface PublishCommunityLookInput {
  postId: string
  uploadSessionId: string
  altText: string
  caption?: string | null
  challengeId?: string | null
  /** Locale the caption and alt text are screened in. */
  locale: SupportedLocale
  idempotencyKey: string
  signal?: AbortSignal
}

export async function publishCommunityLookFromWeb({
  postId,
  uploadSessionId,
  altText,
  caption,
  challengeId,
  locale,
  idempotencyKey,
  signal,
}: PublishCommunityLookInput): Promise<CommunityFeedItem> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommunityPostsPublishPost(
      {
        idempotencyKey,
        xCouturePlatform: 'web',
        publishCommunityPostInput: {
          postId,
          uploadSessionId,
          altText,
          altTextConfirmed: true,
          caption: caption?.trim() || null,
          locale,
          ...(challengeId ? { challengeId } : {}),
        },
      },
      { signal }
    )
    return publishCommunityPostResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await communityError(error, 'Unable to publish this look.')
  }
}

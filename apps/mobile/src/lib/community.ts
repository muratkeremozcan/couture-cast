// Story 6.1 Task 5 owner: the mobile app's community feed client.
//
// Follows `planner.ts` and `palette-advisor.ts` exactly: the same
// `readAccessToken` pre-check so a signed-out reader gets `signed_out` without a
// wasted round trip, the same `.strict()` envelope parsing at the trust
// boundary, and the same "the reason travels and the words do not" rule -- every
// message this module can produce is untranslated English (the server's own
// `COMMUNITY_AGE_GATE_DENIED_MESSAGE`, `COMMUNITY_POST_RATE_LIMITED_MESSAGE` and
// friends, or a transport error's text), and the community screen maps every
// reason onto a `community.error.*` key instead of rendering it. The first draft
// rendered `err.message` straight from the SDK, so a 429, a 409 and a 500 all
// read as "Response returned an error code".
//
// EVERY NATIVE MODULE IS IMPORTED LAZILY, inside the function that needs it.
// `vitest.config.ts:22-31` records why: expo-image-picker, expo-image-manipulator,
// expo-file-system and expo-crypto all pull in `expo-modules-core`, which cannot
// be evaluated in a browser bundle, so a static import here takes down every
// suite that transitively reaches the community screen at import time. That is
// exactly what a static `expo-image-picker` import in `community-post-sheet.tsx`
// did to `deep-link-handling.test.tsx`. `src/lib/commerce.ts` uses the same lazy
// shape for `expo-web-browser`.
import {
  allocateCommunityPostResponseSchema,
  communityFeedResponseSchema,
  communityPostResponseSchema,
  openCommunityPostResponseSchema,
  publishCommunityPostResponseSchema,
  reportCommunityPostResponseSchema,
  uploadGarmentBytes,
  withdrawCommunityPostResponseSchema,
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE,
  COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  type CommunityExperimentVariant,
  type CommunityFeed,
  type CommunityFeedItem,
  type CommunityFeedMode,
  type CommunityReportReason,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'
import { ResponseError } from '@couture/api-client'
import { createMobileApiClient } from './api-client'
import { withRequestTimeout } from './commerce'
import { resolveMobileAccessToken } from './mobile-auth'

export { randomUuidV4 as generateIdempotencyKey } from './uuid'

/** See `CommunityFailureReason` in `apps/web/src/lib/community.ts`; the two unions are kept identical so both surfaces render the same states. */
export type CommunityFailureReason =
  | 'signed_out'
  | 'age_gate'
  | 'rate_limited'
  | 'not_found'
  | 'reason_changed'
  | 'self_report'
  | 'disabled'
  | 'cursor_invalid'
  | 'media_unavailable'
  | 'upload_failed'
  | 'permission_denied'
  | 'picker_failed'
  | 'image_too_small'
  | 'unknown'

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
 * Fallback for a call made with no session. Developer-facing, with no catalog
 * entry: the screen reads the `signed_out` reason and renders its own
 * translated copy.
 */
export const COMMUNITY_SIGNED_OUT_MESSAGE = 'Sign in to take part in the community.'

async function readAccessToken(): Promise<string> {
  const token = (await resolveMobileAccessToken())?.trim()
  if (!token) {
    throw new CommunityRequestError('signed_out', COMMUNITY_SIGNED_OUT_MESSAGE)
  }
  return token
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
  if (status === 400) {
    // Reachable without any client bug. The feed cursor is bound to the resolved
    // band as well as the mode, and under `auto` the band is recomputed per
    // request from weather guaranteed fresh for only 60 minutes, so a snapshot
    // that goes stale between two pages of one scroll invalidates the cursor the
    // reader is holding. The contract's answer is to restart paging, which the
    // screen can only do if this arrives as its own reason instead of `unknown`.
    if (message.includes(COMMUNITY_CURSOR_INVALID_MESSAGE)) return 'cursor_invalid'
    return 'unknown'
  }
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
    if (message.includes(COMMUNITY_FEED_DISABLED_MESSAGE)) return 'disabled'
    // A stored object that cannot be signed is our outage, not a missing post,
    // and it answers 503 on both the single-post read and the publish. Folding it
    // into `unknown` told the author their look could not be published with no
    // hint that waiting would fix it.
    if (message.includes(COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE)) return 'media_unavailable'
    return 'unknown'
  }
  return 'unknown'
}

async function communityError(
  error: unknown,
  fallback: string
): Promise<CommunityRequestError> {
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
  return new CommunityRequestError(
    'unknown',
    error instanceof Error ? error.message : fallback
  )
}

export function communityFailureReason(error: unknown): CommunityFailureReason {
  return error instanceof CommunityRequestError ? error.reason : 'unknown'
}

/** Seconds until posting is allowed again, when the failure was a 429. */
export function communityRetryAfterSeconds(error: unknown): number | undefined {
  return error instanceof CommunityRequestError ? error.retryAfterSeconds : undefined
}

function communityClient(accessToken: string) {
  return createMobileApiClient({ accessToken })
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

export async function getCommunityFeedFromMobile({
  mode,
  cursor,
  limit = 12,
  signal,
}: CommunityFeedRequest): Promise<CommunityFeed> {
  const accessToken = await readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      communityClient(accessToken).apiV1CommunityFeedGet(
        { xCouturePlatform: 'mobile', mode, cursor, limit },
        { signal: requestSignal }
      )
    )
    return communityFeedResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await communityError(error, 'Unable to load the community feed.')
  }
}

export async function getCommunityPostFromMobile(
  postId: string,
  signal?: AbortSignal
): Promise<CommunityFeedItem> {
  const accessToken = await readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      communityClient(accessToken).apiV1CommunityPostsPostIdGet(
        { postId, xCouturePlatform: 'mobile' },
        { signal: requestSignal }
      )
    )
    return communityPostResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await communityError(error, 'Unable to load this community post.')
  }
}

/**
 * Records one card open. The route existed and the generated operation existed;
 * nothing called either, and `community_card_opened` is the only input to the
 * beta gate's advance condition, so the gate was unmeasurable.
 *
 * `experimentVariant` is SENT rather than re-derived server-side: it is the arm
 * the client was serving when the card was drawn, so the event is attributed to
 * the feed the reader actually saw even if the assignment moved in between.
 * `isSelf` and the dedupe key stay server-decided, because the advance condition
 * counts non-self opens and a client-asserted flag would let the population being
 * measured move the number that decides whether the feature ships.
 */
export async function recordCommunityCardOpenedFromMobile(
  postId: string,
  experimentVariant: CommunityExperimentVariant,
  signal?: AbortSignal
): Promise<void> {
  const accessToken = await readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      communityClient(accessToken).apiV1CommunityPostsPostIdOpenedPost(
        {
          postId,
          xCouturePlatform: 'mobile',
          openCommunityPostInput: { experimentVariant },
        },
        { signal: requestSignal }
      )
    )
    openCommunityPostResponseSchema.parse(response)
  } catch (error: unknown) {
    throw await communityError(error, 'Unable to record this card open.')
  }
}

export async function reportCommunityPostFromMobile(
  postId: string,
  reason: CommunityReportReason,
  details?: string,
  signal?: AbortSignal
): Promise<void> {
  const accessToken = await readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      communityClient(accessToken).apiV1CommunityPostsPostIdReportPost(
        {
          postId,
          xCouturePlatform: 'mobile',
          reportCommunityPostInput: { reason, details: details?.trim() || undefined },
        },
        { signal: requestSignal }
      )
    )
    reportCommunityPostResponseSchema.parse(response)
  } catch (error: unknown) {
    throw await communityError(error, 'Unable to submit this report.')
  }
}

export async function withdrawCommunityPostFromMobile(
  postId: string,
  signal?: AbortSignal
): Promise<void> {
  const accessToken = await readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      communityClient(accessToken).apiV1CommunityPostsPostIdWithdrawPost(
        { postId, xCouturePlatform: 'mobile' },
        { signal: requestSignal }
      )
    )
    withdrawCommunityPostResponseSchema.parse(response)
  } catch (error: unknown) {
    throw await communityError(error, 'Unable to withdraw this post.')
  }
}

export interface CommunityPhotoAsset {
  uri: string
  width: number
  height: number
}

/**
 * Opens the library picker and returns the chosen asset, or `null` when the
 * reader cancels. Throws `permission_denied` or `picker_failed` so the sheet
 * renders a translated string rather than a native error message.
 */
export async function pickCommunityPhoto(): Promise<CommunityPhotoAsset | null> {
  let imagePicker
  try {
    imagePicker = await import('expo-image-picker')
  } catch (error: unknown) {
    throw new CommunityRequestError(
      'picker_failed',
      error instanceof Error ? error.message : 'Image picker unavailable.'
    )
  }

  const permission = await imagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    throw new CommunityRequestError(
      'permission_denied',
      'Photo library permission was not granted.'
    )
  }

  let result
  try {
    result = await imagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    })
  } catch (error: unknown) {
    throw new CommunityRequestError(
      'picker_failed',
      error instanceof Error ? error.message : 'Image picker failed to open.'
    )
  }

  const asset = result.canceled ? undefined : result.assets[0]
  if (!asset) {
    return null
  }
  return { uri: asset.uri, width: asset.width, height: asset.height }
}

/** Coarse progress states for the three-step publish, for the sheet's status line. */
export type CommunityPublishState =
  | 'preparing'
  | 'allocating'
  | 'uploading'
  | 'publishing'

export interface AllocateCommunityLookInput {
  asset: CommunityPhotoAsset
  /** Locale the server generates the alt-text suggestion in. */
  locale: SupportedLocale
  /**
   * Reused across the allocate, upload and publish requests of one attempt, and
   * across any retry of that attempt, so a retry replays the first session
   * rather than allocating a second one.
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

const MIN_IMAGE_EDGE_PX = 256
const MAX_IMAGE_EDGE_PX = 4096

/**
 * Re-encodes the picked asset, allocates the session and uploads the real
 * bytes, then hands back the server's alt-text suggestion for the author to
 * edit and confirm.
 *
 * Always re-encodes, even when no resize is needed, following
 * `silhouette-editor.tsx`: the library hands back whatever format the OS
 * captured, and the allocate call declares one `contentType`. Skipping the
 * re-encode uploads the original bytes under a MIME type that may be a lie,
 * which is what the first draft did with its hardcoded `image/jpeg`.
 *
 * The checksum is computed over the bytes that are actually sent. The first
 * draft sent `'a'.repeat(64)`, a constant that matches no object.
 */
export async function allocateCommunityLookFromMobile({
  asset,
  locale,
  idempotencyKey,
  signal,
  onStateChange,
}: AllocateCommunityLookInput): Promise<AllocatedCommunityLook> {
  const accessToken = await readAccessToken()

  onStateChange?.('preparing')
  let bytes: Uint8Array<ArrayBuffer>
  let sha256: string
  let widthPx: number
  let heightPx: number
  try {
    const [{ manipulateAsync, SaveFormat }, { File }, { sha256Hex }] = await Promise.all([
      import('expo-image-manipulator'),
      import('expo-file-system'),
      // `.js` on a `.ts` source is what `--moduleResolution node16` wants and
      // what the bundlers resolve; `mobile-analytics-diagnostics.test.ts` uses
      // the same form.
      import('./expo-native-helpers.js'),
    ])

    const longestEdge = Math.max(asset.width, asset.height)
    const shortestEdge = Math.min(asset.width, asset.height)
    if (shortestEdge < MIN_IMAGE_EDGE_PX) {
      throw new CommunityRequestError(
        'image_too_small',
        `Image must be at least ${MIN_IMAGE_EDGE_PX} pixels on each side.`
      )
    }
    const scale = Math.min(1, MAX_IMAGE_EDGE_PX / longestEdge)
    const prepared = await manipulateAsync(
      asset.uri,
      [
        {
          resize: {
            width: Math.round(asset.width * scale),
            height: Math.round(asset.height * scale),
          },
        },
      ],
      { compress: 0.9, format: SaveFormat.JPEG }
    )

    bytes = await new File(prepared.uri).bytes()
    sha256 = await sha256Hex(bytes)
    widthPx = prepared.width
    heightPx = prepared.height
  } catch (error: unknown) {
    throw await communityError(error, 'Unable to prepare this photo.')
  }

  onStateChange?.('allocating')
  let session
  try {
    session = allocateCommunityPostResponseSchema.parse(
      await withRequestTimeout(signal, (requestSignal) =>
        communityClient(accessToken).apiV1CommunityPostsAllocatePost(
          {
            idempotencyKey,
            xCouturePlatform: 'mobile',
            allocateCommunityPostInput: {
              locale,
              contentType: 'image/jpeg',
              byteSize: bytes.byteLength,
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
    throw await communityError(error, 'Unable to allocate an upload session.')
  }

  onStateChange?.('uploading')
  try {
    await uploadGarmentBytes({
      uploadUrl: session.uploadUrl,
      uploadToken: session.uploadToken,
      bearerToken: accessToken,
      mimeType: 'image/jpeg',
      body: bytes.buffer,
      signal,
      timeoutMs: 30_000,
    })
  } catch (error: unknown) {
    // Never fall through to publish: the first draft PUT the upload TOKEN as the
    // request body and swallowed every failure, so each post referenced an
    // object holding the literal token text.
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

export async function publishCommunityLookFromMobile({
  postId,
  uploadSessionId,
  altText,
  caption,
  challengeId,
  locale,
  idempotencyKey,
  signal,
}: PublishCommunityLookInput): Promise<CommunityFeedItem> {
  const accessToken = await readAccessToken()
  try {
    const response = await withRequestTimeout(signal, (requestSignal) =>
      communityClient(accessToken).apiV1CommunityPostsPublishPost(
        {
          idempotencyKey,
          xCouturePlatform: 'mobile',
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
        { signal: requestSignal }
      )
    )
    return publishCommunityPostResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await communityError(error, 'Unable to publish this look.')
  }
}

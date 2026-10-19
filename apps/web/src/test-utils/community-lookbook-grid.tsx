// Shared community grid fixtures, transport responses, image preparation, and test lifecycle.
import { Blob as NodeBlob } from 'node:buffer'
import { http, HttpResponse } from 'msw'
import { render, screen } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'
import type { ComponentProps } from 'react'
import {
  allocateCommunityPostResponseSchema,
  communityFeedModeSchema,
  communityFeedResponseSchema,
  communityPostResponseSchema,
  encodeCommunityFeedCursor,
  publishCommunityPostResponseSchema,
  type CommunityAuthorPostState,
  type CommunityBandUnresolvedReason,
  type CommunityFeed,
  type CommunityFeedCursorPayload,
  type CommunityFeedItem,
  type CommunityPostStatus,
  type EmbeddedCommunityChallenge,
} from '@couture/api-client/contracts/http'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../lib/wardrobe'
import { CommunityLookbookGrid } from '../app/components/community-lookbook-grid'
export { COMMUNITY_FEED_MODES } from '../app/components/community-lookbook-grid'

export const FEED_PATH = '/api/v1/community/feed'

export const ALLOCATE_PATH = '/api/v1/community/posts/allocate'

export const PUBLISH_PATH = '/api/v1/community/posts/publish'

export const POST_PATH = '/api/v1/community/posts/:postId'

export const OPENED_PATH = '/api/v1/community/posts/:postId/opened'

export const REPORT_PATH = '/api/v1/community/posts/:postId/report'

export const WITHDRAW_PATH = '/api/v1/community/posts/:postId/withdraw'

export const UPLOAD_URL = 'https://mock-upload.test/upload'

/** The bytes `prepareGarmentImage` reads back for the chosen photo, served by MSW. */
export const FIXTURE_IMAGE_URL = 'http://localhost/community-fixture.jpg'

export const IMAGE_URL = 'https://storage.local/community/post-1.jpg'

export const REFRESHED_IMAGE_URL = 'https://storage.local/community/post-1-refreshed.jpg'

/** The premium accent system's error/destructive colour, kept a literal in the grid. */
export const MERLOT = '#7A1F2D'

/** Success gold. Flagged content must never wear it. */
export const GOLD = '#C9A14A'

export const SUGGESTED_ALT_TEXT = 'A layered outfit photographed against a plain wall.'

// Keep image lifetimes stable while transport and React continue on real timers.
export const IMAGE_REFERENCE_NOW = Date.parse('2026-10-19T12:00:00.000Z')

export function isoIn(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

/**
 * Every cursor in this file is minted through the contract's own encoder rather
 * than written as an opaque literal.
 *
 * `encodeCommunityFeedCursor` parses before it encodes, so a field added to
 * `communityFeedCursorPayloadSchema` fails to compile here instead of leaving a
 * string that keeps satisfying assertions the server could no longer produce.
 * The `band` is the field that matters: it carries the RESOLVED band, which is a
 * different value from `mode`, and it is the half of the binding that goes stale
 * mid-scroll.
 */
export function cursorFor(overrides: Partial<CommunityFeedCursorPayload> = {}): string {
  return encodeCommunityFeedCursor({
    publishedAt: '2026-09-01T10:00:00.000Z',
    id: 'post-1',
    mode: 'auto',
    band: 'temperate_dry',
    ...overrides,
  })
}

export function item(overrides: Partial<CommunityFeedItem> = {}): CommunityFeedItem {
  return {
    id: 'post-1',
    caption: 'Layered wool over a merino base for a damp commute.',
    altText: 'A charcoal wool coat over a cream knit, with black ankle boots.',
    climateBand: 'temperate_wet',
    imageAccess: { url: IMAGE_URL, expiresAt: isoIn(3600) },
    publishedAt: '2026-09-01T10:00:00.000Z',
    createdAt: '2026-08-31T10:00:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Style Explorer 4F2A', isSelf: false },
    ...overrides,
  }
}

export function authorState(
  overrides: Partial<CommunityAuthorPostState> = {}
): CommunityAuthorPostState {
  return {
    id: 'author-state-1',
    caption: null,
    altText: null,
    climateBand: null,
    imageAccess: null,
    createdAt: '2026-08-31T10:00:00.000Z',
    publishedAt: null,
    status: 'pending_review',
    challengeId: null,
    moderationReason: null,
    ...overrides,
  }
}

export const CHALLENGE: EmbeddedCommunityChallenge = {
  id: 'challenge-1',
  slug: 'rain-ready-layers',
  climateBand: 'temperate_wet',
  title: 'Rain-ready layers',
  body: 'Show the layer you reach for when the forecast turns.',
  startsAt: '2026-08-31T00:00:00.000Z',
  endsAt: '2026-09-07T00:00:00.000Z',
  timeZone: 'Europe/Istanbul',
}

export function feed(overrides: Partial<CommunityFeed> = {}): CommunityFeed {
  return {
    items: [],
    authorStates: [],
    nextCursor: null,
    mode: 'auto',
    viewerBand: 'temperate_dry',
    bandResolved: true,
    bandUnresolvedReason: null,
    experimentVariant: 'auto',
    activeChallenge: null,
    ...overrides,
  }
}

/**
 * Serves a feed only after the contract's own response schema accepts it, the
 * way `test-utils/msw/handlers.ts` does: a fixture that drifts from the contract
 * has to fail here rather than teach this suite a wire shape the server never
 * sends.
 */
export function feedBody(overrides: Partial<CommunityFeed> = {}) {
  return HttpResponse.json(
    communityFeedResponseSchema.parse({ data: feed(overrides) }) as unknown as Record<
      string,
      unknown
    >
  )
}

/**
 * Echoes the requested mode back as the mode served, which is what the API does
 * for every mode except `auto` -- that one resolves to the viewer's experiment
 * arm. A fixed `mode: 'auto'` here would make every filter click look like the
 * server had overridden the reader's choice, now that the surface renders the
 * mode it was served rather than the one it asked for. An explicit override
 * still wins, which is how the experiment's `auto` -> `all` case is set up.
 */
export function feedHandler(overrides: Partial<CommunityFeed> = {}) {
  return http.get(FEED_PATH, ({ request }) => {
    const requested = communityFeedModeSchema.safeParse(
      new URL(request.url).searchParams.get('mode')
    )
    return feedBody({
      ...(requested.success ? { mode: requested.data } : {}),
      ...overrides,
    })
  })
}

/** The single-post read, which is how a deep link resolves a target off page one. */
export function postBody(overrides: Partial<CommunityFeedItem> = {}) {
  return HttpResponse.json(
    communityPostResponseSchema.parse({ data: item(overrides) }) as unknown as Record<
      string,
      unknown
    >
  )
}

/** The shared `.strict()` error envelope, which is how every reason is classified. */
export function errorBody(
  statusCode: number,
  message: string,
  error: string,
  init: ResponseInit = {}
) {
  return HttpResponse.json(
    { statusCode, message, error },
    { status: statusCode, ...init }
  )
}

export function allocateBody() {
  return HttpResponse.json(
    allocateCommunityPostResponseSchema.parse({
      data: {
        postId: 'mock-allocated-post-id',
        uploadSessionId: 'mock-upload-session-id',
        uploadUrl: UPLOAD_URL,
        uploadToken: 'mock-token',
        requiredHeaders: { 'content-type': 'image/jpeg' },
        expiresAt: isoIn(3600),
        altTextSuggestion: SUGGESTED_ALT_TEXT,
        altTextSuggestionLocale: 'en-US',
      },
    }) as unknown as Record<string, unknown>
  )
}

export function publishBody() {
  return HttpResponse.json(
    publishCommunityPostResponseSchema.parse({
      data: item({
        id: 'mock-published-post-id',
        status: 'pending_review',
        publishedAt: null,
        author: { displayName: 'You', isSelf: true },
      }),
    }) as unknown as Record<string, unknown>
  )
}

/** Feeds `prepareGarmentImage` the source bytes it re-reads from the preview URL. */
export function imageFixtureHandler() {
  return http.get(FIXTURE_IMAGE_URL, () =>
    HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3, 4]).buffer, {
      headers: { 'Content-Type': 'image/jpeg' },
    })
  )
}

export function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

export function renderGrid(
  props: Partial<ComponentProps<typeof CommunityLookbookGrid>> = {}
) {
  // No `I18nextProvider`. `CommunityLookbookGrid` binds `getI18n()` explicitly
  // through `useTranslation(undefined, { i18n })` precisely because
  // `lookbook-prism-layout.tsx` renders it OUTSIDE both of its providers, so
  // wrapping here would test a tree production never mounts.
  return render(<CommunityLookbookGrid showFilterNav {...props} />)
}

/**
 * `prepareGarmentImage` decodes the chosen photo and re-encodes it through a
 * real `<canvas>`, neither of which jsdom implements. Stubbed the same way
 * `lib/wardrobe.test.ts` stubs them, so the transport sequence the compose flow
 * performs (prepare, allocate, PUT bytes, publish) still runs.
 */
export function installImagePrepMocks(source = { widthPx: 900, heightPx: 1200 }) {
  class FakeImage {
    naturalWidth = source.widthPx
    naturalHeight = source.heightPx
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    callback: BlobCallback,
    type?: string
  ) {
    // jsdom's own `Blob` lacks `arrayBuffer()`, which the sha256 digest needs.
    callback(
      new NodeBlob(['fixture-image-bytes'], {
        type: type ?? 'image/jpeg',
      }) as unknown as Blob
    )
  })
  const originalCreate = URL.createObjectURL.bind(URL)
  const originalRevoke = URL.revokeObjectURL.bind(URL)
  URL.createObjectURL = (() => FIXTURE_IMAGE_URL) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL
  return () => {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
}

/** Chooses a photo and waits for the server's alt-text suggestion to land. */
export async function choosePhoto(user: ReturnType<typeof userEvent.setup>) {
  const fileInput = await screen.findByTestId('post-image-file-input')
  await user.upload(
    fileInput,
    new File(['look-bytes'], 'look.jpg', { type: 'image/jpeg' })
  )
}

export const UNRESOLVED_COPY: Record<CommunityBandUnresolvedReason, string> = {
  no_location:
    'Add a location to see looks matched to your climate. Until then you are seeing every climate band.',
  weather_unavailable:
    'Your local forecast is unavailable, so you are seeing looks from every climate band.',
  weather_stale:
    'Your local forecast is out of date, so you are seeing looks from every climate band.',
  weather_malformed:
    'Your local forecast could not be read, so you are seeing looks from every climate band.',
  insufficient_usable_days:
    'There is not enough recent forecast data to match your climate, so you are seeing looks from every climate band.',
}

export const STATUS_COPY: Record<CommunityPostStatus, string> = {
  draft: 'Draft',
  uploading: 'Uploading',
  pending_review: 'Under review',
  published: 'Published',
  flagged: 'Removed by moderation',
  review_failed: 'Screening did not finish',
  withdrawn: 'Withdrawn',
  consent_suspended: 'Hidden pending consent',
}

export const REMOVED_COPY = {
  flagged: 'Moderation removed this look. Nobody else can see it.',
  review_failed:
    'Screening did not finish, so this look was not published. Share it again to retry.',
  withdrawn: 'You withdrew this look from the feed.',
  consent_suspended:
    'This look is hidden until a guardian renews consent. Share it again once consent is active.',
} as const

export function setupCommunityGridClock() {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(IMAGE_REFERENCE_NOW)
  })
}

export function setupCommunityGridSurface() {
  beforeEach(() => {
    window.sessionStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
}

// Learning path Step 38: Community feed by climate band.
// Story 6.1 Task 7 owner: the web community surface.
//
// These drive the real `lib/community` through MSW, the way
// `palette-advisor-panel.test.tsx` does. Every user-visible state on this surface
// is chosen by `communityFailureReason(error)`, and that reason is decided by
// reading the server's own message constants out of a `.strict()` error envelope.
// A mocked lib would let the grid render `community.error.rateLimited` for a 409
// and still pass. So each state below is one MSW response away from the real one.
import axe from 'axe-core'
import { Blob as NodeBlob } from 'node:buffer'
import { delay, http, HttpResponse } from 'msw'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { CLIMATE_BANDS } from '@couture/utils'
import {
  allocateCommunityPostResponseSchema,
  communityBandUnresolvedReasonSchema,
  communityFeedModeSchema,
  communityFeedResponseSchema,
  communityPostResponseSchema,
  communityPostStatusSchema,
  encodeCommunityFeedCursor,
  publishCommunityPostResponseSchema,
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE,
  COMMUNITY_POST_RATE_LIMITED_MESSAGE,
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
  COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  type CommunityAuthorPostState,
  type CommunityBandUnresolvedReason,
  type CommunityFeed,
  type CommunityFeedCursorPayload,
  type CommunityFeedItem,
  type CommunityPostStatus,
  type EmbeddedCommunityChallenge,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { COMMUNITY_FEED_MODES, CommunityLookbookGrid } from './community-lookbook-grid'

const posthogMocks = vi.hoisted(() => ({ capture: vi.fn() }))

vi.mock('posthog-js', () => ({
  default: { capture: posthogMocks.capture },
}))

const FEED_PATH = '/api/v1/community/feed'
const ALLOCATE_PATH = '/api/v1/community/posts/allocate'
const PUBLISH_PATH = '/api/v1/community/posts/publish'
const POST_PATH = '/api/v1/community/posts/:postId'
const OPENED_PATH = '/api/v1/community/posts/:postId/opened'
const REPORT_PATH = '/api/v1/community/posts/:postId/report'
const WITHDRAW_PATH = '/api/v1/community/posts/:postId/withdraw'
const UPLOAD_URL = 'https://mock-upload.test/upload'

/** The bytes `prepareGarmentImage` reads back for the chosen photo, served by MSW. */
const FIXTURE_IMAGE_URL = 'http://localhost/community-fixture.jpg'

const IMAGE_URL = 'https://storage.local/community/post-1.jpg'
const REFRESHED_IMAGE_URL = 'https://storage.local/community/post-1-refreshed.jpg'

/** The premium accent system's error/destructive colour, kept a literal in the grid. */
const MERLOT = '#7A1F2D'
/** Success gold. Flagged content must never wear it. */
const GOLD = '#C9A14A'

const SUGGESTED_ALT_TEXT = 'A layered outfit photographed against a plain wall.'

function isoIn(seconds: number): string {
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
function cursorFor(overrides: Partial<CommunityFeedCursorPayload> = {}): string {
  return encodeCommunityFeedCursor({
    publishedAt: '2026-09-01T10:00:00.000Z',
    id: 'post-1',
    mode: 'auto',
    band: 'temperate_dry',
    ...overrides,
  })
}

function item(overrides: Partial<CommunityFeedItem> = {}): CommunityFeedItem {
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

function authorState(
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

const CHALLENGE: EmbeddedCommunityChallenge = {
  id: 'challenge-1',
  slug: 'rain-ready-layers',
  climateBand: 'temperate_wet',
  title: 'Rain-ready layers',
  body: 'Show the layer you reach for when the forecast turns.',
  startsAt: '2026-08-31T00:00:00.000Z',
  endsAt: '2026-09-07T00:00:00.000Z',
  timeZone: 'Europe/Istanbul',
}

function feed(overrides: Partial<CommunityFeed> = {}): CommunityFeed {
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
function feedBody(overrides: Partial<CommunityFeed> = {}) {
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
function feedHandler(overrides: Partial<CommunityFeed> = {}) {
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
function postBody(overrides: Partial<CommunityFeedItem> = {}) {
  return HttpResponse.json(
    communityPostResponseSchema.parse({ data: item(overrides) }) as unknown as Record<
      string,
      unknown
    >
  )
}

/** The shared `.strict()` error envelope, which is how every reason is classified. */
function errorBody(
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

function allocateBody() {
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

function publishBody() {
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
function imageFixtureHandler() {
  return http.get(FIXTURE_IMAGE_URL, () =>
    HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3, 4]).buffer, {
      headers: { 'Content-Type': 'image/jpeg' },
    })
  )
}

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

function renderGrid(props: Partial<ComponentProps<typeof CommunityLookbookGrid>> = {}) {
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
function installImagePrepMocks(source = { widthPx: 900, heightPx: 1200 }) {
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
async function choosePhoto(user: ReturnType<typeof userEvent.setup>) {
  const fileInput = await screen.findByTestId('post-image-file-input')
  await user.upload(
    fileInput,
    new File(['look-bytes'], 'look.jpg', { type: 'image/jpeg' })
  )
}

const UNRESOLVED_COPY: Record<CommunityBandUnresolvedReason, string> = {
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

const STATUS_COPY: Record<CommunityPostStatus, string> = {
  draft: 'Draft',
  uploading: 'Uploading',
  pending_review: 'Under review',
  published: 'Published',
  flagged: 'Removed by moderation',
  review_failed: 'Screening did not finish',
  withdrawn: 'Withdrawn',
  consent_suspended: 'Hidden pending consent',
}

const REMOVED_COPY = {
  flagged: 'Moderation removed this look. Nobody else can see it.',
  review_failed:
    'Screening did not finish, so this look was not published. Share it again to retry.',
  withdrawn: 'You withdrew this look from the feed.',
  consent_suspended:
    'This look is hidden until a guardian renews consent. Share it again once consent is active.',
} as const

describe('CommunityLookbookGrid (Story 6.1)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('feed lifecycle', () => {
    it('6.1-WEB-001 shows decorative skeletons, then the feed, with exactly one live region', async () => {
      signIn()
      useMswHandlers(
        http.get(FEED_PATH, async () => {
          await delay(20)
          return feedBody({ items: [item()] })
        })
      )
      renderGrid()

      const skeletons = await screen.findByTestId('community-feed-loading')
      // Decorative, not a second announcement: `role="status"` here is what made
      // `getByRole('status')` ambiguous across the three tests this file replaces.
      expect(skeletons).toHaveAttribute('aria-hidden', 'true')
      expect(within(skeletons).getAllByTestId('lookbook-card-skeleton')).toHaveLength(4)
      expect(screen.getByTestId('community-card-grid')).toHaveAttribute(
        'aria-busy',
        'true'
      )

      const liveRegions = screen.getAllByRole('status')
      expect(liveRegions).toHaveLength(1)
      expect(liveRegions[0]).toBe(screen.getByTestId('community-live-region'))
      expect(liveRegions[0]).toHaveTextContent('Loading community looks')

      await screen.findByTestId('lookbook-card-post-1')
      expect(screen.queryByTestId('community-feed-loading')).not.toBeInTheDocument()
      expect(screen.getByTestId('community-card-grid')).toHaveAttribute(
        'aria-busy',
        'false'
      )
      expect(screen.getAllByRole('status')).toHaveLength(1)
      expect(screen.getByTestId('community-live-region')).toHaveTextContent(
        'Showing Your climate: Temperate and dry looks. 1 loaded.'
      )
    })

    it('6.1-WEB-002 renders the localized empty state with its share call to action', async () => {
      signIn()
      useMswHandlers(feedHandler())
      renderGrid()

      const empty = await screen.findByTestId('community-feed-empty')
      expect(empty).toHaveTextContent('No looks shared here yet')
      expect(empty).toHaveTextContent(
        'Be the first style explorer to share a weather-ready look.'
      )
      expect(screen.getByTestId('community-feed-empty-share-button')).toHaveTextContent(
        'Share your look'
      )
    })

    it('6.1-WEB-003 explains a 500 without leaking the server message and recovers on Retry', async () => {
      signIn()
      let calls = 0
      useMswHandlers(
        http.get(FEED_PATH, () => {
          calls += 1
          return calls === 1
            ? errorBody(
                500,
                'ECONNRESET reading community_posts',
                'Internal Server Error'
              )
            : feedBody({ items: [item()] })
        })
      )
      renderGrid()

      const banner = await screen.findByTestId('community-feed-error')
      expect(banner).toHaveTextContent('We could not load the community feed.')
      expect(banner).not.toHaveTextContent('ECONNRESET')
      expect(banner).toHaveStyle({ color: MERLOT })

      await userEvent.click(screen.getByTestId('community-feed-retry-button'))

      await screen.findByTestId('lookbook-card-post-1')
      expect(screen.queryByTestId('community-feed-error')).not.toBeInTheDocument()
      expect(calls).toBe(2)
    })

    it('6.1-WEB-004 reads a 401 as signed out rather than as a load failure', async () => {
      signIn()
      useMswHandlers(
        http.get(FEED_PATH, () =>
          errorBody(401, 'Missing or invalid authentication headers.', 'Unauthorized')
        )
      )
      renderGrid()

      const banner = await screen.findByTestId('community-feed-error')
      expect(banner).toHaveTextContent('Sign in to take part in the community.')
      expect(banner).not.toHaveTextContent('We could not load the community feed.')
    })

    it('6.1-WEB-005 reads a 503 kill switch as temporarily unavailable', async () => {
      signIn()
      useMswHandlers(
        http.get(FEED_PATH, () =>
          errorBody(503, COMMUNITY_FEED_DISABLED_MESSAGE, 'Service Unavailable')
        )
      )
      renderGrid()

      expect(await screen.findByTestId('community-feed-error')).toHaveTextContent(
        'The community feed is temporarily unavailable.'
      )
    })

    it('6.1-WEB-056 falls back to generic copy for a 503 that is not the kill switch', async () => {
      signIn()
      useMswHandlers(
        http.get(FEED_PATH, () =>
          errorBody(503, 'upstream gateway is draining', 'Service Unavailable')
        )
      )
      renderGrid()

      const banner = await screen.findByTestId('community-feed-error')
      expect(banner).toHaveTextContent('We could not load the community feed.')
      expect(banner).not.toHaveTextContent(
        'The community feed is temporarily unavailable.'
      )
      expect(banner).not.toHaveTextContent('upstream gateway is draining')
    })

    it('6.1-WEB-006 tells a signed-out reader to sign in and offers no compose affordance', async () => {
      // No session: `lib/community` throws `signed_out` before any request, so
      // MSW never sees one.
      renderGrid()

      expect(await screen.findByTestId('community-feed-error')).toHaveTextContent(
        'Sign in to take part in the community.'
      )
      expect(screen.queryByTestId('create-post-button')).not.toBeInTheDocument()
    })

    it('6.1-WEB-059 falls back to generic copy when the envelope carries no message', async () => {
      signIn()
      useMswHandlers(
        http.get(FEED_PATH, () =>
          HttpResponse.json(
            { statusCode: 500, error: 'Internal Server Error' },
            { status: 500 }
          )
        )
      )
      renderGrid()

      expect(await screen.findByTestId('community-feed-error')).toHaveTextContent(
        'We could not load the community feed.'
      )
    })

    it('6.1-WEB-007 falls back to generic copy when the transport itself fails', async () => {
      signIn()
      useMswHandlers(http.get(FEED_PATH, () => HttpResponse.error()))
      renderGrid()

      expect(await screen.findByTestId('community-feed-error')).toHaveTextContent(
        'We could not load the community feed.'
      )
    })

    it.each([...communityBandUnresolvedReasonSchema.options])(
      '6.1-WEB-008 explains an unresolved band: %s',
      async (reason) => {
        signIn()
        useMswHandlers(
          feedHandler({
            items: [item()],
            viewerBand: null,
            bandResolved: false,
            bandUnresolvedReason: reason,
            // `auto`, because that is the only mode the banner speaks for. The
            // server resolves the band on every request whatever the mode, so it
            // reports a reason under `all` and under a pinned band too, and the
            // fixture said `all` while asserting copy that only makes sense for
            // `auto`.
            mode: 'auto',
          })
        )
        renderGrid()

        const notice = await screen.findByTestId('community-band-unresolved')
        expect(notice).toHaveTextContent(UNRESOLVED_COPY[reason])
      }
    )

    it.each(['all', 'cold_dry'] as const)(
      '6.1-WEB-063 keeps the band notice off a feed served as %s',
      async (mode) => {
        signIn()
        // Producible exactly as written: the server resolves the viewer band
        // before it resolves the filter, so a viewer with no saved location
        // carries `no_location` on every response, including the ones where the
        // band was never going to be applied. The banner says "you are seeing
        // every climate band", which under a pinned band is simply false.
        useMswHandlers(
          feedHandler({
            items: [item()],
            viewerBand: null,
            bandResolved: false,
            bandUnresolvedReason: 'no_location',
            mode,
          })
        )
        renderGrid({ activeTab: mode })

        await screen.findByTestId('lookbook-card-post-1')
        expect(screen.queryByTestId('community-band-unresolved')).not.toBeInTheDocument()
      }
    )

    it('6.1-WEB-009 hides the band notice when the band resolved', async () => {
      signIn()
      useMswHandlers(feedHandler({ items: [item()] }))
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      expect(screen.queryByTestId('community-band-unresolved')).not.toBeInTheDocument()
    })
  })

  describe('filter chips', () => {
    it('6.1-WEB-010 offers auto, all and the six climate bands, all enabled, auto active', async () => {
      signIn()
      useMswHandlers(feedHandler({ items: [item()], viewerBand: 'warm_wet' }))
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')

      expect([...COMMUNITY_FEED_MODES]).toEqual(['auto', 'all', ...CLIMATE_BANDS])
      for (const mode of COMMUNITY_FEED_MODES) {
        const chip = screen.getByTestId(`community-filter-${mode}`)
        expect(chip).toBeEnabled()
        expect(chip).toHaveAttribute('aria-pressed', mode === 'auto' ? 'true' : 'false')
      }

      // The `auto` chip names the band the server resolved, so the reader never has
      // to guess which climate is theirs.
      expect(screen.getByTestId('community-filter-auto')).toHaveTextContent(
        'Your climate: Warm and wet'
      )
      expect(screen.getByTestId('community-filter-all')).toHaveTextContent(
        'Every climate'
      )
      expect(screen.getByTestId('community-filter-cold_dry')).toHaveTextContent(
        'Cold and dry'
      )

      // The four chips with no server behind them are gone for good.
      for (const legacy of [/^new$/i, /^following$/i, /^near me$/i, /^brands$/i]) {
        expect(screen.queryByRole('button', { name: legacy })).not.toBeInTheDocument()
      }
    })

    it('6.1-WEB-011 names the auto chip generically until a band resolves', async () => {
      signIn()
      useMswHandlers(
        feedHandler({
          viewerBand: null,
          bandResolved: false,
          bandUnresolvedReason: 'no_location',
          mode: 'auto',
        })
      )
      renderGrid()

      await screen.findByTestId('community-band-unresolved')
      expect(screen.getByTestId('community-filter-auto')).toHaveTextContent(
        'Your climate'
      )
      expect(screen.getByTestId('community-filter-auto')).not.toHaveTextContent(
        'Your climate:'
      )
    })

    it('6.1-WEB-012 sends mode=<band> and drops the cursor it was holding', async () => {
      signIn()
      const urls: string[] = []
      useMswHandlers(
        http.get(FEED_PATH, ({ request }) => {
          urls.push(request.url)
          const query = new URL(request.url).searchParams
          const mode = query.get('mode') ?? 'auto'
          if (mode === 'auto') {
            return query.get('cursor') === null
              ? feedBody({ items: [item()], nextCursor: cursorFor() })
              : feedBody({ items: [item({ id: 'post-2' })] })
          }
          return feedBody({
            items: [item({ id: 'post-3' })],
            mode: 'cold_dry',
            viewerBand: 'temperate_dry',
          })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('load-more-button'))
      await screen.findByTestId('lookbook-card-post-2')

      const pagedUrl = new URL(urls[1] ?? '')
      expect(pagedUrl.searchParams.get('mode')).toBe('auto')
      expect(pagedUrl.searchParams.get('cursor')).toBe(cursorFor())

      await user.click(screen.getByTestId('community-filter-cold_dry'))
      await screen.findByTestId('lookbook-card-post-3')

      // The cursor is bound to the mode it was minted under and the server
      // answers 400 for a mismatch, so the mode change has to restart paging.
      const filteredUrl = new URL(urls[2] ?? '')
      expect(filteredUrl.searchParams.get('mode')).toBe('cold_dry')
      expect(filteredUrl.searchParams.get('cursor')).toBeNull()
      expect(filteredUrl.searchParams.get('limit')).toBe('12')
      expect(screen.getByTestId('community-filter-cold_dry')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(posthogMocks.capture).toHaveBeenCalledWith('layout_interaction', {
        action: 'filter_chip_click',
        target: 'cold_dry',
      })
    })

    it('6.1-WEB-013 requests mode=all, the other arm of the beta experiment', async () => {
      signIn()
      const modes: (string | null)[] = []
      useMswHandlers(
        http.get(FEED_PATH, ({ request }) => {
          const mode = new URL(request.url).searchParams.get('mode')
          modes.push(mode)
          return mode === 'all'
            ? feedBody({
                items: [item({ id: 'every-climate-post' })],
                mode: 'all',
                experimentVariant: 'all',
              })
            : feedBody({ items: [item()] })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('community-filter-all'))

      await screen.findByTestId('lookbook-card-every-climate-post')
      expect(modes).toEqual(['auto', 'all'])
      expect(screen.getByTestId('community-filter-all')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    })

    it('6.1-WEB-065 presses the chip the server served, not the one it asked for', async () => {
      signIn()
      const servedModes: string[] = []
      // The `all` arm answering an `auto` request, which is exactly what half the
      // beta cohort receives: `resolveEffectiveMode` swaps `auto` for the
      // viewer's assignment and leaves every other mode alone.
      useMswHandlers(
        feedHandler({
          items: [item()],
          mode: 'all',
          experimentVariant: 'all',
          viewerBand: 'temperate_dry',
        })
      )
      renderGrid({
        onServedModeChange: (mode) => {
          servedModes.push(mode)
        },
      })

      await screen.findByTestId('lookbook-card-post-1')

      expect(screen.getByTestId('community-filter-all')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.getByTestId('community-filter-auto')).toHaveAttribute(
        'aria-pressed',
        'false'
      )
      // The unpressed auto chip's own label, not just its pressed state. It used
      // to read the resolved band unconditionally, so an `all`-arm viewer with a
      // resolved band saw the auto chip promise "Your climate: Temperate and dry"
      // beside the unfiltered feed the `all` chip was actually, correctly, showing.
      // `toHaveTextContent` has no `exact` option in this version -- a plain
      // string argument is always a substring check (`textContent.includes(...)`),
      // which would pass on that exact regression, since "Your climate:
      // Temperate and dry" contains "Your climate". `.textContent` compared with
      // `.toBe` is what actually pins the unqualified label rather than a
      // superstring of it; mutation-tested against the un-gated `modeLabel` call
      // to confirm the substring form does not catch this before landing on this
      // shape.
      expect(screen.getByTestId('community-filter-auto').textContent).toBe('Your climate')
      // The announcement names the feed that arrived. It used to name the request
      // instead, so this reader was told "Showing Your climate: Temperate and dry
      // looks" over a feed carrying every region.
      expect(screen.getByTestId('community-live-region')).toHaveTextContent(
        'Showing Every climate looks. 1 loaded.'
      )
      // `lookbook-prism-layout.tsx` renders a second filter nav outside this
      // component, and only this component sees the response, so the served mode
      // has to travel out the same way the resolved band does.
      await waitFor(() => {
        expect(servedModes).toContain('all')
      })
    })

    it('6.1-WEB-014 reports the chosen filter to its caller', async () => {
      signIn()
      const onTabChange = vi.fn()
      useMswHandlers(feedHandler({ items: [item()] }))
      const user = userEvent.setup()
      renderGrid({ onTabChange })

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('community-filter-warm_dry'))

      expect(onTabChange).toHaveBeenCalledWith('warm_dry')
      expect(screen.getByTestId('community-live-region')).toHaveTextContent(
        'Showing Warm and dry looks.'
      )
    })

    it('6.1-WEB-015 refuses to let an abandoned filter overwrite the current one', async () => {
      signIn()
      let releaseStale = () => undefined as void
      const staleDelivered = new Promise<void>((resolve) => {
        releaseStale = () => {
          resolve()
        }
      })
      useMswHandlers(
        http.get(FEED_PATH, async ({ request }) => {
          const mode = new URL(request.url).searchParams.get('mode') ?? 'auto'
          if (mode === 'cold_dry') {
            await delay(40)
            releaseStale()
            return feedBody({
              items: [item({ id: 'stale-post' })],
              mode: 'cold_dry',
            })
          }
          if (mode === 'warm_wet') {
            return feedBody({ items: [item({ id: 'fresh-post' })], mode: 'warm_wet' })
          }
          return feedBody({ items: [item()] })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('community-filter-cold_dry'))
      await user.click(screen.getByTestId('community-filter-warm_wet'))
      await screen.findByTestId('lookbook-card-fresh-post')

      // Wait until the abandoned filter's own response has been produced. The
      // generation guard, not timing, is what keeps it off the screen.
      await staleDelivered
      await waitFor(() =>
        expect(screen.getByTestId('lookbook-card-fresh-post')).toBeInTheDocument()
      )
      expect(screen.queryByTestId('lookbook-card-stale-post')).not.toBeInTheDocument()
      expect(screen.getByTestId('community-filter-warm_wet')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    })
  })

  describe('keyset paging', () => {
    it('6.1-WEB-016 appends the next page without duplicating a row it already holds', async () => {
      signIn()
      const urls: string[] = []
      useMswHandlers(
        http.get(FEED_PATH, ({ request }) => {
          urls.push(request.url)
          const cursor = new URL(request.url).searchParams.get('cursor')
          return cursor === null
            ? feedBody({
                items: [item(), item({ id: 'post-2' })],
                nextCursor: cursorFor(),
              })
            : feedBody({
                // `post-2` repeats across the page boundary; the merge must not.
                items: [item({ id: 'post-2' }), item({ id: 'post-3' })],
                nextCursor: null,
              })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('load-more-button'))
      await screen.findByTestId('lookbook-card-post-3')

      const grid = screen.getByTestId('community-card-grid')
      expect(within(grid).getAllByRole('article')).toHaveLength(3)
      expect(screen.getAllByTestId('lookbook-card-post-2')).toHaveLength(1)
      expect(new URL(urls[1] ?? '').searchParams.get('cursor')).toBe(cursorFor())
      // The last page carries no cursor, so the control retires.
      expect(screen.queryByTestId('load-more-button')).not.toBeInTheDocument()
    })

    it('6.1-WEB-064 restarts paging silently when the cursor’s band moved mid-scroll', async () => {
      signIn()
      const requests: (string | null)[] = []
      // A cursor minted while the viewer resolved to `cold_dry`, presented after
      // they resolve to something else. Nothing is tampered with: under `auto`
      // the band is recomputed on every request from weather guaranteed fresh
      // for only 60 minutes, so this is what an ordinary scroll across that
      // boundary looks like.
      const staleCursor = cursorFor({ band: 'cold_dry' })
      const freshCursor = cursorFor({ id: 'post-restarted' })
      useMswHandlers(
        http.get(FEED_PATH, ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor')
          requests.push(cursor)
          if (cursor === staleCursor) {
            return errorBody(400, COMMUNITY_CURSOR_INVALID_MESSAGE, 'Bad Request')
          }
          if (cursor === null) {
            return requests.length === 1
              ? feedBody({ items: [item()], nextCursor: staleCursor })
              : feedBody({
                  items: [item({ id: 'post-restarted' })],
                  nextCursor: freshCursor,
                })
          }
          return feedBody({ items: [item({ id: 'post-page-two' })], nextCursor: null })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('load-more-button'))
      await screen.findByTestId('lookbook-card-post-restarted')

      // Page one REPLACES what the grid was holding rather than appending to it:
      // those rows were keyset off a filter the server has stopped serving.
      expect(screen.queryByTestId('lookbook-card-post-1')).not.toBeInTheDocument()
      // The contract's own words for this 400 are "so the client restarts
      // paging". It is a normal operating condition, so it never becomes the
      // whole-feed alert banner over a grid that still holds twelve looks.
      expect(screen.queryByTestId('community-feed-error')).not.toBeInTheDocument()

      // And the recovered cursor is the one that gets used. The dead cursor was
      // previously never cleared, so every further Load more re-sent it.
      await user.click(screen.getByTestId('load-more-button'))
      await screen.findByTestId('lookbook-card-post-page-two')
      expect(requests).toEqual([null, staleCursor, null, freshCursor])
    })

    it('6.1-WEB-057 does not double-request the next page on a second click', async () => {
      signIn()
      let calls = 0
      useMswHandlers(
        http.get(FEED_PATH, async ({ request }) => {
          calls += 1
          const cursor = new URL(request.url).searchParams.get('cursor')
          if (cursor === null) {
            return feedBody({ items: [item()], nextCursor: cursorFor() })
          }
          await delay(30)
          return feedBody({ items: [item({ id: 'post-2' })] })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      const control = screen.getByTestId('load-more-button')
      await user.click(control)
      // A second read on the same cursor would fetch the same page twice. The
      // control is disabled while the first is in flight, so the click lands on
      // nothing; `handleLoadMore`'s own `!isLoadingMore` guard is the second lock.
      fireEvent.click(control)

      await screen.findByTestId('lookbook-card-post-2')
      expect(calls).toBe(2)
    })

    it('6.1-WEB-017 disables the load-more control while the next page is in flight', async () => {
      signIn()
      useMswHandlers(
        http.get(FEED_PATH, async ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor')
          if (cursor === null) {
            return feedBody({ items: [item()], nextCursor: cursorFor() })
          }
          await delay(30)
          return feedBody({ items: [item({ id: 'post-2' })] })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('load-more-button'))

      const control = screen.getByTestId('load-more-button')
      expect(control).toBeDisabled()
      expect(control).toHaveTextContent('Loading')

      await screen.findByTestId('lookbook-card-post-2')
      expect(screen.getByTestId('community-live-region')).toHaveTextContent(
        'Loaded 1 more looks.'
      )
    })
  })

  describe('card open', () => {
    it('6.1-WEB-066 records the open with the arm this client was serving', async () => {
      signIn()
      const opened: { postId: string; platform: string | null; body: unknown }[] = []
      // A pinned band with the `all` arm. The mode a reader chose and the arm
      // they were assigned are independent -- `resolveEffectiveMode` only
      // overrides `auto` -- so this is the response that proves the event carries
      // the arm rather than the filter.
      useMswHandlers(
        feedHandler({ items: [item()], mode: 'cold_dry', experimentVariant: 'all' }),
        http.post(OPENED_PATH, async ({ request, params }) => {
          opened.push({
            postId: String(params.postId),
            platform: request.headers.get('x-couture-platform'),
            body: await request.json(),
          })
          return HttpResponse.json({ tracked: true })
        })
      )
      const user = userEvent.setup()
      renderGrid({ activeTab: 'cold_dry' })

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('lookbook-open-post-1'))

      await waitFor(() => {
        expect(opened).toHaveLength(1)
      })
      expect(opened[0]?.postId).toBe('post-1')
      expect(opened[0]?.platform).toBe('web')
      // The WHOLE body, not just the one field. `openCommunityPostInputSchema` is
      // `.strict()` and the server decides `isSelf` from the stored author id, so
      // a client that helpfully sent its own would be rejected outright rather
      // than ignored.
      expect(opened[0]?.body).toEqual({ experimentVariant: 'all' })
    })

    it('6.1-WEB-067 opens the look whole, with the caption the grid clamps', async () => {
      signIn()
      useMswHandlers(
        feedHandler({ items: [item()] }),
        http.post(OPENED_PATH, () => HttpResponse.json({ tracked: true }))
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('lookbook-open-post-1'))

      const detail = await screen.findByTestId('community-detail')
      expect(
        within(detail).getByAltText(
          'A charcoal wool coat over a cream knit, with black ankle boots.'
        )
      ).toBeInTheDocument()
      expect(screen.getByTestId('community-detail-caption')).toHaveTextContent(
        'Layered wool over a merino base for a damp commute.'
      )
      expect(screen.getByTestId('community-detail-author')).toHaveTextContent(
        'Style Explorer 4F2A'
      )
      expect(screen.getByTestId('community-detail-band-post-1')).toHaveTextContent(
        'Temperate and wet'
      )
    })

    it('6.1-WEB-068 still opens the look when the open cannot be recorded', async () => {
      signIn()
      useMswHandlers(
        feedHandler({ items: [item()] }),
        http.post(OPENED_PATH, () => new HttpResponse(null, { status: 500 }))
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('lookbook-open-post-1'))

      // This route is measurement. A reader must not be kept from a photograph
      // because the beta gate's counter is down.
      expect(await screen.findByTestId('community-detail')).toBeInTheDocument()
      expect(screen.queryByTestId('community-feed-error')).not.toBeInTheDocument()
      expect(screen.queryByTestId('community-action-notice')).not.toBeInTheDocument()
    })

    it('6.1-WEB-069 has no axe violations with a look open', async () => {
      signIn()
      useMswHandlers(
        feedHandler({ items: [item()] }),
        http.post(OPENED_PATH, () => HttpResponse.json({ tracked: true }))
      )
      const user = userEvent.setup()
      const { container } = renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('lookbook-open-post-1'))
      await screen.findByTestId('community-detail')

      const results = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      })
      expect(
        results.violations.map((violation) => violation.id),
        JSON.stringify(results.violations, null, 2)
      ).toEqual([])
    })
  })

  describe('author states', () => {
    const states = [
      authorState({ id: 'as-pending', status: 'pending_review' }),
      authorState({
        id: 'as-flagged',
        status: 'flagged',
        moderationReason: 'Nudity detected by automated screening.',
        caption: 'A look that did not clear screening.',
      }),
      authorState({ id: 'as-review-failed', status: 'review_failed' }),
      authorState({ id: 'as-withdrawn', status: 'withdrawn' }),
      authorState({ id: 'as-consent', status: 'consent_suspended' }),
    ]

    it('6.1-WEB-018 renders the caller’s own posts in their own section, outside the grid', async () => {
      signIn()
      useMswHandlers(feedHandler({ items: [item()], authorStates: states }))
      renderGrid()

      const section = await screen.findByTestId('community-author-states')
      expect(section).toHaveTextContent('Your looks in progress')
      expect(section).toHaveTextContent(
        'Only you can see these until screening finishes.'
      )

      // `items` is published rows only; author states never join the card grid.
      const grid = screen.getByTestId('community-card-grid')
      expect(within(grid).getAllByRole('article')).toHaveLength(1)
      for (const state of states) {
        expect(
          within(grid).queryByTestId(`author-state-${state.id}`)
        ).not.toBeInTheDocument()
        expect(
          within(section).getByTestId(`author-state-${state.id}`)
        ).toBeInTheDocument()
      }
    })

    it('6.1-WEB-019 gives every author state a localized status badge', async () => {
      signIn()
      useMswHandlers(feedHandler({ authorStates: states }))
      renderGrid()

      const section = await screen.findByTestId('community-author-states')
      expect(within(section).getByTestId('status-badge-as-pending')).toHaveTextContent(
        STATUS_COPY.pending_review
      )
      expect(within(section).getByTestId('status-badge-as-flagged')).toHaveTextContent(
        STATUS_COPY.flagged
      )
      expect(
        within(section).getByTestId('status-badge-as-review-failed')
      ).toHaveTextContent(STATUS_COPY.review_failed)
      expect(within(section).getByTestId('status-badge-as-withdrawn')).toHaveTextContent(
        STATUS_COPY.withdrawn
      )
      expect(within(section).getByTestId('status-badge-as-consent')).toHaveTextContent(
        STATUS_COPY.consent_suspended
      )

      // The predecessor printed `status.replace('_', ' ')`, untranslated.
      for (const raw of ['review failed', 'consent suspended', 'pending review']) {
        expect(within(section).queryByText(raw)).not.toBeInTheDocument()
      }
    })

    it('6.1-WEB-020 explains each removed status and shows the moderation reason', async () => {
      signIn()
      useMswHandlers(feedHandler({ authorStates: states }))
      renderGrid()

      const section = await screen.findByTestId('community-author-states')
      expect(
        within(section).getByTestId('author-state-explanation-as-flagged')
      ).toHaveTextContent(REMOVED_COPY.flagged)
      expect(
        within(section).getByTestId('author-state-explanation-as-review-failed')
      ).toHaveTextContent(REMOVED_COPY.review_failed)
      expect(
        within(section).getByTestId('author-state-explanation-as-withdrawn')
      ).toHaveTextContent(REMOVED_COPY.withdrawn)
      expect(
        within(section).getByTestId('author-state-explanation-as-consent')
      ).toHaveTextContent(REMOVED_COPY.consent_suspended)
      expect(
        within(section).getByTestId('author-state-reason-as-flagged')
      ).toHaveTextContent('Reason: Nudity detected by automated screening.')
      expect(
        within(section).getByTestId('author-state-caption-as-flagged')
      ).toHaveTextContent('A look that did not clear screening.')

      // `pending_review` is not a removal, so it carries no removal explanation.
      expect(
        within(section).queryByTestId('author-state-explanation-as-pending')
      ).not.toBeInTheDocument()
      expect(
        within(section).queryByTestId('author-state-reason-as-pending')
      ).not.toBeInTheDocument()
    })

    it('6.1-WEB-021 renders flagged content in deep merlot rather than success gold', async () => {
      signIn()
      useMswHandlers(feedHandler({ authorStates: states }))
      renderGrid()

      const badge = await screen.findByTestId('status-badge-as-flagged')
      expect(badge).toHaveStyle({ color: MERLOT, borderColor: MERLOT })
      expect(badge).not.toHaveStyle({ color: GOLD })
      expect(screen.getByTestId('author-state-explanation-as-flagged')).toHaveStyle({
        color: MERLOT,
      })
      // Merlot is reserved for the destructive state, so a withdrawal is neutral.
      expect(screen.getByTestId('status-badge-as-withdrawn')).not.toHaveStyle({
        color: MERLOT,
      })
    })

    it('6.1-WEB-022 badges a non-published row inside the grid too', async () => {
      signIn()
      useMswHandlers(
        feedHandler({ items: [item({ status: 'consent_suspended', climateBand: null })] })
      )
      renderGrid()

      expect(await screen.findByTestId('status-badge-post-1')).toHaveTextContent(
        STATUS_COPY.consent_suspended
      )
      expect(screen.getByTestId('climate-badge-post-1')).toHaveTextContent('All weather')
      expect(communityPostStatusSchema.options).toContain('consent_suspended')
    })
  })

  describe('report', () => {
    it('6.1-WEB-023 submits a report, settles the control and confirms visibly', async () => {
      signIn()
      let reportedId: string | undefined
      let reportPayload: unknown
      useMswHandlers(
        feedHandler({ items: [item()] }),
        http.post(REPORT_PATH, async ({ request, params }) => {
          reportedId = String(params.postId)
          reportPayload = await request.json()
          return HttpResponse.json({ tracked: true })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('report-button-post-1'))
      await user.selectOptions(
        await screen.findByTestId('report-reason-select'),
        'harassment'
      )
      await user.type(
        screen.getByTestId('report-details-input'),
        'Targeted abuse in the caption.'
      )
      await user.click(screen.getByTestId('report-submit-button'))

      await waitFor(() =>
        expect(screen.queryByTestId('report-reason-select')).not.toBeInTheDocument()
      )
      const control = screen.getByTestId('report-button-post-1')
      expect(control).toBeDisabled()
      expect(control).toHaveTextContent('Reported')

      const notice = screen.getByTestId('community-action-notice')
      expect(notice).toHaveAttribute('data-tone', 'success')
      expect(notice).toHaveTextContent('Thank you. A moderator will review this look.')
      // Visible, not only announced: the previous version put every one of these
      // into the sr-only region alone.
      expect(notice).not.toBe(screen.getByTestId('community-live-region'))
      expect(notice).not.toHaveClass('sr-only')
      expect(screen.getByTestId('community-live-region')).toHaveTextContent(
        'Thank you. A moderator will review this look.'
      )

      expect(reportedId).toBe('post-1')
      expect(reportPayload).toEqual({
        reason: 'harassment',
        details: 'Targeted abuse in the caption.',
      })
    })

    /**
     * A duplicate report of the SAME reason is a 200, not a conflict:
     * `community.repository.ts` replays the stored row, and its P2002 race
     * resolves the same way. So the second submission settles exactly like the
     * first, and there is no `already_reported` state to render: the client
     * carried one until the constant behind it turned out to be thrown by
     * nothing. A CHANGED reason is the only 409 a reporter can provoke, and
     * `6.1-WEB-026` covers it.
     */
    it('6.1-WEB-024 settles the control when a duplicate report replays', async () => {
      signIn()
      let reportCalls = 0
      useMswHandlers(
        feedHandler({ items: [item()] }),
        http.post(REPORT_PATH, () => {
          reportCalls += 1
          return HttpResponse.json({ tracked: true })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('report-button-post-1'))
      await user.click(await screen.findByTestId('report-submit-button'))

      await waitFor(() =>
        expect(screen.queryByTestId('report-reason-select')).not.toBeInTheDocument()
      )
      const control = screen.getByTestId('report-button-post-1')
      expect(control).toBeDisabled()
      expect(control).toHaveTextContent('Reported')
      expect(screen.getByTestId('community-action-notice')).toHaveAttribute(
        'data-tone',
        'success'
      )

      // The settled control is what makes a second submission impossible, so a
      // second click must reach no network at all.
      await user.click(control)
      expect(screen.queryByTestId('report-reason-select')).not.toBeInTheDocument()
      expect(reportCalls).toBe(1)
    })

    it('6.1-WEB-025 keeps the modal open on a rate limit and renders catalog copy', async () => {
      signIn()
      useMswHandlers(
        feedHandler({ items: [item()] }),
        http.post(REPORT_PATH, () =>
          errorBody(429, COMMUNITY_POST_RATE_LIMITED_MESSAGE, 'Too Many Requests')
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('report-button-post-1'))
      await user.click(await screen.findByTestId('report-submit-button'))

      const error = await screen.findByTestId('report-error-message')
      expect(error).toHaveTextContent("You have reached today's limit of ten looks.")
      expect(error).not.toHaveTextContent('Try again after')
      // Never the server's own English.
      expect(error).not.toHaveTextContent(COMMUNITY_POST_RATE_LIMITED_MESSAGE)
      expect(screen.getByTestId('report-reason-select')).toBeInTheDocument()
      expect(screen.getByTestId('report-button-post-1')).toBeEnabled()
    })

    /**
     * The self-report row is 403, not 409, because `community.service.ts` throws
     * it as a `ForbiddenException`. The first draft of the client classified it
     * under 409, which left `self_report` and its catalog string unreachable and
     * made reporting your own post read "We could not send your report."
     * The unrecognised-status rows below hold the fallback in place, so a new
     * server message on either status surfaces as generic copy rather than as
     * the server's untranslated English.
     */
    it.each([
      [
        409,
        COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
        'Conflict',
        'You already reported this look for a different reason.',
      ],
      [
        403,
        COMMUNITY_SELF_REPORT_MESSAGE,
        'Forbidden',
        'You cannot report your own look.',
      ],
      [
        404,
        COMMUNITY_POST_NOT_FOUND_MESSAGE,
        'Not Found',
        'This look is no longer available.',
      ],
      [409, 'Some other conflict.', 'Conflict', 'We could not send your report.'],
      [403, 'Some other refusal.', 'Forbidden', 'We could not send your report.'],
    ])(
      '6.1-WEB-026 maps a %s report failure onto its own catalog string',
      async (status, message, error, expected) => {
        signIn()
        useMswHandlers(
          feedHandler({ items: [item()] }),
          http.post(REPORT_PATH, () => errorBody(status, message, error))
        )
        const user = userEvent.setup()
        renderGrid()

        await screen.findByTestId('lookbook-card-post-1')
        await user.click(screen.getByTestId('report-button-post-1'))
        await user.click(await screen.findByTestId('report-submit-button'))

        const banner = await screen.findByTestId('report-error-message')
        expect(banner).toHaveTextContent(expected)
        expect(banner).not.toHaveTextContent(message)
      }
    )

    it('6.1-WEB-027 closes the report modal without submitting', async () => {
      signIn()
      let reportCalls = 0
      useMswHandlers(
        feedHandler({ items: [item()] }),
        http.post(REPORT_PATH, () => {
          reportCalls += 1
          return HttpResponse.json({ tracked: true })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('report-button-post-1'))
      await user.click(await screen.findByRole('button', { name: 'Cancel' }))

      expect(screen.queryByTestId('report-reason-select')).not.toBeInTheDocument()
      expect(reportCalls).toBe(0)
      expect(screen.getByTestId('report-button-post-1')).toBeEnabled()
    })
  })

  describe('withdraw', () => {
    const selfPost = item({
      id: 'self-post',
      author: { displayName: 'You', isSelf: true },
    })

    it('6.1-WEB-028 offers Withdraw and no Report on the caller’s own post', async () => {
      signIn()
      useMswHandlers(feedHandler({ items: [selfPost, item()] }))
      renderGrid()

      await screen.findByTestId('lookbook-card-self-post')
      expect(screen.getByTestId('withdraw-button-self-post')).toBeInTheDocument()
      // Reporting your own post is a 403 the server refuses; the CTA row shows
      // exactly one moderation affordance.
      expect(screen.queryByTestId('report-button-self-post')).not.toBeInTheDocument()
      // 'You' is three characters and a substring of plenty of display names, so the
      // substring-matching toHaveTextContent would still pass if the self-label regressed.
      expect(screen.getByTestId('author-name-self-post').textContent).toBe('You')

      expect(screen.getByTestId('report-button-post-1')).toBeInTheDocument()
      expect(screen.queryByTestId('withdraw-button-post-1')).not.toBeInTheDocument()
    })

    it('6.1-WEB-029 withdraws, confirms visibly and re-reads the feed', async () => {
      signIn()
      let feedCalls = 0
      let withdrawnId: string | undefined
      useMswHandlers(
        http.get(FEED_PATH, () => {
          feedCalls += 1
          return feedCalls === 1
            ? feedBody({ items: [selfPost] })
            : feedBody({
                items: [],
                authorStates: [authorState({ id: 'self-post', status: 'withdrawn' })],
              })
        }),
        http.post(WITHDRAW_PATH, ({ params }) => {
          withdrawnId = String(params.postId)
          return HttpResponse.json({ tracked: true })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-self-post')
      await user.click(screen.getByTestId('withdraw-button-self-post'))

      const notice = await screen.findByTestId('community-action-notice')
      expect(notice).toHaveAttribute('data-tone', 'success')
      expect(notice).toHaveTextContent(REMOVED_COPY.withdrawn)
      expect(withdrawnId).toBe('self-post')

      // No optimistic removal: the row moves to `authorStates` on the next read.
      await waitFor(() => expect(feedCalls).toBe(2))
      await waitFor(() =>
        expect(screen.queryByTestId('lookbook-card-self-post')).not.toBeInTheDocument()
      )
      expect(await screen.findByTestId('author-state-self-post')).toBeInTheDocument()
    })

    it('6.1-WEB-030 says the look is still in the feed when the withdraw fails', async () => {
      signIn()
      let feedCalls = 0
      useMswHandlers(
        http.get(FEED_PATH, () => {
          feedCalls += 1
          return feedBody({ items: [selfPost] })
        }),
        http.post(WITHDRAW_PATH, () =>
          errorBody(500, 'withdraw transaction rolled back', 'Internal Server Error')
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('lookbook-card-self-post')
      await user.click(screen.getByTestId('withdraw-button-self-post'))

      const notice = await screen.findByTestId('community-action-notice')
      expect(notice).toHaveAttribute('data-tone', 'error')
      expect(notice).toHaveTextContent(
        'We could not withdraw this look. It is still in the feed.'
      )
      expect(notice).toHaveStyle({ color: MERLOT })
      expect(notice).not.toHaveTextContent('withdraw transaction rolled back')
      expect(screen.getByTestId('lookbook-card-self-post')).toBeInTheDocument()
      expect(feedCalls).toBe(1)
    })
  })

  describe('compose', () => {
    let restoreObjectUrl = () => undefined as void

    afterEach(() => {
      restoreObjectUrl()
      restoreObjectUrl = () => undefined
    })

    it('6.1-WEB-031 publishes a confirmed, server-suggested description under one idempotency key', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      let allocateKey: string | null = null
      let publishKey: string | null = null
      let allocatePayload: unknown
      let publishPayload: unknown
      let publishCalls = 0
      let feedCalls = 0
      useMswHandlers(
        http.get(FEED_PATH, () => {
          feedCalls += 1
          return feedBody()
        }),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, async ({ request }) => {
          allocateKey = request.headers.get('Idempotency-Key')
          allocatePayload = await request.json()
          return allocateBody()
        }),
        http.post(PUBLISH_PATH, async ({ request }) => {
          publishCalls += 1
          publishKey = request.headers.get('Idempotency-Key')
          publishPayload = await request.json()
          return publishBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('community-feed-empty')
      await user.click(screen.getByTestId('create-post-button'))
      await choosePhoto(user)

      // The suggestion is server-generated and lands in an editable field.
      const altInput = await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      expect(altInput).toBe(screen.getByTestId('post-alt-text-input'))
      expect(screen.getByTestId('post-image-preview')).toHaveAttribute(
        'src',
        FIXTURE_IMAGE_URL
      )

      const publish = screen.getByTestId('post-publish-submit')
      expect(publish).toBeDisabled()

      await user.type(altInput, ' Shot on a rainy street.')
      // Editing the description withdraws the confirmation, so the gate holds.
      expect(screen.getByTestId('confirm-alt-text-checkbox')).not.toBeChecked()
      expect(publish).toBeDisabled()

      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      expect(publish).toBeEnabled()
      await user.click(publish)

      await waitFor(() => expect(publishCalls).toBe(1))
      expect(publishPayload).toEqual({
        postId: 'mock-allocated-post-id',
        uploadSessionId: 'mock-upload-session-id',
        altText: `${SUGGESTED_ALT_TEXT} Shot on a rainy street.`,
        altTextConfirmed: true,
        caption: null,
        locale: 'en-US',
      })
      expect(allocatePayload).toMatchObject({
        locale: 'en-US',
        contentType: 'image/jpeg',
      })
      // One attempt, one key: minting a fresh key on publish would allocate a
      // second upload session instead of replaying the first.
      expect(allocateKey).toEqual(expect.any(String))
      expect(publishKey).toBe(allocateKey)

      expect(screen.queryByTestId('post-alt-text-input')).not.toBeInTheDocument()
      const notice = await screen.findByTestId('community-action-notice')
      expect(notice).toHaveAttribute('data-tone', 'success')
      expect(notice).toHaveTextContent('Your look was submitted for review.')
      // The new post is `pending_review`, so the grid re-reads rather than
      // inserting it locally.
      await waitFor(() => expect(feedCalls).toBe(2))
    })

    it('6.1-WEB-058 sends a trimmed caption and keeps it out of the alt text', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      let publishPayload: unknown
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody()),
        http.post(PUBLISH_PATH, async ({ request }) => {
          publishPayload = await request.json()
          return publishBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      await user.type(
        screen.getByTestId('post-caption-input'),
        '  Wool over merino, worth the extra layer.  '
      )
      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      await user.click(screen.getByTestId('post-publish-submit'))

      await waitFor(() => expect(publishPayload).toBeDefined())
      expect(publishPayload).toMatchObject({
        caption: 'Wool over merino, worth the extra layer.',
        altText: SUGGESTED_ALT_TEXT,
      })
    })

    it('6.1-WEB-032 publishes in the locale the reader actually resolved to', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      const originalLanguages = Object.getOwnPropertyDescriptor(
        window.navigator,
        'languages'
      )
      let allocatePayload: unknown
      let publishPayload: unknown
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, async ({ request }) => {
          allocatePayload = await request.json()
          return allocateBody()
        }),
        http.post(PUBLISH_PATH, async ({ request }) => {
          publishPayload = await request.json()
          return publishBody()
        })
      )

      try {
        Object.defineProperty(window.navigator, 'languages', {
          configurable: true,
          get: () => ['fr-FR'],
        })
        await getI18n().changeLanguage('fr-FR')

        const user = userEvent.setup()
        renderGrid()

        await screen.findByTestId('create-post-button')
        await user.click(screen.getByTestId('create-post-button'))
        await choosePhoto(user)
        await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
        await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
        await user.click(screen.getByTestId('post-publish-submit'))

        await waitFor(() => expect(publishPayload).toBeDefined())
        // A hardcoded `en-US` would screen a French caption against the wrong
        // catalog and generate the suggestion in the wrong language.
        expect(allocatePayload).toMatchObject({ locale: 'fr-FR' })
        expect(publishPayload).toMatchObject({ locale: 'fr-FR', altTextConfirmed: true })
      } finally {
        if (originalLanguages) {
          Object.defineProperty(window.navigator, 'languages', originalLanguages)
        }
        await getI18n().changeLanguage('en-US')
      }
    })

    it('6.1-WEB-033 rejects a caption with a link or an email, and clears once it is clean', async () => {
      signIn()
      useMswHandlers(feedHandler())
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      const caption = await screen.findByTestId('post-caption-input')

      await user.type(caption, 'Shop it at https://example.com')
      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'The caption cannot contain links.'
      )

      await user.clear(caption)
      await user.type(caption, 'Reach me at style@example.com')
      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'The caption cannot contain email addresses.'
      )

      await user.clear(caption)
      await user.type(caption, 'Wool over merino, worth the extra layer.')
      await waitFor(() =>
        expect(screen.queryByTestId('create-post-error')).not.toBeInTheDocument()
      )
    })

    it('6.1-WEB-034 rejects a caption over the contract’s 280-character ceiling', async () => {
      signIn()
      useMswHandlers(feedHandler())
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      const caption = await screen.findByTestId('post-caption-input')
      // `maxLength` stops a typist; a paste or an autofill does not, and the
      // contract's own schema is what decides.
      fireEvent.change(caption, { target: { value: 'w'.repeat(281) } })

      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'Keep the caption to 280 characters or fewer.'
      )
    })

    it('6.1-WEB-035 names the gate the author has not cleared yet', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody())
      )
      const user = userEvent.setup()
      const { container } = renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      const form = container.querySelector('form')
      expect(form).not.toBeNull()

      fireEvent.submit(form as HTMLFormElement)
      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'Choose a photo to share.'
      )

      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)

      await user.clear(screen.getByTestId('post-alt-text-input'))
      fireEvent.submit(form as HTMLFormElement)
      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'Add an image description.'
      )

      await user.type(
        screen.getByTestId('post-alt-text-input'),
        'A wool coat over denim.'
      )
      fireEvent.submit(form as HTMLFormElement)
      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'Confirm the image description before publishing.'
      )
    })

    it('6.1-WEB-036 aborts the publish when the byte upload fails', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      let allocateCalls = 0
      let publishCalls = 0
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => {
          allocateCalls += 1
          return allocateBody()
        }),
        http.put(UPLOAD_URL, () => new HttpResponse(null, { status: 500 })),
        http.post(PUBLISH_PATH, () => {
          publishCalls += 1
          return publishBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)

      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'Your photo could not be uploaded, so nothing was published. Try again.'
      )
      // A post whose object was never written renders as a permanently broken
      // card that moderation cannot screen, so nothing is published.
      expect(allocateCalls).toBe(1)
      expect(publishCalls).toBe(0)
      expect(screen.getByTestId('post-publish-submit')).toBeDisabled()
      expect(screen.queryByDisplayValue(SUGGESTED_ALT_TEXT)).not.toBeInTheDocument()
    })

    /**
     * The 256px floor is enforced client-side, before an upload session is
     * allocated, and it says WHY rather than falling back to the generic upload
     * copy: it is the one prepare failure the reader can act on. The first draft
     * classified it `unknown`, which left `community.validation.imageTooSmall`
     * shipping in all ten catalogs and never rendering.
     */
    it('6.1-WEB-037 rejects a photo under the 256px floor before allocating anything', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks({ widthPx: 120, heightPx: 160 })
      let allocateCalls = 0
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => {
          allocateCalls += 1
          return allocateBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)

      expect(await screen.findByTestId('create-post-error')).toHaveTextContent(
        'Choose an image at least 256 pixels wide and tall.'
      )
      expect(allocateCalls).toBe(0)
      expect(screen.getByTestId('post-publish-submit')).toBeDisabled()
    })

    it('6.1-WEB-038 names the time posting reopens when the 429 carried Retry-After', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () =>
          errorBody(429, COMMUNITY_POST_RATE_LIMITED_MESSAGE, 'Too Many Requests', {
            headers: { 'Retry-After': '900' },
          })
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)

      const error = await screen.findByTestId('create-post-error')
      expect(error).toHaveTextContent("You have reached today's limit of ten looks.")
      expect(error).toHaveTextContent(/Try again after \d{1,2}:\d{2}/)
      expect(error).not.toHaveTextContent(COMMUNITY_POST_RATE_LIMITED_MESSAGE)
    })

    it('6.1-WEB-039 falls back to the plain limit message without a usable Retry-After', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () =>
          errorBody(429, COMMUNITY_POST_RATE_LIMITED_MESSAGE, 'Too Many Requests', {
            // Not delta-seconds, so it is dropped rather than rendered raw.
            headers: { 'Retry-After': 'tomorrow' },
          })
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)

      const error = await screen.findByTestId('create-post-error')
      expect(error).toHaveTextContent("You have reached today's limit of ten looks.")
      expect(error).not.toHaveTextContent('Try again after')
    })

    it('6.1-WEB-040 refuses an under-age author with the age-gate message', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () =>
          errorBody(403, COMMUNITY_AGE_GATE_DENIED_MESSAGE, 'Forbidden')
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)

      const error = await screen.findByTestId('create-post-error')
      expect(error).toHaveTextContent(
        'You need to be at least 13 to post to the community.'
      )
      expect(error).not.toHaveTextContent(COMMUNITY_AGE_GATE_DENIED_MESSAGE)
    })

    it('6.1-WEB-041 explains a refused publish without leaking the server message', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody()),
        http.post(
          PUBLISH_PATH,
          () => new HttpResponse('upstream moderation queue unavailable', { status: 500 })
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      await user.click(screen.getByTestId('post-publish-submit'))

      const error = await screen.findByTestId('create-post-error')
      expect(error).toHaveTextContent('We could not publish your look.')
      expect(error).not.toHaveTextContent('upstream moderation queue unavailable')
    })

    it('6.1-WEB-073 names a look the storage layer cannot serve back', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody()),
        // `requireFeedItem` raises this AFTER the state transition has committed:
        // the look is published and it is our own signed URL that failed. That
        // makes "We could not publish your look", the generic fallback this used
        // to land on, the one sentence that was not true.
        http.post(PUBLISH_PATH, () =>
          errorBody(503, COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE, 'Service Unavailable')
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      await user.click(screen.getByTestId('post-publish-submit'))

      const error = await screen.findByTestId('create-post-error')
      expect(error).toHaveTextContent(
        'This look is temporarily unavailable. Try again shortly.'
      )
      // Not the kill-switch copy: the two 503s share a status and mean opposite
      // things, and telling this author the whole community is switched off would
      // send them away rather than back.
      expect(error).not.toHaveTextContent(
        'The community feed is temporarily unavailable.'
      )
      expect(error).not.toHaveTextContent(COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE)
    })

    it('6.1-WEB-060 does nothing when the file chooser is dismissed without a file', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      let allocateCalls = 0
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => {
          allocateCalls += 1
          return allocateBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await user.upload(screen.getByTestId('post-image-file-input'), [])

      expect(allocateCalls).toBe(0)
      expect(screen.queryByTestId('create-post-error')).not.toBeInTheDocument()
      expect(screen.queryByTestId('post-image-preview')).not.toBeInTheDocument()

      // Closing with nothing chosen has no object URL to release.
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByTestId('post-alt-text-input')).not.toBeInTheDocument()
    })

    it('6.1-WEB-061 releases the previous preview when a second photo is chosen', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      const secondPreview = 'http://localhost/community-fixture-2.jpg'
      const previews = [FIXTURE_IMAGE_URL, secondPreview]
      let issued = 0
      const revoked: string[] = []
      URL.createObjectURL = (() => {
        const url = previews[issued] ?? secondPreview
        issued += 1
        return url
      }) as typeof URL.createObjectURL
      URL.revokeObjectURL = ((url: string) => {
        revoked.push(url)
      }) as typeof URL.revokeObjectURL
      useMswHandlers(
        feedHandler(),
        // Both previews read back the same fixture bytes; the object URL is the
        // only local handle on the image, and the first one has to be released.
        imageFixtureHandler(),
        http.get(secondPreview, () =>
          HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3, 4]).buffer, {
            headers: { 'Content-Type': 'image/jpeg' },
          })
        ),
        http.post(ALLOCATE_PATH, () => allocateBody())
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      await user.upload(
        screen.getByTestId('post-image-file-input'),
        new File(['second-look-bytes'], 'second.jpg', { type: 'image/jpeg' })
      )

      await waitFor(() =>
        expect(screen.getByTestId('post-image-preview')).toHaveAttribute(
          'src',
          secondPreview
        )
      )
      expect(revoked).toContain(FIXTURE_IMAGE_URL)
    })

    it('6.1-WEB-042 cancels the compose modal and releases the photo it was holding', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      const revoked: string[] = []
      URL.revokeObjectURL = ((url: string) => {
        revoked.push(url)
      }) as typeof URL.revokeObjectURL
      useMswHandlers(
        feedHandler(),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody())
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByTestId('post-alt-text-input')).not.toBeInTheDocument()
      expect(revoked).toContain(FIXTURE_IMAGE_URL)
    })
  })

  describe('weekly challenge', () => {
    let restoreObjectUrl = () => undefined as void

    afterEach(() => {
      restoreObjectUrl()
      restoreObjectUrl = () => undefined
    })

    it('6.1-WEB-043 offers the active challenge and carries it onto the published look', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      let publishPayload: unknown
      useMswHandlers(
        feedHandler({ activeChallenge: CHALLENGE }),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody()),
        http.post(PUBLISH_PATH, async ({ request }) => {
          publishPayload = await request.json()
          return publishBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()

      const banner = await screen.findByTestId('weekly-challenge-banner')
      expect(banner).toHaveTextContent('Weekly style challenge')
      expect(banner).toHaveTextContent(CHALLENGE.title)
      expect(banner).toHaveTextContent(CHALLENGE.body)
      expect(screen.getByTestId('challenge-climate-band')).toHaveTextContent(
        'Temperate and wet'
      )

      await user.click(screen.getByTestId('challenge-participate-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      expect(screen.getByTestId('post-challenge-select')).toHaveValue(CHALLENGE.id)
      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      await user.click(screen.getByTestId('post-publish-submit'))

      await waitFor(() => expect(publishPayload).toBeDefined())
      expect(publishPayload).toMatchObject({ challengeId: CHALLENGE.id })
    })

    it('6.1-WEB-062 lets the author opt out of the active challenge', async () => {
      signIn()
      restoreObjectUrl = installImagePrepMocks()
      let publishPayload: unknown
      useMswHandlers(
        feedHandler({ activeChallenge: CHALLENGE }),
        imageFixtureHandler(),
        http.post(ALLOCATE_PATH, () => allocateBody()),
        http.post(PUBLISH_PATH, async ({ request }) => {
          publishPayload = await request.json()
          return publishBody()
        })
      )
      const user = userEvent.setup()
      renderGrid()

      await user.click(await screen.findByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      await user.selectOptions(screen.getByTestId('post-challenge-select'), '')
      await user.click(screen.getByTestId('confirm-alt-text-checkbox'))
      await user.click(screen.getByTestId('post-publish-submit'))

      await waitFor(() => expect(publishPayload).toBeDefined())
      // `challengeId` is omitted rather than sent as null: the contract makes it
      // an optional non-empty string.
      expect(publishPayload).not.toHaveProperty('challengeId')
    })

    it('6.1-WEB-044 labels an unrestricted challenge as open to every climate', async () => {
      signIn()
      useMswHandlers(
        feedHandler({ activeChallenge: { ...CHALLENGE, climateBand: null } })
      )
      renderGrid()

      expect(await screen.findByTestId('challenge-climate-band')).toHaveTextContent(
        'Every climate'
      )
    })
  })

  describe('image access', () => {
    it('6.1-WEB-045 replaces an unusable image with an explanation and a retry control', async () => {
      signIn()
      let feedCalls = 0
      useMswHandlers(
        http.get(FEED_PATH, () => {
          feedCalls += 1
          return feedBody({ items: [item()] })
        })
      )
      renderGrid()

      const surface = await screen.findByTestId('lookbook-image-post-1')
      const image = surface.querySelector('img')
      expect(image).not.toBeNull()
      fireEvent.error(image as HTMLImageElement)

      const fallback = await screen.findByTestId('image-unavailable-post-1')
      expect(fallback).toHaveTextContent('Image unavailable')
      expect(screen.getByTestId('image-retry-button-post-1')).toHaveTextContent(
        'Reload image'
      )
      // Unmounted, not hidden: a hidden `<img>` keeps retrying the dead object.
      expect(screen.getByTestId('lookbook-image-post-1').querySelector('img')).toBeNull()
      // And nothing to open: a card whose object will not load has no look to
      // show, so it offers reload where it would otherwise offer the open.
      expect(screen.queryByTestId('lookbook-open-post-1')).not.toBeInTheDocument()

      // The automatic chase re-read the feed and got the same dead URL back, so
      // the card stays on its manual control.
      await waitFor(() => expect(feedCalls).toBe(2))
      expect(screen.getByTestId('image-unavailable-post-1')).toBeInTheDocument()
    })

    it('6.1-WEB-046 clears the failure when the feed hands back a fresh signed URL', async () => {
      signIn()
      let feedCalls = 0
      useMswHandlers(
        http.get(FEED_PATH, () => {
          feedCalls += 1
          return feedBody({
            items: [
              item({
                imageAccess: {
                  url: feedCalls === 1 ? IMAGE_URL : REFRESHED_IMAGE_URL,
                  expiresAt: isoIn(3600),
                },
              }),
            ],
          })
        })
      )
      renderGrid()

      const surface = await screen.findByTestId('lookbook-image-post-1')
      fireEvent.error(surface.querySelector('img') as HTMLImageElement)

      await waitFor(() => expect(feedCalls).toBe(2))
      // The predecessor added the id to a set before the refetch and never
      // cleared it, so a recovered card read "Image unavailable" all session.
      await waitFor(() =>
        expect(screen.queryByTestId('image-unavailable-post-1')).not.toBeInTheDocument()
      )
      expect(
        screen.getByTestId('lookbook-image-post-1').querySelector('img')
      ).toHaveAttribute('src', REFRESHED_IMAGE_URL)
    })

    it('6.1-WEB-047 re-reads the feed when the reader asks for the image again', async () => {
      signIn()
      let feedCalls = 0
      useMswHandlers(
        http.get(FEED_PATH, () => {
          feedCalls += 1
          return feedBody({ items: [item()] })
        })
      )
      const user = userEvent.setup()
      renderGrid()

      const surface = await screen.findByTestId('lookbook-image-post-1')
      fireEvent.error(surface.querySelector('img') as HTMLImageElement)
      await screen.findByTestId('image-retry-button-post-1')
      await waitFor(() => expect(feedCalls).toBe(2))

      await user.click(screen.getByTestId('image-retry-button-post-1'))

      await waitFor(() => expect(feedCalls).toBe(3))
      expect(
        screen.getByTestId('lookbook-image-post-1').querySelector('img')
      ).not.toBeNull()
    })
  })

  describe('surface details', () => {
    it('6.1-WEB-048 announces a sponsored look to a screen reader as well as showing it', async () => {
      signIn()
      useMswHandlers(feedHandler({ items: [item(), item({ id: 'post-2' })] }))
      renderGrid({ sponsoredPostIds: ['post-1'] })

      const badge = await screen.findByTestId('sponsored-badge-post-1')
      expect(within(badge).getByText('Sponsored')).toHaveAttribute('aria-hidden', 'true')
      expect(within(badge).getByText('Sponsored look')).toHaveClass('sr-only')
      // The feed contract has no sponsorship field, so a card only claims a
      // commercial relationship the caller stated.
      expect(screen.queryByTestId('sponsored-badge-post-2')).not.toBeInTheDocument()
    })

    it('6.1-WEB-049 focuses and announces the card a deep link points at', async () => {
      signIn()
      useMswHandlers(feedHandler({ items: [item(), item({ id: 'post-2' })] }))
      renderGrid({ highlightedCardId: 'post-2' })

      const card = await screen.findByTestId('lookbook-card-post-2')
      expect(card).toHaveAttribute('data-highlighted', 'true')
      expect(screen.getByTestId('lookbook-card-post-1')).toHaveAttribute(
        'data-highlighted',
        'false'
      )
      await waitFor(() => expect(card).toHaveFocus())
      expect(screen.getByTestId('community-live-region')).toHaveTextContent(
        'Focused on the highlighted look.'
      )
    })

    it('6.1-WEB-070 resolves a deep-link target the loaded page does not hold', async () => {
      signIn()
      useMswHandlers(
        feedHandler({ items: [item(), item({ id: 'post-2' })], nextCursor: cursorFor() }),
        http.get(POST_PATH, ({ params }) =>
          params.postId === 'post-99'
            ? postBody({ id: 'post-99', caption: 'A look from far down the feed.' })
            : errorBody(404, COMMUNITY_POST_NOT_FOUND_MESSAGE, 'Not Found')
        )
      )
      renderGrid({ highlightedCardId: 'post-99' })

      // The feed is keyset-paginated twelve rows at a time, so a notification can
      // reference a look from any depth of it. `getElementById` alone found
      // nothing for every target past page one: no scroll, no focus, no
      // announcement, and no sign of the look the reader followed a link to.
      const card = await screen.findByTestId('lookbook-card-post-99')
      expect(card).toHaveAttribute('data-highlighted', 'true')
      await waitFor(() => expect(card).toHaveFocus())
      await waitFor(() =>
        expect(screen.getByTestId('community-live-region')).toHaveTextContent(
          'Focused on the highlighted look.'
        )
      )

      const cards = within(screen.getByTestId('community-card-grid')).getAllByRole(
        'article'
      )
      expect(cards[0]).toBe(card)
      expect(cards).toHaveLength(3)
    })

    it('6.1-WEB-071 adds nothing for a deep-link target it may not see', async () => {
      signIn()
      useMswHandlers(
        feedHandler({ items: [item()] }),
        http.get(POST_PATH, () =>
          errorBody(404, COMMUNITY_POST_NOT_FOUND_MESSAGE, 'Not Found')
        )
      )
      renderGrid({ highlightedCardId: 'post-99' })

      await screen.findByTestId('lookbook-card-post-1')
      await waitFor(() =>
        expect(
          within(screen.getByTestId('community-card-grid')).getAllByRole('article')
        ).toHaveLength(1)
      )
      // `processWebDeepLink` owns the invalid-link copy, and it has already run by
      // the time this component mounts, so the grid says nothing of its own.
      expect(screen.queryByTestId('community-feed-error')).not.toBeInTheDocument()
    })

    it('6.1-WEB-072 falls back to the card label when alt text is blank', async () => {
      signIn()
      // `communityFeedItemSchema` types `altText` as a nullable string, so an
      // empty one is inside the contract and parses; today's publish path trims
      // and rejects a blank, so this guards the shape the client accepts rather
      // than a row the current writer produces. Mobile's `community-card.tsx`
      // already falls back on `?.trim() ||`; `?? ` here handed the empty string
      // straight through as `alt=""`, which marks a content image decorative and
      // hides it from a screen reader entirely.
      useMswHandlers(feedHandler({ items: [item({ altText: '' })] }))
      renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      const image = screen.getByTestId('lookbook-image-post-1').querySelector('img')
      expect(image).toHaveAttribute('alt', 'Look by Style Explorer 4F2A')
    })

    it('6.1-WEB-050 reports the resolved band without re-firing the feed read', async () => {
      signIn()
      let feedCalls = 0
      const reported: (string | null)[] = []
      useMswHandlers(
        http.get(FEED_PATH, () => {
          feedCalls += 1
          return feedBody({ items: [item()], viewerBand: 'cold_wet' })
        })
      )
      // An inline arrow changes identity on every render, which is exactly the
      // caller shape that would re-fire the read if the callback sat inside
      // `loadFeed`'s dependency list.
      renderGrid({
        onViewerBandChange: (band) => {
          reported.push(band)
        },
      })

      await screen.findByTestId('lookbook-card-post-1')
      await waitFor(() => expect(reported).toContain('cold_wet'))
      expect(feedCalls).toBe(1)
    })

    it('6.1-WEB-051 labels every card as its own region with the author in the name', async () => {
      signIn()
      useMswHandlers(feedHandler({ items: [item()] }))
      renderGrid()

      const card = await screen.findByTestId('lookbook-card-post-1')
      expect(card).toHaveAccessibleName('Look by Style Explorer 4F2A')
      expect(screen.getByTestId('caption-post-1')).toHaveTextContent(
        'Layered wool over a merino base for a damp commute.'
      )
      expect(
        screen.getByAltText(
          'A charcoal wool coat over a cream knit, with black ankle boots.'
        )
      ).toBeInTheDocument()
      expect(screen.getByTestId('climate-badge-post-1')).toHaveTextContent(
        'Temperate and wet'
      )
    })

    it('6.1-WEB-055 stacks the grid into one column in the mobile preview frame', async () => {
      signIn()
      useMswHandlers(feedHandler({ items: [item(), item({ id: 'post-2' })] }))
      renderGrid({ isMobilePreview: true })

      await screen.findByTestId('lookbook-card-post-1')
      const grid = screen.getByTestId('community-card-grid')
      expect(grid).toHaveClass('grid-cols-1')
      // The tablet pill treatment is what the simulated device frame drops.
      expect(grid.className).not.toContain('min-[768px]:grid-cols-2')
      expect(screen.getByTestId('community-filter-auto').className).not.toContain(
        'min-[768px]:rounded-full'
      )
    })
  })

  describe('accessibility', () => {
    it('6.1-WEB-052 has no axe violations in the loaded feed state', async () => {
      signIn()
      useMswHandlers(
        feedHandler({
          items: [item(), item({ id: 'post-2', caption: null, altText: null })],
          authorStates: [
            authorState({
              id: 'as-flagged',
              status: 'flagged',
              moderationReason: 'Nudity detected by automated screening.',
            }),
          ],
          activeChallenge: CHALLENGE,
          nextCursor: cursorFor(),
        })
      )
      const { container } = renderGrid({ sponsoredPostIds: ['post-2'] })

      await screen.findByTestId('lookbook-card-post-1')

      const results = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      })
      expect(
        results.violations.map((violation) => violation.id),
        JSON.stringify(results.violations, null, 2)
      ).toEqual([])
    })

    it('6.1-WEB-053 has no axe violations with the compose modal open', async () => {
      signIn()
      useMswHandlers(feedHandler({ items: [item()], activeChallenge: CHALLENGE }))
      const user = userEvent.setup()
      const { container } = renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('create-post-button'))
      await screen.findByTestId('post-alt-text-input')

      const results = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      })
      expect(
        results.violations.map((violation) => violation.id),
        JSON.stringify(results.violations, null, 2)
      ).toEqual([])
    })

    it('6.1-WEB-054 has no axe violations with the report modal open', async () => {
      signIn()
      useMswHandlers(feedHandler({ items: [item()] }))
      const user = userEvent.setup()
      const { container } = renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await user.click(screen.getByTestId('report-button-post-1'))
      await screen.findByTestId('report-reason-select')

      const results = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      })
      expect(
        results.violations.map((violation) => violation.id),
        JSON.stringify(results.violations, null, 2)
      ).toEqual([])
    })
  })
})

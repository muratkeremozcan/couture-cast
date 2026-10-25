import {
  routing,
  mockCapture,
  imagePicker,
  imageManipulator,
  imageEvents,
} from './mock-state'
import { createElement } from 'react'
import { Buffer } from 'buffer'
import { http, HttpResponse } from 'msw'
import { beforeEach, vi } from 'vitest'
import {
  encodeCommunityFeedCursor,
  type ClimateBand,
  type CommunityAuthorPostState,
  type CommunitySponsoredFeed as CommunityFeed,
  type CommunitySponsoredFeedItem as CommunityFeedItem,
  type CommunityFeedMode,
  type CommunityPostStatus,
} from '@couture/api-client/contracts/http'
import { server } from '@/src/test-utils/msw/server'

// Learning path Step 38: Community feed by climate band.
// Story 6.1 Task 8 owner: the mobile community feed screen and its HTTP client.
//
// The network boundary stays REAL and is driven through MSW; `@/src/lib/community` is
// kept live through passthrough spies. Three of the states here are reachable only through a
// rejected request (401, 409 already-reported, 429 with Retry-After), and the first
// draft of this screen rendered `error.message` straight from the SDK, so a 429, a 409
// and a 500 all read as "Response returned an error code". A mocked client proves none
// of that.
//
// Native modules use test doubles; community client spies call the real HTTP path. `src/lib/community.ts` imports `expo-image-picker`,
// `expo-image-manipulator`, `expo-file-system` and `expo-crypto` LAZILY because they
// pull in `expo-modules-core`, which cannot be evaluated in a browser bundle.
//
// Fixture image URLs are `data:` URIs. react-native-web's `Image` really loads the URI
// through `ImageLoader` and renders a second `<img src>` for the context menu, so an
// unreachable host fires the card's `onError`, which asks the screen to refetch the
// feed and puts phantom requests into every request-count assertion in this file.
/*
 * `vitest-browser-react`'s `render` and this repo's `press` helper return plain values;
 * every sibling screen suite awaits them so the call sites read the same way.
 */
/* eslint-disable @typescript-eslint/await-thenable */

imageEvents.createElement = createElement

const FEED_ROUTE = '*/api/v1/community/feed'
const UPLOAD_URL = 'https://mock-upload.test/upload'

/** A real 1x1 PNG, so `ImageLoader` resolves without touching the network. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const SDK_ERROR_MESSAGE = 'Response returned an error code'

const IMAGE_REFERENCE_NOW = Date.parse('2026-10-19T12:00:00.000Z')
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(IMAGE_REFERENCE_NOW)
})

function imageAccess(expiresInMs = 3_600_000) {
  return { url: PIXEL, expiresAt: new Date(Date.now() + expiresInMs).toISOString() }
}

function item(overrides: Partial<CommunityFeedItem> = {}): CommunityFeedItem {
  return {
    id: 'post-a',
    caption: 'Layered wool over a merino base for a damp commute.',
    altText: 'A charcoal wool coat over a cream knit, with black ankle boots.',
    climateBand: 'temperate_dry',
    imageAccess: imageAccess(),
    publishedAt: '2026-09-05T12:00:00.000Z',
    createdAt: '2026-09-05T11:00:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Style Explorer A1B2', isSelf: false },
    ...overrides,
  }
}

function authorState(
  status: CommunityPostStatus,
  overrides: Partial<CommunityAuthorPostState> = {}
): CommunityAuthorPostState {
  return {
    id: `own-${status}`,
    caption: null,
    altText: null,
    climateBand: null,
    imageAccess: null,
    createdAt: '2026-09-05T10:00:00.000Z',
    publishedAt: null,
    status,
    challengeId: null,
    moderationReason: null,
    ...overrides,
  }
}

function feed(overrides: Partial<CommunityFeed> = {}): CommunityFeed {
  return {
    items: [item()],
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
 * The contract's cursor codec is Node's `Buffer`, and this suite runs in a real
 * browser where there is no `Buffer` at all, so `encodeCommunityFeedCursor` is not
 * callable here without this. Minting is not negotiable: a hand-written literal
 * cannot express the mode-and-band binding the recovery below turns on, and the
 * encoder parses before it encodes, so it is also what makes a future required
 * field a compile error rather than a silently passing test.
 *
 * The one `buffer` package this monorepo resolves to anywhere is 5.7.1, and its
 * `toString` switch has no `'base64url'` case at all -- so this is not a bundling
 * or pre-optimization timing gap that `optimizeDeps.include` would fix, it is a
 * missing feature in the only version available. Patched narrowly, here, rather
 * than in `vitest.config.ts`: nothing else in this browser-mode suite mints a
 * cursor, so nothing else needs it, and reaching for a newer `buffer` dependency
 * for one test file's sake would be a wider change than the gap it closes.
 */
const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof Buffer }
browserGlobal.Buffer ??= Buffer
const supportsBase64Url = (() => {
  try {
    return Buffer.from('a').toString('base64url' as BufferEncoding) === 'YQ'
  } catch {
    // buffer@5.7.1 throws on an encoding it does not recognise rather than
    // returning something wrong, which is exactly the case this check exists
    // to detect.
    return false
  }
})()
if (!supportsBase64Url) {
  const bufferPrototype = Buffer.prototype as Buffer
  const encodeBase64 = Reflect.get(bufferPrototype, 'toString') as (
    this: Buffer,
    encoding: BufferEncoding,
    ...rest: never[]
  ) => string
  bufferPrototype.toString = function toStringWithBase64Url(
    this: Buffer,
    encoding?: BufferEncoding,
    ...rest: never[]
  ) {
    if (encoding !== 'base64url') {
      return encodeBase64.call(this, encoding as BufferEncoding, ...rest)
    }
    return encodeBase64
      .call(this, 'base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }
}

function cursor(band: ClimateBand | null, mode: CommunityFeedMode = 'auto') {
  return encodeCommunityFeedCursor({
    publishedAt: '2026-09-05T12:00:00.000Z',
    id: 'post-a',
    mode,
    band,
  })
}

const CHALLENGE = {
  id: 'challenge-autumn',
  slug: 'autumn-layers',
  climateBand: 'temperate_dry' as const,
  title: 'Autumn Layers Challenge',
  body: 'Style your favourite transitional layering pieces for temperate weather.',
  startsAt: '2026-08-31T00:00:00.000Z',
  endsAt: '2026-09-07T00:00:00.000Z',
  timeZone: 'Europe/Istanbul',
}

const feedJson = (overrides: Partial<CommunityFeed> = {}) =>
  HttpResponse.json({ data: feed(overrides) })

const errorEnvelope = (
  status: number,
  message: string,
  headers?: Record<string, string>
) =>
  HttpResponse.json(
    { statusCode: status, message, error: 'Error' },
    { status, ...(headers ? { headers } : {}) }
  )

/** Every feed URL this test file caused, in order. */
let feedUrls: URL[] = []

function serveFeed(respond: (url: URL, index: number) => Response | Promise<Response>) {
  server.use(
    http.get(FEED_ROUTE, ({ request }) => {
      const url = new URL(request.url)
      feedUrls.push(url)
      return respond(url, feedUrls.length - 1)
    })
  )
}

function setMockParams(params: Record<string, string>) {
  routing.params = params
}

function resetFeedUrls() {
  feedUrls = []
}

export {
  mockCapture,
  SDK_ERROR_MESSAGE,
  item,
  cursor,
  feedJson,
  errorEnvelope,
  feedUrls,
  serveFeed,
  setMockParams,
  authorState,
  UPLOAD_URL,
  PIXEL,
  IMAGE_REFERENCE_NOW,
  feed,
  CHALLENGE,
  imageEvents,
  imagePicker,
  FEED_ROUTE,
  imageManipulator,
  resetFeedUrls,
}

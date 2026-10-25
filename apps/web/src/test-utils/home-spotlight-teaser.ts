// Shared Story 6.7 web Home spotlight teaser fixtures, deferred reads and suite
// lifecycle. A suite that uses `teaserCalls` must mock `lib/community` with
// `{ spy: true }` itself, so the wrapper's calls are recorded.
import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  communityReactionSpotlightResponseSchema,
  type CommunityReactionSpotlight,
  type CommunityReactionSpotlightItem,
} from '@couture/api-client/contracts/http'
import { CommunitySyncState } from '@couture/api-client'
import { useMswHandlers } from './msw/runtime'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../lib/wardrobe'
import { getCommunitySpotlightFromWeb } from '../lib/community'

export const SPOTLIGHT_PATH = '/api/v1/community/spotlight'
export const TEASER_PREFIX = 'home-spotlight-teaser'

export function spotlightItem(
  id: string,
  rank = 1,
  overrides: Partial<CommunityReactionSpotlightItem> = {}
): CommunityReactionSpotlightItem {
  return {
    id,
    caption: 'Private caption that the teaser never shows.',
    altText: 'A camel coat over a grey knit.',
    climateBand: 'temperate_wet',
    imageAccess: {
      url: `https://storage.local/community/${id}.jpg`,
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    publishedAt: '2026-10-22T09:00:00.000Z',
    createdAt: '2026-10-22T08:59:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Ana', isSelf: false },
    rank,
    reactions: {
      counts: { applause: 2, love: 1, inspiration: 0 },
      total: 3,
      viewerReaction: null,
      revision: 1,
      generation: 1,
    },
    ...overrides,
  }
}

export function cityPage(items = [spotlightItem('look-1')]): CommunityReactionSpotlight {
  return { level: 'city', label: 'Lisbon', items, nextCursor: null }
}

export type Answer =
  | { status: number; body: unknown; headers?: Record<string, string> }
  | 'network-error'
export interface PendingRead {
  url: URL
  resolve: (answer: Answer) => void
}

/**
 * Teaser reads (`surface=home_teaser`) wait for the test; the Community
 * module's own reads answer `module()` at once.
 */
export function useServedSpotlight(
  module: () => Answer = () => ({ status: 200, body: { data: cityPage() } })
) {
  const teaserReads: PendingRead[] = []
  const moduleReads: URL[] = []
  useMswHandlers(
    http.get(SPOTLIGHT_PATH, async ({ request }) => {
      const url = new URL(request.url)
      if (url.searchParams.get('surface') !== 'home_teaser') {
        moduleReads.push(url)
        return respond(module())
      }
      const answer = await new Promise<Answer>((resolve) => {
        teaserReads.push({ url, resolve })
      })
      return respond(answer)
    })
  )
  const answer = async (index: number, value: CommunityReactionSpotlight | Answer) => {
    await waitFor(() => expect(teaserReads.length).toBeGreaterThan(index))
    teaserReads[index]!.resolve(
      value === 'network-error' || 'status' in value
        ? value
        : {
            status: 200,
            body: communityReactionSpotlightResponseSchema.parse({ data: value }),
          }
    )
    // Waits on the wrapper's own promise, then lets React commit the result.
    await settledTeaserRead(index)
  }
  return { teaserReads, moduleReads, answer }
}

export function respond(answer: Answer) {
  if (answer === 'network-error') return HttpResponse.error()
  return HttpResponse.json(answer.body as never, {
    status: answer.status,
    headers: answer.headers,
  })
}

/** The wrapper calls the teaser made, in order; the Community module's are left out. */
export function teaserCalls() {
  const mock = vi.mocked(getCommunitySpotlightFromWeb).mock
  return mock.calls.flatMap(([request], index) =>
    request?.surface === 'home_teaser' ? [mock.results[index]!] : []
  )
}

/** Waits until teaser read `index` settled at the client, then lets React commit. */
export async function settledTeaserRead(index: number) {
  await waitFor(() => expect(teaserCalls().length).toBeGreaterThan(index))
  await (teaserCalls()[index]!.value as Promise<unknown>).then(
    () => undefined,
    () => undefined
  )
  await act(async () => {
    await Promise.resolve()
  })
}

export function signIn(token = 'test-access-token') {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, token)
  window.dispatchEvent(new Event('couture:session'))
}

export function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  window.dispatchEvent(new Event('resize'))
}

export function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

export function teaserNodes(): Element[] {
  return [...document.querySelectorAll(`[data-testid^="${TEASER_PREFIX}"]`)]
}

/**
 * The lifecycle every teaser suite shares: a stubbed scrollIntoView, a stacked
 * 1024px viewport, a visible page and no realtime start. Returns the stub.
 */
export function setupHomeTeaserSuite() {
  const scrollIntoView = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView'
  )
  const scrollIntoViewStub = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom has no layout, so it has no scrollIntoView; the mobile preview and the
    // community focus moves call it.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoViewStub,
    })
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(() => undefined)
    window.sessionStorage.clear()
    setViewport(1024)
    setVisibility('visible')
  })
  afterEach(() => {
    vi.useRealTimers()
    window.sessionStorage.clear()
    if (scrollIntoView)
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })
  return { scrollIntoViewStub }
}

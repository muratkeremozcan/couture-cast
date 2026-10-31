// Story 6.7: shared harness for the mobile Home teaser suites. Reads are deferred
// through MSW so each test decides when one settles, and "settled" is read from
// the wrapper's own promise, never from a sleep. A suite using `settledRead` or
// `settledIdentity` registers `vi.mock('@/src/lib/community', { spy: true })`.
import React from 'react'
import { act, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { expect, onTestFinished, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type {
  CommunityReactionSpotlight,
  CommunityReactionSpotlightItem,
} from '@couture/api-client/contracts/http'
import TabOneScreen from '@/app/(tabs)/index'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import {
  communityCommentsSessionFromMobile,
  getCommunitySpotlightFromMobile,
} from '@/src/lib/community'
import { server } from '@/src/test-utils/msw/server'

export const TEASER_PREFIX = 'home-spotlight-teaser'
let imageSerial = 0

export function spotlightItem(
  id: string,
  overrides: Partial<CommunityReactionSpotlightItem> = {}
): CommunityReactionSpotlightItem {
  return {
    id,
    caption: 'Private caption that the teaser never shows.',
    altText: 'A camel coat over a grey knit.',
    climateBand: 'temperate_wet',
    imageAccess: {
      // Unique per call: the browser image cache would otherwise answer a URL a
      // previous test already loaded, without asking the test server.
      url: `${window.location.origin}/teaser/${id}-${(imageSerial += 1)}.png`,
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    publishedAt: '2026-10-22T09:00:00.000Z',
    createdAt: '2026-10-22T08:59:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Ana', isSelf: false },
    rank: 1,
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

export const cityPage = (item = spotlightItem('look-1')): CommunityReactionSpotlight => ({
  level: 'city',
  label: 'Lisbon',
  items: [item],
  nextCursor: null,
})

export type Answer =
  | { status: number; body: unknown; headers?: Record<string, string> }
  | 'network-error'

export interface PendingRead {
  url: URL
  authorization: string | null
  resolve: (answer: Answer) => void
}

let readScope = 0

/**
 * Every spotlight read waits until the test answers it.
 *
 * Each test reads under its own API base path. A read the previous test still
 * had in flight is aborted when its Home unmounts, but the service worker can
 * deliver the request after this test's handler is installed. Without the path
 * it would be taken as this test's first read and answered in its place, and the
 * test's own read would wait forever: the 6.7-MOB-013 flake, seen under load.
 */
export function deferSpotlightReads() {
  const reads: PendingRead[] = []
  const scope = `/teaser-test-${(readScope += 1)}`
  const previousBase = process.env.EXPO_PUBLIC_API_BASE_URL
  process.env.EXPO_PUBLIC_API_BASE_URL = `${window.location.origin}${scope}`
  // A read left unanswered holds a browser connection past its test, and enough
  // of them stall every later request to the test origin.
  onTestFinished(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = previousBase
    for (const read of reads) read.resolve('network-error')
  })
  server.use(
    http.get('*/api/v1/community/spotlight', async ({ request }) => {
      // Another test's read: refused at once, never recorded here.
      if (!new URL(request.url).pathname.startsWith(`${scope}/`)) {
        return HttpResponse.error()
      }
      const answer = await new Promise<Answer>((resolve) => {
        reads.push({
          url: new URL(request.url),
          authorization: request.headers.get('authorization'),
          resolve,
        })
      })
      if (answer === 'network-error') return HttpResponse.error()
      return HttpResponse.json(answer.body as never, {
        status: answer.status,
        headers: answer.headers,
      })
    })
  )
  const answer = async (index: number, value: CommunityReactionSpotlight | Answer) => {
    await waitFor(() => expect(reads.length).toBeGreaterThan(index))
    reads[index]!.resolve(
      value === 'network-error' || 'status' in value
        ? value
        : { status: 200, body: { data: value } }
    )
  }
  return { reads, answer }
}

/** How many teaser reads the client started, counted at the wrapper. */
export function teaserReadCalls(): number {
  return vi.mocked(getCommunitySpotlightFromMobile).mock.calls.length
}

/** The signal the client handed its read, so a test can see it was aborted. */
export function teaserReadSignal(index: number): AbortSignal | undefined {
  return vi.mocked(getCommunitySpotlightFromMobile).mock.calls[index]?.[0]?.signal
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

/** Waits until the client's read `index` settled, then lets React commit it. */
export async function settledRead(index: number) {
  const mock = vi.mocked(getCommunitySpotlightFromMobile).mock
  await waitFor(() => expect(mock.results.length).toBeGreaterThan(index))
  await (mock.results[index]!.value as Promise<unknown>).then(
    () => undefined,
    () => undefined
  )
  await flush()
}

/** Waits until every member resolution started so far settled. */
export async function settledIdentity() {
  const mock = vi.mocked(communityCommentsSessionFromMobile).mock
  await waitFor(() => expect(mock.results.length).toBeGreaterThan(0))
  await Promise.all(
    mock.results.map((result) =>
      (result.value as Promise<unknown>).then(
        () => undefined,
        () => undefined
      )
    )
  )
  await flush()
}

export function recordOpens() {
  const opens: { postId: string; body: unknown }[] = []
  server.use(
    http.post('*/api/v1/community/posts/:postId/opened', async ({ params, request }) => {
      opens.push({ postId: String(params.postId), body: await request.json() })
      return HttpResponse.json({ tracked: true })
    })
  )
  return opens
}

/** A one-pixel PNG for every teaser image URL. */
export function serveTeaserImages() {
  server.use(
    http.get('*/teaser/:file', () =>
      HttpResponse.arrayBuffer(
        Uint8Array.from(
          atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
          ),
          (char) => char.charCodeAt(0)
        ).buffer,
        { headers: { 'content-type': 'image/png' } }
      )
    )
  )
}

export function teaserNodes(): Element[] {
  return Array.from(
    document.querySelectorAll<Element>(
      `[data-testid^="${TEASER_PREFIX}"]:not([data-testid^="${TEASER_PREFIX}-focused-"]):not([data-testid^="${TEASER_PREFIX}-focus-requested-"])`
    )
  )
}

/**
 * Proves an element takes no room in its parent's layout: the parent measures the
 * same height with the element detached as with it in place.
 */
export function expectOccupiesNoLayout(element: Element) {
  const parent = element.parentElement!
  const next = element.nextSibling
  const withElement = parent.getBoundingClientRect().height
  parent.removeChild(element)
  const withoutElement = parent.getBoundingClientRect().height
  parent.insertBefore(element, next)
  expect(withElement).toBe(withoutElement)
}

/**
 * Home renders nothing after the hero conditional: the scroll content ends with
 * the node that holds `heroTestId`, and only the content's own bottom padding
 * follows it. A reference taken while a read is pending would carry a
 * placeholder the teaser left there, so this checks the structure itself.
 */
export function expectNothingAfterHero(heroTestId: string) {
  const hero = document.querySelector(`[data-testid="${heroTestId}"]`)
  const content = document.querySelector(
    '[data-testid="hero-experience-scrollview"]'
  )?.firstElementChild
  expect(hero).not.toBeNull()
  expect(content).toBeTruthy()
  let top: Element = hero!
  while (top.parentElement && top.parentElement !== content) top = top.parentElement
  expect(top.parentElement).toBe(content)
  expect(content!.lastElementChild).toBe(top)
  const padding = parseFloat(getComputedStyle(content!).paddingBottom)
  const margin = parseFloat(getComputedStyle(top).marginBottom)
  const below =
    content!.getBoundingClientRect().bottom - top.getBoundingClientRect().bottom
  expect(Math.round(below - margin - padding)).toBe(0)
}

export function follows(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

export function renderHome() {
  return render(
    <AccessibilityAnnouncerProvider>
      <TabOneScreen />
    </AccessibilityAnnouncerProvider>
  )
}

/** Waits on real frames, never on a faked clock, so no timer fires early. */
export async function untilFrame(check: () => boolean) {
  for (let frame = 0; frame < 600 && !check(); frame += 1) {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
  }
  expect(check()).toBe(true)
}

export async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Under fake timers: answers the first read and waits for the image to load. */
export async function showTeaser(reads: PendingRead[], page = cityPage()) {
  await untilFrame(() => reads.length === 1)
  reads[0]!.resolve({ status: 200, body: { data: page } })
  await untilFrame(
    () => document.querySelector(`[data-testid="${TEASER_PREFIX}-image-loaded"]`) !== null
  )
}

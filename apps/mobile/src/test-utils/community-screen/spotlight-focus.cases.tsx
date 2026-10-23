/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.7 owner: a Home teaser activation resolved by the mobile Community screen.
import { item, setMockParams } from './harness'
import { routing } from './mock-state'
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { expect, it, vi } from 'vitest'
import {
  COMMUNITY_FEED_DISABLED_MESSAGE,
  communityReactionSpotlightResponseSchema,
  type CommunityReactionSpotlight,
  type CommunityReactionSpotlightItem,
} from '@couture/api-client/contracts/http'
import { AccessibilityInfo, Platform, findNodeHandle } from 'react-native'
import { CommunityScreen } from '@/src/features/community/community-screen'
import { server } from '@/src/test-utils/msw/server'
import {
  mobileApplicationUserId,
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import enUS from '@/assets/locales/en-US.json'

const SPOTLIGHT_ROUTE = '*/api/v1/community/spotlight'
const TARGET_UNAVAILABLE = enUS.community.spotlight.targetUnavailable
const DESTINATION_UNAVAILABLE = enUS.community.spotlight.destinationUnavailable
const ANNOUNCE_FOCUSED = enUS.community.feed.announceFocused
const INVALID_LINK = enUS.community.deepLink.invalid

function spotlightItem(id: string, rank: number): CommunityReactionSpotlightItem {
  return {
    ...item({ id, caption: `Spotlight caption ${rank}` }),
    rank,
    reactions: {
      counts: { applause: rank, love: 0, inspiration: 0 },
      total: rank,
      viewerReaction: null,
      revision: 0,
      generation: 1,
    },
  }
}

function page(overrides: Partial<CommunityReactionSpotlight> = {}) {
  return HttpResponse.json(
    communityReactionSpotlightResponseSchema.parse({
      data: {
        level: 'city',
        label: 'Lisbon',
        items: [spotlightItem('spot-1', 1), spotlightItem('spot-2', 2)],
        nextCursor: null,
        ...overrides,
      },
    })
  )
}

function serveSpotlight(respond: () => Response | Promise<Response>) {
  server.use(http.get(SPOTLIGHT_ROUTE, () => respond()))
}

function teaserIntent(cardId: string, focusToken: string) {
  return { source: 'app', type: 'community', cardId, focus: 'spotlight', focusToken }
}

/** iOS focus plumbing: every node handed to findNodeHandle gets a stable handle. */
function iosFocusHandles() {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
  const handles = new Map<unknown, number>()
  vi.mocked(findNodeHandle).mockImplementation((node: unknown) => {
    if (!handles.has(node)) handles.set(node, 900 + handles.size)
    return handles.get(node) ?? null
  })
  return handles
}

function announcementsOf(text: string) {
  return vi
    .mocked(AccessibilityInfo.announceForAccessibility)
    .mock.calls.filter(([announced]) => announced === text)
}

/** The notice holds focus and is announced by that focus alone. */
async function expectFocusedNotice(message: string) {
  const notice = await screen.findByTestId('deep-link-info-banner-message')
  expect(notice.getAttribute('aria-label')).toBe(message)
  await waitFor(() => expect(document.activeElement).toBe(notice))
  expect(screen.getByTestId('deep-link-info-banner').getAttribute('aria-live')).not.toBe(
    'polite'
  )
  expect(document.body.textContent).not.toContain(INVALID_LINK)
}

export function registerCommunitySpotlightFocusCases() {
  it('6.7-MOB-020 an entry present takes focus with one announcement and the params clear', async () => {
    const handles = iosFocusHandles()
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear()
    routing.router.setParams.mockClear()
    serveSpotlight(() => page())
    setMockParams(teaserIntent('spot-2', 'token-020'))
    await render(<CommunityScreen />)
    const rank = await screen.findByTestId('community-spotlight-rank-spot-2')
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
        handles.get(rank)
      )
    )
    expect(announcementsOf(ANNOUNCE_FOCUSED)).toHaveLength(1)
    expect(routing.router.setParams).toHaveBeenCalledWith({
      source: undefined,
      type: undefined,
      cardId: undefined,
      focus: undefined,
      focusToken: undefined,
    })
    expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
  })

  it.each([
    ['loaded without the entry', () => page({ items: [spotlightItem('spot-1', 1)] })],
    [
      'level none',
      () => page({ level: 'none', label: null, items: [], nextCursor: null }),
    ],
    [
      'failed',
      () =>
        HttpResponse.json(
          { statusCode: 500, message: 'Internal server error' },
          { status: 500 }
        ),
    ],
    [
      'disabled',
      () =>
        HttpResponse.json(
          { statusCode: 403, code: 'denied', message: COMMUNITY_FEED_DISABLED_MESSAGE },
          { status: 403 }
        ),
    ],
  ] as const)(
    '6.7-MOB-021 a module %s focuses the target notice and never the invalid banner',
    async (_name, respond) => {
      vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear()
      serveSpotlight(respond)
      setMockParams(teaserIntent('spot-2', `token-021-${_name}`))
      await render(<CommunityScreen />)
      await expectFocusedNotice(TARGET_UNAVAILABLE)
      expect(announcementsOf(ANNOUNCE_FOCUSED)).toHaveLength(0)
    }
  )

  it('6.7-MOB-022 a module still loading after 10 seconds focuses the destination notice; a later load moves no focus', async () => {
    let release: (() => void) | undefined
    serveSpotlight(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(page())
        })
    )
    const handles = iosFocusHandles()
    vi.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear()
    const startedAt = Date.now()
    let now = startedAt
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      setMockParams(teaserIntent('spot-1', 'token-022'))
      await render(<CommunityScreen />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
      now = startedAt + 9_999
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9_999)
      })
      expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
      now = startedAt + 10_000
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      vi.useRealTimers()
      const notice = await screen.findByTestId('deep-link-info-banner-message')
      expect(notice.getAttribute('aria-label')).toBe(DESTINATION_UNAVAILABLE)
      await waitFor(() =>
        expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
          handles.get(notice)
        )
      )
      // The module recovers later; the intent is consumed, so focus stays put.
      await waitFor(() => expect(release).toBeTypeOf('function'))
      release!()
      const rank = await screen.findByTestId('community-spotlight-rank-spot-1')
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
      expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalledWith(
        handles.get(rank)
      )
    } finally {
      vi.useRealTimers()
      dateNow.mockRestore()
    }
  })

  it('6.7-MOB-023 a signed-out viewer has no module and gets the destination notice', async () => {
    const restore = setMobileAccessTokenResolver(() => undefined)
    const previousMember = mobileApplicationUserId()
    setMobileApplicationUserId(null)
    try {
      serveSpotlight(() => page())
      setMockParams(teaserIntent('spot-1', 'token-023'))
      await render(<CommunityScreen />)
      await expectFocusedNotice(DESTINATION_UNAVAILABLE)
    } finally {
      restore()
      setMobileApplicationUserId(previousMember)
    }
  })

  it('6.7-MOB-024 a repeated token moves no focus; a fresh token focuses again', async () => {
    const handles = iosFocusHandles()
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear()
    serveSpotlight(() => page())
    setMockParams(teaserIntent('spot-1', 'token-024-a'))
    const view = await render(<CommunityScreen />)
    const rank = await screen.findByTestId('community-spotlight-rank-spot-1')
    await waitFor(() => expect(announcementsOf(ANNOUNCE_FOCUSED)).toHaveLength(1))
    const focusCalls = () =>
      vi
        .mocked(AccessibilityInfo.setAccessibilityFocus)
        .mock.calls.filter(([handle]) => handle === handles.get(rank)).length
    // Focus moves on the next frame; count only once it has.
    await waitFor(() => expect(focusCalls()).toBeGreaterThan(0))
    const afterFirst = focusCalls()

    // The same token again, as a re-render with stale params would deliver it.
    setMockParams({ ...teaserIntent('spot-1', 'token-024-a') })
    await view.rerender(<CommunityScreen />)
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    expect(announcementsOf(ANNOUNCE_FOCUSED)).toHaveLength(1)
    expect(focusCalls()).toBe(afterFirst)

    setMockParams(teaserIntent('spot-1', 'token-024-b'))
    await view.rerender(<CommunityScreen />)
    await waitFor(() => expect(announcementsOf(ANNOUNCE_FOCUSED)).toHaveLength(2))
    await waitFor(() => expect(focusCalls()).toBeGreaterThan(afterFirst))
  })

  it('6.7-MOB-025 clearing the params never cancels the copied intent', async () => {
    let release: (() => void) | undefined
    serveSpotlight(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(page())
        })
    )
    const handles = iosFocusHandles()
    setMockParams(teaserIntent('spot-2', 'token-025'))
    const view = await render(<CommunityScreen />)
    await waitFor(() => expect(release).toBeTypeOf('function'))
    // The router cleared the params before the module settled.
    setMockParams({})
    await view.rerender(<CommunityScreen />)
    release!()
    const rank = await screen.findByTestId('community-spotlight-rank-spot-2')
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
        handles.get(rank)
      )
    )
  })
}

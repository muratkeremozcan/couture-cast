// Story 6.7 owner: a Home teaser activation resolved by the mobile Community screen.
import { item, setMockParams } from './harness'
import { CommunitySyncState, type CommunitySyncCallbacks } from '@couture/api-client'
import { screenFocus } from '../focus-effect'
import { mockCapture, routing } from './mock-state'
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { expect, it, onTestFinished, vi } from 'vitest'
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
  // The notice outranks the invalid banner on screen, so check the invalid
  // verdict itself was never reached.
  expect(mockCapture.mock.calls.filter(([name]) => name === 'deep_link_invalid')).toEqual(
    []
  )
}

async function frames(count: number) {
  for (let frame = 0; frame < count; frame += 1)
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
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

  it('6.7-MOB-026 a consumed focus request never replays when the module recovers from an availability lapse', async () => {
    const syncs: CommunitySyncState[] = []
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
      this: CommunitySyncState
    ) {
      syncs.push(this)
    })
    const handles = iosFocusHandles()
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear()
    vi.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear()
    serveSpotlight(() => page())
    setMockParams(teaserIntent('spot-1', 'token-026'))
    await render(<CommunityScreen />)
    const rank = await screen.findByTestId('community-spotlight-rank-spot-1')
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(
        handles.get(rank)
      )
    )
    const focusedBefore = vi.mocked(AccessibilityInfo.setAccessibilityFocus).mock.calls
      .length
    expect(announcementsOf(ANNOUNCE_FOCUSED)).toHaveLength(1)

    // Access verification lapses, then recovers: the module unmounts and mounts.
    await waitFor(() => expect(syncs).toHaveLength(1))
    const callbacks = (syncs[0] as unknown as { callbacks: CommunitySyncCallbacks })
      .callbacks
    act(() => callbacks.availability('unavailable', false))
    await waitFor(() => expect(screen.queryByTestId('community-spotlight')).toBeNull())
    act(() => callbacks.availability('connected', false))
    await screen.findByTestId('community-spotlight-rank-spot-1')
    for (let frame = 0; frame < 3; frame += 1)
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
    expect(announcementsOf(ANNOUNCE_FOCUSED)).toHaveLength(1)
    expect(vi.mocked(AccessibilityInfo.setAccessibilityFocus).mock.calls).toHaveLength(
      focusedBefore
    )
  })

  // The Home tab and Android back both reach Community as the same navigation
  // blur, so one case covers both.
  it('6.7-MOB-027 leaving retires a pending destination: a later response announces and focuses nothing', async () => {
    let release: (() => void) | undefined
    serveSpotlight(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(page())
        })
    )
    const handles = iosFocusHandles()
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear()
    vi.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear()
    setMockParams(teaserIntent('spot-1', 'token-027'))
    await render(<CommunityScreen />)
    await waitFor(() => expect(release).toBeTypeOf('function'))
    act(() => screenFocus.set(false))

    release!()
    const rank = await screen.findByTestId('community-spotlight-rank-spot-1')
    for (let frame = 0; frame < 3; frame += 1)
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
    act(() => screenFocus.set(true))
    for (let frame = 0; frame < 3; frame += 1)
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
    expect(announcementsOf(ANNOUNCE_FOCUSED)).toHaveLength(0)
    expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalledWith(
      handles.get(rank)
    )
    expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
  })

  it('6.7-MOB-028 leaving before the 10-second destination deadline shows and focuses no notice', async () => {
    // Held for the whole case, then released so no connection outlives it.
    let releaseRead!: () => void
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    onTestFinished(() => releaseRead())
    serveSpotlight(async () => {
      await readHeld
      return HttpResponse.error()
    })
    iosFocusHandles()
    vi.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear()
    const startedAt = Date.now()
    let now = startedAt
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      setMockParams(teaserIntent('spot-1', 'token-028'))
      await render(<CommunityScreen />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      act(() => screenFocus.set(false))
      now = startedAt + 10_000
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      vi.useRealTimers()
      act(() => screenFocus.set(true))
      for (let frame = 0; frame < 3; frame += 1)
        await act(async () => {
          await new Promise((resolve) => requestAnimationFrame(resolve))
        })
      expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
      expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      dateNow.mockRestore()
    }
  })

  it('6.7-MOB-051 an intent that arrives while Community is still blurred focuses the entry once the screen takes focus', async () => {
    const handles = iosFocusHandles()
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear()
    serveSpotlight(() => page())
    setMockParams({})
    const view = await render(<CommunityScreen />)
    const rank = await screen.findByTestId('community-spotlight-rank-spot-2')
    // The router delivers the params before it reports the screen focused.
    act(() => screenFocus.set(false))
    setMockParams(teaserIntent('spot-2', 'token-051'))
    await view.rerender(<CommunityScreen />)
    await frames(5)
    expect(announcementsOf(ANNOUNCE_FOCUSED)).toHaveLength(0)

    act(() => screenFocus.set(true))
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
        handles.get(rank)
      )
    )
    expect(announcementsOf(ANNOUNCE_FOCUSED)).toHaveLength(1)
  })

  it('6.7-MOB-052 an intent for a missing entry that arrives while Community is blurred focuses the notice once it takes focus', async () => {
    serveSpotlight(() => page({ items: [spotlightItem('spot-1', 1)] }))
    setMockParams({})
    const view = await render(<CommunityScreen />)
    await screen.findByTestId('community-spotlight-rank-spot-1')
    act(() => screenFocus.set(false))
    setMockParams(teaserIntent('spot-9', 'token-052'))
    await view.rerender(<CommunityScreen />)
    await frames(5)
    expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()

    act(() => screenFocus.set(true))
    await expectFocusedNotice(TARGET_UNAVAILABLE)
  })

  it('6.7-MOB-053 a notice already focused takes no focus again on a later visit', async () => {
    iosFocusHandles()
    serveSpotlight(() => page({ items: [spotlightItem('spot-1', 1)] }))
    setMockParams(teaserIntent('spot-9', 'token-053'))
    await render(<CommunityScreen />)
    await screen.findByTestId('deep-link-info-banner-message')
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalled()
    )
    const afterNotice = vi.mocked(AccessibilityInfo.setAccessibilityFocus).mock.calls
      .length

    // Away and back: the notice still shows, and focus stays where the member is.
    act(() => screenFocus.set(false))
    act(() => screenFocus.set(true))
    await frames(5)
    expect(vi.mocked(AccessibilityInfo.setAccessibilityFocus).mock.calls).toHaveLength(
      afterNotice
    )
  })

  it('6.7-MOB-041 an identity change while the destination is pending moves no focus and shows no notice', async () => {
    const held: (() => void)[] = []
    onTestFinished(() => {
      for (const release of held) release()
    })
    serveSpotlight(
      () =>
        new Promise<Response>((resolve) => {
          held.push(() => resolve(page()))
        })
    )
    const handles = iosFocusHandles()
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear()
    vi.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear()
    const previousMember = mobileApplicationUserId()
    setMobileApplicationUserId('member-a')
    try {
      setMockParams(teaserIntent('spot-1', 'token-041'))
      await render(<CommunityScreen />)
      await waitFor(() => expect(held.length).toBeGreaterThan(0))
      // Another member takes the session while the module is still loading.
      act(() => setMobileApplicationUserId('member-b'))
      await waitFor(() => expect(held.length).toBeGreaterThan(1))
      for (const release of held) release()
      const rank = await screen.findByTestId('community-spotlight-rank-spot-1')
      await frames(5)
      expect(announcementsOf(ANNOUNCE_FOCUSED)).toHaveLength(0)
      expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalledWith(
        handles.get(rank)
      )
      expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
    } finally {
      setMobileApplicationUserId(previousMember)
    }
  })
}

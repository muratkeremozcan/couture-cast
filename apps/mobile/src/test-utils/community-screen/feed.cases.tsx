/* eslint-disable @typescript-eslint/await-thenable */
import {
  mockCapture,
  SDK_ERROR_MESSAGE,
  item,
  cursor,
  feedJson,
  errorEnvelope,
  feedUrls,
  serveFeed,
  setMockParams,
} from './harness'
import { routing } from './mock-state'
import { userEvent as browserUser } from 'vitest/browser'
import { screen, waitFor, within, fireEvent, act } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { cleanup, render } from 'vitest-browser-react'
import { expect, it, vi } from 'vitest'
import { CLIMATE_BANDS } from '@couture/utils'
import {
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  communityBandUnresolvedReasonSchema,
  type CommunityFeedMode,
} from '@couture/api-client/contracts/http'
import { AccessibilityInfo, Platform, findNodeHandle } from 'react-native'
import { CommunityScreen } from '@/src/features/community/community-screen'
import enUS from '@/assets/locales/en-US.json'
import { press } from '@/src/test-utils/press'
import { server } from '@/src/test-utils/msw/server'
import { getCommunityPostFromMobile } from '@/src/lib/community'
import { saveLocationFromSearchFromMobile } from '@/src/lib/locations'
import { savedLocation } from '@/src/test-utils/locations'
import { registerShareCardHeading } from '@/src/lib/share-card-focus'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'

/** Gives every host node its own native handle, so focus targets stay distinguishable. */
function distinctNodeHandles() {
  const handles = new Map<unknown, number>()
  const handleOf = (node: unknown) => {
    if (!handles.has(node)) handles.set(node, 500 + handles.size)
    return handles.get(node) ?? null
  }
  vi.mocked(findNodeHandle).mockImplementation(handleOf)
  return handleOf
}

export function registerCommunityFeedCases() {
  it.each([
    ['published', true],
    ['pending_review', false],
    ['flagged', false],
    ['withdrawn', false],
  ] as const)(
    'M2: an own %s notification detail offers export=%s',
    async (status, exportable) => {
      setMockParams({ source: 'notification', type: 'community', cardId: 'own-private' })
      serveFeed(() => feedJson({ items: [] }))
      server.use(
        http.get('*/api/v1/community/posts/own-private', () =>
          HttpResponse.json({
            data: item({
              id: 'own-private',
              status,
              publishedAt: status === 'published' ? '2026-01-01T12:00:00.000Z' : null,
              author: { displayName: 'Me', isSelf: true },
            }),
          })
        )
      )
      await render(<CommunityScreen />)
      const detail = await screen.findByTestId('highlighted-community-card-own-private')
      expect(within(detail).getByTestId('community-post-card-own-private')).toBeVisible()
      // The published row proves the detail renders the opener in the same pass, so the
      // other rows check its absence at the moment it would exist.
      if (exportable)
        expect(
          within(detail).getByTestId('community-share-card-open-own-private')
        ).toBeVisible()
      else
        expect(
          within(detail).queryByTestId('community-share-card-open-own-private')
        ).toBeNull()
    }
  )

  it('L8: the community content adds no share-card heading of its own', async () => {
    await render(<CommunityScreen />)
    await screen.findByTestId('community-screen')
    expect(screen.queryByRole('heading', { name: enUS.community.heading })).toBeNull()
  })

  it('L8: closing the composer without an invoker node focuses the registered navigation heading', async () => {
    serveFeed(() =>
      feedJson({ items: [item({ author: { displayName: 'Own look', isSelf: true } })] })
    )
    const setFocus = vi.spyOn(AccessibilityInfo, 'setAccessibilityFocus')
    // The tab layout registers its title this way; 88 stands in for its native tag.
    const unregister = registerShareCardHeading('community', () => 88)
    try {
      await render(<CommunityScreen />)
      await browserUser.click(
        await screen.findByTestId('community-share-card-open-post-a')
      )
      expect(await screen.findByTestId('share-card-title')).toBeVisible()
      setFocus.mockClear()
      await browserUser.click(screen.getByTestId('share-card-cancel'))
      await waitFor(() => expect(setFocus).toHaveBeenCalledWith(88))
    } finally {
      unregister()
    }
  })

  it('R12 keeps a visible late detail card while stripping revoked reaction capability', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
    server.use(
      http.get('*/api/v1/community/posts/post-a', async () => {
        await held
        return HttpResponse.json({
          data: item({
            reactions: {
              counts: { applause: 1, love: 0, inspiration: 0 },
              total: 1,
              viewerReaction: null,
              revision: 1,
              generation: 0,
            },
          }),
        })
      })
    )
    try {
      await render(<CommunityScreen />)
      await screen.findByTestId('community-post-card-post-a')
      release()
      const target = await screen.findByTestId('highlighted-community-card-post-a')
      expect(within(target).getByTestId('community-post-card-post-a')).toBeVisible()
      expect(within(target).queryByTestId('community-reactions-post-a')).toBeNull()
    } finally {
      release()
    }
  })

  it.each(['post-a', 'post-b'] as const)(
    'settles a retired notification404 with authoritative eviction and discussion ownership for %s',
    async (openedPost) => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let requests = 0
      setMockParams({ source: 'notification', type: 'community', cardId: 'post-b' })
      serveFeed(() => feedJson({ items: [item(), item({ id: 'post-b' })] }))
      server.use(
        http.get('*/api/v1/community/posts/post-b', async () => {
          requests++
          await gate
          return errorEnvelope(404, 'Community post not found.')
        })
      )
      try {
        await render(<CommunityScreen />)
        await screen.findByTestId('community-post-card-post-b')
        await waitFor(() => expect(requests).toBeGreaterThan(0))
        press(await screen.findByTestId(`community-card-comments-${openedPost}`))
        await screen.findByRole('button', { name: 'Close comments' })
        fireEvent.change(screen.getByLabelText('Add a comment'), {
          target: { value: 'Owned discussion draft' },
        })
        expect(screen.getByLabelText('Add a comment')).toHaveValue(
          'Owned discussion draft'
        )
        // Settle the actual wrapper, then wait for authoritative eviction. An
        // absent banner alone cannot prove that the held result was consumed.
        const reads = vi
          .mocked(getCommunityPostFromMobile)
          .mock.results.map((result): unknown => result.value)
        expect(reads.length).toBeGreaterThan(0)
        await act(async () => {
          release()
          await Promise.allSettled(reads)
        })
        await waitFor(() =>
          expect(screen.queryByTestId('community-post-card-post-b')).toBeNull()
        )
        expect(screen.getByTestId('community-post-card-post-a')).toBeVisible()
        if (openedPost === 'post-a') {
          expect(screen.getByRole('button', { name: 'Close comments' })).toBeVisible()
          expect(screen.getByLabelText('Add a comment')).toHaveValue(
            'Owned discussion draft'
          )
        } else {
          await waitFor(() =>
            expect(screen.queryByRole('button', { name: 'Close comments' })).toBeNull()
          )
        }
        expect(screen.queryByTestId('highlighted-community-card-post-b')).toBeNull()
        expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
        expect(
          mockCapture.mock.calls.filter(([name]) => name === 'deep_link_invalid')
        ).toEqual([])
      } finally {
        release()
        await Promise.allSettled(
          vi
            .mocked(getCommunityPostFromMobile)
            .mock.results.map((result): unknown => result.value)
        )
      }
    }
  )

  it('restores close focus to the actual highlighted Comments control', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    const handleOf = distinctNodeHandles()
    setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
    server.use(
      http.get('*/api/v1/community/posts/post-a', () =>
        HttpResponse.json({ data: item() })
      )
    )
    await render(<CommunityScreen />)
    const highlight = await screen.findByTestId('highlighted-community-card-post-a')
    const invoker = within(highlight).getByTestId('community-card-comments-post-a')
    // The deep-link focus lands on the card itself first, under its own handle.
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalled()
    )
    press(invoker)
    press(await screen.findByRole('button', { name: 'Close comments' }))
    await waitFor(() => expect(findNodeHandle).toHaveBeenLastCalledWith(invoker))
    const invokerHandle = handleOf(invoker)
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
      invokerHandle
    )
    expect(vi.mocked(AccessibilityInfo.setAccessibilityFocus).mock.calls[0]).not.toEqual([
      invokerHandle,
    ])
  })

  it('restores close focus to the feed Comments control while a highlighted card is drawn', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    const handleOf = distinctNodeHandles()
    setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
    serveFeed(() => feedJson({ items: [item(), item({ id: 'post-b' })] }))
    server.use(
      http.get('*/api/v1/community/posts/post-a', () =>
        HttpResponse.json({ data: item() })
      )
    )
    await render(<CommunityScreen />)
    const highlight = await screen.findByTestId('highlighted-community-card-post-a')
    const highlightInvoker = within(highlight).getByTestId(
      'community-card-comments-post-a'
    )
    const feedInvoker = await screen.findByTestId('community-card-comments-post-b')
    expect(highlight.contains(feedInvoker)).toBe(false)
    // Settle the deep-link focus first, so the close restore is the last focus call.
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalled()
    )
    press(feedInvoker)
    press(await screen.findByRole('button', { name: 'Close comments' }))
    await waitFor(() => expect(findNodeHandle).toHaveBeenLastCalledWith(feedInvoker))
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenLastCalledWith(
      handleOf(feedInvoker)
    )
    expect(findNodeHandle).not.toHaveBeenCalledWith(highlightInvoker)
  })

  it('restores close focus to the live highlighted copy when the feed invoker unmounted', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    const handleOf = distinctNodeHandles()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // A reaction summary keeps the feed read from fencing the held detail read
    // (a summary-less item fences older reads of the same post).
    const reactions = {
      counts: { applause: 0, love: 0, inspiration: 0 },
      total: 0,
      revision: 0,
      generation: 0,
      viewerReaction: null,
    }
    setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
    serveFeed(() => feedJson({ items: [{ ...item(), reactions }] }))
    server.use(
      http.get('*/api/v1/community/posts/post-a', async () => {
        await gate
        return HttpResponse.json({ data: { ...item(), reactions } })
      })
    )
    try {
      await render(<CommunityScreen />)
      const feedInvoker = await screen.findByTestId('community-card-comments-post-a')
      press(feedInvoker)
      await screen.findByRole('button', { name: 'Close comments' })
      release()
      const highlight = await screen.findByTestId('highlighted-community-card-post-a')
      const liveInvoker = within(highlight).getByTestId('community-card-comments-post-a')
      // The feed copy of A is filtered out once the highlighted copy is drawn.
      expect(feedInvoker.isConnected).toBe(false)
      expect(screen.getAllByTestId('community-card-comments-post-a')).toEqual([
        liveInvoker,
      ])
      // Settle the deep-link focus first, so the close restore is the last focus call.
      await waitFor(() =>
        expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalled()
      )
      press(screen.getByRole('button', { name: 'Close comments' }))
      // onClose resolves and applies the focus target synchronously with the close.
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Close comments' })).toBeNull()
      )
      const liveHandle = handleOf(liveInvoker)
      expect(liveHandle).not.toBe(handleOf(feedInvoker))
      expect(vi.mocked(AccessibilityInfo.setAccessibilityFocus).mock.lastCall).toEqual([
        liveHandle,
      ])
    } finally {
      release()
    }
  })

  it('retains the last confirmed session through token read faults and resets on resolved sign-out', async () => {
    let unavailable = false,
      identity: string | undefined = 'session-token',
      reads = 0
    const unhandled: unknown[] = []
    const recordUnhandled = (event: PromiseRejectionEvent) => {
      unhandled.push(event.reason)
    }
    window.addEventListener('unhandledrejection', recordUnhandled)
    const restore = setMobileAccessTokenResolver(() => {
      reads++
      return unavailable
        ? Promise.reject(new Error('synthetic session unavailable'))
        : identity
    })
    // The session sync runs once a second; each wait spans at least one tick.
    const nextRead = async () => {
      const before = reads
      await waitFor(() => expect(reads).toBeGreaterThan(before), { timeout: 2500 })
    }
    try {
      await render(<CommunityScreen />)
      press(await screen.findByTestId('community-card-comments-post-a'))
      await screen.findByRole('button', { name: 'Close comments' })
      fireEvent.change(screen.getByLabelText('Add a comment'), {
        target: { value: 'Saved through storage failure' },
      })
      unavailable = true
      await nextRead()
      // A second failed tick proves the first rejection was settled, not left unhandled.
      await nextRead()
      expect(unhandled).toEqual([])
      expect(screen.getByRole('button', { name: 'Close comments' })).toBeVisible()
      expect(screen.getByLabelText('Add a comment')).toHaveValue(
        'Saved through storage failure'
      )
      unavailable = false
      await nextRead()
      expect(screen.getByLabelText('Add a comment')).toHaveValue(
        'Saved through storage failure'
      )
      identity = undefined
      await waitFor(
        () => expect(screen.queryByRole('button', { name: 'Close comments' })).toBeNull(),
        { timeout: 2500 }
      )
      // Signing in again finds no draft left over from the signed-out session.
      identity = 'next-session-token'
      await nextRead()
      await nextRead()
      press(screen.getByTestId('community-card-comments-post-a'))
      await screen.findByRole('button', { name: 'Close comments' })
      expect(screen.getByLabelText('Add a comment')).toHaveValue('')
    } finally {
      restore()
      window.removeEventListener('unhandledrejection', recordUnhandled)
    }
  })

  it('6.1-MOB-001 shows loading skeletons first, then the feed', async () => {
    serveFeed(async () => {
      await delay(120)
      return feedJson()
    })

    await render(<CommunityScreen />)

    expect(screen.getAllByTestId('community-feed-skeleton')).toHaveLength(3)

    await screen.findByTestId('community-post-card-post-a')
    expect(screen.queryAllByTestId('community-feed-skeleton')).toHaveLength(0)
  })

  it('6.1-MOB-002 renders the localized empty state and its share CTA', async () => {
    serveFeed(() => feedJson({ items: [] }))

    await render(<CommunityScreen />)

    const empty = await screen.findByTestId('community-feed-empty')
    expect(empty.textContent).toContain(enUS.community.feed.emptyTitle)
    expect(empty.textContent).toContain(enUS.community.feed.emptyBody)

    press(screen.getByTestId('community-feed-empty-cta'))
    await screen.findByTestId('community-post-sheet')
  })

  it('6.1-MOB-003 renders the load failure for a 500 and recovers through Retry', async () => {
    serveFeed((_url, index) =>
      index === 0 ? errorEnvelope(500, 'Internal server error.') : feedJson()
    )

    await render(<CommunityScreen />)

    const panel = await screen.findByTestId('community-feed-error')
    expect(panel.textContent).toContain(enUS.community.error.load)
    expect(panel.textContent).not.toContain(enUS.community.error.signedOut)
    // The reason travels and the words do not: never the SDK's own wording.
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)

    press(screen.getByTestId('community-feed-retry'))

    await screen.findByTestId('community-post-card-post-a')
    expect(screen.queryByTestId('community-feed-error')).toBeNull()
    expect(feedUrls).toHaveLength(2)
  })

  it('6.1-MOB-004 reads differently for a 401 than for a 500', async () => {
    serveFeed(() => errorEnvelope(401, 'Unauthorized'))

    await render(<CommunityScreen />)

    const panel = await screen.findByTestId('community-feed-error')
    expect(panel.textContent).toContain(enUS.community.error.signedOut)
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
  })

  it.each(communityBandUnresolvedReasonSchema.options)(
    '6.1-MOB-005 explains an unresolved band for %s',
    async (reason) => {
      serveFeed(() =>
        feedJson({ viewerBand: null, bandResolved: false, bandUnresolvedReason: reason })
      )

      await render(<CommunityScreen />)

      const notice = await screen.findByTestId('community-band-unresolved')
      // The whole panel, exactly: the reason's copy, plus the Story 1.2b
      // add-location action that only the no_location panel carries.
      const action = reason === 'no_location' ? enUS.locations.guided.add : ''
      expect(notice.textContent).toBe(
        `${enUS.community.band.unresolved[reason]}${action}`
      )
    }
  )

  it.each(communityBandUnresolvedReasonSchema.options)(
    '1.2b-MOB-COMMUNITY-01 offers the guided add-location action only for no_location: %s',
    async (reason) => {
      serveFeed(() =>
        feedJson({ viewerBand: null, bandResolved: false, bandUnresolvedReason: reason })
      )

      await render(<CommunityScreen />)

      const notice = await screen.findByTestId('community-band-unresolved')
      const action = within(notice).queryByTestId('community-add-location')
      if (reason !== 'no_location') {
        expect(action).toBeNull()
        return
      }
      expect(action?.textContent).toBe(enUS.locations.guided.add)
      await browserUser.click(action!)
      expect(routing.router.push).toHaveBeenCalledWith('/locations?guided=1')
    }
  )

  it('1.2b-MOB-COMMUNITY-02 resolves the band on a mounted Community tab when a location is saved elsewhere', async () => {
    let hasLocation = false
    serveFeed(() =>
      hasLocation
        ? feedJson()
        : feedJson({
            viewerBand: null,
            bandResolved: false,
            bandUnresolvedReason: 'no_location',
          })
    )
    server.use(
      http.post('*/api/v1/locations/from-search', () => {
        hasLocation = true
        return HttpResponse.json({ data: savedLocation() }, { status: 201 })
      })
    )

    await render(<CommunityScreen />)
    await screen.findByTestId('community-add-location')

    // The save happens on the Locations screen; this tab only hears
    // `onLocationsChanged`, and nobody pulls to refresh.
    await saveLocationFromSearchFromMobile('candidate.signature', 'Home')

    await waitFor(() => {
      expect(screen.queryByTestId('community-band-unresolved')).toBeNull()
    })
    expect(screen.getByTestId('community-filter-chip-auto').textContent).toContain(
      enUS.community.filters.mode.autoWithBand.replace(
        '{{band}}',
        enUS.community.band.temperate_dry
      )
    )
    expect(feedUrls).toHaveLength(2)
  })

  it('1.2b-MOB-COMMUNITY-03 drops the no-location notice and its action when the member signs out', async () => {
    serveFeed(() =>
      feedJson({
        viewerBand: null,
        bandResolved: false,
        bandUnresolvedReason: 'no_location',
      })
    )
    let token: string | undefined = 'session-token'
    const restore = setMobileAccessTokenResolver(() => token)
    setMobileApplicationUserId('member-a')
    try {
      await render(<CommunityScreen />)
      const notice = await screen.findByTestId('community-band-unresolved')
      expect(within(notice).getByTestId('community-add-location')).toBeVisible()

      // What signOutNativeSession does to the session boundary: the token goes
      // and the application user is cleared, which notifies identity listeners.
      token = undefined
      setMobileApplicationUserId(null)

      await waitFor(() => {
        expect(screen.queryByTestId('community-band-unresolved')).toBeNull()
      })
      expect(screen.queryByTestId('community-add-location')).toBeNull()
    } finally {
      setMobileApplicationUserId(null)
      restore()
    }
  })

  it('6.1-MOB-082 shares its one live region with the invalid deep-link notice', async () => {
    setMockParams({ source: 'notification', type: 'community' })

    await render(<CommunityScreen />)

    const banner = await screen.findByTestId('deep-link-info-banner')
    expect(banner.textContent).toContain(enUS.community.deepLink.invalid)
    expect(banner.getAttribute('aria-live')).toBe('polite')
    expect(mockCapture).toHaveBeenCalledWith(
      'deep_link_invalid',
      expect.objectContaining({ surface: 'mobile' })
    )

    // The notice is advisory, so the tab has to stay usable once it is dismissed.
    await browserUser.click(screen.getByLabelText('Dismiss banner'))
    await waitFor(() => expect(screen.queryByTestId('deep-link-info-banner')).toBeNull())
    expect(screen.getByTestId('community-screen')).toBeTruthy()
  })

  it('6.1-MOB-094 resolves a deep-linked look from the API and draws it once', async () => {
    setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
    let postReads = 0
    server.use(
      http.get('*/api/v1/community/posts/:postId', ({ params }) => {
        postReads += 1
        return HttpResponse.json({ data: item({ id: params.postId as string }) })
      })
    )

    await render(<CommunityScreen />)

    const highlight = await screen.findByTestId('highlighted-community-card-post-a')
    expect(postReads).toBe(1)

    // A real card rather than a synthetic one: the alt text the author had to
    // confirm and the moderation control are both present, and neither could be on
    // a card built from a `lookbook:new` event, which carries neither.
    expect(
      screen.getByTestId('community-card-image-post-a').getAttribute('aria-label')
    ).toBe(item().altText)
    expect(screen.getByTestId('community-card-report-post-a')).toBeTruthy()

    // The same look is also on the first feed page. It is drawn once, at the top.
    expect(screen.getAllByTestId('community-post-card-post-a')).toHaveLength(1)
    expect(highlight.contains(screen.getByTestId('community-post-card-post-a'))).toBe(
      true
    )

    // No separate visible badge: web's own highlighted card carries none, only a
    // border treatment, so this reuses web's existing announcement key instead of
    // inventing a new one that would have needed translating on a surface this
    // session may not touch.
    //
    // `waitFor`, not a synchronous assertion: `findByTestId` above resolves the
    // moment the highlighted card lands in the DOM, which a real browser can do
    // before the effect that announces it has actually run.
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        enUS.community.feed.announceFocused
      )
    )
  })

  it('6.1-MOB-084 drops a deep-link target that resolves after the tab was left', async () => {
    setMockParams({ source: 'notification', type: 'community', cardId: 'look-42' })
    server.use(
      http.get('*/api/v1/community/posts/:postId', async () => {
        await delay(200)
        return HttpResponse.json({ data: item({ id: 'look-42' }) })
      })
    )

    await render(<CommunityScreen />)
    cleanup()

    // The resolution outlived the screen, so it must neither report a failure nor
    // set state on a component that is gone.
    await delay(400)
    expect(mockCapture).not.toHaveBeenCalled()
  })

  // --- Filtering and paging -------------------------------------------------

  it('6.1-MOB-006 offers auto, all and the six climate bands, every chip enabled', async () => {
    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    for (const mode of ['auto', 'all', ...CLIMATE_BANDS]) {
      const chip = screen.getByTestId(`community-filter-chip-${mode}`)
      expect(chip.getAttribute('aria-disabled')).not.toBe('true')
    }

    // `accessibilityState` is native-only and react-native-web drops it, so the
    // active chip is identified here by its non-colour cue. The announced
    // selection itself is asserted in `components/community/community-filter-chips.test.tsx`.
    const autoChip = screen.getByTestId('community-filter-chip-auto')
    expect(autoChip.style.borderWidth).toBe('2px')
    // The resolved band rides on the `auto` chip's own label.
    expect(autoChip.textContent).toBe('Your climate: Temperate and dry')
    expect(screen.getByTestId('community-filter-chip-all').style.borderWidth).toBe('1px')
  })

  it('6.1-MOB-007 sends mode=<band> and drops the held cursor when the filter changes', async () => {
    serveFeed((url) => {
      if (url.searchParams.get('mode') === 'warm_wet') {
        return feedJson({ items: [item({ id: 'post-warm' })], mode: 'warm_wet' })
      }
      return url.searchParams.get('cursor')
        ? feedJson({ items: [item({ id: 'post-b' })], nextCursor: null })
        : feedJson({ nextCursor: 'cursor-auto-2' })
    })

    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    press(await screen.findByTestId('community-feed-load-more'))
    await screen.findByTestId('community-post-card-post-b')

    press(screen.getByTestId('community-filter-chip-warm_wet'))
    await screen.findByTestId('community-post-card-post-warm')

    const latest = feedUrls[feedUrls.length - 1]
    expect(latest?.searchParams.get('mode')).toBe('warm_wet')
    // The cursor embeds the mode it was minted under; carrying it across is a 400.
    expect(latest?.searchParams.get('cursor')).toBeNull()
    expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
    expect(screen.queryByTestId('community-post-card-post-b')).toBeNull()
  })

  it('6.1-MOB-008 never lets an abandoned filter overwrite the current one', async () => {
    serveFeed(async (url) => {
      const mode = url.searchParams.get('mode')
      if (mode === 'cold_wet') {
        // The abandoned request outlives the filter it was issued for.
        await delay(300)
        return feedJson({ items: [item({ id: 'post-cold' })], mode: 'cold_wet' })
      }
      if (mode === 'warm_dry') {
        return feedJson({ items: [item({ id: 'post-warm' })], mode: 'warm_dry' })
      }
      return feedJson()
    })

    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    press(screen.getByTestId('community-filter-chip-cold_wet'))
    press(screen.getByTestId('community-filter-chip-warm_dry'))

    await screen.findByTestId('community-post-card-post-warm')
    await delay(400)

    expect(screen.queryByTestId('community-post-card-post-cold')).toBeNull()
    expect(screen.getByTestId('community-post-card-post-warm')).toBeTruthy()
    expect(screen.getByTestId('community-filter-chip-warm_dry').style.borderWidth).toBe(
      '2px'
    )
  })

  it('6.1-MOB-009 pages on the keyset cursor and appends without duplicating', async () => {
    serveFeed((url) =>
      url.searchParams.get('cursor') === 'cursor-page-2'
        ? feedJson({
            // The server may repeat a boundary row; the client must not.
            items: [item({ id: 'post-a' }), item({ id: 'post-b' })],
            nextCursor: null,
          })
        : feedJson({ nextCursor: 'cursor-page-2' })
    )

    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    press(await screen.findByTestId('community-feed-load-more'))
    await screen.findByTestId('community-post-card-post-b')

    const paged = feedUrls.find((url) => url.searchParams.get('cursor') !== null)
    expect(paged?.searchParams.get('cursor')).toBe('cursor-page-2')
    expect(paged?.searchParams.get('mode')).toBe('auto')
    expect(screen.getAllByTestId('community-post-card-post-a')).toHaveLength(1)
  })

  it('6.1-MOB-079 keeps the feed on screen when the next page fails, and speaks beside it', async () => {
    serveFeed((url) =>
      url.searchParams.get('cursor')
        ? errorEnvelope(500, 'Internal server error.')
        : feedJson({ nextCursor: 'cursor-page-2' })
    )

    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    press(await screen.findByTestId('community-feed-load-more'))

    // A first page that fails owns the screen; a next page that fails keeps what
    // is already there.
    const panel = await screen.findByTestId('community-action-error')
    expect(screen.getByTestId('community-post-card-post-a')).toBeTruthy()
    expect(screen.queryByTestId('community-feed-error')).toBeNull()
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
    /*
     * The fallback key travels with the failure. It used to be
     * `community.error.withdraw` for EVERY unclassified action failure, so a
     * next-page read that 500'd told the reader "We could not withdraw this
     * look. It is still in the feed." after tapping Load more.
     */
    expect(panel.textContent).toBe(enUS.community.error.load)
    expect(panel.textContent).not.toBe(enUS.community.error.withdraw)
  })

  it('6.1-MOB-089 restarts paging on a rejected cursor and never sends it twice', async () => {
    // Both cursors are real: the band is what changes between them, which is the
    // whole mechanism. Under `auto` the server recomputes the band per request
    // from weather guaranteed fresh for 60 minutes, so a snapshot going stale
    // between two pages of one scroll is enough to invalidate the held cursor.
    const staleCursor = cursor('temperate_dry')
    const freshCursor = cursor('cold_dry')

    serveFeed((url) => {
      const sent = url.searchParams.get('cursor')
      if (sent === staleCursor) {
        return errorEnvelope(400, COMMUNITY_CURSOR_INVALID_MESSAGE)
      }
      if (sent === freshCursor) {
        return feedJson({ items: [item({ id: 'post-page-2' })], nextCursor: null })
      }
      return feedUrls.length === 1
        ? feedJson({ nextCursor: staleCursor })
        : feedJson({ items: [item({ id: 'post-restarted' })], nextCursor: freshCursor })
    })

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-feed-load-more'))

    await screen.findByTestId('community-post-card-post-restarted')

    // Silent recovery. This is normal operation on `auto`, not a fault, and the
    // reader is given no error to act on because there is nothing for them to do.
    expect(screen.queryByTestId('community-action-error')).toBeNull()
    expect(screen.queryByTestId('community-feed-error')).toBeNull()
    // Paging restarted, so the page the dead cursor came from is gone.
    expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()

    press(await screen.findByTestId('community-feed-load-more'))
    await screen.findByTestId('community-post-card-post-page-2')

    // THE ASSERTION THAT CATCHES THE LOOP. Surfacing an error and stopping there
    // left `nextCursor` holding the dead cursor while `feedState` stayed `ready`,
    // so `onEndReached` at threshold 0.5 re-sent it on every scroll, forever.
    // Counting the sends is what distinguishes a recovery from a retry storm; an
    // assertion that some error appeared would have passed against the defect.
    const staleSends = feedUrls.filter(
      (url) => url.searchParams.get('cursor') === staleCursor
    )
    expect(staleSends).toHaveLength(1)
  })

  it('6.1-MOB-090 shows the arm it is actually being served, not the one it asked for', async () => {
    // Half the beta cohort. The client requests `auto` by default and the server
    // resolves it to the viewer's assigned arm, so an `all` viewer used to see the
    // `auto` chip pressed and labelled "Your climate: ..." over every region.
    serveFeed(() => feedJson({ mode: 'all', experimentVariant: 'all' }))

    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    expect(screen.getByTestId('community-filter-chip-all').style.borderWidth).toBe('2px')
    expect(screen.getByTestId('community-filter-chip-auto').style.borderWidth).toBe('1px')
    expect(screen.getByTestId('community-filter-chip-auto').textContent).toBe(
      enUS.community.filters.mode.auto
    )
    // Still one read: the served mode is display state, so adopting it must not
    // send the screen round again.
    expect(feedUrls).toHaveLength(1)
  })

  it('6.1-MOB-091 explains an unresolved band only where it changed what was served', async () => {
    serveFeed((url) =>
      feedJson({
        // A pinned band and `all` are both served exactly as asked whether or not
        // the viewer's own band resolves, so neither has anything to explain.
        mode: (url.searchParams.get('mode') ?? 'auto') as CommunityFeedMode,
        viewerBand: null,
        bandResolved: false,
        bandUnresolvedReason: 'no_location',
      })
    )

    await render(<CommunityScreen />)
    await screen.findByTestId('community-band-unresolved')

    press(screen.getByTestId('community-filter-chip-warm_dry'))
    await waitFor(() =>
      expect(screen.queryByTestId('community-band-unresolved')).toBeNull()
    )

    press(screen.getByTestId('community-filter-chip-all'))
    await waitFor(() =>
      expect(screen.getByTestId('community-filter-chip-all').style.borderWidth).toBe(
        '2px'
      )
    )
    expect(screen.queryByTestId('community-band-unresolved')).toBeNull()
  })

  it('6.1-MOB-092 records a card open with the arm the feed was served in', async () => {
    const opened: { postId: string; body: unknown }[] = []
    serveFeed(() => feedJson({ mode: 'all', experimentVariant: 'all' }))
    server.use(
      http.post(
        '*/api/v1/community/posts/:postId/opened',
        async ({ params, request }) => {
          opened.push({ postId: params.postId as string, body: await request.json() })
          return HttpResponse.json({ tracked: true })
        }
      )
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-open-post-a'))

    await waitFor(() => expect(opened).toHaveLength(1))
    expect(opened[0]?.postId).toBe('post-a')
    // Sent rather than re-derived, so the open is attributed to the feed the
    // viewer actually saw. `isSelf` is absent because the server decides it: the
    // gate counts non-self opens and this client never compares ids.
    expect(opened[0]?.body).toEqual({ experimentVariant: 'all' })
  })

  it('6.1-MOB-093 keeps a failed card open away from the reader', async () => {
    server.use(
      http.post('*/api/v1/community/posts/:postId/opened', () =>
        errorEnvelope(500, 'Internal server error.')
      )
    )

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-open-post-a'))

    // Measurement only. A dropped open costs a data point; interrupting someone
    // reading the feed to say so costs more.
    await delay(100)
    expect(screen.queryByTestId('community-action-error')).toBeNull()
    expect(document.body.textContent).not.toContain(SDK_ERROR_MESSAGE)
  })

  it('6.1-MOB-080 gives accessibility focus back to the card that opened the dialog', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    vi.mocked(findNodeHandle).mockReturnValue(55)

    await render(<CommunityScreen />)
    press(await screen.findByTestId('community-card-report-post-a'))
    await screen.findByTestId('community-report-modal')

    press(screen.getByTestId('cancel-report-button'))

    // react-native-web's Modal restores focus itself; on a native surface the
    // screen has to hand it back to the invoking card explicitly.
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(55)
    )
  })
}

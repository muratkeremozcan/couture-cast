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
import { userEvent as browserUser } from '@vitest/browser/context'
import { screen, waitFor } from '@testing-library/react'
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

export function registerCommunityFeedCases() {
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
      expect(notice.textContent).toBe(enUS.community.band.unresolved[reason])
    }
  )

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

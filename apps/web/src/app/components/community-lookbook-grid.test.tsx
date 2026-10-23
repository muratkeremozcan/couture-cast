// Community grid journeys through the real web transport and MSW.
import { delay, http, HttpResponse } from 'msw'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CLIMATE_BANDS } from '@couture/utils'
import {
  communityBandUnresolvedReasonSchema,
  COMMUNITY_FEED_DISABLED_MESSAGE,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  MERLOT,
  cursorFor,
  item,
  feedBody,
  feedHandler,
  errorBody,
  signIn,
  renderGrid,
  UNRESOLVED_COPY,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  COMMUNITY_FEED_MODES,
} from '../../test-utils/community-lookbook-grid'

const posthogMocks = vi.hoisted(() => ({ capture: vi.fn() }))

vi.mock('posthog-js', () => ({
  default: { capture: posthogMocks.capture },
}))

setupCommunityGridClock()

describe('CommunityLookbookGrid (Story 6.1)', () => {
  setupCommunityGridSurface()

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

    it.each([...communityBandUnresolvedReasonSchema.options])(
      '1.2b-WEB-GRID-01 offers the guided add-location action only for no_location: %s',
      async (reason) => {
        signIn()
        useMswHandlers(
          feedHandler({
            items: [item()],
            viewerBand: null,
            bandResolved: false,
            bandUnresolvedReason: reason,
            mode: 'auto',
          })
        )
        renderGrid()

        const notice = await screen.findByTestId('community-band-unresolved')
        const action = within(notice).queryByTestId('community-add-location')
        if (reason === 'no_location') {
          expect(action?.textContent).toBe('Add a location')
          expect(action).toHaveAttribute(
            'href',
            '/settings?addLocation=1&returnTo=%2F#locations'
          )
        } else {
          expect(action).toBeNull()
        }
      }
    )

    // A reader with no session never loads a feed, so this is reachable only by
    // signing out under a notice that is already showing. The notice described
    // the member who left; it goes with its action, not after it.
    it('1.2b-WEB-GRID-02 withdraws the band notice and its add-location action on sign-out', async () => {
      signIn()
      useMswHandlers(
        feedHandler({
          items: [item()],
          viewerBand: null,
          bandResolved: false,
          bandUnresolvedReason: 'no_location',
          mode: 'auto',
        })
      )
      renderGrid()

      const notice = await screen.findByTestId('community-band-unresolved')
      expect(within(notice).getByTestId('community-add-location')).toBeInTheDocument()

      window.sessionStorage.clear()
      act(() => {
        window.dispatchEvent(new Event('couture:session'))
      })

      await waitFor(() =>
        expect(screen.queryByTestId('community-add-location')).not.toBeInTheDocument()
      )
      expect(screen.queryByTestId('community-band-unresolved')).not.toBeInTheDocument()
      expect(document.body).not.toHaveTextContent(UNRESOLVED_COPY.no_location)
    })

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
})

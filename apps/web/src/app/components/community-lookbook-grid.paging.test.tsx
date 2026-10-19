// Community grid journeys through the real web transport and MSW.
import axe from 'axe-core'
import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { COMMUNITY_CURSOR_INVALID_MESSAGE } from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  OPENED_PATH,
  cursorFor,
  item,
  feedBody,
  feedHandler,
  errorBody,
  signIn,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

setupCommunityGridClock()

describe('CommunityLookbookGrid (Story 6.1)', () => {
  setupCommunityGridSurface()

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
      let releasePage!: () => void
      const pageResponse = new Promise<void>((resolve) => {
        releasePage = resolve
      })
      let calls = 0
      useMswHandlers(
        http.get(FEED_PATH, async ({ request }) => {
          calls += 1
          const cursor = new URL(request.url).searchParams.get('cursor')
          if (cursor === null) {
            return feedBody({ items: [item()], nextCursor: cursorFor() })
          }
          await pageResponse
          return feedBody({ items: [item({ id: 'post-2' })] })
        })
      )
      try {
        const user = userEvent.setup()
        renderGrid()

        await screen.findByTestId('lookbook-card-post-1')
        const control = screen.getByTestId('load-more-button')
        await user.click(control)
        expect(control).toBeDisabled()
        await user.click(control)
        releasePage()

        await screen.findByTestId('lookbook-card-post-2')
        expect(calls).toBe(2)
      } finally {
        releasePage()
      }
    })

    it('6.1-WEB-017 disables the load-more control while the next page is in flight', async () => {
      signIn()
      let releasePage!: () => void
      const pageResponse = new Promise<void>((resolve) => {
        releasePage = resolve
      })
      useMswHandlers(
        http.get(FEED_PATH, async ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor')
          if (cursor === null) {
            return feedBody({ items: [item()], nextCursor: cursorFor() })
          }
          await pageResponse
          return feedBody({ items: [item({ id: 'post-2' })] })
        })
      )
      try {
        const user = userEvent.setup()
        renderGrid()

        await screen.findByTestId('lookbook-card-post-1')
        await user.click(screen.getByTestId('load-more-button'))

        const control = screen.getByTestId('load-more-button')
        expect(control).toBeDisabled()
        expect(control).toHaveTextContent('Loading')
        releasePage()

        await screen.findByTestId('lookbook-card-post-2')
        expect(screen.getByTestId('community-live-region')).toHaveTextContent(
          'Loaded 1 more looks.'
        )
      } finally {
        releasePage()
      }
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
})

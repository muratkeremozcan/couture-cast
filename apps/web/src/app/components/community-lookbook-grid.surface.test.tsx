// Community grid journeys through the real web transport and MSW.
import axe from 'axe-core'
import { http } from 'msw'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMMUNITY_POST_NOT_FOUND_MESSAGE } from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  ALLOCATE_PATH,
  PUBLISH_PATH,
  POST_PATH,
  IMAGE_URL,
  REFRESHED_IMAGE_URL,
  SUGGESTED_ALT_TEXT,
  isoIn,
  cursorFor,
  item,
  authorState,
  CHALLENGE,
  feedBody,
  feedHandler,
  postBody,
  errorBody,
  allocateBody,
  publishBody,
  imageFixtureHandler,
  signIn,
  renderGrid,
  installImagePrepMocks,
  choosePhoto,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  sponsoredFeedHandler,
  sponsoredItem,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

setupCommunityGridClock()

describe('CommunityLookbookGrid (Story 6.1)', () => {
  setupCommunityGridSurface()

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
      // The challenge arrives with the feed, which can answer after the dialog opens.
      await user.selectOptions(await screen.findByTestId('post-challenge-select'), '')
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
      useMswHandlers(
        sponsoredFeedHandler({ items: [sponsoredItem(), item({ id: 'post-2' })] })
      )
      renderGrid()

      const badge = await screen.findByTestId('sponsored-badge-post-1')
      expect(within(badge).getByText('Partnered')).toHaveAttribute('aria-hidden', 'true')
      expect(within(badge).getByText('Partnered with Atelier North')).toHaveClass(
        'sr-only'
      )
      // Story 6.7b: only the response's own sponsorship block makes a card claim
      // a commercial relationship.
      await screen.findByTestId('lookbook-card-post-2')
      expect(screen.queryByTestId('sponsored-badge-post-2')).not.toBeInTheDocument()
    })

    it('6.1-WEB-073 renders the live region without React warnings', async () => {
      signIn()
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      useMswHandlers(
        feedHandler({ items: [item(), item({ id: 'post-2' })] }),
        http.get(POST_PATH, () => postBody({ id: 'post-2' }))
      )
      renderGrid({ highlightedCardId: 'post-2' })
      await screen.findByTestId('lookbook-card-post-1')
      await waitFor(() =>
        expect(screen.getByTestId('lookbook-card-post-2')).toHaveFocus()
      )
      await waitFor(() =>
        expect(screen.getByTestId('community-live-region')).toHaveTextContent(
          'Focused on the highlighted look.'
        )
      )
      // Every list the grid renders needs a stable key, the announcement list included.
      expect(
        errors.mock.calls
          .map((call: unknown[]) => String(call[0]))
          .filter((text) => /key/i.test(text))
      ).toEqual([])
    })

    it('6.1-WEB-072 keeps the focus announcement, then adds the feed one, when the feed answers after the deep link', async () => {
      signIn()
      let releaseFeed: () => void = () => undefined
      const feedGate = new Promise<void>((resolve) => {
        releaseFeed = resolve
      })
      useMswHandlers(
        http.get(FEED_PATH, async () => {
          await feedGate
          return feedBody({ items: [item(), item({ id: 'post-2' })] })
        }),
        http.get(POST_PATH, () => postBody({ id: 'post-2' }))
      )
      renderGrid({ highlightedCardId: 'post-2' })

      // The deep link answers first and takes focus while the feed read is still open.
      await waitFor(() =>
        expect(screen.getByTestId('lookbook-card-post-2')).toHaveFocus()
      )
      const region = screen.getByTestId('community-live-region')
      await waitFor(() =>
        expect(region).toHaveTextContent('Focused on the highlighted look.')
      )

      releaseFeed()
      await screen.findByTestId('lookbook-card-post-1')
      // A polite region speaks what it holds, so the feed's message must not replace the
      // focus message: both stay, in the order they happened.
      await waitFor(() =>
        expect(region.textContent).toMatch(
          /^Focused on the highlighted look\. Showing .+ looks\. 2 loaded\.$/
        )
      )
    })

    it('6.1-WEB-049 focuses and announces the card a deep link points at', async () => {
      signIn()
      useMswHandlers(
        feedHandler({ items: [item(), item({ id: 'post-2' })] }),
        http.get(POST_PATH, () => postBody({ id: 'post-2' }))
      )
      renderGrid({ highlightedCardId: 'post-2' })

      // The deep-link detail can render post-2 before the feed page that holds post-1 lands,
      // so each card is looked up again once the feed has arrived.
      await waitFor(() => {
        expect(screen.getByTestId('lookbook-card-post-1')).toHaveAttribute(
          'data-highlighted',
          'false'
        )
        expect(screen.getByTestId('lookbook-card-post-2')).toHaveAttribute(
          'data-highlighted',
          'true'
        )
      })
      await waitFor(() =>
        expect(screen.getByTestId('lookbook-card-post-2')).toHaveFocus()
      )
      await waitFor(() =>
        expect(screen.getByTestId('community-live-region')).toHaveTextContent(
          'Focused on the highlighted look.'
        )
      )
    })

    it.each([
      { offPage: false, append: false },
      { offPage: true, append: false },
      { offPage: true, append: true },
    ])(
      'keeps a highlighted card in accepted feed order (off-page: $offPage, append: $append)',
      async ({ offPage, append }) => {
        signIn()
        let refreshed = false
        let detailReads = 0
        let releaseDetail!: () => void
        const detailGate = new Promise<void>((resolve) => {
          releaseDetail = resolve
        })
        useMswHandlers(
          http.get(FEED_PATH, () =>
            feedBody({
              mode: refreshed && !append ? 'all' : 'auto',
              nextCursor: append && !refreshed ? cursorFor() : null,
              items:
                !refreshed && offPage
                  ? [item()]
                  : refreshed && append
                    ? [item({ id: 'post-2' })]
                    : [item(), item({ id: 'post-2' })],
            })
          ),
          http.get(POST_PATH, async () => {
            detailReads += 1
            if (refreshed) await detailGate
            return postBody({ id: 'post-2' })
          })
        )
        const user = userEvent.setup()
        renderGrid({ highlightedCardId: 'post-2' })
        await screen.findByTestId('lookbook-card-post-2')
        await waitFor(() =>
          expect(screen.getByTestId('community-card-grid')).toHaveAttribute(
            'aria-busy',
            'false'
          )
        )
        const initialReads = detailReads
        refreshed = true
        try {
          await user.click(
            screen.getByTestId(append ? 'load-more-button' : 'community-filter-all')
          )
          await waitFor(() => expect(detailReads).toBeGreaterThan(initialReads))
          expect(
            within(screen.getByTestId('community-card-grid'))
              .getAllByRole('article')
              .map((card) => card.getAttribute('data-testid'))
          ).toEqual(['lookbook-card-post-1', 'lookbook-card-post-2'])
          releaseDetail()
          await waitFor(() =>
            expect(screen.getByTestId('community-card-grid')).toHaveAttribute(
              'aria-busy',
              'false'
            )
          )
          expect(
            within(screen.getByTestId('community-card-grid'))
              .getAllByRole('article')
              .map((card) => card.getAttribute('data-testid'))
          ).toEqual(['lookbook-card-post-1', 'lookbook-card-post-2'])
        } finally {
          releaseDetail()
        }
      }
    )

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

      // The deep-link look renders first; the feed's two looks follow once its read lands.
      await waitFor(() => {
        const cards = within(screen.getByTestId('community-card-grid')).getAllByRole(
          'article'
        )
        expect(cards).toHaveLength(3)
        expect(cards[0]).toBe(card)
      })
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
        sponsoredFeedHandler({
          items: [item(), sponsoredItem({ id: 'post-2', caption: null, altText: null })],
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
      const { container } = renderGrid()

      await screen.findByTestId('lookbook-card-post-1')
      await screen.findByTestId('sponsored-cta-post-2')

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

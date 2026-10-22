// Story 6.6: the City Spotlight module through the real web transport and MSW.
// Paging lives in community-spotlight.paging.test.tsx and realtime in
// community-spotlight.realtime.test.tsx.
import axe from 'axe-core'
import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  type SetCommunityReactionInput,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  OPENED_PATH,
  WITHDRAW_PATH,
  errorBody,
  feedHandler,
  item,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'
import {
  SPOTLIGHT_PATH,
  ZERO,
  ranked,
  reactionFeedBody,
  spotlightBody,
} from '../../test-utils/community-spotlight'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

setupCommunityGridClock()

describe('CommunitySpotlightSection (Story 6.6)', () => {
  setupCommunityGridSurface()

  it('6.6-WEB-001 heads the section with the viewer area and the ranked cards in order', async () => {
    signIn()
    const headers: (string | null)[] = []
    useMswHandlers(
      feedHandler({ items: [item({ id: 'spot-1' })] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        headers.push(request.headers.get('x-couture-reactions'))
        return spotlightBody({ items: [ranked(1), ranked(2), ranked(3)] })
      })
    )
    renderGrid()

    const section = await screen.findByTestId('community-spotlight')
    const heading = within(section).getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('Spotlight in Lisbon')
    expect(section).toHaveAttribute('data-level', 'city')
    const list = await within(section).findByTestId('community-spotlight-list')
    const entries = within(list).getAllByRole('listitem')
    expect(entries.map((entry) => entry.getAttribute('data-rank'))).toEqual([
      '1',
      '2',
      '3',
    ])
    expect(
      entries.map((entry) => within(entry).getByText(/^Rank \d+$/).textContent)
    ).toEqual(['Rank 1', 'Rank 2', 'Rank 3'])
    // The spotlight copy of a post never shares an id with its feed copy.
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toBeInTheDocument()
    expect(await screen.findByTestId('lookbook-card-spot-1')).toBeInTheDocument()
    expect(document.querySelectorAll('#lookbook-card-spot-1')).toHaveLength(1)
    expect(document.querySelectorAll('#spotlight-lookbook-card-spot-1')).toHaveLength(1)
    // The module is the first thing in the community section.
    expect(section.parentElement?.firstElementChild).toBe(section)
    expect(headers).toEqual(['1'])
  })

  it('6.6-WEB-003 opens the existing detail and records only the spotlight open with its rank', async () => {
    signIn()
    const opened: { postId: string; body: unknown }[] = []
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1), ranked(2)] })),
      http.post(OPENED_PATH, async ({ request, params }) => {
        opened.push({ postId: String(params.postId), body: await request.json() })
        return HttpResponse.json({ tracked: true })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    await user.click(screen.getByTestId('spotlight-lookbook-open-spot-2'))

    const detail = await screen.findByTestId('community-detail')
    expect(within(detail).getByTestId('community-detail-caption').textContent).toBe(
      'Spotlight look 2'
    )
    await waitFor(() => {
      expect(opened).toHaveLength(1)
    })
    expect(opened).toEqual([
      // Story 6.6 R3: the open carries the level the page was served at.
      { postId: 'spot-2', body: { surface: 'spotlight', rank: 2, level: 'city' } },
    ])

    // Barrier: a second open lands after anything the first one sent, so a late
    // duplicate or a feed card-open from the first click would show here.
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByTestId('community-detail')).not.toBeInTheDocument()
    )
    await user.click(screen.getByTestId('spotlight-lookbook-open-spot-1'))
    await waitFor(() => expect(opened).toHaveLength(2))
    expect(opened).toEqual([
      { postId: 'spot-2', body: { surface: 'spotlight', rank: 2, level: 'city' } },
      { postId: 'spot-1', body: { surface: 'spotlight', rank: 1, level: 'city' } },
    ])
  })

  it('6.6-WEB-004 shows the empty state when no level meets the privacy cohort', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ level: 'none', label: null }))
    )
    renderGrid()

    const empty = await screen.findByTestId('community-spotlight-empty')
    expect(empty).toHaveTextContent('No spotlight near you yet')
    expect(screen.getByTestId('community-spotlight-heading').textContent).toBe(
      'City Spotlight'
    )
    expect(screen.queryByTestId('community-spotlight-list')).not.toBeInTheDocument()
  })

  it('6.6-WEB-005 renders the localized disabled state for the read rollout refusal', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () =>
        HttpResponse.json(
          { statusCode: 403, code: 'denied', message: COMMUNITY_FEED_DISABLED_MESSAGE },
          { status: 403 }
        )
      )
    )
    renderGrid()

    expect((await screen.findByTestId('community-spotlight-disabled')).textContent).toBe(
      'The City Spotlight is temporarily unavailable.'
    )
    expect(screen.queryByTestId('community-spotlight-error')).not.toBeInTheDocument()
  })

  it('6.6-WEB-006 recovers from a failed read through its retry control', async () => {
    signIn()
    let attempts = 0
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () => {
        attempts += 1
        return attempts === 1
          ? errorBody(500, 'Internal server error', 'Internal Server Error', {
              status: 500,
            })
          : spotlightBody({ items: [ranked(1)] })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    const failure = await screen.findByTestId('community-spotlight-error')
    expect(failure).toHaveTextContent('We could not load the City Spotlight.')
    await user.click(screen.getByTestId('community-spotlight-retry-button'))
    expect(
      await screen.findByTestId('spotlight-lookbook-card-spot-1')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('community-spotlight-error')).not.toBeInTheDocument()
  })

  it('6.6-WEB-009 has no axe violations with ranked looks and an open detail', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [item()] }),
      http.get(SPOTLIGHT_PATH, () =>
        spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'cursor-2' })
      ),
      http.post(OPENED_PATH, () => HttpResponse.json({ tracked: true }))
    )
    const user = userEvent.setup()
    const { container } = renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    await screen.findByTestId('lookbook-card-post-1')
    const run = async () => {
      const results = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      })
      expect(
        results.violations.map((violation) => violation.id),
        JSON.stringify(results.violations, null, 2)
      ).toEqual([])
    }
    await run()
    await user.click(screen.getByTestId('spotlight-lookbook-open-spot-1'))
    await screen.findByTestId('community-detail')
    await run()
  })

  // --- Story 6.6 code review round 1 remedies (TEA) ---------------------------

  it('6.6-WEB-030 an age-gated viewer gets the localized disabled state, never an error with retry (R7)', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () =>
        HttpResponse.json(
          { statusCode: 403, code: 'denied', message: COMMUNITY_AGE_GATE_DENIED_MESSAGE },
          { status: 403 }
        )
      )
    )
    renderGrid()

    expect((await screen.findByTestId('community-spotlight-disabled')).textContent).toBe(
      'The City Spotlight is temporarily unavailable.'
    )
    expect(screen.queryByTestId('community-spotlight-error')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('community-spotlight-retry-button')
    ).not.toBeInTheDocument()
  })

  it('6.6-WEB-031 a reaction on the spotlight copy updates the feed copy of the same post (R10)', async () => {
    signIn()
    let summary = ZERO
    const requests: SetCommunityReactionInput[] = []
    useMswHandlers(
      http.get(FEED_PATH, () =>
        reactionFeedBody([{ ...item({ id: 'spot-1' }), reactions: summary }])
      ),
      http.get(SPOTLIGHT_PATH, () =>
        spotlightBody({ items: [ranked(1, { reactions: summary })] })
      ),
      http.put(
        '/api/v1/community/posts/:postId/reaction',
        async ({ request, params }) => {
          expect(params.postId).toBe('spot-1')
          const intent = (await request.json()) as SetCommunityReactionInput
          requests.push(intent)
          summary = {
            counts: { applause: 1, love: 0, inspiration: 0 },
            total: 1,
            revision: summary.revision + 1,
            generation: summary.generation + 1,
            viewerReaction: 'applause',
          }
          return HttpResponse.json({ data: summary })
        }
      )
    )
    const user = userEvent.setup()
    renderGrid()

    const spotlightCopy = await screen.findByTestId(
      'spotlight-community-reactions-spot-1'
    )
    const feedCopy = await screen.findByTestId('community-reactions-spot-1')
    await user.click(within(spotlightCopy).getByRole('button', { name: 'Applaud, 0' }))

    for (const copy of [spotlightCopy, feedCopy])
      await waitFor(() =>
        expect(within(copy).getByRole('button', { name: 'Applaud, 1' })).toHaveAttribute(
          'aria-pressed',
          'true'
        )
      )
    expect(requests.map((request) => request.selection)).toEqual(['applause'])
  })

  it('6.6-WEB-032 withdrawing an own look from the spotlight removes its spotlight copy (R10)', async () => {
    signIn()
    let withdrawn: string | null = null
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () =>
        spotlightBody({
          items: [
            ranked(1),
            ranked(2, {
              id: 'spot-self',
              author: { displayName: 'You', isSelf: true },
            }),
          ],
        })
      ),
      http.post(WITHDRAW_PATH, ({ params }) => {
        withdrawn = String(params.postId)
        return HttpResponse.json({ tracked: true })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-self')
    await user.click(screen.getByTestId('spotlight-withdraw-button-spot-self'))

    await waitFor(() => expect(withdrawn).toBe('spot-self'))
    await waitFor(() =>
      expect(
        screen.queryByTestId('spotlight-lookbook-card-spot-self')
      ).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('community-spotlight-list'))
        .getAllByRole('listitem')
        .map((entry) => entry.getAttribute('data-rank'))
    ).toEqual(['1'])
  })

  it('6.6-WEB-082 a spotlight served at level none records no spotlight open (R3)', async () => {
    signIn()
    const opened: { postId: string; body: unknown }[] = []
    useMswHandlers(
      feedHandler({ items: [item()] }),
      http.get(SPOTLIGHT_PATH, () =>
        spotlightBody({ level: 'none', label: null, items: [ranked(1)] })
      ),
      http.post(OPENED_PATH, async ({ request, params }) => {
        opened.push({ postId: String(params.postId), body: await request.json() })
        return HttpResponse.json({ tracked: true })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    await screen.findByTestId('lookbook-card-post-1')
    await user.click(screen.getByTestId('spotlight-lookbook-open-spot-1'))
    // The detail still opens; only the analytics event is withheld.
    expect(
      within(await screen.findByTestId('community-detail')).getByTestId(
        'community-detail-caption'
      ).textContent
    ).toBe('Spotlight look 1')
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByTestId('community-detail')).not.toBeInTheDocument()
    )

    // Barrier: the feed open lands after anything the spotlight open sent.
    await user.click(screen.getByTestId('lookbook-open-post-1'))
    await waitFor(() => expect(opened).toHaveLength(1))
    expect(opened).toEqual([{ postId: 'post-1', body: { experimentVariant: 'auto' } }])
  })

  it('6.6-WEB-083 the keyboard opens the detail from a spotlight card and Escape returns focus to that copy (AC4)', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [item({ id: 'spot-2' })] }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1), ranked(2)] })),
      http.post(OPENED_PATH, () => HttpResponse.json({ tracked: true }))
    )
    const user = userEvent.setup()
    renderGrid()

    const open = await screen.findByTestId('spotlight-lookbook-open-spot-2')
    const feedOpen = await screen.findByTestId('lookbook-open-spot-2')
    open.focus()
    await user.keyboard('{Enter}')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('community-detail-caption').textContent).toBe(
      'Spotlight look 2'
    )
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(
      screen.getByTestId('spotlight-lookbook-open-spot-2')
    )
    expect(document.activeElement).not.toBe(feedOpen)
  })
})

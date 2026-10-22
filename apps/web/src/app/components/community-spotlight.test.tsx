// Story 6.6: the City Spotlight module through the real web transport and MSW.
import axe from 'axe-core'
import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  communityReactionSpotlightResponseSchema,
  type CommunityReactionSpotlight,
  type CommunityReactionSpotlightItem,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  OPENED_PATH,
  errorBody,
  feedHandler,
  item,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

const SPOTLIGHT_PATH = '/api/v1/community/spotlight'

setupCommunityGridClock()

function ranked(rank: number, overrides: Partial<CommunityReactionSpotlightItem> = {}) {
  return {
    ...item({
      id: `spot-${rank}`,
      caption: `Spotlight look ${rank}`,
      author: { displayName: `Explorer ${rank}`, isSelf: false },
    }),
    rank,
    ...overrides,
  } satisfies CommunityReactionSpotlightItem
}

function spotlightBody(overrides: Partial<CommunityReactionSpotlight> = {}) {
  return HttpResponse.json(
    communityReactionSpotlightResponseSchema.parse({
      data: {
        level: 'city',
        label: 'Lisbon',
        items: [],
        nextCursor: null,
        ...overrides,
      },
    }) as unknown as Record<string, unknown>
  )
}

function liveRegionText() {
  return screen.getByTestId('community-live-region').textContent
}

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
    expect(entries.map((entry) => entry.querySelector('.sr-only')?.textContent)).toEqual([
      'Rank 1',
      'Rank 2',
      'Rank 3',
    ])
    // The spotlight copy of a post never shares an id with its feed copy.
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toBeInTheDocument()
    expect(await screen.findByTestId('lookbook-card-spot-1')).toBeInTheDocument()
    expect(document.querySelectorAll('#lookbook-card-spot-1')).toHaveLength(1)
    expect(document.querySelectorAll('#spotlight-lookbook-card-spot-1')).toHaveLength(1)
    // The module is the first thing in the community section.
    expect(section.parentElement?.firstElementChild).toBe(section)
    expect(headers).toEqual(['1'])
  })

  it('6.6-WEB-002 View more appends the next page, focuses its first card and announces once', async () => {
    signIn()
    const cursors: (string | null)[] = []
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        return cursor === null
          ? spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'cursor-2' })
          : // Rank 4 failed live visibility server-side and is skipped by index.
            spotlightBody({ items: [ranked(3), ranked(5)], nextCursor: null })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    const firstNew = await screen.findByTestId('spotlight-lookbook-card-spot-3')
    await waitFor(() => {
      expect(document.activeElement).toBe(firstNew)
    })
    expect(liveRegionText()).toBe('Loaded 2 more spotlight looks.')
    expect(
      within(screen.getByTestId('community-spotlight-list'))
        .getAllByRole('listitem')
        .map((entry) => entry.getAttribute('data-rank'))
    ).toEqual(['1', '2', '3', '5'])
    expect(cursors).toEqual([null, 'cursor-2'])
    // The last page carries no cursor, so the control retires.
    expect(screen.queryByTestId('community-spotlight-view-more')).not.toBeInTheDocument()
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
      { postId: 'spot-2', body: { surface: 'spotlight', rank: 2 } },
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

  it('6.6-WEB-007 restarts from page one when the server refuses a stale cursor', async () => {
    signIn()
    const cursors: (string | null)[] = []
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        if (cursor === 'stale')
          return HttpResponse.json(
            {
              statusCode: 400,
              code: 'invalid_cursor',
              message: COMMUNITY_CURSOR_INVALID_MESSAGE,
            },
            { status: 400 }
          )
        return cursors.length === 1
          ? spotlightBody({ items: [ranked(1)], nextCursor: 'stale' })
          : spotlightBody({
              level: 'region',
              label: 'Lisboa',
              items: [ranked(1, { id: 'fresh-1' })],
            })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    const fresh = await screen.findByTestId('spotlight-lookbook-card-fresh-1')
    expect(screen.queryByTestId('spotlight-lookbook-card-spot-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('community-spotlight-heading').textContent).toBe(
      'Spotlight in Lisboa'
    )
    await waitFor(() => {
      expect(document.activeElement).toBe(fresh)
    })
    expect(liveRegionText()).toBe(
      'The City Spotlight was refreshed with the latest ranking.'
    )
    expect(cursors).toEqual([null, 'stale', null])
  })

  it('6.6-WEB-008 keeps loaded looks and offers View more again when a page fails', async () => {
    signIn()
    let failed = false
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        if (cursor === null)
          return spotlightBody({ items: [ranked(1)], nextCursor: 'cursor-2' })
        if (!failed) {
          failed = true
          return new HttpResponse(null, { status: 500 })
        }
        return spotlightBody({ items: [ranked(2)], nextCursor: null })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    expect(
      (await screen.findByTestId('community-spotlight-more-error')).textContent
    ).toBe('We could not load the City Spotlight.')
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toBeInTheDocument()
    await user.click(screen.getByTestId('community-spotlight-view-more'))
    expect(
      await screen.findByTestId('spotlight-lookbook-card-spot-2')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('community-spotlight-more-error')).not.toBeInTheDocument()
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
})

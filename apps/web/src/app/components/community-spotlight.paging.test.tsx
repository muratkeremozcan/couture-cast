// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-72-calm-community-with-an-empty-state
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Story 6.6: City Spotlight paging, View more and the row layout, through the
// real web transport and MSW.
import { http, HttpResponse } from 'msw'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { COMMUNITY_CURSOR_INVALID_MESSAGE } from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  OPENED_PATH,
  POST_PATH,
  feedHandler,
  postBody,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'
import {
  SPOTLIGHT_PATH,
  liveRegionText,
  pageOneReads,
  ranked,
  feedSettled,
  recordAnnouncements,
  spotlightBody,
} from '../../test-utils/community-spotlight'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

setupCommunityGridClock()

describe('CommunitySpotlightSection paging (Story 6.6)', () => {
  setupCommunityGridSurface()

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
    await feedSettled()
    const announcements = recordAnnouncements()
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    const firstNew = await screen.findByTestId('spotlight-lookbook-card-spot-3')
    await waitFor(() => {
      expect(document.activeElement).toBe(firstNew)
    })
    expect(liveRegionText()).toBe('Loaded 2 more spotlight looks.')
    expect(
      screen
        .getAllByTestId(/^spotlight-lookbook-card-/)
        .map((card) => card.id.split('-').at(-1))
    ).toEqual(['1', '2', '3', '5'])
    expect(cursors).toEqual([null, 'cursor-2'])
    // The last page carries no cursor, so the control retires.
    expect(screen.queryByTestId('community-spotlight-view-more')).not.toBeInTheDocument()
    expect(
      announcements.seen.filter((text) => text === 'Loaded 2 more spotlight looks.')
    ).toHaveLength(1)
    announcements.stop()
  })

  it('6.6-WEB-007 restarts from page one when the server refuses a stale cursor', async () => {
    signIn()
    const cursors: (string | null)[] = []
    const opened: { postId: string; body: unknown }[] = []
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
      }),
      http.post(OPENED_PATH, async ({ request, params }) => {
        opened.push({ postId: String(params.postId), body: await request.json() })
        return HttpResponse.json({ tracked: true })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    await feedSettled()
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    const fresh = await screen.findByTestId('spotlight-lookbook-card-fresh-1')
    expect(screen.queryByTestId('spotlight-lookbook-card-spot-1')).not.toBeInTheDocument()
    expect(fresh).toHaveTextContent('Near you')
    await waitFor(() => {
      expect(document.activeElement).toBe(fresh)
    })
    expect(liveRegionText()).toBe(
      'The City Spotlight was refreshed with the latest ranking.'
    )
    expect(cursors).toEqual([null, 'stale', null])

    // An open after the restart records the level the new page was served at.
    await user.click(screen.getByTestId('spotlight-lookbook-open-fresh-1'))
    await waitFor(() => expect(opened).toHaveLength(1))
    expect(opened).toEqual([
      { postId: 'fresh-1', body: { surface: 'spotlight', rank: 1, level: 'region' } },
    ])
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
    await feedSettled()
    const announcements = recordAnnouncements()
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    expect(
      (await screen.findByTestId('community-spotlight-more-error')).textContent
    ).toBe('We could not load the City Spotlight.')
    expect(screen.getByTestId('spotlight-lookbook-card-spot-1')).toBeInTheDocument()
    expect(screen.getByTestId('community-spotlight-view-more')).toBeEnabled()
    await waitFor(() =>
      expect(liveRegionText()).toBe('We could not load the City Spotlight.')
    )
    expect(
      announcements.seen.filter(
        (text) => text === 'We could not load the City Spotlight.'
      )
    ).toHaveLength(1)
    announcements.stop()
    await user.click(screen.getByTestId('community-spotlight-view-more'))
    expect(
      await screen.findByTestId('spotlight-lookbook-card-spot-2')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('community-spotlight-more-error')).not.toBeInTheDocument()
  })

  it('6.6-WEB-034 a View more page that adds nothing announces nothing and keeps View more while a cursor remains (R11)', async () => {
    signIn()
    const cursors: (string | null)[] = []
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        if (cursor === null)
          return spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'cursor-2' })
        // Every entry on this page failed live visibility server-side.
        if (cursor === 'cursor-2')
          return spotlightBody({ items: [], nextCursor: 'cursor-3' })
        return spotlightBody({ items: [ranked(9)], nextCursor: null })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    await feedSettled()
    const announcements = recordAnnouncements()
    const viewMore = screen.getByTestId('community-spotlight-view-more')
    await user.click(viewMore)

    await waitFor(() => expect(cursors).toEqual([null, 'cursor-2']))
    await waitFor(() =>
      expect(screen.getByTestId('community-spotlight-view-more')).not.toBeDisabled()
    )
    expect(announcements.seen.filter((text) => /Loaded/.test(text))).toEqual([])
    expect(
      screen
        .getAllByTestId(/^spotlight-lookbook-card-/)
        .map((card) => card.id.split('-').at(-1))
    ).toEqual(['1', '2'])

    // The remaining ranks stay reachable through the cursor the empty page returned.
    await user.click(screen.getByTestId('community-spotlight-view-more'))
    const ninth = await screen.findByTestId('spotlight-lookbook-card-spot-9')
    await waitFor(() => expect(document.activeElement).toBe(ninth))
    expect(cursors).toEqual([null, 'cursor-2', 'cursor-3'])
    expect(announcements.seen.filter((text) => /Loaded/.test(text))).toEqual([
      'Loaded 1 more spotlight look.',
    ])
    announcements.stop()
  })

  it('6.6-WEB-035 counts and focus use only newly appended looks when a page repeats one (R11)', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === null
          ? spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'cursor-2' })
          : spotlightBody({ items: [ranked(2), ranked(3)], nextCursor: null })
      )
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    await feedSettled()
    const announcements = recordAnnouncements()
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    const third = await screen.findByTestId('spotlight-lookbook-card-spot-3')
    await waitFor(() => expect(document.activeElement).toBe(third))
    expect(liveRegionText()).toBe('Loaded 1 more spotlight look.')
    expect(announcements.seen.filter((text) => /Loaded/.test(text))).toEqual([
      'Loaded 1 more spotlight look.',
    ])
    expect(screen.getAllByTestId('spotlight-lookbook-card-spot-2')).toHaveLength(1)
    announcements.stop()
  })

  it('6.6-WEB-036 a cursor-invalid restart focuses the first card and announces the refresh once (R11)', async () => {
    signIn()
    let reads = 0
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        reads += 1
        if (new URL(request.url).searchParams.get('cursor'))
          return HttpResponse.json(
            {
              statusCode: 400,
              code: 'invalid_cursor',
              message: COMMUNITY_CURSOR_INVALID_MESSAGE,
            },
            { status: 400 }
          )
        return spotlightBody({
          items: [ranked(1, { id: reads === 1 ? 'old-1' : 'new-1' })],
          nextCursor: reads === 1 ? 'stale' : null,
        })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-old-1')
    await feedSettled()
    const announcements = recordAnnouncements()
    await user.click(screen.getByTestId('community-spotlight-view-more'))

    const fresh = await screen.findByTestId('spotlight-lookbook-card-new-1')
    await waitFor(() => expect(document.activeElement).toBe(fresh))
    const refreshed = 'The City Spotlight was refreshed with the latest ranking.'
    await waitFor(() => expect(liveRegionText()).toBe(refreshed))
    expect(announcements.seen.filter((text) => text === refreshed)).toHaveLength(1)
    expect(announcements.seen.filter((text) => /Loaded/.test(text))).toEqual([])
    announcements.stop()
  })

  it('6.6-WEB-037 an empty first page with a next cursor keeps View more and never shows the empty state (R12)', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [], mode: 'all' }),
      http.get(SPOTLIGHT_PATH, ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === null
          ? spotlightBody({ items: [], nextCursor: 'cursor-2' })
          : spotlightBody({ items: [ranked(7)], nextCursor: null })
      )
    )
    const user = userEvent.setup()
    renderGrid()

    const viewMore = await screen.findByTestId('community-spotlight-view-more')
    expect(screen.queryByTestId('community-spotlight-empty')).not.toBeInTheDocument()
    await user.click(viewMore)
    expect(
      await screen.findByTestId('spotlight-lookbook-card-spot-7')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('community-spotlight-empty')).not.toBeInTheDocument()
  })

  it('6.6-WEB-038 the empty state shows only with no looks and no next cursor (R12)', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [], nextCursor: null }))
    )
    renderGrid()

    await screen.findByTestId('community-feed-empty')
    expect(screen.queryAllByTestId(/^spotlight-lookbook-card-/)).toHaveLength(0)
    expect(screen.queryByTestId('community-spotlight-view-more')).not.toBeInTheDocument()
  })

  it('6.6-WEB-039 an image retry on a spotlight card retries that image and keeps every loaded page (R13)', async () => {
    signIn()
    const cursors: (string | null)[] = []
    const postReads: string[] = []
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        return cursor === null
          ? spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'cursor-2' })
          : spotlightBody({ items: [ranked(3)], nextCursor: null })
      }),
      http.get(POST_PATH, ({ params }) => {
        postReads.push(String(params.postId))
        return postBody({ id: String(params.postId) })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    await user.click(screen.getByTestId('community-spotlight-view-more'))
    await screen.findByTestId('spotlight-lookbook-card-spot-3')

    const surface = screen.getByTestId('spotlight-lookbook-image-spot-1')
    fireEvent.error(surface.querySelector('img') as HTMLImageElement)
    const retry = await screen.findByTestId('spotlight-image-retry-button-spot-1')
    // The automatic refresh returned the same signed URL, so the copy stays failed.
    await waitFor(() => expect(postReads).toEqual(['spot-1']))
    await user.click(retry)

    await waitFor(() =>
      expect(
        screen.getByTestId('spotlight-lookbook-image-spot-1').querySelector('img')
      ).not.toBeNull()
    )
    // The retry re-reads that one post once more.
    await waitFor(() => expect(postReads).toEqual(['spot-1', 'spot-1']))
    // No page-one reload: the appended page, its ranks and the reader's place survive.
    expect(pageOneReads(cursors)).toBe(1)
    expect(
      screen
        .getAllByTestId(/^spotlight-lookbook-card-/)
        .map((card) => card.id.split('-').at(-1))
    ).toEqual(['1', '2', '3'])
  })

  // Story 6.6 R42, migrated to the inline ranked feed in CC-7.15.

  it('6.6-WEB-071 keeps matching ranked looks in order across pages', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === null
          ? spotlightBody({
              items: [ranked(1), ranked(2), ranked(4, { climateBand: 'temperate_wet' })],
              nextCursor: 'cursor-2',
            })
          : spotlightBody({ items: [ranked(5)], nextCursor: null })
      )
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    const ids = () =>
      screen.getAllByTestId(/^spotlight-lookbook-card-/).map((card) => card.id)
    expect(ids()).toEqual([
      'spotlight-lookbook-card-spot-1',
      'spotlight-lookbook-card-spot-2',
    ])
    await user.click(screen.getByTestId('community-spotlight-view-more'))
    await screen.findByTestId('spotlight-lookbook-card-spot-5')
    expect(ids()).toEqual([
      'spotlight-lookbook-card-spot-1',
      'spotlight-lookbook-card-spot-2',
      'spotlight-lookbook-card-spot-5',
    ])
  })

  it('6.6-WEB-072 View more is the trailing item of the row, after the last look and outside the list count (R42)', async () => {
    signIn()
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () =>
        spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'cursor-2' })
      )
    )
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    const grid = screen.getByTestId('community-card-grid')
    const viewMore = screen.getByTestId('community-spotlight-view-more')
    const cards = within(grid).getAllByTestId(/^spotlight-lookbook-card-/)
    expect(cards).toHaveLength(2)
    expect(grid).not.toContainElement(viewMore)
    expect(
      cards[1]!.compareDocumentPosition(viewMore) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('6.6-WEB-073 View more scrolls the look it focuses to the start of the row (R42)', async () => {
    signIn()
    const previous = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView'
    )
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    try {
      useMswHandlers(
        feedHandler({ items: [] }),
        http.get(SPOTLIGHT_PATH, ({ request }) =>
          new URL(request.url).searchParams.get('cursor') === null
            ? spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'cursor-2' })
            : spotlightBody({ items: [ranked(3)], nextCursor: null })
        )
      )
      const user = userEvent.setup()
      renderGrid()

      await screen.findByTestId('spotlight-lookbook-card-spot-2')
      // Rendering page one moves nothing: only an appended look takes focus.
      expect(scrollIntoView).not.toHaveBeenCalled()
      await user.click(screen.getByTestId('community-spotlight-view-more'))

      const third = await screen.findByTestId('spotlight-lookbook-card-spot-3')
      await waitFor(() => expect(document.activeElement).toBe(third))
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ inline: 'start', block: 'nearest' })
      expect(scrollIntoView.mock.contexts[0]).toBe(third)
    } finally {
      if (previous)
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previous)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  // Story CC-7.7 replaced the two-card skeleton: it collapsed into the real row and moved the
  // feed below it. The tab's screen gate now holds the first load (7.7-CMP-007); while a read
  // runs the section keeps its heading and an empty, decorative marker.
  it('6.6-WEB-074 7.7 the loading state shows no skeleton cards and stays out of the accessibility tree', async () => {
    signIn()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, async () => {
        await held
        return spotlightBody({ items: [ranked(1)], nextCursor: null })
      })
    )
    renderGrid()

    await screen.findByTestId('community-feed-loading')
    expect(screen.queryAllByTestId(/^spotlight-lookbook-card-/)).toHaveLength(0)
    expect(screen.queryByTestId('community-spotlight-view-more')).toBeNull()

    release()
    expect(
      await screen.findByTestId('spotlight-lookbook-card-spot-1')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('community-spotlight-loading')).not.toBeInTheDocument()
  })
})

// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Story 6.6 code review round 2: spotlight single-post refresh and per-surface
// image failures, through the real web transport and MSW.
import { http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  IMAGE_URL,
  POST_PATH,
  REFRESHED_IMAGE_URL,
  feedHandler,
  isoIn,
  item,
  postBody,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'
import {
  SPOTLIGHT_PATH,
  failImage,
  ranked,
  spotlightBody,
} from '../../test-utils/community-spotlight'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

setupCommunityGridClock()

describe('CommunitySpotlightSection review round 2 (Story 6.6)', () => {
  setupCommunityGridSurface()

  it('6.6-WEB-050 a spotlight refresh that returns the author their own unpublished post evicts it (R27)', async () => {
    signIn()
    const self = { displayName: 'You', isSelf: true }
    const reads: string[] = []
    useMswHandlers(
      feedHandler({ items: [] }),
      http.get(SPOTLIGHT_PATH, () =>
        spotlightBody({ items: [ranked(1, { author: self }), ranked(2)] })
      ),
      // The single-post read returns an author their own post in any status.
      http.get(POST_PATH, ({ params }) => {
        reads.push(String(params.postId))
        return postBody({
          id: String(params.postId),
          status: 'flagged',
          author: self,
          imageAccess: {
            url: REFRESHED_IMAGE_URL,
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
        })
      })
    )
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    failImage('spotlight-lookbook-image-spot-1')

    await waitFor(() =>
      expect(
        screen.queryByTestId('spotlight-lookbook-card-spot-1')
      ).not.toBeInTheDocument()
    )
    expect(reads).toEqual(['spot-1'])
    expect(
      within(screen.getByTestId('community-spotlight-list'))
        .getAllByRole('listitem')
        .map((entry) => entry.getAttribute('data-rank'))
    ).toEqual(['2'])
  })

  it('6.6-WEB-051 a spotlight image failure never marks the feed copy of the same post unavailable (R28)', async () => {
    signIn()
    const reads: string[] = []
    useMswHandlers(
      feedHandler({ items: [item({ id: 'spot-1' })] }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1)] })),
      // The refresh hands back the same signed URL, so the spotlight copy stays failed.
      http.get(POST_PATH, ({ params }) => {
        reads.push(String(params.postId))
        return postBody({ id: String(params.postId) })
      })
    )
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    await screen.findByTestId('lookbook-card-spot-1')
    failImage('spotlight-lookbook-image-spot-1')

    expect(
      await screen.findByTestId('spotlight-image-unavailable-spot-1')
    ).toBeInTheDocument()
    await waitFor(() => expect(reads).toEqual(['spot-1']))
    // The feed copy keeps its image and its open control.
    expect(screen.queryByTestId('image-unavailable-spot-1')).not.toBeInTheDocument()
    expect(
      screen.getByTestId('lookbook-image-spot-1').querySelector('img')
    ).not.toBeNull()
    expect(screen.getByTestId('lookbook-open-spot-1')).toBeInTheDocument()
  })

  it('6.6-WEB-052 a feed image failure never marks the spotlight copy of the same post unavailable (R28)', async () => {
    signIn()
    let feedReads = 0
    useMswHandlers(
      // Counts every feed read, then falls through to the shared feed handler.
      http.get(FEED_PATH, () => {
        feedReads++
      }),
      feedHandler({ items: [item({ id: 'spot-1' })] }),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1)] })),
      http.get(POST_PATH, ({ params }) => postBody({ id: String(params.postId) }))
    )
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    await screen.findByTestId('lookbook-card-spot-1')
    const readsBefore = feedReads
    failImage('lookbook-image-spot-1')

    // The feed reloads its page; the same signed URL leaves the feed copy failed.
    expect(await screen.findByTestId('image-unavailable-spot-1')).toBeInTheDocument()
    await waitFor(() => expect(feedReads).toBe(readsBefore + 1))
    // The spotlight copy keeps its image and its open control.
    expect(
      screen.queryByTestId('spotlight-image-unavailable-spot-1')
    ).not.toBeInTheDocument()
    expect(
      screen.getByTestId('spotlight-lookbook-image-spot-1').querySelector('img')
    ).not.toBeNull()
    expect(screen.getByTestId('spotlight-lookbook-open-spot-1')).toBeInTheDocument()
  })

  it('6.6-WEB-080 a spotlight image failure re-reads the post and renders its fresh signed URL in place', async () => {
    signIn()
    const cursors: (string | null)[] = []
    const reads: string[] = []
    useMswHandlers(
      feedHandler({ items: [item({ id: 'spot-1' })] }),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        return cursor === null
          ? spotlightBody({ items: [ranked(1), ranked(2)], nextCursor: 'c2' })
          : spotlightBody({ items: [ranked(3)], nextCursor: null })
      }),
      // The signed URL expired; the single-post read signs a fresh one.
      http.get(POST_PATH, ({ params }) => {
        reads.push(String(params.postId))
        return postBody({
          id: String(params.postId),
          caption: 'Spotlight look 1',
          author: { displayName: 'Explorer 1', isSelf: false },
          imageAccess: { url: REFRESHED_IMAGE_URL, expiresAt: isoIn(3600) },
        })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    await screen.findByTestId('lookbook-card-spot-1')
    await user.click(screen.getByTestId('community-spotlight-view-more'))
    await screen.findByTestId('spotlight-lookbook-card-spot-3')
    failImage('spotlight-lookbook-image-spot-1')

    await waitFor(() =>
      expect(
        screen
          .getByTestId('spotlight-lookbook-image-spot-1')
          .querySelector('img')
          ?.getAttribute('src')
      ).toBe(REFRESHED_IMAGE_URL)
    )
    expect(
      screen.queryByTestId('spotlight-image-unavailable-spot-1')
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('spotlight-lookbook-open-spot-1')).toBeInTheDocument()
    expect(reads).toEqual(['spot-1'])
    // Refreshed in place: no page-one reload, every loaded rank kept.
    expect(cursors).toEqual([null, 'c2'])
    expect(
      within(screen.getByTestId('community-spotlight-list'))
        .getAllByRole('listitem')
        .map((entry) => entry.getAttribute('data-rank'))
    ).toEqual(['1', '2', '3'])
    // The feed copy keeps the URL it was served with.
    expect(
      screen
        .getByTestId('lookbook-image-spot-1')
        .querySelector('img')
        ?.getAttribute('src')
    ).toBe(IMAGE_URL)
  })
})

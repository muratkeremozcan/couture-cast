// Story 6.6 code review round 2: spotlight single-post refresh and per-surface
// image failures, through the real web transport and MSW.
import { http, HttpResponse } from 'msw'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  communityReactionSpotlightResponseSchema,
  type CommunityReactionSpotlight,
  type CommunityReactionSpotlightItem,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  POST_PATH,
  REFRESHED_IMAGE_URL,
  feedHandler,
  item,
  postBody,
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

function failImage(testId: string) {
  fireEvent.error(screen.getByTestId(testId).querySelector('img') as HTMLImageElement)
}

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
})

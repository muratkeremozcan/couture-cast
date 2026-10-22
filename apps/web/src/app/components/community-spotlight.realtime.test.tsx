// Story 6.6: the City Spotlight under realtime removals and the D3 hide, through
// the real web transport and MSW.
import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  item,
  renderGrid,
  setupCommunityGridClock,
  setupCommunityGridSurface,
  signIn,
} from '../../test-utils/community-lookbook-grid'
import {
  SPOTLIGHT_PATH,
  ZERO,
  captureSync,
  ranked,
  reactionFeedBody,
  spotlightBody,
  useSpotlightOnlyRemoval,
} from '../../test-utils/community-spotlight'

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

setupCommunityGridClock()

describe('CommunitySpotlightSection realtime (Story 6.6)', () => {
  setupCommunityGridSurface()

  it('6.6-WEB-033 a realtime unavailable target removes the spotlight copy as well as the feed copy (R10)', async () => {
    signIn()
    const catchUp = captureSync()
    let phase: 'ready' | 'removed' = 'ready'
    let spotlightReads = 0
    useMswHandlers(
      http.get(FEED_PATH, () =>
        reactionFeedBody(
          phase === 'removed' ? [] : [{ ...item({ id: 'spot-1' }), reactions: ZERO }]
        )
      ),
      http.get(SPOTLIGHT_PATH, () => {
        spotlightReads += 1
        return spotlightBody({ items: [ranked(1, { reactions: ZERO }), ranked(2)] })
      }),
      http.get('/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events:
              phase === 'removed'
                ? [
                    {
                      version: 1,
                      kind: 'reactions.changed',
                      postId: 'spot-1',
                      communityRevision: '1',
                    },
                  ]
                : [],
            nextCursor: `cursor-${phase}`,
            hasMore: false,
            resyncRequired: false,
          },
        })
      ),
      http.post('/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as { targets: { key: string }[] }
        return HttpResponse.json({
          data: {
            targets: targets.map((target) =>
              phase === 'removed' && target.key === 'spot-1'
                ? { key: target.key, status: 'unavailable' }
                : {
                    key: target.key,
                    status: 'available',
                    communityRevision: '0',
                    post: { ...item({ id: target.key }), reactions: ZERO },
                    comment: null,
                    parent: null,
                    pageCursor: null,
                    parentPageCursor: null,
                    threadPosition: null,
                  }
            ),
          },
        })
      })
    )
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    await screen.findByTestId('lookbook-card-spot-1')
    await catchUp()
    phase = 'removed'
    await catchUp()

    await waitFor(() =>
      expect(screen.queryByTestId('lookbook-card-spot-1')).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        screen.queryByTestId('spotlight-lookbook-card-spot-1')
      ).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('spotlight-lookbook-card-spot-2')).toBeInTheDocument()
    // Evicted in place: no spotlight re-read stood in for the realtime removal.
    expect(spotlightReads).toBe(1)
  })

  it('6.6-WEB-040 hides the module once community access is no longer verified, like mobile (R14)', async () => {
    signIn()
    const catchUp = captureSync()
    let unverified = false
    useMswHandlers(
      http.get(FEED_PATH, () => reactionFeedBody([{ ...item(), reactions: ZERO }])),
      http.get(SPOTLIGHT_PATH, () => spotlightBody({ items: [ranked(1)] })),
      http.get('/api/v1/community/events', () =>
        unverified
          ? HttpResponse.json(
              { statusCode: 503, error: 'Service Unavailable', message: 'Unavailable' },
              { status: 503 }
            )
          : HttpResponse.json({
              data: {
                events: [],
                nextCursor: 'verified',
                hasMore: false,
                resyncRequired: false,
              },
            })
      ),
      http.post('/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as { targets: { key: string }[] }
        return HttpResponse.json({
          data: {
            targets: targets.map((target) => ({
              key: target.key,
              status: 'available',
              communityRevision: '0',
              post: { ...item({ id: target.key }), reactions: ZERO },
              comment: null,
              parent: null,
              pageCursor: null,
              parentPageCursor: null,
              threadPosition: null,
            })),
          },
        })
      })
    )
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    // A verified catch-up keeps the ranked module on screen.
    await catchUp()
    expect(
      await screen.findByTestId('spotlight-lookbook-card-spot-1')
    ).toBeInTheDocument()
    unverified = true
    await catchUp()

    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight')).not.toBeInTheDocument()
    )
    expect(screen.queryByText('No spotlight near you yet')).not.toBeInTheDocument()
  })

  it('6.6-WEB-041 a spotlight-only post that becomes unavailable over realtime leaves the module (R25)', async () => {
    signIn()
    const { catchUp, state, resolved } = useSpotlightOnlyRemoval()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-only')
    await screen.findByTestId('lookbook-card-post-1')
    expect(screen.queryByTestId('lookbook-card-spot-only')).not.toBeInTheDocument()
    await catchUp()
    state.phase = 'removed'
    await catchUp()

    // The realtime coordinator must be asked about the spotlight-only post at all.
    expect(resolved.flat()).toContain('spot-only')
    await waitFor(() =>
      expect(
        screen.queryByTestId('spotlight-lookbook-card-spot-only')
      ).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('spotlight-lookbook-card-spot-2')).toBeInTheDocument()
    expect(screen.getByTestId('lookbook-card-post-1')).toBeInTheDocument()
    // Evicted in place: no spotlight re-read stood in for the realtime removal.
    expect(state.spotlightReads).toBe(1)
  })

  it('6.6-WEB-042 an open detail for a spotlight-only post closes when realtime removes it (R25)', async () => {
    signIn()
    const { catchUp, state } = useSpotlightOnlyRemoval()
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-only')
    await catchUp()
    await user.click(screen.getByTestId('spotlight-lookbook-open-spot-only'))
    await screen.findByTestId('community-detail')
    state.phase = 'removed'
    await catchUp()

    await waitFor(() =>
      expect(screen.queryByTestId('community-detail')).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        screen.queryByTestId('spotlight-lookbook-card-spot-only')
      ).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('spotlight-lookbook-card-spot-2')).toBeInTheDocument()
  })

  it('6.6-WEB-081 the module returns with every loaded page once access verifies again (R14)', async () => {
    signIn()
    const catchUp = captureSync()
    let unverified = false
    const cursors: (string | null)[] = []
    useMswHandlers(
      http.get(FEED_PATH, () => reactionFeedBody([{ ...item(), reactions: ZERO }])),
      http.get(SPOTLIGHT_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        return cursor === null
          ? spotlightBody({ items: [ranked(1)], nextCursor: 'cursor-2' })
          : spotlightBody({ items: [ranked(2)], nextCursor: null })
      }),
      http.get('/api/v1/community/events', () =>
        unverified
          ? HttpResponse.json(
              { statusCode: 503, error: 'Service Unavailable', message: 'Unavailable' },
              { status: 503 }
            )
          : HttpResponse.json({
              data: {
                events: [],
                nextCursor: 'verified',
                hasMore: false,
                resyncRequired: false,
              },
            })
      ),
      http.post('/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as { targets: { key: string }[] }
        return HttpResponse.json({
          data: {
            targets: targets.map((target) => ({
              key: target.key,
              status: 'available',
              communityRevision: '0',
              post: { ...item({ id: target.key }), reactions: ZERO },
              comment: null,
              parent: null,
              pageCursor: null,
              parentPageCursor: null,
              threadPosition: null,
            })),
          },
        })
      })
    )
    const user = userEvent.setup()
    renderGrid()

    await screen.findByTestId('spotlight-lookbook-card-spot-1')
    await user.click(screen.getByTestId('community-spotlight-view-more'))
    await screen.findByTestId('spotlight-lookbook-card-spot-2')
    await catchUp()
    unverified = true
    await catchUp()
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight')).not.toBeInTheDocument()
    )

    unverified = false
    await catchUp()

    expect(
      await screen.findByTestId('spotlight-lookbook-card-spot-1')
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('community-spotlight-list'))
        .getAllByRole('listitem')
        .map((entry) => entry.getAttribute('data-rank'))
    ).toEqual(['1', '2'])
    // The kept pages come back as they were: no spotlight read stood in for them.
    expect(cursors).toEqual([null, 'cursor-2'])
  })
})

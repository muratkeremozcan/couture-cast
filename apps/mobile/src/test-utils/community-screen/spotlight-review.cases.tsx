/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.6 owner: City Spotlight code review round 2 remedies through the real HTTP boundary.
import { item, feedJson, imageEvents, serveFeed } from './harness'
import { CommunitySyncState } from '@couture/api-client'
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { expect, it, vi } from 'vitest'
import {
  communityReactionSpotlightResponseSchema,
  type CommunityReactionSpotlightItem,
} from '@couture/api-client/contracts/http'
import { CommunityScreen } from '@/src/features/community/community-screen'
import { communityCommentsSessionFromMobile } from '@/src/lib/community'
import { server } from '@/src/test-utils/msw/server'

const SPOTLIGHT_ROUTE = '*/api/v1/community/spotlight'

const ZERO = {
  counts: { applause: 0, love: 0, inspiration: 0 },
  total: 0,
  viewerReaction: null,
  revision: 0,
  generation: 0,
}

const SELF = { displayName: 'You', isSelf: true }

function rankedLook(
  id: string,
  rank: number,
  overrides: Partial<CommunityReactionSpotlightItem> = {}
): CommunityReactionSpotlightItem {
  return { ...item({ id }), reactions: ZERO, rank, ...overrides }
}

/** Serves page one with the given looks and counts every spotlight read. */
function serveSpotlight(items: CommunityReactionSpotlightItem[]) {
  const reads = { count: 0 }
  server.use(
    http.get(SPOTLIGHT_ROUTE, () => {
      reads.count += 1
      // Parsed through the contract so a drifted fixture fails loudly.
      return HttpResponse.json(
        communityReactionSpotlightResponseSchema.parse({
          data: { level: 'city', label: 'Lisbon', items, nextCursor: null },
        })
      )
    })
  )
  return reads
}

/** Captures the realtime coordinator the screen starts, so a case can run a catch-up. */
function captureCatchUp() {
  let catchUp: (() => Promise<void>) | undefined
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    catchUp = () => this.catchUp()
  })
  return async () => {
    await waitFor(() => expect(catchUp).toBeTypeOf('function'))
    await act(async () => {
      await catchUp!()
    })
  }
}

export function registerCommunitySpotlightReviewCases() {
  // --- Story 6.6 code review round 2 remedies (TEA) ---------------------------

  it('6.6-MOB-051 an image refresh that returns the author their own withdrawn look evicts it from the spotlight (R27)', async () => {
    serveFeed(() => feedJson({ items: [] }))
    const reads = serveSpotlight([
      rankedLook('spot-1', 1),
      rankedLook('spot-self', 2, { author: SELF }),
    ])
    const postReads: string[] = []
    server.use(
      http.get('*/api/v1/community/posts/:postId', ({ params }) => {
        const id = params.postId as string
        postReads.push(id)
        // The single-post read returns an author their own non-published post.
        return HttpResponse.json({
          data: { ...item({ id, status: 'withdrawn', author: SELF }), reactions: ZERO },
        })
      })
    )
    await render(<CommunityScreen />)
    await screen.findByTestId('community-spotlight-item-spot-self')
    await waitFor(() =>
      expect(imageEvents.errors.get('community-card-image-spot-self')).toBeTypeOf(
        'function'
      )
    )
    act(() => {
      imageEvents.errors.get('community-card-image-spot-self')!()
    })

    await waitFor(() => expect(postReads).toContain('spot-self'))
    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-item-spot-self')).toBeNull()
    )
    expect(screen.getByTestId('community-spotlight-item-spot-1')).toBeVisible()
    // Evicted in place: no spotlight re-read stood in for the refresh.
    expect(reads.count).toBe(1)
  })

  it('6.6-MOB-052 a realtime read that returns the author their own withdrawn look evicts it from the spotlight (R27)', async () => {
    const catchUp = captureCatchUp()
    let phase: 'ready' | 'withdrawn' = 'ready'
    serveFeed(() => feedJson({ items: [item({ reactions: ZERO })] }))
    const reads = serveSpotlight([
      rankedLook('spot-1', 1),
      rankedLook('spot-self', 2, { author: SELF }),
    ])
    server.use(
      http.get('*/api/v1/community/events', () =>
        HttpResponse.json({
          data: {
            events:
              phase === 'withdrawn'
                ? [
                    {
                      version: 1,
                      kind: 'reactions.changed',
                      postId: 'spot-self',
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
      http.post('*/api/v1/community/targets/resolve', async ({ request }) => {
        const { targets } = (await request.json()) as {
          targets: { key: string; postId: string }[]
        }
        return HttpResponse.json({
          data: {
            targets: targets.map((target) => ({
              key: target.key,
              status: 'available',
              communityRevision: phase === 'withdrawn' ? '1' : '0',
              post:
                phase === 'withdrawn' && target.postId === 'spot-self'
                  ? item({
                      id: target.postId,
                      status: 'withdrawn',
                      author: SELF,
                      reactions: ZERO,
                    })
                  : item({ id: target.postId, reactions: ZERO }),
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
    await render(<CommunityScreen />)
    await screen.findByTestId('community-spotlight-item-spot-self')
    await screen.findByTestId('community-post-card-post-a')
    await catchUp()
    expect(screen.getByTestId('community-spotlight-item-spot-self')).toBeVisible()

    phase = 'withdrawn'
    await catchUp()

    await waitFor(() =>
      expect(screen.queryByTestId('community-spotlight-item-spot-self')).toBeNull()
    )
    expect(screen.getByTestId('community-spotlight-item-spot-1')).toBeVisible()
    expect(reads.count).toBe(1)
  })

  it('6.6-MOB-053 a failed first identity resolution idles the spotlight as signed out until a member resolves (R33)', async () => {
    let failing = true
    const resolveIdentity = vi
      .mocked(communityCommentsSessionFromMobile)
      .mockImplementation(() =>
        failing
          ? Promise.reject(new Error('secure storage unavailable'))
          : Promise.resolve('member-1')
      )
    const reads = serveSpotlight([rankedLook('spot-1', 1)])
    await render(<CommunityScreen />)
    await screen.findByTestId('community-post-card-post-a')

    // Signed out: the module hides and reads nothing, with no endless loading row.
    await waitFor(() => expect(screen.queryByTestId('community-spotlight')).toBeNull())
    expect(screen.queryByTestId('community-spotlight-loading')).toBeNull()
    // The once-a-second sync keeps failing and the module stays idle.
    await waitFor(
      () => expect(resolveIdentity.mock.calls.length).toBeGreaterThanOrEqual(2),
      { timeout: 4000 }
    )
    // One more failed sync cycle runs to completion before the negative checks.
    const seen = resolveIdentity.mock.calls.length
    await waitFor(() => expect(resolveIdentity.mock.calls.length).toBeGreaterThan(seen), {
      timeout: 4000,
    })
    expect(screen.queryByTestId('community-spotlight')).toBeNull()
    expect(reads.count).toBe(0)

    // A later sync that resolves the member loads page one.
    failing = false
    expect(
      await screen.findByTestId('community-spotlight-item-spot-1', undefined, {
        timeout: 4000,
      })
    ).toBeVisible()
    expect(reads.count).toBe(1)
    // The feed shown before the member resolved stays: the late resolution is
    // the first one, so it resets nothing.
    expect(screen.getByTestId('community-post-card-post-a')).toBeVisible()
  })
}

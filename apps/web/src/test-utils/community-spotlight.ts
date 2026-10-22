// Shared Story 6.6 City Spotlight fixtures and helpers for the web grid suites.
import { CommunitySyncState } from '@couture/api-client'
import { http, HttpResponse } from 'msw'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'
import {
  communityReactionFeedResponseSchema,
  communityReactionSpotlightResponseSchema,
  type CommunityReactionFeedItem,
  type CommunityReactionSpotlight,
  type CommunityReactionSpotlightItem,
  type CommunityReactionSummary,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from './msw/runtime'
import { FEED_PATH, OPENED_PATH, feed, item } from './community-lookbook-grid'

export const SPOTLIGHT_PATH = '/api/v1/community/spotlight'

export function ranked(
  rank: number,
  overrides: Partial<CommunityReactionSpotlightItem> = {}
) {
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

export function spotlightBody(overrides: Partial<CommunityReactionSpotlight> = {}) {
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

export function liveRegionText() {
  return screen.getByTestId('community-live-region').textContent
}

export const ZERO: CommunityReactionSummary = {
  counts: { applause: 0, love: 0, inspiration: 0 },
  total: 0,
  revision: 0,
  generation: 0,
  viewerReaction: null,
}

/** A feed body that carries reaction summaries, like the negotiated wire shape. */
export function reactionFeedBody(items: CommunityReactionFeedItem[]) {
  return HttpResponse.json(
    communityReactionFeedResponseSchema.parse({
      data: feed({ items, nextCursor: null }),
    }) as unknown as Record<string, unknown>
  )
}

/** Captures the realtime coordinator the grid starts, so a test can run a catch-up. */
export function captureSync() {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  return async () => {
    await waitFor(() => expect(syncs.length).toBeGreaterThan(0))
    await act(async () => {
      await syncs.at(-1)!.catchUp()
    })
  }
}

/** Every spotlight page-one read (no cursor) the grid made. */
export function pageOneReads(cursors: (string | null)[]) {
  return cursors.filter((cursor) => cursor === null).length
}

/** Every text the one live region takes, so a repeated or empty announcement shows. */
export function recordAnnouncements() {
  const seen: string[] = []
  const region = screen.getByTestId('community-live-region')
  const observer = new MutationObserver(() => seen.push(region.textContent ?? ''))
  observer.observe(region, { childList: true, subtree: true, characterData: true })
  return { seen, stop: () => observer.disconnect() }
}

export function failImage(testId: string) {
  fireEvent.error(screen.getByTestId(testId).querySelector('img') as HTMLImageElement)
}

/** A spotlight-only post (absent from every feed page) that realtime later removes. */
export function useSpotlightOnlyRemoval() {
  const catchUp = captureSync()
  const state = { phase: 'ready' as 'ready' | 'removed', spotlightReads: 0 }
  const resolved: string[][] = []
  useMswHandlers(
    http.get(FEED_PATH, () => reactionFeedBody([{ ...item(), reactions: ZERO }])),
    http.get(SPOTLIGHT_PATH, () => {
      state.spotlightReads += 1
      return spotlightBody({
        items: [
          ranked(1, { id: 'spot-only', reactions: ZERO }),
          ranked(2, { reactions: ZERO }),
        ],
      })
    }),
    http.post(OPENED_PATH, () => HttpResponse.json({ tracked: true })),
    http.get('/api/v1/community/events', () =>
      HttpResponse.json({
        data: {
          events:
            state.phase === 'removed'
              ? [
                  {
                    version: 1,
                    kind: 'reactions.changed',
                    postId: 'spot-only',
                    communityRevision: '1',
                  },
                ]
              : [],
          nextCursor: `cursor-${state.phase}`,
          hasMore: false,
          resyncRequired: false,
        },
      })
    ),
    http.post('/api/v1/community/targets/resolve', async ({ request }) => {
      const { targets } = (await request.json()) as { targets: { key: string }[] }
      resolved.push(targets.map((target) => target.key))
      return HttpResponse.json({
        data: {
          targets: targets.map((target) =>
            state.phase === 'removed' && target.key === 'spot-only'
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
  return { catchUp, state, resolved }
}

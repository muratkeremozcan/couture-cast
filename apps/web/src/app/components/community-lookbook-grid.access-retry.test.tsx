// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// PR #259 review (CodeRabbit), community grid: after a realtime denial, Retry must be able to
// show the community again once access is back (the denial stopped the sync, and only a
// catch-up reporting 'connected' restores the grid); the one-row probe the denial sends speaks
// only while no newer feed read has started; and the weekly challenge stays readable while the
// reader has no verified member, but only a verified member can start a post from it.
import { CommunitySyncState } from '@couture/api-client'
import { COMMUNITY_FEED_DISABLED_MESSAGE } from '@couture/api-client/contracts/http'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { settle } from '../../test-utils/request-barrier'
import {
  CHALLENGE,
  FEED_PATH,
  feed,
  feedHandler,
  item,
  renderGrid,
  setupCommunityGridClock,
  signIn,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
setupCommunityGridClock()
beforeEach(() => {
  window.sessionStorage.clear()
})

const DISABLED = 'The community feed is temporarily unavailable.'
const reactions = {
  counts: { applause: 0, love: 0, inspiration: 0 },
  total: 0,
  revision: 0,
  generation: 0,
  viewerReaction: null,
}
const denied = () =>
  HttpResponse.json(
    { statusCode: 403, code: 'denied', message: COMMUNITY_FEED_DISABLED_MESSAGE },
    { status: 403 }
  )

/**
 * A member refused, then let back in: `access.open()` flips every later page read and
 * catch-up to success. The one-row probe a realtime denial sends can be held.
 */
function useRefusedThenOpenCommunity(options: { holdProbe?: boolean } = {}) {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  let open = false
  let releaseProbe!: () => void
  const probeHeld = new Promise<void>((resolve) => {
    releaseProbe = resolve
  })
  const probes: string[] = []
  /** The probe's refusal has left the handler: its answer is on its way to the grid. */
  let probeAnswered = false
  const post = (id: string) => ({ ...item({ id }), reactions })
  useMswHandlers(
    http.get(FEED_PATH, async ({ request }) => {
      const limit = new URL(request.url).searchParams.get('limit')
      if (limit === '1') {
        probes.push(limit)
        if (options.holdProbe) await probeHeld
        probeAnswered = true
        return denied()
      }
      if (!open) return denied()
      return HttpResponse.json({
        data: feed({ items: [post('post-1')], nextCursor: null }),
      })
    }),
    http.get('/api/v1/community/events', () =>
      open
        ? HttpResponse.json({
            data: {
              events: [],
              nextCursor: 'cursor',
              hasMore: false,
              resyncRequired: false,
            },
          })
        : denied()
    ),
    http.post('/api/v1/community/targets/resolve', async ({ request }) => {
      const { targets } = (await request.json()) as {
        targets: { key: string; postId: string }[]
      }
      return HttpResponse.json({
        data: {
          targets: targets.map((target) => ({
            key: target.key,
            status: 'available',
            communityRevision: '0',
            post: post(target.postId),
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
  return {
    syncs,
    probes,
    open: () => {
      open = true
    },
    releaseProbe: () => releaseProbe(),
    probeAnswered: () => probeAnswered,
  }
}

/** The refused page read, then the realtime denial and its probe. */
async function refuseFeedAndRealtime(
  community: ReturnType<typeof useRefusedThenOpenCommunity>
) {
  renderGrid()
  expect(await screen.findByTestId('community-feed-error')).toHaveTextContent(DISABLED)
  await act(async () => {
    await community.syncs[0]!.catchUp()
  })
  await waitFor(() => expect(community.probes).toHaveLength(1))
}

describe('Retry after a realtime denial', () => {
  beforeEach(() => {
    signIn()
  })

  it('COMMUNITY-ACCESS-RETRY-01 shows the retried items once access is back', async () => {
    const community = useRefusedThenOpenCommunity()
    await refuseFeedAndRealtime(community)

    community.open()
    await userEvent.setup().click(screen.getByTestId('community-feed-retry-button'))

    // Retry restarts the stopped sync; its catch-up verifies access again.
    await waitFor(() => expect(community.syncs).toHaveLength(2))
    await act(async () => {
      await community.syncs[1]!.catchUp()
    })

    expect(await screen.findByTestId('lookbook-card-post-1')).toBeInTheDocument()
    expect(screen.queryByTestId('community-feed-error')).toBeNull()
  })

  it('COMMUNITY-ACCESS-RETRY-02 a probe answer that lands after a newer read restores no old error', async () => {
    const community = useRefusedThenOpenCommunity({ holdProbe: true })
    await refuseFeedAndRealtime(community)

    community.open()
    await userEvent.setup().click(screen.getByTestId('community-feed-retry-button'))
    await waitFor(() => expect(screen.queryByTestId('community-feed-error')).toBeNull())

    // The denial's probe answers last, with the old refusal.
    // The assertion follows the answer's delivery: the handler has answered, and the grid has
    // had every round of the request barrier to apply it, so a guard that lets it through fails.
    act(() => community.releaseProbe())
    await waitFor(() => expect(community.probeAnswered()).toBe(true))
    await settle()

    expect(screen.queryByTestId('community-feed-error')).toBeNull()
  })
})

describe('the weekly challenge without a verified member', () => {
  it('COMMUNITY-CHALLENGE-GATE-01 stays readable and offers no way to post when no member is verified', async () => {
    // A bearer no verification named (a stale one from an earlier session): no verified member.
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'stale-bearer')
    useMswHandlers(feedHandler({ activeChallenge: CHALLENGE }))
    renderGrid()

    expect(await screen.findByTestId('weekly-challenge-banner')).toHaveTextContent(
      CHALLENGE.title
    )
    expect(screen.queryByTestId('challenge-participate-button')).toBeNull()
  })

  it('COMMUNITY-CHALLENGE-GATE-02 control: a verified member can join the challenge', async () => {
    signIn()
    useMswHandlers(feedHandler({ activeChallenge: CHALLENGE }))
    renderGrid()

    const participate = await screen.findByTestId('challenge-participate-button')
    await userEvent.setup().click(participate)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

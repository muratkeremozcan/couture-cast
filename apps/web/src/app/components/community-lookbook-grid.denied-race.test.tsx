// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// A member outside the community rollout gets a 403 from the feed read and from the realtime
// catch-up. Both say the same thing, and the grid must say it too: "The community feed is
// temporarily unavailable." When the catch-up's denial landed first, the grid dropped the feed
// read still in flight and showed "No looks shared here yet", as if the member could see the
// community and nobody had posted (complimentary-access.spec.ts E-CONTROL-LOCKED, 2 of 10 runs
// on 2026-11-19). The order of the two answers is the network's, so both orders are pinned.
import { CommunitySyncState } from '@couture/api-client'
import { COMMUNITY_FEED_DISABLED_MESSAGE } from '@couture/api-client/contracts/http'
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  FEED_PATH,
  renderGrid,
  setupCommunityGridClock,
  signIn,
} from '../../test-utils/community-lookbook-grid'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
setupCommunityGridClock()
beforeEach(() => {
  window.sessionStorage.clear()
  signIn()
})

const DISABLED = 'The community feed is temporarily unavailable.'
const EMPTY = 'No looks shared here yet'
/** The read gate's refusal, as the API sends it (complimentary-access E-CONTROL-LOCKED trace). */
const denied = () =>
  HttpResponse.json(
    { statusCode: 403, code: 'denied', message: COMMUNITY_FEED_DISABLED_MESSAGE },
    { status: 403 }
  )

/** A member outside the read rollout: the feed read is held until released, then refused. */
function useRefusedCommunity() {
  const syncs: CommunitySyncState[] = []
  vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
    this: CommunitySyncState
  ) {
    syncs.push(this)
  })
  const reads: string[] = []
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  useMswHandlers(
    http.get(FEED_PATH, async ({ request }) => {
      const limit = new URL(request.url).searchParams.get('limit') ?? ''
      reads.push(limit)
      // The page read is held; the one-row read the denial sends answers at once.
      if (limit !== '1') await held
      return denied()
    }),
    http.get('/api/v1/community/events', () => denied())
  )
  return { sync: () => syncs[0]!, reads, release }
}

describe('a member outside the community rollout', () => {
  it('COMMUNITY-DENIED-RACE-01 reads "temporarily unavailable" when the realtime denial lands before the feed answer', async () => {
    const community = useRefusedCommunity()
    renderGrid()
    await waitFor(() => expect(community.reads).toEqual(['12']))

    // The catch-up is refused while the page read is still out.
    await act(async () => {
      await community.sync().catchUp()
    })
    await waitFor(() => expect(community.reads).toContain('1'))

    await act(async () => {
      community.release()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(await screen.findByTestId('community-feed-error')).toHaveTextContent(DISABLED)
    expect(screen.queryByText(EMPTY)).toBeNull()
  })

  it('COMMUNITY-DENIED-RACE-02 control: the feed answer first, then the realtime denial, reads "temporarily unavailable"', async () => {
    const community = useRefusedCommunity()
    renderGrid()
    await waitFor(() => expect(community.reads).toEqual(['12']))
    act(() => community.release())
    expect(await screen.findByTestId('community-feed-error')).toHaveTextContent(DISABLED)

    await act(async () => {
      await community.sync().catchUp()
    })
    await waitFor(() => expect(community.reads).toContain('1'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getByTestId('community-feed-error')).toHaveTextContent(DISABLED)
    expect(screen.queryByText(EMPTY)).toBeNull()
  })
})

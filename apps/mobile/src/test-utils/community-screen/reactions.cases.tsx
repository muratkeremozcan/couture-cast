/* eslint-disable @typescript-eslint/await-thenable */
import {
  imageEvents,
  item,
  feed,
  errorEnvelope,
  feedUrls,
  serveFeed,
  setMockParams,
} from './harness'
import { userEvent as browserUser } from 'vitest/browser'
import { CommunityReactionState } from '@couture/api-client'
import * as communityClient from '@/src/lib/community'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import { expect, it, vi } from 'vitest'
import {
  type CommunityReactionSummary,
  type SetCommunityReactionInput,
} from '@couture/api-client/contracts/http'
import { CommunityScreen } from '@/src/features/community/community-screen'
import { server } from '@/src/test-utils/msw/server'

export function registerCommunityReactionsCases() {
  it('6.3-MOB-001 adds, replaces and retracts with independently focusable labeled controls', async () => {
    let summary: CommunityReactionSummary = {
      counts: { applause: 0, love: 0, inspiration: 0 },
      total: 0,
      viewerReaction: null,
      revision: 0,
      generation: 0,
    }
    const requests: SetCommunityReactionInput[] = []
    serveFeed(() => {
      const reactionItem = { ...item(), reactions: summary }
      return HttpResponse.json({ data: feed({ items: [reactionItem] }) })
    })
    server.use(
      http.put('*/api/v1/community/posts/:postId/reaction', async ({ request }) => {
        const intent = (await request.json()) as SetCommunityReactionInput
        requests.push(intent)
        summary = {
          counts: {
            applause: intent.selection === 'applause' ? 1 : 0,
            love: intent.selection === 'love' ? 1 : 0,
            inspiration: 0,
          },
          total: intent.selection === null ? 0 : 1,
          viewerReaction: intent.selection,
          revision: summary.revision + 1,
          generation: summary.generation + 1,
        }
        return HttpResponse.json({ data: summary })
      })
    )
    await render(<CommunityScreen />)
    const applause = await screen.findByRole('button', { name: 'Applaud, 0' })
    await browserUser.click(applause)
    await waitFor(() => expect(applause.getAttribute('aria-pressed')).toBe('true'))
    const love = screen.getByRole('button', { name: 'Love, 0' })
    await browserUser.click(love)
    await waitFor(() => expect(love.getAttribute('aria-pressed')).toBe('true'))
    await browserUser.click(love)
    await waitFor(() => expect(love.getAttribute('aria-pressed')).toBe('false'))
    expect(requests.map((request) => request.selection)).toEqual([
      'applause',
      'love',
      null,
    ])
    expect(requests.map((request) => request.baseRevision)).toEqual([0, 1, 2])
  })
  function raceDeferred() {
    let release!: () => void
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    return { promise, release }
  }
  function racePalette() {
    const controls = screen.getByTestId('community-reactions-post-a')
    return {
      buttons: within(controls)
        .getAllByRole('button')
        .map((button) => ({
          label: button.getAttribute('aria-label'),
          pressed: button.getAttribute('aria-pressed'),
        })),
      total: screen.getByTestId('community-reaction-total-post-a').textContent,
    }
  }
  const confirmedPalette = {
    buttons: [
      { label: 'Applaud, 1', pressed: 'true' },
      { label: 'Love, 0', pressed: 'false' },
      { label: 'Inspired, 0', pressed: 'false' },
    ],
    total: '1 reaction',
  }
  const raceZero: CommunityReactionSummary = {
    counts: { applause: 0, love: 0, inspiration: 0 },
    total: 0,
    revision: 0,
    generation: 0,
    viewerReaction: null,
  }
  const raceOne: CommunityReactionSummary = {
    counts: { applause: 1, love: 0, inspiration: 0 },
    total: 1,
    revision: 1,
    generation: 1,
    viewerReaction: 'applause',
  }
  it('6.3-MOB delayed detail cannot overwrite confirmed feed mutation', async () => {
    setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
    const gate = raceDeferred()
    let detailSent = false
    serveFeed(() =>
      HttpResponse.json({ data: feed({ items: [{ ...item(), reactions: raceZero }] }) })
    )
    server.use(
      http.get('*/api/v1/community/posts/:postId', async () => {
        detailSent = true
        await gate.promise
        return HttpResponse.json({
          data: {
            ...item(),
            caption: 'Older native detail completed.',
            reactions: raceZero,
          },
        })
      }),
      http.put('*/api/v1/community/posts/:postId/reaction', () =>
        HttpResponse.json({ data: raceOne })
      )
    )
    try {
      await render(<CommunityScreen />)
      const button = await screen.findByRole('button', { name: 'Applaud, 0' })
      await waitFor(() => expect(detailSent).toBe(true))
      await browserUser.click(button)
      await screen.findByRole('button', { name: 'Applaud, 1' })
      gate.release()
      await screen.findByText('Older native detail completed.')
      expect(racePalette()).toEqual(confirmedPalette)
    } finally {
      gate.release()
    }
  })
  it('6.3-MOB delayed detail cannot resurrect a mutation 404', async () => {
    setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
    const gate = raceDeferred()
    const read = vi.spyOn(CommunityReactionState.prototype, 'read')
    let detailSent = false
    serveFeed(() =>
      HttpResponse.json({ data: feed({ items: [{ ...item(), reactions: raceZero }] }) })
    )
    server.use(
      http.get('*/api/v1/community/posts/:postId', async () => {
        detailSent = true
        await gate.promise
        return HttpResponse.json({
          data: {
            ...item(),
            caption: 'Fenced native detail completed.',
            reactions: raceZero,
          },
        })
      }),
      http.put('*/api/v1/community/posts/:postId/reaction', () =>
        errorEnvelope(404, 'Community post not found.')
      )
    )
    try {
      await render(<CommunityScreen />)
      const button = await screen.findByRole('button', { name: 'Applaud, 0' })
      await waitFor(() => expect(detailSent).toBe(true))
      await browserUser.click(button)
      await waitFor(() =>
        expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
      )
      gate.release()
      // A fenced detail intentionally creates no UI. Observe its arrival at
      // the real coordinator and flush React before the negative assertion.
      await waitFor(() =>
        expect(read).toHaveBeenCalledWith(
          expect.objectContaining({ caption: 'Fenced native detail completed.' }),
          expect.any(Number)
        )
      )
      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
      expect(screen.queryByTestId('highlighted-community-card-post-a')).toBeNull()
      expect(screen.queryByText('Fenced native detail completed.')).toBeNull()
    } finally {
      gate.release()
      read.mockRestore()
    }
  })
  it('6.3-MOB refreshed feed summary updates highlighted deep-link copy', async () => {
    setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
    serveFeed((_url, index) =>
      HttpResponse.json({
        data: feed({
          mode: index ? 'all' : 'auto',
          items: [{ ...item(), reactions: index ? raceOne : raceZero }],
        }),
      })
    )
    server.use(
      http.get('*/api/v1/community/posts/:postId', () =>
        HttpResponse.json({ data: { ...item(), reactions: raceZero } })
      )
    )
    await render(<CommunityScreen />)
    await screen.findByTestId('highlighted-community-card-post-a')
    await browserUser.click(screen.getByTestId('community-filter-chip-all'))
    await waitFor(() => expect(feedUrls).toHaveLength(2))
    await screen.findByRole('button', { name: 'Applaud, 1' })
    expect(racePalette()).toEqual(confirmedPalette)
  })
  it('6.3-MOB filter unmount retains accepted in-flight mutation result', async () => {
    const gate = raceDeferred()
    const feedGate = raceDeferred()
    let sent = false
    serveFeed(async (_url, index) => {
      if (index) await feedGate.promise
      return HttpResponse.json({
        data: feed({
          mode: index ? 'all' : 'auto',
          items: [
            {
              ...item(),
              caption: index ? 'Remounted native feed completed.' : item().caption,
              reactions: raceZero,
            },
          ],
        }),
      })
    })
    server.use(
      http.put('*/api/v1/community/posts/:postId/reaction', async () => {
        sent = true
        await gate.promise
        return HttpResponse.json({ data: raceOne })
      })
    )
    try {
      await render(<CommunityScreen />)
      await browserUser.click(await screen.findByRole('button', { name: 'Applaud, 0' }))
      await waitFor(() => expect(sent).toBe(true))
      const mutation: unknown = vi.mocked(communityClient.setCommunityReactionFromMobile)
        .mock.results[0]!.value
      await browserUser.click(screen.getByTestId('community-filter-chip-all'))
      await waitFor(() =>
        expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
      )
      // There are no mounted reaction controls during this filter load. Await
      // the real client promise and flush its coordinator continuation first.
      await act(async () => {
        gate.release()
        await mutation
      })
      feedGate.release()
      await screen.findByText('Remounted native feed completed.')
      expect(racePalette()).toEqual(confirmedPalette)
    } finally {
      gate.release()
      feedGate.release()
    }
  })
  it('6.3-MOB-021 retries a failed native PUT with the exact original payload', async () => {
    serveFeed(() =>
      HttpResponse.json({ data: feed({ items: [{ ...item(), reactions: raceZero }] }) })
    )
    const requests: SetCommunityReactionInput[] = []
    server.use(
      http.put('*/api/v1/community/posts/:postId/reaction', async ({ request }) => {
        requests.push((await request.json()) as SetCommunityReactionInput)
        return requests.length === 1
          ? HttpResponse.error()
          : HttpResponse.json({ data: raceOne })
      })
    )
    await render(<CommunityScreen />)
    await browserUser.click(await screen.findByRole('button', { name: 'Applaud, 0' }))
    await browserUser.click(await screen.findByRole('button', { name: 'Retry reaction' }))
    await screen.findByRole('button', { name: 'Applaud, 1' })
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(
      screen.getByRole('button', { name: 'Applaud, 1' }).getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('6.3-MOB-022 keeps confirmed counts when an older feed arrives after a mutation', async () => {
    const gate = raceDeferred()
    serveFeed(async (_url, index) => {
      if (index) await gate.promise
      return HttpResponse.json({
        data: feed({
          mode: index ? 'all' : 'auto',
          items: [
            {
              ...item(),
              caption: index ? 'Older native feed completed.' : item().caption,
              reactions: raceZero,
            },
          ],
        }),
      })
    })
    server.use(
      http.put('*/api/v1/community/posts/:postId/reaction', () =>
        HttpResponse.json({ data: raceOne })
      )
    )
    try {
      await render(<CommunityScreen />)
      await browserUser.click(await screen.findByRole('button', { name: 'Applaud, 0' }))
      await screen.findByRole('button', { name: 'Applaud, 1' })
      await browserUser.click(screen.getByTestId('community-filter-chip-all'))
      await waitFor(() => expect(feedUrls).toHaveLength(2))
      gate.release()
      await screen.findByText('Older native feed completed.')
      expect(racePalette()).toEqual(confirmedPalette)
    } finally {
      gate.release()
    }
  })
  it('6.3-MOB-023 wraps controls on narrow cards with large text and counts', async () => {
    serveFeed(() =>
      HttpResponse.json({
        data: feed({
          items: [
            {
              ...item(),
              reactions: {
                ...raceZero,
                counts: { applause: 999999, love: 999999, inspiration: 999999 },
                total: 2999997,
              },
            },
          ],
        }),
      })
    )
    await render(<CommunityScreen />)
    const controls = await screen.findByTestId('community-reactions-post-a')
    controls.style.width = '260px'
    controls.querySelectorAll<HTMLElement>('[role="button"]').forEach((button) => {
      button.style.fontSize = '32px'
      button.querySelectorAll<HTMLElement>('*').forEach((child) => {
        child.style.fontSize = '32px'
      })
    })
    const buttons = Array.from(controls.querySelectorAll<HTMLElement>('[role="button"]'))
    expect(buttons).toHaveLength(3)
    expect(buttons[2]!.getBoundingClientRect().top).toBeGreaterThan(
      buttons[0]!.getBoundingClientRect().top
    )
    for (const button of buttons) {
      const bounds = button.getBoundingClientRect()
      expect(bounds.width).toBeGreaterThanOrEqual(44)
      expect(bounds.height).toBeGreaterThanOrEqual(44)
      expect(bounds.right).toBeLessThanOrEqual(controls.getBoundingClientRect().right)
    }
  })
  it('6.3-MOB-024 revalidates highlighted visibility on an image-triggered refresh', async () => {
    setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
    let hidden = false
    let detailReads = 0
    serveFeed(() => HttpResponse.json({ data: feed({ items: [] }) }))
    server.use(
      http.get('*/api/v1/community/posts/:postId', () => {
        detailReads += 1
        return hidden
          ? errorEnvelope(404, 'Community post not found.')
          : HttpResponse.json({
              data: { ...item(), reactions: raceZero },
            })
      })
    )
    await render(<CommunityScreen />)
    await screen.findByTestId('highlighted-community-card-post-a')
    hidden = true
    act(() => {
      imageEvents.errors.get('community-card-image-post-a')!()
    })
    await waitFor(() => expect(detailReads).toBeGreaterThan(1))
    await waitFor(() =>
      expect(screen.queryByTestId('highlighted-community-card-post-a')).toBeNull()
    )
  })

  it('6.3-MOB-027 ignores refresh metadata after a filter change during detail revalidation', async () => {
    setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
    const gate = raceDeferred()
    let reads = 0
    serveFeed((url, index) =>
      HttpResponse.json({
        data: feed({
          mode: url.searchParams.get('mode') === 'all' ? 'all' : 'auto',
          items: [],
          nextCursor:
            index === 0 || url.searchParams.has('cursor')
              ? null
              : url.searchParams.get('mode') === 'all'
                ? 'current-filter-cursor'
                : 'stale-refresh-cursor',
        }),
      })
    )
    server.use(
      http.get('*/api/v1/community/posts/:postId', async () => {
        reads += 1
        if (reads > 1) {
          await gate.promise
        }
        return HttpResponse.json({
          data: { ...item(), reactions: raceZero },
        })
      })
    )
    try {
      await render(<CommunityScreen />)
      await screen.findByTestId('highlighted-community-card-post-a')
      act(() => {
        imageEvents.errors.get('community-card-image-post-a')!()
      })
      await waitFor(() => expect(reads).toBe(2))
      const staleDetail: unknown = vi.mocked(communityClient.getCommunityPostFromMobile)
        .mock.results[1]!.value
      // Attach before changing the filter, whose abort may reject this promise.
      const staleSettled = Promise.allSettled([staleDetail])
      await browserUser.click(screen.getByTestId('community-filter-chip-all'))
      await waitFor(() =>
        expect(
          screen.getByTestId('community-filter-chip-all').getAttribute('aria-pressed')
        ).toBe('true')
      )
      // The superseded request may already be aborted, so it has no visible
      // completion. Await the real client's settlement and flush React.
      await act(async () => {
        gate.release()
        await staleSettled
      })
      expect(
        screen.getByTestId('community-filter-chip-all').getAttribute('aria-pressed')
      ).toBe('true')
      await waitFor(() =>
        expect(
          feedUrls.some(
            (url) => url.searchParams.get('cursor') === 'current-filter-cursor'
          )
        ).toBe(true)
      )
      expect(
        feedUrls.some((url) => url.searchParams.get('cursor') === 'stale-refresh-cursor')
      ).toBe(false)
    } finally {
      gate.release()
    }
  })
  it('6.3-MOB-025 an older feed cannot resurrect a post after a mutation 404', async () => {
    const gate = raceDeferred()
    const first = { ...item(), reactions: raceZero }
    serveFeed(async (_url, index) => {
      if (index) await gate.promise
      return HttpResponse.json({
        data: feed({
          mode: index ? 'all' : 'auto',
          items: index
            ? [
                first,
                {
                  ...first,
                  id: 'native-feed-sentinel',
                  caption: 'Fenced native feed completed.',
                },
              ]
            : [first],
        }),
      })
    })
    server.use(
      http.put('*/api/v1/community/posts/:postId/reaction', () =>
        errorEnvelope(404, 'Community post not found.')
      )
    )
    try {
      await render(<CommunityScreen />)
      // Keep an independently mounted highlighted copy while the list remounts for filtering.
      setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
      server.use(
        http.get('*/api/v1/community/posts/:postId', () =>
          HttpResponse.json({ data: first })
        )
      )
      await browserUser.click(await screen.findByTestId('community-filter-chip-all'))
      await screen.findByTestId('highlighted-community-card-post-a')
      await waitFor(() => expect(feedUrls).toHaveLength(2))
      await browserUser.click(screen.getByRole('button', { name: 'Applaud, 0' }))
      await waitFor(() =>
        expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
      )
      gate.release()
      await screen.findByText('Fenced native feed completed.')
      expect(screen.queryByTestId('community-post-card-post-a')).toBeNull()
    } finally {
      gate.release()
    }
  })
  it('6.3-MOB-026 shares pending ownership when detail replaces the feed card', async () => {
    setMockParams({ source: 'notification', type: 'community', cardId: 'post-a' })
    const detail = raceDeferred()
    const mutation = raceDeferred()
    const requests: SetCommunityReactionInput[] = []
    serveFeed(() =>
      HttpResponse.json({ data: feed({ items: [{ ...item(), reactions: raceZero }] }) })
    )
    server.use(
      http.get('*/api/v1/community/posts/:postId', async () => {
        await detail.promise
        return HttpResponse.json({ data: { ...item(), reactions: raceZero } })
      }),
      http.put('*/api/v1/community/posts/:postId/reaction', async ({ request }) => {
        requests.push((await request.json()) as SetCommunityReactionInput)
        await mutation.promise
        return HttpResponse.json({ data: raceOne })
      })
    )
    try {
      await render(<CommunityScreen />)
      await browserUser.click(await screen.findByRole('button', { name: 'Applaud, 0' }))
      await waitFor(() => expect(requests).toHaveLength(1))
      detail.release()
      await screen.findByTestId('highlighted-community-card-post-a')
      expect(
        screen.getByRole('button', { name: 'Love, 0' }).getAttribute('aria-disabled')
      ).toBe('true')
      await browserUser.click(screen.getByRole('button', { name: 'Love, 0' }), {
        force: true,
      })
      expect(requests).toHaveLength(1)
      mutation.release()
      expect(
        (await screen.findByRole('button', { name: 'Applaud, 1' })).getAttribute(
          'aria-pressed'
        )
      ).toBe('true')
    } finally {
      detail.release()
      mutation.release()
    }
  })

  it('6.3-MOB-028 marks every reaction control busy while a reaction request runs', async () => {
    const mutation = raceDeferred()
    serveFeed(() =>
      HttpResponse.json({ data: feed({ items: [{ ...item(), reactions: raceZero }] }) })
    )
    server.use(
      http.put('*/api/v1/community/posts/:postId/reaction', async () => {
        await mutation.promise
        return HttpResponse.json({ data: raceOne })
      })
    )
    const busyStates = () =>
      within(screen.getByTestId('community-reactions-post-a'))
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-busy'))
    try {
      await render(<CommunityScreen />)
      const applause = await screen.findByRole('button', { name: 'Applaud, 0' })
      expect(busyStates()).toEqual(['false', 'false', 'false'])

      await browserUser.click(applause)
      await waitFor(() => expect(busyStates()).toEqual(['true', 'true', 'true']))

      mutation.release()
      await screen.findByRole('button', { name: 'Applaud, 1' })
      expect(busyStates()).toEqual(['false', 'false', 'false'])
    } finally {
      mutation.release()
    }
  })
}

// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
// Story 6.7: the web Home spotlight teaser's re-read, expiry and deadline under a
// fake clock. Reads are deferred through MSW so each test decides when one settles.
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { COMMUNITY_FEED_DISABLED_MESSAGE } from '@couture/api-client/contracts/http'
import {
  SPOTLIGHT_TEASER_EXPIRY_MS,
  SPOTLIGHT_TEASER_REREAD_MS,
} from '@couture/api-client'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  SPOTLIGHT_PATH,
  cityPage,
  respond,
  setVisibility,
  setupHomeTeaserSuite,
  signIn,
  spotlightItem,
  teaserCalls,
  teaserNodes,
  type Answer,
  type PendingRead,
} from '../../test-utils/home-spotlight-teaser'
import { LookbookPrismLayout } from './lookbook-prism-layout'
import { SPOTLIGHT_TEASER_REQUEST_TIMEOUT_MS } from './home-spotlight-teaser'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
// Passthrough spies: reads stay on the real HTTP boundary, and the wrapper's own
// promises tell a test when a teaser read has settled.
vi.mock('../../lib/community', { spy: true })
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

describe('6.7 web Home spotlight teaser timers', () => {
  setupHomeTeaserSuite()

  it('6.7-WEB-015 re-reads 4 minutes after the last attempt and expires 5 minutes after the read when hidden', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    vi.setSystemTime(Date.parse('2026-10-23T12:00:00.000Z'))
    signIn()
    const teaserReads: PendingRead[] = []
    useMswHandlers(
      http.get(SPOTLIGHT_PATH, async ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('surface') !== 'home_teaser')
          return HttpResponse.json({ data: cityPage() })
        const answer = await new Promise<Answer>((resolve) => {
          teaserReads.push({ url, resolve })
        })
        return respond(answer)
      })
    )
    const flush = async () => {
      for (let round = 0; round < 20; round += 1)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
    }
    render(<LookbookPrismLayout />)
    for (let round = 0; round < 50 && teaserReads.length === 0; round += 1) await flush()
    teaserReads[0]!.resolve({ status: 200, body: { data: cityPage() } })
    await flush()
    expect(screen.getByTestId('home-spotlight-teaser-link')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS - 1)
    })
    expect(teaserReads).toHaveLength(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    for (let round = 0; round < 50 && teaserReads.length === 1; round += 1) await flush()
    expect(teaserReads).toHaveLength(2)
    // In flight, the current value stays.
    expect(screen.getByTestId('home-spotlight-teaser-link')).toBeInTheDocument()
    teaserReads[1]!.resolve({
      status: 200,
      body: {
        data: cityPage([
          spotlightItem('look-2', 1, { author: { displayName: 'Bea', isSelf: false } }),
        ]),
      },
    })
    await flush()
    expect(screen.getByTestId('home-spotlight-teaser-author').textContent).toBe('Bea')

    // Hidden, nothing re-reads; the value expires 5 minutes after its read.
    act(() => setVisibility('hidden'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_EXPIRY_MS - 1)
    })
    expect(screen.getByTestId('home-spotlight-teaser-link')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(teaserNodes()).toEqual([])
    expect(teaserReads).toHaveLength(2)
  })

  describe('under a fake clock', () => {
    const teaserReads: PendingRead[] = []
    const flush = async () => {
      for (let round = 0; round < 20; round += 1)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
    }

    /** Fakes the clock and makes every teaser read wait for the test. */
    function useFakeClockTeaserReads() {
      teaserReads.length = 0
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      })
      vi.setSystemTime(Date.parse('2026-10-23T12:00:00.000Z'))
      signIn()
      useMswHandlers(
        http.get(SPOTLIGHT_PATH, async ({ request }) => {
          const url = new URL(request.url)
          if (url.searchParams.get('surface') !== 'home_teaser')
            return HttpResponse.json({ data: cityPage() })
          const answer = await new Promise<Answer>((resolve) => {
            teaserReads.push({ url, resolve })
          })
          return respond(answer)
        })
      )
    }

    /** Shows the teaser, then lets the 4-minute re-read start and hang. */
    async function showTeaserWithRereadOut() {
      render(<LookbookPrismLayout />)
      for (let round = 0; round < 50 && teaserReads.length === 0; round += 1)
        await flush()
      teaserReads[0]!.resolve({ status: 200, body: { data: cityPage() } })
      await flush()
      expect(screen.getByTestId('home-spotlight-teaser-link')).toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS)
      })
      for (let round = 0; round < 50 && teaserReads.length === 1; round += 1)
        await flush()
      expect(teaserReads).toHaveLength(2)
    }

    it.each([
      [
        'the disabled 403',
        {
          status: 403,
          body: {
            statusCode: 403,
            code: 'denied',
            message: 'Community is not available for this account yet.',
          },
        },
      ],
      [
        'the disabled 503',
        {
          status: 503,
          body: { statusCode: 503, message: COMMUNITY_FEED_DISABLED_MESSAGE },
        },
      ],
      [
        'a 500',
        { status: 500, body: { statusCode: 500, message: 'Internal server error' } },
      ],
    ] as const)(
      '6.7-WEB-025 %s on the first read starts no retry loop',
      async (_name, refusal) => {
        useFakeClockTeaserReads()
        render(<LookbookPrismLayout />)
        for (let round = 0; round < 50 && teaserReads.length === 0; round += 1)
          await flush()
        teaserReads[0]!.resolve(refusal)
        await flush()
        expect(teaserNodes()).toEqual([])
        await act(async () => {
          await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS * 2)
        })
        await flush()
        expect(teaserReads).toHaveLength(1)
        expect(teaserCalls()).toHaveLength(1)
      }
    )

    it('6.7-WEB-017 a contention 503 on the re-read removes the teaser at once and reads nothing after the hint', async () => {
      useFakeClockTeaserReads()
      await showTeaserWithRereadOut()
      teaserReads[1]!.resolve({
        status: 503,
        body: {
          statusCode: 503,
          code: 'unavailable',
          retryAfterSeconds: 1,
          message: 'Community is temporarily unavailable.',
        },
      })
      await flush()
      expect(teaserNodes()).toEqual([])
      // Past the one-second hint and three re-read periods: no second attempt.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000 + SPOTLIGHT_TEASER_REREAD_MS * 3)
      })
      await flush()
      expect(teaserReads).toHaveLength(2)
      expect(teaserCalls()).toHaveLength(2)
    })

    it('6.7-WEB-018 a re-read that never answers hits the 10-second deadline and removes the teaser', async () => {
      useFakeClockTeaserReads()
      await showTeaserWithRereadOut()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REQUEST_TIMEOUT_MS - 1)
      })
      await flush()
      expect(screen.getByTestId('home-spotlight-teaser-link')).toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      await flush()
      expect(teaserNodes()).toEqual([])
      expect(teaserCalls()).toHaveLength(2)
    })
  })
})

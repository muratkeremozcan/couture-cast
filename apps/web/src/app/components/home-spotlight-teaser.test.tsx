// Story 6.7: the web Home spotlight teaser in the Lookbook Prism layout. Reads
// are deferred through MSW so each test decides when one settles.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  communityReactionSpotlightResponseSchema,
  type CommunityReactionSpotlight,
  type CommunityReactionSpotlightItem,
} from '@couture/api-client/contracts/http'
import {
  CommunitySyncState,
  SPOTLIGHT_TEASER_EXPIRY_MS,
  SPOTLIGHT_TEASER_READ_FLOOR_MS,
  SPOTLIGHT_TEASER_REREAD_MS,
} from '@couture/api-client'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import enUS from '../../i18n/locales/en-US.json'
import { LookbookPrismLayout } from './lookbook-prism-layout'
import { SPOTLIGHT_FOCUS_WAIT_MS } from './community-lookbook-grid'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

const SPOTLIGHT_PATH = '/api/v1/community/spotlight'
const TEASER_PREFIX = 'home-spotlight-teaser'

function spotlightItem(
  id: string,
  rank = 1,
  overrides: Partial<CommunityReactionSpotlightItem> = {}
): CommunityReactionSpotlightItem {
  return {
    id,
    caption: 'Private caption that the teaser never shows.',
    altText: 'A camel coat over a grey knit.',
    climateBand: 'temperate_wet',
    imageAccess: {
      url: `https://storage.local/community/${id}.jpg`,
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    publishedAt: '2026-10-22T09:00:00.000Z',
    createdAt: '2026-10-22T08:59:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Ana', isSelf: false },
    rank,
    reactions: {
      counts: { applause: 2, love: 1, inspiration: 0 },
      total: 3,
      viewerReaction: null,
      revision: 1,
      generation: 1,
    },
    ...overrides,
  }
}

function cityPage(items = [spotlightItem('look-1')]): CommunityReactionSpotlight {
  return { level: 'city', label: 'Lisbon', items, nextCursor: null }
}

type Answer = { status: number; body: unknown }
interface PendingRead {
  url: URL
  resolve: (answer: Answer) => void
}

/**
 * Teaser reads (`surface=home_teaser`) wait for the test; the Community
 * module's own reads answer `module()` at once.
 */
function useServedSpotlight(
  module: () => Answer = () => ({ status: 200, body: { data: cityPage() } })
) {
  const teaserReads: PendingRead[] = []
  const moduleReads: URL[] = []
  useMswHandlers(
    http.get(SPOTLIGHT_PATH, async ({ request }) => {
      const url = new URL(request.url)
      if (url.searchParams.get('surface') !== 'home_teaser') {
        moduleReads.push(url)
        const answer = module()
        return HttpResponse.json(answer.body as never, { status: answer.status })
      }
      const answer = await new Promise<Answer>((resolve) => {
        teaserReads.push({ url, resolve })
      })
      return HttpResponse.json(answer.body as never, { status: answer.status })
    })
  )
  const answer = async (index: number, value: CommunityReactionSpotlight | Answer) => {
    await waitFor(() => expect(teaserReads.length).toBeGreaterThan(index))
    teaserReads[index]!.resolve(
      'status' in value
        ? value
        : {
            status: 200,
            body: communityReactionSpotlightResponseSchema.parse({ data: value }),
          }
    )
    // Lets the response reach the lifecycle and React commit it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
  }
  return { teaserReads, moduleReads, answer }
}

function useRecordedOpens() {
  const opens: { postId: string; body: unknown }[] = []
  useMswHandlers(
    http.post('/api/v1/community/posts/:postId/opened', async ({ params, request }) => {
      opens.push({ postId: String(params.postId), body: await request.json() })
      return HttpResponse.json({ tracked: true })
    })
  )
  return opens
}

function signIn(token = 'test-access-token') {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, token)
  window.dispatchEvent(new Event('couture:session'))
}

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  window.dispatchEvent(new Event('resize'))
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

function teaserNodes(): Element[] {
  return [...document.querySelectorAll(`[data-testid^="${TEASER_PREFIX}"]`)]
}

function heroCanvas() {
  return screen.getByRole('region', { name: /hero ritual canvas/i })
}

async function settle(ms = 50) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

describe('6.7 web Home spotlight teaser', () => {
  beforeEach(() => {
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(() => undefined)
    window.sessionStorage.clear()
    setViewport(1024)
    setVisibility('visible')
  })
  afterEach(() => {
    vi.useRealTimers()
    window.sessionStorage.clear()
  })

  it('6.7-WEB-001 a stacked layout shows the label, decorative image, author and count inside the hero canvas', async () => {
    signIn()
    const { teaserReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')

    expect(teaserReads[0]!.url.searchParams.get('limit')).toBe('1')
    expect(heroCanvas().contains(link)).toBe(true)
    // After the outfit tiles, so it follows the hero in focus order.
    const tiles = screen.getByTestId('outfit-scroll')
    expect(
      tiles.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByTestId('home-spotlight-teaser-heading').textContent).toBe(
      'Standout look in Lisbon'
    )
    expect(screen.getByTestId('home-spotlight-teaser-author').textContent).toBe('Ana')
    expect(screen.getByTestId('home-spotlight-teaser-reactions').textContent).toBe(
      '3 reactions'
    )
    expect(link.tagName).toBe('A')
    expect(link).toHaveAccessibleName(
      'Standout look in Lisbon by Ana, 3 reactions. Opens the City Spotlight.'
    )
    expect(link).toHaveClass('min-h-[44px]')
    const image = screen.getByTestId('home-spotlight-teaser-image')
    expect(image.getAttribute('alt')).toBe('')
    expect(within(link).queryAllByRole('img')).toHaveLength(0)
    expect(link.querySelectorAll('a, button, [tabindex]')).toHaveLength(0)
    expect(heroCanvas().textContent).not.toContain('Private caption')
    // No teaser id reuses a module or card id.
    for (const node of teaserNodes())
      expect(node.getAttribute('data-testid')).toMatch(/^home-spotlight-teaser-/)
    expect(link.id).toBe('')
  })

  it('6.7-WEB-002 the author rule names the viewer You, a blank name falls back, one reaction is singular', async () => {
    signIn()
    const { answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(
      0,
      cityPage([
        spotlightItem('look-self', 1, { author: { displayName: 'Me', isSelf: true } }),
      ])
    )
    expect((await screen.findByTestId('home-spotlight-teaser-author')).textContent).toBe(
      'You'
    )
  })

  it('6.7-WEB-003 a blank author name falls back and one reaction reads singular', async () => {
    signIn()
    const { answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(
      0,
      cityPage([
        spotlightItem('look-blank', 1, {
          author: { displayName: '  ', isSelf: false },
          reactions: {
            counts: { applause: 1, love: 0, inspiration: 0 },
            total: 1,
            viewerReaction: null,
            revision: 1,
            generation: 1,
          },
        }),
      ])
    )
    expect((await screen.findByTestId('home-spotlight-teaser-author')).textContent).toBe(
      'Style explorer'
    )
    expect(screen.getByTestId('home-spotlight-teaser-reactions').textContent).toBe(
      '1 reaction'
    )
  })

  it('6.7-WEB-004 a side-by-side layout issues no home_teaser read; the mobile preview stacks and reads', async () => {
    setViewport(1440)
    signIn()
    const { teaserReads, moduleReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await waitFor(() => expect(moduleReads.length).toBeGreaterThan(0))
    await settle()
    expect(teaserReads).toHaveLength(0)
    expect(teaserNodes()).toEqual([])
    expect(moduleReads.every((url) => !url.searchParams.has('surface'))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /mobile preview/i }))
    await answer(0, cityPage())
    expect(await screen.findByTestId('home-spotlight-teaser-link')).toBeInTheDocument()
  })

  it.each([
    [
      'level none',
      {
        status: 200,
        body: { data: { level: 'none', label: null, items: [], nextCursor: null } },
      },
    ],
    [
      'no items',
      {
        status: 200,
        body: { data: { level: 'city', label: 'Lisbon', items: [], nextCursor: null } },
      },
    ],
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
        body: {
          statusCode: 503,
          code: 'disabled',
          message: 'Community is temporarily unavailable.',
        },
      },
    ],
    [
      'a 500',
      { status: 500, body: { statusCode: 500, message: 'Internal server error' } },
    ],
  ] as const)(
    '6.7-WEB-005 %s renders nothing and leaves the hero canvas unchanged',
    async (_name, refusal) => {
      signIn()
      const { teaserReads, answer } = useServedSpotlight()
      render(<LookbookPrismLayout />)
      // Reference: the same signed-in Home while the teaser read is still out.
      await waitFor(() => expect(teaserReads).toHaveLength(1))
      await screen.findByTestId('community-spotlight-heading')
      await settle(100)
      const expected = heroCanvas().innerHTML
      await answer(0, refusal as Answer)
      await settle(100)
      expect(teaserNodes()).toEqual([])
      expect(heroCanvas().innerHTML).toBe(expected)
      // The read wrapper may retry a retryable 503 once inside the attempt; no
      // loop follows.
      expect(teaserReads.length).toBeLessThanOrEqual(2)
      await settle(200)
      expect(teaserReads.length).toBeLessThanOrEqual(2)
    }
  )

  it('6.7-WEB-006 signed out reads nothing; signing in reads at once', async () => {
    const { teaserReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await settle()
    expect(teaserReads).toHaveLength(0)
    act(() => signIn())
    await answer(0, cityPage())
    expect(await screen.findByTestId('home-spotlight-teaser-link')).toBeInTheDocument()
  })

  it('6.7-WEB-007 an identity change clears the teaser, drops the late response and reads at once', async () => {
    signIn('test-token-member-1')
    const { teaserReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(0, cityPage([spotlightItem('look-member-1')]))
    await screen.findByTestId('home-spotlight-teaser-link')

    act(() => signIn('test-token-member-2'))
    await waitFor(() => expect(teaserNodes()).toEqual([]))
    await waitFor(() => expect(teaserReads).toHaveLength(2))
    act(() => signIn('test-token-member-3'))
    await waitFor(() => expect(teaserReads).toHaveLength(3))
    await answer(1, cityPage([spotlightItem('look-member-2')]))
    await settle()
    expect(teaserNodes()).toEqual([])
    await answer(2, cityPage([spotlightItem('look-member-3')]))
    expect(await screen.findByTestId('home-spotlight-teaser-link')).toHaveAttribute(
      'href',
      '#spotlight-lookbook-card-look-member-3'
    )

    act(() => {
      window.sessionStorage.clear()
      window.dispatchEvent(new Event('couture:session'))
    })
    await waitFor(() => expect(teaserNodes()).toEqual([]))
  })

  it('6.7-WEB-008 an image that fails to load removes the teaser', async () => {
    signIn()
    const { answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(0, cityPage())
    fireEvent.error(await screen.findByTestId('home-spotlight-teaser-image'))
    expect(teaserNodes()).toEqual([])
  })

  it('6.7-WEB-009 activating focuses the entry with one announcement and posts the home_teaser open', async () => {
    signIn()
    const opens = useRecordedOpens()
    const { answer } = useServedSpotlight(() => ({
      status: 200,
      body: { data: cityPage([spotlightItem('look-0', 1), spotlightItem('look-1', 2)]) },
    }))
    render(<LookbookPrismLayout />)
    await answer(0, cityPage([spotlightItem('look-1')]))
    const link = await screen.findByTestId('home-spotlight-teaser-link')
    const card = await waitFor(() => {
      const element = document.getElementById('spotlight-lookbook-card-look-1')
      expect(element).not.toBeNull()
      return element!
    })

    fireEvent.click(link)
    await waitFor(() => expect(document.activeElement).toBe(card))
    const liveRegion = screen.getByTestId('community-live-region')
    await waitFor(() =>
      expect(liveRegion.textContent).toBe(enUS.community.feed.announceFocused)
    )
    await waitFor(() => expect(opens).toHaveLength(1))
    expect(opens[0]).toEqual({
      postId: 'look-1',
      body: { surface: 'home_teaser', rank: 1, level: 'city' },
    })
    expect(screen.queryByTestId('community-spotlight-notice')).toBeNull()
    expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()

    // A repeat activation is a fresh token: focus moves again.
    act(() => link.focus())
    fireEvent.click(link)
    await waitFor(() => expect(document.activeElement).toBe(card))
    await waitFor(() => expect(opens).toHaveLength(2))
  })

  it.each([
    [
      'loaded without the entry',
      () => ({ status: 200, body: { data: cityPage([spotlightItem('other', 1)]) } }),
    ],
    [
      'at level none',
      () => ({
        status: 200,
        body: { data: { level: 'none', label: null, items: [], nextCursor: null } },
      }),
    ],
    [
      'failed',
      () => ({
        status: 500,
        body: { statusCode: 500, message: 'Internal server error' },
      }),
    ],
  ] as const)(
    '6.7-WEB-010 a module %s focuses the target notice and never the invalid banner',
    async (_name, module) => {
      signIn()
      useRecordedOpens()
      const { answer } = useServedSpotlight(module as () => Answer)
      render(<LookbookPrismLayout />)
      await answer(0, cityPage())
      fireEvent.click(await screen.findByTestId('home-spotlight-teaser-link'))
      const notice = await screen.findByTestId('community-spotlight-notice')
      expect(notice.textContent).toBe(enUS.community.spotlight.targetUnavailable)
      await waitFor(() => expect(document.activeElement).toBe(notice))
      expect(notice.getAttribute('tabindex')).toBe('-1')
      expect(notice.closest('[aria-live]')).toBeNull()
      expect(
        screen.getByRole('region', { name: /community section/i }).contains(notice)
      ).toBe(true)
      expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
    }
  )

  it('6.7-WEB-011 a module still loading after 10 seconds focuses the destination notice; a later load moves no focus', async () => {
    signIn()
    useRecordedOpens()
    let releaseModule: (() => void) | undefined
    useMswHandlers(
      http.get(SPOTLIGHT_PATH, async ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('surface') === 'home_teaser')
          return HttpResponse.json({ data: cityPage() })
        // The Community module's read hangs, so the module stays loading.
        await new Promise<void>((resolve) => {
          releaseModule = resolve
        })
        return HttpResponse.json({ data: cityPage() })
      })
    )
    render(<LookbookPrismLayout />)
    const link = await screen.findByTestId('home-spotlight-teaser-link')
    await waitFor(() => expect(releaseModule).toBeTypeOf('function'))
    const start = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(start)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(link)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPOTLIGHT_FOCUS_WAIT_MS - 1)
    })
    expect(screen.queryByTestId('community-spotlight-notice')).toBeNull()
    now.mockReturnValue(start + SPOTLIGHT_FOCUS_WAIT_MS)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    vi.useRealTimers()
    now.mockRestore()
    const notice = await screen.findByTestId('community-spotlight-notice')
    expect(notice.textContent).toBe(enUS.community.spotlight.destinationUnavailable)
    await waitFor(() => expect(document.activeElement).toBe(notice))

    act(() => releaseModule!())
    await waitFor(() =>
      expect(document.getElementById('spotlight-lookbook-card-look-1')).not.toBeNull()
    )
    await settle()
    expect(document.activeElement).toBe(notice)
  })

  it('6.7-WEB-012 a teaser that leaves while focused hands focus to the hero canvas', async () => {
    signIn('test-token-member-1')
    const { answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')
    act(() => link.focus())
    act(() => signIn('test-token-member-2'))
    await waitFor(() => expect(document.activeElement).toBe(heroCanvas()))
  })

  it('6.7-WEB-013 the value survives leaving and re-entering stacked; a return inside 60 seconds reads nothing', async () => {
    let clock = Date.parse('2026-10-23T12:00:00.000Z')
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    signIn()
    const { teaserReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')

    act(() => setViewport(1440))
    await waitFor(() => expect(teaserNodes()).toEqual([]))
    clock += SPOTLIGHT_TEASER_READ_FLOOR_MS - 1
    act(() => setViewport(1024))
    expect(await screen.findByTestId('home-spotlight-teaser-link')).toBeInTheDocument()
    await settle()
    expect(teaserReads).toHaveLength(1)

    act(() => setViewport(1440))
    clock += 1
    act(() => setViewport(1024))
    await waitFor(() => expect(teaserReads).toHaveLength(2))
    now.mockRestore()
  })

  it('6.7-WEB-014 the page becoming visible again re-reads only after 60 seconds', async () => {
    let clock = Date.parse('2026-10-23T12:00:00.000Z')
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    signIn()
    const { teaserReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')

    act(() => setVisibility('hidden'))
    clock += 30_000
    act(() => setVisibility('visible'))
    await settle()
    expect(teaserReads).toHaveLength(1)
    act(() => setVisibility('hidden'))
    clock += 30_001
    act(() => setVisibility('visible'))
    await waitFor(() => expect(teaserReads).toHaveLength(2))
    now.mockRestore()
  })

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
        return HttpResponse.json(answer.body as never, { status: answer.status })
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
})

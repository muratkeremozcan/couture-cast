// Learning path Step 58: Production status and nightly health, production follow-ups.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
// Story 6.7: the web Home spotlight teaser in the Lookbook Prism layout. Reads
// are deferred through MSW so each test decides when one settles. The fake-clock
// re-read, expiry and deadline cases live in home-spotlight-teaser.timers.test.tsx.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { http, HttpResponse } from 'msw'
import { COMMUNITY_FEED_DISABLED_MESSAGE } from '@couture/api-client/contracts/http'
import { SPOTLIGHT_TEASER_READ_FLOOR_MS } from '@couture/api-client'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { signInFixtureMember } from '../../test-utils/member-session'
import {
  TEASER_PREFIX,
  cityPage,
  setVisibility,
  settledTeaserRead,
  setupHomeTeaserSuite,
  signIn,
  spotlightItem,
  teaserCalls,
  teaserNodes,
  useServedSpotlight,
} from '../../test-utils/home-spotlight-teaser'
import { LookbookPrismLayout } from './lookbook-prism-layout'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
// Passthrough spies: reads stay on the real HTTP boundary, and the wrapper's own
// promises tell a test when a teaser read has settled.
vi.mock('../../lib/community', { spy: true })
const router = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}))
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => router }))

/** The `Retry-After` hint, in seconds, the 429 case answers with. */
const RETRY_AFTER_S = 90

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

describe('6.7 web Home spotlight teaser', () => {
  setupHomeTeaserSuite()

  it('6.7-WEB-001 Today shows one linked Spotlight row with decorative art, author and count', async () => {
    signIn()
    const { teaserReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await waitFor(() => expect(teaserReads).toHaveLength(1))
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')
    const root = screen.getByTestId(TEASER_PREFIX)
    expect(root.firstElementChild).toBe(link)
    expect(root.childElementCount).toBe(1)
    expect(teaserReads[0]!.url.searchParams.get('limit')).toBe('1')
    const href = new URL(link.getAttribute('href')!, 'http://local.test')
    expect(href.pathname).toBe('/community')
    expect(Object.fromEntries(href.searchParams)).toMatchObject({
      source: 'app',
      type: 'community',
      cardId: 'look-1',
      focus: 'spotlight',
    })
    expect(href.searchParams.get('focusToken')).toBeTruthy()
    expect(screen.queryByTestId('community-card-grid')).toBeNull()
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
    expect(link).toHaveClass('min-h-11')
    const image = screen.getByTestId('home-spotlight-teaser-image')
    expect(image.getAttribute('alt')).toBe('')
    expect(within(link).queryAllByRole('img')).toHaveLength(0)
    expect(link.querySelectorAll('a, button, [tabindex]')).toHaveLength(0)
    expect(root.textContent).not.toContain('Private caption')
    // No teaser id or test id reuses a module or card id, on the link or inside it.
    for (const node of [link, ...link.querySelectorAll('[data-testid], [id]')]) {
      const testId = node.getAttribute('data-testid')
      if (testId !== null) expect(testId).toMatch(/^home-spotlight-teaser-/)
      if (node.id) expect(node.id).toMatch(/^home-spotlight-teaser-/)
    }
  })

  it('6.7-WEB-002 the author rule names the viewer You', async () => {
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
        body: { statusCode: 503, message: COMMUNITY_FEED_DISABLED_MESSAGE },
      },
    ],
    [
      'a 500',
      { status: 500, body: { statusCode: 500, message: 'Internal server error' } },
    ],
    ['a network error', 'network-error'],
  ] as const)('6.7-WEB-005 %s renders nothing and reads once', async (_name, refusal) => {
    signIn()
    const { teaserReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    // Reference: the same signed-in Home while the teaser read is still out.
    await waitFor(() => expect(teaserReads).toHaveLength(1))
    await answer(0, refusal)
    expect(teaserNodes()).toEqual([])
    // One transport attempt, and the lifecycle schedules nothing after a refusal.
    expect(teaserReads).toHaveLength(1)
    expect(teaserCalls()).toHaveLength(1)
  })

  it('6.7-WEB-006 signed out reads nothing; signing in reads at once', async () => {
    const { teaserReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    // The member resolves in the mount effects; signed out, nothing reads.
    expect(teaserCalls()).toHaveLength(0)
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
    // Cleared in the same commit, and the new member reads at once.
    expect(teaserNodes()).toEqual([])
    expect(teaserCalls()).toHaveLength(2)
    await waitFor(() => expect(teaserReads).toHaveLength(2))
    act(() => signIn('test-token-member-3'))
    await waitFor(() => expect(teaserReads).toHaveLength(3))
    await answer(1, cityPage([spotlightItem('look-member-2')]))
    await settledTeaserRead(1)
    expect(teaserNodes()).toEqual([])
    await answer(2, cityPage([spotlightItem('look-member-3')]))
    const replacement = await screen.findByTestId('home-spotlight-teaser-link')
    const href = new URL(replacement.getAttribute('href')!, 'http://local.test')
    expect(href.pathname).toBe('/community')
    expect(href.searchParams.get('cardId')).toBe('look-member-3')
    expect(href.searchParams.get('focus')).toBe('spotlight')

    act(() => {
      window.sessionStorage.clear()
      window.dispatchEvent(new Event('couture:session'))
    })
    expect(teaserNodes()).toEqual([])
    expect(teaserCalls()).toHaveLength(3)
  })

  it('6.7-WEB-008 an image that fails to load removes the teaser', async () => {
    signIn()
    const { answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(0, cityPage())
    fireEvent.error(await screen.findByTestId('home-spotlight-teaser-image'))
    expect(teaserNodes()).toEqual([])
  })

  it('6.7-WEB-012 returns focus to Today when its selected Spotlight row is removed', async () => {
    signInFixtureMember()
    useMswHandlers(
      http.get('/api/v1/ritual', () =>
        HttpResponse.json(
          { message: 'No location preferences found for user' },
          { status: 400 }
        )
      )
    )
    const { answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(0, cityPage())
    const primary = await screen.findByTestId('home-set-city')
    const link = await screen.findByTestId('home-spotlight-teaser-link')
    act(() => link.focus())
    expect(link).toHaveFocus()
    fireEvent.error(screen.getByTestId('home-spotlight-teaser-image'))
    await waitFor(() => expect(primary).toHaveFocus())
    expect(screen.queryByTestId('home-spotlight-teaser-link')).toBeNull()
  })

  it('6.7-WEB-021 posts one Home open and creates a fresh focus token per activation', async () => {
    signInFixtureMember()
    router.push.mockClear()
    const opens = useRecordedOpens()
    const { answer } = useServedSpotlight()
    render(
      <AppRouterContext.Provider value={router}>
        <LookbookPrismLayout />
      </AppRouterContext.Provider>
    )
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')
    const user = userEvent.setup()
    await user.click(link)
    await waitFor(() =>
      expect(opens).toEqual([
        { postId: 'look-1', body: { surface: 'home_teaser', rank: 1, level: 'city' } },
      ])
    )
    await user.click(link)
    await waitFor(() => expect(opens).toHaveLength(2))
    const tokens = router.push.mock.calls.map(([url]) =>
      new URL(url, 'http://local.test').searchParams.get('focusToken')
    )
    expect(tokens).toHaveLength(2)
    expect(tokens.every((token) => token?.startsWith('today-') === true)).toBe(true)
    expect(new Set(tokens).size).toBe(2)
  })

  it('6.7-WEB-014 the page becoming visible again re-reads only after 60 seconds', async () => {
    let clock = Date.parse('2026-10-23T12:00:00.000Z')
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    signIn()
    const { teaserReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')

    const halfFloor = SPOTLIGHT_TEASER_READ_FLOOR_MS / 2
    act(() => setVisibility('hidden'))
    clock += halfFloor
    act(() => setVisibility('visible'))
    expect(teaserCalls()).toHaveLength(1)
    act(() => setVisibility('hidden'))
    // Together just past the floor.
    clock += halfFloor + 1
    act(() => setVisibility('visible'))
    expect(teaserCalls()).toHaveLength(2)
    await waitFor(() => expect(teaserReads).toHaveLength(2))
    now.mockRestore()
  })

  it('6.7-WEB-016 a 429 Retry-After removes the teaser and defers the next read until it passes', async () => {
    let clock = Date.parse('2026-10-23T12:00:00.000Z')
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    signIn()
    const { answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')
    act(() => setVisibility('hidden'))
    clock += SPOTLIGHT_TEASER_READ_FLOOR_MS
    act(() => setVisibility('visible'))
    await answer(1, {
      status: 429,
      headers: { 'Retry-After': String(RETRY_AFTER_S) },
      body: { statusCode: 429, message: 'Too many spotlight reads.' },
    })
    await settledTeaserRead(1)
    expect(teaserNodes()).toEqual([])

    // One second short of the hint, then the hint itself.
    act(() => setVisibility('hidden'))
    clock += (RETRY_AFTER_S - 1) * 1000
    act(() => setVisibility('visible'))
    expect(teaserCalls()).toHaveLength(2)
    act(() => setVisibility('hidden'))
    clock += 1000
    act(() => setVisibility('visible'))
    expect(teaserCalls()).toHaveLength(3)
  })
})

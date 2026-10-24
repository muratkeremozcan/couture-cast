// Story 6.7: the web Home spotlight teaser in the Lookbook Prism layout. Reads
// are deferred through MSW so each test decides when one settles.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  COMMUNITY_FEED_DISABLED_MESSAGE,
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
import { getCommunitySpotlightFromWeb } from '../../lib/community'
import { SPOTLIGHT_TEASER_REQUEST_TIMEOUT_MS } from './home-spotlight-teaser'
import { SPOTLIGHT_FOCUS_WAIT_MS } from './community-lookbook-grid'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
// Passthrough spies: reads stay on the real HTTP boundary, and the wrapper's own
// promises tell a test when a teaser read has settled.
vi.mock('../../lib/community', { spy: true })
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

const SPOTLIGHT_PATH = '/api/v1/community/spotlight'
/** The `Retry-After` hint, in seconds, the 429 case answers with. */
const RETRY_AFTER_S = 90
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

type Answer =
  | { status: number; body: unknown; headers?: Record<string, string> }
  | 'network-error'
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
        return respond(module())
      }
      const answer = await new Promise<Answer>((resolve) => {
        teaserReads.push({ url, resolve })
      })
      return respond(answer)
    })
  )
  const answer = async (index: number, value: CommunityReactionSpotlight | Answer) => {
    await waitFor(() => expect(teaserReads.length).toBeGreaterThan(index))
    teaserReads[index]!.resolve(
      value === 'network-error' || 'status' in value
        ? value
        : {
            status: 200,
            body: communityReactionSpotlightResponseSchema.parse({ data: value }),
          }
    )
    // Waits on the wrapper's own promise, then lets React commit the result.
    await settledTeaserRead(index)
  }
  return { teaserReads, moduleReads, answer }
}

function respond(answer: Answer) {
  if (answer === 'network-error') return HttpResponse.error()
  return HttpResponse.json(answer.body as never, {
    status: answer.status,
    headers: answer.headers,
  })
}

/** The wrapper calls the teaser made, in order; the Community module's are left out. */
function teaserCalls() {
  const mock = vi.mocked(getCommunitySpotlightFromWeb).mock
  return mock.calls.flatMap(([request], index) =>
    request?.surface === 'home_teaser' ? [mock.results[index]!] : []
  )
}

/** Waits until teaser read `index` settled at the client, then lets React commit. */
async function settledTeaserRead(index: number) {
  await waitFor(() => expect(teaserCalls().length).toBeGreaterThan(index))
  await (teaserCalls()[index]!.value as Promise<unknown>).then(
    () => undefined,
    () => undefined
  )
  await act(async () => {
    await Promise.resolve()
  })
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

/** True when the hero canvas ends with the outfit tiles: nothing is reserved after them. */
function heroEndsWithOutfits(): boolean {
  // An empty hero canvas proves nothing about what follows the tiles.
  const last = heroCanvas().lastElementChild
  expect(last).not.toBeNull()
  return Boolean(last?.querySelector('[data-testid="outfit-scroll"]'))
}

/** The hero canvas markup with the teaser link taken out. */
function heroWithoutTeaser(): string {
  const clone = heroCanvas().cloneNode(true) as HTMLElement
  clone.querySelector(`[data-testid="${TEASER_PREFIX}-link"]`)?.remove()
  return clone.innerHTML
}

/**
 * Records every message the community live region takes, one entry per
 * announcement, so a repeated announcement shows even when its text matches.
 */
function recordAnnouncements(): string[] {
  const region = screen.getByTestId('community-live-region')
  const seen: string[] = []
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node.textContent) seen.push(node.textContent)
  })
  observer.observe(region, { childList: true, subtree: true })
  onTestFinished(() => observer.disconnect())
  return seen
}

/** Lets the frames a focus hand-off is scheduled on run. */
async function nextFrames(count = 3) {
  for (let frame = 0; frame < count; frame += 1)
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
}

describe('6.7 web Home spotlight teaser', () => {
  const scrollIntoView = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView'
  )
  const scrollIntoViewStub = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom has no layout, so it has no scrollIntoView; the mobile preview and the
    // community focus moves call it.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoViewStub,
    })
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(() => undefined)
    window.sessionStorage.clear()
    setViewport(1024)
    setVisibility('visible')
  })
  afterEach(() => {
    vi.useRealTimers()
    window.sessionStorage.clear()
    if (scrollIntoView)
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })

  it('6.7-WEB-001 a stacked layout shows the label, decorative image, author and count inside the hero canvas', async () => {
    signIn()
    const { teaserReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await waitFor(() => expect(teaserReads).toHaveLength(1))
    await screen.findByTestId('community-spotlight-heading')
    const heroBefore = heroCanvas().innerHTML
    expect(heroEndsWithOutfits()).toBe(true)
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')

    // The hero is unchanged apart from the teaser appended after it.
    expect(heroCanvas().lastElementChild).toBe(link)
    expect(heroWithoutTeaser()).toBe(heroBefore)
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

  it('6.7-WEB-004 a side-by-side layout issues no home_teaser read; the mobile preview stacks and reads', async () => {
    setViewport(1440)
    signIn()
    const { teaserReads, moduleReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await waitFor(() => expect(moduleReads.length).toBeGreaterThan(0))
    // The teaser would read in the mount effects, before any module request.
    expect(teaserCalls()).toHaveLength(0)
    expect(teaserReads).toHaveLength(0)
    expect(teaserNodes()).toEqual([])
    expect(moduleReads.every((url) => !url.searchParams.has('surface'))).toBe(true)

    await userEvent.setup().click(screen.getByRole('button', { name: /mobile preview/i }))
    await answer(0, cityPage())
    expect(await screen.findByTestId('home-spotlight-teaser-link')).toBeInTheDocument()
    // The preview scrolled the frame into view on the next animation frame.
    await waitFor(() =>
      expect(scrollIntoViewStub).toHaveBeenCalledWith({
        block: 'start',
      })
    )
  })

  it('6.7-WEB-019 unmounting before the preview frame runs leaves nothing to throw', async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const cancelled = vi.spyOn(window, 'cancelAnimationFrame')
    const view = render(<LookbookPrismLayout />)
    await userEvent.setup().click(screen.getByRole('button', { name: /mobile preview/i }))
    expect(frames).toHaveLength(1)
    view.unmount()
    expect(cancelled).toHaveBeenCalledWith(1)
  })

  it.each([
    [1279, 'stacks and reads'],
    [1280, 'sits side by side and reads nothing'],
  ] as const)('6.7-WEB-020 at %i px the layout %s', async (width, _outcome) => {
    setViewport(width)
    signIn()
    const { teaserReads, moduleReads, answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await waitFor(() => expect(moduleReads.length).toBeGreaterThan(0))
    if (width < 1280) {
      await answer(0, cityPage())
      expect(await screen.findByTestId('home-spotlight-teaser-link')).toBeInTheDocument()
      expect(teaserReads).toHaveLength(1)
    } else {
      // The teaser would read in the mount effects, before any module request.
      expect(teaserCalls()).toHaveLength(0)
      expect(teaserReads).toHaveLength(0)
      expect(teaserNodes()).toEqual([])
    }
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
  ] as const)(
    '6.7-WEB-005 %s renders nothing, reads once and leaves the hero canvas unchanged',
    async (_name, refusal) => {
      signIn()
      const { teaserReads, answer } = useServedSpotlight()
      render(<LookbookPrismLayout />)
      // Reference: the same signed-in Home while the teaser read is still out.
      await waitFor(() => expect(teaserReads).toHaveLength(1))
      await screen.findByTestId('community-spotlight-heading')
      const expected = heroCanvas().innerHTML
      expect(heroEndsWithOutfits()).toBe(true)
      await answer(0, refusal as Answer)
      expect(teaserNodes()).toEqual([])
      expect(heroCanvas().innerHTML).toBe(expected)
      expect(heroEndsWithOutfits()).toBe(true)
      // One transport attempt, and the lifecycle schedules nothing after a refusal.
      expect(teaserReads).toHaveLength(1)
      expect(teaserCalls()).toHaveLength(1)
    }
  )

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
    expect(await screen.findByTestId('home-spotlight-teaser-link')).toHaveAttribute(
      'href',
      '#spotlight-lookbook-card-look-member-3'
    )

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
    expect(heroEndsWithOutfits()).toBe(true)
  })

  /** Signs in, records opens, and serves `look-1` second in the module. */
  function useEntryHome() {
    signIn()
    const opens = useRecordedOpens()
    const { answer } = useServedSpotlight(() => ({
      status: 200,
      body: { data: cityPage([spotlightItem('look-0', 1), spotlightItem('look-1', 2)]) },
    }))
    return { opens, answer }
  }

  /** Renders Home, shows the teaser for `look-1` and waits for its module card. */
  async function showEntry(answer: ReturnType<typeof useEntryHome>['answer']) {
    render(<LookbookPrismLayout />)
    await answer(0, cityPage([spotlightItem('look-1')]))
    const link = await screen.findByTestId('home-spotlight-teaser-link')
    const card = await waitFor(() => {
      const element = document.getElementById('spotlight-lookbook-card-look-1')
      expect(element).not.toBeNull()
      return element!
    })
    return { link, card }
  }

  it('6.7-WEB-009 activating focuses the entry with exactly one announcement', async () => {
    const { answer } = useEntryHome()
    const { link, card } = await showEntry(answer)
    const announcements = recordAnnouncements()

    await userEvent.setup().click(link)
    await waitFor(() => expect(document.activeElement).toBe(card))
    await waitFor(() =>
      expect(screen.getByTestId('community-live-region').textContent).toBe(
        enUS.community.feed.announceFocused
      )
    )
    await nextFrames()
    expect(announcements).toEqual([enUS.community.feed.announceFocused])
    expect(screen.queryByTestId('community-spotlight-notice')).toBeNull()
    expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
  })

  it('6.7-WEB-021 an activation posts one home_teaser open with rank and level only', async () => {
    const { opens, answer } = useEntryHome()
    const { link } = await showEntry(answer)
    await userEvent.setup().click(link)
    await waitFor(() => expect(opens).toHaveLength(1))
    expect(opens[0]).toEqual({
      postId: 'look-1',
      body: { surface: 'home_teaser', rank: 1, level: 'city' },
    })
  })

  it('6.7-WEB-022 a repeat activation is a fresh token: focus moves again', async () => {
    const { opens, answer } = useEntryHome()
    const { link, card } = await showEntry(answer)
    const user = userEvent.setup()
    await user.click(link)
    await waitFor(() => expect(document.activeElement).toBe(card))
    act(() => link.focus())
    expect(document.activeElement).toBe(link)
    await user.click(link)
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
      const link = await screen.findByTestId('home-spotlight-teaser-link')
      const announcements = recordAnnouncements()
      await userEvent.setup().click(link)
      const notice = await screen.findByTestId('community-spotlight-notice')
      expect(notice.textContent).toBe(enUS.community.spotlight.targetUnavailable)
      await waitFor(() => expect(document.activeElement).toBe(notice))
      // Focusing the notice is its single announcement: no live region repeats it.
      await nextFrames()
      expect(announcements).not.toContain(enUS.community.spotlight.targetUnavailable)
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
    const announcements = recordAnnouncements()
    // Testing Library's async wrapper waits on a zero-delay timeout, which this
    // clock fakes, so the click settles while the clock advances by nothing.
    let clicked = false
    void userEvent
      .setup({ delay: null })
      .click(link)
      .then(() => (clicked = true))
    for (let round = 0; round < 20 && !clicked; round += 1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
    expect(clicked).toBe(true)
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
    expect(announcements).not.toContain(enUS.community.spotlight.destinationUnavailable)

    act(() => releaseModule!())
    await waitFor(() =>
      expect(document.getElementById('spotlight-lookbook-card-look-1')).not.toBeNull()
    )
    // The card is committed, so any focus effect it could trigger has run.
    await act(async () => {
      await Promise.resolve()
    })
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

  it('6.7-WEB-023 a teaser that leaves while another control holds focus moves no focus', async () => {
    signIn('test-token-member-1')
    const { answer } = useServedSpotlight()
    render(<LookbookPrismLayout />)
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')
    const elsewhere = screen.getByRole('button', { name: /mobile preview/i })
    act(() => elsewhere.focus())
    act(() => signIn('test-token-member-2'))
    expect(teaserNodes()).toEqual([])
    // The hand-off would run on the next frame; let several pass.
    await nextFrames()
    expect(document.activeElement).toBe(elsewhere)
  })

  it.each([
    // Content hidden while the module still holds the entry.
    ['became unavailable', ['unavailable']],
    // Access came back, but the module it reset has not read again.
    ['came back with no module', ['denied', 'connected']],
  ] as const)(
    '6.7-WEB-024 a Community that %s focuses the destination notice',
    async (_name, states) => {
      const syncs: CommunitySyncState[] = []
      vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(function (
        this: CommunitySyncState
      ) {
        syncs.push(this)
      })
      signIn()
      useRecordedOpens()
      const { answer } = useServedSpotlight()
      render(<LookbookPrismLayout />)
      await answer(0, cityPage())
      const link = await screen.findByTestId('home-spotlight-teaser-link')
      await waitFor(() =>
        expect(document.getElementById('spotlight-lookbook-card-look-1')).not.toBeNull()
      )
      await waitFor(() => expect(syncs.length).toBeGreaterThan(0))
      const { callbacks } = syncs.at(-1) as unknown as {
        callbacks: { availability: (state: string, realtime?: boolean) => void }
      }
      for (const state of states) act(() => callbacks.availability(state))
      await waitFor(() =>
        expect(document.getElementById('spotlight-lookbook-card-look-1')).toBeNull()
      )
      const announcements = recordAnnouncements()
      await userEvent.setup().click(link)
      const notice = await screen.findByTestId('community-spotlight-notice')
      expect(notice.textContent).toBe(enUS.community.spotlight.destinationUnavailable)
      await waitFor(() => expect(document.activeElement).toBe(notice))
      expect(
        screen.getByRole('region', { name: /community section/i }).contains(notice)
      ).toBe(true)
      expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
      await nextFrames()
      expect(announcements).not.toContain(enUS.community.spotlight.destinationUnavailable)
    }
  )

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
    // Entering stacked starts its read synchronously, so the count is final here.
    expect(teaserCalls()).toHaveLength(1)
    expect(teaserReads).toHaveLength(1)

    act(() => setViewport(1440))
    clock += 1
    act(() => setViewport(1024))
    expect(teaserCalls()).toHaveLength(2)
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

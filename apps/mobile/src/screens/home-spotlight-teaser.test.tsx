/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.7: the Home spotlight teaser on mobile. Reads are deferred through MSW
// so each test decides when a read settles; time-driven rows use fake timers.
import React from 'react'
import type * as ReactModule from 'react'
import type * as RitualCacheModule from '@/src/lib/ritual-cache'
import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react'
import { AppState, type AppStateStatus } from 'react-native'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type {
  CommunityReactionSpotlight,
  CommunityReactionSpotlightItem,
} from '@couture/api-client/contracts/http'
import {
  SPOTLIGHT_TEASER_EXPIRY_MS,
  SPOTLIGHT_TEASER_READ_FLOOR_MS,
  SPOTLIGHT_TEASER_REREAD_MS,
} from '@couture/api-client'

const focusControl = vi.hoisted(() => ({
  focused: true,
  listeners: new Set<(focused: boolean) => void>(),
  set(focused: boolean) {
    this.focused = focused
    for (const listener of this.listeners) listener(focused)
  },
}))
const routerPush = vi.hoisted(() => vi.fn())

vi.mock('expo-router', async () => {
  const { useEffect } = await vi.importActual<typeof ReactModule>('react')
  return {
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ setParams: vi.fn(), push: routerPush }),
    // A navigator double: the screen gains and loses focus when the test says so.
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => {
        let cleanup: (() => void) | undefined
        const apply = (focused: boolean) => {
          if (focused && !cleanup) cleanup = effect() ?? (() => undefined)
          else if (!focused && cleanup) {
            cleanup()
            cleanup = undefined
          }
        }
        apply(focusControl.focused)
        focusControl.listeners.add(apply)
        return () => {
          focusControl.listeners.delete(apply)
          cleanup?.()
        }
      }, [effect])
    },
  }
})
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: vi.fn(),
    getDistinctId: () => 'test-user-id',
    screen: vi.fn(),
  }),
  MobileAnalyticsDiagnosticsPanel: () => null,
}))
vi.mock('@/src/lib/ritual-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof RitualCacheModule>()
  return {
    withoutShopThisLook: actual.withoutShopThisLook,
    ritualCacheOwner: actual.ritualCacheOwner,
    readLatestRitualCache: vi.fn().mockResolvedValue(null),
    saveRitualCache: vi.fn().mockResolvedValue(undefined),
    clearRitualMemoryCache: () => undefined,
    forgetLatestRitual: vi.fn().mockResolvedValue(undefined),
  }
})

import TabOneScreen from '@/app/(tabs)/index'
import { server } from '@/src/test-utils/msw/server'
import { mockRitualResponse } from '@/src/test-utils/msw/handlers'
import { noLocationResponse } from '@/src/test-utils/locations'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import i18n, { initI18n } from '@/src/lib/i18n'

const TEASER_PREFIX = 'home-spotlight-teaser'
let imageSerial = 0

function spotlightItem(
  id: string,
  overrides: Partial<CommunityReactionSpotlightItem> = {}
): CommunityReactionSpotlightItem {
  return {
    id,
    caption: 'Private caption that the teaser never shows.',
    altText: 'A camel coat over a grey knit.',
    climateBand: 'temperate_wet',
    imageAccess: {
      // Unique per call: the browser image cache would otherwise answer a URL a
      // previous test already loaded, without asking the test server.
      url: `${window.location.origin}/teaser/${id}-${(imageSerial += 1)}.png`,
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    publishedAt: '2026-10-22T09:00:00.000Z',
    createdAt: '2026-10-22T08:59:00.000Z',
    status: 'published',
    challengeId: null,
    author: { displayName: 'Ana', isSelf: false },
    rank: 1,
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

const cityPage = (item = spotlightItem('look-1')): CommunityReactionSpotlight => ({
  level: 'city',
  label: 'Lisbon',
  items: [item],
  nextCursor: null,
})

type Answer = { status: number; body: unknown; headers?: Record<string, string> }
interface PendingRead {
  url: URL
  authorization: string | null
  resolve: (answer: Answer) => void
}

/** Every spotlight read waits until the test answers it. */
function deferSpotlightReads() {
  const reads: PendingRead[] = []
  server.use(
    http.get('*/api/v1/community/spotlight', async ({ request }) => {
      const answer = await new Promise<Answer>((resolve) => {
        reads.push({
          url: new URL(request.url),
          authorization: request.headers.get('authorization'),
          resolve,
        })
      })
      return HttpResponse.json(answer.body as never, {
        status: answer.status,
        headers: answer.headers,
      })
    })
  )
  const answer = async (index: number, value: CommunityReactionSpotlight | Answer) => {
    await waitFor(() => expect(reads.length).toBeGreaterThan(index))
    reads[index]!.resolve(
      'status' in value ? value : { status: 200, body: { data: value } }
    )
  }
  return { reads, answer }
}

function recordOpens() {
  const opens: { postId: string; body: unknown }[] = []
  server.use(
    http.post('*/api/v1/community/posts/:postId/opened', async ({ params, request }) => {
      opens.push({ postId: String(params.postId), body: await request.json() })
      return HttpResponse.json({ tracked: true })
    })
  )
  return opens
}

/** A one-pixel PNG for every teaser image URL. */
function serveTeaserImages() {
  server.use(
    http.get('*/teaser/:file', () =>
      HttpResponse.arrayBuffer(
        Uint8Array.from(
          atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
          ),
          (char) => char.charCodeAt(0)
        ).buffer,
        { headers: { 'content-type': 'image/png' } }
      )
    )
  )
}

function teaserNodes(): Element[] {
  return Array.from(
    document.querySelectorAll<Element>(`[data-testid^="${TEASER_PREFIX}"]`)
  )
}

function follows(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

function renderHome() {
  return render(
    <AccessibilityAnnouncerProvider>
      <TabOneScreen />
    </AccessibilityAnnouncerProvider>
  )
}

describe('6.7 mobile Home spotlight teaser', () => {
  let restoreToken: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    configure({ asyncUtilTimeout: 5_000 })
    await initI18n()
  })
  beforeEach(async () => {
    focusControl.focused = true
    focusControl.listeners.clear()
    routerPush.mockClear()
    restoreToken = setMobileAccessTokenResolver(() => 'session-token')
    setMobileApplicationUserId(null)
    await i18n.changeLanguage('en-US')
    server.use(http.get('*/api/v1/ritual', () => HttpResponse.json(mockRitualResponse)))
    serveTeaserImages()
  })
  afterEach(() => {
    vi.useRealTimers()
    restoreToken?.()
    setMobileApplicationUserId(null)
  })

  it('6.7-MOB-001 shows the area label, decorative image, author and reaction count after the hero', async () => {
    const { reads, answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')

    expect(reads[0]!.url.searchParams.get('limit')).toBe('1')
    expect(reads[0]!.url.searchParams.get('surface')).toBe('home_teaser')
    expect(reads[0]!.authorization).toBe('Bearer session-token')
    expect(screen.getByTestId('home-spotlight-teaser-heading').textContent).toBe(
      'Standout look in Lisbon'
    )
    expect(screen.getByTestId('home-spotlight-teaser-author').textContent).toBe('Ana')
    expect(screen.getByTestId('home-spotlight-teaser-reactions').textContent).toBe(
      '3 reactions'
    )
    expect(link.getAttribute('role')).toBe('link')
    expect(link.getAttribute('aria-label')).toBe(
      'Standout look in Lisbon by Ana, 3 reactions. Opens the City Spotlight.'
    )
    // One focusable control; the image is decorative and outside the tree.
    expect(
      screen.getByTestId('home-spotlight-teaser').querySelectorAll('[tabindex="0"]')
    ).toHaveLength(1)
    const image = screen.getByTestId('home-spotlight-teaser-image')
    expect(image.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('Private caption')
    await screen.findByTestId('home-spotlight-teaser-image-loaded')
    // It follows the hero conditional in focus order.
    expect(follows(screen.getByTestId('outfit-recommendation-card'), link)).toBe(true)
    expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  })

  it('6.7-MOB-002 the author rule names the viewer You and falls back for a blank name', async () => {
    const { answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(
      0,
      cityPage(
        spotlightItem('look-self', { author: { displayName: 'Me', isSelf: true } })
      )
    )
    expect((await screen.findByTestId('home-spotlight-teaser-author')).textContent).toBe(
      'You'
    )
  })

  it('6.7-MOB-003 a blank author name uses the card fallback and one reaction is singular', async () => {
    const { answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(
      0,
      cityPage(
        spotlightItem('look-blank', {
          author: { displayName: '   ', isSelf: false },
          reactions: {
            counts: { applause: 1, love: 0, inspiration: 0 },
            total: 1,
            viewerReaction: null,
            revision: 1,
            generation: 1,
          },
        })
      )
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
      'a 500',
      { status: 500, body: { statusCode: 500, message: 'Internal server error' } },
    ],
  ] as const)(
    '6.7-MOB-004 %s renders nothing and leaves Home exactly as without the teaser',
    async (_name, refusal) => {
      // Reference: the same Home for a signed-out viewer, who never reads.
      const reference = await renderHome()
      await screen.findByTestId('outfit-recommendation-card')
      const expected = screen.getByTestId('hero-experience-scrollview').innerHTML
      await reference.unmount()

      const { reads, answer } = deferSpotlightReads()
      setMobileApplicationUserId('member-1')
      await renderHome()
      await screen.findByTestId('outfit-recommendation-card')
      await answer(0, refusal as Answer)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
      })
      expect(teaserNodes()).toEqual([])
      expect(screen.getByTestId('hero-experience-scrollview').innerHTML).toBe(expected)
      // A refusal starts no retry loop.
      expect(reads).toHaveLength(1)
    }
  )

  it('6.7-MOB-005 follows the hero while it is loading, failed or without a location', async () => {
    const { answer } = deferSpotlightReads()
    // Loading: the ritual never answers, the teaser still shows.
    server.use(http.get('*/api/v1/ritual', () => new Promise<never>(() => undefined)))
    setMobileApplicationUserId('member-1')
    const loading = await renderHome()
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')
    expect(follows(screen.getByTestId('outfit-recommendation-card-skeleton'), link)).toBe(
      true
    )
    await loading.unmount()

    server.use(
      http.get('*/api/v1/ritual', () =>
        HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 })
      )
    )
    const failed = await renderHome()
    await answer(1, cityPage())
    const afterError = await screen.findByTestId('home-spotlight-teaser-link')
    expect(follows(await screen.findByTestId('hero-error-state'), afterError)).toBe(true)
    await failed.unmount()

    server.use(http.get('*/api/v1/ritual', noLocationResponse))
    await renderHome()
    await answer(2, cityPage())
    const afterNoLocation = await screen.findByTestId('home-spotlight-teaser-link')
    expect(
      follows(await screen.findByTestId('hero-no-location-state'), afterNoLocation)
    ).toBe(true)
  })

  it('6.7-MOB-006 a cold start reads nothing until the member resolves, then reads at once', async () => {
    const { reads, answer } = deferSpotlightReads()
    await renderHome()
    await screen.findByTestId('outfit-recommendation-card')
    expect(reads).toHaveLength(0)
    act(() => setMobileApplicationUserId('member-1'))
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')
    expect(reads).toHaveLength(1)
  })

  it('6.7-MOB-007 an identity change clears the teaser and drops the late response', async () => {
    const { reads, answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage(spotlightItem('look-member-1')))
    await screen.findByTestId('home-spotlight-teaser-link')

    act(() => setMobileApplicationUserId('member-2'))
    expect(teaserNodes()).toEqual([])
    // The new member reads at once, inside the previous member's 60-second floor.
    await waitFor(() => expect(reads).toHaveLength(2))
    act(() => setMobileApplicationUserId('member-3'))
    await waitFor(() => expect(reads).toHaveLength(3))
    // Member 2's response lands after the change and is dropped.
    await answer(1, cityPage(spotlightItem('look-member-2')))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    expect(teaserNodes()).toEqual([])
    await answer(2, cityPage(spotlightItem('look-member-3')))
    await screen.findByTestId('home-spotlight-teaser-link')

    act(() => setMobileApplicationUserId(null))
    expect(teaserNodes()).toEqual([])
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    expect(reads).toHaveLength(3)
  })

  it('6.7-MOB-008 an image that fails to load removes the teaser', async () => {
    const { answer } = deferSpotlightReads()
    server.use(http.get('*/teaser/:file', () => new HttpResponse(null, { status: 404 })))
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')
    await waitFor(() => expect(teaserNodes()).toEqual([]))
  })

  it('6.7-MOB-009 each activation posts the home_teaser open and pushes a fresh focus token', async () => {
    const { answer } = deferSpotlightReads()
    const opens = recordOpens()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')

    fireEvent.click(link)
    fireEvent.click(link)
    await waitFor(() => expect(opens).toHaveLength(2))
    expect(opens[0]).toEqual({
      postId: 'look-1',
      body: { surface: 'home_teaser', rank: 1, level: 'city' },
    })
    expect(routerPush).toHaveBeenCalledTimes(2)
    const [first, second] = routerPush.mock.calls.map(
      ([target]) => target as { pathname: string; params: Record<string, string> }
    )
    expect(first).toEqual({
      pathname: '/community',
      params: {
        source: 'app',
        type: 'community',
        cardId: 'look-1',
        focus: 'spotlight',
        focusToken: expect.any(String) as string,
      },
    })
    expect(second!.params.focusToken).not.toBe(first!.params.focusToken)
    // No caption, name, media or coordinates travel with the open.
    expect(JSON.stringify(opens)).not.toMatch(/caption|Ana|teaser\/|latitude/)
  })

  it('6.7-MOB-010 returning to Home focuses the teaser link once per activation', async () => {
    const { answer } = deferSpotlightReads()
    recordOpens()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')

    fireEvent.click(link)
    act(() => focusControl.set(false))
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => focusControl.set(true))
    await waitFor(() => expect(document.activeElement).toBe(link))

    // The return is consumed: a later refocus moves nothing.
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => focusControl.set(false))
    act(() => focusControl.set(true))
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    expect(document.activeElement).not.toBe(link)
  })

  it('6.7-MOB-011 a return with the teaser gone lands on the Home scroll view', async () => {
    const { answer } = deferSpotlightReads()
    recordOpens()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    fireEvent.click(await screen.findByTestId('home-spotlight-teaser-link'))
    act(() => focusControl.set(false))
    // Signing out while away removes the teaser.
    act(() => setMobileApplicationUserId(null))
    act(() => focusControl.set(true))
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId('hero-experience-scrollview')
      )
    )
  })

  it('6.7-MOB-012 a teaser that leaves while focused hands focus to the scroll view', async () => {
    const { answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    const link = await screen.findByTestId('home-spotlight-teaser-link')
    act(() => link.focus())
    expect(document.activeElement).toBe(link)
    act(() => setMobileApplicationUserId('member-2'))
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId('hero-experience-scrollview')
      )
    )
  })

  it('6.7-MOB-013 a quick return inside 60 seconds reads nothing; a later return re-reads', async () => {
    let now = Date.parse('2026-10-23T12:00:00.000Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { reads, answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')

    act(() => focusControl.set(false))
    now += SPOTLIGHT_TEASER_READ_FLOOR_MS - 1
    act(() => focusControl.set(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(reads).toHaveLength(1)
    expect(screen.getByTestId('home-spotlight-teaser-link')).toBeTruthy()

    act(() => focusControl.set(false))
    now += 1
    act(() => focusControl.set(true))
    await waitFor(() => expect(reads).toHaveLength(2))
    // The current value stays on screen while the re-read is in flight.
    expect(screen.getByTestId('home-spotlight-teaser-link')).toBeTruthy()
    await answer(
      1,
      cityPage(spotlightItem('look-2', { author: { displayName: 'Bea', isSelf: false } }))
    )
    await waitFor(() =>
      expect(screen.getByTestId('home-spotlight-teaser-author').textContent).toBe('Bea')
    )
    vi.mocked(Date.now).mockRestore()
  })

  it('6.7-MOB-017 returning to the foreground re-reads only when the last attempt is older than 60 seconds', async () => {
    let now = Date.parse('2026-10-23T12:00:00.000Z')
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const listeners: ((state: AppStateStatus) => void)[] = []
    const addListener = vi
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        listeners.push(listener as (state: AppStateStatus) => void)
        return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>
      })
    const { reads, answer } = deferSpotlightReads()
    setMobileApplicationUserId('member-1')
    await renderHome()
    await answer(0, cityPage())
    await screen.findByTestId('home-spotlight-teaser-link')
    const emit = (state: AppStateStatus) =>
      act(() => {
        for (const listener of listeners) listener(state)
      })

    emit('background')
    now += 30_000
    emit('active')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(reads).toHaveLength(1)
    emit('background')
    now += 31_000
    emit('active')
    await waitFor(() => expect(reads).toHaveLength(2))
    addListener.mockRestore()
    dateNow.mockRestore()
  })
})

describe('6.7 mobile Home spotlight teaser timers', () => {
  let restoreToken: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    await initI18n()
  })
  beforeEach(async () => {
    focusControl.focused = true
    focusControl.listeners.clear()
    restoreToken = setMobileAccessTokenResolver(() => 'session-token')
    setMobileApplicationUserId(null)
    await i18n.changeLanguage('en-US')
    server.use(http.get('*/api/v1/ritual', () => HttpResponse.json(mockRitualResponse)))
    serveTeaserImages()
  })
  afterEach(() => {
    vi.useRealTimers()
    restoreToken?.()
    setMobileApplicationUserId(null)
  })

  /** Waits on real frames, never on the faked clock, so no timer fires early. */
  async function until(check: () => boolean) {
    for (let frame = 0; frame < 600 && !check(); frame += 1) {
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
    }
    expect(check()).toBe(true)
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  async function showTeaser(reads: PendingRead[]) {
    await until(() => reads.length === 1)
    reads[0]!.resolve({ status: 200, body: { data: cityPage() } })
    await until(
      () =>
        document.querySelector('[data-testid="home-spotlight-teaser-image-loaded"]') !==
        null
    )
  }

  it('6.7-MOB-014 re-reads 4 minutes after the last attempt and keeps the value while it is in flight', async () => {
    const { reads } = deferSpotlightReads()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const start = Date.parse('2026-10-23T12:00:00.000Z')
    vi.setSystemTime(start)
    setMobileApplicationUserId('member-1')
    await renderHome()
    await showTeaser(reads)
    // The faked clock has not moved: the read started and completed at `start`.
    expect(Date.now()).toBe(start)

    await advance(SPOTLIGHT_TEASER_REREAD_MS - 1)
    expect(reads).toHaveLength(1)
    await advance(1)
    await until(() => reads.length === 2)
    expect(reads[1]!.url.searchParams.get('surface')).toBe('home_teaser')
    // The re-read is in flight: the current value stays until it settles.
    await advance(5_000)
    expect(teaserNodes().length).toBeGreaterThan(0)
    // A different rank-1 entry replaces the content in place.
    reads[1]!.resolve({
      status: 200,
      body: {
        data: cityPage(
          spotlightItem('look-2', { author: { displayName: 'Bea', isSelf: false } })
        ),
      },
    })
    await until(
      () =>
        document.querySelector('[data-testid="home-spotlight-teaser-author"]')
          ?.textContent === 'Bea'
    )
  })

  it('6.7-MOB-016 expires 5 minutes after the read when no re-read succeeds', async () => {
    const { reads } = deferSpotlightReads()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(Date.parse('2026-10-23T12:00:00.000Z'))
    setMobileApplicationUserId('member-1')
    await renderHome()
    await showTeaser(reads)
    // Away from Home nothing re-reads, so only expiry can end the value.
    act(() => focusControl.set(false))
    await advance(SPOTLIGHT_TEASER_EXPIRY_MS - 1)
    expect(teaserNodes().length).toBeGreaterThan(0)
    await advance(1)
    await until(() => teaserNodes().length === 0)
    expect(reads).toHaveLength(1)
    // Coming back reads again: the last attempt is older than 60 seconds.
    act(() => focusControl.set(true))
    await until(() => reads.length === 2)
  })

  it('6.7-MOB-015 a failed re-read removes the teaser and schedules no timed retry', async () => {
    const { reads } = deferSpotlightReads()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(Date.parse('2026-10-23T12:00:00.000Z'))
    setMobileApplicationUserId('member-1')
    await renderHome()
    await showTeaser(reads)
    await advance(SPOTLIGHT_TEASER_REREAD_MS)
    await until(() => reads.length === 2)
    reads[1]!.resolve({ status: 503, body: { statusCode: 503, message: 'unavailable' } })
    await until(() => teaserNodes().length === 0)
    await advance(SPOTLIGHT_TEASER_REREAD_MS * 3)
    for (let frame = 0; frame < 30; frame += 1)
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
    // The read wrapper retries a retryable 503 once inside the same attempt.
    expect(reads.length).toBeLessThanOrEqual(3)
    const settled = reads.length
    await advance(SPOTLIGHT_TEASER_REREAD_MS * 3)
    expect(reads).toHaveLength(settled)
  })
})

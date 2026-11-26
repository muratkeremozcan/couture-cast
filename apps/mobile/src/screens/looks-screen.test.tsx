// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-NAT-001 (Saved, Ideas and Plan as tabs in the `looks`
// tab params; a change is `setParams`; with no segment, Saved for a member with a look or a
// capsule, Ideas otherwise, decided once after both first reads settle, TEA P1), 7.12-NAT-002
// (one newest-first tile grid through the shared `looks-feed` merge, state lines, filters read
// from the server per P2, Load more, tile targets with their origin filter, T2) and
// 7.12-NAT-003 (Ideas tiles from SAMPLE_CATALOG with no control), plus P8 (tile accessibility,
// photo placeholder) and P9 (a member switch paints no tile of the previous member; native has
// no screen snapshot, so it holds by the remount per identity epoch).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import { SAMPLE_CATALOG } from '@couture/utils'
import {
  act,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  navigate: vi.fn(),
  back: vi.fn(),
  setParams: vi.fn(),
  canGoBack: vi.fn(() => false),
}))

/** The `looks` tab params as the router holds them; `setParams` merges into them. */
const tabParams = vi.hoisted(() => {
  let params: Record<string, string> = {}
  const listeners = new Set<() => void>()
  return {
    get: () => params,
    set: (next: Record<string, string>) => {
      params = next
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
})

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('expo-router', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    router: routerMock,
    useLocalSearchParams: () => useSyncExternalStore(tabParams.subscribe, tabParams.get),
    useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
  }
})
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))

import {
  outfitCapsuleListResponseSchema,
  savedLookListResponseSchema,
  type OutfitCapsuleContract,
  type SavedLookContract,
} from '@couture/api-client/contracts/http'
import LooksRoute from '@/app/(tabs)/looks'
import { SaveFeedbackProvider } from '@/components/save-feedback'
import { AppTopBar } from '@/src/components/app-top-bar'
import { SCREEN_GATE_DEADLINE_MS } from '@/src/components/screen-gate'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { notifyMobileSavedLooksChanged } from '@/src/lib/saved-looks'
import { notifyWardrobeChanged } from '@/src/lib/wardrobe-changes'
import { screenFocus } from '@/src/test-utils/focus-effect'
import { server } from '@/src/test-utils/msw/server'
import { WithTabHeader, setBudgetViewport } from '@/src/test-utils/screen-budget'
import { AppThemeProvider } from '@/src/theme/theme-context'

const MEMBER = 'looks-member'
const PLANNER_ROUTE = '*/api/v1/commerce/premium/planner'
const PNG_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const FAR = '2099-12-31T00:00:00.000Z'
/**
 * Bytes that are no PNG: react-native-web's ImageLoader fails to decode them with no network hop.
 * It reports the failure to the Image's onError; no DOM event on the rendered <img> drives that.
 */
const BROKEN_PNG = 'data:image/png;base64,AAAA'

/** A capsule whose first photo is unexpired but fails to load. */
function capsuleWithBrokenPhoto(id: string, createdAt: string): OutfitCapsuleContract {
  const base = capsule(id, createdAt)
  const [first, ...rest] = base.garments
  return {
    ...base,
    garments: [{ ...first!, imageAccess: { url: BROKEN_PNG, expiresAt: FAR } }, ...rest],
  }
}

const at = (day: number, hour = 12) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`

function look(
  id: string,
  createdAt: string,
  overrides: Partial<SavedLookContract> = {}
): SavedLookContract {
  return {
    id,
    ownerUserId: MEMBER,
    source: 'home_sample',
    lookId: 'office-oxford',
    weather: 'mild-dry',
    title: `Look ${id}`,
    anchorGarmentId: null,
    anchorSnapshot: null,
    composition: (
      [
        ['top', 'oxford-shirt'],
        ['bottom', 'dark-jeans'],
        ['shoes', 'loafers'],
      ] as const
    ).map(([category, itemId], slotIndex) => ({
      slotIndex,
      category,
      kind: 'catalog' as const,
      itemId,
      label: null,
      missing: false,
      imageAccess: null,
    })),
    swaps: {},
    collection: 'all',
    comfort: {
      runsColdWarm: 'neutral',
      windTolerance: 'medium',
      precipPreparedness: 'medium',
    },
    availabilityStatus: 'ready',
    missingGarmentIds: [],
    needsReviewReasons: [],
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}

function capsule(
  id: string,
  createdAt: string,
  overrides: Partial<OutfitCapsuleContract> = {}
): OutfitCapsuleContract {
  return {
    id,
    ownerUserId: MEMBER,
    name: `Capsule ${id}`,
    description: null,
    occasions: ['work'],
    isFavorite: false,
    revision: 0,
    availabilityStatus: 'ready',
    unavailableGarmentCount: 0,
    garments: [0, 1].map((garmentOrder) => ({
      id: `${id}-garment-${garmentOrder}`,
      category: 'top' as const,
      material: 'cotton' as const,
      comfortRange: 'mild' as const,
      imageAccess: { url: PNG_PIXEL, expiresAt: FAR },
      availabilityStatus: 'ready' as const,
      garmentOrder,
    })),
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}

type Reads = { looks: URL[]; capsules: URL[] }

/**
 * Serves one member's saved looks and capsules, newest first as `sort=created_desc` asks, paged
 * by `limit` and `offset`, and records every list read.
 */
function serveFeed(
  {
    looks = [],
    capsules = [],
  }: { looks?: SavedLookContract[]; capsules?: OutfitCapsuleContract[] },
  reads: Reads = { looks: [], capsules: [] }
) {
  const page = <T,>(items: T[], url: URL) => {
    const limit = Number(url.searchParams.get('limit') ?? 50)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    return {
      data: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    }
  }
  server.use(
    http.get('*/api/v1/wardrobe/saved-looks', ({ request }) => {
      const url = new URL(request.url)
      reads.looks.push(url)
      const source = url.searchParams.get('source')
      const items = source ? looks.filter((item) => item.source === source) : looks
      return HttpResponse.json(
        savedLookListResponseSchema.parse(page(items, url)) as unknown as Record<
          string,
          unknown
        >
      )
    }),
    http.get('*/api/v1/wardrobe/:ownerUserId/capsules', ({ request }) => {
      const url = new URL(request.url)
      reads.capsules.push(url)
      return HttpResponse.json(
        outfitCapsuleListResponseSchema.parse(page(capsules, url)) as unknown as Record<
          string,
          unknown
        >
      )
    })
  )
  return reads
}

function renderLooks() {
  return render(
    <AccessibilityAnnouncerProvider>
      <AppThemeProvider>
        <SaveFeedbackProvider>
          <WithTabHeader header={<AppTopBar title={i18n.t('tabs.looks')} />}>
            <LooksRoute />
          </WithTabHeader>
        </SaveFeedbackProvider>
      </AppThemeProvider>
    </AccessibilityAnnouncerProvider>
  )
}

async function openLooks() {
  renderLooks()
  await waitFor(() =>
    expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
  )
  return screen.getByTestId('looks-segments')
}

const segmentTab = (id: string) => screen.getByTestId(`looks-segment-${id}`)

function expectOpenSegment(id: 'saved' | 'ideas' | 'plan') {
  for (const other of ['saved', 'ideas', 'plan'])
    expect(segmentTab(other), other).toHaveAttribute(
      'aria-selected',
      other === id ? 'true' : 'false'
    )
}

/** The tiles of the Saved grid in the order they render, by test id. */
function gridOrder() {
  return Array.from(
    screen.getByTestId('looks-saved-grid').querySelectorAll('[data-testid]')
  )
    .map((node) => node.getAttribute('data-testid')!)
    .filter((id) => /^(saved-look-card|looks-capsule-card)-/.test(id))
}

describe('Native Looks tab (Story CC-7.12)', () => {
  let restoreToken: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    configure({ asyncUtilTimeout: 5_000 })
    await initI18n()
  })

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    await setBudgetViewport()
    tabParams.set({})
    routerMock.setParams.mockImplementation((next: Record<string, string>) =>
      tabParams.set({ ...tabParams.get(), ...next })
    )
    restoreToken = setMobileAccessTokenResolver(() => 'member-token')
    setMobileApplicationUserId(MEMBER)
  })

  afterEach(() => {
    restoreToken?.()
    restoreToken = undefined
    setMobileApplicationUserId(null)
    screenFocus.reset()
    vi.clearAllMocks()
  })

  describe('[7.12-NAT-001] segments and the default', () => {
    it('[P0] Saved, Ideas and Plan are tabs in that order; a member with a look opens on Saved', async () => {
      serveFeed({ looks: [look('look-1', at(20))] })
      const segments = await openLooks()

      expect(segments).toHaveAttribute('role', 'tablist')
      expect(segments).toHaveAttribute('aria-label', i18n.t('looks.segments.label'))
      const tabs = within(segments).getAllByRole('tab')
      expect(tabs.map((tab) => tab.getAttribute('data-testid'))).toEqual([
        'looks-segment-saved',
        'looks-segment-ideas',
        'looks-segment-plan',
      ])
      expect(tabs.map((tab) => tab.textContent)).toEqual(['Saved', 'Ideas', 'Plan'])
      expectOpenSegment('saved')
      // D1: not pill shaped, so the CC-7.10 guard counts no chip row.
      for (const tab of tabs)
        expect(Number.parseFloat(getComputedStyle(tab).borderRadius)).toBeLessThan(
          tab.getBoundingClientRect().height / 2
        )
      expect(await screen.findByTestId('saved-look-card-look-1')).toBeVisible()
      // The default lives in no address: Looks opened without writing one.
      expect(routerMock.setParams).not.toHaveBeenCalled()
    })

    it('[P0] a segment press is setParams; the open segment does nothing again', async () => {
      serveFeed({ looks: [look('look-1', at(20))] })
      await openLooks()
      await screen.findByTestId('saved-look-card-look-1')

      await userEvent.click(segmentTab('saved'))
      expect(routerMock.setParams).not.toHaveBeenCalled()

      await userEvent.click(segmentTab('ideas'))
      expect(routerMock.setParams).toHaveBeenCalledExactlyOnceWith({ segment: 'ideas' })
      await waitFor(() => expectOpenSegment('ideas'))
      expect(screen.getByTestId('looks-ideas-grid')).toBeVisible()
      // A member with looks sees no "Save a look" line on Ideas.
      expect(screen.queryByTestId('looks-ideas-empty-line')).toBeNull()
      expect(screen.queryByTestId('looks-saved-grid')).toBeNull()

      await userEvent.click(segmentTab('plan'))
      expect(routerMock.setParams).toHaveBeenLastCalledWith({ segment: 'plan' })
      await waitFor(() => expectOpenSegment('plan'))
      // D1: the address changes in place; nothing is pushed.
      expect(routerMock.push).not.toHaveBeenCalled()
      expect(routerMock.navigate).not.toHaveBeenCalled()
    })

    it('[P0] a member with only a capsule opens on Saved; an empty member opens on Ideas with one line', async () => {
      serveFeed({ capsules: [capsule('cap-1', at(19))] })
      const view = renderLooks()
      await waitFor(() => expectOpenSegment('saved'))
      expect(await screen.findByTestId('looks-capsule-card-cap-1')).toBeVisible()
      view.unmount()

      serveFeed({})
      await openLooks()
      expectOpenSegment('ideas')
      const line = screen.getByTestId('looks-ideas-empty-line')
      expect(line).toHaveTextContent('Save a look to see it here')
      const first = screen.getByTestId('looks-first-content')
      expect(first.contains(line)).toBe(true)
      expect(first.contains(screen.getByTestId('looks-ideas-grid'))).toBe(true)
      expect(routerMock.setParams).not.toHaveBeenCalled()
    })

    it('[P0] [TEA P1] the gate holds until both first reads settle, then opens Saved with no Ideas paint', async () => {
      let releaseCapsules!: () => void
      const capsulesHeld = new Promise<void>((resolve) => {
        releaseCapsules = resolve
      })
      serveFeed({ looks: [look('look-1', at(20))] })
      server.use(
        http.get('*/api/v1/wardrobe/:ownerUserId/capsules', async () => {
          await capsulesHeld
          return HttpResponse.json({ data: [], total: 0, limit: 50, offset: 0 })
        })
      )
      let ideasPainted = false
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-testid="looks-ideas-grid"]'))
          ideasPainted = true
      })
      observer.observe(document.body, { childList: true, subtree: true })
      renderLooks()

      // The saved looks page alone does not open the gate.
      await waitFor(() =>
        expect(
          document.querySelector('[data-testid="screen-placeholder"]')
        ).not.toBeNull()
      )
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(screen.getByTestId('screen-gate')).not.toHaveAttribute('data-ready', 'true')
      expect(screen.queryByTestId('looks-segments')).toBeNull()

      releaseCapsules()
      await waitFor(() => expectOpenSegment('saved'))
      await screen.findByTestId('saved-look-card-look-1')
      observer.disconnect()
      expect(ideasPainted, 'Ideas painted before Saved').toBe(false)
    })

    it('[P0] [TEA P1] a failed saved looks read opens Saved with its error line, and Retry reads again', async () => {
      let lookReads = 0
      serveFeed({})
      server.use(
        http.get('*/api/v1/wardrobe/saved-looks', () => {
          lookReads += 1
          return lookReads === 1
            ? HttpResponse.json({ message: 'down' }, { status: 503 })
            : HttpResponse.json(
                savedLookListResponseSchema.parse({
                  data: [look('look-1', at(20))],
                  total: 1,
                  limit: 50,
                  offset: 0,
                }) as unknown as Record<string, unknown>
              )
        })
      )
      await openLooks()
      expectOpenSegment('saved')
      const first = screen.getByTestId('looks-first-content')
      expect(first).toHaveAttribute('role', 'alert')
      expect(first).toHaveTextContent(i18n.t('savedLooks.loadFailed'))
      expect(screen.queryByTestId('looks-ideas-grid')).toBeNull()

      await userEvent.click(within(first).getByTestId('saved-looks-retry'))
      expect(await screen.findByTestId('saved-look-card-look-1')).toBeVisible()
      expect(lookReads).toBe(2)
    })

    it('[P1] [TEA P1] removing the last look while on Saved keeps Saved with its empty line', async () => {
      const store = { looks: [look('look-1', at(20))] }
      serveFeed(store)
      await openLooks()
      await screen.findByTestId('saved-look-card-look-1')

      serveFeed({})
      act(() => notifyMobileSavedLooksChanged(MEMBER))
      await waitFor(() =>
        expect(screen.getByTestId('looks-filter-empty')).toHaveTextContent(
          i18n.t('looks.empty')
        )
      )
      expectOpenSegment('saved')
    })

    // Fable review P2: Looks latched on Ideas for a member with nothing saved opens Saved once a
    // first look exists, while the tab is away or as it comes back; never under the finger.
    it('[P0] [TEA P1] a first save made elsewhere while the tab is away opens Saved on return', async () => {
      const reads = serveFeed({})
      await openLooks()
      expectOpenSegment('ideas')
      expect(screen.getByTestId('looks-ideas-empty-line')).toBeVisible()

      // The member leaves Looks and saves a look on Today, which tells the feed.
      act(() => screenFocus.set(false))
      serveFeed({ looks: [look('first-save', at(23))] }, reads)
      const before = reads.looks.length
      act(() => notifyMobileSavedLooksChanged(MEMBER))
      await waitFor(() => expect(reads.looks.length).toBeGreaterThan(before))
      act(() => screenFocus.set(true))

      expect(await screen.findByTestId('saved-look-card-first-save')).toBeVisible()
      expectOpenSegment('saved')
      expect(routerMock.setParams).not.toHaveBeenCalled()
    })

    it('[P1] [TEA P1] a first save that lands while Looks is in view keeps Ideas under the finger', async () => {
      const reads = serveFeed({})
      await openLooks()
      expectOpenSegment('ideas')

      serveFeed({ looks: [look('first-save', at(23))] }, reads)
      act(() => notifyMobileSavedLooksChanged(MEMBER))
      // The refreshed read rendered: the Ideas line for an empty Saved is gone.
      await waitFor(() =>
        expect(screen.queryByTestId('looks-ideas-empty-line')).toBeNull()
      )
      expectOpenSegment('ideas')
    })

    it('[P1] [TEA P1] Ideas chosen in the address stays Ideas after a first save and a return', async () => {
      tabParams.set({ segment: 'ideas' })
      const reads = serveFeed({})
      await openLooks()
      expectOpenSegment('ideas')
      expect(screen.getByTestId('looks-ideas-grid')).toBeVisible()
      // Ideas from the address opens without waiting on the reads; the line for an empty Saved
      // comes once the All feed settles empty (Codex #11), so it is awaited here.
      expect(await screen.findByTestId('looks-ideas-empty-line')).toBeVisible()

      act(() => screenFocus.set(false))
      serveFeed({ looks: [look('first-save', at(23))] }, reads)
      const before = reads.looks.length
      act(() => screenFocus.set(true))
      await waitFor(() => expect(reads.looks.length).toBeGreaterThan(before))
      // The refreshed read rendered: the Ideas line for an empty Saved is gone.
      await waitFor(() =>
        expect(screen.queryByTestId('looks-ideas-empty-line')).toBeNull()
      )
      expectOpenSegment('ideas')
      expect(screen.queryByTestId('saved-look-card-first-save')).toBeNull()
    })

    // Fable review M2 (expected red until the Ideas panel waits on the first reads): Ideas from
    // the address opens before the reads settle, and the empty line then lands above the grid.
    it('[P1] [TEA P1] [M2] Ideas in the address: the Ideas grid does not move between its first paint and the first reads settling', async () => {
      tabParams.set({ segment: 'ideas' })
      serveFeed({})
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let looksReadSeen = false
      server.use(
        http.get('*/api/v1/wardrobe/saved-looks', async () => {
          looksReadSeen = true
          await held
          return HttpResponse.json(
            savedLookListResponseSchema.parse({
              data: [],
              total: 0,
              limit: 50,
              offset: 0,
            }) as unknown as Record<string, unknown>
          )
        })
      )
      // The grid's top at the first commit that lays it out, whenever that commit comes.
      let firstTop: number | null = null
      const observer = new MutationObserver(() => {
        const grid = screen.queryByTestId('looks-ideas-grid')
        const rect = grid?.getBoundingClientRect()
        if (firstTop === null && rect && rect.height > 0) firstTop = rect.top
      })
      observer.observe(document.body, { childList: true, subtree: true })
      try {
        renderLooks()
        await waitFor(() => expect(looksReadSeen).toBe(true))

        release()
        // The All feed settled empty: the line for an empty Saved shows.
        expect(await screen.findByTestId('looks-ideas-empty-line')).toBeVisible()
        expectOpenSegment('ideas')
        expect(firstTop, 'the Ideas grid painted').not.toBeNull()
        expect(
          screen.getByTestId('looks-ideas-grid').getBoundingClientRect().top
        ).toBeCloseTo(firstTop!, 0)
      } finally {
        observer.disconnect()
        release()
      }
    })

    // Codex round 3 #2: the gate's deadline (SCREEN_GATE_DEADLINE_MS) can open an explicit Ideas
    // before the saved looks read answers. Ideas then shows progress in its first block, and the
    // grid it paints once the reads settle stays where it first painted.
    it('[P1] [TEA P1] [M2] [Codex r3 #2] Ideas in the address past the gate deadline: progress, then a grid that does not move', async () => {
      tabParams.set({ segment: 'ideas' })
      serveFeed({})
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let looksReadSeen = false
      server.use(
        http.get('*/api/v1/wardrobe/saved-looks', async () => {
          looksReadSeen = true
          await held
          return HttpResponse.json(
            savedLookListResponseSchema.parse({
              data: [],
              total: 0,
              limit: 50,
              offset: 0,
            }) as unknown as Record<string, unknown>
          )
        })
      )
      // The grid's top at the first commit that lays it out, whenever that commit comes.
      let firstTop: number | null = null
      const observer = new MutationObserver(() => {
        const grid = screen.queryByTestId('looks-ideas-grid')
        const rect = grid?.getBoundingClientRect()
        if (firstTop === null && rect && rect.height > 0) firstTop = rect.top
      })
      observer.observe(document.body, { childList: true, subtree: true })
      // Only the timers are faked, so the gate's deadline is reached without a real 10 s wait.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        renderLooks()
        // RTL's waitFor would run on the faked timers, so the read is awaited on real frames.
        for (let frames = 0; frames < 600 && !looksReadSeen; frames += 1) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(0)
          })
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        }
        expect(looksReadSeen, 'the saved looks read started').toBe(true)
        expect(screen.getByTestId('screen-gate')).not.toHaveAttribute('data-ready')

        await act(async () => {
          await vi.advanceTimersByTimeAsync(SCREEN_GATE_DEADLINE_MS)
        })
        vi.useRealTimers()

        // The deadline opened Ideas with the read still held: the tabs, then progress alone.
        expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
        expectOpenSegment('ideas')
        const pending = screen.getByTestId('looks-first-content')
        expect(within(pending).getByTestId('looks-feed-loading')).toBeVisible()
        expect(screen.queryByTestId('looks-ideas-grid')).toBeNull()
        expect(screen.queryByTestId('looks-ideas-empty-line')).toBeNull()
        expect(
          screen.getByTestId('looks-segments').compareDocumentPosition(pending) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          'progress sits below the segment tabs'
        ).toBeTruthy()
        expect(firstTop, 'no Ideas grid painted while the read is held').toBeNull()

        release()
        // The All feed settled empty: the line for an empty Saved shows above the grid.
        expect(await screen.findByTestId('looks-ideas-empty-line')).toBeVisible()
        expect(screen.queryByTestId('looks-feed-loading')).toBeNull()
        expectOpenSegment('ideas')
        expect(firstTop, 'the Ideas grid painted').not.toBeNull()
        const grid = screen.getByTestId('looks-ideas-grid')
        expect(grid).toBeVisible()
        expect(grid.getBoundingClientRect().top).toBeCloseTo(firstTop!, 0)
        expect(
          screen.getByTestId('looks-ideas-empty-line').getBoundingClientRect().bottom
        ).toBeLessThanOrEqual(grid.getBoundingClientRect().top)
      } finally {
        vi.useRealTimers()
        observer.disconnect()
        release()
      }
    })

    // Codex 7.12 #6 (AC1, P1): the gate's deadline may open Looks before the reads answer. Looks
    // then shows their progress and still picks the default once both lists settle.
    it.each<[string, SavedLookContract[], 'saved' | 'ideas']>([
      ['an empty member', [], 'ideas'],
      ['a member with a look', [look('slow-look', at(20))], 'saved'],
    ])(
      '[P0] [TEA P1] [Codex 7.12 #6] past the gate deadline, %s sees loading, then opens on the default',
      async (_case, looks, expected) => {
        let release!: () => void
        const held = new Promise<void>((resolve) => {
          release = resolve
        })
        serveFeed({})
        server.use(
          http.get('*/api/v1/wardrobe/saved-looks', async () => {
            await held
            return HttpResponse.json(
              savedLookListResponseSchema.parse({
                data: looks,
                total: looks.length,
                limit: 50,
                offset: 0,
              }) as unknown as Record<string, unknown>
            )
          })
        )
        renderLooks()

        // SCREEN_GATE_DEADLINE_MS (10 s) passes with the saved looks read still out.
        await waitFor(
          () =>
            expect(screen.getByTestId('screen-gate')).toHaveAttribute(
              'data-ready',
              'true'
            ),
          { timeout: 12_000 }
        )
        expect(
          document.querySelector('[role="progressbar"]'),
          'loading shown'
        ).not.toBeNull()
        expect(
          within(screen.getByTestId('looks-first-content')).getByTestId(
            'looks-feed-loading'
          )
        ).toBeInTheDocument()
        expect(screen.queryByTestId('looks-ideas-grid')).toBeNull()
        expect(screen.queryByTestId('looks-saved-grid')).toBeNull()

        release()
        await waitFor(() => expectOpenSegment(expected))
        if (expected === 'ideas')
          expect(screen.getByTestId('looks-ideas-empty-line')).toHaveTextContent(
            i18n.t('looks.empty')
          )
        else expect(await screen.findByTestId('saved-look-card-slow-look')).toBeVisible()
        expect(routerMock.setParams).not.toHaveBeenCalled()
      },
      30_000
    )

    it.each([
      ['an unknown segment', { segment: 'lookbook' }, 'saved'],
      ['Ideas in the address', { segment: 'ideas' }, 'ideas'],
      ['Plan in the address', { segment: 'plan' }, 'plan'],
    ] as const)(
      '[P1] %s opens %s for a member with a look',
      async (_case, params, expected) => {
        tabParams.set({ ...params })
        serveFeed({ looks: [look('look-1', at(20))] })
        server.use(
          http.get(PLANNER_ROUTE, () =>
            HttpResponse.json(
              { statusCode: 403, message: 'Premium subscription required.' },
              { status: 403 }
            )
          )
        )
        await openLooks()
        expectOpenSegment(expected)
      }
    )

    it('[P0] signed out opens Ideas at once, reads nothing, and Saved asks to sign in', async () => {
      restoreToken?.()
      restoreToken = setMobileAccessTokenResolver(() => undefined)
      setMobileApplicationUserId(null)
      const reads = serveFeed({ looks: [look('look-1', at(20))] })
      await openLooks()
      expectOpenSegment('ideas')
      expect(screen.getByTestId('looks-ideas-empty-line')).toBeVisible()

      await userEvent.click(segmentTab('saved'))
      const signIn = await screen.findByTestId('looks-sign-in')
      await userEvent.click(signIn)
      expect(routerMock.push).toHaveBeenCalledExactlyOnceWith('/signin')
      expect(screen.queryByTestId('looks-filters')).toBeNull()
      expect(reads.looks).toEqual([])
      expect(reads.capsules).toEqual([])
    })
  })

  describe('[7.12-NAT-002] Saved tiles, filters and Load more', () => {
    it('[P0] [D3, TEA P3] interleaves looks and capsules newest first; an exact tie puts the look first', async () => {
      const reads = serveFeed({
        // Each list newest first, as `sort=created_desc` answers; ids out of time order.
        looks: [look('look-c', at(22)), look('look-tie', at(18)), look('look-a', at(16))],
        capsules: [capsule('cap-b', at(20)), capsule('cap-tie', at(18))],
      })
      await openLooks()
      await screen.findByTestId('saved-look-card-look-c')

      expect(gridOrder()).toEqual([
        'saved-look-card-look-c',
        'looks-capsule-card-cap-b',
        'saved-look-card-look-tie',
        'looks-capsule-card-cap-tie',
        'saved-look-card-look-a',
      ])
      // Both lists are asked for the newest-first order, one page of 50 each.
      expect(reads.looks).toHaveLength(1)
      expect(reads.capsules).toHaveLength(1)
      for (const url of [...reads.looks, ...reads.capsules]) {
        expect(url.searchParams.get('sort')).toBe('created_desc')
        expect(url.searchParams.get('limit')).toBe('50')
        expect(url.searchParams.get('offset')).toBe('0')
      }
      expect(reads.looks[0]!.searchParams.has('source')).toBe(false)
      expect(reads.capsules[0]!.pathname).toBe(`/api/v1/wardrobe/${MEMBER}/capsules`)
    })

    it('[P0] [D2] one state line per tile: missing pieces, then Needs review, else the saved date', async () => {
      serveFeed({
        looks: [
          look('one-missing', at(24), {
            availabilityStatus: 'missing_garment',
            missingGarmentIds: ['gone-1'],
          }),
          look('two-missing', at(23), {
            availabilityStatus: 'missing_garment',
            missingGarmentIds: ['gone-1', 'gone-2'],
          }),
          look('review', at(22), {
            availabilityStatus: 'needs_review',
            needsReviewReasons: ['comfort_range_changed'],
          }),
          look('ready', at(20)),
        ],
        capsules: [
          capsule('cap-broken', at(21), {
            availabilityStatus: 'needs_repair',
            unavailableGarmentCount: 1,
          }),
          capsule('cap-ready', at(18)),
        ],
      })
      await openLooks()
      await screen.findByTestId('saved-look-card-ready')

      const label = (id: string) => screen.getByTestId(id).getAttribute('aria-label')
      expect(label('saved-look-card-one-missing')).toBe(
        'Look one-missing, 1 piece missing'
      )
      expect(label('saved-look-card-two-missing')).toBe(
        'Look two-missing, 2 pieces missing'
      )
      expect(label('saved-look-card-review')).toBe('Look review, Needs review')
      expect(label('saved-look-card-ready')).toBe('Look ready, Saved Nov 20')
      expect(label('looks-capsule-card-cap-broken')).toBe(
        'Capsule cap-broken, 1 piece missing'
      )
      expect(label('looks-capsule-card-cap-ready')).toBe(
        'Capsule cap-ready, Saved Nov 18'
      )
      // The line under the picture says the same as the label.
      expect(screen.getByTestId('saved-look-card-two-missing')).toHaveTextContent(
        'Look two-missing2 pieces missing'
      )
    })

    // looks-screen.tsx onWardrobeChanged: a tag edit or a garment delete on the Closet changes a
    // look's state line, so Looks rereads its feed (CC-7.12 D8 moved this off the Closet).
    it('[P1] [D2] [D8] a wardrobe change rereads saved looks; a look whose anchor tags changed shows Needs review', async () => {
      const anchored = look('anchored', at(22), {
        source: 'style_piece',
        anchorGarmentId: 'anchor-top',
        anchorSnapshot: {
          garmentId: 'anchor-top',
          category: 'top',
          comfortRange: 'mild',
        },
        composition: [
          {
            slotIndex: 0,
            category: 'top',
            kind: 'garment',
            itemId: 'anchor-top',
            label: null,
            missing: false,
            imageAccess: { url: PNG_PIXEL, expiresAt: FAR },
          },
          {
            slotIndex: 1,
            category: 'bottom',
            kind: 'catalog',
            itemId: 'dark-jeans',
            label: null,
            missing: false,
            imageAccess: null,
          },
        ],
      })
      const reads = serveFeed({ looks: [anchored] })
      await openLooks()
      const tile = await screen.findByTestId('saved-look-card-anchored')
      expect(tile).toHaveAttribute('aria-label', 'Look anchored, Saved Nov 22')

      // The member changes the anchor garment's comfort tag on the Closet; the server now
      // reports the look for review.
      serveFeed(
        {
          looks: [
            {
              ...anchored,
              availabilityStatus: 'needs_review',
              needsReviewReasons: ['comfort_range_changed'],
              revision: 1,
            },
          ],
        },
        reads
      )
      const before = reads.looks.length
      act(() => notifyWardrobeChanged())

      await waitFor(() => expect(reads.looks.length).toBeGreaterThan(before))
      await waitFor(() =>
        expect(screen.getByTestId('saved-look-card-anchored')).toHaveAttribute(
          'aria-label',
          `Look anchored, ${i18n.t('looks.state.needsReview')}`
        )
      )
      expect(screen.getByTestId('saved-look-card-anchored')).toHaveTextContent(
        i18n.t('looks.state.needsReview')
      )
      expectOpenSegment('saved')
    })

    it('[P1] [D2] the saved date follows the locale (de-DE)', async () => {
      await i18n.changeLanguage('de-DE')
      serveFeed({ looks: [look('ready', at(20))] })
      await openLooks()
      const tile = await screen.findByTestId('saved-look-card-ready')
      const date = new Intl.DateTimeFormat('de-DE', {
        month: 'short',
        day: 'numeric',
      }).format(new Date(at(20)))
      expect(tile.getAttribute('aria-label')).toBe(
        `Look ready, ${i18n.t('looks.state.savedOn', { date })}`
      )
      expect(date).toMatch(/20\.\s*Nov/)
    })

    it('[P0] [TEA P8] a tile is one 44 px link; its collage is hidden and a failed photo swaps to the placeholder in place', async () => {
      serveFeed({
        looks: [
          look('with-missing', at(22), {
            availabilityStatus: 'missing_garment',
            missingGarmentIds: ['gone-1'],
            composition: [
              {
                slotIndex: 0,
                category: 'top',
                kind: 'garment',
                itemId: 'gone-1',
                label: null,
                missing: true,
                imageAccess: null,
              },
            ],
          }),
        ],
        capsules: [capsuleWithBrokenPhoto('cap-photo', at(20))],
      })
      await openLooks()
      const lookTile = await screen.findByTestId('saved-look-card-with-missing')
      const capsuleTile = screen.getByTestId('looks-capsule-card-cap-photo')

      for (const tile of [lookTile, capsuleTile]) {
        expect(tile).toHaveAttribute('role', 'link')
        expect(tile.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
        // One control: nothing pressable inside the tile.
        expect(
          tile.querySelectorAll('[role="button"], [role="link"], button, a[href]')
        ).toHaveLength(0)
        const collage = tile.querySelector('[aria-hidden="true"]')
        expect(collage, 'the decorative collage').not.toBeNull()
        for (const img of Array.from(tile.querySelectorAll('img')))
          expect(collage!.contains(img)).toBe(true)
      }
      // A missing piece is the dashed placeholder.
      expect(within(lookTile).getAllByTestId('looks-tile-placeholder')).toHaveLength(1)

      // The capsule's first photo fails to load: its cell turns placeholder in the same square
      // as the photo beside it, which still shows.
      await waitFor(() =>
        expect(within(capsuleTile).getAllByTestId('looks-tile-placeholder')).toHaveLength(
          1
        )
      )
      const imgs = capsuleTile.querySelectorAll('img')
      expect(imgs).toHaveLength(1)
      // The photo cell: the cell box holds react-native-web's Image root, which holds the <img>.
      const photoCell = imgs[0]!.parentElement!.parentElement!.getBoundingClientRect()
      const failed = within(capsuleTile)
        .getByTestId('looks-tile-placeholder')
        .getBoundingClientRect()
      // Two pieces sit side by side and split the square evenly before the swap, so the failed
      // cell kept its slot only if it still covers the left half and the photo the right half.
      const collage = capsuleTile
        .querySelector('[aria-hidden="true"]')!
        .getBoundingClientRect()
      const gap = photoCell.left - failed.right
      expect(gap).toBeGreaterThanOrEqual(0)
      const half = (collage.width - gap) / 2
      for (const [name, cell] of [
        ['failed cell', failed],
        ['photo cell', photoCell],
      ] as const) {
        expect(cell.top, name).toBeCloseTo(collage.top, 0)
        expect(cell.height, name).toBeCloseTo(collage.height, 0)
        expect(cell.width, name).toBeCloseTo(half, 0)
      }
      expect(failed.left).toBeCloseTo(collage.left, 0)
      expect(photoCell.right).toBeCloseTo(collage.right, 0)
      // The tile itself does not shift: its collage stays a square as wide as the look tile's.
      const lookCollage = lookTile
        .querySelector('[aria-hidden="true"]')!
        .getBoundingClientRect()
      expect(collage.height).toBeCloseTo(collage.width, 0)
      expect(collage.width).toBeCloseTo(lookCollage.width, 0)
    })

    it('[P0] [D5, D6, TEA T2] a look tile opens its screen with the origin filter; a capsule tile opens the manager on it', async () => {
      serveFeed({
        looks: [look('look-1', at(22))],
        capsules: [capsule('cap-1', at(20))],
      })
      await openLooks()
      await userEvent.click(await screen.findByTestId('saved-look-card-look-1'))
      expect(routerMock.push).toHaveBeenLastCalledWith({
        pathname: '/saved-look/[savedLookId]',
        params: { savedLookId: 'look-1', from: 'all' },
      })
      await userEvent.click(screen.getByTestId('looks-capsule-card-cap-1'))
      expect(routerMock.push).toHaveBeenLastCalledWith({
        pathname: '/wardrobe-capsules',
        params: { capsule: 'cap-1' },
      })
      expect(routerMock.push).toHaveBeenCalledTimes(2)
    })

    it('[P0] [D4, TEA P2] Today reads home sample looks from the server and no capsules', async () => {
      const reads = serveFeed({
        looks: [
          look('home-2', at(22)),
          look('style-1', at(21), { source: 'style_piece' }),
          look('home-1', at(20)),
        ],
        capsules: [capsule('cap-1', at(23))],
      })
      await openLooks()
      await screen.findByTestId('looks-capsule-card-cap-1')
      const filters = screen.getByTestId('looks-filters')
      expect(filters).toHaveAttribute('role', 'group')
      expect(
        within(filters)
          .getAllByRole('button')
          .map((chip) => [
            chip.getAttribute('data-testid'),
            chip.getAttribute('aria-pressed'),
          ])
      ).toEqual([
        ['looks-filter-all', 'true'],
        ['looks-filter-today', 'false'],
        ['looks-filter-capsules', 'false'],
      ])
      reads.looks.length = 0
      reads.capsules.length = 0

      await userEvent.click(screen.getByTestId('looks-filter-today'))
      expect(routerMock.setParams).toHaveBeenCalledExactlyOnceWith({
        segment: 'saved',
        filter: 'today',
      })
      await waitFor(() =>
        expect(gridOrder()).toEqual(['saved-look-card-home-2', 'saved-look-card-home-1'])
      )
      expect(screen.getByTestId('looks-filter-today')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(reads.looks).toHaveLength(1)
      expect(reads.looks[0]!.searchParams.get('source')).toBe('home_sample')
      expect(reads.looks[0]!.searchParams.get('sort')).toBe('created_desc')
      expect(reads.capsules).toEqual([])
      expect(screen.queryByTestId('looks-manage-capsules')).toBeNull()

      // A tile under Today carries that filter, so Remove returns to it.
      await userEvent.click(screen.getByTestId('saved-look-card-home-2'))
      expect(routerMock.push).toHaveBeenLastCalledWith({
        pathname: '/saved-look/[savedLookId]',
        params: { savedLookId: 'home-2', from: 'today' },
      })
    })

    it('[P0] [D4, D6, TEA P2] Capsules reads capsules only and ends with Manage capsules', async () => {
      tabParams.set({ segment: 'saved', filter: 'capsules' })
      const reads = serveFeed({
        looks: [look('look-1', at(22))],
        capsules: [capsule('cap-2', at(21)), capsule('cap-1', at(20))],
      })
      await openLooks()
      await waitFor(() =>
        expect(gridOrder()).toEqual([
          'looks-capsule-card-cap-2',
          'looks-capsule-card-cap-1',
        ])
      )
      expect(reads.looks).toEqual([])
      expect(reads.capsules).toHaveLength(1)
      expect(reads.capsules[0]!.searchParams.get('sort')).toBe('created_desc')

      const manage = screen.getByTestId('looks-manage-capsules')
      expect(manage).toHaveTextContent(i18n.t('looks.manageCapsules'))
      expect(manage.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        screen.getByTestId('looks-first-content').getBoundingClientRect().bottom - 0.5
      )
      await userEvent.click(manage)
      expect(routerMock.push).toHaveBeenCalledExactlyOnceWith('/wardrobe-capsules')
    })

    it.each([
      ['today', 'No looks from Today yet'],
      ['capsules', 'No capsules yet'],
    ] as const)(
      '[P1] [D4] the %s filter with nothing to show reads one line',
      async (filter, text) => {
        tabParams.set({ segment: 'saved', filter })
        // Only a Style this piece look: nothing from Today, no capsule.
        serveFeed({ looks: [look('style-1', at(20), { source: 'style_piece' })] })
        await openLooks()
        const empty = await screen.findByTestId('looks-filter-empty')
        expect(empty).toHaveTextContent(text)
        expect(i18n.t(`looks.filterEmpty.${filter}`)).toBe(text)
        expect(screen.getByTestId('looks-first-content').contains(empty)).toBe(true)
        expect(screen.queryByTestId('looks-saved-grid')).toBeNull()
        expectOpenSegment('saved')
      }
    )

    it("[P0] [TEA T1] a filter change never shows the previous filter's tiles", async () => {
      let releaseToday!: () => void
      const todayHeld = new Promise<void>((resolve) => {
        releaseToday = resolve
      })
      serveFeed({ looks: [look('style-1', at(22), { source: 'style_piece' })] })
      await openLooks()
      await screen.findByTestId('saved-look-card-style-1')
      server.use(
        http.get('*/api/v1/wardrobe/saved-looks', async () => {
          await todayHeld
          return HttpResponse.json({ data: [], total: 0, limit: 50, offset: 0 })
        })
      )

      await userEvent.click(screen.getByTestId('looks-filter-today'))
      await waitFor(() =>
        expect(screen.getByTestId('looks-feed-loading')).toBeInTheDocument()
      )
      expect(screen.queryByTestId('saved-look-card-style-1')).toBeNull()
      releaseToday()
      expect(await screen.findByTestId('looks-filter-empty')).toHaveTextContent(
        'No looks from Today yet'
      )
    })

    it('[P1] [7.12-UNIT-021] Load more reads the source looks-feed names and keeps the order', async () => {
      const looks = Array.from({ length: 52 }, (_, index) =>
        look(
          `look-${String(index).padStart(2, '0')}`,
          new Date(Date.UTC(2026, 10, 25, 23, 59 - index)).toISOString()
        )
      )
      const reads = serveFeed({ looks, capsules: [capsule('cap-old', at(1))] })
      await openLooks()
      await screen.findByTestId('saved-look-card-look-00')

      // 50 looks loaded and 2 more on the server: the older capsule waits behind them.
      expect(gridOrder()).toHaveLength(50)
      expect(screen.queryByTestId('looks-capsule-card-cap-old')).toBeNull()
      const more = screen.getByTestId('saved-looks-load-more')
      expect(more).toHaveTextContent(i18n.t('looks.loadMore'))
      await userEvent.click(more)

      await waitFor(() => expect(gridOrder()).toHaveLength(53))
      expect(reads.looks).toHaveLength(2)
      expect(reads.looks[1]!.searchParams.get('offset')).toBe('50')
      expect(reads.capsules).toHaveLength(1)
      expect(gridOrder()).toEqual([
        ...looks.map((item) => `saved-look-card-${item.id}`),
        'looks-capsule-card-cap-old',
      ])
      expect(screen.queryByTestId('saved-looks-load-more')).toBeNull()
    })

    // Codex 7.12 #5 (P9, CC-7.11 AC4): back from a saved look is a focus that reads the feed
    // again; the pages already loaded and the scroll offset stay once that read settles.
    it('[P0] [Codex 7.12 #5] back after Load more keeps every loaded page and the scroll offset', async () => {
      const looks = Array.from({ length: 52 }, (_, index) =>
        look(
          `look-${String(index).padStart(2, '0')}`,
          new Date(Date.UTC(2026, 10, 25, 23, 59 - index)).toISOString()
        )
      )
      const reads = serveFeed({ looks })
      await openLooks()
      await screen.findByTestId('saved-look-card-look-00')
      await userEvent.click(screen.getByTestId('saved-looks-load-more'))
      await waitFor(() => expect(gridOrder()).toHaveLength(52))

      const grid = screen.getByTestId('looks-saved-grid')
      let scroller: HTMLElement | null = grid.parentElement
      while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1)
        scroller = scroller.parentElement
      expect(scroller, 'the Looks scroll view').not.toBeNull()
      // Position the deep tile first, so the offset is the one the member left from and the
      // click below cannot scroll the list itself.
      const deep = screen.getByTestId('saved-look-card-look-51')
      deep.scrollIntoView({ block: 'center' })
      fireEvent.scroll(scroller!)
      const offset = scroller!.scrollTop
      expect(offset, 'the list is scrolled down to the tile').toBeGreaterThan(0)
      const tileTop = () =>
        screen.getByTestId('saved-look-card-look-51').getBoundingClientRect().top -
        scroller!.getBoundingClientRect().top
      const top = tileTop()
      expect(top, 'the tile is inside the scroll view').toBeGreaterThanOrEqual(0)
      expect(top + deep.getBoundingClientRect().height).toBeLessThanOrEqual(
        scroller!.clientHeight + 1
      )

      // The member opens a look below page one and comes back. The refresh renames the first
      // look, so its title on screen proves the refreshed read committed and rendered.
      await userEvent.click(deep)
      expect(scroller!.scrollTop, 'opening the tile did not scroll').toBeCloseTo(
        offset,
        0
      )
      const refreshed = looks.map((item, index) =>
        index === 0 ? { ...item, title: 'Look look-00 refreshed' } : item
      )
      serveFeed({ looks: refreshed }, reads)
      const before = reads.looks.length
      act(() => screenFocus.set(false))
      act(() => screenFocus.set(true))
      await waitFor(() => expect(reads.looks.length).toBeGreaterThan(before))
      await waitFor(() =>
        expect(screen.getByTestId('saved-look-card-look-00')).toHaveTextContent(
          'Look look-00 refreshed'
        )
      )

      expect(gridOrder()).toEqual(looks.map((item) => `saved-look-card-${item.id}`))
      expect(Math.abs(scroller!.scrollTop - offset)).toBeLessThanOrEqual(1)
      expect(Math.abs(tileTop() - top), 'the tile sits where it was').toBeLessThanOrEqual(
        1
      )
    })

    // Codex 7.12 #7 (D2, P8): a photo that failed shows again when the feed brings a fresh
    // signed URL for the same piece while the tile stays mounted.
    it('[P1] [TEA P8] [Codex 7.12 #7] a failed photo comes back with a refreshed URL for the same piece', async () => {
      const store: { capsules: OutfitCapsuleContract[] } = {
        capsules: [capsuleWithBrokenPhoto('cap-photo', at(20))],
      }
      serveFeed(store)
      await openLooks()
      const tile = await screen.findByTestId('looks-capsule-card-cap-photo')
      await waitFor(() =>
        expect(within(tile).getAllByTestId('looks-tile-placeholder')).toHaveLength(1)
      )
      expect(tile.querySelectorAll('img')).toHaveLength(1)

      const refreshed = `${PNG_PIXEL}#signed-again`
      const [first, second] = store.capsules[0]!.garments
      serveFeed({
        capsules: [
          capsule('cap-photo', at(20), {
            garments: [
              { ...first!, imageAccess: { url: refreshed, expiresAt: FAR } },
              second!,
            ],
          }),
        ],
      })
      act(() => notifyMobileSavedLooksChanged(MEMBER))
      const same = await screen.findByTestId('looks-capsule-card-cap-photo')
      expect(same).toBe(tile)
      await waitFor(() =>
        expect(within(tile).queryAllByTestId('looks-tile-placeholder')).toHaveLength(0)
      )
      expect(tile.querySelectorAll('img')).toHaveLength(2)
    })

    it('[P0] [TEA P9] a member switch paints no tile of the previous member', async () => {
      serveFeed({ looks: [look('member-a-look', at(22))] })
      await openLooks()
      await screen.findByTestId('saved-look-card-member-a-look')

      serveFeed({ looks: [look('member-b-look', at(21), { ownerUserId: 'member-b' })] })
      act(() => setMobileApplicationUserId('member-b'))
      // The first paint after the switch is the new member's gate, not A's grid.
      expect(screen.queryByTestId('saved-look-card-member-a-look')).toBeNull()
      expect(await screen.findByTestId('saved-look-card-member-b-look')).toBeVisible()
      expect(screen.queryByTestId('saved-look-card-member-a-look')).toBeNull()
    })
  })

  describe('[7.12-NAT-003] Ideas', () => {
    it('[P0] [D9] shows every sample look as a picture tile with a name and a line, and no control', async () => {
      tabParams.set({ segment: 'ideas' })
      serveFeed({ looks: [look('look-1', at(20))] })
      await openLooks()
      const grid = screen.getByTestId('looks-ideas-grid')

      const tiles = Array.from(grid.querySelectorAll('[data-testid^="looks-idea-card-"]'))
      expect(tiles.map((tile) => tile.getAttribute('data-testid'))).toEqual(
        SAMPLE_CATALOG.looks.map((sample) => `looks-idea-card-${sample.id}`)
      )
      for (const tile of tiles) {
        const lines = Array.from(tile.querySelectorAll('div[dir="auto"]'))
          .map((node) => node.textContent?.trim() ?? '')
          .filter(Boolean)
        expect(lines.length, tile.getAttribute('data-testid')!).toBeGreaterThanOrEqual(2)
      }
      // D9: pictures only until CC-7.22 ships the lookbook.
      expect(
        grid.querySelectorAll(
          '[role="button"], [role="link"], button, a[href], [tabindex]:not([tabindex^="-"])'
        )
      ).toHaveLength(0)
      expect(screen.queryByTestId('looks-filters')).toBeNull()
    })
  })

  // Codex 7.12 #11 (D9): the first-save line is for a member with nothing saved, whatever filter
  // the address still carries; the line comes from the All feed only.
  describe('[7.12-NAT-003] [Codex 7.12 #11] Ideas first-save line', () => {
    it.each(['today', 'capsules'] as const)(
      '[P1] a member with saved looks sees no first-save line on Ideas under an empty %s filter',
      async (filter) => {
        serveFeed({ looks: [look('style-1', at(20), { source: 'style_piece' })] })
        tabParams.set({ segment: 'saved', filter })
        await openLooks()
        await screen.findByTestId('looks-filter-empty')

        await userEvent.click(segmentTab('ideas'))
        await waitFor(() => expectOpenSegment('ideas'))
        // setParams kept the filter in the address.
        expect(tabParams.get()).toEqual({ segment: 'ideas', filter })
        expect(screen.getByTestId('looks-ideas-grid')).toBeVisible()
        expect(screen.queryByTestId('looks-ideas-empty-line')).toBeNull()
      }
    )
  })

  describe('[7.12-NAT-030] Plan', () => {
    it('[P0] [D10] a free member on Plan sees the free preview with one Upgrade to Profile', async () => {
      tabParams.set({ segment: 'plan' })
      serveFeed({ looks: [look('look-1', at(20))] })
      server.use(
        http.get(PLANNER_ROUTE, () =>
          HttpResponse.json(
            {
              statusCode: 403,
              message: 'Premium subscription required.',
              error: 'Forbidden',
            },
            { status: 403 }
          )
        )
      )
      await openLooks()
      const first = screen.getByTestId('looks-first-content')
      const preview = await within(first).findByTestId('plan-free-preview')
      expect(preview).toHaveTextContent(i18n.t('looks.freePlan.line'))
      const upgrades = screen.getAllByTestId('plan-upgrade')
      expect(upgrades).toHaveLength(1)
      expect(screen.queryByTestId('planner-locked')).toBeNull()
      await userEvent.click(upgrades[0]!)
      expect(routerMock.push).toHaveBeenCalledExactlyOnceWith('/settings')
    })
  })
})

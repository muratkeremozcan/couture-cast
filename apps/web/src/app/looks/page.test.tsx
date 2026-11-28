// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-UNIT-020 (default segment, P1), 7.12-UNIT-021 (Load more
// reads the source looks-feed names; 021f-g TEA W2: a failed refresh keeps the shown tiles, a
// failed first read shows Retry), 7.12-UNIT-022 (member switch, P9), 7.12-UNIT-023 (segment
// and filter in the address), 7.12-UNIT-024 (filters read the server, P2; TEA T1) and the Plan
// segment (D10, D11: the free preview and the legacy `planner` key). The CC-7.11 cases
// 7.11-CMP-LOOKS-01..11 and 7.11-CMP-PLAN-01..06 (app/looks/plan/page.test.tsx, route removed)
// are carried here under the 7.12 layout: the saved looks row and the Capsules and Plan rows
// became the Saved grid, the Capsules filter and the Plan segment.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
// Step 80 verifies that explicit Ideas opens while Saved is still loading.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-80-ai-written-look-ideas
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PREMIUM_REQUIRED_MESSAGE,
  type OutfitCapsuleContract,
  type SavedLookContract,
} from '@couture/api-client/contracts/http'
import type * as SavedLooksModule from '../../lib/saved-looks'
import type * as WardrobeModule from '../../lib/wardrobe'
import {
  notifySavedLooksChanged,
  SavedLookRequestError,
  type SavedLookPageResult,
} from '../../lib/saved-looks'
import { screenSnapshot } from '../../lib/screen-snapshot'
import { WardrobeRequestError, WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { signInFixtureMember } from '../../test-utils/member-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import LooksPage from './page'

/**
 * The router's replace moves the address like Next does, so the screen reads the segment and
 * filter it asked for back from `useSearchParams`.
 */
const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  prefetch: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/looks',
  useRouter: () => router,
  useSearchParams: () => useMockSearchParams(),
}))
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

const ADDRESS_EVENT = 'test:looks-address'
function useMockSearchParams() {
  const search = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(ADDRESS_EVENT, onChange)
      return () => window.removeEventListener(ADDRESS_EVENT, onChange)
    },
    () => window.location.search,
    () => ''
  )
  return new URLSearchParams(search)
}
function moveAddress(url: string) {
  window.history.replaceState(null, '', url)
  window.dispatchEvent(new Event(ADDRESS_EVENT))
}

// Only the two list reads are stubbed, so each test decides when and how they answer; the
// change notification stays real.
const list = vi.hoisted(() => vi.fn())
const capsules = vi.hoisted(() => vi.fn())
const userId = vi.hoisted(() => vi.fn())
vi.mock('../../lib/saved-looks', async (importOriginal) => ({
  ...(await importOriginal<typeof SavedLooksModule>()),
  listSavedLooksPageFromWeb: list,
}))
vi.mock('../../lib/wardrobe', async (importOriginal) => ({
  ...(await importOriginal<typeof WardrobeModule>()),
  listCapsulesFromWeb: capsules,
  resolveCurrentUserId: userId,
}))

/** The owner every e2e fixture bearer reads as (lib/use-web-session.ts). */
const FIXTURE_OWNER = 'bearer'
/**
 * The profile id `resolveCurrentUserId` answers for the fixture member. A fixture bearer has no
 * verified owner, so the saved looks read is made for this id (looks-screen.tsx).
 */
const FIXTURE_PROFILE_ID = 'member-1'
const PLANNER_PATH = '/api/v1/commerce/premium/planner'
const BASE = Date.parse('2026-11-22T12:00:00.000Z')

/** An ISO time `minutes` before the base, so a larger number is older. */
const ago = (minutes: number) => new Date(BASE - minutes * 60_000).toISOString()

function look(
  id: string,
  title: string,
  overrides: Partial<SavedLookContract> = {}
): SavedLookContract {
  return {
    id,
    ownerUserId: 'member-1',
    source: 'home_sample',
    lookId: `look-${id}`,
    weather: 'warm-rainy',
    title,
    anchorGarmentId: null,
    anchorSnapshot: null,
    composition: [],
    swaps: {},
    collection: null,
    comfort: null,
    availabilityStatus: 'ready',
    missingGarmentIds: [],
    needsReviewReasons: [],
    revision: 0,
    createdAt: ago(0),
    updatedAt: ago(0),
    ...overrides,
  }
}

function capsule(
  id: string,
  name: string,
  overrides: Partial<OutfitCapsuleContract> = {}
): OutfitCapsuleContract {
  return {
    id,
    ownerUserId: 'member-1',
    name,
    description: null,
    occasions: ['casual'],
    isFavorite: false,
    revision: 1,
    availabilityStatus: 'ready',
    unavailableGarmentCount: 0,
    garments: [],
    createdAt: ago(0),
    updatedAt: ago(0),
    ...overrides,
  } as unknown as OutfitCapsuleContract
}

function page(looks: SavedLookContract[], total = looks.length, offset = 0) {
  return { data: looks, total, limit: 50, offset } satisfies SavedLookPageResult
}

function capsulePage(items: OutfitCapsuleContract[], total = items.length, offset = 0) {
  return { items, total, limit: 50, offset }
}

/**
 * A full first page, newest first: the server returns `limit` looks whenever more exist, and the
 * Looks read keeps paging until it holds a page or the total, so a short first page with a
 * larger total would be read on at once.
 */
const FIRST_PAGE = Array.from({ length: 50 }, (_, index) =>
  look(`sl-${index + 1}`, `Look ${index + 1}`, { createdAt: ago(index + 1) })
)

/** A read the test answers by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function expectInOrder(...elements: HTMLElement[]) {
  for (let index = 1; index < elements.length; index += 1) {
    expect(
      elements[index - 1]!.compareDocumentPosition(elements[index]!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  }
}

/** Tile test ids in the order the grid shows them. */
function tileIds() {
  return within(screen.getByTestId('looks-saved-grid'))
    .getAllByRole('link')
    .map((link) => link.getAttribute('data-testid'))
}

const startUrl = window.location.href

beforeEach(() => {
  useMswHandlers(
    http.get('/api/v1/ritual', () =>
      HttpResponse.json(
        { statusCode: 400, message: 'No location preferences found for user' },
        { status: 400 }
      )
    ),
    http.post('/api/v1/personalization/look-ideas', () =>
      HttpResponse.json({ data: null })
    )
  )
  list.mockReset()
  capsules.mockReset().mockResolvedValue(capsulePage([]))
  userId.mockReset().mockResolvedValue('member-1')
  router.replace.mockReset().mockImplementation((url: string) => moveAddress(url))
  router.push.mockReset()
  router.back.mockReset()
  moveAddress('/looks')
})

afterEach(() => {
  window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
  screenSnapshot.clear()
  window.history.replaceState(null, '', startUrl)
})

describe('7.12 Looks tab default segment (D1, P1)', () => {
  it('7.23-APPLY explicit Ideas paints before the Saved feed and the later empty line appears below the card', async () => {
    signInFixtureMember()
    const saved = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(saved.promise)
    moveAddress('/looks?segment=ideas')

    render(<LooksPage />)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    const card = await screen.findByTestId('member-lookbook')
    expect(card).toBeVisible()
    expect(screen.queryByTestId('looks-ideas-empty-line')).toBeNull()

    await act(async () => {
      saved.resolve(page([]))
      await saved.promise
    })
    const line = await screen.findByTestId('looks-ideas-empty-line')
    expectInOrder(card, line)
    expect(card).toBeVisible()
  })

  it('7.12-UNIT-020a signed out opens on Ideas at once, titled Looks with no back, and reads nothing', () => {
    render(<LooksPage />)

    expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent('Looks')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Looks')
    expect(screen.queryByTestId('app-top-bar-back')).toBeNull()
    expect(screen.getByTestId('bottom-nav-looks')).toHaveAttribute('aria-current', 'page')

    const tabs = within(
      screen.getByRole('tablist', { name: 'Looks sections' })
    ).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Saved', 'Ideas', 'Plan'])
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ])
    const first = screen.getByTestId('looks-first-content')
    expect(within(first).getByTestId('looks-ideas-empty-line')).toHaveTextContent(
      'Save a look to see it here'
    )
    expect(within(first).getAllByTestId(/^looks-idea-card-/).length).toBeGreaterThan(0)
    // Ideas tiles are pictures with no control (D9).
    expect(within(screen.getByTestId('looks-ideas-grid')).queryAllByRole('link')).toEqual(
      []
    )
    expect(
      within(screen.getByTestId('looks-ideas-grid')).queryAllByRole('button')
    ).toEqual([])
    expect(list).not.toHaveBeenCalled()
    expect(capsules).not.toHaveBeenCalled()
    // CC-7.11 rows and the Closet row are gone.
    for (const id of ['looks-capsules-row', 'looks-plan-row', 'closet-saved-looks-row'])
      expect(screen.queryByTestId(id)).toBeNull()
  })

  it('7.12-UNIT-020b while the first reads are out the gate holds and paints no segment; one look then opens Saved', async () => {
    signInFixtureMember()
    const looks = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(looks.promise)

    render(<LooksPage />)

    const gate = screen.getByTestId('screen-gate')
    expect(gate).not.toHaveAttribute('data-ready')
    expect(screen.queryByTestId('looks-segments')).toBeNull()
    expect(screen.queryByTestId('member-lookbook')).toBeNull()
    await waitFor(() => expect(capsules).toHaveBeenCalledTimes(1))
    // The capsules read answered; the gate still waits for the saved looks read.
    expect(screen.queryByTestId('looks-segments')).toBeNull()

    await act(async () => {
      looks.resolve(page([look('sl-1', 'Rainy commute')]))
      await looks.promise
    })

    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    expect(screen.getByTestId('looks-segment-saved')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    const first = screen.getByTestId('looks-first-content')
    expect(first).toContainElement(screen.getByTestId('saved-look-card-sl-1'))
    expect(screen.getByTestId('looks-filter-all')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('member-lookbook')).toBeNull()
    expect(list).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        owner: FIXTURE_PROFILE_ID,
        sort: 'created_desc',
        includeToday: true,
        source: undefined,
        limit: 50,
        offset: 0,
      })
    )
    expect(capsules).toHaveBeenCalledWith(
      'member-1',
      { sort: 'created_desc', limit: 50, offset: 0 },
      expect.any(AbortSignal)
    )
    // The default is not written into the address.
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('7.12-UNIT-020c a member with only a capsule opens on Saved with its tile', async () => {
    signInFixtureMember()
    list.mockResolvedValue(page([]))
    capsules.mockResolvedValue(capsulePage([capsule('cap-1', 'Weekday capsule')]))

    render(<LooksPage />)

    const tile = await screen.findByTestId('looks-capsule-card-cap-1')
    expect(screen.getByTestId('looks-segment-saved')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(tile).toHaveAttribute('href', '/looks/capsules?capsule=cap-1')
  })

  it('7.12-UNIT-020d a member with nothing saved opens on Ideas with the empty line', async () => {
    signInFixtureMember()
    list.mockResolvedValue(page([]))

    render(<LooksPage />)

    expect(await screen.findByTestId('looks-ideas-empty-line')).toHaveTextContent(
      'Save a look to see it here'
    )
    expect(screen.getByTestId('looks-segment-ideas')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.queryByTestId('looks-filters')).toBeNull()
  })

  it('7.12-UNIT-020e a failed saved looks read opens Saved with the alert, and Retry reads again', async () => {
    signInFixtureMember()
    list.mockRejectedValueOnce(new Error('offline'))
    list.mockResolvedValueOnce(page([look('sl-1', 'Rainy commute')]))

    render(<LooksPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load your saved looks.')
    expect(screen.getByTestId('looks-segment-saved')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByTestId('looks-first-content')).toContainElement(alert)
    expect(screen.queryByTestId('member-lookbook')).toBeNull()

    fireEvent.click(screen.getByTestId('saved-looks-retry'))

    expect(await screen.findByTestId('saved-look-card-sl-1')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('7.12-UNIT-020f a read that rejects with a non-Error still lands as the load failure on Saved', async () => {
    signInFixtureMember()
    list.mockRejectedValueOnce('socket closed')

    render(<LooksPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load your saved looks.'
    )
    expect(screen.getByTestId('looks-segment-saved')).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('7.12-UNIT-020g the default is decided once: removing the last look keeps Saved with its empty line', async () => {
    signInFixtureMember()
    list.mockResolvedValueOnce(page([look('sl-1', 'Rainy commute')]))
    list.mockResolvedValueOnce(page([]))

    render(<LooksPage />)
    await screen.findByTestId('saved-look-card-sl-1')

    act(() => notifySavedLooksChanged(FIXTURE_OWNER))

    await waitFor(() => expect(screen.queryByTestId('saved-look-card-sl-1')).toBeNull())
    expect(screen.getByTestId('looks-segment-saved')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByTestId('looks-filter-empty')).toHaveTextContent(
      'Save a look to see it here'
    )
    expect(screen.queryByTestId('member-lookbook')).toBeNull()
  })
})

describe('7.12 Looks segment and filter address (D1, D4)', () => {
  it('7.12-UNIT-023a a segment change replaces the address, and back has nothing new to step through', async () => {
    signInFixtureMember()
    list.mockResolvedValue(page([look('sl-1', 'Rainy commute')]))
    const depth = window.history.length

    render(<LooksPage />)
    await screen.findByTestId('saved-look-card-sl-1')

    fireEvent.click(screen.getByTestId('looks-segment-ideas'))
    expect(router.replace).toHaveBeenLastCalledWith('/looks?segment=ideas', {
      scroll: false,
    })
    expect(await screen.findByTestId('member-lookbook')).toBeVisible()
    expect(screen.getByTestId('looks-segment-ideas')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    // A member with looks gets no empty line on Ideas.
    expect(screen.queryByTestId('looks-ideas-empty-line')).toBeNull()

    fireEvent.click(screen.getByTestId('looks-segment-plan'))
    expect(router.replace).toHaveBeenLastCalledWith('/looks?segment=plan', {
      scroll: false,
    })

    fireEvent.click(screen.getByTestId('looks-segment-saved'))
    expect(router.replace).toHaveBeenLastCalledWith('/looks?segment=saved', {
      scroll: false,
    })
    expect(await screen.findByTestId('saved-look-card-sl-1')).toBeVisible()

    expect(router.push).not.toHaveBeenCalled()
    expect(window.history.length).toBe(depth)
  })

  it('7.12-UNIT-023b a filter change replaces the address with Saved and the filter', async () => {
    signInFixtureMember()
    list.mockResolvedValue(page([look('sl-1', 'Rainy commute')]))

    render(<LooksPage />)
    await screen.findByTestId('saved-look-card-sl-1')

    fireEvent.click(screen.getByTestId('looks-filter-today'))
    expect(router.replace).toHaveBeenLastCalledWith('/looks?segment=saved&filter=today', {
      scroll: false,
    })
    await waitFor(() =>
      expect(screen.getByTestId('looks-filter-today')).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    )
    expect(screen.getByTestId('looks-filter-all')).toHaveAttribute(
      'aria-pressed',
      'false'
    )

    fireEvent.click(screen.getByTestId('looks-filter-all'))
    expect(router.replace).toHaveBeenLastCalledWith('/looks?segment=saved', {
      scroll: false,
    })
  })

  // Codex 7.12 #11: an empty Today (or Capsules) list says nothing about All, so Ideas keeps the
  // first-save line for a member whose All is empty.
  it.each([
    ['today', 'the Today list'],
    ['capsules', 'the Capsules list'],
  ])(
    '7.12-UNIT-023f Ideas with filter=%s shows no first-save line when %s is empty',
    async (filter) => {
      signInFixtureMember()
      list.mockResolvedValue(page([]))
      capsules.mockResolvedValue(capsulePage([]))
      moveAddress(`/looks?segment=ideas&filter=${filter}`)

      render(<LooksPage />)

      expect(await screen.findByTestId('member-lookbook')).toBeVisible()
      await waitFor(() =>
        expect(filter === 'today' ? list : capsules).toHaveBeenCalledTimes(1)
      )
      expect(screen.queryByTestId('looks-ideas-empty-line')).toBeNull()
      expect(screen.queryByText('Save a look to see it here')).toBeNull()
    }
  )

  it('7.12-UNIT-023g Ideas after a failed saved looks read shows no first-save line', async () => {
    signInFixtureMember()
    list.mockRejectedValue(new Error('offline'))
    moveAddress('/looks?segment=ideas')

    render(<LooksPage />)

    expect(await screen.findByTestId('member-lookbook')).toBeVisible()
    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(screen.queryByTestId('looks-ideas-empty-line')).toBeNull()
  })

  it('7.12-UNIT-023c arrow keys, Home and End move between segments and select them', async () => {
    moveAddress('/looks?segment=ideas')
    render(<LooksPage />)
    const ideas = screen.getByTestId('looks-segment-ideas')
    expect(ideas).toHaveAttribute('tabindex', '0')
    expect(screen.getByTestId('looks-segment-saved')).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(ideas, { key: 'ArrowRight' })
    expect(router.replace).toHaveBeenLastCalledWith('/looks?segment=plan', {
      scroll: false,
    })
    await waitFor(() => expect(screen.getByTestId('looks-segment-plan')).toHaveFocus())

    fireEvent.keyDown(screen.getByTestId('looks-segment-plan'), { key: 'ArrowRight' })
    expect(router.replace).toHaveBeenLastCalledWith('/looks?segment=saved', {
      scroll: false,
    })

    fireEvent.keyDown(screen.getByTestId('looks-segment-saved'), { key: 'End' })
    expect(router.replace).toHaveBeenLastCalledWith('/looks?segment=plan', {
      scroll: false,
    })

    fireEvent.keyDown(screen.getByTestId('looks-segment-plan'), { key: 'Home' })
    expect(router.replace).toHaveBeenLastCalledWith('/looks?segment=saved', {
      scroll: false,
    })

    fireEvent.keyDown(screen.getByTestId('looks-segment-saved'), { key: 'ArrowLeft' })
    expect(router.replace).toHaveBeenLastCalledWith('/looks?segment=plan', {
      scroll: false,
    })
  })

  it.each([
    ['/looks?segment=ideas', 'ideas'],
    ['/looks?segment=plan', 'plan'],
    ['/looks?segment=saved', 'saved'],
    ['/looks?filter=today', 'saved'],
  ])('7.12-UNIT-023d %s opens on %s for a member with no looks', async (url, segment) => {
    signInFixtureMember()
    list.mockResolvedValue(page([]))
    moveAddress(url)

    render(<LooksPage />)

    await waitFor(() =>
      expect(screen.getByTestId(`looks-segment-${segment}`)).toHaveAttribute(
        'aria-selected',
        'true'
      )
    )
  })

  it.each([
    ['/looks?segment=bogus', 'ideas', 'all'],
    ['/looks?segment=SAVED', 'ideas', 'all'],
    ['/looks?segment=saved&filter=bogus', 'saved', 'all'],
    ['/looks?filter=%3Cscript%3E', 'saved', 'all'],
  ])(
    '7.12-UNIT-023e an unknown value in %s falls back (segment %s, filter %s)',
    async (url, segment, filter) => {
      signInFixtureMember()
      list.mockResolvedValue(page([]))
      moveAddress(url)

      render(<LooksPage />)

      await waitFor(() =>
        expect(screen.getByTestId(`looks-segment-${segment}`)).toHaveAttribute(
          'aria-selected',
          'true'
        )
      )
      if (segment === 'saved')
        expect(screen.getByTestId(`looks-filter-${filter}`)).toHaveAttribute(
          'aria-pressed',
          'true'
        )
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ source: undefined }))
      expect(router.replace).not.toHaveBeenCalled()
    }
  )
})

describe('7.12 Looks Saved filters (D4, P2, T1)', () => {
  it('7.12-UNIT-024a Today reads home sample looks only and no capsules', async () => {
    signInFixtureMember()
    list.mockResolvedValue(page([look('sl-home', 'Sample morning')]))
    moveAddress('/looks?segment=saved&filter=today')

    render(<LooksPage />)

    expect(await screen.findByTestId('saved-look-card-sl-home')).toHaveAttribute(
      'href',
      '/looks/saved/sl-home?from=today'
    )
    expect(list).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        source: 'home_sample',
        sort: 'created_desc',
        offset: 0,
      })
    )
    expect(capsules).not.toHaveBeenCalled()
    // The fixture bearer's profile id stands in for its owner on the saved looks read.
    expect(userId).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('looks-manage-capsules')).toBeNull()
  })

  it('CC-7.21 keeps catalog looks available when the guardian lock refuses capsules', async () => {
    signInFixtureMember()
    list.mockResolvedValue(page([look('first-run-look', 'Sample morning')]))
    capsules.mockRejectedValue(
      new WardrobeRequestError(
        'Guardian consent required before continuing',
        undefined,
        403
      )
    )
    moveAddress('/looks?segment=saved')
    render(<LooksPage />)
    expect(await screen.findByTestId('saved-look-card-first-run-look')).toBeVisible()
    expect(screen.queryByTestId('saved-looks-retry')).toBeNull()
    expect(capsules).toHaveBeenCalledOnce()
  })

  it('7.12-UNIT-024b Capsules reads capsules only and ends with Manage capsules', async () => {
    signInFixtureMember()
    capsules.mockResolvedValue(
      capsulePage([
        capsule('cap-new', 'Weekend', { createdAt: ago(1) }),
        capsule('cap-old', 'Office', { createdAt: ago(5) }),
      ])
    )
    moveAddress('/looks?segment=saved&filter=capsules')

    render(<LooksPage />)

    await screen.findByTestId('looks-capsule-card-cap-new')
    expect(tileIds()).toEqual([
      'looks-capsule-card-cap-new',
      'looks-capsule-card-cap-old',
    ])
    expect(list).not.toHaveBeenCalled()
    expect(capsules).toHaveBeenCalledTimes(1)
    const manage = screen.getByTestId('looks-manage-capsules')
    expect(manage).toHaveAttribute('href', '/looks/capsules')
    expect(manage).toHaveTextContent('Manage capsules')
    expectInOrder(screen.getByTestId('looks-saved-grid'), manage)
  })

  it.each([
    ['today', 'No looks from Today yet', false],
    ['capsules', 'No capsules yet', true],
  ])(
    '7.12-UNIT-024c an empty %s filter reads one line from the catalog',
    async (filter, line, manage) => {
      signInFixtureMember()
      list.mockResolvedValue(page([]))
      moveAddress(`/looks?segment=saved&filter=${filter}`)

      render(<LooksPage />)

      const empty = await screen.findByTestId('looks-filter-empty')
      expect(empty).toHaveTextContent(line)
      expect(screen.getByTestId('looks-first-content')).toContainElement(empty)
      expect(screen.queryByTestId('looks-saved-grid')).toBeNull()
      if (manage) expect(screen.getByTestId('looks-manage-capsules')).toBeVisible()
      else expect(screen.queryByTestId('looks-manage-capsules')).toBeNull()
    }
  )

  it("7.12-UNIT-024d T1: on a filter change no tile of the previous filter shows while the new filter's read is out", async () => {
    signInFixtureMember()
    list.mockResolvedValueOnce(
      page([
        look('sl-style', 'Style piece look', {
          source: 'style_piece',
          createdAt: ago(1),
        }),
        look('sl-home', 'Sample look', { createdAt: ago(2) }),
      ])
    )
    capsules.mockResolvedValueOnce(capsulePage([capsule('cap-1', 'Weekday')]))
    const today = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(today.promise)

    render(<LooksPage />)
    await screen.findByTestId('saved-look-card-sl-style')
    expect(screen.getByTestId('looks-capsule-card-cap-1')).toBeVisible()

    fireEvent.click(screen.getByTestId('looks-filter-today'))

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('saved-look-card-sl-style')).toBeNull()
    expect(screen.queryByTestId('saved-look-card-sl-home')).toBeNull()
    expect(screen.queryByTestId('looks-capsule-card-cap-1')).toBeNull()
    expect(screen.queryByTestId('looks-filter-empty')).toBeNull()

    await act(async () => {
      today.resolve(page([look('sl-home', 'Sample look', { createdAt: ago(2) })]))
      await today.promise
    })
    expect(await screen.findByTestId('saved-look-card-sl-home')).toBeVisible()
    expect(screen.queryByTestId('saved-look-card-sl-style')).toBeNull()
    expect(screen.queryByTestId('looks-capsule-card-cap-1')).toBeNull()
    expect(capsules).toHaveBeenCalledTimes(1)
  })
})

describe('7.12 Looks Saved grid and paging (D2, D3)', () => {
  it('7.12-UNIT-021a shows saved looks and capsules newest first, a look before a capsule on a tie', async () => {
    signInFixtureMember()
    list.mockResolvedValue(
      page([
        look('sl-c', 'Look C', { createdAt: ago(1) }),
        look('sl-tie', 'Look tie', { createdAt: ago(3) }),
        look('sl-a', 'Look A', { createdAt: ago(5) }),
      ])
    )
    capsules.mockResolvedValue(
      capsulePage([
        capsule('cap-b', 'Capsule B', { createdAt: ago(2) }),
        capsule('cap-tie', 'Capsule tie', { createdAt: ago(3) }),
      ])
    )

    render(<LooksPage />)
    await screen.findByTestId('saved-look-card-sl-c')

    expect(tileIds()).toEqual([
      'saved-look-card-sl-c',
      'looks-capsule-card-cap-b',
      'saved-look-card-sl-tie',
      'looks-capsule-card-cap-tie',
      'saved-look-card-sl-a',
    ])
    expect(screen.getByTestId('saved-look-card-sl-c')).toHaveAttribute(
      'href',
      '/looks/saved/sl-c?from=all'
    )
    expect(screen.queryByTestId('saved-looks-load-more')).toBeNull()
  })

  it('7.12-UNIT-021b Load more reads the next saved looks page, and an older capsule waits for it', async () => {
    signInFixtureMember()
    list.mockResolvedValueOnce(page(FIRST_PAGE, 52))
    capsules.mockResolvedValue(
      capsulePage([capsule('cap-old', 'Old capsule', { createdAt: ago(200) })])
    )
    const next = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(next.promise)

    render(<LooksPage />)

    const more = await screen.findByTestId('saved-looks-load-more')
    // The capsule is older than the last loaded look, so it cannot show yet.
    expect(screen.queryByTestId('looks-capsule-card-cap-old')).toBeNull()
    expect(list).toHaveBeenCalledTimes(1)
    fireEvent.click(more)
    expect(more).toBeDisabled()
    // The fixture bearer's profile id resolves asynchronously, so the page read starts a
    // microtask after the click.
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        owner: FIXTURE_PROFILE_ID,
        sort: 'created_desc',
        includeToday: true,
        source: undefined,
        limit: 50,
        offset: 50,
        signal: expect.any(AbortSignal) as unknown,
      })
    )
    expect(capsules).toHaveBeenCalledTimes(1)

    await act(async () => {
      next.resolve(
        page(
          [
            look('sl-50', 'Look 50', { createdAt: ago(50) }),
            look('sl-51', 'Look 51', { createdAt: ago(51) }),
            look('sl-52', 'Look 52', { createdAt: ago(52) }),
          ],
          52,
          50
        )
      )
      await next.promise
    })

    // A look the first page already holds shows once.
    expect(screen.getAllByTestId('saved-look-card-sl-50')).toHaveLength(1)
    const ids = tileIds()
    expect(ids.slice(-3)).toEqual([
      'saved-look-card-sl-51',
      'saved-look-card-sl-52',
      'looks-capsule-card-cap-old',
    ])
    expect(new Set(ids).size).toBe(ids.length)
    expect(screen.queryByTestId('saved-looks-load-more')).toBeNull()
  })

  it('7.12-UNIT-021c Load more reads capsules when the capsules list limits the view', async () => {
    signInFixtureMember()
    list.mockResolvedValue(page([look('sl-old', 'Old look', { createdAt: ago(500) })]))
    const capsuleFirst = Array.from({ length: 50 }, (_, index) =>
      capsule(`cap-${index + 1}`, `Capsule ${index + 1}`, { createdAt: ago(index + 1) })
    )
    capsules.mockResolvedValueOnce(capsulePage(capsuleFirst, 51))
    capsules.mockResolvedValueOnce(
      capsulePage([capsule('cap-51', 'Capsule 51', { createdAt: ago(51) })], 51, 50)
    )

    render(<LooksPage />)

    fireEvent.click(await screen.findByTestId('saved-looks-load-more'))

    await screen.findByTestId('looks-capsule-card-cap-51')
    expect(capsules).toHaveBeenLastCalledWith(
      'member-1',
      { sort: 'created_desc', limit: 50, offset: 50 },
      expect.any(AbortSignal)
    )
    expect(list).toHaveBeenCalledTimes(1)
    expect(tileIds().slice(-2)).toEqual([
      'looks-capsule-card-cap-51',
      'saved-look-card-sl-old',
    ])
  })

  it('7.12-UNIT-021d a failed Load more keeps the loaded tiles and offers Load more again', async () => {
    signInFixtureMember()
    list.mockResolvedValueOnce(page(FIRST_PAGE, 51))
    list.mockRejectedValueOnce(new Error('offline'))

    render(<LooksPage />)

    fireEvent.click(await screen.findByTestId('saved-looks-load-more'))

    await waitFor(() => expect(screen.getByTestId('saved-looks-load-more')).toBeEnabled())
    expect(list).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('saved-look-card-sl-1')).toBeVisible()
    expect(screen.getByTestId('saved-look-card-sl-50')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it("7.12-UNIT-021e a saved-looks change for this member reads again; another member's change does not", async () => {
    signInFixtureMember()
    list.mockResolvedValueOnce(
      page([look('sl-1', 'Rainy commute', { createdAt: ago(2) })])
    )
    list.mockResolvedValueOnce(
      page([
        look('sl-3', 'Weekend market', { createdAt: ago(1) }),
        look('sl-1', 'Rainy commute', { createdAt: ago(2) }),
      ])
    )

    render(<LooksPage />)
    await screen.findByTestId('saved-look-card-sl-1')

    act(() => notifySavedLooksChanged('someone-else'))
    expect(list).toHaveBeenCalledTimes(1)

    act(() => notifySavedLooksChanged(FIXTURE_OWNER))

    expect(await screen.findByTestId('saved-look-card-sl-3')).toBeVisible()
    expect(tileIds()).toEqual(['saved-look-card-sl-3', 'saved-look-card-sl-1'])
    expect(list).toHaveBeenCalledTimes(2)
  })
})

/**
 * Records every removal of a watched node, or of an ancestor that takes it along, from the moment
 * it is called. A node that leaves and comes back between two assertions still counts, which a
 * check of the final DOM would miss.
 */
function watchRemovals(watched: readonly HTMLElement[]) {
  const removed: string[] = []
  const record = (records: MutationRecord[]) => {
    for (const mutation of records)
      for (const node of Array.from(mutation.removedNodes))
        for (const element of watched)
          if (node === element || node.contains(element))
            removed.push(element.getAttribute('data-testid') ?? element.tagName)
  }
  const observer = new MutationObserver(record)
  observer.observe(document.body, { childList: true, subtree: true })
  return {
    /** Stops watching and returns what was removed, the records still queued included. */
    stop() {
      record(observer.takeRecords())
      observer.disconnect()
      return removed
    },
  }
}

// TEA W2: a saved-looks change notice (a save, an Undo, a device import) reads the same filter
// again. That refresh can fail; the tiles already on screen stay, and only a first read that
// fails shows the error line with Retry.
describe('7.12 Looks failed refresh (TEA W2)', () => {
  it('7.12-UNIT-021f a refresh that fails after a change notice keeps both tiles on screen through the refresh, with no error line or Retry', async () => {
    signInFixtureMember()
    list.mockResolvedValueOnce(
      page([
        look('sl-2', 'Weekend market', { createdAt: ago(1) }),
        look('sl-1', 'Rainy commute', { createdAt: ago(2) }),
      ])
    )
    const refresh = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(refresh.promise)
    moveAddress('/looks?segment=saved')

    render(<LooksPage />)
    const newer = await screen.findByTestId('saved-look-card-sl-2')
    const older = screen.getByTestId('saved-look-card-sl-1')
    const grid = screen.getByTestId('looks-saved-grid')
    const watch = watchRemovals([grid, newer, older])

    act(() => notifySavedLooksChanged(FIXTURE_OWNER))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    // While the refresh is out the tiles stay.
    expect(screen.getByTestId('looks-saved-grid')).toBe(grid)
    await act(async () => {
      refresh.reject(
        new SavedLookRequestError('Saved looks request failed with status 500', 500)
      )
      await refresh.promise.catch(() => undefined)
    })

    expect(watch.stop()).toEqual([])
    expect(screen.getByTestId('looks-saved-grid')).toBe(grid)
    expect(screen.getByTestId('saved-look-card-sl-2')).toBe(newer)
    expect(screen.getByTestId('saved-look-card-sl-1')).toBe(older)
    expect(tileIds()).toEqual(['saved-look-card-sl-2', 'saved-look-card-sl-1'])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('saved-looks-retry')).toBeNull()
    expect(screen.queryByText('Could not load your saved looks.')).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('7.12-UNIT-021g control: the same failure on the first read shows the error line with Retry and no grid', async () => {
    signInFixtureMember()
    list.mockRejectedValueOnce(
      new SavedLookRequestError('Saved looks request failed with status 500', 500)
    )
    moveAddress('/looks?segment=saved')

    render(<LooksPage />)

    const retry = await screen.findByTestId('saved-looks-retry')
    const first = screen.getByTestId('looks-first-content')
    expect(first).toHaveAttribute('role', 'alert')
    expect(first).toHaveTextContent('Could not load your saved looks.')
    expect(first).toContainElement(retry)
    expect(screen.queryByTestId('looks-saved-grid')).toBeNull()
    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe('7.12 Looks snapshot and member switch (CC-7.7 D5, P9)', () => {
  it('7.12-UNIT-022a a return to Looks opens on its last tiles in the first frame while the reads refresh', async () => {
    signInFixtureMember()
    list.mockResolvedValueOnce(page([look('sl-1', 'Rainy commute')]))
    capsules.mockResolvedValueOnce(
      capsulePage([capsule('cap-1', 'Weekday', { createdAt: ago(9) })])
    )
    moveAddress('/looks?segment=saved')
    const { unmount } = render(<LooksPage />)
    await screen.findByTestId('saved-look-card-sl-1')
    unmount()

    const refresh = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(refresh.promise)
    render(<LooksPage />)

    // The snapshot holds both sources and answers before the refresh does.
    const first = screen.getByTestId('looks-first-content')
    expect(first).toContainElement(screen.getByTestId('saved-look-card-sl-1'))
    expect(first).toContainElement(screen.getByTestId('looks-capsule-card-cap-1'))

    await act(async () => {
      refresh.resolve(page([look('sl-4', 'Sunday brunch')]))
      await refresh.promise
    })
    await waitFor(() => expect(screen.getByTestId('saved-look-card-sl-4')).toBeVisible())
    expect(screen.queryByTestId('saved-look-card-sl-1')).toBeNull()
  })

  it('[Codex 7.11 #12] 7.12-UNIT-022b a same-member return keeps every loaded page, and the refresh reads both pages back', async () => {
    signInFixtureMember()
    list.mockResolvedValueOnce(page(FIRST_PAGE, 51))
    list.mockResolvedValueOnce(
      page([look('sl-51', 'Late look', { createdAt: ago(51) })], 51, 50)
    )
    moveAddress('/looks?segment=saved')
    const { unmount } = render(<LooksPage />)
    fireEvent.click(await screen.findByTestId('saved-looks-load-more'))
    await screen.findByTestId('saved-look-card-sl-51')
    expect(screen.queryByTestId('saved-looks-load-more')).toBeNull()
    unmount()

    const refreshFirst = deferred<SavedLookPageResult>()
    const refreshSecond = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(refreshFirst.promise)
    list.mockReturnValueOnce(refreshSecond.promise)
    render(<LooksPage />)

    const first = screen.getByTestId('looks-first-content')
    expect(first).toContainElement(screen.getByTestId('saved-look-card-sl-1'))
    expect(first).toContainElement(screen.getByTestId('saved-look-card-sl-51'))
    // The refresh is sent once the profile id for the fixture bearer has answered.
    await waitFor(() =>
      expect(list).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ owner: FIXTURE_PROFILE_ID, limit: 50, offset: 0 })
      )
    )

    await act(async () => {
      refreshFirst.resolve(page(FIRST_PAGE, 51))
      await refreshFirst.promise
    })
    // Page one alone never replaces the tiles: the second page stays while it is read again.
    expect(screen.getByTestId('saved-look-card-sl-51')).toBeVisible()
    await waitFor(() => expect(list).toHaveBeenCalledTimes(4))
    expect(list).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ owner: FIXTURE_PROFILE_ID, limit: 50, offset: 50 })
    )

    await act(async () => {
      refreshSecond.resolve(
        page([look('sl-51', 'Late look, renamed', { createdAt: ago(51) })], 51, 50)
      )
      await refreshSecond.promise
    })
    await waitFor(() =>
      expect(screen.getByTestId('saved-look-card-sl-51')).toHaveTextContent(
        'Late look, renamed'
      )
    )
    expect(screen.getByTestId('saved-look-card-sl-1')).toBeVisible()
    expect(screen.queryByTestId('saved-looks-load-more')).toBeNull()
  })

  it('7.12-UNIT-022c P9: after a member switch the first paint shows no tile of the previous member', async () => {
    signInFixtureMember('test-token-first')
    list.mockResolvedValueOnce(page([look('sl-a', 'Member A look')]))
    capsules.mockResolvedValueOnce(capsulePage([capsule('cap-a', 'Member A capsule')]))
    moveAddress('/looks?segment=saved')
    const { unmount } = render(<LooksPage />)
    await screen.findByTestId('saved-look-card-sl-a')
    unmount()

    // The same fixture owner under another bearer is another session scope.
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-second')
    const looksB = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(looksB.promise)
    capsules.mockResolvedValueOnce(capsulePage([]))
    render(<LooksPage />)

    expect(screen.queryByTestId('saved-look-card-sl-a')).toBeNull()
    expect(screen.queryByTestId('looks-capsule-card-cap-a')).toBeNull()

    await act(async () => {
      looksB.resolve(page([look('sl-b', 'Member B look')]))
      await looksB.promise
    })
    expect(await screen.findByTestId('saved-look-card-sl-b')).toBeVisible()
    expect(screen.queryByTestId('saved-look-card-sl-a')).toBeNull()
    expect(screen.queryByTestId('looks-capsule-card-cap-a')).toBeNull()
  })

  it('7.12-UNIT-022d drops an answer from a session the tab no longer holds: a new bearer reads again, a sign-out drops it', async () => {
    // Codex round 3 #3: each fixture bearer resolves its own profile, as the server answers it.
    const FIRST_PROFILE_ID = 'profile-first'
    const SECOND_PROFILE_ID = 'profile-second'
    userId.mockImplementation(() =>
      Promise.resolve(
        window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY) ===
          'test-token-second'
          ? SECOND_PROFILE_ID
          : FIRST_PROFILE_ID
      )
    )
    signInFixtureMember('test-token-first')
    const stale = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(stale.promise)
    list.mockResolvedValueOnce(page([look('sl-2', 'Gallery night')]))
    moveAddress('/looks?segment=saved')

    render(<LooksPage />)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))

    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-second')
    await act(async () => {
      stale.resolve(page([look('sl-1', 'Rainy commute')]))
      await stale.promise
    })

    expect(await screen.findByTestId('saved-look-card-sl-2')).toBeVisible()
    expect(screen.queryByTestId('saved-look-card-sl-1')).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ owner: FIRST_PROFILE_ID, offset: 0 })
    )
    // The retry is made for the second bearer's own profile, and so is the legacy device import
    // the read starts for that owner (lib/saved-looks.ts), never the first bearer's.
    expect(list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ owner: SECOND_PROFILE_ID, offset: 0 })
    )
    expect(list.mock.calls[1]?.[0]).not.toHaveProperty('skipLegacyImport', true)
    expect(capsules.mock.calls.map((call) => call[0] as string)).toEqual([
      FIRST_PROFILE_ID,
      SECOND_PROFILE_ID,
    ])
    // A change notice for the first bearer's profile reads nothing for the second.
    act(() => notifySavedLooksChanged(FIRST_PROFILE_ID))
    // One task yield lets any read that notice started reach the list call.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
    expect(list).toHaveBeenCalledTimes(2)

    // A read still out when the member signs out never lands on the signed-out tab.
    const late = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(late.promise)
    act(() => notifySavedLooksChanged(FIXTURE_OWNER))
    // The read starts once the cached profile id resolves, a microtask later.
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3))
    expect(list).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ owner: SECOND_PROFILE_ID, offset: 0 })
    )
    act(() => {
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
      window.dispatchEvent(new Event('couture:session'))
    })
    await act(async () => {
      late.reject(new Error('aborted'))
      await late.promise.catch(() => undefined)
    })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('saved-look-card-sl-2')).toBeNull()
  })

  // TEA round 4 #2 (expected red until profileId drops a lookup that answers after the bearer
  // changed): the first bearer's profile lookup is held across the switch to the second bearer.
  // Its late answer must never reach the saved looks read, which starts the legacy device import
  // for its owner (lib/saved-looks.ts listSavedLooksPageFromWeb, then
  // ensureWebLegacySavedLooksMigration), nor the change notice owner.
  it('7.12-UNIT-022e a profile lookup that answers after a bearer switch reads and imports nothing for the first bearer', async () => {
    const FIRST_PROFILE_ID = 'profile-first'
    const SECOND_PROFILE_ID = 'profile-second'
    const bearer = () => window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    const firstLookup = deferred<string>()
    userId.mockImplementation(() =>
      bearer() === 'test-token-second'
        ? Promise.resolve(SECOND_PROFILE_ID)
        : firstLookup.promise
    )
    // The import boundary: each saved looks read, with the bearer the tab held when it was made.
    const looksReads: {
      owner: unknown
      bearer: string | null
      offset: unknown
      skipLegacyImport: unknown
    }[] = []
    list.mockImplementation(
      (options: { owner?: string; offset?: number; skipLegacyImport?: boolean }) => {
        looksReads.push({
          owner: options.owner,
          bearer: bearer(),
          offset: options.offset,
          skipLegacyImport: options.skipLegacyImport,
        })
        return Promise.resolve(page([look('sl-2', 'Gallery night')]))
      }
    )
    const capsuleReads: { owner: unknown; bearer: string | null }[] = []
    capsules.mockImplementation((owner: string) => {
      capsuleReads.push({ owner, bearer: bearer() })
      return Promise.resolve(capsulePage([]))
    })
    signInFixtureMember('test-token-first')
    moveAddress('/looks?segment=saved')

    render(<LooksPage />)
    // The first bearer's profile lookup is out, and nothing is read before it answers.
    await waitFor(() => expect(userId).toHaveBeenCalled())
    expect(looksReads).toEqual([])
    expect(capsuleReads).toEqual([])

    // The bearer changes while that lookup is held; the shared fixture owner stays the same.
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-second')
    await act(async () => {
      firstLookup.resolve(FIRST_PROFILE_ID)
      await firstLookup.promise
    })
    // A notice for the first profile, sent as its late answer lands, finds no owner ref holding
    // that id: had the ref taken it, this would start another read.
    act(() => notifySavedLooksChanged(FIRST_PROFILE_ID))

    // The stale answer starts a fresh attempt for the second bearer, with no error line.
    expect(await screen.findByTestId('saved-look-card-sl-2')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      looksReads.filter((read) => read.owner === FIRST_PROFILE_ID),
      'no saved looks read (and so no legacy import) for the first profile'
    ).toEqual([])
    expect(
      capsuleReads.filter((read) => read.owner === FIRST_PROFILE_ID),
      'no capsule read for the first profile'
    ).toEqual([])
    // Every read, the import-starting one included, pairs the second profile with its bearer.
    expect(looksReads.length).toBeGreaterThan(0)
    for (const read of looksReads) {
      expect(read).toMatchObject({
        owner: SECOND_PROFILE_ID,
        bearer: 'test-token-second',
      })
    }
    expect(looksReads[0]).toMatchObject({ offset: 0 })
    expect(looksReads[0]?.skipLegacyImport).not.toBe(true)
    expect(capsuleReads.length).toBeGreaterThan(0)
    for (const read of capsuleReads) {
      expect(read).toEqual({ owner: SECOND_PROFILE_ID, bearer: 'test-token-second' })
    }

    // Settled: the owner ref holds the second profile, never the first.
    const readsBefore = looksReads.length
    act(() => notifySavedLooksChanged(FIRST_PROFILE_ID))
    // One task yield lets any read that notice started reach the list call.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
    expect(looksReads).toHaveLength(readsBefore)
    act(() => notifySavedLooksChanged(SECOND_PROFILE_ID))
    await waitFor(() => expect(looksReads.length).toBeGreaterThan(readsBefore))
    expect(looksReads.at(-1)).toMatchObject({
      owner: SECOND_PROFILE_ID,
      bearer: 'test-token-second',
    })
  })
})

describe('7.12 Looks Plan segment (D10, D11)', () => {
  it('7.12-UNIT-050d (was 7.11-CMP-PLAN-01) Plan renders the rail as page content without its own heading row or X', () => {
    moveAddress('/looks?segment=plan')
    render(<LooksPage />)

    expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent('Looks')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const rail = screen.getByRole('complementary', { name: 'Planner Rail' })
    expect(screen.getByTestId('looks-first-content')).toContainElement(rail)
    expect(screen.getByRole('tabpanel')).toContainElement(rail)
    expect(rail).not.toHaveClass('fixed')
    expect(within(rail).queryByText('7-Day Outfit Planner')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close planner' })).toBeNull()
  })

  it('7.12-UNIT-050e (was 7.11-CMP-PLAN-02) signed out, Plan shows the free preview with Upgrade to sign-in and sends no request', () => {
    const requested = vi.fn()
    useMswHandlers(
      http.get(PLANNER_PATH, () => {
        requested()
        return HttpResponse.json({}, { status: 500 })
      })
    )
    moveAddress('/looks?segment=plan')
    render(<LooksPage />)

    expect(screen.getByTestId('plan-free-preview')).toHaveTextContent(
      'With Premium, you can plan what to wear all week.'
    )
    const upgrades = screen.getAllByTestId('plan-upgrade')
    expect(upgrades).toHaveLength(1)
    expect(upgrades[0]).toHaveAttribute('href', '/signin')
    expect(screen.queryByTestId('planner-rail-locked')).toBeNull()
    expect(screen.queryByTestId('planner-rail-get-premium')).toBeNull()
    expect(requested).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })

  it("7.12-UNIT-050f (was 7.11-CMP-PLAN-04) a member without Premium gets the free preview with Upgrade to Profile's Premium", async () => {
    signInFixtureMember()
    list.mockResolvedValue(page([]))
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(
          { statusCode: 403, message: PREMIUM_REQUIRED_MESSAGE, error: 'Forbidden' },
          { status: 403 }
        )
      )
    )
    moveAddress('/looks?segment=plan')
    render(<LooksPage />)

    expect(await screen.findByTestId('plan-free-preview')).toBeVisible()
    expect(screen.getAllByTestId('plan-upgrade')).toHaveLength(1)
    expect(screen.getByTestId('plan-upgrade')).toHaveAttribute(
      'href',
      '/settings/premium'
    )
    expect(screen.queryByTestId('planner-rail-locked')).toBeNull()
  })

  // Codex 7.11 #1: the query is dropped through the router, so the router's URL agrees with the
  // address bar and the replace keeps the entry's place in the in-app history.
  it('7.12-UNIT-060c (was 7.11-CMP-PLAN-05) drops the passed-through planner query with one router replace', async () => {
    moveAddress('/looks?segment=plan&planner=1&from=home')
    const depth = window.history.length
    const replaceState = vi.spyOn(window.history, 'replaceState')

    render(<LooksPage />)

    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1))
    expect(router.replace).toHaveBeenCalledWith('/looks?segment=plan&from=home', {
      scroll: false,
    })
    // Only the test router's own move touched the history.
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(window.history.length).toBe(depth)
    expect(router.push).not.toHaveBeenCalled()
    expect(screen.getByTestId('looks-segment-plan')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    replaceState.mockRestore()
  })

  it('7.12-UNIT-060d (was 7.11-CMP-PLAN-06) leaves an address without the planner query untouched', () => {
    moveAddress('/looks?segment=plan&from=home')

    render(<LooksPage />)

    expect(window.location.search).toBe('?segment=plan&from=home')
    expect(router.replace).not.toHaveBeenCalled()
  })
})

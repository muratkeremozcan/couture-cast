// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-LOOKS-01 to 7.11-CMP-LOOKS-11 (D8, P5 and the builder
// and TEA test contract: the empty line, the row order, the saved-looks-only gate; Codex 7.11
// #12: a return keeps every loaded page).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedLookContract } from '@couture/api-client/contracts/http'
import type * as SavedLooksModule from '../../lib/saved-looks'
import { notifySavedLooksChanged, type SavedLookPageResult } from '../../lib/saved-looks'
import { screenSnapshot } from '../../lib/screen-snapshot'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { signInFixtureMember } from '../../test-utils/member-session'
import LooksPage from './page'

const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  prefetch: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/looks',
  useRouter: () => router,
}))
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

// Only the page read is stubbed, so each test decides when and how it answers; the change
// notification and everything the saved looks row uses stay real.
const list = vi.hoisted(() => vi.fn())
vi.mock('../../lib/saved-looks', async (importOriginal) => ({
  ...(await importOriginal<typeof SavedLooksModule>()),
  listSavedLooksPageFromWeb: list,
}))

/** The owner every e2e fixture bearer reads as (lib/use-web-session.ts). */
const FIXTURE_OWNER = 'bearer'

function look(id: string, title: string): SavedLookContract {
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
    createdAt: '2026-11-22T01:00:00.000Z',
    updatedAt: '2026-11-22T01:00:00.000Z',
  }
}

function page(looks: SavedLookContract[], total = looks.length, offset = 0) {
  return { data: looks, total, limit: 50, offset } satisfies SavedLookPageResult
}

/**
 * A full first page: the server returns `limit` looks whenever more exist, and the Looks read
 * keeps paging until it holds a page or the total (review #12), so a short first page with a
 * larger total would be read on at once.
 */
const FIRST_PAGE = Array.from({ length: 50 }, (_, index) =>
  look(`sl-${index + 1}`, `Look ${index + 1}`)
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

beforeEach(() => {
  list.mockReset()
})

afterEach(() => {
  window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
  screenSnapshot.clear()
})

describe('7.11 Looks tab (D8)', () => {
  it('7.11-CMP-LOOKS-01 titles the tab Looks with no back, and signed out opens at once on the empty line, then Capsules, then Plan', () => {
    render(<LooksPage />)

    expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent('Looks')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Looks')
    expect(screen.queryByTestId('app-top-bar-back')).toBeNull()
    expect(screen.getByTestId('bottom-nav-looks')).toHaveAttribute('aria-current', 'page')

    const first = screen.getByTestId('looks-first-content')
    expect(first).toHaveTextContent('Save a look to see it here')
    const capsules = screen.getByTestId('looks-capsules-row')
    const plan = screen.getByTestId('looks-plan-row')
    expect(capsules).toHaveAttribute('href', '/wardrobe/capsules')
    expect(capsules).toHaveTextContent('Capsules')
    expect(plan).toHaveAttribute('href', '/looks/plan')
    expect(plan).toHaveTextContent('Plan')
    expectInOrder(first, capsules, plan)
    // Signed out nothing is read, so the gate has nothing to wait for.
    expect(list).not.toHaveBeenCalled()
    expect(screen.queryByTestId('closet-saved-looks-row')).toBeNull()
  })

  it('7.11-CMP-LOOKS-02 a member with saved looks opens on the expanded saved looks list as the first content', async () => {
    signInFixtureMember()
    list.mockResolvedValue(
      page([look('sl-1', 'Rainy commute'), look('sl-2', 'Gallery night')])
    )

    render(<LooksPage />)

    const card = await screen.findByTestId('saved-look-card-sl-1')
    const first = screen.getByTestId('looks-first-content')
    expect(first).toContainElement(card)
    expect(first).toContainElement(screen.getByTestId('saved-look-card-sl-2'))
    expect(within(first).getByTestId('closet-saved-looks-row')).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(within(first).getByTestId('closet-saved-looks-row')).toHaveTextContent(
      '2 saved'
    )
    expect(screen.queryByText('Save a look to see it here')).toBeNull()
    expectInOrder(
      first,
      screen.getByTestId('looks-capsules-row'),
      screen.getByTestId('looks-plan-row')
    )
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ owner: FIXTURE_OWNER, limit: 50, offset: 0 })
    )
    // Every Looks list fits one page here, so there is nothing more to load.
    expect(screen.queryByTestId('saved-looks-load-more')).toBeNull()
  })

  it('7.11-CMP-LOOKS-03 a member with no saved looks gets the one empty line and both rows', async () => {
    signInFixtureMember()
    list.mockResolvedValue(page([]))

    render(<LooksPage />)

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    expect(await screen.findByTestId('looks-first-content')).toHaveTextContent(
      'Save a look to see it here'
    )
    expect(screen.queryByTestId('closet-saved-looks-row')).toBeNull()
    expect(screen.getByTestId('looks-capsules-row')).toBeVisible()
    expect(screen.getByTestId('looks-plan-row')).toBeVisible()
  })

  it('7.11-CMP-LOOKS-04 a failed read shows the alert in the first content, and Retry reads again', async () => {
    signInFixtureMember()
    list.mockRejectedValueOnce(new Error('offline'))
    list.mockResolvedValueOnce(page([look('sl-1', 'Rainy commute')]))

    render(<LooksPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load your saved looks.')
    expect(screen.getByTestId('looks-first-content')).toContainElement(alert)
    expect(screen.queryByText('Save a look to see it here')).toBeNull()

    fireEvent.click(screen.getByTestId('saved-looks-retry'))

    expect(await screen.findByTestId('saved-look-card-sl-1')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('7.11-CMP-LOOKS-05 a read that rejects with a non-Error still lands as the load failure', async () => {
    signInFixtureMember()
    list.mockRejectedValueOnce('socket closed')

    render(<LooksPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load your saved looks.'
    )
  })

  it('7.11-CMP-LOOKS-06 load more appends the next page once, skipping a look the first page already holds', async () => {
    signInFixtureMember()
    list.mockResolvedValueOnce(page(FIRST_PAGE, 52))
    const next = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(next.promise)

    render(<LooksPage />)

    const more = await screen.findByTestId('saved-looks-load-more')
    expect(list).toHaveBeenCalledTimes(1)
    fireEvent.click(more)
    expect(more).toBeDisabled()
    // Review #12: the next page is read for this member and can be cancelled.
    expect(list).toHaveBeenLastCalledWith({
      owner: FIXTURE_OWNER,
      limit: 50,
      offset: 50,
      signal: expect.any(AbortSignal) as unknown,
    })

    await act(async () => {
      next.resolve(
        page([look('sl-50', 'Look 50'), look('sl-51', 'Gallery night')], 52, 50)
      )
      await next.promise
    })

    expect(screen.getAllByTestId('saved-look-card-sl-50')).toHaveLength(1)
    expect(screen.getByTestId('saved-look-card-sl-51')).toBeVisible()
    // 51 of 52 loaded, so the next page is still offered.
    expect(screen.getByTestId('saved-looks-load-more')).toBeEnabled()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('7.11-CMP-LOOKS-07 a failed load more keeps the loaded looks and offers load more again', async () => {
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

  it("7.11-CMP-LOOKS-08 a saved-looks change for this member reads again; another member's change does not", async () => {
    signInFixtureMember()
    list.mockResolvedValueOnce(page([look('sl-1', 'Rainy commute')]))
    list.mockResolvedValueOnce(
      page([look('sl-3', 'Weekend market'), look('sl-1', 'Rainy commute')])
    )

    render(<LooksPage />)
    await screen.findByTestId('saved-look-card-sl-1')

    act(() => notifySavedLooksChanged('someone-else'))
    expect(list).toHaveBeenCalledTimes(1)

    act(() => notifySavedLooksChanged(FIXTURE_OWNER))

    expect(await screen.findByTestId('saved-look-card-sl-3')).toBeVisible()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('7.11-CMP-LOOKS-09 a return to Looks opens on its last list in the first frame while the read refreshes', async () => {
    signInFixtureMember()
    list.mockResolvedValueOnce(page([look('sl-1', 'Rainy commute')]))
    const { unmount } = render(<LooksPage />)
    await screen.findByTestId('saved-look-card-sl-1')
    unmount()

    const refresh = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(refresh.promise)
    render(<LooksPage />)

    // The snapshot answers before the refresh does.
    expect(screen.getByTestId('looks-first-content')).toContainElement(
      screen.getByTestId('saved-look-card-sl-1')
    )
    expect(screen.queryByText('Save a look to see it here')).toBeNull()

    await act(async () => {
      refresh.resolve(page([look('sl-4', 'Sunday brunch')]))
      await refresh.promise
    })
    expect(screen.getByTestId('saved-look-card-sl-4')).toBeVisible()
    expect(screen.queryByTestId('saved-look-card-sl-1')).toBeNull()
  })

  // Review #12: a return restores the list its scroll position was in, so every page the member
  // loaded comes back in the first frame and the refresh reads them all back.
  it('[Codex 7.11 #12] 7.11-CMP-LOOKS-11 a same-member return keeps every loaded page, and the refresh reads both pages back', async () => {
    signInFixtureMember()
    list.mockResolvedValueOnce(page(FIRST_PAGE, 51))
    list.mockResolvedValueOnce(page([look('sl-51', 'Late look')], 51, 50))
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

    // The first frame holds both pages from the snapshot.
    const first = screen.getByTestId('looks-first-content')
    expect(first).toContainElement(screen.getByTestId('saved-look-card-sl-1'))
    expect(first).toContainElement(screen.getByTestId('saved-look-card-sl-51'))
    expect(list).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ owner: FIXTURE_OWNER, limit: 50, offset: 0 })
    )

    await act(async () => {
      refreshFirst.resolve(page(FIRST_PAGE, 51))
      await refreshFirst.promise
    })
    // Page one alone never replaces the list: the second page stays while it is read again.
    expect(screen.getByTestId('saved-look-card-sl-51')).toBeVisible()
    await waitFor(() => expect(list).toHaveBeenCalledTimes(4))
    expect(list).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ owner: FIXTURE_OWNER, limit: 50, offset: 50 })
    )

    await act(async () => {
      refreshSecond.resolve(page([look('sl-51', 'Late look, renamed')], 51, 50))
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

  it('7.11-CMP-LOOKS-10 drops an answer from a session the tab no longer holds: a new bearer reads again, a sign-out drops it', async () => {
    signInFixtureMember('test-token-first')
    const stale = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(stale.promise)
    list.mockResolvedValueOnce(page([look('sl-2', 'Gallery night')]))

    render(<LooksPage />)
    expect(list).toHaveBeenCalledTimes(1)

    // The same fixture owner under another bearer is another session scope (Codex review P2-1).
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-second')
    await act(async () => {
      stale.resolve(page([look('sl-1', 'Rainy commute')]))
      await stale.promise
    })

    expect(await screen.findByTestId('saved-look-card-sl-2')).toBeVisible()
    expect(screen.queryByTestId('saved-look-card-sl-1')).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)

    // A read still out when the member signs out never lands on the signed-out tab.
    const late = deferred<SavedLookPageResult>()
    list.mockReturnValueOnce(late.promise)
    act(() => notifySavedLooksChanged(FIXTURE_OWNER))
    expect(list).toHaveBeenCalledTimes(3)
    act(() => {
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
      window.dispatchEvent(new Event('couture:session'))
    })
    await act(async () => {
      late.reject(new Error('aborted'))
      await late.promise.catch(() => undefined)
    })

    expect(screen.getByTestId('looks-first-content')).toHaveTextContent(
      'Save a look to see it here'
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('saved-look-card-sl-2')).toBeNull()
  })
})

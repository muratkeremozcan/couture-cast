// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): router stub for the history-aware top bar back (D11)
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
// Story 7.6 test plan 7.6-CMP-002..011: garment delete from the Closet detail. An unused piece
// hides with "Deleted" and Undo and is sent when the window ends; a piece in use asks once and is
// sent at once; a failed send returns the piece with Retry; the grid keeps its scroll and focus
// moves to the next card. The deferred deletion controller runs on an injected manual timer
// (spec D10), so no test waits on real time.
// Learning path Step 64: Garment delete.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useSyncExternalStore } from 'react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screenSnapshot } from '../../lib/screen-snapshot'
import type { GarmentWithColor } from '@couture/api-client/contracts/http'
import {
  createCompletedOnboardingStateFixture,
  createReadyGarmentFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'
import {
  createDeferredGarmentDeletion,
  SAVE_FEEDBACK_TIMINGS,
  type DeferredGarmentDeletionTimer,
} from '@couture/utils'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import type * as WebSession from '../../lib/web-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { createSavedLooksMswHandlers } from '../../test-utils/saved-looks-msw'
import { SaveFeedbackProvider, useStatusBar } from '../components/save-feedback'
import {
  injectWardrobeGarmentDeletionClockForTests,
  injectWardrobeGarmentDeletionForTests,
} from './garment-deletion'
import WardrobePage from './page'

const session = vi.hoisted(() => ({ owner: null as string | null }))
vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.owner,
}))

// Story CC-7.11 D11: the top bar back reads the router.
const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
  forward: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/wardrobe',
  useSearchParams: () => useMockSearchParams(),
}))

/** A useSearchParams stand-in that re-renders on pushState, replaceState and popstate. */
function useMockSearchParams() {
  const search = useSyncExternalStore(
    (onChange) => {
      window.addEventListener('popstate', onChange)
      window.addEventListener('test:history', onChange)
      return () => {
        window.removeEventListener('popstate', onChange)
        window.removeEventListener('test:history', onChange)
      }
    },
    () => window.location.search,
    () => ''
  )
  return new URLSearchParams(search)
}
for (const method of ['pushState', 'replaceState'] as const) {
  const original = window.history[method].bind(window.history)
  window.history[method] = (...args: Parameters<History['pushState']>) => {
    original(...args)
    window.dispatchEvent(new Event('test:history'))
  }
}

const WINDOW_MS = SAVE_FEEDBACK_TIMINGS.statusBarDurationMs
const api = 'http://wardrobe-delete-page.test/api/v1'
const owner = 'closet-member'

/** A manual timer: `advance` runs every callback due by then, in order. */
function createManualTimer() {
  let now = 0
  let next = 1
  const due = new Map<number, { at: number; run: () => void }>()
  const timer: DeferredGarmentDeletionTimer = {
    setTimeout: (run, ms) => {
      const handle = next++
      due.set(handle, { at: now + ms, run })
      return handle
    },
    clearTimeout: (handle) => {
      due.delete(handle as number)
    },
  }
  const advance = async (ms: number) => {
    now += ms
    for (const [handle, entry] of [...due.entries()].sort((a, b) => a[1].at - b[1].at)) {
      if (entry.at > now) continue
      due.delete(handle)
      await act(async () => {
        entry.run()
        await Promise.resolve()
      })
    }
  }
  return { timer, advance }
}

function readyGarment(
  id: string,
  overrides: Partial<GarmentWithColor> = {}
): GarmentWithColor {
  return {
    ...createReadyGarmentFixture({
      id,
      imageAccess: {
        url: `https://photos.example.test/${id}.png`,
        expiresAt: '2090-01-01T00:00:00.000Z',
      },
    }),
    colorFamily: 'blue',
    ...overrides,
  }
}

const blueTop = readyGarment('blue-top')
const blackShoes = readyGarment('black-shoes', {
  category: 'shoes',
  material: 'leather',
  colorFamily: 'black',
})
const plainDress = readyGarment('plain-dress', { category: 'dress', colorFamily: null })
/** Still being tagged: its card has no detail opener, only the upload check. */
const processingPiece = readyGarment('processing-piece', {
  status: 'processing',
  category: null,
  material: null,
  comfortRange: null,
  tagsConfirmedAt: null,
  colorFamily: null,
})

type Usage = { savedLookCount: number; capsuleCount: number }

let closet: GarmentWithColor[]
let usageById: Map<string, Usage | 'missing' | 'route-404' | 'error'>
let deleteRequests: { id: string; keepalive: boolean; authorization: string | null }[]
/** The next DELETE answers these statuses in order; then 204. */
let deleteStatuses: number[]
let savedLookReads: number
/** While set, every DELETE waits for it before answering (an in-flight send). */
let deleteGate: Promise<void> | null
/** While set, every usage read waits for it before answering (a delete check in flight). */
let usageGate: Promise<void> | null
/** While set, every saved looks list read waits for it before answering. */
let savedLooksGate: Promise<void> | null
/** Each tag save the detail sent (CC-7.5 Done and its Undo). */
let tagRequests: { id: string; category: unknown; authorization: string | null }[]
let manual: ReturnType<typeof createManualTimer>

function signIn(member = owner) {
  act(() => {
    session.owner = member
    sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, member)
    window.dispatchEvent(new Event('couture:session'))
  })
}

/** The browser drops or regains its connection, as the status bar and the detail read it. */
function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online })
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'))
  })
}

/**
 * The root layout's status bar with the Closet mounted or not: leaving the Closet keeps the bar,
 * as navigating to another page does.
 */
function RootWithCloset({ closetOpen }: { closetOpen: boolean }) {
  return (
    <SaveFeedbackProvider inline renderOfflineLine={false}>
      <RootBarProbe />
      {closetOpen ? <WardrobePage /> : <p>Another page</p>}
    </SaveFeedbackProvider>
  )
}

/** The root status bar as any other feature on the page holds it (saved looks, styling). */
const rootBar: { current: ReturnType<typeof useStatusBar> | null } = { current: null }
function RootBarProbe() {
  const bar = useStatusBar()
  useEffect(() => {
    rootBar.current = bar
  })
  return null
}

const statusBar = () => screen.findByTestId('status-feedback-bar')
/** What the status bar shows now, empty when no bar is up. Live-region copies are not read. */
const barText = () =>
  screen
    .queryAllByTestId('status-feedback-bar')
    .map((bar) => bar.textContent)
    .join('')

async function openAndDelete(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(await screen.findByTestId(`garment-open-${id}`))
  await screen.findByTestId('garment-detail')
  await user.click(screen.getByTestId('garment-delete'))
}

beforeEach(() => {
  // Story CC-7.7: the Closet keeps a per-member snapshot in module memory, so one test's closet
  // would open the next test's hub for the same member (CI, 61d7156e).
  screenSnapshot.clear()
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', api.slice(0, -'/api/v1'.length))
  window.history.replaceState(null, '', '/wardrobe')
  closet = [blueTop, blackShoes, plainDress]
  usageById = new Map()
  deleteRequests = []
  deleteStatuses = []
  savedLookReads = 0
  deleteGate = null
  usageGate = null
  savedLooksGate = null
  tagRequests = []
  manual = createManualTimer()
  // Every new member session gets its own controller on the manual timer, as production does.
  injectWardrobeGarmentDeletionForTests(() =>
    createDeferredGarmentDeletion({ timer: manual.timer })
  )
  const savedLooks = createSavedLooksMswHandlers([], `${api}/wardrobe/saved-looks`)
  savedLooks.store.onGet = async () => {
    savedLookReads += 1
    if (savedLooksGate) await savedLooksGate
  }
  useMswHandlers(
    http.get(`${api}/wardrobe/garments`, () => HttpResponse.json({ data: closet })),
    http.get(`${api}/wardrobe/garments/:id/usage`, async ({ params }) => {
      if (usageGate) await usageGate
      const id = String(params.id)
      const usage = usageById.get(id) ?? { savedLookCount: 0, capsuleCount: 0 }
      if (usage === 'missing')
        return HttpResponse.json(
          { statusCode: 404, message: 'GARMENT_NOT_FOUND' },
          { status: 404 }
        )
      // A 404 that is not the API's own answer: a deploy without the route.
      if (usage === 'route-404')
        return HttpResponse.json({ message: 'Cannot GET' }, { status: 404 })
      if (usage === 'error')
        return HttpResponse.json({ message: 'Internal server error' }, { status: 500 })
      return HttpResponse.json({ garmentId: id, ...usage })
    }),
    http.delete(`${api}/wardrobe/garments/:id`, async ({ params, request }) => {
      const id = String(params.id)
      deleteRequests.push({
        id,
        keepalive: request.keepalive,
        authorization: request.headers.get('authorization'),
      })
      if (deleteGate) await deleteGate
      const status = deleteStatuses.shift() ?? 204
      if (status !== 204)
        return HttpResponse.json({ message: 'Internal server error' }, { status })
      closet = closet.filter((garment) => garment.id !== id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.patch(`${api}/wardrobe/garments/:id/tags`, async ({ params, request }) => {
      const body = (await request.json()) as Record<string, unknown>
      tagRequests.push({
        id: String(params.id),
        category: body.category,
        authorization: request.headers.get('authorization'),
      })
      delete body.expected
      const current = closet.find((item) => item.id === params.id)!
      const updated = { ...current, ...body } as GarmentWithColor
      closet = closet.map((item) => (item.id === updated.id ? updated : item))
      return HttpResponse.json({ data: updated })
    }),
    ...savedLooks.handlers,
    http.get(`${api}/wardrobe/onboarding`, () =>
      HttpResponse.json({ data: createCompletedOnboardingStateFixture() })
    ),
    http.get(`${api}/user/profile`, () =>
      HttpResponse.json({
        user: {
          id: owner,
          email: 'closet@example.test',
          displayName: null,
          birthdate: null,
          role: 'guardian',
        },
        linkedGuardians: [],
        linkedTeens: [],
      })
    )
  )
})

afterEach(() => {
  cleanup()
  injectWardrobeGarmentDeletionForTests(null)
  injectWardrobeGarmentDeletionClockForTests(null)
  rootBar.current = null
  // A test that went offline put its own onLine on navigator; the jsdom getter comes back.
  Reflect.deleteProperty(window.navigator, 'onLine')
  window.history.replaceState(null, '', '/wardrobe')
  session.owner = null
  sessionStorage.clear()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Closet garment delete', () => {
  it('[P0] [7.6-CMP-002] an unused piece hides at once with Deleted and Undo, and is sent once when the window ends', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')

    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    expect(screen.queryByTestId('garment-delete-confirm')).toBeNull()
    expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    expect(await statusBar()).toHaveTextContent('Deleted')
    expect(screen.getByTestId('status-bar-action-undo')).toBeVisible()

    await manual.advance(WINDOW_MS - 1)
    expect(deleteRequests).toEqual([])

    await manual.advance(1)
    await waitFor(() => expect(deleteRequests).toHaveLength(1))
    // Every closet send carries keepalive, so a window that ends as the tab closes still lands.
    expect(deleteRequests[0]).toEqual({
      id: 'black-shoes',
      keepalive: true,
      authorization: `Bearer ${owner}`,
    })
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toHaveLength(1)
    expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
  })

  it('[P0] [7.6-CMP-003] a piece in use asks once naming its looks; Cancel sends nothing; accept sends at once', async () => {
    const user = userEvent.setup()
    usageById.set('blue-top', { savedLookCount: 2, capsuleCount: 1 })
    usageById.set('plain-dress', { savedLookCount: 0, capsuleCount: 1 })
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'blue-top')
    const confirm = await screen.findByTestId('garment-delete-confirm')
    expect(within(confirm).getByTestId('garment-delete-confirm-count')).toHaveTextContent(
      'Delete this piece? It is in 3 looks.'
    )
    expect(confirm).toHaveAccessibleName('Delete this piece? It is in 3 looks.')
    expect(screen.getByTestId('garment-delete-cancel')).toHaveFocus()

    await user.click(screen.getByTestId('garment-delete-cancel'))
    expect(screen.queryByTestId('garment-delete-confirm')).toBeNull()
    expect(screen.getByTestId('garment-delete')).toHaveFocus()
    expect(screen.getByTestId('garment-detail')).toBeVisible()
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toEqual([])

    await user.click(screen.getByTestId('garment-delete'))
    await user.click(await screen.findByTestId('garment-delete-confirm-accept'))
    // Sent with no window: no timer has to run.
    await waitFor(() =>
      expect(deleteRequests.map((request) => request.id)).toEqual(['blue-top'])
    )
    await waitFor(() => expect(screen.queryByTestId('garment-card-blue-top')).toBeNull())
    expect(await statusBar()).toHaveTextContent('Deleted')
    expect(screen.queryByTestId('status-bar-action-undo')).toBeNull()

    // One look reads in the singular.
    await openAndDelete(user, 'plain-dress')
    expect(await screen.findByTestId('garment-delete-confirm-count')).toHaveTextContent(
      'Delete this piece? It is in 1 look.'
    )
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('garment-delete-confirm')).toBeNull()
    expect(screen.getByTestId('garment-delete')).toHaveFocus()
  })

  it('[P0] [7.6-CMP-004] Undo inside the window sends nothing and returns the piece to its place', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()
    const order = async () =>
      (await screen.findAllByTestId(/^garment-card-/)).map((card) => card.dataset.testid)
    const before = await order()

    await openAndDelete(user, 'black-shoes')
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    await user.click(screen.getByTestId('status-bar-action-undo'))

    expect(await statusBar()).toHaveTextContent('Undone')
    await waitFor(async () => expect(await order()).toEqual(before))
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toEqual([])
  })

  it.each([
    [204, 'Deleted'],
    [500, 'Could not delete this piece.'],
  ] as const)(
    '[P1] [7.6-CMP-004] an Undo while the send is in flight adds nothing; the answer (%i) speaks',
    async (status, outcome) => {
      const user = userEvent.setup()
      let answer: () => void = () => undefined
      deleteGate = new Promise<void>((resolve) => {
        answer = resolve
      })
      deleteStatuses = [status]
      render(<WardrobePage />)
      signIn()

      await openAndDelete(user, 'black-shoes')
      const undo = await screen.findByTestId('status-bar-action-undo')
      await manual.advance(WINDOW_MS)
      await waitFor(() => expect(deleteRequests).toHaveLength(1))
      await user.click(undo)

      // Too late to undo, and nothing new is claimed while the DELETE is still out.
      expect(screen.queryByTestId('status-bar-action-undo')).toBeNull()
      expect(screen.queryByText('Undone')).toBeNull()
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()

      await act(async () => {
        answer()
        await Promise.resolve()
      })
      await waitFor(async () => expect(await statusBar()).toHaveTextContent(outcome))
      expect(screen.queryByTestId('status-bar-action-undo')).toBeNull()
      expect(deleteRequests).toHaveLength(1)
    }
  )

  it('[P1] [7.6-CMP-004] an Undo after the delete landed says Deleted again with no Undo', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()
    await waitFor(() => expect(savedLookReads).toBeGreaterThan(0))
    const readsBefore = savedLookReads

    await openAndDelete(user, 'black-shoes')
    const undo = await screen.findByTestId('status-bar-action-undo')
    await manual.advance(WINDOW_MS)
    // A committed delete reloads saved looks: the send has landed.
    await waitFor(() => expect(savedLookReads).toBeGreaterThan(readsBefore))
    await user.click(undo)

    expect(await statusBar()).toHaveTextContent('Deleted')
    expect(screen.queryByTestId('status-bar-action-undo')).toBeNull()
    expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    expect(deleteRequests).toHaveLength(1)
  })

  /**
   * D3: the usage error and its Retry stay inside the detail, bound to that piece, so they never
   * cover another piece's Undo on the status bar. Delete stays usable beside them.
   */
  it.each([['garment-delete-usage-retry'], ['garment-delete']] as const)(
    '[P1] [7.6-CMP-005] a failed usage read deletes nothing and shows its error in the detail; %s schedules one delete',
    async (control) => {
      const user = userEvent.setup()
      usageById.set('blue-top', 'error')
      render(<WardrobePage />)
      signIn()

      await openAndDelete(user, 'blue-top')

      const failed = await screen.findByTestId('garment-delete-usage-failed')
      expect(failed).toHaveAttribute('role', 'alert')
      expect(failed).toHaveTextContent(
        'Could not check where this piece is used. Try again.'
      )
      expect(within(failed).getByTestId('garment-delete-usage-retry')).toHaveTextContent(
        'Retry'
      )
      // Nothing about the failed read reaches the status bar.
      expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
      expect(screen.getByTestId('garment-detail')).toBeVisible()
      expect(screen.getByTestId('garment-card-blue-top')).toBeInTheDocument()
      // No check or prompt runs now: Delete and Edit tags are both usable.
      expect(screen.getByTestId('garment-delete')).toHaveAttribute(
        'aria-disabled',
        'false'
      )
      expect(screen.getByTestId('garment-edit-tags')).toBeEnabled()

      usageById.delete('blue-top')
      await user.click(screen.getByTestId(control))
      await waitFor(() =>
        expect(screen.queryByTestId('garment-card-blue-top')).toBeNull()
      )
      expect(screen.queryByTestId('garment-delete-usage-failed')).toBeNull()
      expect(await statusBar()).toHaveTextContent('Deleted')
      expect(screen.getByTestId('status-bar-action-undo')).toBeVisible()
      // The failed read sent nothing; the second read schedules the delete in its own window.
      expect(deleteRequests).toEqual([])
      await manual.advance(WINDOW_MS)
      await waitFor(() => expect(deleteRequests).toHaveLength(1))
      expect(deleteRequests[0]).toEqual({
        id: 'blue-top',
        keepalive: true,
        authorization: `Bearer ${owner}`,
      })
    }
  )

  it('[P1] [7.6-CMP-005] the usage error leaves with the detail and does not come back when the piece reopens', async () => {
    const user = userEvent.setup()
    usageById.set('blue-top', 'error')
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'blue-top')
    await screen.findByTestId('garment-delete-usage-failed')

    // CC-7.9 D7: the open detail's back control is the top bar's.
    await user.click(
      within(screen.getByTestId('app-header')).getByTestId('app-top-bar-back')
    )
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    expect(screen.queryByTestId('garment-delete-usage-failed')).toBeNull()

    await user.click(screen.getByTestId('garment-open-blue-top'))
    await screen.findByTestId('garment-detail')
    expect(screen.queryByTestId('garment-delete-usage-failed')).toBeNull()
    expect(screen.getByTestId('garment-delete')).toHaveAttribute('aria-disabled', 'false')
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toEqual([])
  })

  it('[P1] [7.6-CMP-005] the usage error leaves when another piece opens in the detail; that piece deletes on its own', async () => {
    const user = userEvent.setup()
    usageById.set('blue-top', 'error')
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'blue-top')
    await screen.findByTestId('garment-delete-usage-failed')

    // Another piece takes the open detail, as a link or history step to it does.
    act(() => {
      window.history.replaceState(
        { garmentDetail: 'plain-dress' },
        '',
        '/wardrobe?garment=plain-dress'
      )
    })

    await waitFor(() =>
      expect(screen.queryByTestId('garment-delete-usage-failed')).toBeNull()
    )
    expect(screen.getByTestId('garment-detail')).toBeVisible()
    expect(screen.getByTestId('garment-delete')).toHaveAttribute('aria-disabled', 'false')

    // Delete now reads the dress, which is unused: it alone hides in its Undo window.
    await user.click(screen.getByTestId('garment-delete'))
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-plain-dress')).toBeNull()
    )
    expect(screen.getByTestId('garment-card-blue-top')).toBeInTheDocument()
    await manual.advance(WINDOW_MS)
    await waitFor(() => expect(deleteRequests).toHaveLength(1))
    expect(deleteRequests[0]).toEqual({
      id: 'plain-dress',
      keepalive: true,
      authorization: `Bearer ${owner}`,
    })
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toHaveLength(1)
  })

  it('[P1] [7.6-CMP-005] Edit tags is disabled while the delete check runs and while its prompt is open', async () => {
    const user = userEvent.setup()
    let answerUsage: () => void = () => undefined
    usageGate = new Promise<void>((resolve) => {
      answerUsage = resolve
    })
    usageById.set('blue-top', { savedLookCount: 1, capsuleCount: 0 })
    render(<WardrobePage />)
    signIn()

    await user.click(await screen.findByTestId('garment-open-blue-top'))
    await screen.findByTestId('garment-detail')
    expect(screen.getByTestId('garment-edit-tags')).toBeEnabled()

    await user.click(screen.getByTestId('garment-delete'))
    await waitFor(() =>
      expect(screen.getByTestId('garment-delete')).toHaveAttribute('aria-busy', 'true')
    )
    expect(screen.getByTestId('garment-edit-tags')).toBeDisabled()

    await act(async () => {
      answerUsage()
      await Promise.resolve()
    })
    await screen.findByTestId('garment-delete-confirm')
    expect(screen.getByTestId('garment-edit-tags')).toBeDisabled()

    await user.click(screen.getByTestId('garment-delete-cancel'))
    expect(screen.queryByTestId('garment-delete-confirm')).toBeNull()
    expect(screen.getByTestId('garment-edit-tags')).toBeEnabled()
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toEqual([])
  })

  it('[P1] [7.6-CMP-005] a GARMENT_NOT_FOUND usage answer treats the piece as gone and sends one idempotent DELETE at once', async () => {
    const user = userEvent.setup()
    usageById.set('blue-top', 'missing')
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'blue-top')

    // No window: the DELETE leaves without any timer running.
    await waitFor(() =>
      expect(deleteRequests.map((request) => request.id)).toEqual(['blue-top'])
    )
    await waitFor(() => expect(screen.queryByTestId('garment-card-blue-top')).toBeNull())
    expect(await statusBar()).toHaveTextContent('Deleted')
    expect(screen.queryByTestId('status-bar-action-undo')).toBeNull()
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toHaveLength(1)
  })

  it('[P1] [7.6-CMP-005] a route-level 404 is a failed usage read: nothing is deleted and Retry is offered', async () => {
    const user = userEvent.setup()
    usageById.set('blue-top', 'route-404')
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'blue-top')

    const failed = await screen.findByTestId('garment-delete-usage-failed')
    expect(failed).toHaveTextContent(
      'Could not check where this piece is used. Try again.'
    )
    expect(within(failed).getByTestId('garment-delete-usage-retry')).toBeVisible()
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
    expect(screen.getByTestId('garment-card-blue-top')).toBeInTheDocument()
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toEqual([])
  })

  it.each([['pagehide'], ['visibilitychange']] as const)(
    '[P0] [7.6-CMP-006] %s inside the window sends the delete at once with keepalive',
    async (event) => {
      const user = userEvent.setup()
      render(<WardrobePage />)
      signIn()

      await openAndDelete(user, 'black-shoes')
      await waitFor(() =>
        expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
      )
      expect(deleteRequests).toEqual([])

      const visibility = vi
        .spyOn(document, 'visibilityState', 'get')
        .mockReturnValue('hidden')
      await act(async () => {
        if (event === 'pagehide') window.dispatchEvent(new Event('pagehide'))
        else document.dispatchEvent(new Event('visibilitychange'))
        await Promise.resolve()
      })
      visibility.mockRestore()

      await waitFor(() => expect(deleteRequests).toHaveLength(1))
      expect(deleteRequests[0]).toMatchObject({ id: 'black-shoes', keepalive: true })
      await manual.advance(WINDOW_MS * 2)
      expect(deleteRequests).toHaveLength(1)
    }
  )

  it('[P0] [7.6-CMP-006] leaving the Closet inside the window sends the delete', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    unmount()

    await waitFor(() =>
      expect(deleteRequests.map((request) => request.id)).toEqual(['black-shoes'])
    )
  })

  it('[P0] [7.6-CMP-007] a second delete inside the window sends the first at once and keeps its own Undo', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    await openAndDelete(user, 'plain-dress')

    await waitFor(() =>
      expect(deleteRequests.map((request) => request.id)).toEqual(['black-shoes'])
    )
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-plain-dress')).toBeNull()
    )
    // The Undo now belongs to the second piece only.
    await user.click(screen.getByTestId('status-bar-action-undo'))
    expect(await screen.findByTestId('garment-card-plain-dress')).toBeInTheDocument()
    expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests.map((request) => request.id)).toEqual(['black-shoes'])
  })

  it('[P1] [7.6-CMP-007] a confirmed delete sends a delete still in its window first', async () => {
    const user = userEvent.setup()
    usageById.set('blue-top', { savedLookCount: 1, capsuleCount: 0 })
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    await openAndDelete(user, 'blue-top')
    await user.click(await screen.findByTestId('garment-delete-confirm-accept'))

    await waitFor(() =>
      expect(deleteRequests.map((request) => request.id)).toEqual([
        'black-shoes',
        'blue-top',
      ])
    )
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toHaveLength(2)
  })

  it.each([[500], [403]])(
    '[P0] [7.6-CMP-008] a send that fails with %i returns the piece with Retry and never says Deleted',
    async (status) => {
      const user = userEvent.setup()
      deleteStatuses = [status]
      render(<WardrobePage />)
      signIn()

      await openAndDelete(user, 'black-shoes')
      await manual.advance(WINDOW_MS)

      expect(await screen.findByTestId('garment-card-black-shoes')).toBeInTheDocument()
      const bar = await statusBar()
      await waitFor(() => expect(bar).toHaveTextContent('Could not delete this piece.'))
      expect(bar).not.toHaveTextContent('Deleted')
      expect(screen.getByTestId('status-bar-action-retry')).toBeVisible()
    }
  )

  it('[P1] [7.6-CMP-008] a send that fails offline uses the offline tone', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    useMswHandlers(
      http.delete(`${api}/wardrobe/garments/:id`, () => HttpResponse.error())
    )
    await manual.advance(WINDOW_MS)

    const bar = await statusBar()
    await waitFor(() => expect(bar).toHaveTextContent('Could not delete this piece.'))
    expect(bar).toHaveAttribute('data-tone', 'offline')
    expect(await screen.findByTestId('garment-card-black-shoes')).toBeInTheDocument()
  })

  it('[P0] [7.6-CMP-009] Retry sends one delete at once, and a success removes the piece with Deleted', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500]
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await manual.advance(WINDOW_MS)
    await user.click(await screen.findByTestId('status-bar-action-retry'))

    // No second window: the retry leaves without any timer running.
    await waitFor(() => expect(deleteRequests).toHaveLength(2))
    // Retry reads the bearer again and speaks for the member who tapped it.
    expect(deleteRequests[1]).toEqual({
      id: 'black-shoes',
      keepalive: true,
      authorization: `Bearer ${owner}`,
    })
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    expect(await statusBar()).toHaveTextContent('Deleted')
    expect(screen.queryByTestId('status-bar-action-undo')).toBeNull()
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toHaveLength(2)
  })

  /**
   * Codex P1-1: a failed send of the first piece never takes the second piece's Undo off the
   * bar, and its Retry sends the first piece alone. The failure notice waits until no delete is
   * inside its window.
   */
  it('[P0] [7.6-CMP-013] a first piece that fails while a second is in its window keeps that Undo; Retry sends the first alone', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500]
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    await openAndDelete(user, 'plain-dress')

    // The first piece was sent at once and failed: it is back, and the bar still offers the
    // second piece's Undo with no Retry.
    expect(await screen.findByTestId('garment-card-black-shoes')).toBeInTheDocument()
    expect(deleteRequests.map((request) => request.id)).toEqual(['black-shoes'])
    expect(screen.queryByTestId('garment-card-plain-dress')).toBeNull()
    expect(screen.getByTestId('status-bar-action-undo')).toBeVisible()
    expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
    expect(await statusBar()).not.toHaveTextContent('Could not delete this piece.')

    // The second piece keeps its whole window.
    await manual.advance(WINDOW_MS - 1)
    expect(deleteRequests).toHaveLength(1)
    await manual.advance(1)
    await waitFor(() =>
      expect(deleteRequests.map((request) => request.id)).toEqual([
        'black-shoes',
        'plain-dress',
      ])
    )

    // Now no window is open, so the failure speaks.
    const retry = await screen.findByTestId('status-bar-action-retry')
    expect(await statusBar()).toHaveTextContent('Could not delete this piece.')
    await user.click(retry)
    await waitFor(() => expect(deleteRequests).toHaveLength(3))
    expect(deleteRequests[2]).toEqual({
      id: 'black-shoes',
      keepalive: true,
      authorization: `Bearer ${owner}`,
    })
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    expect(await statusBar()).toHaveTextContent('Deleted')
  })

  it('[P1] [7.6-CMP-013] an Undo of the second piece lets the first failure speak; its Retry never sends the undone piece', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500]
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    await openAndDelete(user, 'plain-dress')
    expect(await screen.findByTestId('garment-card-black-shoes')).toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()

    await user.click(screen.getByTestId('status-bar-action-undo'))

    // "Undone" first, then the failure takes the bar with its Retry.
    expect(await screen.findByTestId('garment-card-plain-dress')).toBeInTheDocument()
    const retry = await screen.findByTestId('status-bar-action-retry')
    expect(await statusBar()).toHaveTextContent('Could not delete this piece.')
    await user.click(retry)
    await waitFor(() => expect(deleteRequests).toHaveLength(2))
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests.map((request) => request.id)).toEqual([
      'black-shoes',
      'black-shoes',
    ])
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    expect(screen.getByTestId('garment-card-plain-dress')).toBeInTheDocument()
  })

  it('[P1] [7.6-CMP-013] two failures share one notice whose Retry sends both', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500, 500]
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    await openAndDelete(user, 'plain-dress')
    expect(await screen.findByTestId('garment-card-black-shoes')).toBeInTheDocument()
    await manual.advance(WINDOW_MS)
    expect(await screen.findByTestId('garment-card-plain-dress')).toBeInTheDocument()

    await user.click(await screen.findByTestId('status-bar-action-retry'))

    await waitFor(() => expect(deleteRequests).toHaveLength(4))
    expect(
      deleteRequests
        .slice(2)
        .map((request) => request.id)
        .sort()
    ).toEqual(['black-shoes', 'plain-dress'])
    await waitFor(() => {
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
      expect(screen.queryByTestId('garment-card-plain-dress')).toBeNull()
    })
  })

  /**
   * D9: a Retry on the bar that a new Undo covers is still owed. It comes back once no Undo
   * window is open, and its Retry still sends the failed piece alone.
   */
  it('[P0] [7.6-CMP-013] a Retry covered by a new Undo comes back once that window ends', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500]
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await manual.advance(WINDOW_MS)
    await screen.findByTestId('status-bar-action-retry')
    expect(await screen.findByTestId('garment-card-black-shoes')).toBeInTheDocument()

    await openAndDelete(user, 'plain-dress')
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-plain-dress')).toBeNull()
    )
    // The dress's Undo covers the Retry while its window is open.
    expect(screen.getByTestId('status-bar-action-undo')).toBeVisible()
    expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
    expect(barText()).not.toContain('Could not delete this piece.')
    expect(deleteRequests.map((request) => request.id)).toEqual(['black-shoes'])

    await manual.advance(WINDOW_MS)
    await waitFor(() =>
      expect(deleteRequests.map((request) => request.id)).toEqual([
        'black-shoes',
        'plain-dress',
      ])
    )
    const retry = await screen.findByTestId('status-bar-action-retry')
    expect(await statusBar()).toHaveTextContent('Could not delete this piece.')
    expect(screen.queryByTestId('status-bar-action-undo')).toBeNull()

    await user.click(retry)
    await waitFor(() => expect(deleteRequests).toHaveLength(3))
    expect(deleteRequests[2]).toEqual({
      id: 'black-shoes',
      keepalive: true,
      authorization: `Bearer ${owner}`,
    })
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    expect(await statusBar()).toHaveTextContent('Deleted')
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toHaveLength(3)
  })

  it('[P1] [7.6-CMP-013] deleting a failed piece again ends its Retry, so an Undo of that delete brings no Retry back', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500]
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await manual.advance(WINDOW_MS)
    await screen.findByTestId('status-bar-action-retry')

    await openAndDelete(user, 'black-shoes')
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    await user.click(screen.getByTestId('status-bar-action-undo'))

    expect(await screen.findByTestId('garment-card-black-shoes')).toBeInTheDocument()
    await waitFor(async () => expect(await statusBar()).toHaveTextContent('Undone'))
    expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
    expect(barText()).not.toContain('Could not delete this piece.')
    await manual.advance(WINDOW_MS * 2)
    expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
    expect(deleteRequests.map((request) => request.id)).toEqual(['black-shoes'])
  })

  /**
   * Codex P2-1: the member's deletes outlive the Closet. A send that fails after the member left
   * shows Retry on the root bar; that Retry is heard while away and after coming back.
   */
  it('[P0] [7.6-CMP-014] a Retry pressed after leaving the Closet sends once, says Deleted, and the Closet reopens without the piece', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500]
    const { rerender } = render(<RootWithCloset closetOpen />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    rerender(<RootWithCloset closetOpen={false} />)

    await waitFor(() => expect(deleteRequests).toHaveLength(1))
    expect(await statusBar()).toHaveTextContent('Could not delete this piece.')
    await user.click(await screen.findByTestId('status-bar-action-retry'))

    await waitFor(() => expect(deleteRequests).toHaveLength(2))
    expect(deleteRequests[1]).toEqual({
      id: 'black-shoes',
      keepalive: true,
      authorization: `Bearer ${owner}`,
    })
    await waitFor(async () => expect(await statusBar()).toHaveTextContent('Deleted'))
    expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()

    rerender(<RootWithCloset closetOpen />)
    expect(await screen.findByTestId('garment-card-blue-top')).toBeInTheDocument()
    expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    expect(deleteRequests).toHaveLength(2)
  })

  it('[P1] [7.6-CMP-014] a second failure of a Retry pressed while away offers Retry again', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500, 500]
    const { rerender } = render(<RootWithCloset closetOpen />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    rerender(<RootWithCloset closetOpen={false} />)
    await user.click(await screen.findByTestId('status-bar-action-retry'))
    await waitFor(() => expect(deleteRequests).toHaveLength(2))

    await user.click(await screen.findByTestId('status-bar-action-retry'))
    await waitFor(() => expect(deleteRequests).toHaveLength(3))
    await waitFor(async () => expect(await statusBar()).toHaveTextContent('Deleted'))
  })

  it('[P1] [7.6-CMP-014] a Retry pressed after coming back removes the piece from the mounted grid', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500]
    const { rerender } = render(<RootWithCloset closetOpen />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    rerender(<RootWithCloset closetOpen={false} />)
    await screen.findByTestId('status-bar-action-retry')

    rerender(<RootWithCloset closetOpen />)
    // The failed piece is still the member's, so the reopened grid lists it.
    expect(await screen.findByTestId('garment-card-black-shoes')).toBeInTheDocument()
    await user.click(screen.getByTestId('status-bar-action-retry'))

    await waitFor(() => expect(deleteRequests).toHaveLength(2))
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )
    expect(await statusBar()).toHaveTextContent('Deleted')
  })

  /**
   * Codex P1-1 follow-up: a Retry that lands while another delete is inside its window holds its
   * "Deleted" until that window closes, so the other piece's Undo stays on the bar. When the
   * closing send fails, "Deleted" shows first and the failure's Retry ends on top.
   */
  it.each([
    [204, 'Deleted', 0],
    [500, 'Could not delete this piece.', 1],
  ] as const)(
    '[P1] [7.6-CMP-016] a Retry landing inside another window keeps that Undo; when the window closes with %i the bar ends on %s',
    async (closingStatus, finalText, retryActions) => {
      const user = userEvent.setup()
      deleteStatuses = [500]
      render(<WardrobePage />)
      signIn()

      await openAndDelete(user, 'black-shoes')
      await manual.advance(WINDOW_MS)
      const retry = await screen.findByTestId('status-bar-action-retry')

      // The Retry stays out at the server while the member deletes another piece.
      let answer: () => void = () => undefined
      deleteGate = new Promise<void>((resolve) => {
        answer = resolve
      })
      await user.click(retry)
      await waitFor(() => expect(deleteRequests).toHaveLength(2))
      await openAndDelete(user, 'plain-dress')
      await screen.findByTestId('status-bar-action-undo')

      deleteGate = null
      await act(async () => {
        answer()
        await Promise.resolve()
      })
      await waitFor(() =>
        expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
      )
      // Only the dress's send, which closes its window, answers with the case's status.
      deleteStatuses = [closingStatus]
      // The Retry landed, but the dress still owns the bar with its Undo.
      expect(screen.getByTestId('status-bar-action-undo')).toBeVisible()
      expect(deleteRequests.map((request) => request.id)).toEqual([
        'black-shoes',
        'black-shoes',
      ])

      await manual.advance(WINDOW_MS)
      await waitFor(() => expect(deleteRequests).toHaveLength(3))
      await waitFor(async () => expect(await statusBar()).toHaveTextContent(finalText))
      expect(screen.queryByTestId('status-bar-action-undo')).toBeNull()
      expect(screen.queryAllByTestId('status-bar-action-retry')).toHaveLength(
        retryActions
      )
    }
  )

  it('[P1] [7.6-CMP-016] the Retry of a failure after a successful Retry sends only the piece that failed', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500]
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await manual.advance(WINDOW_MS)
    await user.click(await screen.findByTestId('status-bar-action-retry'))
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
    )

    deleteStatuses = [500]
    await openAndDelete(user, 'plain-dress')
    await manual.advance(WINDOW_MS)
    await user.click(await screen.findByTestId('status-bar-action-retry'))

    // The shoes are already deleted: the new notice's Retry names the dress alone.
    await waitFor(() => expect(deleteRequests).toHaveLength(4))
    expect(deleteRequests.map((request) => request.id)).toEqual([
      'black-shoes',
      'black-shoes',
      'plain-dress',
      'plain-dress',
    ])
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toHaveLength(4)
  })

  it('[P1] [7.6-CMP-016] a Deleted for another piece while a Retry shows is only announced; the Retry stays on the bar', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500]
    usageById.set('blue-top', { savedLookCount: 1, capsuleCount: 0 })
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await manual.advance(WINDOW_MS)
    await screen.findByTestId('status-bar-action-retry')
    const announcer = screen.getByTestId('save-feedback-announcer')
    expect(announcer).toHaveTextContent(/^Could not delete this piece\.$/)

    await openAndDelete(user, 'blue-top')
    await user.click(await screen.findByTestId('garment-delete-confirm-accept'))
    await waitFor(() =>
      expect(deleteRequests.map((request) => request.id)).toEqual([
        'black-shoes',
        'blue-top',
      ])
    )

    // The top's confirmed delete landed: screen readers hear it, and the bar keeps the Retry.
    await waitFor(() => expect(announcer).toHaveTextContent(/^Deleted$/))
    expect(await statusBar()).toHaveTextContent('Could not delete this piece.')
    expect(barText()).not.toContain('Deleted')
    expect(screen.getByTestId('status-bar-action-retry')).toBeVisible()

    await user.click(screen.getByTestId('status-bar-action-retry'))
    await waitFor(() => expect(deleteRequests).toHaveLength(3))
    expect(deleteRequests[2]).toEqual({
      id: 'black-shoes',
      keepalive: true,
      authorization: `Bearer ${owner}`,
    })
    await waitFor(async () => expect(await statusBar()).toHaveTextContent('Deleted'))
    expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
  })

  /**
   * D9: a Retry that left the bar without a delete notice covering it has ended. A later
   * "Deleted" for another piece shows on the bar, and no Undo window brings the Retry back.
   */
  it.each<[string, (bar: ReturnType<typeof useStatusBar>) => void]>([
    ['the member dismisses it', (bar) => bar.dismissNotice()],
    [
      'another feature replaces it',
      (bar) => {
        bar.showNotice({
          id: 'saved-looks-saved',
          message: 'Saved to your looks.',
          tone: 'success',
        })
      },
    ],
  ])(
    '[P1] [7.6-CMP-016] a Retry that %s has ended: a later Deleted shows on the bar and no window brings it back',
    async (_label, takeRetryOff) => {
      const user = userEvent.setup()
      deleteStatuses = [500]
      usageById.set('blue-top', { savedLookCount: 1, capsuleCount: 0 })
      render(<RootWithCloset closetOpen />)
      signIn()

      await openAndDelete(user, 'black-shoes')
      await manual.advance(WINDOW_MS)
      await screen.findByTestId('status-bar-action-retry')

      act(() => takeRetryOff(rootBar.current!))
      expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()

      await openAndDelete(user, 'blue-top')
      await user.click(await screen.findByTestId('garment-delete-confirm-accept'))
      await waitFor(() =>
        expect(deleteRequests.map((request) => request.id)).toEqual([
          'black-shoes',
          'blue-top',
        ])
      )
      await waitFor(async () => expect(await statusBar()).toHaveTextContent('Deleted'))
      expect(barText()).not.toContain('Could not delete this piece.')
      expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()

      // A later Undo window opens and closes: the ended Retry stays gone.
      await openAndDelete(user, 'plain-dress')
      await screen.findByTestId('status-bar-action-undo')
      await manual.advance(WINDOW_MS)
      await waitFor(() => expect(deleteRequests).toHaveLength(3))
      expect(deleteRequests[2]).toEqual({
        id: 'plain-dress',
        keepalive: true,
        authorization: `Bearer ${owner}`,
      })
      await manual.advance(WINDOW_MS * 2)
      expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
      expect(barText()).not.toContain('Could not delete this piece.')
      expect(deleteRequests).toHaveLength(3)
    }
  )

  it('[P1] [7.6-CMP-016] a Retry that expired uncovered is not merged into a later failure notice', async () => {
    const user = userEvent.setup()
    let now = 1_000
    injectWardrobeGarmentDeletionClockForTests(() => now)
    deleteStatuses = [500, 500]
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await manual.advance(WINDOW_MS)
    await screen.findByTestId('status-bar-action-retry')
    expect(await screen.findByTestId('garment-card-black-shoes')).toBeInTheDocument()

    // The Retry notice runs its whole course on screen.
    now += WINDOW_MS

    await openAndDelete(user, 'plain-dress')
    await screen.findByTestId('status-bar-action-undo')
    await manual.advance(WINDOW_MS)
    await waitFor(() =>
      expect(deleteRequests.map((request) => request.id)).toEqual([
        'black-shoes',
        'plain-dress',
      ])
    )
    expect(await screen.findByTestId('garment-card-plain-dress')).toBeInTheDocument()

    // The new failure's Retry names the dress alone; the shoes' expired Retry is not owed.
    await user.click(await screen.findByTestId('status-bar-action-retry'))
    await waitFor(() => expect(deleteRequests).toHaveLength(3))
    expect(deleteRequests[2]).toEqual({
      id: 'plain-dress',
      keepalive: true,
      authorization: `Bearer ${owner}`,
    })
    await waitFor(() =>
      expect(screen.queryByTestId('garment-card-plain-dress')).toBeNull()
    )
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toHaveLength(3)
    expect(screen.getByTestId('garment-card-black-shoes')).toBeInTheDocument()
  })

  /**
   * Codex P3-1 (D11): once the tab holds another member, the first member's deletes say nothing.
   * What was still in its window is sent with the first member's own bearer; its notices leave
   * the bar and its late answer shows to nobody.
   */
  it('[P0] [7.6-CMP-015] a member switch sends the old window with the old bearer and shows its late failure to nobody', async () => {
    const user = userEvent.setup()
    let answer: () => void = () => undefined
    deleteGate = new Promise<void>((resolve) => {
      answer = resolve
    })
    deleteStatuses = [500]
    render(<RootWithCloset closetOpen />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await screen.findByTestId('status-bar-action-undo')
    signIn('next-member')

    await waitFor(() => expect(deleteRequests).toHaveLength(1))
    expect(deleteRequests[0]).toEqual({
      id: 'black-shoes',
      keepalive: true,
      authorization: `Bearer ${owner}`,
    })
    // The old session ends in a microtask after the new member's render.
    await waitFor(() => expect(screen.queryByTestId('status-bar-action-undo')).toBeNull())

    await act(async () => {
      answer()
      await Promise.resolve()
    })
    await manual.advance(WINDOW_MS * 2)
    expect(barText()).not.toContain('Could not delete this piece.')
    expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
    expect(deleteRequests).toHaveLength(1)
  })

  it('[P1] [7.6-CMP-015] a member switch takes the old member Retry off the bar and sends nothing', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500]
    render(<RootWithCloset closetOpen />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await manual.advance(WINDOW_MS)
    await screen.findByTestId('status-bar-action-retry')

    signIn('next-member')

    await waitFor(() =>
      expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
    )
    // The live region keeps what it last read out; the bar itself no longer shows the failure.
    expect(barText()).not.toContain('Could not delete this piece.')
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toHaveLength(1)
  })

  it('[P1] [7.6-CMP-015] a member switch after leaving the Closet takes the old member Retry off the root bar and sends nothing', async () => {
    const user = userEvent.setup()
    deleteStatuses = [500]
    const { rerender } = render(<RootWithCloset closetOpen />)
    signIn()

    await openAndDelete(user, 'black-shoes')
    await manual.advance(WINDOW_MS)
    await screen.findByTestId('status-bar-action-retry')
    rerender(<RootWithCloset closetOpen={false} />)
    expect(screen.queryByTestId('wardrobe-closet-view')).toBeNull()
    expect(screen.getByTestId('status-bar-action-retry')).toBeVisible()

    // No Closet is mounted to notice the switch: the session follows the tab's member itself.
    signIn('next-member')

    await waitFor(() =>
      expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
    )
    expect(barText()).not.toContain('Could not delete this piece.')
    await manual.advance(WINDOW_MS * 2)
    expect(deleteRequests).toHaveLength(1)
  })

  it('[P1] [7.6-CMP-010] the grid returns at its scroll and focus moves to the next card, else the previous one', async () => {
    const user = userEvent.setup()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    render(<WardrobePage />)
    signIn()
    await screen.findByTestId('garment-open-black-shoes')
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 })

    await openAndDelete(user, 'black-shoes')
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    expect(scrollTo).toHaveBeenLastCalledWith(0, 640)
    expect(screen.getByTestId('wardrobe-closet-view')).toBeVisible()
    // Focus lands on the next card's detail opener, the control that card's own Back returns to.
    expect(screen.getByTestId('garment-open-plain-dress')).toHaveFocus()

    // The last card's next neighbour is gone, so focus goes back to the one before it.
    await openAndDelete(user, 'plain-dress')
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    expect(screen.getByTestId('garment-open-blue-top')).toHaveFocus()
  })

  it('[P1] [7.6-CMP-010] focus skips a next card still processing and lands on the following ready card opener', async () => {
    const user = userEvent.setup()
    closet = [blueTop, blackShoes, processingPiece, plainDress]
    render(<WardrobePage />)
    signIn()
    // A processing card has no detail opener, only its upload check.
    await screen.findByTestId('garment-card-processing-piece')
    expect(screen.queryByTestId('garment-open-processing-piece')).toBeNull()

    await openAndDelete(user, 'black-shoes')
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())

    expect(screen.getByTestId('garment-open-plain-dress')).toHaveFocus()
    expect(screen.getByTestId('garment-card-processing-piece')).toBeInTheDocument()
  })

  it('[P1] [7.6-CMP-010] deleting the only ready piece moves focus to the closet heading at the saved scroll', async () => {
    const user = userEvent.setup()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    closet = [blackShoes, processingPiece]
    render(<WardrobePage />)
    signIn()
    await screen.findByTestId('garment-open-black-shoes')
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 })

    await openAndDelete(user, 'black-shoes')
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())

    // No card left has a detail opener, so focus goes to the grid heading.
    expect(scrollTo).toHaveBeenLastCalledWith(0, 640)
    expect(screen.getByTestId('wardrobe-closet-heading')).toHaveFocus()
    expect(screen.getByTestId('garment-card-processing-piece')).toBeInTheDocument()
    expect(screen.queryByTestId('garment-card-black-shoes')).toBeNull()
  })

  it('[P1] [7.6-CMP-011] a committed delete reloads saved looks so they show the missing piece', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()
    await screen.findByTestId('garment-open-black-shoes')
    await waitFor(() => expect(savedLookReads).toBeGreaterThan(0))
    const readsBefore = savedLookReads

    await openAndDelete(user, 'black-shoes')
    expect(savedLookReads).toBe(readsBefore)
    await manual.advance(WINDOW_MS)

    await waitFor(() => expect(savedLookReads).toBeGreaterThan(readsBefore))
  })

  it('[P2] [7.6-CMP-011] a saved looks read cut short by the reload after a delete shows no load error', async () => {
    const user = userEvent.setup()
    let releaseFirstRead: () => void = () => undefined
    savedLooksGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    usageById.set('blue-top', 'missing')
    render(<WardrobePage />)
    signIn()
    await screen.findByTestId('garment-open-blue-top')
    await waitFor(() => expect(savedLookReads).toBeGreaterThan(0))
    const readsBefore = savedLookReads
    // The first read stays out; the reload the delete starts answers at once.
    savedLooksGate = null

    await openAndDelete(user, 'blue-top')
    await waitFor(() =>
      expect(deleteRequests.map((request) => request.id)).toEqual(['blue-top'])
    )
    await waitFor(() => expect(savedLookReads).toBeGreaterThan(readsBefore))

    // The reload abandoned the first read: its late end reports nothing.
    await act(async () => {
      releaseFirstRead()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByTestId('saved-looks-retry')).toBeNull()
    expect(deleteRequests).toHaveLength(1)
  })

  it('[P2] [7.6-CMP-012] a piece that is not ready offers no Delete', async () => {
    const awaiting = readyGarment('awaiting-piece', {
      status: 'awaiting_tags',
      category: null,
      material: null,
      comfortRange: null,
      tagsConfirmedAt: null,
      colorFamily: null,
    })
    closet = [...closet, awaiting]
    window.history.replaceState(null, '', '/wardrobe?garment=awaiting-piece')
    render(<WardrobePage />)
    signIn()

    expect(await screen.findByTestId('garment-detail-missing')).toBeVisible()
    expect(screen.queryByTestId('garment-delete')).toBeNull()
    expect(screen.getByTestId('garment-card-awaiting-piece')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('garment-card-awaiting-piece')).queryByTestId(
        'garment-delete'
      )
    ).toBeNull()
  })

  /**
   * CC-7.5 tag edit Undo, kept here with the Closet harness: an Undo pressed offline sends
   * nothing and offers Retry, which runs that Undo once the connection is back.
   */
  it('[P1] [7.5-CMP-007] a tag edit Undo pressed offline sends nothing and offers Retry; online, Retry undoes once', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()

    await user.click(await screen.findByTestId('garment-open-blue-top'))
    await user.click(await screen.findByTestId('garment-edit-tags'))
    await user.click(screen.getByTestId('garment-tag-option-category-outerwear'))
    await user.click(screen.getByTestId('garment-tag-done'))
    const undo = await screen.findByTestId('status-bar-action-undo')
    expect(tagRequests).toEqual([
      { id: 'blue-top', category: 'outerwear', authorization: `Bearer ${owner}` },
    ])

    setOnline(false)
    await user.click(undo)

    const bar = await statusBar()
    await waitFor(() =>
      expect(bar).toHaveTextContent('You are offline. Save when you reconnect.')
    )
    expect(bar).toHaveAttribute('data-tone', 'offline')
    expect(screen.queryByTestId('status-bar-action-undo')).toBeNull()
    expect(tagRequests).toHaveLength(1)

    setOnline(true)
    await user.click(screen.getByTestId('status-bar-action-retry'))

    await waitFor(() => expect(tagRequests).toHaveLength(2))
    expect(tagRequests[1]).toEqual({
      id: 'blue-top',
      category: 'top',
      authorization: `Bearer ${owner}`,
    })
    await waitFor(async () =>
      expect(await statusBar()).toHaveTextContent('Change undone.')
    )
    expect(tagRequests).toHaveLength(2)
  })
})

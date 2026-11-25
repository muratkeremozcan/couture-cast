// Story 7.6 test plan 7.6-CMP-002..011: garment delete from the Closet detail. An unused piece
// hides with "Deleted" and Undo and is sent when the window ends; a piece in use asks once and is
// sent at once; a failed send returns the piece with Retry; the grid keeps its scroll and focus
// moves to the next card. The deferred deletion controller runs on an injected manual timer
// (spec D10), so no test waits on real time.
// Learning path Step 64: Garment delete.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { SaveFeedbackProvider } from '../components/save-feedback'
import { injectWardrobeGarmentDeletionForTests } from './garment-deletion'
import WardrobePage from './page'

const session = vi.hoisted(() => ({ owner: null as string | null }))
vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.owner,
}))

vi.mock('next/navigation', () => ({
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

type Usage = { savedLookCount: number; capsuleCount: number }

let closet: GarmentWithColor[]
let usageById: Map<string, Usage | 'missing' | 'route-404' | 'error'>
let deleteRequests: { id: string; keepalive: boolean; authorization: string | null }[]
/** The next DELETE answers these statuses in order; then 204. */
let deleteStatuses: number[]
let savedLookReads: number
/** While set, every DELETE waits for it before answering (an in-flight send). */
let deleteGate: Promise<void> | null
let manual: ReturnType<typeof createManualTimer>

function signIn(member = owner) {
  act(() => {
    session.owner = member
    sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, member)
    window.dispatchEvent(new Event('couture:session'))
  })
}

/**
 * The root layout's status bar with the Closet mounted or not: leaving the Closet keeps the bar,
 * as navigating to another page does.
 */
function RootWithCloset({ closetOpen }: { closetOpen: boolean }) {
  return (
    <SaveFeedbackProvider inline renderOfflineLine={false}>
      {closetOpen ? <WardrobePage /> : <p>Another page</p>}
    </SaveFeedbackProvider>
  )
}

const statusBar = () => screen.findByTestId('status-feedback-bar')

async function openAndDelete(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(await screen.findByTestId(`garment-open-${id}`))
  await screen.findByTestId('garment-detail')
  await user.click(screen.getByTestId('garment-delete'))
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', api.slice(0, -'/api/v1'.length))
  window.history.replaceState(null, '', '/wardrobe')
  closet = [blueTop, blackShoes, plainDress]
  usageById = new Map()
  deleteRequests = []
  deleteStatuses = []
  savedLookReads = 0
  deleteGate = null
  manual = createManualTimer()
  // Every new member session gets its own controller on the manual timer, as production does.
  injectWardrobeGarmentDeletionForTests(() =>
    createDeferredGarmentDeletion({ timer: manual.timer })
  )
  const savedLooks = createSavedLooksMswHandlers([], `${api}/wardrobe/saved-looks`)
  savedLooks.store.onGet = () => {
    savedLookReads += 1
  }
  useMswHandlers(
    http.get(`${api}/wardrobe/garments`, () => HttpResponse.json({ data: closet })),
    http.get(`${api}/wardrobe/garments/:id/usage`, ({ params }) => {
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

  it('[P1] [7.6-CMP-005] a failed usage read deletes nothing and offers Retry, which schedules one delete', async () => {
    const user = userEvent.setup()
    usageById.set('blue-top', 'error')
    render(<WardrobePage />)
    signIn()

    await openAndDelete(user, 'blue-top')

    expect(await statusBar()).toHaveTextContent(
      'Could not check where this piece is used. Try again.'
    )
    expect(screen.getByTestId('garment-detail')).toBeVisible()
    expect(screen.getByTestId('garment-card-blue-top')).toBeInTheDocument()

    usageById.delete('blue-top')
    await user.click(screen.getByTestId('status-bar-action-retry'))
    await waitFor(() => expect(screen.queryByTestId('garment-card-blue-top')).toBeNull())
    expect(await statusBar()).toHaveTextContent('Deleted')
    // The failed read sent nothing; the retried read schedules the delete in its own window.
    expect(deleteRequests).toEqual([])
    await manual.advance(WINDOW_MS)
    await waitFor(() =>
      expect(deleteRequests.map((request) => request.id)).toEqual(['blue-top'])
    )
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

    expect(await statusBar()).toHaveTextContent(
      'Could not check where this piece is used. Try again.'
    )
    expect(screen.getByTestId('status-bar-action-retry')).toBeVisible()
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
    expect(screen.queryByText('Could not delete this piece.')).toBeNull()
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
    expect(screen.queryByText('Could not delete this piece.')).toBeNull()
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
    expect(screen.getByTestId('garment-card-plain-dress')).toContainElement(
      document.activeElement as HTMLElement
    )

    // The last card's next neighbour is gone, so focus goes back to the one before it.
    await openAndDelete(user, 'plain-dress')
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    expect(screen.getByTestId('garment-card-blue-top')).toContainElement(
      document.activeElement as HTMLElement
    )
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
})

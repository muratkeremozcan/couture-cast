// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): the Closet top bar title reads Closet (D1); router stub for the back (D11)
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
// Story 7.5 test plan 7.5-CMP-002..004: the Closet grid opens a ready garment's detail at
// /wardrobe?garment=<id>, keeps the grid mounted for back, and names photos by color plus
// category.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
// Learning path Step 76: Garment subtypes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-76-garment-subtypes
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAppHistory } from '../../lib/app-history'
import { screenSnapshot } from '../../lib/screen-snapshot'
import type { GarmentWithColor } from '@couture/api-client/contracts/http'
import {
  createCompletedOnboardingStateFixture,
  createReadyGarmentFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import type * as WebSession from '../../lib/web-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  createSavedLooksMswHandlers,
  type SavedLooksMswStore,
} from '../../test-utils/saved-looks-msw'
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
  // Story 7.5: the closet reads the open garment from useSearchParams, which Next keeps in sync
  // with native History API calls and Back/Forward. This stand-in does the same for jsdom.
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

const api = 'http://wardrobe-detail-page.test/api/v1'
const owner = 'closet-member'

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
const uncoloredDress = readyGarment('plain-dress', {
  category: 'dress',
  colorFamily: null,
})
const awaiting = readyGarment('awaiting-piece', {
  status: 'awaiting_tags',
  category: null,
  material: null,
  comfortRange: null,
  tagsConfirmedAt: null,
  colorFamily: null,
})

let closet: GarmentWithColor[]
let savedLooksStore: SavedLooksMswStore
let listHeaders: (string | null)[]

function signIn() {
  act(() => {
    session.owner = owner
    sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, owner)
    window.dispatchEvent(new Event('couture:session'))
  })
}

function setUrl(search: string) {
  window.history.replaceState(null, '', `/wardrobe${search}`)
}

const card = (id: string) => within(screen.getByTestId(`garment-card-${id}`))
/** CC-7.9 D7: an open detail's title and back control live in the shared top bar. */
const topBar = () => within(screen.getByTestId('app-header'))
const topBarBack = () => topBar().getByTestId('app-top-bar-back')
const topBarTitle = () => topBar().getByRole('heading', { level: 1 })

beforeEach(() => {
  // Story CC-7.7: the Closet keeps a per-member snapshot in module memory, so one test's closet
  // would open the next test's hub for the same member (CI, 61d7156e).
  screenSnapshot.clear()
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', api.slice(0, -'/api/v1'.length))
  setUrl('')
  closet = [blueTop, blackShoes, uncoloredDress, awaiting]
  listHeaders = []
  const savedLooks = createSavedLooksMswHandlers([], `${api}/wardrobe/saved-looks`)
  savedLooksStore = savedLooks.store
  for (const garment of closet)
    if (garment.category && garment.comfortRange)
      savedLooksStore.garmentTagsById.set(garment.id, {
        category: garment.category,
        comfortRange: garment.comfortRange,
      })
  useMswHandlers(
    http.get(`${api}/wardrobe/garments`, ({ request }) => {
      listHeaders.push(request.headers.get('x-couture-garment-color'))
      return HttpResponse.json({ data: closet })
    }),
    http.patch(`${api}/wardrobe/garments/:id/tags`, async ({ params, request }) => {
      const body = (await request.json()) as Record<string, unknown>
      delete body.expected
      const current = closet.find((item) => item.id === params.id)!
      const updated = { ...current, ...body } as GarmentWithColor
      // Saved looks derive Ready or Needs review from the live garment tags, as the API does.
      if (updated.category && updated.comfortRange)
        savedLooksStore.garmentTagsById.set(updated.id, {
          category: updated.category,
          comfortRange: updated.comfortRange,
        })
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

afterEach(async () => {
  cleanup()
  // Story CC-7.11 D11, D13: jsdom keeps one history per file. Let any back step a test started
  // (a closed layer's go(-1), the detail's back) land before the next test begins, then start
  // from a fresh top entry with nothing below it, so no traversal leaks across tests.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  window.history.pushState(null, '', '/wardrobe')
  clearAppHistory()
  setUrl('')
  session.owner = null
  sessionStorage.clear()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Closet garment detail', () => {
  it('[P0] [7.5-CMP-002] names photos by color plus category and opens only ready cards', async () => {
    render(<WardrobePage />)
    signIn()

    const open = await screen.findByTestId('garment-open-blue-top')
    expect(listHeaders.every((header) => header === '1')).toBe(true)
    expect(open).toHaveAccessibleName('Blue top')
    expect(card('blue-top').getByRole('img', { name: 'Blue top' })).toBeVisible()
    expect(card('blue-top').getByTestId('garment-card-label')).toHaveTextContent('Top')
    expect(card('blue-top').queryByText('Uploaded garment')).toBeNull()
    expect(screen.getByTestId('garment-open-black-shoes')).toHaveAccessibleName(
      'Black shoes'
    )
    expect(screen.getByTestId('garment-open-plain-dress')).toHaveAccessibleName('Dress')
    // A garment still being tagged keeps its tagging button and does not open a detail.
    expect(screen.queryByTestId('garment-open-awaiting-piece')).toBeNull()
    expect(
      card('awaiting-piece').getByRole('img', { name: 'Untagged garment' })
    ).toBeVisible()
    expect(screen.queryByText(blueTop.id)).toBeNull()
  })

  it('[P0] [7.5-CMP-003] opens the detail in place, keeping the grid mounted but hidden', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()

    await user.click(await screen.findByTestId('garment-open-blue-top'))

    const detail = await screen.findByTestId('garment-detail')
    expect(window.location.search).toBe('?garment=blue-top')
    expect(detail).toHaveAccessibleName('Blue top')
    expect(detail).toHaveFocus()
    expect(topBarTitle()).toHaveTextContent(/^Blue top$/)
    expect(within(detail).getByTestId('garment-detail-category')).toHaveTextContent(
      /^Top$/
    )
    expect(topBarBack()).toBeVisible()
    expect(within(detail).queryByTestId('garment-detail-back')).toBeNull()
    expect(within(detail).getByTestId('style-piece-open')).toBeVisible()
    const grid = screen.getByTestId('wardrobe-closet-view')
    expect(grid).not.toBeVisible()
    expect(within(grid).getByTestId('garment-card-blue-top')).toBeInTheDocument()
  })

  it('[P1] [7.5-CMP-004] back returns to the grid at the same scroll with focus on the card', async () => {
    const user = userEvent.setup()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    render(<WardrobePage />)
    signIn()
    const open = await screen.findByTestId('garment-open-black-shoes')
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 })

    await user.click(open)
    await screen.findByTestId('garment-detail')
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0)

    await user.click(topBarBack())

    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    expect(window.location.search).toBe('')
    expect(topBarTitle()).toHaveTextContent(/^Closet$/)
    expect(topBar().queryByTestId('app-top-bar-back')).toBeNull()
    expect(scrollTo).toHaveBeenLastCalledWith(0, 640)
    expect(screen.getByTestId('wardrobe-closet-view')).toBeVisible()
    expect(screen.getByTestId('garment-open-black-shoes')).toHaveFocus()
  })

  it('[P1] [7.5-CMP-004] a reload of ?garment=<id> reopens the detail; back clears the param', async () => {
    const user = userEvent.setup()
    setUrl('?garment=blue-top')
    render(<WardrobePage />)
    signIn()

    const detail = await screen.findByTestId('garment-detail')
    expect(detail).toBeVisible()
    expect(topBarTitle()).toHaveTextContent(/^Blue top$/)

    await user.click(topBarBack())
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    expect(window.location.search).toBe('')
    expect(screen.getByTestId('garment-open-blue-top')).toBeVisible()
  })

  it.each([['?garment=gone-piece'], ['?garment=awaiting-piece']])(
    '[P1] [7.5-CMP-004] %s shows "no longer in your closet" with back',
    async (search) => {
      setUrl(search)
      render(<WardrobePage />)
      signIn()

      expect(await screen.findByTestId('garment-detail-missing')).toHaveTextContent(
        'This piece is no longer in your closet.'
      )
      expect(topBarBack()).toBeVisible()
    }
  )

  it('[P0] [7.5-CMP-005] a saved tag change shows in the detail and on the grid card', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()

    await user.click(await screen.findByTestId('garment-open-blue-top'))
    await user.click(await screen.findByTestId('garment-edit-tags'))
    await user.click(screen.getByTestId('garment-tag-option-category-outerwear'))
    await user.click(screen.getByTestId('garment-tag-done'))

    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent('Saved')
    expect(screen.getByTestId('garment-detail')).toHaveAccessibleName('Blue outer layer')
    expect(topBarTitle()).toHaveTextContent(/^Blue outer layer$/)
    await user.click(topBarBack())
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    expect(screen.getByTestId('garment-open-blue-top')).toHaveAccessibleName(
      'Blue outer layer'
    )
    expect(card('blue-top').getByTestId('garment-card-label')).toHaveTextContent(
      'Outer layer'
    )
  })

  it('[P0] [7.19-CLOSET] saves a category-scoped subtype and filters to it', async () => {
    closet.push(readyGarment('legacy-top'))
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()

    await user.click(await screen.findByTestId('garment-open-blue-top'))
    await user.click(await screen.findByTestId('garment-edit-tags'))
    const subtypes = within(screen.getByRole('group', { name: 'Subtype' }))
    expect(subtypes.queryByRole('button', { name: 'Midi skirt' })).toBeNull()
    await user.click(subtypes.getByRole('button', { name: 'Tank top' }))
    await user.click(screen.getByTestId('garment-tag-done'))

    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent('Saved')
    expect(screen.getByTestId('garment-detail-subtype')).toHaveTextContent(/tank/i)
    await user.click(topBarBack())
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())

    await user.click(screen.getByTestId('closet-category-top'))
    expect(screen.getByTestId('garment-open-legacy-top')).toBeVisible()
    await user.click(screen.getByTestId('closet-subtype-tank'))
    expect(screen.queryByTestId('garment-open-legacy-top')).toBeNull()
    await user.click(screen.getByTestId('garment-open-blue-top'))
    expect(await screen.findByTestId('garment-detail-subtype')).toHaveTextContent(/tank/i)
  })

  it('[P0] [7.19-CLOSET] Undo clears the subtype of a garment first read without one', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()

    await user.click(await screen.findByTestId('garment-open-blue-top'))
    expect(await screen.findByTestId('garment-detail-subtype')).toHaveTextContent(
      /^None$/
    )
    await user.click(await screen.findByTestId('garment-edit-tags'))
    await user.click(screen.getByRole('button', { name: 'Tank top' }))
    await user.click(screen.getByTestId('garment-tag-done'))
    await waitFor(() =>
      expect(screen.getByTestId('garment-detail-subtype')).toHaveTextContent(/^Tank top$/)
    )

    await user.click(await screen.findByTestId('status-bar-action-undo'))
    await waitFor(() =>
      expect(screen.getByTestId('garment-detail-subtype')).toHaveTextContent(/^None$/)
    )
  })

  it('[P1] [7.5-CMP-011] Style this piece from the detail opens the panel for that garment', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()

    await user.click(await screen.findByTestId('garment-open-blue-top'))
    // The hidden grid keeps its own opener mounted; use the detail's.
    const detail = await screen.findByTestId('garment-detail')
    await user.click(await within(detail).findByTestId('style-piece-open'))

    const panel = await screen.findByRole('dialog', { name: 'Style this piece' })
    expect(await within(panel).findByRole('heading', { name: 'School' })).toBeVisible()
  })

  /**
   * Story CC-7.12 moved saved looks to Looks: the Closet shows no saved looks and reads none
   * around a tag edit. The anchored look's saved date or Needs review now follows the edit and
   * its Undo on Looks (looks/page.anchor-tags.test.tsx 7.12-UNIT-022e).
   */
  it('[P1] [7.5-CMP-016] [7.12] a tag edit and its Undo send no saved looks read from the Closet', async () => {
    const user = userEvent.setup()
    let savedLookReads = 0
    savedLooksStore.onGet = () => {
      savedLookReads += 1
    }
    const category = () => closet.find((item) => item.id === blueTop.id)?.category
    render(<WardrobePage />)
    signIn()

    await user.click(await screen.findByTestId('garment-open-blue-top'))
    await user.click(await screen.findByTestId('garment-edit-tags'))
    await user.click(screen.getByTestId('garment-tag-option-category-outerwear'))
    await user.click(screen.getByTestId('garment-tag-done'))
    await waitFor(() => expect(category()).toBe('outerwear'))

    await user.click(await screen.findByTestId('status-bar-action-undo'))
    await waitFor(() => expect(category()).toBe(blueTop.category))
    await user.click(topBarBack())
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())

    expect(savedLookReads).toBe(0)
    expect(screen.queryByTestId('closet-saved-looks-row')).toBeNull()
    expect(screen.queryByTestId('saved-look-needs-review')).toBeNull()
  })

  it('[P2] [7.5-CMP-017] browser Back then Forward keeps the detail Back control on history (Codex P3)', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()

    await user.click(await screen.findByTestId('garment-open-blue-top'))
    await screen.findByTestId('garment-detail')
    act(() => window.history.back())
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    act(() => window.history.forward())
    await screen.findByTestId('garment-detail')
    expect(window.location.search).toBe('?garment=blue-top')

    const back = vi.spyOn(window.history, 'back')
    const replace = vi.spyOn(window.history, 'replaceState')
    await user.click(topBarBack())

    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    // Back steps through history instead of writing a second grid entry over the detail.
    expect(back).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  })

  it('[P1] [7.5-CMP-020] a saved answer without a signed photo keeps the photo already shown', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    signIn()
    await user.click(await screen.findByTestId('garment-open-blue-top'))
    // Signing failed after the write: the API answers the committed tags without a photo.
    useMswHandlers(
      http.patch(`${api}/wardrobe/garments/:id/tags`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        delete body.expected
        const updated = { ...blueTop, ...body, imageAccess: null }
        closet = closet.map((item) => (item.id === blueTop.id ? updated : item))
        return HttpResponse.json({ data: updated })
      })
    )

    await user.click(await screen.findByTestId('garment-edit-tags'))
    await user.click(screen.getByTestId('garment-tag-option-material-wool'))
    await user.click(screen.getByTestId('garment-tag-done'))

    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent('Saved')
    const detail = screen.getByTestId('garment-detail')
    expect(within(detail).getByTestId('garment-detail-material')).toHaveTextContent(
      'Wool'
    )
    expect(within(detail).getByRole('img', { name: 'Blue top' })).toHaveAttribute(
      'src',
      blueTop.imageAccess!.url
    )
  })

  it('[P1] [7.5-CMP-020] a Done answer older than a closet read is set aside and the closet reads again', async () => {
    const user = userEvent.setup()
    const held = Promise.withResolvers<void>()
    let reads = 0
    useMswHandlers(
      http.get(`${api}/wardrobe/garments`, () => {
        reads += 1
        return HttpResponse.json({ data: closet })
      }),
      http.patch(`${api}/wardrobe/garments/:id/tags`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        await held.promise
        // The stored row keeps the comfort another device set meanwhile; the answer is built
        // from the request, so it is older than the read that already landed.
        const stored = closet.find((item) => item.id === blueTop.id)!
        closet = closet.map((item) =>
          item.id === blueTop.id ? { ...stored, material: 'wool' } : item
        )
        delete body.expected
        return HttpResponse.json({ data: { ...blueTop, ...body } })
      })
    )
    render(<WardrobePage />)
    signIn()
    await user.click(await screen.findByTestId('garment-open-blue-top'))
    await user.click(await screen.findByTestId('garment-edit-tags'))
    await user.click(screen.getByTestId('garment-tag-option-material-wool'))
    await user.click(screen.getByTestId('garment-tag-done'))

    // While the save is in flight, another device changes comfort and the closet re-reads it
    // (a photo load error asks for a fresh read).
    closet = closet.map((item) =>
      item.id === blueTop.id ? { ...item, comfortRange: 'hot' } : item
    )
    const readsBefore = reads
    fireEvent.error(
      within(screen.getByTestId('garment-detail')).getByRole('img', { name: 'Blue top' })
    )
    await waitFor(() => expect(reads).toBe(readsBefore + 1))
    await waitFor(() =>
      expect(screen.getByTestId('garment-detail-comfort')).toHaveTextContent('Hot')
    )

    held.resolve()

    // The delayed answer (comfort Mild) is not applied; the closet reads again instead.
    await waitFor(() => expect(reads).toBe(readsBefore + 2))
    await waitFor(() =>
      expect(screen.getByTestId('garment-detail-material')).toHaveTextContent('Wool')
    )
    expect(screen.getByTestId('garment-detail-comfort')).toHaveTextContent('Hot')
  })
})

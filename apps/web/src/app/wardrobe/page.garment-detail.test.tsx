// Story 7.5 test plan 7.5-CMP-002..004: the Closet grid opens a ready garment's detail at
// /wardrobe?garment=<id>, keeps the grid mounted for back, and names photos by color plus
// category.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('next/navigation', () => ({ usePathname: () => '/wardrobe' }))

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

beforeEach(() => {
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

afterEach(() => {
  cleanup()
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
    expect(within(detail).getByRole('heading', { name: 'Blue top' })).toHaveFocus()
    expect(within(detail).getByTestId('garment-detail-category')).toHaveTextContent(
      /^Top$/
    )
    expect(within(detail).getByTestId('garment-detail-back')).toBeVisible()
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

    await user.click(screen.getByTestId('garment-detail-back'))

    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    expect(window.location.search).toBe('')
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
    expect(within(detail).getByRole('heading', { name: 'Blue top' })).toBeVisible()

    await user.click(within(detail).getByTestId('garment-detail-back'))
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
      expect(screen.getByTestId('garment-detail-back')).toBeVisible()
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
    const detail = screen.getByTestId('garment-detail')
    expect(
      within(detail).getByRole('heading', { name: 'Blue outer layer' })
    ).toBeVisible()
    await user.click(within(detail).getByTestId('garment-detail-back'))
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    expect(screen.getByTestId('garment-open-blue-top')).toHaveAccessibleName(
      'Blue outer layer'
    )
    expect(card('blue-top').getByTestId('garment-card-label')).toHaveTextContent(
      'Outer layer'
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
    expect(await within(panel).findByRole('heading', { name: 'Look 1' })).toBeVisible()
  })

  it('[P1] [7.5-CMP-016] a saved look anchored on the piece follows its tags through edit and Undo (Codex P2.7)', async () => {
    const user = userEvent.setup()
    const { SAMPLE_CATALOG, stylePieceAnchor, stylePieceLooks } = await import(
      '@couture/utils'
    )
    const look = stylePieceLooks(stylePieceAnchor(blueTop)!, 'mild-dry', SAMPLE_CATALOG)
      .looks[0]!
    savedLooksStore.items.push({
      id: 'look-on-blue-top',
      ownerUserId: owner,
      source: 'style_piece',
      lookId: look.recipe.lookId,
      weather: 'mild-dry',
      title: 'Blue top look',
      anchorGarmentId: blueTop.id,
      anchorSnapshot: { garmentId: blueTop.id, category: 'top', comfortRange: 'mild' },
      composition: [
        {
          slotIndex: 0,
          category: 'top',
          kind: 'garment',
          itemId: blueTop.id,
          label: null,
          missing: false,
          imageAccess: blueTop.imageAccess,
        },
        ...look.companions.map((companion, index) => ({
          slotIndex: index + 1,
          category: companion.category,
          kind: 'catalog' as const,
          itemId: companion.id,
          label: null,
          missing: false,
          imageAccess: null,
        })),
      ],
      swaps: {},
      collection: null,
      comfort: null,
      availabilityStatus: 'ready',
      missingGarmentIds: [],
      needsReviewReasons: [],
      revision: 0,
      createdAt: '2026-11-22T01:00:00.000Z',
      updatedAt: '2026-11-22T01:00:00.000Z',
    })
    render(<WardrobePage />)
    signIn()
    await user.click(await screen.findByRole('button', { name: 'Show saved looks' }))
    expect(await screen.findByText('Blue top look')).toBeInTheDocument()
    expect(screen.queryByTestId('saved-look-needs-review')).toBeNull()

    await user.click(screen.getByTestId('garment-open-blue-top'))
    await user.click(await screen.findByTestId('garment-edit-tags'))
    await user.click(screen.getByTestId('garment-tag-option-category-outerwear'))
    await user.click(screen.getByTestId('garment-tag-done'))
    // The committed edit refreshes saved looks: the look now needs review.
    expect(await screen.findByTestId('saved-look-needs-review')).toBeInTheDocument()

    await user.click(await screen.findByTestId('status-bar-action-undo'))
    await waitFor(() =>
      expect(screen.queryByTestId('saved-look-needs-review')).toBeNull()
    )
    await user.click(screen.getByTestId('garment-detail-back'))
    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    expect(screen.getByText('Blue top look')).toBeVisible()
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
    await user.click(screen.getByTestId('garment-detail-back'))

    await waitFor(() => expect(screen.queryByTestId('garment-detail')).toBeNull())
    // Back steps through history instead of writing a second grid entry over the detail.
    expect(back).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  })
})

// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-UNIT-022e, carried from 7.5-CMP-016 (Codex P2.7; TEA
// assertion review round 2, P2 #1). A tag edit and its Undo in the Closet drive the anchored
// saved look's state on Looks, through one shared fixture the way the API derives it.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GarmentWithColor } from '@couture/api-client/contracts/http'
import {
  createCompletedOnboardingStateFixture,
  createReadyGarmentFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'
import { SAMPLE_CATALOG, stylePieceAnchor, stylePieceLooks } from '@couture/utils'
import { clearAppHistory } from '../../lib/app-history'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import { screenSnapshot } from '../../lib/screen-snapshot'
import type * as WebSession from '../../lib/web-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  createSavedLooksMswHandlers,
  type SavedLooksMswStore,
} from '../../test-utils/saved-looks-msw'
import WardrobePage from '../wardrobe/page'
import LooksPage from './page'

const session = vi.hoisted(() => ({ owner: null as string | null }))
vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.owner,
}))
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

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
  usePathname: () => window.location.pathname,
  // The Closet reads the open garment from the address; Looks reads its segment and filter
  // there and, with neither set, opens on Saved once a saved look exists.
  useSearchParams: () => useMockSearchParams(),
}))

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

const api = 'http://looks-anchor-tags.test/api/v1'
const owner = 'looks-member'

const blueTop: GarmentWithColor = {
  ...createReadyGarmentFixture({
    id: 'blue-top',
    imageAccess: {
      url: 'https://photos.example.test/blue-top.png',
      expiresAt: '2090-01-01T00:00:00.000Z',
    },
  }),
  colorFamily: 'blue',
}

/** Noon UTC reads as Nov 22 in every time zone from UTC-11 to UTC+11. */
const SAVED_AT = '2026-11-22T12:00:00.000Z'
const SAVED_LINE = 'Saved Nov 22'

let closet: GarmentWithColor[]
let savedLooksStore: SavedLooksMswStore

function signIn() {
  act(() => {
    session.owner = owner
    sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, owner)
    window.dispatchEvent(new Event('couture:session'))
  })
}

/** A saved look anchored on the blue top, saved while it was tagged top and mild. */
function seedAnchoredLook() {
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
    // Stored as Ready; every read re-derives it from the live tags (saved-looks-msw).
    availabilityStatus: 'ready',
    missingGarmentIds: [],
    needsReviewReasons: [],
    revision: 0,
    createdAt: SAVED_AT,
    updatedAt: SAVED_AT,
  })
}

/** Mounts Looks the way a tab return does and returns its saved look tile's queries. */
function openLooks() {
  const view = render(<LooksPage />)
  const tile = () =>
    within(view.container).getByTestId('saved-look-card-look-on-blue-top')
  return { view, tile }
}

beforeEach(() => {
  screenSnapshot.clear()
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', api.slice(0, -'/api/v1'.length))
  window.history.replaceState(null, '', '/wardrobe')
  closet = [blueTop]
  const savedLooks = createSavedLooksMswHandlers([], `${api}/wardrobe/saved-looks`)
  savedLooksStore = savedLooks.store
  // One fixture: the saved looks read derives Ready or Needs review (category_changed,
  // comfort_range_changed) from these live tags against the look's anchorSnapshot, as the API
  // does, and the garment PATCH below writes them.
  savedLooksStore.garmentTagsById.set(blueTop.id, {
    category: 'top',
    comfortRange: 'mild',
  })
  seedAnchoredLook()
  useMswHandlers(
    http.get(`${api}/wardrobe/garments`, () => HttpResponse.json({ data: closet })),
    http.patch(`${api}/wardrobe/garments/:id/tags`, async ({ params, request }) => {
      const body = (await request.json()) as Record<string, unknown>
      delete body.expected
      const current = closet.find((item) => item.id === params.id)!
      const updated = { ...current, ...body } as GarmentWithColor
      if (updated.category && updated.comfortRange)
        savedLooksStore.garmentTagsById.set(updated.id, {
          category: updated.category,
          comfortRange: updated.comfortRange,
        })
      closet = closet.map((item) => (item.id === updated.id ? updated : item))
      return HttpResponse.json({ data: updated })
    }),
    ...savedLooks.handlers,
    http.get(`${api}/wardrobe/:ownerUserId/capsules`, () =>
      HttpResponse.json({ data: [], total: 0, limit: 50, offset: 0 })
    ),
    http.get(`${api}/wardrobe/onboarding`, () =>
      HttpResponse.json({ data: createCompletedOnboardingStateFixture() })
    ),
    http.get(`${api}/user/profile`, () =>
      HttpResponse.json({
        user: {
          id: owner,
          email: 'looks@example.test',
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
  // jsdom keeps one history per file: let any back step the Closet started land first.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  window.history.pushState(null, '', '/wardrobe')
  clearAppHistory()
  window.history.replaceState(null, '', '/wardrobe')
  screenSnapshot.clear()
  session.owner = null
  sessionStorage.clear()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('7.12 Looks follows the anchor piece tags edited in the Closet', () => {
  /**
   * The Closet stays mounted while Looks mounts and unmounts beside it, so the edit's Undo
   * notice is still live after the first trip to Looks. Each Looks mount first paints the last
   * snapshot, so every expected state below can only come from a fresh read of the fixture.
   */
  it('[P1] [7.5-CMP-016] 7.12-UNIT-022e a tag edit turns the saved look to Needs review on Looks, and its Undo turns it back to the saved date', async () => {
    const user = userEvent.setup()
    const category = () => closet.find((item) => item.id === blueTop.id)?.category
    render(<WardrobePage />)
    signIn()

    // Before the edit the look reads its saved date.
    const before = openLooks()
    await waitFor(() =>
      expect(before.tile()).toHaveAccessibleName(`Blue top look, ${SAVED_LINE}`)
    )
    expect(within(before.tile()).getByText(SAVED_LINE)).toBeVisible()
    before.view.unmount()

    await user.click(await screen.findByTestId('garment-open-blue-top'))
    await user.click(await screen.findByTestId('garment-edit-tags'))
    await user.click(screen.getByTestId('garment-tag-option-category-outerwear'))
    await user.click(screen.getByTestId('garment-tag-done'))
    await waitFor(() => expect(category()).toBe('outerwear'))
    // The Undo notice is up before Looks opens, so the edit is committed and undoable.
    expect(await screen.findByTestId('status-bar-action-undo')).toBeVisible()

    const edited = openLooks()
    await waitFor(() =>
      expect(edited.tile()).toHaveAccessibleName('Blue top look, Needs review')
    )
    expect(within(edited.tile()).getByText('Needs review')).toBeVisible()
    edited.view.unmount()

    await user.click(screen.getByTestId('status-bar-action-undo'))
    await waitFor(() => expect(category()).toBe('top'))

    const undone = openLooks()
    // Exactly the saved-date line: neither Needs review nor a missing-piece line.
    await waitFor(() =>
      expect(undone.tile()).toHaveAccessibleName(`Blue top look, ${SAVED_LINE}`)
    )
    expect(within(undone.tile()).getByText(SAVED_LINE)).toBeVisible()
  })
})

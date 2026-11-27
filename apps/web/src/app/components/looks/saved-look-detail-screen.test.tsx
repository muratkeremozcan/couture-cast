// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-UNIT-040 (D5, P6, P10, T2, T3: the saved look detail reads
// the one look, shows the missing and needs-review notices, Remove sends If-Match, shows Undo and
// returns to Saved with the origin filter; a gone or foreign id reads "This look is no longer
// saved"; signed out sends no read; Reopen follows the CC-7.2 rule) and 7.12-UNIT-061 (its parent
// is Looks Saved with the origin filter). The behaviour cases moved here from
// app/wardrobe/saved-looks-row.test.tsx when the Closet row was deleted (D8).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  getGuestPreviewStrings,
  SAMPLE_CATALOG,
  sampleLookText,
  stylePieceAnchor,
  stylePieceLooks,
} from '@couture/utils'
import type * as SavedLooksModule from '../../../lib/saved-looks'
import type * as WardrobeModule from '../../../lib/wardrobe'
import type * as AppHistoryModule from '../../../lib/app-history'
import type * as WebSessionModule from '../../../lib/web-session'
import { SavedLookRequestError } from '../../../lib/saved-looks'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/wardrobe'
import {
  FIXTURE_ACCESS_TOKEN,
  signInFixtureMember,
} from '../../../test-utils/member-session'
import { SaveFeedbackProvider } from '../save-feedback'
import { SavedLookDetailScreen } from './saved-look-detail-screen'
import SavedLookPage from '../../looks/saved/[savedLookId]/page'

const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
  forward: vi.fn(),
}))
const params = vi.hoisted(() => ({ savedLookId: 'sl-1' }))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/looks/saved/sl-1',
  useParams: () => params,
  useSearchParams: () => useMockSearchParams(),
}))

/**
 * The query `useSearchParams` answers. `openAt` moves it with the address; `clientNavigate` moves
 * it alone, as a Next client navigation renders the new page before `window.location` holds it.
 */
const address = { search: '' }
const ADDRESS_EVENT = 'test:saved-look-address'
function useMockSearchParams() {
  const search = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(ADDRESS_EVENT, onChange)
      return () => window.removeEventListener(ADDRESS_EVENT, onChange)
    },
    () => address.search,
    () => ''
  )
  return new URLSearchParams(search)
}
function clientNavigate(search: string) {
  act(() => {
    address.search = search
    window.dispatchEvent(new Event(ADDRESS_EVENT))
  })
}
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

const api = vi.hoisted(() => ({
  get: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  notify: vi.fn(),
  garments: vi.fn(),
  listForPiece: vi.fn(),
  below: vi.fn(() => false),
}))
vi.mock('../../../lib/saved-looks', async (importOriginal) => ({
  ...(await importOriginal<typeof SavedLooksModule>()),
  getSavedLookFromWeb: api.get,
  deleteSavedLookFromWeb: api.remove,
  restoreSavedLookFromWeb: api.restore,
  notifySavedLooksChanged: api.notify,
  // The Style this piece panel Reopen opens reads its anchor's saved looks.
  listSavedLooksFromWeb: api.listForPiece,
}))
vi.mock('../../../lib/wardrobe', async (importOriginal) => ({
  ...(await importOriginal<typeof WardrobeModule>()),
  listGarmentsFromWeb: api.garments,
}))
// A verified member (Codex 7.12 #3); null leaves the e2e fixture bearer path in charge.
const identity = vi.hoisted(() => ({ owner: null as string | null }))
vi.mock('../../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSessionModule>()),
  webSessionIdentity: () => identity.owner,
}))
vi.mock('../../../lib/app-history', async (importOriginal) => ({
  ...(await importOriginal<typeof AppHistoryModule>()),
  hasAppHistoryBelow: api.below,
}))

/** The owner every e2e fixture bearer reads as (lib/use-web-session.ts). */
const FIXTURE_OWNER = 'bearer'
const GONE = 'This look is no longer saved'

const ACTIVE_GARMENT: GarmentItemContract = {
  id: 'garment-1',
  status: 'ready',
  category: 'top',
  material: 'cotton',
  comfortRange: 'mild',
  tagsConfirmedAt: '2026-11-20T00:00:00.000Z',
  fileSizeBytes: 2048,
  mimeType: 'image/png',
  retentionStatus: 'active',
  createdAt: '2026-11-20T00:00:00.000Z',
  committedAt: '2026-11-20T00:00:00.000Z',
  imageAccess: {
    url: 'https://photos.example.test/garment-1.png',
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
}

/** A Style this piece look whose slots the editor rebuilds exactly (CC-7.2 AC1). */
function makeExactEditorLook(
  overrides: Partial<SavedLookContract> = {}
): SavedLookContract {
  const selection = stylePieceAnchor(ACTIVE_GARMENT)!
  const generated = stylePieceLooks(selection, 'warm-rainy', SAMPLE_CATALOG).looks[0]!
  return {
    id: 'sl-1',
    ownerUserId: 'user-1',
    source: 'style_piece',
    lookId: generated.recipe.lookId,
    weather: 'warm-rainy',
    title: 'Rainy commute',
    anchorGarmentId: ACTIVE_GARMENT.id,
    anchorSnapshot: {
      garmentId: ACTIVE_GARMENT.id,
      category: 'top',
      comfortRange: 'mild',
    },
    composition: [
      {
        slotIndex: 0,
        category: 'top',
        kind: 'garment',
        itemId: ACTIVE_GARMENT.id,
        label: null,
        missing: false,
        imageAccess: {
          url: 'https://photos.example.test/garment-1.png',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      },
      ...generated.companions.map((companion, idx) => ({
        slotIndex: idx + 1,
        category: companion.category,
        kind: 'catalog' as const,
        itemId: companion.id,
        label: null,
        missing: false,
        imageAccess: null,
      })),
    ],
    swaps: generated.recipe.swaps,
    collection: null,
    comfort: null,
    availabilityStatus: 'ready',
    missingGarmentIds: [],
    needsReviewReasons: [],
    revision: 4,
    createdAt: '2026-11-22T01:00:00.000Z',
    updatedAt: '2026-11-22T01:00:00.000Z',
    ...overrides,
  }
}

function homeSampleLook(overrides: Partial<SavedLookContract> = {}): SavedLookContract {
  return makeExactEditorLook({
    source: 'home_sample',
    lookId: SAMPLE_CATALOG.looks[0]!.id,
    anchorGarmentId: null,
    anchorSnapshot: null,
    ...overrides,
  })
}

const startUrl = window.location.href

function openAt(url: string) {
  window.history.replaceState(null, '', url)
  address.search = new URL(url, window.location.origin).search
  window.dispatchEvent(new Event(ADDRESS_EVENT))
}

function renderDetail(savedLookId = 'sl-1') {
  return render(
    <SaveFeedbackProvider>
      <SavedLookDetailScreen savedLookId={savedLookId} />
    </SaveFeedbackProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.below.mockReturnValue(false)
  api.get.mockResolvedValue(makeExactEditorLook())
  api.remove.mockResolvedValue(undefined)
  api.restore.mockResolvedValue(makeExactEditorLook({ revision: 5 }))
  api.garments.mockResolvedValue([ACTIVE_GARMENT])
  api.listForPiece.mockResolvedValue([])
  openAt('/looks/saved/sl-1')
})

afterEach(() => {
  identity.owner = null
  window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
  window.history.replaceState(null, '', startUrl)
  address.search = ''
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})

describe('7.12 saved look detail (D5)', () => {
  it('[7.14-PIC-005] shows the worn date and forecast condition for a saved Today look', async () => {
    signInFixtureMember()
    api.get.mockResolvedValue(
      homeSampleLook({
        title: 'Rain-ready look',
        lookId: 'today:2026-11-20:rec-1',
        weather: 'rain',
        wornOn: '2026-11-20',
      })
    )
    renderDetail()
    const detail = await screen.findByTestId('saved-look-detail')
    expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent('Rain-ready look')
    expect(detail).toHaveTextContent(/Rain.*From Today.*Nov 20, 2026/i)
  })

  it('7.12-UNIT-040a reads the one look with the bearer and shows its pieces in stored slot order under its name', async () => {
    signInFixtureMember()
    const base = makeExactEditorLook()
    const reordered = makeExactEditorLook({
      composition: [
        base.composition[0]!,
        { ...base.composition[base.composition.length - 1]!, slotIndex: 1 },
        { ...base.composition[1]!, slotIndex: 2 },
      ],
    })
    api.get.mockResolvedValue(reordered)

    renderDetail()

    const detail = await screen.findByTestId('saved-look-detail')
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.get).toHaveBeenCalledWith('sl-1', {
      accessToken: FIXTURE_ACCESS_TOKEN,
      signal: expect.any(AbortSignal) as unknown,
    })
    expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent(/^Rainy commute$/)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const slots = Array.from(detail.querySelectorAll('[data-slot-item-id]')).map((el) =>
      el.getAttribute('data-slot-item-id')
    )
    expect(slots).toEqual(reordered.composition.map((slot) => slot.itemId))
    expect(screen.queryByTestId('saved-look-detail-missing')).toBeNull()
    expect(screen.queryByTestId('saved-look-detail-needs-review')).toBeNull()
    // A reordered look is not one the editor rebuilds exactly, so it stays in its detail, even
    // once the closet read has answered.
    await waitFor(() => expect(api.garments).toHaveBeenCalledTimes(1))
    await act(async () => {
      await api.garments.mock.results[0]!.value
    })
    expect(screen.queryByTestId('saved-look-reopen')).toBeNull()
  })

  it('7.12-UNIT-040b an untitled look is named after its sample look', async () => {
    signInFixtureMember()
    const look = homeSampleLook({ title: null })
    api.get.mockResolvedValue(look)

    renderDetail()

    await screen.findByTestId('saved-look-detail')
    const name = sampleLookText({ id: look.lookId }, getGuestPreviewStrings('en-US')).name
    expect(name).not.toBe('')
    expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent(name)
  })

  it('7.12-UNIT-040c shows the missing-piece notice with a dashed slot, and the needs-review notice', async () => {
    signInFixtureMember()
    api.get.mockResolvedValueOnce(
      homeSampleLook({
        availabilityStatus: 'missing_garment',
        missingGarmentIds: ['garment-gone'],
        composition: [
          {
            slotIndex: 0,
            category: 'top',
            kind: 'garment',
            itemId: 'garment-gone',
            label: null,
            missing: true,
            imageAccess: null,
          },
        ],
      })
    )
    const { unmount } = renderDetail()

    expect(await screen.findByTestId('saved-look-detail-missing')).toHaveTextContent(
      'A piece in this look is gone from your closet.'
    )
    expect(screen.getByTestId('saved-look-slot-0')).toHaveTextContent('Missing piece')
    expect(screen.queryByTestId('saved-look-detail-needs-review')).toBeNull()
    unmount()

    api.get.mockResolvedValueOnce(
      homeSampleLook({
        availabilityStatus: 'needs_review',
        needsReviewReasons: ['category_changed'],
      })
    )
    renderDetail()
    expect(await screen.findByTestId('saved-look-detail-needs-review')).toHaveTextContent(
      'You changed tags on a piece in this look.'
    )
    expect(screen.queryByTestId('saved-look-detail-missing')).toBeNull()
  })

  it('7.12-UNIT-040d a photo that fails to load swaps to the placeholder in place', async () => {
    signInFixtureMember()
    api.get.mockResolvedValue(
      homeSampleLook({
        composition: [
          {
            slotIndex: 0,
            category: 'top',
            kind: 'garment',
            itemId: 'garment-1',
            label: null,
            missing: false,
            imageAccess: {
              url: 'https://photos.example.test/403.png',
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
          },
        ],
      })
    )
    renderDetail()

    const slot = await screen.findByTestId('saved-look-slot-0')
    const img = slot.querySelector('img')!
    expect(img).toHaveAttribute('src', 'https://photos.example.test/403.png')
    expect(img).toHaveAttribute('alt', '')
    fireEvent.error(img)
    expect(within(slot).getByTestId('saved-look-photo-placeholder')).toBeVisible()
    expect(slot.querySelector('img')).toBeNull()
    expect(slot).toHaveTextContent('Photo unavailable')
  })

  it.each([
    ['removed', 404],
    ["another member's", 403],
    ['malformed', 400],
  ])(
    '7.12-UNIT-040e a %s id reads "This look is no longer saved" with no title or image, and back to Saved',
    async (_label, status) => {
      signInFixtureMember()
      api.get.mockRejectedValue(
        new SavedLookRequestError('Not found', status, 'SAVED_LOOK_NOT_FOUND')
      )

      renderDetail('sl-gone')

      expect(await screen.findByTestId('saved-look-detail-gone')).toHaveTextContent(GONE)
      expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent(/^Saved$/)
      expect(screen.queryByTestId('saved-look-detail')).toBeNull()
      expect(screen.queryByTestId('saved-look-detail-remove')).toBeNull()
      expect(screen.getByRole('main').querySelectorAll('img')).toHaveLength(0)
      expect(screen.queryByRole('alert')).toBeNull()
      fireEvent.click(screen.getByTestId('app-top-bar-back'))
      expect(router.replace).toHaveBeenCalledExactlyOnceWith('/looks?segment=saved')
    }
  )

  it('7.12-UNIT-040f a failed read shows the load error, not the gone line', async () => {
    signInFixtureMember()
    api.get.mockRejectedValue(new SavedLookRequestError('Unavailable', 503))

    renderDetail()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load your saved looks.'
    )
    expect(screen.queryByText(GONE)).toBeNull()
  })

  it('7.12-UNIT-040g signed out asks to sign in and sends no read', () => {
    renderDetail()

    const signedOut = screen.getByTestId('saved-look-detail-signed-out')
    expect(signedOut).toHaveTextContent('Sign in to see your saved looks')
    expect(within(signedOut).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/signin'
    )
    expect(api.get).not.toHaveBeenCalled()
    expect(api.garments).not.toHaveBeenCalled()
    expect(screen.queryByTestId('saved-look-detail-remove')).toBeNull()
  })

  it('7.12-UNIT-040h the route decodes its id param', async () => {
    signInFixtureMember()
    params.savedLookId = 'sl%201'
    try {
      render(
        <SaveFeedbackProvider>
          <SavedLookPage />
        </SaveFeedbackProvider>
      )
      await screen.findByTestId('saved-look-detail')
      expect(api.get).toHaveBeenCalledWith('sl 1', expect.anything())
      expect(screen.getByTestId('saved-look-detail')).toHaveAttribute(
        'data-saved-look-id',
        'sl 1'
      )
    } finally {
      params.savedLookId = 'sl-1'
    }
  })
})

describe('7.12 saved look detail hardening (Codex 7.12 #3, #7, #10)', () => {
  function publishVerified(member: string | null) {
    act(() => {
      identity.owner = member
      if (member) window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, member)
      else window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
      window.dispatchEvent(new Event('couture:session'))
    })
  }

  const photo = (url: string, expiresAt = '2099-01-01T00:00:00.000Z') =>
    homeSampleLook({
      title: 'Member A secret look',
      composition: [
        {
          slotIndex: 0,
          category: 'top',
          kind: 'garment',
          itemId: 'garment-1',
          label: null,
          missing: false,
          imageAccess: { url, expiresAt },
        },
      ],
    })

  it("7.12-UNIT-040t a verified account switch hides the previous member's title and photos at once, while the new read is out", async () => {
    publishVerified('member-a')
    api.get.mockResolvedValueOnce(photo('https://photos.example.test/member-a.png'))
    renderDetail()
    expect(await screen.findByTestId('app-top-bar-title')).toHaveTextContent(
      'Member A secret look'
    )
    await screen.findByTestId('saved-look-detail')

    const memberB = Promise.withResolvers<SavedLookContract>()
    api.get.mockReturnValueOnce(memberB.promise)
    publishVerified('member-b')

    // The same frame: nothing of member A's look is left on the screen.
    expect(screen.getByTestId('app-top-bar-title')).not.toHaveTextContent('Member A')
    expect(screen.queryByTestId('saved-look-detail')).toBeNull()
    expect(
      document.querySelector('img[src="https://photos.example.test/member-a.png"]')
    ).toBeNull()
    expect(screen.queryByTestId('saved-look-detail-remove')).toBeNull()
    expect(api.get).toHaveBeenLastCalledWith('sl-1', {
      accessToken: 'member-b',
      signal: expect.any(AbortSignal) as unknown,
    })

    await act(async () => {
      memberB.resolve(homeSampleLook({ title: 'Member B look' }))
      await memberB.promise
    })
    expect(await screen.findByTestId('app-top-bar-title')).toHaveTextContent(
      'Member B look'
    )
  })

  it('7.12-UNIT-040u a photo whose signed URL has expired shows the placeholder, not the image', async () => {
    signInFixtureMember()
    api.get.mockResolvedValue(
      photo('https://photos.example.test/expired.png', '2020-01-01T00:00:00.000Z')
    )
    renderDetail()

    const slot = await screen.findByTestId('saved-look-slot-0')
    expect(slot.querySelector('img')).toBeNull()
    expect(within(slot).getByTestId('saved-look-photo-placeholder')).toBeVisible()
  })

  it.each(['100%', '%E0%A4%A', 'sl-%'])(
    '7.12-UNIT-040v the route with the id %s renders the gone state without throwing',
    async (raw) => {
      signInFixtureMember()
      api.get.mockRejectedValue(
        new SavedLookRequestError('Not found', 404, 'SAVED_LOOK_NOT_FOUND')
      )
      params.savedLookId = raw
      try {
        render(
          <SaveFeedbackProvider>
            <SavedLookPage />
          </SaveFeedbackProvider>
        )
        expect(await screen.findByTestId('saved-look-detail-gone')).toHaveTextContent(
          GONE
        )
        expect(api.get).toHaveBeenCalledWith(raw, expect.anything())
        expect(screen.getByTestId('app-top-bar-back')).toBeVisible()
      } finally {
        params.savedLookId = 'sl-1'
      }
    }
  )

  // Codex TEA review #3: the Remove notice outlives the screen on the shared bar, so it belongs
  // to the member who acted. Carries the deleted Closet row's "Undo dismissed and inert" case.
  it("7.12-UNIT-040p2 a verified switch to member B takes A's Undo off the shared bar, and a late click on it restores nothing", async () => {
    const user = userEvent.setup()
    publishVerified('member-a')
    renderDetail()

    await user.click(await screen.findByTestId('saved-look-detail-remove'))
    await waitFor(() =>
      expect(api.remove).toHaveBeenCalledWith('sl-1', '"saved-look:sl-1:4"', {
        accessToken: 'member-a',
      })
    )
    const undo = await screen.findByTestId('status-bar-action-undo')
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent('Removed')

    publishVerified('member-b')

    await waitFor(() => expect(screen.queryByTestId('status-bar-action-undo')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.queryByTestId('status-feedback-bar')?.textContent ?? '').not.toContain(
      'Removed'
    )
    // A late click on the Undo that was visible at the switch.
    await act(async () => {
      undo.click()
      await Promise.resolve()
    })
    expect(api.restore).not.toHaveBeenCalled()
  })

  it('7.12-UNIT-040p3 the same member back on Saved keeps Undo through a session event, and it restores with their bearer', async () => {
    const user = userEvent.setup()
    publishVerified('member-a')
    const { rerender } = renderDetail()

    await user.click(await screen.findByTestId('saved-look-detail-remove'))
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledExactlyOnceWith('/looks?segment=saved')
    )
    await screen.findByTestId('status-bar-action-undo')

    // Remove returned to Saved: the detail is gone and the shared bar stays.
    rerender(
      <SaveFeedbackProvider>
        <div data-testid="looks-saved-stand-in" />
      </SaveFeedbackProvider>
    )
    expect(screen.queryByTestId('saved-look-detail')).toBeNull()
    // A session event that still names member A (a token refresh, another tab) keeps the notice.
    publishVerified('member-a')

    const undo = screen.getByTestId('status-bar-action-undo')
    expect(undo).toBeVisible()
    await user.click(undo)
    await waitFor(() =>
      expect(api.restore).toHaveBeenCalledExactlyOnceWith('sl-1', {
        accessToken: 'member-a',
      })
    )
  })
})

describe('7.12 saved look detail back and parent (D5, P10, 7.12-UNIT-061)', () => {
  it.each([
    ['/looks/saved/sl-1?from=all', '/looks?segment=saved'],
    ['/looks/saved/sl-1?from=today', '/looks?segment=saved&filter=today'],
    ['/looks/saved/sl-1?from=capsules', '/looks?segment=saved&filter=capsules'],
    ['/looks/saved/sl-1?from=elsewhere', '/looks?segment=saved'],
  ])('7.12-UNIT-061 %s has the parent %s', async (url, parent) => {
    signInFixtureMember()
    openAt(url)

    renderDetail()
    await screen.findByTestId('saved-look-detail')

    expect(screen.getByTestId('app-top-bar-back')).toHaveAttribute('href', parent)
    expect(screen.getByTestId('bottom-nav-looks')).toHaveAttribute('aria-current', 'page')
  })

  // TEA T4: a look opened by View (or a typed link) has no Saved page below it, so back always
  // replaces to Saved, even with app history below (the saving screen).
  it.each([
    ['cold', false],
    ['after View with history below', true],
  ])(
    '7.12-UNIT-061 with no origin, back replaces to Saved (%s)',
    async (_label, below) => {
      signInFixtureMember()
      api.below.mockReturnValue(below)
      renderDetail()
      await screen.findByTestId('saved-look-detail')

      const back = screen.getByTestId('app-top-bar-back')
      expect(back).toHaveTextContent('Back')
      fireEvent.click(back)

      expect(router.replace).toHaveBeenCalledExactlyOnceWith('/looks?segment=saved')
      expect(router.back).not.toHaveBeenCalled()
      expect(router.push).not.toHaveBeenCalled()
    }
  )

  // Fable review P1: a tile opens the detail by a client navigation, which renders it before
  // `window.location` holds the new address; `from` comes from the search params.
  it('7.12-UNIT-061c a client navigation from a tile keeps its from before the address bar moves, and follows a later search params change without a reload', async () => {
    signInFixtureMember()
    openAt('/looks?segment=saved&filter=today')
    clientNavigate('?from=today')

    renderDetail()
    await screen.findByTestId('saved-look-detail')
    expect(window.location.search).toBe('?segment=saved&filter=today')
    expect(screen.getByTestId('app-top-bar-back')).toHaveAttribute(
      'href',
      '/looks?segment=saved&filter=today'
    )

    clientNavigate('?from=capsules')
    expect(screen.getByTestId('app-top-bar-back')).toHaveAttribute(
      'href',
      '/looks?segment=saved&filter=capsules'
    )
    expect(screen.getByTestId('saved-look-detail')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('app-top-bar-back'))
    expect(router.replace).toHaveBeenCalledExactlyOnceWith(
      '/looks?segment=saved&filter=capsules'
    )
  })

  it('7.12-UNIT-061 a cold entry replaces to its parent; an in-app entry steps back', async () => {
    signInFixtureMember()
    openAt('/looks/saved/sl-1?from=today')
    renderDetail()
    await screen.findByTestId('saved-look-detail')

    fireEvent.click(screen.getByTestId('app-top-bar-back'))
    expect(router.replace).toHaveBeenCalledExactlyOnceWith(
      '/looks?segment=saved&filter=today'
    )
    expect(router.back).not.toHaveBeenCalled()

    router.replace.mockClear()
    api.below.mockReturnValue(true)
    fireEvent.click(screen.getByTestId('app-top-bar-back'))
    expect(router.back).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()
  })
})

describe('7.12 saved look detail Remove and Undo (D5, P10, T2)', () => {
  it('7.12-UNIT-040i Remove sends If-Match with the bearer, notifies, shows Undo, and Undo restores', async () => {
    const user = userEvent.setup()
    signInFixtureMember()
    renderDetail()

    await user.click(await screen.findByTestId('saved-look-detail-remove'))

    await waitFor(() =>
      expect(api.remove).toHaveBeenCalledWith('sl-1', '"saved-look:sl-1:4"', {
        accessToken: FIXTURE_ACCESS_TOKEN,
      })
    )
    expect(api.notify).toHaveBeenCalledExactlyOnceWith(FIXTURE_OWNER)
    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent('Removed')

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(api.restore).toHaveBeenCalledExactlyOnceWith('sl-1', {
        accessToken: FIXTURE_ACCESS_TOKEN,
      })
    )
    expect(api.notify).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['View (no origin)', '/looks/saved/sl-1', true, '/looks?segment=saved'],
    [
      'a tile, cold',
      '/looks/saved/sl-1?from=today',
      false,
      '/looks?segment=saved&filter=today',
    ],
    [
      'a tile, capsules, cold',
      '/looks/saved/sl-1?from=capsules',
      false,
      '/looks?segment=saved&filter=capsules',
    ],
  ])(
    '7.12-UNIT-040j Remove opened from %s replaces to Saved with the origin filter',
    async (_label, url, below, target) => {
      const user = userEvent.setup()
      signInFixtureMember()
      api.below.mockReturnValue(below)
      openAt(url)
      renderDetail()

      await user.click(await screen.findByTestId('saved-look-detail-remove'))

      await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith(target))
      expect(router.back).not.toHaveBeenCalled()
      expect(router.push).not.toHaveBeenCalled()
    }
  )

  it('7.12-UNIT-040k Remove opened from a tile with app history below steps back to that Saved page', async () => {
    const user = userEvent.setup()
    signInFixtureMember()
    api.below.mockReturnValue(true)
    openAt('/looks/saved/sl-1?from=all')
    renderDetail()

    await user.click(await screen.findByTestId('saved-look-detail-remove'))

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1))
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('7.12-UNIT-040l a look already gone (404 on delete) navigates with no Undo', async () => {
    const user = userEvent.setup()
    signInFixtureMember()
    api.remove.mockRejectedValueOnce(
      new SavedLookRequestError('Not found', 404, 'SAVED_LOOK_NOT_FOUND')
    )
    renderDetail()

    await user.click(await screen.findByTestId('saved-look-detail-remove'))

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledExactlyOnceWith('/looks?segment=saved')
    )
    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent('Removed')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(api.notify).toHaveBeenCalledExactlyOnceWith(FIXTURE_OWNER)
  })

  it('7.12-UNIT-040m a failed Remove stays on the look and offers Retry, which removes', async () => {
    const user = userEvent.setup()
    signInFixtureMember()
    api.remove
      .mockRejectedValueOnce(new SavedLookRequestError('Unavailable', 503))
      .mockResolvedValueOnce(undefined)
    renderDetail()

    await user.click(await screen.findByTestId('saved-look-detail-remove'))

    await user.click(await screen.findByTestId('status-bar-action-retry'))
    await waitFor(() => expect(api.remove).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeVisible()
    expect(router.replace).toHaveBeenCalledExactlyOnceWith('/looks?segment=saved')
  })

  it('7.12-UNIT-040n a failed Undo offers Retry, which restores', async () => {
    const user = userEvent.setup()
    signInFixtureMember()
    api.restore
      .mockRejectedValueOnce(new SavedLookRequestError('Unavailable', 503))
      .mockResolvedValueOnce(makeExactEditorLook({ revision: 5 }))
    renderDetail()

    await user.click(await screen.findByTestId('saved-look-detail-remove'))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await user.click(await screen.findByTestId('status-bar-action-retry'))

    await waitFor(() => expect(api.restore).toHaveBeenCalledTimes(2))
    expect(api.restore).toHaveBeenLastCalledWith('sl-1', {
      accessToken: FIXTURE_ACCESS_TOKEN,
    })
  })

  // Codex 7.12 #8: was "reads as offline with no Retry"; an offline Undo now keeps its recovery
  // action, so the member can still Undo once the network is back.
  it('7.12-UNIT-040n2 an Undo that fails on the transport keeps Undo, which restores after reconnect', async () => {
    const user = userEvent.setup()
    signInFixtureMember()
    api.restore
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(makeExactEditorLook({ revision: 5 }))
    renderDetail()

    await user.click(await screen.findByTestId('saved-look-detail-remove'))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    expect(api.restore).toHaveBeenCalledTimes(1)
    await user.click(await screen.findByTestId('status-bar-action-undo'))

    await waitFor(() => expect(api.restore).toHaveBeenCalledTimes(2))
    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent(
      'Change undone.'
    )
  })

  it('7.12-UNIT-040n3 an Undo pressed offline sends nothing, keeps Undo, and restores once online', async () => {
    const user = userEvent.setup()
    signInFixtureMember()
    renderDetail()

    await user.click(await screen.findByTestId('saved-look-detail-remove'))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await user.click(undo)

    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    expect(api.restore).not.toHaveBeenCalled()

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    await user.click(await screen.findByTestId('status-bar-action-undo'))
    await waitFor(() => expect(api.restore).toHaveBeenCalledTimes(1))
    expect(api.restore).toHaveBeenCalledWith('sl-1', {
      accessToken: FIXTURE_ACCESS_TOKEN,
    })
  })

  it('7.12-UNIT-040n4 a second Undo press while the restore is out sends no second request', async () => {
    const user = userEvent.setup()
    signInFixtureMember()
    const held = Promise.withResolvers<SavedLookContract>()
    api.restore.mockReturnValueOnce(held.promise)
    renderDetail()

    await user.click(await screen.findByTestId('saved-look-detail-remove'))
    const undo = await screen.findByTestId('status-bar-action-undo')
    act(() => undo.click())
    act(() => undo.click())
    await waitFor(() => expect(api.restore).toHaveBeenCalledTimes(1))

    await act(async () => {
      held.resolve(makeExactEditorLook({ revision: 5 }))
      await held.promise
    })
    expect(api.restore).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent(
      'Change undone.'
    )
  })

  it('7.12-UNIT-040o offline Remove sends nothing and says so; a transport failure reads as offline', async () => {
    const user = userEvent.setup()
    signInFixtureMember()
    renderDetail()
    const remove = await screen.findByTestId('saved-look-detail-remove')

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await user.click(remove)
    expect(api.remove).not.toHaveBeenCalled()
    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent(
      'You are offline. Save when you reconnect.'
    )
    expect(router.replace).not.toHaveBeenCalled()

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    api.remove.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.click(remove)
    await waitFor(() => expect(api.remove).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('7.12-UNIT-040p an Undo after the member signs out restores nothing', async () => {
    const user = userEvent.setup()
    signInFixtureMember()
    renderDetail()

    await user.click(await screen.findByTestId('saved-look-detail-remove'))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    act(() => {
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
      window.dispatchEvent(new Event('couture:session'))
    })
    // A late click on the Undo that was visible at the switch.
    await act(async () => {
      undo.click()
      await Promise.resolve()
    })
    expect(api.restore).not.toHaveBeenCalled()
  })

  it('7.12-UNIT-040q a delete that answers after the member signed out notifies nothing and does not navigate', async () => {
    signInFixtureMember()
    let finish!: () => void
    api.remove.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    renderDetail()
    fireEvent.click(await screen.findByTestId('saved-look-detail-remove'))
    await waitFor(() => expect(api.remove).toHaveBeenCalledTimes(1))

    act(() => {
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
      window.dispatchEvent(new Event('couture:session'))
    })
    await act(async () => {
      finish()
      await Promise.resolve()
    })

    expect(api.notify).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
    expect(router.back).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})

describe('7.12 saved look detail Reopen (T3, CC-7.2 AC1)', () => {
  it('7.12-UNIT-040r a ready Style this piece look whose anchor is in the closet reopens in the editor', async () => {
    const user = userEvent.setup()
    signInFixtureMember()
    renderDetail()

    const reopen = await screen.findByTestId('saved-look-reopen')
    expect(api.garments).toHaveBeenCalledTimes(1)
    await user.click(reopen)

    expect(await screen.findByTestId('style-piece-panel')).toBeVisible()
  })

  it.each([
    ['a home sample look', homeSampleLook(), false],
    [
      'a look that needs review',
      makeExactEditorLook({ availabilityStatus: 'needs_review' }),
      true,
    ],
    [
      'a look whose anchor left the closet',
      makeExactEditorLook({ anchorGarmentId: 'garment-gone' }),
      true,
    ],
  ])('7.12-UNIT-040s %s shows no Reopen', async (_label, look, readsCloset) => {
    signInFixtureMember()
    api.get.mockResolvedValue(look)
    renderDetail()

    await screen.findByTestId('saved-look-detail')
    if (readsCloset) {
      await waitFor(() => expect(api.garments).toHaveBeenCalledTimes(1))
      await act(async () => {
        await api.garments.mock.results[0]!.value
      })
    } else expect(api.garments).not.toHaveBeenCalled()
    expect(screen.queryByTestId('saved-look-reopen')).toBeNull()
    expect(screen.getByTestId('saved-look-detail-remove')).toBeVisible()
  })
})

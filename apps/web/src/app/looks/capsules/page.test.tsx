// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-UNIT-041 (D6, P7: `?capsule=` focuses a loaded card matched
// by equality; an unknown or hostile id does nothing) and 7.12-UNIT-061 (the manager's parent is
// Looks Saved with the Capsules filter). Moved from app/wardrobe/capsules/page.test.tsx with every
// case kept; the route is now /looks/capsules.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-CAPSULES-001 (D10: Capsules is a Looks sub-screen, so a
// direct entry's back replaces to /looks and the Looks tab is the active one).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
import React from 'react'
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import type { OutfitCapsuleContract } from '@couture/api-client/contracts/http'
import LooksCapsulesPage from './page'
import * as wardrobeApi from '../../../lib/wardrobe'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/browser-persistence'
import type * as WebSession from '../../../lib/web-session'
import { getI18n } from '../../../i18n'
import { clearAppHistory } from '../../../lib/app-history'

// Story CC-7.9 D6: the shared top bar reads the route to mark the active desktop tab.
// Story CC-7.11 D11: its back reads the router.
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
  usePathname: () => '/looks/capsules',
}))

vi.mock('../../../lib/wardrobe', () => ({
  listCapsulesFromWeb: vi.fn(),
  getCapsuleFromWeb: vi.fn(),
  listGarmentsFromWeb: vi.fn(),
  createCapsuleFromWeb: vi.fn(),
  updateCapsuleFromWeb: vi.fn(),
  favoriteCapsuleFromWeb: vi.fn(),
  deleteCapsuleFromWeb: vi.fn(),
  resolveCurrentUserId: vi.fn(),
}))

const SIGNED_IN_USER = 'user-signed-in'
const session = vi.hoisted(() => ({ owner: 'user-signed-in' }))

vi.mock('../../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.owner,
}))

function publishCapsuleOwner(owner: string) {
  session.owner = owner
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, `test-token-${owner}`)
  window.dispatchEvent(new Event('couture:session'))
}

beforeEach(() => publishCapsuleOwner(SIGNED_IN_USER))
afterEach(() => window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY))
// A test that renders another locale must not leak it into the next one.
afterEach(async () => {
  await getI18n().changeLanguage('en-US')
})

function buildCapsule(overrides: Partial<OutfitCapsuleContract> = {}) {
  return {
    id: 'cap-1',
    ownerUserId: SIGNED_IN_USER,
    name: 'Summer Basics',
    description: 'Light clothes for warm weather',
    occasions: ['casual'],
    isFavorite: true,
    revision: 3,
    availabilityStatus: 'ready',
    unavailableGarmentCount: 0,
    garments: [
      {
        id: 'g-1',
        category: 'top',
        material: 'cotton',
        comfortRange: 'warm',
        imageAccess: null,
        availabilityStatus: 'ready',
        garmentOrder: 0,
      },
      {
        id: 'g-2',
        category: 'bottom',
        material: 'denim',
        comfortRange: 'warm',
        imageAccess: null,
        availabilityStatus: 'ready',
        garmentOrder: 1,
      },
    ],
    createdAt: '2026-08-05T10:00:00Z',
    updatedAt: '2026-08-05T10:00:00Z',
    ...overrides,
  } as unknown as OutfitCapsuleContract
}

function mockPage(items: OutfitCapsuleContract[], total = items.length) {
  return { items, total, limit: 50, offset: 0 }
}

describe('LooksCapsulesPage account switch', () => {
  const memberA = buildCapsule({ name: 'Member A weekend capsule' })
  const memberB = buildCapsule({
    id: 'cap-b',
    ownerUserId: 'member-b',
    name: 'Member B travel capsule',
  })

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockImplementation(() =>
      Promise.resolve(session.owner)
    )
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockImplementation((owner) =>
      Promise.resolve(mockPage([owner === memberB.ownerUserId ? memberB : memberA]))
    )
    vi.mocked(wardrobeApi.listGarmentsFromWeb).mockResolvedValue([])
  })

  it('account switch discards a prior member’s late capsule read', async () => {
    const delayed = buildCapsule({ id: 'late-a', name: 'Member A private capsule' })
    const oldRefresh = Promise.withResolvers<ReturnType<typeof mockPage>>()
    const list = vi.mocked(wardrobeApi.listCapsulesFromWeb)

    render(<LooksCapsulesPage />)
    expect(await screen.findByRole('heading', { name: memberA.name })).toBeVisible()
    list.mockReturnValueOnce(oldRefresh.promise)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(list.mock.calls.at(-1)?.[0]).toBe(memberA.ownerUserId)
    expect(screen.getByTestId('capsule-loading-state')).toBeVisible()

    act(() => publishCapsuleOwner(memberB.ownerUserId))
    await act(async () => {
      oldRefresh.resolve(mockPage([delayed]))
      await oldRefresh.promise
    })

    expect(screen.queryByRole('heading', { name: delayed.name })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: memberB.name })).toBeVisible()
    expect(screen.queryByRole('heading', { name: memberA.name })).not.toBeInTheDocument()
  })

  it('account switch prevents confirmation of a prior member’s delete dialog', async () => {
    const user = userEvent.setup()
    vi.mocked(wardrobeApi.deleteCapsuleFromWeb).mockResolvedValue(undefined)

    render(<LooksCapsulesPage />)
    expect(await screen.findByRole('heading', { name: memberA.name })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /^Delete$/ }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this capsule?' })
    const confirm = within(dialog).getByRole('button', { name: 'Delete capsule' })

    await act(async () => {
      publishCapsuleOwner(memberB.ownerUserId)
      // Exercise a late click from the dialog that was visible at the switch.
      confirm.click()
      await Promise.resolve()
    })

    expect(wardrobeApi.deleteCapsuleFromWeb).not.toHaveBeenCalled()
    expect(dialog).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: memberB.name })).toBeVisible()
  })
})

// Story CC-7.12 D6, TEA P7: a Looks capsule tile opens the manager with `?capsule={id}`. The id
// is matched by equality against the loaded capsules, never put into a selector.
describe('7.12 LooksCapsulesPage capsule focus (D6, P7)', () => {
  const startUrl = window.location.href
  const scrollIntoView = vi.fn()
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

  beforeEach(() => {
    vi.resetAllMocks()
    // jsdom has no scrollIntoView; the spy records which card the manager scrolls to.
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    })
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockResolvedValue(SIGNED_IN_USER)
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([
        buildCapsule(),
        buildCapsule({ id: 'cap-2', name: 'Winter Layers' }),
        buildCapsule({ id: 'cap-3', name: 'Office Week' }),
      ])
    )
    vi.mocked(wardrobeApi.listGarmentsFromWeb).mockResolvedValue([])
    // An id outside the first page is read on its own (Codex 7.12 #4); unknown ids are a 404.
    vi.mocked(wardrobeApi.getCapsuleFromWeb).mockRejectedValue(
      new Error('Outfit capsule not found')
    )
  })

  afterEach(() => {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original)
    else delete (Element.prototype as Partial<Element>).scrollIntoView
    window.history.replaceState(null, '', startUrl)
  })

  it('7.12-UNIT-041a a known id scrolls to that card and focuses it on the first load', async () => {
    window.history.replaceState(null, '', '/looks/capsules?capsule=cap-2')
    render(<LooksCapsulesPage />)

    const card = await screen.findByTestId('capsule-card-cap-2')
    await waitFor(() => expect(card).toHaveFocus())
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(card)
    expect(card).toHaveAttribute('tabindex', '-1')
    // Only the matched card takes programmatic focus.
    expect(screen.getByTestId('capsule-card-cap-1')).not.toHaveAttribute('tabindex')
    expect(screen.getByTestId('capsule-card-cap-3')).not.toHaveAttribute('tabindex')

    // A refetch (window focus) does not move focus or scroll again.
    screen.getByTestId('create-capsule-button').focus()
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(wardrobeApi.listCapsulesFromWeb).toHaveBeenCalledTimes(2))
    await screen.findByTestId('capsule-card-cap-2')
    expect(screen.getByTestId('create-capsule-button')).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  // Codex 7.12 #4: Looks pages by creation time and the manager by its own order, so a tile's
  // capsule can sit outside the manager's first page; it is read by id and still focused.
  it('7.12-UNIT-041c a capsule outside the first page is read on its own, shown and focused', async () => {
    const deep = buildCapsule({ id: 'cap-99', name: 'Deep capsule' })
    vi.mocked(wardrobeApi.getCapsuleFromWeb).mockResolvedValue(deep)
    window.history.replaceState(null, '', '/looks/capsules?capsule=cap-99')
    render(<LooksCapsulesPage />)

    const card = await screen.findByTestId('capsule-card-cap-99')
    await waitFor(() => expect(card).toHaveFocus())
    expect(wardrobeApi.getCapsuleFromWeb).toHaveBeenCalledWith(
      SIGNED_IN_USER,
      'cap-99',
      expect.any(AbortSignal)
    )
    expect(within(card).getByRole('heading', { name: 'Deep capsule' })).toBeVisible()
    expect(scrollIntoView.mock.contexts).toEqual([card])
    // The first page stays as it was, and the read capsule shows once.
    expect(screen.getAllByTestId('capsule-card-cap-99')).toHaveLength(1)
    expect(screen.getByTestId('capsule-card-cap-1')).toBeVisible()
  })

  it('7.12-UNIT-041e a filtered list skips the extra read and does not show the pinned capsule', async () => {
    vi.mocked(wardrobeApi.getCapsuleFromWeb).mockResolvedValue(
      buildCapsule({ id: 'cap-99', name: 'Deep capsule' })
    )
    window.history.replaceState(null, '', '/looks/capsules?capsule=cap-99')
    render(<LooksCapsulesPage />)
    await screen.findByTestId('capsule-card-cap-99')
    expect(wardrobeApi.getCapsuleFromWeb).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByTestId('capsule-occasion-filter'), {
      target: { value: 'work' },
    })

    await waitFor(() =>
      expect(vi.mocked(wardrobeApi.listCapsulesFromWeb).mock.calls.at(-1)?.[1]).toEqual(
        expect.objectContaining({ occasion: 'work' })
      )
    )
    await waitFor(() => expect(screen.queryByTestId('capsule-card-cap-99')).toBeNull())
    expect(screen.getByTestId('capsule-card-cap-1')).toBeVisible()
    expect(wardrobeApi.getCapsuleFromWeb).toHaveBeenCalledTimes(1)
  })

  it('7.12-UNIT-041d a capsule on the first page is not read again', async () => {
    window.history.replaceState(null, '', '/looks/capsules?capsule=cap-3')
    render(<LooksCapsulesPage />)

    await waitFor(() => expect(screen.getByTestId('capsule-card-cap-3')).toHaveFocus())
    expect(wardrobeApi.getCapsuleFromWeb).not.toHaveBeenCalled()
  })

  it.each([
    ['an unknown id', 'cap-unknown'],
    ['another member id', 'cap-of-member-b'],
    ['a selector-breaking value', '"]\'><img src=x onerror=alert(1)>'],
    ['a selector list', 'cap-1, [data-testid]'],
  ])(
    '7.12-UNIT-041b %s scrolls nowhere, focuses nothing and shows no error',
    async (_label, value) => {
      const querySelector = vi.spyOn(Document.prototype, 'querySelector')
      window.history.replaceState(
        null,
        '',
        `/looks/capsules?capsule=${encodeURIComponent(value)}`
      )
      const imagesBefore = document.querySelectorAll('img').length
      render(<LooksCapsulesPage />)

      expect(await screen.findByTestId('capsule-card-cap-1')).toBeVisible()
      expect(screen.getByTestId('capsule-card-cap-3')).toBeVisible()
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(document.body)
      for (const id of ['cap-1', 'cap-2', 'cap-3'])
        expect(screen.getByTestId(`capsule-card-${id}`)).not.toHaveAttribute('tabindex')
      expect(screen.queryByTestId('capsule-error-banner')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
      // The raw value never reaches a selector or the DOM.
      for (const [selector] of querySelector.mock.calls)
        expect(String(selector)).not.toContain(value)
      expect(document.querySelectorAll('img')).toHaveLength(imagesBefore)
      querySelector.mockRestore()
    }
  )
})

describe('LooksCapsulesPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockResolvedValue(SIGNED_IN_USER)
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([buildCapsule()])
    )
    vi.mocked(wardrobeApi.listGarmentsFromWeb).mockResolvedValue([])
  })

  it('4.3-WEB-PAGE-01 renders the header and the fetched capsule grid', async () => {
    render(<LooksCapsulesPage />)

    expect(screen.getByRole('heading', { name: 'Outfit capsules' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Summer Basics')).toBeInTheDocument()
    })
    expect(screen.getByTestId('capsule-status-badge-cap-1')).toHaveTextContent('Ready')
  })

  it('7.9-WEB-CAPSULES-01 sits on the shared shell: one page surface, top bar with back, one card level', async () => {
    const { container } = render(<LooksCapsulesPage />)

    const header = screen.getByTestId('app-header')
    expect(within(header).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Outfit capsules'
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // CC-7.12 D6: the manager's back parent is Looks Saved with the Capsules filter.
    expect(within(header).getByTestId('app-top-bar-back')).toHaveAttribute(
      'href',
      '/looks?segment=saved&filter=capsules'
    )
    expect(container.querySelectorAll('[data-surface="page"]')).toHaveLength(1)
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')

    const card = await screen.findByTestId('capsule-card-cap-1')
    expect(card).toHaveAttribute('data-surface', 'card')
    expect(card.querySelector('[data-surface="card"]')).toBeNull()
    expect(within(card).getByText('2 garments')).toBeInTheDocument()
    expect(screen.getByTestId('create-capsule-button')).toHaveAttribute(
      'data-gold',
      'primary'
    )
  })

  it('7.11-CMP-CAPSULES-001 7.12-UNIT-061 a direct entry marks the Looks tab and its back replaces to Looks Capsules', async () => {
    clearAppHistory()
    render(<LooksCapsulesPage />)

    const tabs = within(screen.getByTestId('primary-nav'))
    expect(tabs.getByTestId('nav-looks')).toHaveAttribute('aria-current', 'page')
    expect(tabs.getByTestId('nav-wardrobe')).not.toHaveAttribute('aria-current')

    fireEvent.click(screen.getByTestId('app-top-bar-back'))

    expect(router.replace).toHaveBeenCalledExactlyOnceWith(
      '/looks?segment=saved&filter=capsules'
    )
    expect(router.back).not.toHaveBeenCalled()
    await screen.findByTestId('capsule-card-cap-1')
  })

  it('7.9-WEB-CAPSULES-02 renders the capsules screen from the de-DE catalog', async () => {
    await getI18n().changeLanguage('de-DE')
    render(<LooksCapsulesPage />)

    expect(
      within(screen.getByTestId('app-header')).getByRole('heading', { level: 1 })
    ).toHaveTextContent('Outfit-Kapseln')
    expect(screen.getByTestId('app-top-bar-back')).toHaveTextContent('Zurück')
    const card = await screen.findByTestId('capsule-card-cap-1')
    expect(within(card).getByText('Freizeit')).toBeInTheDocument()
    expect(within(card).getByText('2 Kleidungsstücke')).toBeInTheDocument()
    expect(screen.getByTestId('capsule-status-badge-cap-1')).toHaveTextContent('Bereit')
    expect(within(card).getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Löschen' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Arbeit' })).toBeInTheDocument()
  })

  /**
   * Regression: the page previously sent the literal string `current-user-id`
   * as the owner path segment, so every request 404ed for every real user.
   */
  it('4.3-WEB-PAGE-02 uses the signed-in user as the owner, not a placeholder', async () => {
    render(<LooksCapsulesPage />)

    await waitFor(() => {
      expect(wardrobeApi.listCapsulesFromWeb).toHaveBeenCalled()
    })
    expect(vi.mocked(wardrobeApi.listCapsulesFromWeb).mock.calls[0]?.[0]).toBe(
      SIGNED_IN_USER
    )
  })

  it('4.3-WEB-PAGE-03 surfaces a session error instead of querying with no user', async () => {
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockRejectedValue(
      new Error('Your session expired.')
    )

    render(<LooksCapsulesPage />)

    await waitFor(() => {
      expect(screen.getByTestId('capsule-error-banner')).toHaveTextContent(
        'Your session expired.'
      )
    })
    expect(wardrobeApi.listCapsulesFromWeb).not.toHaveBeenCalled()
  })

  /**
   * Regression: mutations previously sent a weak validator built from the
   * revision alone, which the server rejects. The strong entity tag names the
   * capsule so it cannot be replayed against a different resource.
   */
  it('4.3-WEB-PAGE-04 sends the strong entity tag when deleting', async () => {
    vi.mocked(wardrobeApi.deleteCapsuleFromWeb).mockResolvedValue(undefined)

    render(<LooksCapsulesPage />)
    await waitFor(() => {
      expect(screen.getByText('Summer Basics')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('delete-capsule-button-cap-1'))
    expect(screen.getByText('Delete this capsule?')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('confirm-delete-capsule-button'))

    await waitFor(() => {
      expect(wardrobeApi.deleteCapsuleFromWeb).toHaveBeenCalledWith(
        SIGNED_IN_USER,
        'cap-1',
        '"capsule:cap-1:3"',
        expect.any(AbortSignal)
      )
    })
  })

  it('4.3-WEB-PAGE-05 sends the strong entity tag when toggling favorite', async () => {
    vi.mocked(wardrobeApi.favoriteCapsuleFromWeb).mockResolvedValue(
      buildCapsule({ isFavorite: false })
    )

    render(<LooksCapsulesPage />)
    await waitFor(() => {
      expect(screen.getByText('Summer Basics')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('favorite-button-cap-1'))

    await waitFor(() => {
      expect(wardrobeApi.favoriteCapsuleFromWeb).toHaveBeenCalledWith(
        SIGNED_IN_USER,
        'cap-1',
        false,
        '"capsule:cap-1:3"',
        expect.any(AbortSignal)
      )
    })
  })

  /** The destructive confirmation must be a real dialog, not a bare div. */
  it('4.3-WEB-PAGE-06 renders the delete confirmation as an accessible dialog', async () => {
    render(<LooksCapsulesPage />)
    await waitFor(() => {
      expect(screen.getByText('Summer Basics')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('delete-capsule-button-cap-1'))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('Delete this capsule?')
  })

  it('4.3-WEB-PAGE-07 reports how many capsules are hidden by the page size', async () => {
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([buildCapsule()], 87)
    )

    render(<LooksCapsulesPage />)

    await waitFor(() => {
      expect(screen.getByTestId('capsule-truncation-notice')).toHaveTextContent(
        'Showing 1 of 87'
      )
    })
  })

  it('4.3-WEB-PAGE-08 shows the unavailable garment count on a capsule needing repair', async () => {
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([
        buildCapsule({ availabilityStatus: 'needs_repair', unavailableGarmentCount: 2 }),
      ])
    )

    render(<LooksCapsulesPage />)

    await waitFor(() => {
      expect(screen.getByTestId('capsule-unavailable-count-cap-1')).toHaveTextContent(
        '2 unavailable garments'
      )
    })
  })
})

function buildGarment(id: string, category: string) {
  return {
    id,
    status: 'ready',
    category,
    material: 'cotton',
    comfortRange: 'mild',
    tagsConfirmedAt: '2026-08-05T10:00:00Z',
    fileSizeBytes: 1024,
    mimeType: 'image/png',
    retentionStatus: 'active',
    createdAt: '2026-08-05T10:00:00Z',
    committedAt: '2026-08-05T10:00:00Z',
    imageAccess: null,
  } as unknown as Awaited<ReturnType<typeof wardrobeApi.listGarmentsFromWeb>>[number]
}

const BUILDER_GARMENTS = [buildGarment('g-1', 'top'), buildGarment('g-2', 'bottom')]

function fillBuilderForm(name: string) {
  fireEvent.change(screen.getByTestId('capsule-name-input'), { target: { value: name } })
  fireEvent.click(screen.getByTestId('garment-select-checkbox-g-1'))
  fireEvent.click(screen.getByTestId('garment-select-checkbox-g-2'))
}

describe('LooksCapsulesPage builder integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockResolvedValue(SIGNED_IN_USER)
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(mockPage([]))
    vi.mocked(wardrobeApi.listGarmentsFromWeb).mockResolvedValue(BUILDER_GARMENTS)
  })

  it('creates a capsule, announces it politely, and refetches the grid', async () => {
    vi.mocked(wardrobeApi.createCapsuleFromWeb).mockResolvedValue(buildCapsule())
    render(<LooksCapsulesPage />)
    await screen.findByTestId('capsule-empty-state')

    fireEvent.click(screen.getByTestId('create-capsule-button'))
    fillBuilderForm('Weekend')
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(wardrobeApi.createCapsuleFromWeb).toHaveBeenCalledWith(
        SIGNED_IN_USER,
        expect.objectContaining({ name: 'Weekend', garmentIds: ['g-1', 'g-2'] }),
        expect.any(String),
        expect.any(AbortSignal)
      )
    })
    await waitFor(() =>
      expect(screen.getByTestId('capsule-status-region')).toHaveTextContent(
        'Capsule created'
      )
    )
    // The grid must reflect the write without a manual reload.
    expect(wardrobeApi.listCapsulesFromWeb).toHaveBeenCalledTimes(2)
  })

  it('edits an existing capsule with its strong entity tag', async () => {
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([buildCapsule()])
    )
    vi.mocked(wardrobeApi.updateCapsuleFromWeb).mockResolvedValue(buildCapsule())
    render(<LooksCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('edit-capsule-button-cap-1'))
    expect(screen.getByTestId('capsule-name-input')).toHaveValue('Summer Basics')

    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Summer Basics v2' },
    })
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(wardrobeApi.updateCapsuleFromWeb).toHaveBeenCalledWith(
        SIGNED_IN_USER,
        'cap-1',
        expect.objectContaining({ name: 'Summer Basics v2' }),
        '"capsule:cap-1:3"',
        expect.any(AbortSignal)
      )
    })
    await waitFor(() =>
      expect(screen.getByTestId('capsule-status-region')).toHaveTextContent(
        'Capsule updated'
      )
    )
  })

  it('closes the builder without writing anything when cancelled', async () => {
    render(<LooksCapsulesPage />)
    await screen.findByTestId('capsule-empty-state')

    fireEvent.click(screen.getByTestId('create-capsule-button'))
    expect(screen.getByTestId('capsule-builder-form')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByTestId('capsule-builder-form')).not.toBeInTheDocument()
    )
    expect(wardrobeApi.createCapsuleFromWeb).not.toHaveBeenCalled()
  })

  it('refetches from the builder reload affordance after a stale precondition', async () => {
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([buildCapsule()])
    )
    vi.mocked(wardrobeApi.updateCapsuleFromWeb).mockRejectedValue(
      new Error('CAPSULE_REVISION_MISMATCH')
    )
    render(<LooksCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('edit-capsule-button-cap-1'))
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    const reload = await screen.findByTestId('capsule-reload-button')
    fireEvent.click(reload)

    // Reconciling means pulling the other client's committed revision, not
    // retrying the same doomed entity tag.
    await waitFor(() => expect(wardrobeApi.listCapsulesFromWeb).toHaveBeenCalledTimes(2))
  })

  it('keeps the builder closed until the session resolves', async () => {
    const user = userEvent.setup()
    const identity = Promise.withResolvers<string>()
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockReturnValue(identity.promise)
    render(<LooksCapsulesPage />)

    const create = screen.getByTestId('create-capsule-button')
    expect(create).toBeDisabled()
    await user.click(create)
    expect(screen.queryByTestId('capsule-builder-form')).not.toBeInTheDocument()
    expect(wardrobeApi.createCapsuleFromWeb).not.toHaveBeenCalled()
    expect(wardrobeApi.updateCapsuleFromWeb).not.toHaveBeenCalled()

    await act(async () => {
      identity.resolve(SIGNED_IN_USER)
      await identity.promise
    })
    expect(create).toBeEnabled()
    await user.click(create)
    expect(screen.getByTestId('capsule-builder-form')).toBeVisible()
  })
})

describe('LooksCapsulesPage filtering', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockResolvedValue(SIGNED_IN_USER)
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([buildCapsule()])
    )
    vi.mocked(wardrobeApi.listGarmentsFromWeb).mockResolvedValue([])
  })

  it('debounces typing into a single search query', async () => {
    render(<LooksCapsulesPage />)
    await screen.findByText('Summer Basics')

    const search = screen.getByTestId('capsule-search-input')
    fireEvent.change(search, { target: { value: 'su' } })
    fireEvent.change(search, { target: { value: 'sum' } })
    fireEvent.change(search, { target: { value: 'summer' } })

    await waitFor(() =>
      expect(vi.mocked(wardrobeApi.listCapsulesFromWeb).mock.calls.at(-1)?.[1]).toEqual(
        expect.objectContaining({ q: 'summer' })
      )
    )
    // One request for the whole burst, plus the initial load.
    expect(wardrobeApi.listCapsulesFromWeb).toHaveBeenCalledTimes(2)
  })

  it('sends the selected occasion as a server-side filter', async () => {
    render(<LooksCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.change(screen.getByTestId('capsule-occasion-filter'), {
      target: { value: 'work' },
    })

    await waitFor(() =>
      expect(vi.mocked(wardrobeApi.listCapsulesFromWeb).mock.calls.at(-1)?.[1]).toEqual(
        expect.objectContaining({ occasion: 'work' })
      )
    )
  })

  it('sends the favorites-only filter as a server-side filter', async () => {
    render(<LooksCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('capsule-favorite-filter'))

    await waitFor(() =>
      expect(vi.mocked(wardrobeApi.listCapsulesFromWeb).mock.calls.at(-1)?.[1]).toEqual(
        expect.objectContaining({ isFavorite: true })
      )
    )
  })

  it('refetches when the window regains focus so another client’s writes appear', async () => {
    render(<LooksCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.focus(window)

    await waitFor(() => expect(wardrobeApi.listCapsulesFromWeb).toHaveBeenCalledTimes(2))
  })

  it('renders a hollow star for a capsule that is not a favorite', async () => {
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([buildCapsule({ isFavorite: false })])
    )
    render(<LooksCapsulesPage />)

    const favorite = await screen.findByTestId('favorite-button-cap-1')
    expect(favorite).toHaveAttribute('aria-pressed', 'false')
    expect(favorite).toHaveTextContent('☆')
  })

  it('pluralizes a single unavailable garment correctly', async () => {
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([
        buildCapsule({ availabilityStatus: 'needs_repair', unavailableGarmentCount: 1 }),
      ])
    )
    render(<LooksCapsulesPage />)

    expect(
      await screen.findByTestId('capsule-unavailable-count-cap-1')
    ).toHaveTextContent('1 unavailable garment')
  })
})

describe('LooksCapsulesPage failure handling', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockResolvedValue(SIGNED_IN_USER)
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([buildCapsule()])
    )
    vi.mocked(wardrobeApi.listGarmentsFromWeb).mockResolvedValue([])
  })

  it('surfaces the reason when the capsule list fails to load', async () => {
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockRejectedValue(
      new Error('capsule service down')
    )
    render(<LooksCapsulesPage />)

    expect(await screen.findByTestId('capsule-error-banner')).toHaveTextContent(
      'capsule service down'
    )
    // The spinner must clear or the page looks permanently busy.
    expect(screen.queryByTestId('capsule-loading-state')).not.toBeInTheDocument()
  })

  it('falls back to translated copy when the load rejection is not an Error', async () => {
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockRejectedValue('ECONNRESET')
    render(<LooksCapsulesPage />)

    expect(await screen.findByTestId('capsule-error-banner')).toHaveTextContent(
      'Unable to load capsules.'
    )
  })

  it('falls back to generic copy when the session cannot be resolved at all', async () => {
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockRejectedValue('no session cookie')
    render(<LooksCapsulesPage />)

    expect(await screen.findByTestId('capsule-error-banner')).toHaveTextContent(
      'Sign in to manage capsules.'
    )
  })

  it('surfaces a failed favorite toggle', async () => {
    vi.mocked(wardrobeApi.favoriteCapsuleFromWeb).mockRejectedValue(
      new Error('precondition failed')
    )
    render(<LooksCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('favorite-button-cap-1'))

    expect(await screen.findByTestId('capsule-error-banner')).toHaveTextContent(
      'precondition failed'
    )
  })

  it('falls back to translated copy when a favorite toggle rejects with a non-Error', async () => {
    vi.mocked(wardrobeApi.favoriteCapsuleFromWeb).mockRejectedValue('socket hang up')
    render(<LooksCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('favorite-button-cap-1'))

    expect(await screen.findByTestId('capsule-error-banner')).toHaveTextContent(
      'Unable to save the capsule.'
    )
  })

  it('surfaces a failed delete and leaves the capsule in place', async () => {
    vi.mocked(wardrobeApi.deleteCapsuleFromWeb).mockRejectedValue(
      new Error('delete rejected')
    )
    render(<LooksCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('delete-capsule-button-cap-1'))
    fireEvent.click(screen.getByTestId('confirm-delete-capsule-button'))

    expect(await screen.findByTestId('capsule-error-banner')).toHaveTextContent(
      'delete rejected'
    )
    expect(screen.getByText('Summer Basics')).toBeInTheDocument()
  })

  it('falls back to translated copy when a delete rejects with a non-Error', async () => {
    vi.mocked(wardrobeApi.deleteCapsuleFromWeb).mockRejectedValue('socket hang up')
    render(<LooksCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('delete-capsule-button-cap-1'))
    fireEvent.click(screen.getByTestId('confirm-delete-capsule-button'))

    expect(await screen.findByTestId('capsule-error-banner')).toHaveTextContent(
      'Unable to delete the capsule.'
    )
  })

  it('announces a successful delete and refetches', async () => {
    vi.mocked(wardrobeApi.deleteCapsuleFromWeb).mockResolvedValue(undefined)
    render(<LooksCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('delete-capsule-button-cap-1'))
    fireEvent.click(screen.getByTestId('confirm-delete-capsule-button'))

    await waitFor(() =>
      expect(screen.getByTestId('capsule-status-region')).toHaveTextContent(
        'Capsule deleted'
      )
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    ['the cancel button', 'cancel-delete-capsule-button'],
    ['the dialog close control', 'close'],
  ])('dismisses the delete confirmation from %s', async (_label, target) => {
    render(<LooksCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('delete-capsule-button-cap-1'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(
      target === 'close'
        ? screen.getByLabelText('Cancel deletion')
        : screen.getByTestId(target)
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(wardrobeApi.deleteCapsuleFromWeb).not.toHaveBeenCalled()
  })
})

describe('LooksCapsulesPage superseded requests', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockResolvedValue(SIGNED_IN_USER)
    vi.mocked(wardrobeApi.listGarmentsFromWeb).mockResolvedValue([])
  })

  it('ignores a slow earlier page once a newer filter has been applied', async () => {
    let settleFirst: (page: ReturnType<typeof mockPage>) => void = () => undefined
    vi.mocked(wardrobeApi.listCapsulesFromWeb)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          settleFirst = resolve
        })
      )
      .mockResolvedValue(
        mockPage([buildCapsule({ id: 'cap-new', name: 'Newer Result' })])
      )
    render(<LooksCapsulesPage />)
    await waitFor(() => expect(wardrobeApi.listCapsulesFromWeb).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId('capsule-favorite-filter'))
    await screen.findByText('Newer Result')

    settleFirst(mockPage([buildCapsule({ id: 'cap-old', name: 'Stale Result' })]))

    // A slow earlier response must never overwrite the filter the user is
    // actually looking at.
    await waitFor(() => expect(screen.getByText('Newer Result')).toBeInTheDocument())
    expect(screen.queryByText('Stale Result')).not.toBeInTheDocument()
  })

  it('stays silent when a superseded page request fails', async () => {
    let failFirst: (reason: Error) => void = () => undefined
    vi.mocked(wardrobeApi.listCapsulesFromWeb)
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          failFirst = reject
        })
      )
      .mockResolvedValue(
        mockPage([buildCapsule({ id: 'cap-new', name: 'Newer Result' })])
      )
    render(<LooksCapsulesPage />)
    await waitFor(() => expect(wardrobeApi.listCapsulesFromWeb).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId('capsule-favorite-filter'))
    await screen.findByText('Newer Result')

    failFirst(new Error('superseded request failed'))

    await waitFor(() => expect(screen.getByText('Newer Result')).toBeInTheDocument())
    expect(screen.queryByTestId('capsule-error-banner')).not.toBeInTheDocument()
  })

  it('drops the signed-in user id when it resolves after the page unmounts', async () => {
    let settleUser: (id: string) => void = () => undefined
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockReturnValue(
      new Promise((resolve) => {
        settleUser = resolve
      })
    )
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(mockPage([]))
    const { unmount } = render(<LooksCapsulesPage />)
    unmount()

    settleUser(SIGNED_IN_USER)
    await waitFor(() => expect(wardrobeApi.resolveCurrentUserId).toHaveBeenCalledTimes(1))

    // Resolving the owner after teardown must not fire a query for a page that
    // is no longer on screen.
    expect(wardrobeApi.listCapsulesFromWeb).not.toHaveBeenCalled()
  })

  it('drops a session failure that resolves after the page unmounts', async () => {
    let failUser: (reason: Error) => void = () => undefined
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockReturnValue(
      new Promise((_resolve, reject) => {
        failUser = reject
      })
    )
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(mockPage([]))
    const { unmount } = render(<LooksCapsulesPage />)
    unmount()

    failUser(new Error('late session failure'))
    await waitFor(() => expect(wardrobeApi.resolveCurrentUserId).toHaveBeenCalledTimes(1))

    vi.mocked(wardrobeApi.resolveCurrentUserId).mockResolvedValue(SIGNED_IN_USER)
    render(<LooksCapsulesPage />)

    // A fresh mount must not inherit the discarded failure.
    await screen.findByTestId('capsule-empty-state')
    expect(screen.queryByTestId('capsule-error-banner')).not.toBeInTheDocument()
  })
})

import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { OutfitCapsuleContract } from '@couture/api-client/contracts/http'
import WardrobeCapsulesPage from './page'
import * as wardrobeApi from '../../../lib/wardrobe'

vi.mock('../../../lib/wardrobe', () => ({
  listCapsulesFromWeb: vi.fn(),
  listGarmentsFromWeb: vi.fn(),
  createCapsuleFromWeb: vi.fn(),
  updateCapsuleFromWeb: vi.fn(),
  favoriteCapsuleFromWeb: vi.fn(),
  deleteCapsuleFromWeb: vi.fn(),
  resolveCurrentUserId: vi.fn(),
}))

const SIGNED_IN_USER = 'user-signed-in'

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

describe('WardrobeCapsulesPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockResolvedValue(SIGNED_IN_USER)
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([buildCapsule()])
    )
    vi.mocked(wardrobeApi.listGarmentsFromWeb).mockResolvedValue([])
  })

  it('4.3-WEB-PAGE-01 renders the header and the fetched capsule grid', async () => {
    render(<WardrobeCapsulesPage />)

    expect(screen.getByRole('heading', { name: 'Outfit capsules' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Summer Basics')).toBeInTheDocument()
    })
    expect(screen.getByTestId('capsule-status-badge-cap-1')).toHaveTextContent('Ready')
  })

  /**
   * Regression: the page previously sent the literal string `current-user-id`
   * as the owner path segment, so every request 404ed for every real user.
   */
  it('4.3-WEB-PAGE-02 uses the signed-in user as the owner, not a placeholder', async () => {
    render(<WardrobeCapsulesPage />)

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

    render(<WardrobeCapsulesPage />)

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

    render(<WardrobeCapsulesPage />)
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
        '"capsule:cap-1:3"'
      )
    })
  })

  it('4.3-WEB-PAGE-05 sends the strong entity tag when toggling favorite', async () => {
    vi.mocked(wardrobeApi.favoriteCapsuleFromWeb).mockResolvedValue(
      buildCapsule({ isFavorite: false })
    )

    render(<WardrobeCapsulesPage />)
    await waitFor(() => {
      expect(screen.getByText('Summer Basics')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('favorite-button-cap-1'))

    await waitFor(() => {
      expect(wardrobeApi.favoriteCapsuleFromWeb).toHaveBeenCalledWith(
        SIGNED_IN_USER,
        'cap-1',
        false,
        '"capsule:cap-1:3"'
      )
    })
  })

  /** The destructive confirmation must be a real dialog, not a bare div. */
  it('4.3-WEB-PAGE-06 renders the delete confirmation as an accessible dialog', async () => {
    render(<WardrobeCapsulesPage />)
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

    render(<WardrobeCapsulesPage />)

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

    render(<WardrobeCapsulesPage />)

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

/** Fills the builder's required fields so a submit is actually attempted. */
function fillBuilderForm(name: string) {
  fireEvent.change(screen.getByTestId('capsule-name-input'), { target: { value: name } })
  fireEvent.click(screen.getByTestId('garment-select-checkbox-g-1'))
  fireEvent.click(screen.getByTestId('garment-select-checkbox-g-2'))
}

describe('WardrobeCapsulesPage builder integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockResolvedValue(SIGNED_IN_USER)
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(mockPage([]))
    vi.mocked(wardrobeApi.listGarmentsFromWeb).mockResolvedValue(BUILDER_GARMENTS)
  })

  it('creates a capsule, announces it politely, and refetches the grid', async () => {
    vi.mocked(wardrobeApi.createCapsuleFromWeb).mockResolvedValue(buildCapsule())
    render(<WardrobeCapsulesPage />)
    await screen.findByTestId('capsule-empty-state')

    fireEvent.click(screen.getByTestId('create-capsule-button'))
    fillBuilderForm('Weekend')
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(wardrobeApi.createCapsuleFromWeb).toHaveBeenCalledWith(
        SIGNED_IN_USER,
        expect.objectContaining({ name: 'Weekend', garmentIds: ['g-1', 'g-2'] }),
        expect.any(String)
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
    render(<WardrobeCapsulesPage />)
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
        '"capsule:cap-1:3"'
      )
    })
    await waitFor(() =>
      expect(screen.getByTestId('capsule-status-region')).toHaveTextContent(
        'Capsule updated'
      )
    )
  })

  it('closes the builder without writing anything when cancelled', async () => {
    render(<WardrobeCapsulesPage />)
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
    render(<WardrobeCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('edit-capsule-button-cap-1'))
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    const reload = await screen.findByTestId('capsule-reload-button')
    fireEvent.click(reload)

    // Reconciling means pulling the other client's committed revision, not
    // retrying the same doomed entity tag.
    await waitFor(() => expect(wardrobeApi.listCapsulesFromWeb).toHaveBeenCalledTimes(2))
  })

  it('writes nothing from a builder opened before the session resolved', async () => {
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockReturnValue(
      new Promise(() => undefined)
    )
    render(<WardrobeCapsulesPage />)

    fireEvent.click(screen.getByTestId('create-capsule-button'))
    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Premature' },
    })
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    // With no owner there are no garments to pick either, so the builder's own
    // minimum-selection guard stops the submit before any request is shaped
    // against an empty owner path segment.
    await waitFor(() =>
      expect(screen.getByTestId('save-capsule-button')).not.toBeDisabled()
    )
    expect(wardrobeApi.createCapsuleFromWeb).not.toHaveBeenCalled()
    expect(wardrobeApi.updateCapsuleFromWeb).not.toHaveBeenCalled()
  })
})

describe('WardrobeCapsulesPage filtering', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockResolvedValue(SIGNED_IN_USER)
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([buildCapsule()])
    )
    vi.mocked(wardrobeApi.listGarmentsFromWeb).mockResolvedValue([])
  })

  it('debounces typing into a single search query', async () => {
    render(<WardrobeCapsulesPage />)
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
    render(<WardrobeCapsulesPage />)
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
    render(<WardrobeCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('capsule-favorite-filter'))

    await waitFor(() =>
      expect(vi.mocked(wardrobeApi.listCapsulesFromWeb).mock.calls.at(-1)?.[1]).toEqual(
        expect.objectContaining({ isFavorite: true })
      )
    )
  })

  it('refetches when the window regains focus so another client’s writes appear', async () => {
    render(<WardrobeCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.focus(window)

    await waitFor(() => expect(wardrobeApi.listCapsulesFromWeb).toHaveBeenCalledTimes(2))
  })

  it('renders a hollow star for a capsule that is not a favorite', async () => {
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockResolvedValue(
      mockPage([buildCapsule({ isFavorite: false })])
    )
    render(<WardrobeCapsulesPage />)

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
    render(<WardrobeCapsulesPage />)

    expect(
      await screen.findByTestId('capsule-unavailable-count-cap-1')
    ).toHaveTextContent('1 unavailable garment')
  })
})

describe('WardrobeCapsulesPage failure handling', () => {
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
    render(<WardrobeCapsulesPage />)

    expect(await screen.findByTestId('capsule-error-banner')).toHaveTextContent(
      'capsule service down'
    )
    // The spinner must clear or the page looks permanently busy.
    expect(screen.queryByTestId('capsule-loading-state')).not.toBeInTheDocument()
  })

  it('falls back to translated copy when the load rejection is not an Error', async () => {
    vi.mocked(wardrobeApi.listCapsulesFromWeb).mockRejectedValue('ECONNRESET')
    render(<WardrobeCapsulesPage />)

    expect(await screen.findByTestId('capsule-error-banner')).toHaveTextContent(
      'Unable to load capsules.'
    )
  })

  it('falls back to generic copy when the session cannot be resolved at all', async () => {
    vi.mocked(wardrobeApi.resolveCurrentUserId).mockRejectedValue('no session cookie')
    render(<WardrobeCapsulesPage />)

    expect(await screen.findByTestId('capsule-error-banner')).toHaveTextContent(
      'Sign in to manage capsules.'
    )
  })

  it('surfaces a failed favorite toggle', async () => {
    vi.mocked(wardrobeApi.favoriteCapsuleFromWeb).mockRejectedValue(
      new Error('precondition failed')
    )
    render(<WardrobeCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('favorite-button-cap-1'))

    expect(await screen.findByTestId('capsule-error-banner')).toHaveTextContent(
      'precondition failed'
    )
  })

  it('falls back to translated copy when a favorite toggle rejects with a non-Error', async () => {
    vi.mocked(wardrobeApi.favoriteCapsuleFromWeb).mockRejectedValue('socket hang up')
    render(<WardrobeCapsulesPage />)
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
    render(<WardrobeCapsulesPage />)
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
    render(<WardrobeCapsulesPage />)
    await screen.findByText('Summer Basics')

    fireEvent.click(screen.getByTestId('delete-capsule-button-cap-1'))
    fireEvent.click(screen.getByTestId('confirm-delete-capsule-button'))

    expect(await screen.findByTestId('capsule-error-banner')).toHaveTextContent(
      'Unable to delete the capsule.'
    )
  })

  it('announces a successful delete and refetches', async () => {
    vi.mocked(wardrobeApi.deleteCapsuleFromWeb).mockResolvedValue(undefined)
    render(<WardrobeCapsulesPage />)
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
    render(<WardrobeCapsulesPage />)
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

describe('WardrobeCapsulesPage superseded requests', () => {
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
    render(<WardrobeCapsulesPage />)
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
    render(<WardrobeCapsulesPage />)
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
    const { unmount } = render(<WardrobeCapsulesPage />)
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
    const { unmount } = render(<WardrobeCapsulesPage />)
    unmount()

    failUser(new Error('late session failure'))
    await waitFor(() => expect(wardrobeApi.resolveCurrentUserId).toHaveBeenCalledTimes(1))

    vi.mocked(wardrobeApi.resolveCurrentUserId).mockResolvedValue(SIGNED_IN_USER)
    render(<WardrobeCapsulesPage />)

    // A fresh mount must not inherit the discarded failure.
    await screen.findByTestId('capsule-empty-state')
    expect(screen.queryByTestId('capsule-error-banner')).not.toBeInTheDocument()
  })
})

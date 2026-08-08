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

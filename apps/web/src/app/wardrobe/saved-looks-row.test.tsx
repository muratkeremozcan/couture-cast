// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'

const { createSavedLookFromWeb, deleteSavedLookFromWeb } = vi.hoisted(() => ({
  createSavedLookFromWeb: vi.fn(),
  deleteSavedLookFromWeb: vi.fn(),
}))

vi.mock('../../lib/saved-looks', () => ({
  createSavedLookFromWeb,
  deleteSavedLookFromWeb,
  formatSavedLookIfMatch: (id: string, revision: number) =>
    `"saved-look:${id}:${revision}"`,
}))

import { ClosetSavedLooksRow } from './saved-looks-row'

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

function makeSavedLook(overrides: Partial<SavedLookContract> = {}): SavedLookContract {
  return {
    id: 'sl-1',
    ownerUserId: 'user-1',
    source: 'style_piece',
    lookId: 'sample:l:soft-pleats',
    weather: 'warm-rainy',
    title: null,
    anchorGarmentId: 'garment-1',
    anchorSnapshot: { garmentId: 'garment-1', category: 'top', comfortRange: 'mild' },
    composition: [
      {
        slotIndex: 0,
        category: 'top',
        kind: 'garment',
        itemId: 'garment-1',
        label: null,
        missing: false,
        imageAccess: {
          url: 'https://photos.example.test/garment-1.png',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      },
      {
        slotIndex: 1,
        category: 'shoes',
        kind: 'catalog',
        itemId: 'sample:g:loafers',
        label: 'Loafers',
        missing: false,
        imageAccess: null,
      },
    ],
    swaps: { shoes: 'sample:g:loafers' },
    collection: null,
    comfort: null,
    availabilityStatus: 'ready',
    missingGarmentIds: [],
    needsReviewReasons: [],
    revision: 0,
    createdAt: '2026-11-22T01:00:00.000Z',
    updatedAt: '2026-11-22T01:00:00.000Z',
    ...overrides,
  }
}

describe('ClosetSavedLooksRow (web)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteSavedLookFromWeb.mockResolvedValue(undefined)
    createSavedLookFromWeb.mockResolvedValue(makeSavedLook({ id: 'sl-restored' }))
  })

  it('expands, reopens ready style_piece look in StylePiecePanel, and removes with Undo', async () => {
    const user = userEvent.setup()
    const onReopenStylePiece = vi.fn()
    const onChanged = vi.fn()
    const look = makeSavedLook()

    render(
      <ClosetSavedLooksRow
        owner="user-1"
        savedLooks={[look]}
        isLoading={false}
        loadError={null}
        garments={[ACTIVE_GARMENT]}
        onRetry={vi.fn()}
        onChanged={onChanged}
        onReopenStylePiece={onReopenStylePiece}
      />
    )

    await user.click(screen.getByTestId('closet-saved-looks-row'))
    expect(screen.getByTestId('saved-look-slot-0')).toBeInTheDocument()
    expect(screen.getByTestId('saved-look-slot-1')).toBeInTheDocument()

    await user.click(screen.getByTestId('saved-look-reopen'))
    expect(onReopenStylePiece).toHaveBeenCalledWith(look, expect.any(HTMLElement))

    await user.click(screen.getByTestId('saved-look-remove'))
    await waitFor(() =>
      expect(deleteSavedLookFromWeb).toHaveBeenCalledWith('sl-1', '"saved-look:sl-1:0"')
    )
    expect(onChanged).toHaveBeenCalledTimes(1)

    const undoButton = await screen.findByRole('button', { name: 'Undo' })
    await user.click(undoButton)
    await waitFor(() => expect(createSavedLookFromWeb).toHaveBeenCalledTimes(1))
    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('renders missing garment, needs review, and photo-unavailable looks cleanly without dropping them', async () => {
    const user = userEvent.setup()
    const missingLook = makeSavedLook({
      id: 'sl-missing',
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
    const reviewLook = makeSavedLook({
      id: 'sl-review',
      availabilityStatus: 'needs_review',
      needsReviewReasons: ['category_changed'],
      composition: [
        {
          slotIndex: 0,
          category: 'top',
          kind: 'garment',
          itemId: 'garment-1',
          label: null,
          missing: false,
          imageAccess: null,
        },
      ],
    })

    render(
      <ClosetSavedLooksRow
        owner="user-1"
        savedLooks={[missingLook, reviewLook]}
        isLoading={false}
        loadError={null}
        garments={[ACTIVE_GARMENT]}
        onRetry={vi.fn()}
        onChanged={vi.fn()}
        onReopenStylePiece={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('closet-saved-looks-row'))
    expect(screen.getByTestId('saved-look-missing-garment')).toBeInTheDocument()
    expect(screen.getByTestId('saved-look-needs-review')).toBeInTheDocument()
    expect(screen.getByTestId('saved-look-photo-placeholder')).toBeInTheDocument()

    // Reopening a missing garment look opens detail modal with explicit placeholder message.
    await user.click(screen.getAllByTestId('saved-look-reopen')[0]!)
    expect(screen.getByTestId('saved-look-detail-modal')).toBeInTheDocument()
    expect(screen.getByTestId('saved-look-detail-missing')).toBeInTheDocument()
  })

  it('renders load error with retry action', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <ClosetSavedLooksRow
        owner="user-1"
        savedLooks={[]}
        isLoading={false}
        loadError="network down"
        garments={[]}
        onRetry={onRetry}
        onChanged={vi.fn()}
        onReopenStylePiece={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('saved-looks-retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

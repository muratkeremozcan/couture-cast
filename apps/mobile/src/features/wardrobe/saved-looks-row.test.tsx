// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import { screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import i18n, { initI18n } from '@/src/lib/i18n'

const { createSavedLookFromMobile, deleteSavedLookFromMobile } = vi.hoisted(() => ({
  createSavedLookFromMobile: vi.fn(),
  deleteSavedLookFromMobile: vi.fn(),
}))

vi.mock('@/src/lib/saved-looks', () => ({
  createSavedLookFromMobile,
  deleteSavedLookFromMobile,
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
    id: 'sl-m1',
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
        imageAccess: null,
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

describe('ClosetSavedLooksRow (mobile)', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    deleteSavedLookFromMobile.mockResolvedValue(undefined)
    createSavedLookFromMobile.mockResolvedValue(makeSavedLook({ id: 'sl-m-restored' }))
  })

  it('reopens ready style_piece look, renders photo-unavailable placeholder, and removes with Undo', async () => {
    const onReopenStylePiece = vi.fn()
    const onChanged = vi.fn()
    const look = makeSavedLook()

    await render(
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

    await userEvent.click(screen.getByTestId('closet-saved-looks-row'))
    expect(screen.getByTestId('saved-look-photo-placeholder')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('saved-look-reopen'))
    expect(onReopenStylePiece).toHaveBeenCalledWith(look)

    await userEvent.click(screen.getByTestId('saved-look-remove'))
    await waitFor(() =>
      expect(deleteSavedLookFromMobile).toHaveBeenCalledWith(
        'sl-m1',
        '"saved-look:sl-m1:0"'
      )
    )
    expect(onChanged).toHaveBeenCalledTimes(1)

    const undoButton = await screen.findByText('Undo')
    await userEvent.click(undoButton)
    await waitFor(() => expect(createSavedLookFromMobile).toHaveBeenCalledTimes(1))
    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('renders missing garment and needs review looks and opens detail modal', async () => {
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
      needsReviewReasons: ['comfort_range_changed'],
    })

    await render(
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

    await userEvent.click(screen.getByTestId('closet-saved-looks-row'))
    expect(screen.getByTestId('saved-look-missing-garment')).toBeInTheDocument()
    expect(screen.getByTestId('saved-look-needs-review')).toBeInTheDocument()

    await userEvent.click(screen.getAllByTestId('saved-look-reopen')[0]!)
    expect(screen.getByTestId('saved-look-detail-modal')).toBeInTheDocument()
    expect(screen.getByTestId('saved-look-detail-missing')).toBeInTheDocument()
  })
})

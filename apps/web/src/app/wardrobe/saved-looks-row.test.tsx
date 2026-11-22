// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import { SAMPLE_CATALOG, stylePieceAnchor, stylePieceLooks } from '@couture/utils'

const {
  deleteSavedLookFromWeb,
  getSavedLookFromWeb,
  notifySavedLooksChanged,
  restoreSavedLookFromWeb,
} = vi.hoisted(() => ({
  deleteSavedLookFromWeb: vi.fn(),
  getSavedLookFromWeb: vi.fn(),
  notifySavedLooksChanged: vi.fn(),
  restoreSavedLookFromWeb: vi.fn(),
}))

vi.mock('../../lib/saved-looks', () => ({
  SavedLookRequestError: class SavedLookRequestError extends Error {
    constructor(
      message: string,
      readonly status?: number,
      readonly code?: string
    ) {
      super(message)
      this.name = 'SavedLookRequestError'
    }
  },
  deleteSavedLookFromWeb,
  getSavedLookFromWeb,
  notifySavedLooksChanged,
  restoreSavedLookFromWeb,
  formatSavedLookIfMatch: (id: string, revision: number) =>
    `"saved-look:${id}:${revision}"`,
}))

import { SaveFeedbackProvider } from '../components/save-feedback'
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
    title: null,
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
    restoreSavedLookFromWeb.mockResolvedValue(makeExactEditorLook({ revision: 2 }))
    getSavedLookFromWeb.mockResolvedValue(makeExactEditorLook())
  })

  it('expands, reopens exact-order style_piece look in StylePiecePanel, and removes with /restore Undo', async () => {
    const user = userEvent.setup()
    const onReopenStylePiece = vi.fn()
    const onChanged = vi.fn()
    const look = makeExactEditorLook()

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
    expect(screen.getByTestId('saved-look-slot-0')).toHaveAttribute(
      'data-slot-item-id',
      'garment-1'
    )

    await user.click(screen.getByTestId('saved-look-reopen'))
    expect(onReopenStylePiece).toHaveBeenCalledWith(look, expect.any(HTMLElement))

    await user.click(screen.getByTestId('saved-look-remove'))
    await waitFor(() =>
      expect(deleteSavedLookFromWeb).toHaveBeenCalledWith('sl-1', '"saved-look:sl-1:0"', {
        accessToken: undefined,
      })
    )
    expect(onChanged).toHaveBeenCalledTimes(1)

    const undoButton = await screen.findByRole('button', { name: 'Undo' })
    await user.click(undoButton)
    await waitFor(() =>
      expect(restoreSavedLookFromWeb).toHaveBeenCalledWith('sl-1', {
        accessToken: undefined,
      })
    )
    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('opens exact SavedLookDetailModal in stored slot order when a saved look has non-default slot ordering', async () => {
    const user = userEvent.setup()
    const onReopenStylePiece = vi.fn()
    const base = makeExactEditorLook()
    const reordered = makeExactEditorLook({
      id: 'sl-reordered',
      composition: [
        base.composition[0]!,
        { ...base.composition[base.composition.length - 1]!, slotIndex: 1 },
        { ...base.composition[1]!, slotIndex: 2 },
      ],
    })

    render(
      <ClosetSavedLooksRow
        owner="user-1"
        savedLooks={[reordered]}
        isLoading={false}
        loadError={null}
        garments={[ACTIVE_GARMENT]}
        onRetry={vi.fn()}
        onChanged={vi.fn()}
        onReopenStylePiece={onReopenStylePiece}
      />
    )

    await user.click(screen.getByTestId('closet-saved-looks-row'))
    await user.click(screen.getByTestId('saved-look-reopen'))
    expect(onReopenStylePiece).not.toHaveBeenCalled()
    expect(screen.getByTestId('saved-look-detail-modal')).toBeInTheDocument()

    const modalSlots = Array.from(
      screen
        .getByTestId('saved-look-detail-modal')
        .querySelectorAll('[data-slot-item-id]')
    ).map((el) => el.getAttribute('data-slot-item-id'))
    expect(modalSlots).toEqual(reordered.composition.map((s) => s.itemId))
  })

  it('fences Closet Undo and late DELETE responses across account switches in a shared root provider', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    const lookA = makeExactEditorLook({ id: 'sl-a', ownerUserId: 'member-a' })
    const lookB = makeExactEditorLook({ id: 'sl-b', ownerUserId: 'member-b' })

    // Case 1: Undo notice is visible, then account switches to member-b -> Undo dismissed & inert.
    const { rerender } = render(
      <SaveFeedbackProvider>
        <ClosetSavedLooksRow
          owner="member-a"
          savedLooks={[lookA]}
          isLoading={false}
          loadError={null}
          garments={[ACTIVE_GARMENT]}
          onRetry={vi.fn()}
          onChanged={onChanged}
          onReopenStylePiece={vi.fn()}
        />
      </SaveFeedbackProvider>
    )

    await user.click(screen.getByTestId('closet-saved-looks-row'))
    await user.click(screen.getByTestId('saved-look-remove'))
    await screen.findByRole('button', { name: 'Undo' })

    rerender(
      <SaveFeedbackProvider>
        <ClosetSavedLooksRow
          owner="member-b"
          savedLooks={[lookB]}
          isLoading={false}
          loadError={null}
          garments={[ACTIVE_GARMENT]}
          onRetry={vi.fn()}
          onChanged={onChanged}
          onReopenStylePiece={vi.fn()}
        />
      </SaveFeedbackProvider>
    )

    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(restoreSavedLookFromWeb).not.toHaveBeenCalled()

    // Case 2: Late DELETE resolves after switching back to member-a -> no notice or onChanged.
    let finishDelete!: () => void
    deleteSavedLookFromWeb.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve
        })
    )
    onChanged.mockClear()
    await user.click(screen.getByTestId('saved-look-remove'))

    rerender(
      <SaveFeedbackProvider>
        <ClosetSavedLooksRow
          owner="member-a"
          savedLooks={[lookA]}
          isLoading={false}
          loadError={null}
          garments={[ACTIVE_GARMENT]}
          onRetry={vi.fn()}
          onChanged={onChanged}
          onReopenStylePiece={vi.fn()}
        />
      </SaveFeedbackProvider>
    )

    finishDelete()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('renders placeholders for expired or rejected photo URLs, refreshes on open, and supports >50 pagination', async () => {
    const user = userEvent.setup()
    const onLoadMore = vi.fn()
    const expiredLook = makeExactEditorLook({
      id: 'sl-expired',
      source: 'home_sample',
      anchorGarmentId: null,
      anchorSnapshot: null,
      composition: [
        {
          slotIndex: 0,
          category: 'top',
          kind: 'garment',
          itemId: 'garment-1',
          label: null,
          missing: false,
          imageAccess: {
            url: 'https://photos.example.test/expired.png',
            expiresAt: '2020-01-01T00:00:00.000Z',
          },
        },
      ],
    })
    const failingPhotoLook = makeExactEditorLook({
      id: 'sl-img-err',
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

    render(
      <ClosetSavedLooksRow
        owner="user-1"
        savedLooks={[expiredLook, failingPhotoLook]}
        totalCount={51}
        hasMore
        onLoadMore={onLoadMore}
        isLoading={false}
        loadError={null}
        garments={[ACTIVE_GARMENT]}
        onRetry={vi.fn()}
        onChanged={vi.fn()}
        onReopenStylePiece={vi.fn()}
      />
    )

    expect(screen.getByTestId('closet-saved-looks-row')).toHaveTextContent('51')
    await user.click(screen.getByTestId('closet-saved-looks-row'))

    // Expired photo immediately uses placeholder; active photo falls back on load error.
    expect(screen.getAllByTestId('saved-look-photo-placeholder')).toHaveLength(1)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://photos.example.test/403.png')
    fireEvent.error(img)
    expect(screen.getAllByTestId('saved-look-photo-placeholder')).toHaveLength(2)

    // Opening detail modal on expired photo fetches fresh detail.
    await user.click(screen.getAllByTestId('saved-look-reopen')[0]!)
    await waitFor(() =>
      expect(getSavedLookFromWeb).toHaveBeenCalledWith('sl-expired', {
        accessToken: undefined,
      })
    )

    await user.click(screen.getByTestId('saved-looks-load-more'))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('renders missing garment and needs review looks and offers load-error retry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const missingLook = makeExactEditorLook({
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
    const reviewLook = makeExactEditorLook({
      id: 'sl-review',
      availabilityStatus: 'needs_review',
      needsReviewReasons: ['category_changed'],
    })

    render(
      <ClosetSavedLooksRow
        owner="user-1"
        savedLooks={[missingLook, reviewLook]}
        isLoading={false}
        loadError="network down"
        garments={[ACTIVE_GARMENT]}
        onRetry={onRetry}
        onChanged={vi.fn()}
        onReopenStylePiece={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('saved-looks-retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)

    await user.click(screen.getByTestId('closet-saved-looks-row'))
    expect(screen.getByTestId('saved-look-missing-garment')).toBeInTheDocument()
    expect(screen.getByTestId('saved-look-needs-review')).toBeInTheDocument()

    // Missing garment look supports exact Undo restore on remove.
    await user.click(screen.getAllByTestId('saved-look-remove')[0]!)
    const undoBtn = await screen.findByRole('button', { name: 'Undo' })
    await user.click(undoBtn)
    await waitFor(() =>
      expect(restoreSavedLookFromWeb).toHaveBeenCalledWith('sl-missing', {
        accessToken: undefined,
      })
    )
  })
})

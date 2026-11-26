// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-SAVED-001 (D12: the saved look detail is a full-height
// layer under a top bar with back and the look's title), 7.11-CMP-SAVED-002 (D8: the Looks tab
// opens the list expanded).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

    // Opening detail modal on expired photo fetches fresh detail, and handles fetch error cleanly.
    await user.click(screen.getAllByTestId('saved-look-reopen')[0]!)
    await waitFor(() =>
      expect(getSavedLookFromWeb).toHaveBeenCalledWith('sl-expired', {
        accessToken: undefined,
      })
    )
    // CC-7.11 D12: the detail is a layer under a top bar; its back arrow closes it.
    await user.click(screen.getByTestId('app-top-bar-back'))
    getSavedLookFromWeb.mockRejectedValueOnce(new Error('503'))
    await user.click(screen.getAllByTestId('saved-look-reopen')[0]!)
    await waitFor(() => expect(getSavedLookFromWeb).toHaveBeenCalledTimes(2))

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

    // Missing garment look supports exact Undo restore on remove, and preserves Retry when restore fails.
    restoreSavedLookFromWeb.mockRejectedValueOnce(new Error('503 temporary'))
    await user.click(screen.getAllByTestId('saved-look-remove')[0]!)
    const undoBtn = await screen.findByRole('button', { name: 'Undo' })
    await user.click(undoBtn)
    const retryUndoBtn = await screen.findByTestId('status-bar-action-retry')
    await user.click(retryUndoBtn)
    await waitFor(() => expect(restoreSavedLookFromWeb).toHaveBeenCalledTimes(2))
    expect(restoreSavedLookFromWeb).toHaveBeenLastCalledWith('sl-missing', {
      accessToken: undefined,
    })

    // Opening missing-garment look renders detail layer with missing notice and a back arrow
    // (CC-7.11 D12: the back arrow took the X's place).
    await user.click(screen.getAllByTestId('saved-look-reopen')[0]!)
    expect(screen.getByTestId('saved-look-detail-missing')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    await user.click(screen.getByTestId('app-top-bar-back'))
    expect(screen.queryByTestId('saved-look-detail-modal')).not.toBeInTheDocument()

    // Opening needs-review look renders detail modal with needs-review notice, and detail-remove closes modal.
    await user.click(screen.getAllByTestId('saved-look-reopen')[1]!)
    expect(screen.getByTestId('saved-look-detail-needs-review')).toBeInTheDocument()
    await user.click(screen.getByTestId('saved-look-detail-remove'))
    await waitFor(() =>
      expect(screen.queryByTestId('saved-look-detail-modal')).not.toBeInTheDocument()
    )

    // Offline Undo on removed look shows offline notice with Undo action.
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )

    // Offline Remove shows offline notice immediately without calling deleteSavedLookFromWeb.
    deleteSavedLookFromWeb.mockClear()
    await user.click(screen.getAllByTestId('saved-look-remove')[0]!)
    expect(deleteSavedLookFromWeb).not.toHaveBeenCalled()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })

    // Transport failure during Remove shows offline notice.
    deleteSavedLookFromWeb.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.click(screen.getAllByTestId('saved-look-remove')[0]!)
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )

    // Failed DELETE offers Retry, and 404 stale DELETE omits Undo.
    deleteSavedLookFromWeb
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce(undefined)
    await user.click(screen.getAllByTestId('saved-look-remove')[1]!)
    await user.click(await screen.findByTestId('status-bar-action-retry'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    )

    const { SavedLookRequestError } = await import('../../lib/saved-looks')
    deleteSavedLookFromWeb.mockRejectedValueOnce(
      new SavedLookRequestError('Not found', 404, 'SAVED_LOOK_NOT_FOUND')
    )
    await user.click(screen.getAllByTestId('saved-look-remove')[1]!)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    )
  })

  it('7.11-CMP-SAVED-001 opens the saved look detail as a full-height layer titled by the look, with back in place of the X', async () => {
    const user = userEvent.setup()
    const reviewLook = makeExactEditorLook({
      id: 'sl-titled',
      title: 'Rainy commute',
      availabilityStatus: 'needs_review',
      needsReviewReasons: ['category_changed'],
    })
    const opener = vi.fn()
    render(
      <ClosetSavedLooksRow
        owner="user-1"
        savedLooks={[reviewLook]}
        isLoading={false}
        loadError={null}
        garments={[ACTIVE_GARMENT]}
        onRetry={vi.fn()}
        onChanged={vi.fn()}
        onReopenStylePiece={opener}
      />
    )

    await user.click(screen.getByTestId('closet-saved-looks-row'))
    const reopen = screen.getByTestId('saved-look-reopen')
    await user.click(reopen)

    const layer = screen.getByRole('dialog', { name: 'Rainy commute' })
    expect(layer).toHaveAttribute('data-presentation', 'screen')
    expect(within(layer).getByTestId('app-top-bar-title')).toHaveTextContent(
      /^Rainy commute$/
    )
    expect(within(layer).queryByText('Saved look')).toBeNull()
    expect(within(layer).getByTestId('layer-swipe-handle')).toContainElement(
      within(layer).getByTestId('app-top-bar-back')
    )
    expect(within(layer).getByTestId('layer-body')).toContainElement(
      within(layer).getByTestId('saved-look-detail-modal')
    )
    expect(within(layer).queryByRole('button', { name: 'Close' })).toBeNull()

    await user.click(within(layer).getByTestId('app-top-bar-back'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(opener).not.toHaveBeenCalled()
  })

  it('7.11-CMP-SAVED-002 starts expanded on the Looks tab and still collapses on demand', async () => {
    const user = userEvent.setup()
    render(
      <ClosetSavedLooksRow
        owner="user-1"
        savedLooks={[makeExactEditorLook()]}
        isLoading={false}
        loadError={null}
        garments={[ACTIVE_GARMENT]}
        onRetry={vi.fn()}
        onChanged={vi.fn()}
        onReopenStylePiece={vi.fn()}
        initiallyExpanded
      />
    )

    const toggle = screen.getByTestId('closet-saved-looks-row')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('closet-saved-looks-list')).toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('closet-saved-looks-list')).toBeNull()
  })
})

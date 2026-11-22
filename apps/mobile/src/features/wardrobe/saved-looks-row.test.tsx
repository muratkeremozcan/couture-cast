// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import { SAMPLE_CATALOG, stylePieceAnchor, stylePieceLooks } from '@couture/utils'
import {
  resetNetworkStatusForTests,
  SaveFeedbackProvider,
} from '@/components/save-feedback'
import i18n, { initI18n } from '@/src/lib/i18n'
import { setMobileApplicationUserId } from '@/src/lib/mobile-auth'

const {
  deleteSavedLookFromMobile,
  getSavedLookFromMobile,
  notifyMobileSavedLooksChanged,
  restoreSavedLookFromMobile,
} = vi.hoisted(() => ({
  deleteSavedLookFromMobile: vi.fn(),
  getSavedLookFromMobile: vi.fn(),
  notifyMobileSavedLooksChanged: vi.fn(),
  restoreSavedLookFromMobile: vi.fn(),
}))

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/src/lib/saved-looks', () => ({
  MobileSavedLookRequestError: class MobileSavedLookRequestError extends Error {
    constructor(
      message: string,
      readonly status?: number,
      readonly code?: string
    ) {
      super(message)
      this.name = 'MobileSavedLookRequestError'
    }
  },
  deleteSavedLookFromMobile,
  getSavedLookFromMobile,
  notifyMobileSavedLooksChanged,
  restoreSavedLookFromMobile,
  formatSavedLookIfMatch: (id: string, revision: number) =>
    `"saved-look:${id}:${revision}"`,
}))

import { MobileSavedLookRequestError } from '../../lib/saved-looks'
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
    id: 'sl-m1',
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
        imageAccess: null,
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

describe('ClosetSavedLooksRow (mobile)', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    setMobileApplicationUserId(null)
    deleteSavedLookFromMobile.mockResolvedValue(undefined)
    restoreSavedLookFromMobile.mockResolvedValue(makeExactEditorLook({ revision: 2 }))
    getSavedLookFromMobile.mockResolvedValue(makeExactEditorLook())
  })

  it('reopens exact-order style_piece look, renders photo-unavailable placeholder, and removes with /restore Undo', async () => {
    const onReopenStylePiece = vi.fn()
    const onChanged = vi.fn()
    const look = makeExactEditorLook()

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
        '"saved-look:sl-m1:0"',
        { accessToken: undefined }
      )
    )
    expect(onChanged).toHaveBeenCalledTimes(1)

    const undoButton = await screen.findByText('Undo')
    await userEvent.click(undoButton)
    await waitFor(() =>
      expect(restoreSavedLookFromMobile).toHaveBeenCalledWith('sl-m1', {
        accessToken: undefined,
      })
    )
    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('fences Closet Undo and late DELETE across account switches in a shared root provider', async () => {
    const onChanged = vi.fn()
    const lookA = makeExactEditorLook({ id: 'sl-ma', ownerUserId: 'member-a' })
    const lookB = makeExactEditorLook({ id: 'sl-mb', ownerUserId: 'member-b' })
    setMobileApplicationUserId('member-a')

    const { rerender } = await render(
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

    await userEvent.click(screen.getByTestId('closet-saved-looks-row'))
    await userEvent.click(screen.getByTestId('saved-look-remove'))
    await screen.findByText('Undo')

    setMobileApplicationUserId('member-b')
    await rerender(
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

    expect(screen.queryByText('Undo')).not.toBeInTheDocument()
    expect(restoreSavedLookFromMobile).not.toHaveBeenCalled()

    // Late DELETE after account switch does not emit notice or onChanged for the next account.
    let finishDelete!: () => void
    deleteSavedLookFromMobile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve
        })
    )
    onChanged.mockClear()
    deleteSavedLookFromMobile.mockClear()
    await userEvent.click(screen.getByTestId('saved-look-remove'))
    await waitFor(() => expect(deleteSavedLookFromMobile).toHaveBeenCalledTimes(1))

    setMobileApplicationUserId('member-a')
    await rerender(
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
    expect(screen.queryByText('Undo')).not.toBeInTheDocument()
  })

  it('opens exact detail modal for non-default slot ordering, handles expired photos, and supports pagination', async () => {
    const onReopenStylePiece = vi.fn()
    const onLoadMore = vi.fn()
    const base = makeExactEditorLook()
    const reordered = makeExactEditorLook({
      id: 'sl-reordered',
      composition: [
        {
          ...base.composition[0]!,
          imageAccess: {
            url: 'https://photos.example.test/expired.png',
            expiresAt: '2020-01-01T00:00:00.000Z',
          },
        },
        { ...base.composition[base.composition.length - 1]!, slotIndex: 1 },
        { ...base.composition[1]!, slotIndex: 2 },
      ],
    })

    await render(
      <ClosetSavedLooksRow
        owner="user-1"
        savedLooks={[reordered]}
        totalCount={51}
        hasMore
        onLoadMore={onLoadMore}
        isLoading={false}
        loadError={null}
        garments={[ACTIVE_GARMENT]}
        onRetry={vi.fn()}
        onChanged={vi.fn()}
        onReopenStylePiece={onReopenStylePiece}
      />
    )

    expect(screen.getByTestId('closet-saved-looks-row')).toHaveTextContent('51')
    await userEvent.click(screen.getByTestId('closet-saved-looks-row'))
    expect(screen.getByTestId('saved-look-photo-placeholder')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('saved-look-reopen'))
    expect(onReopenStylePiece).not.toHaveBeenCalled()
    expect(screen.getByTestId('saved-look-detail-modal')).toBeInTheDocument()
    await waitFor(() =>
      expect(getSavedLookFromMobile).toHaveBeenCalledWith('sl-reordered', {
        accessToken: undefined,
      })
    )

    await userEvent.click(screen.getByTestId('saved-look-detail-close'))
    await userEvent.click(screen.getByTestId('saved-looks-load-more'))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('renders missing garment, needs review, and image-error fallback cleanly', async () => {
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
    const errorPhotoLook = makeExactEditorLook({
      id: 'sl-review',
      availabilityStatus: 'needs_review',
      needsReviewReasons: ['comfort_range_changed'],
      composition: [
        {
          slotIndex: 0,
          category: 'top',
          kind: 'garment',
          itemId: 'garment-1',
          label: null,
          missing: false,
          imageAccess: {
            url: 'https://photos.example.test/broken.png',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        },
      ],
    })

    const onRetry = vi.fn()
    await render(
      <SaveFeedbackProvider>
        <ClosetSavedLooksRow
          owner="user-1"
          savedLooks={[missingLook, errorPhotoLook]}
          isLoading={false}
          loadError="network down"
          garments={[ACTIVE_GARMENT]}
          onRetry={onRetry}
          onChanged={vi.fn()}
          onReopenStylePiece={vi.fn()}
        />
      </SaveFeedbackProvider>
    )

    await userEvent.click(screen.getByTestId('saved-looks-retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByTestId('closet-saved-looks-row'))
    expect(screen.getByTestId('saved-look-missing-garment')).toBeInTheDocument()
    expect(screen.getByTestId('saved-look-needs-review')).toBeInTheDocument()

    const img = document.querySelector('img')
    expect(img).not.toBeNull()
    expect(screen.queryAllByTestId('saved-look-photo-placeholder')).toHaveLength(0)
    fireEvent.error(img!)
    await waitFor(() =>
      expect(screen.getAllByTestId('saved-look-photo-placeholder')).toHaveLength(1)
    )

    // Opening missing-garment detail modal shows missing notice and closes cleanly.
    await userEvent.click(screen.getAllByTestId('saved-look-reopen')[0]!)
    expect(screen.getByTestId('saved-look-detail-missing')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('saved-look-detail-close'))
    expect(screen.queryByTestId('saved-look-detail-modal')).not.toBeInTheDocument()

    // Opening needs-review detail modal shows needs-review notice, and detail-remove closes modal.
    await userEvent.click(screen.getAllByTestId('saved-look-reopen')[1]!)
    expect(screen.getByTestId('saved-look-detail-needs-review')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('saved-look-detail-remove'))
    await waitFor(() =>
      expect(screen.queryByTestId('saved-look-detail-modal')).not.toBeInTheDocument()
    )

    // Failed Undo restore keeps a Retry button so the member can recover the look.
    restoreSavedLookFromMobile.mockRejectedValueOnce(new Error('503 temporary'))
    await userEvent.click(screen.getAllByTestId('saved-look-remove')[0]!)
    await userEvent.click(await screen.findByText('Undo'))
    await userEvent.click(await screen.findByTestId('status-bar-action-retry'))
    await waitFor(() => expect(restoreSavedLookFromMobile).toHaveBeenCalledTimes(2))

    // Failed DELETE offers Retry, and 404 stale DELETE omits Undo.
    deleteSavedLookFromMobile
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce(undefined)
    await userEvent.click(screen.getAllByTestId('saved-look-remove')[1]!)
    await userEvent.click(await screen.findByTestId('status-bar-action-retry'))
    await screen.findByText('Undo')

    deleteSavedLookFromMobile.mockRejectedValueOnce(
      new MobileSavedLookRequestError('Not found', 404, 'SAVED_LOOK_NOT_FOUND')
    )
    await userEvent.click(screen.getAllByTestId('saved-look-remove')[1]!)
    await waitFor(() => expect(screen.queryByText('Undo')).not.toBeInTheDocument())
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent('Removed')

    // Offline Remove shows offline notice immediately, and offline Undo shows offline Undo action.
    deleteSavedLookFromMobile.mockResolvedValueOnce(undefined)
    await userEvent.click(screen.getAllByTestId('saved-look-remove')[0]!)
    const undoBtn = await screen.findByText('Undo')
    resetNetworkStatusForTests(false)
    await userEvent.click(undoBtn)
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    deleteSavedLookFromMobile.mockClear()
    await userEvent.click(screen.getAllByTestId('saved-look-remove')[0]!)
    expect(deleteSavedLookFromMobile).not.toHaveBeenCalled()
    resetNetworkStatusForTests(true)
  })
})

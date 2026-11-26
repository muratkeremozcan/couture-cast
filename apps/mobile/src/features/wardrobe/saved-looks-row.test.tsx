// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-NAT-030..032 for the saved look detail layer (D12): its
// header is the app top bar with back and the look's title, and back, system back and a header
// swipe close it and hand accessibility focus back to the look's Reopen.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactNativeModule from 'react-native'
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

// D13: native accessibility focus. react-native-web's findNodeHandle always throws, so each node
// gets a stable fake tag; on web (every other case here) the wrapper never asks for one.
const a11y = vi.hoisted(() => {
  const tags = new Map<unknown, number>()
  return {
    tags,
    tagOf: (node: unknown) => {
      if (!tags.has(node)) tags.set(node, 300 + tags.size)
      return tags.get(node)!
    },
    setAccessibilityFocus: vi.fn(),
  }
})
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    findNodeHandle: (node: unknown) => (node ? a11y.tagOf(node) : null),
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: a11y.setAccessibilityFocus,
    },
  }
})

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

import { Platform } from 'react-native'
import { MobileSavedLookRequestError } from '../../lib/saved-looks'
import { ClosetSavedLooksRow } from './saved-looks-row'
import { LAYER_SWIPE_CLOSE_PX } from '@/components/edge-to-edge-modal'
import { dragFrom } from '@/src/test-utils/layer-swipe'
import { press } from '@/src/test-utils/press'

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

    // [Codex 7.11 #8] Story CC-7.11 D13: the Reopen pressed rides along as the editor's opener,
    // so focus can return to it once the editor closes.
    const reopen = screen.getByTestId('saved-look-reopen')
    await userEvent.click(reopen)
    expect(onReopenStylePiece).toHaveBeenCalledExactlyOnceWith(look, reopen)

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

    // Story CC-7.11 D12: the top bar back arrow replaced the detail's Close.
    await userEvent.click(screen.getByTestId('app-top-bar-back'))
    await waitFor(() =>
      expect(screen.queryByTestId('saved-look-detail-modal')).not.toBeInTheDocument()
    )
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
    expect(await screen.findByTestId('saved-look-detail-missing')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('app-top-bar-back'))
    await waitFor(() =>
      expect(screen.queryByTestId('saved-look-detail-modal')).not.toBeInTheDocument()
    )

    // Opening needs-review detail modal shows needs-review notice, and detail-remove closes modal.
    getSavedLookFromMobile.mockResolvedValueOnce(errorPhotoLook)
    await userEvent.click(screen.getAllByTestId('saved-look-reopen')[1]!)
    expect(
      await screen.findByTestId('saved-look-detail-needs-review')
    ).toBeInTheDocument()
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

/**
 * Story CC-7.11 D12, D13: a saved look's detail is a full-height layer under the app top bar. The
 * cases run the native focus path (Android): react-native-web would also refocus the clicked
 * Reopen on its own, which would hide a lost `returnFocusRef`.
 */
describe('ClosetSavedLooksRow detail layer (Story CC-7.11)', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    setMobileApplicationUserId(null)
    a11y.tags.clear()
    shown.clear()
    // The photo refresh an opened detail asks for returns the same look.
    getSavedLookFromMobile.mockImplementation((id: string) =>
      Promise.resolve(shown.get(id))
    )
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
  })
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
  })

  const shown = new Map<string, SavedLookContract>()

  /** A look whose slots are out of the editor's order, so Reopen opens its detail. */
  function detailLook(id: string, title: string | null = null): SavedLookContract {
    const base = makeExactEditorLook()
    const look = makeExactEditorLook({
      id,
      title,
      composition: [
        base.composition[0]!,
        { ...base.composition[base.composition.length - 1]!, slotIndex: 1 },
        { ...base.composition[1]!, slotIndex: 2 },
      ],
    })
    shown.set(id, look)
    return look
  }

  async function openDetail(title: string) {
    await render(
      <ClosetSavedLooksRow
        owner="user-1"
        savedLooks={[
          detailLook('sl-first', 'Rainy commute'),
          detailLook('sl-second', title),
        ]}
        isLoading={false}
        loadError={null}
        garments={[ACTIVE_GARMENT]}
        onRetry={vi.fn()}
        onChanged={vi.fn()}
        onReopenStylePiece={vi.fn()}
        variant="list"
      />
    )
    // The second look's Reopen, so focus has to come back to the opener, not the first match.
    const reopen = screen.getAllByTestId('saved-look-reopen')[1]!
    press(reopen)
    const detail = await screen.findByTestId('saved-look-detail-modal')
    return { reopen, detail }
  }

  it("[7.11-NAT-030] the header is the app top bar with a back arrow and the look's title", async () => {
    const { detail } = await openDetail('Weekend layers')
    const handle = within(detail).getByTestId('layer-swipe-handle')
    const bar = within(handle).getByTestId('app-top-bar')
    const back = within(bar).getByTestId('app-top-bar-back')
    expect(back.getAttribute('role')).toBe('button')
    expect(back.getAttribute('aria-label')).toBe('Back')
    const title = within(bar).getByTestId('app-top-bar-title')
    expect(title.getAttribute('role')).toBe('heading')
    expect(title).toHaveTextContent('Weekend layers')
    // One header: the old detail heading and its Close are gone.
    expect(within(detail).queryByText('Saved look')).toBeNull()
    expect(within(detail).queryByText('Close')).toBeNull()
    expect(within(detail).getByTestId('layer-body')).toBeInTheDocument()
  })

  it.each([
    [
      '7.11-NAT-031',
      'the top bar back arrow',
      (detail: HTMLElement): void | Promise<void> => {
        press(within(detail).getByTestId('app-top-bar-back'))
      },
    ],
    [
      '7.11-NAT-030',
      'system back',
      (): void | Promise<void> => {
        // react-native-web calls the Modal's onRequestClose on Escape, as Android does on back.
        fireEvent.keyUp(document.body, { key: 'Escape' })
      },
    ],
    [
      '7.11-NAT-032',
      'a swipe down on the top bar',
      async (detail: HTMLElement) => {
        await dragFrom(within(detail).getByTestId('app-top-bar-title'), {
          dy: LAYER_SWIPE_CLOSE_PX + 40,
        })
      },
    ],
  ] as const)(
    '[%s] %s closes the detail and accessibility focus returns to its Reopen',
    async (_id, _way, close) => {
      const { reopen, detail } = await openDetail('Weekend layers')
      expect(a11y.setAccessibilityFocus).not.toHaveBeenCalled()

      await close(detail)

      await waitFor(() =>
        expect(screen.queryByTestId('saved-look-detail-modal')).not.toBeInTheDocument()
      )
      const reopenTag = a11y.tagOf(reopen)
      await waitFor(() =>
        expect(a11y.setAccessibilityFocus).toHaveBeenLastCalledWith(reopenTag)
      )
      const firstReopen = screen.getAllByTestId('saved-look-reopen')[0]!
      expect(a11y.setAccessibilityFocus).not.toHaveBeenCalledWith(a11y.tagOf(firstReopen))
    }
  )

  it('[7.11-NAT-033] a short swipe on the top bar leaves the detail open', async () => {
    const { detail } = await openDetail('Weekend layers')
    await dragFrom(within(detail).getByTestId('app-top-bar-title'), {
      dy: LAYER_SWIPE_CLOSE_PX / 2,
    })
    expect(screen.getByTestId('saved-look-detail-modal')).toBeInTheDocument()
    expect(a11y.setAccessibilityFocus).not.toHaveBeenCalled()
  })
})

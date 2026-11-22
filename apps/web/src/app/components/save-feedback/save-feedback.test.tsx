// Learning path Step 59: Shared save, undo and status feedback.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-59-shared-save-undo-and-status-feedback
// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { createRef, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReadyGarmentFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import { SAVE_FEEDBACK_TIMINGS } from '@couture/utils'
import { getI18n } from '../../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/browser-persistence'
import type * as WebSession from '../../../lib/web-session'
import { useMswHandlers } from '../../../test-utils/msw/runtime'
import { createSavedLooksMswHandlers } from '../../../test-utils/saved-looks-msw'
import { HomeRitual } from '../home-ritual'
import { StylePiecePanel } from '../../wardrobe/style-piece-panel'
import {
  computeNonOverlappingBottomOffset,
  rectsOverlap,
  SaveActionButton,
  SaveFeedbackProvider,
  StatusFeedbackBar,
  useSaveAction,
  useStatusBar,
  type AnnouncementEntry,
} from './index'

const sessionMock = vi.hoisted(() => ({ owner: null as string | null }))
vi.mock('../../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => sessionMock.owner,
}))

function NoticeHarness({
  actionsCount = 2,
  onAction,
}: {
  actionsCount?: number
  onAction?: (id: string) => void
}) {
  const { showNotice } = useStatusBar()
  return (
    <button
      type="button"
      onClick={() =>
        showNotice({
          id: 'harness-notice',
          message: 'Saved to your looks.',
          tone: 'success',
          actions: Array.from({ length: actionsCount }, (_, index) => ({
            id: `action-${index + 1}`,
            kind: index === 0 ? 'view' : index === 1 ? 'undo' : 'retry',
            label: index === 0 ? 'View' : index === 1 ? 'Undo' : 'Retry',
            onPress: () => onAction?.(`action-${index + 1}`),
          })),
        })
      }
    >
      Trigger notice
    </button>
  )
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  })
}

beforeEach(async () => {
  await getI18n().changeLanguage('en-US')
  setNavigatorOnline(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  setNavigatorOnline(true)
})

describe('web save-feedback components', () => {
  it('fast commit: transitions idle -> saving -> saved only after commit, shows 5s bar, announces each state once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const announcements: AnnouncementEntry[] = []
    const pending = Promise.withResolvers<boolean>()
    const onSave = vi.fn(() => pending.promise)
    const onView = vi.fn()
    const onUndo = vi.fn(() => true)

    render(
      <SaveFeedbackProvider onAnnounce={(entry) => announcements.push(entry)}>
        <SaveActionButton
          data-testid="save-btn"
          onSave={onSave}
          onView={onView}
          onUndo={onUndo}
        />
      </SaveFeedbackProvider>
    )

    const button = screen.getByTestId('save-btn')
    expect(button).toHaveTextContent('Save')
    expect(button).toHaveAttribute('data-save-state', 'idle')

    fireEvent.click(button)
    // Immediate synchronous transition (< 100 ms); NOT optimistic Saved
    expect(button).toHaveTextContent('Saving')
    expect(button).toHaveAttribute('data-save-state', 'saving')
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('save-action-check-icon')).toBeNull()
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
    expect(announcements.map((a) => a.message)).toEqual(['Saving'])

    // Resolve commit after 50 ms
    await act(async () => {
      vi.advanceTimersByTime(50)
      pending.resolve(true)
      await pending.promise
    })

    expect(button).toHaveTextContent('Saved')
    expect(button).toHaveAttribute('data-save-state', 'saved')
    expect(screen.getByTestId('save-action-check-icon')).toBeInTheDocument()

    const bar = screen.getByTestId('status-feedback-bar')
    expect(bar).toHaveTextContent('Saved to your looks.')
    // Visual bar itself must not declare aria-live/role=status to avoid double announcements
    expect(bar).not.toHaveAttribute('aria-live')
    expect(bar).not.toHaveAttribute('role')
    const barButtons = within(bar).getAllByRole('button')
    expect(barButtons.map((b) => b.textContent)).toEqual(['View', 'Undo'])
    // Single live announcer announced Saving once and Saved once
    expect(screen.getAllByTestId('save-feedback-announcer')).toHaveLength(1)
    expect(announcements.map((a) => a.message)).toEqual([
      'Saving',
      'Saved to your looks.',
    ])

    // Auto-dismisses after 5,000 ms
    act(() => {
      vi.advanceTimersByTime(SAVE_FEEDBACK_TIMINGS.statusBarDurationMs - 1)
    })
    expect(screen.getByTestId('status-feedback-bar')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
  })

  it('slow commit: promotes saving -> still-saving at 1,000 ms then -> saved on commit, announcing each once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const announcements: AnnouncementEntry[] = []
    const pending = Promise.withResolvers<boolean>()

    render(
      <SaveFeedbackProvider onAnnounce={(entry) => announcements.push(entry)}>
        <SaveActionButton data-testid="save-btn" onSave={() => pending.promise} />
      </SaveFeedbackProvider>
    )

    const button = screen.getByTestId('save-btn')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Saving')

    act(() => {
      vi.advanceTimersByTime(SAVE_FEEDBACK_TIMINGS.stillSavingAfterMs - 1)
    })
    expect(button).toHaveTextContent('Saving')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(button).toHaveTextContent('Still saving')
    expect(button).toHaveAttribute('data-save-state', 'still-saving')
    expect(announcements.map((a) => a.message)).toEqual(['Saving', 'Still saving'])

    await act(async () => {
      pending.resolve(true)
      await pending.promise
    })

    expect(button).toHaveTextContent('Saved')
    expect(announcements.map((a) => a.message)).toEqual([
      'Saving',
      'Still saving',
      'Saved to your looks.',
    ])
  })

  it('failed save & retry: keeps content intact, shows Failed + Retry bar, and retries cleanly without unhandled rejection', async () => {
    const unhandled = vi.fn()
    window.addEventListener('unhandledrejection', unhandled)
    const onSave = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('Server 500'))
      .mockResolvedValueOnce(true)

    try {
      const user = userEvent.setup()
      render(
        <SaveFeedbackProvider>
          <article data-testid="look-content">Silk midi look</article>
          <SaveActionButton data-testid="save-btn" onSave={onSave} />
        </SaveFeedbackProvider>
      )

      await user.click(screen.getByTestId('save-btn'))
      expect(screen.getByTestId('look-content')).toHaveTextContent('Silk midi look')
      expect(screen.getByTestId('save-btn')).toHaveTextContent('Failed')
      expect(screen.getByTestId('save-action-failed-icon')).toBeInTheDocument()

      const bar = screen.getByTestId('status-feedback-bar')
      expect(bar).toHaveTextContent('Could not save. Try again.')
      const retry = within(bar).getByRole('button', { name: 'Retry' })

      await user.click(retry)
      expect(onSave).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('save-btn')).toHaveTextContent('Saved')
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('unhandledrejection', unhandled)
    }
  })

  it('offline network action & reconnect: shows single offline line under top bar, blocks network call, recovers on reconnect', async () => {
    setNavigatorOnline(false)
    const onSave = vi.fn(() => Promise.resolve(true))
    const user = userEvent.setup()

    render(
      <SaveFeedbackProvider>
        <div data-testid="look-content">Office oxford</div>
        <SaveActionButton data-testid="save-btn" requiresNetwork onSave={onSave} />
      </SaveFeedbackProvider>
    )

    const offlineLines = screen.getAllByTestId('offline-status-line')
    expect(offlineLines).toHaveLength(1)
    expect(offlineLines[0]).toHaveTextContent('You are offline')

    await user.click(screen.getByTestId('save-btn'))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('look-content')).toHaveTextContent('Office oxford')
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'You are offline. Save when you reconnect.'
    )

    // Connectivity returns
    act(() => {
      setNavigatorOnline(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByTestId('offline-status-line')).toBeNull()

    await user.click(screen.getByTestId('save-btn'))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saved')
  })

  it('undo save: reverses the save, restores idle button, and handles undo failure without crashing', async () => {
    const user = userEvent.setup()
    const onUndo = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Undo failed'))

    render(
      <SaveFeedbackProvider>
        <SaveActionButton
          data-testid="save-btn"
          onSave={() => Promise.resolve(true)}
          onUndo={onUndo}
        />
      </SaveFeedbackProvider>
    )

    await user.click(screen.getByTestId('save-btn'))
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saved')

    await user.click(screen.getByTestId('status-bar-action-undo'))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Save')
    expect(screen.getByTestId('save-btn')).toHaveAttribute('data-save-state', 'idle')
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent('Change undone.')

    // Second save + failing undo shows error notice cleanly
    await user.click(screen.getByTestId('save-btn'))
    await user.click(screen.getByTestId('status-bar-action-undo'))
    expect(onUndo).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'Could not save. Try again.'
    )
  })

  it('clamps status bar actions to at most 2 in order', async () => {
    const user = userEvent.setup()
    render(
      <SaveFeedbackProvider>
        <NoticeHarness actionsCount={3} />
      </SaveFeedbackProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Trigger notice' }))
    const bar = screen.getByTestId('status-feedback-bar')
    const buttons = within(bar).getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons.map((b) => b.textContent)).toEqual(['View', 'Undo'])
  })

  it('ignores stale run completion after reset or owner switch and cleans up timers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const first = Promise.withResolvers<boolean>()
    const onSave = vi.fn(() => first.promise)

    const { rerender, unmount } = render(
      <SaveFeedbackProvider>
        <SaveActionButton data-testid="save-btn" ownerKey="member-a" onSave={onSave} />
      </SaveFeedbackProvider>
    )

    fireEvent.click(screen.getByTestId('save-btn'))
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saving')

    // Switch member while run 1 is still in flight
    rerender(
      <SaveFeedbackProvider>
        <SaveActionButton data-testid="save-btn" ownerKey="member-b" onSave={onSave} />
      </SaveFeedbackProvider>
    )
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Save')

    // Stale run 1 resolves — must NOT overwrite member-b's idle state
    await act(async () => {
      vi.advanceTimersByTime(1_500)
      first.resolve(true)
      await first.promise
    })
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Save')
    expect(screen.getByTestId('save-btn')).toHaveAttribute('data-save-state', 'idle')
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()

    unmount()
  })

  it('works standalone outside SaveFeedbackProvider with a single announcer', async () => {
    const announcements: AnnouncementEntry[] = []
    const user = userEvent.setup()
    render(
      <SaveActionButton
        data-testid="standalone-save"
        onSave={() => Promise.resolve(true)}
        onAnnounce={(entry) => announcements.push(entry)}
      />
    )

    await user.click(screen.getByTestId('standalone-save'))
    expect(screen.getByTestId('standalone-save')).toHaveTextContent('Saved')
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'Saved to your looks.'
    )
    expect(screen.getAllByTestId('save-feedback-announcer')).toHaveLength(1)
    expect(announcements.map((a) => a.message)).toEqual([
      'Saving',
      'Saved to your looks.',
    ])
  })

  it('computes non-overlapping bottom placement at 390x844 above StickyBottomNav and primary button', () => {
    const viewportHeight = 844
    const barRect = {
      top: 720,
      bottom: 772,
      left: 16,
      right: 374,
      width: 358,
      height: 52,
    }
    const navRect = { top: 776, bottom: 844, left: 0, right: 390, width: 390, height: 68 }
    const primaryRect = {
      top: 716,
      bottom: 760,
      left: 16,
      right: 374,
      width: 358,
      height: 44,
    }

    const offset = computeNonOverlappingBottomOffset({
      barRect,
      obstacles: [navRect, primaryRect],
      viewportHeight,
      baseBottomPx: 72,
    })

    const placedBar = {
      ...barRect,
      top: viewportHeight - offset - barRect.height,
      bottom: viewportHeight - offset,
    }
    expect(rectsOverlap(placedBar, navRect)).toBe(false)
    expect(rectsOverlap(placedBar, primaryRect)).toBe(false)
    expect(placedBar.bottom).toBeLessThanOrEqual(primaryRect.top)
  })

  it('applies non-overlapping inline style in DOM when obstacles intersect floating bar', () => {
    const originalInnerHeight = window.innerHeight
    const originalInnerWidth = window.innerWidth
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })

    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.testid === 'sticky-bottom-nav') {
          return new DOMRect(0, 776, 390, 68)
        }
        if (this.dataset.primaryAction === 'true') {
          return new DOMRect(16, 716, 358, 44)
        }
        if (this.dataset.testid === 'status-feedback-bar') {
          return new DOMRect(16, 720, 358, 52)
        }
        return new DOMRect(0, 0, 0, 0)
      })

    try {
      render(
        <div>
          <button type="button" data-primary-action="true">
            Primary
          </button>
          <nav data-testid="sticky-bottom-nav" />
          <StatusFeedbackBar
            notice={{
              id: 'n1',
              announcementId: 'saved:1',
              message: 'Saved to your looks.',
              tone: 'success',
              urgency: 'polite',
              actions: [],
              durationMs: 5_000,
            }}
            onDismiss={vi.fn()}
          />
        </div>
      )

      const bar = screen.getByTestId('status-feedback-bar')
      // Should have bumped bottom above primaryRect.top (844 - 716 + 12 = 140px)
      expect(bar.style.bottom).toBe('140px')
    } finally {
      rectSpy.mockRestore()
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      })
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalInnerWidth,
      })
    }
  })

  it('inline modal provider owns its own live region and mounts keyed spans for consecutive identical announcements', async () => {
    const user = userEvent.setup()
    const rootAnnouncements: AnnouncementEntry[] = []
    const modalAnnouncements: AnnouncementEntry[] = []

    function RepeatAnnouncer() {
      const { showNotice } = useStatusBar()
      const countRef = useRef(0)
      return (
        <button
          type="button"
          data-testid="repeat-trigger"
          onClick={() => {
            countRef.current += 1
            showNotice({
              id: `repeat-${countRef.current}`,
              announcementId: `repeat:${countRef.current}`,
              message: 'Look updated.',
              tone: 'neutral',
            })
          }}
        >
          Repeat
        </button>
      )
    }

    render(
      <SaveFeedbackProvider onAnnounce={(entry) => rootAnnouncements.push(entry)}>
        <div role="dialog" data-testid="inline-modal">
          <SaveFeedbackProvider
            inline
            renderOfflineLine={false}
            onAnnounce={(entry) => modalAnnouncements.push(entry)}
          >
            <RepeatAnnouncer />
          </SaveFeedbackProvider>
        </div>
      </SaveFeedbackProvider>
    )

    const modal = screen.getByTestId('inline-modal')
    const modalAnnouncer = within(modal).getByTestId('save-feedback-announcer')

    await user.click(screen.getByTestId('repeat-trigger'))
    const firstSpan = modalAnnouncer.querySelector('span')
    expect(firstSpan).not.toBeNull()
    expect(firstSpan).toHaveTextContent('Look updated.')

    await user.click(screen.getByTestId('repeat-trigger'))
    const secondSpan = modalAnnouncer.querySelector('span')
    expect(secondSpan).not.toBeNull()
    expect(secondSpan).toHaveTextContent('Look updated.')
    // Keyed span re-mounted so screen readers receive a fresh DOM mutation
    expect(secondSpan).not.toBe(firstSpan)
    expect(modalAnnouncements).toHaveLength(2)
    expect(rootAnnouncements).toHaveLength(0)
  })

  it('positions OfflineStatusLine directly beneath a visible <header>', () => {
    setNavigatorOnline(false)
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.tagName === 'HEADER') {
          return new DOMRect(0, 0, 390, 56)
        }
        return new DOMRect(0, 0, 0, 0)
      })
    try {
      render(
        <SaveFeedbackProvider>
          <header>Top Bar</header>
        </SaveFeedbackProvider>
      )
      const line = screen.getByTestId('offline-status-line')
      expect(line.style.top).toBe('56px')
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('dismisses provider notice on unmount or owner switch and blocks stale Undo/Retry callbacks', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn(() => true)
    const onSave = vi.fn(() => true)

    const view = render(
      <SaveFeedbackProvider>
        <SaveActionButton
          data-testid="save-btn"
          ownerKey="owner-1"
          onSave={onSave}
          onUndo={onUndo}
        />
      </SaveFeedbackProvider>
    )

    await user.click(screen.getByTestId('save-btn'))
    expect(screen.getByTestId('status-feedback-bar')).toBeInTheDocument()

    // Switching owner immediately dismisses the previous owner's notice
    view.rerender(
      <SaveFeedbackProvider>
        <SaveActionButton
          data-testid="save-btn"
          ownerKey="owner-2"
          onSave={onSave}
          onUndo={onUndo}
        />
      </SaveFeedbackProvider>
    )
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()

    // Save for owner-2, then unmount SaveActionButton -> notice dismisses cleanly
    await user.click(screen.getByTestId('save-btn'))
    expect(screen.getByTestId('status-feedback-bar')).toBeInTheDocument()
    view.rerender(
      <SaveFeedbackProvider>
        <div>Unmounted button</div>
      </SaveFeedbackProvider>
    )
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('offline Save in StylePiecePanel keeps looks on screen and shows the offline notice without calling loadInventory', async () => {
    const user = userEvent.setup()
    const garment = createReadyGarmentFixture({
      id: 'offline-garment',
      imageAccess: {
        url: 'https://photos.example.test/offline-top.png',
        expiresAt: '2090-01-01T00:00:00.000Z',
      },
    })
    const loadInventory = vi.fn(() => Promise.resolve([garment]))
    const invoker = createRef<HTMLElement>()
    sessionMock.owner = 'offline-owner'
    sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'offline-owner')
    window.dispatchEvent(new Event('couture:session'))

    try {
      render(
        <SaveFeedbackProvider>
          <StylePiecePanel
            selection={{
              id: garment.id,
              category: garment.category ?? 'top',
              comfortRange: garment.comfortRange ?? 'mild',
            }}
            inWardrobe
            loadInventory={loadInventory}
            owner="offline-owner"
            locale="en-US"
            invoker={invoker}
            onClose={vi.fn()}
          />
        </SaveFeedbackProvider>
      )

      const dialog = await screen.findByRole('dialog', { name: 'Style this piece' })
      await within(dialog).findByRole('heading', { name: 'Look 1' })
      const callsBeforeOffline = loadInventory.mock.calls.length

      act(() => {
        setNavigatorOnline(false)
        window.dispatchEvent(new Event('offline'))
      })

      const [firstSave] = within(dialog).getAllByTestId('style-piece-save')
      await user.click(firstSave!)

      // Did not invoke network refresh, kept looks intact, showed offline notice
      expect(loadInventory).toHaveBeenCalledTimes(callsBeforeOffline)
      expect(within(dialog).getByRole('heading', { name: 'Look 1' })).toBeVisible()
      expect(within(dialog).getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
      // Offline banner is visible inside the open modal too
      expect(within(dialog).getByTestId('offline-status-line')).toHaveTextContent(
        'You are offline'
      )
    } finally {
      sessionMock.owner = null
      sessionStorage.clear()
      localStorage.clear()
    }
  })

  it('StylePiecePanel transient refresh failure keeps looks on screen with Failed/Retry, while genuine revocation hides the photo', async () => {
    const user = userEvent.setup()
    useMswHandlers(...createSavedLooksMswHandlers().handlers)
    const garment = createReadyGarmentFixture({
      id: 'transient-garment',
      imageAccess: {
        url: 'https://photos.example.test/transient-top.png',
        expiresAt: '2090-01-01T00:00:00.000Z',
      },
    })
    const loadInventory = vi
      .fn<() => Promise<(typeof garment)[]>>()
      .mockResolvedValueOnce([garment]) // initial mount
      .mockRejectedValueOnce(new Error('Wardrobe request failed with status 503')) // transient Save failure
      .mockResolvedValueOnce([garment]) // Retry succeeds
      .mockResolvedValueOnce([]) // genuine deletion/revocation
    const invoker = createRef<HTMLElement>()
    sessionMock.owner = 'transient-owner'
    sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'transient-owner')
    window.dispatchEvent(new Event('couture:session'))

    try {
      render(
        <SaveFeedbackProvider>
          <StylePiecePanel
            selection={{
              id: garment.id,
              category: garment.category ?? 'top',
              comfortRange: garment.comfortRange ?? 'mild',
            }}
            inWardrobe
            loadInventory={loadInventory}
            owner="transient-owner"
            locale="en-US"
            invoker={invoker}
            onClose={vi.fn()}
          />
        </SaveFeedbackProvider>
      )

      const dialog = await screen.findByRole('dialog', { name: 'Style this piece' })
      await within(dialog).findByRole('heading', { name: 'Look 1' })

      // Transient 503 on Save keeps look on screen and offers Retry
      const [firstSave] = within(dialog).getAllByTestId('style-piece-save')
      await user.click(firstSave!)
      expect(within(dialog).getByRole('heading', { name: 'Look 1' })).toBeVisible()
      expect(firstSave).toHaveTextContent('Failed')
      const retry = within(dialog).getByTestId('status-bar-action-retry')

      // Retry succeeds
      await user.click(retry)
      await waitFor(() => expect(firstSave).toHaveTextContent('Saved'))

      // Swap companion resets button out of Saved
      const firstArticle = within(dialog).getAllByTestId('style-piece-look')[0]!
      await user.click(within(firstArticle).getByTestId('style-piece-swap-shoes'))
      const swapOptions = within(firstArticle).getAllByTestId(/^style-piece-option-/)
      await user.click(swapOptions[0]!)
      expect(within(firstArticle).getByTestId('style-piece-save')).toHaveTextContent(
        'Save look'
      )

      // Genuine revocation (empty inventory) still hides the photo
      await user.click(within(firstArticle).getByTestId('style-piece-save'))
      expect(await within(dialog).findByTestId('style-piece-unavailable')).toBeVisible()
    } finally {
      sessionMock.owner = null
      sessionStorage.clear()
      localStorage.clear()
    }
  })

  it('sibling SaveActionButton controls do not collide on announcement or notice IDs', async () => {
    const user = userEvent.setup()
    const announcements: AnnouncementEntry[] = []

    const view = render(
      <SaveFeedbackProvider onAnnounce={(entry) => announcements.push(entry)}>
        <SaveActionButton
          key="save-a"
          data-testid="save-a"
          onSave={() => Promise.resolve(true)}
          onUndo={() => true}
        />
        <SaveActionButton
          key="save-b"
          data-testid="save-b"
          onSave={() => Promise.resolve(true)}
          onUndo={() => true}
        />
      </SaveFeedbackProvider>
    )

    await user.click(screen.getByTestId('save-a'))
    await user.click(screen.getByTestId('save-b'))

    // Both first saves announced both Saving and Saved to your looks.
    expect(announcements.map((a) => a.message)).toEqual([
      'Saving',
      'Saved to your looks.',
      'Saving',
      'Saved to your looks.',
    ])

    // Unmounting control A must NOT dismiss control B's live notice
    view.rerender(
      <SaveFeedbackProvider onAnnounce={(entry) => announcements.push(entry)}>
        {null}
        <SaveActionButton
          key="save-b"
          data-testid="save-b"
          onSave={() => Promise.resolve(true)}
          onUndo={() => true}
        />
      </SaveFeedbackProvider>
    )
    expect(screen.getByTestId('status-feedback-bar')).toBeInTheDocument()
  })

  it('superseded Save settling does not cancel a newer Save slow timer, and deferred Undo does not suppress a newer Save', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const run1 = Promise.withResolvers<boolean>()
    const run2 = Promise.withResolvers<boolean>()
    const onSave = vi
      .fn<() => Promise<boolean>>()
      .mockReturnValueOnce(run1.promise)
      .mockReturnValueOnce(run2.promise)

    const view = render(
      <SaveFeedbackProvider>
        <SaveActionButton data-testid="save-btn" ownerKey="owner-1" onSave={onSave} />
      </SaveFeedbackProvider>
    )

    fireEvent.click(screen.getByTestId('save-btn'))
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saving')

    // Switch owner and start run 2
    view.rerender(
      <SaveFeedbackProvider>
        <SaveActionButton data-testid="save-btn" ownerKey="owner-2" onSave={onSave} />
      </SaveFeedbackProvider>
    )
    fireEvent.click(screen.getByTestId('save-btn'))
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saving')

    // Stale run 1 settles at 200 ms — must NOT cancel run 2's 1,000 ms slow timer
    await act(async () => {
      vi.advanceTimersByTime(200)
      run1.resolve(true)
      await run1.promise
    })
    act(() => {
      vi.advanceTimersByTime(SAVE_FEEDBACK_TIMINGS.stillSavingAfterMs - 200)
    })
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Still saving')

    await act(async () => {
      run2.resolve(true)
      await run2.promise
    })
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saved')

    // Deferred Undo followed by a newer Save: Undo settling must not suppress the newer Save
    vi.useRealTimers()
    const deferredUndo = Promise.withResolvers<boolean>()
    const saveAfterUndo = Promise.withResolvers<boolean>()
    const onSave2 = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockReturnValueOnce(saveAfterUndo.promise)

    view.rerender(
      <SaveFeedbackProvider>
        <SaveActionButton
          data-testid="save-btn"
          ownerKey="owner-3"
          onSave={onSave2}
          onUndo={() => deferredUndo.promise}
        />
      </SaveFeedbackProvider>
    )
    fireEvent.click(screen.getByTestId('save-btn'))
    await waitFor(() => expect(screen.getByTestId('save-btn')).toHaveTextContent('Saved'))
    fireEvent.click(screen.getByTestId('status-bar-action-undo'))
    // Start a fresh Save while Undo is still pending
    fireEvent.click(screen.getByTestId('save-btn'))
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saving')
    await act(async () => {
      deferredUndo.resolve(true)
      await deferredUndo.promise
    })
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saving')
    await act(async () => {
      saveAfterUndo.resolve(true)
      await saveAfterUndo.promise
    })
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saved')
  })

  it('Retry button reads live connectivity and refuses to call network after going offline, then succeeds on reconnect', async () => {
    const user = userEvent.setup()
    const onSave = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce(true)

    render(
      <SaveFeedbackProvider>
        <SaveActionButton data-testid="save-btn" requiresNetwork onSave={onSave} />
      </SaveFeedbackProvider>
    )

    await user.click(screen.getByTestId('save-btn'))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'Could not save. Try again.'
    )

    // Go offline AFTER the Failed/Retry bar is already mounted
    act(() => {
      setNavigatorOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    await user.click(screen.getByTestId('status-bar-action-retry'))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'You are offline. Save when you reconnect.'
    )

    // Reconnect and click button to retry cleanly
    act(() => {
      setNavigatorOnline(true)
      window.dispatchEvent(new Event('online'))
    })
    await user.click(screen.getByTestId('save-btn'))
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saved')
  })

  it('Web Home old-session deferred Remove never posts a notice onto the next member, and Undo failure surfaces retryable error', async () => {
    const user = userEvent.setup()
    const ownerA = 'lock-owner-a'
    const ownerB = 'lock-owner-b'
    const { store, handlers } = createSavedLooksMswHandlers()
    const deferredDelete = Promise.withResolvers<void>()
    let holdNextDelete = false
    store.onDelete = async () => {
      if (holdNextDelete) {
        holdNextDelete = false
        await deferredDelete.promise
      }
    }

    useMswHandlers(
      http.get('/api/v1/ritual', () =>
        HttpResponse.json(
          { message: 'No location preferences found for user' },
          { status: 400 }
        )
      ),
      ...handlers
    )

    sessionMock.owner = ownerA
    sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, `bearer-${ownerA}`)
    window.dispatchEvent(new Event('couture:session'))

    try {
      render(
        <SaveFeedbackProvider>
          <HomeRitual demo={null} />
        </SaveFeedbackProvider>
      )

      const saveBtn = await screen.findByTestId('sample-save-look')
      await user.click(saveBtn)
      const savedRegion = await screen.findByTestId('sample-saved-looks')
      const removeBtn = within(savedRegion).getAllByRole('button', {
        name: /^Remove /,
      })[0]!
      await user.click(removeBtn)
      await waitFor(() =>
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent('Removed')
      )

      // Failed Undo POST surfaces error cleanly without corrupting state
      let failUndoOnce = true
      store.nextPostError = () => {
        if (!failUndoOnce) return null
        failUndoOnce = false
        return HttpResponse.json({ message: 'Server error' }, { status: 503 })
      }
      await user.click(screen.getByTestId('status-bar-action-undo'))
      await waitFor(() =>
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
          'Could not save. Try again.'
        )
      )

      // Save again and start a deferred Remove, then switch to member B before it settles
      await user.click(screen.getByTestId('sample-save-look'))
      const nextRegion = await screen.findByTestId('sample-saved-looks')
      holdNextDelete = true
      await user.click(
        within(nextRegion).getAllByRole('button', { name: /^Remove / })[0]!
      )

      act(() => {
        sessionMock.owner = ownerB
        sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, `bearer-${ownerB}`)
        window.dispatchEvent(new Event('couture:session'))
      })
      await screen.findByTestId('member-sample-outfit')
      await act(async () => {
        deferredDelete.resolve()
        await deferredDelete.promise
      })
      expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
    } finally {
      deferredDelete.resolve()
      sessionMock.owner = null
      sessionStorage.clear()
    }
  })

  it('covers placement edge cases, standalone useStatusBar, nested non-inline forwarding, initialOnline, and async action errors', async () => {
    const user = userEvent.setup()

    // rectsOverlap zero-size and computeNonOverlappingBottomOffset edge cases
    expect(
      rectsOverlap(
        { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 },
        { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 }
      )
    ).toBe(false)
    expect(
      computeNonOverlappingBottomOffset({
        barRect: { top: 0, bottom: 0, left: 0, right: 100, width: 100, height: 0 },
        obstacles: [],
        viewportHeight: 844,
        baseBottomPx: 20,
      })
    ).toBe(20)
    // Obstacle below the projected bottom so nextBottom <= bottomPx breaks cleanly
    expect(
      computeNonOverlappingBottomOffset({
        barRect: { top: 700, bottom: 750, left: 16, right: 374, width: 358, height: 50 },
        obstacles: [
          { top: 830, bottom: 860, left: 16, right: 374, width: 358, height: 30 },
        ],
        viewportHeight: 844,
        baseBottomPx: 100,
      })
    ).toBe(100)

    // Standalone useStatusBar outside any provider listens to online/offline events & exposes no-op fallbacks
    function StandaloneStatusHarness() {
      const bar = useStatusBar()
      return (
        <div>
          <span data-testid="standalone-online">{String(bar.isOnline)}</span>
          <button
            type="button"
            data-testid="standalone-call"
            onClick={() => {
              bar.showNotice({ id: 'noop', message: 'Noop' })
              bar.dismissNotice('noop')
              bar.announce('Noop', { announcementId: 'noop:1' })
            }}
          >
            Call
          </button>
        </div>
      )
    }
    const standalone = render(<StandaloneStatusHarness />)
    expect(screen.getByTestId('standalone-online')).toHaveTextContent('true')
    act(() => {
      setNavigatorOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByTestId('standalone-online')).toHaveTextContent('false')
    act(() => {
      setNavigatorOnline(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.getByTestId('standalone-online')).toHaveTextContent('true')
    await user.click(screen.getByTestId('standalone-call'))
    standalone.unmount()

    // Nested non-inline provider forwards announcements to parent; initialOnline controls state; >200 IDs rollover; async rejecting action settles cleanly
    const parentAnnouncements: AnnouncementEntry[] = []
    function NestedAnnounceHarness() {
      const bar = useStatusBar()
      return (
        <button
          type="button"
          data-testid="nested-trigger"
          onClick={() => {
            bar.announce('   ', { announcementId: 'blank:1' })
            bar.announce('Nested notice', { announcementId: 'nested:1' })
            bar.announce('Nested notice', { announcementId: 'nested:1' })
            for (let i = 0; i < 205; i += 1) {
              bar.announce(`Flood ${i}`, { announcementId: `flood:${i}` })
            }
            bar.showNotice({
              id: 'async-reject-notice',
              message: 'Try async',
              tone: 'neutral',
              actions: [
                {
                  id: 'async-act',
                  kind: 'undo',
                  label: 'Run async',
                  onPress: () => Promise.reject(new Error('action boom')),
                },
              ],
            })
          }}
        >
          Trigger
        </button>
      )
    }

    const nested = render(
      <SaveFeedbackProvider onAnnounce={(entry) => parentAnnouncements.push(entry)}>
        <SaveFeedbackProvider initialOnline={false}>
          <NestedAnnounceHarness />
        </SaveFeedbackProvider>
      </SaveFeedbackProvider>
    )
    expect(screen.getByTestId('offline-status-line')).toHaveTextContent('You are offline')
    await user.click(screen.getByTestId('nested-trigger'))
    expect(parentAnnouncements.some((entry) => entry.id === 'nested:1')).toBe(true)
    expect(parentAnnouncements.filter((entry) => entry.id === 'nested:1')).toHaveLength(1)
    expect(parentAnnouncements.some((entry) => entry.id === 'blank:1')).toBe(false)

    // Clicking an async rejecting action catches cleanly and dismisses the bar
    await user.click(screen.getByTestId('status-bar-action-undo'))
    await waitFor(() => expect(screen.queryByTestId('status-feedback-bar')).toBeNull())

    // Toggle initialOnline back to true clears offline line
    nested.rerender(
      <SaveFeedbackProvider onAnnounce={(entry) => parentAnnouncements.push(entry)}>
        <SaveFeedbackProvider initialOnline={true}>
          <NestedAnnounceHarness />
        </SaveFeedbackProvider>
      </SaveFeedbackProvider>
    )
    expect(screen.queryByTestId('offline-status-line')).toBeNull()
  })

  it('covers standalone SaveActionButton timer/dismiss, showStatusBar=false, sync throws, onView, extraActions, undo offline/error, and useSaveAction.reset', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const onView = vi.fn()
    const onExtra = vi.fn()
    const standaloneAnnounced: AnnouncementEntry[] = []

    // Standalone auto-dismiss, onView, extraActions, and showStatusBar=false
    const standaloneView = render(
      <>
        <SaveActionButton
          data-testid="standalone-save"
          onSave={() => true}
          onView={onView}
          extraActions={[{ id: 'extra', label: 'Extra', onPress: onExtra }]}
          onAnnounce={(entry) => standaloneAnnounced.push(entry)}
        />
        <SaveActionButton
          data-testid="silent-bar-save"
          showStatusBar={false}
          onSave={() => {
            throw new Error('sync boom')
          }}
        />
      </>
    )

    fireEvent.click(screen.getByTestId('standalone-save'))
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'Saved to your looks.'
    )
    // Clicking View calls onView and dismisses standalone notice
    fireEvent.click(screen.getByTestId('status-bar-action-view'))
    expect(onView).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()

    // Trigger again and let the 5s standalone auto-dismiss timer fire
    fireEvent.click(screen.getByTestId('standalone-save'))
    expect(screen.getByTestId('status-feedback-bar')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(SAVE_FEEDBACK_TIMINGS.statusBarDurationMs)
    })
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()

    // showStatusBar=false with sync throw enters failed state without rendering a bar
    fireEvent.click(screen.getByTestId('silent-bar-save'))
    expect(screen.getByTestId('silent-bar-save')).toHaveTextContent('Failed')
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
    standaloneView.unmount()
    vi.useRealTimers()

    // Provider-backed Undo offline, Undo returning false, Undo throwing offline error, network offline error onSave, disabled click, and reset()
    const user = userEvent.setup()
    let controllerRef: ReturnType<typeof useSaveAction> | null = null
    const onSave = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true) // 1: save before offline undo
      .mockResolvedValueOnce(true) // 2: save before undo returns false
      .mockResolvedValueOnce(true) // 3: save before undo throws offline error
      .mockRejectedValueOnce(new TypeError('Failed to fetch')) // 4: network error during save
    const onUndo = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    function ControllerHarness() {
      const controller = useSaveAction({
        onSave,
        onUndo,
        requiresNetwork: true,
        ownerKey: 'u1',
        resetKey: 'r1',
      })
      controllerRef = controller
      return (
        <div>
          <button
            type="button"
            data-testid="ctrl-save"
            onClick={() => void controller.triggerSave()}
          >
            {controller.state}
          </button>
          <button
            type="button"
            data-testid="ctrl-reset"
            onClick={() => controller.reset('saved')}
          >
            Reset
          </button>
          <SaveActionButton data-testid="disabled-save" disabled onSave={() => true} />
        </div>
      )
    }

    render(
      <SaveFeedbackProvider>
        <ControllerHarness />
      </SaveFeedbackProvider>
    )

    // Disabled click is a no-op
    fireEvent.click(screen.getByTestId('disabled-save'))
    expect(screen.getByTestId('disabled-save')).toHaveTextContent('Save')

    // 1. Save succeeds, then go offline and click Undo -> blocked with offline notice
    await user.click(screen.getByTestId('ctrl-save'))
    await waitFor(() =>
      expect(screen.getByTestId('ctrl-save')).toHaveTextContent('saved')
    )
    act(() => {
      setNavigatorOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    await user.click(screen.getByTestId('status-bar-action-undo'))
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'You are offline. Save when you reconnect.'
    )
    expect(onUndo).not.toHaveBeenCalled()

    // Reconnect -> 2. Save succeeds, Undo returns false -> shows failed notice
    act(() => {
      setNavigatorOnline(true)
      window.dispatchEvent(new Event('online'))
    })
    await user.click(screen.getByTestId('ctrl-save'))
    await waitFor(() =>
      expect(screen.getByTestId('status-bar-action-undo')).toBeInTheDocument()
    )
    await user.click(screen.getByTestId('status-bar-action-undo'))
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'Could not save. Try again.'
    )

    // 3. Save succeeds, Undo throws offline TypeError -> shows offline notice
    await user.click(screen.getByTestId('ctrl-save'))
    await waitFor(() =>
      expect(screen.getByTestId('status-bar-action-undo')).toBeInTheDocument()
    )
    await user.click(screen.getByTestId('status-bar-action-undo'))
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'You are offline. Save when you reconnect.'
    )

    // 4. Save rejects with offline TypeError while navigator says online -> shows offline notice
    await user.click(screen.getByTestId('ctrl-save'))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    expect(screen.getByTestId('status-feedback-bar')).toHaveAttribute(
      'data-tone',
      'offline'
    )

    // reset() sets explicit state and mismatched origin triggerSave/triggerUndo return false
    await user.click(screen.getByTestId('ctrl-reset'))
    expect(screen.getByTestId('ctrl-save')).toHaveTextContent('saved')
    expect(await controllerRef!.triggerSave({ ownerKey: 'wrong', resetKey: 'r1' })).toBe(
      false
    )
    expect(await controllerRef!.triggerUndo({ ownerKey: 'wrong', resetKey: 'r1' })).toBe(
      false
    )

    // Busy double-tap returns false immediately and triggerSave after unmount returns false
    const pendingSave = Promise.withResolvers<boolean>()
    let busyCtrl: ReturnType<typeof useSaveAction> | null = null
    function BusyHarness() {
      const controller = useSaveAction({
        onSave: () => pendingSave.promise,
        onView,
        ownerKey: 'b1',
        resetKey: 'r1',
      })
      busyCtrl = controller
      return <span data-testid="busy-state">{controller.state}</span>
    }
    const busyView = render(<BusyHarness />)
    let firstSavePromise!: Promise<boolean>
    act(() => {
      firstSavePromise = busyCtrl!.triggerSave()
    })
    expect(await busyCtrl!.triggerSave()).toBe(false)
    pendingSave.resolve(true)
    await act(async () => {
      await firstSavePromise
    })
    busyView.unmount()
    expect(await busyCtrl!.triggerSave()).toBe(false)
    expect(await busyCtrl!.triggerUndo()).toBe(false)
  })

  it('covers Web Home shuffle Undo, Save View/Undo, Remove Undo, and Remove failure Retry', async () => {
    const user = userEvent.setup()
    const owner = 'home-flow-owner'
    const { store, handlers } = createSavedLooksMswHandlers()

    useMswHandlers(
      http.get('/api/v1/ritual', () =>
        HttpResponse.json(
          { message: 'No location preferences found for user' },
          { status: 400 }
        )
      ),
      ...handlers
    )

    sessionMock.owner = owner
    sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, `bearer-${owner}`)
    window.dispatchEvent(new Event('couture:session'))

    try {
      render(
        <SaveFeedbackProvider>
          <HomeRitual demo={null} />
        </SaveFeedbackProvider>
      )

      await screen.findByTestId('member-sample-outfit')

      // Shuffle ("Try another") -> Undo restores previous look
      const tryAnother = screen.getByTestId('guest-preview-try-another')
      await user.click(tryAnother)
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent('Look updated.')
      await user.click(screen.getByTestId('status-bar-action-undo'))
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Change undone.'
      )

      // Swap a garment -> Undo swap restores previous garment
      const swapButtons = screen.getAllByRole('button', { name: /^Swap /i })
      if (swapButtons[0]) {
        await user.click(swapButtons[0])
        const dialog = screen.getByRole('dialog')
        const candidateRadio = within(dialog)
          .getAllByRole('radio')
          .find((input) => !(input as HTMLInputElement).checked)
        expect(candidateRadio).toBeDefined()
        await user.click(candidateRadio!)
        await waitFor(() =>
          expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
            'Piece swapped.'
          )
        )
        await user.click(screen.getByTestId('status-bar-action-undo'))
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
          'Change undone.'
        )
      }

      // Save -> View -> Undo Save
      const saveBtn = screen.getByRole('button', { name: /save/i })
      await user.click(saveBtn)
      await waitFor(() =>
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
          'Saved to your looks.'
        )
      )
      await user.click(screen.getByTestId('status-bar-action-view'))

      // Re-saving an already-saved look is a non-destructive no-op (no Undo action)
      await user.click(saveBtn)
      await waitFor(() =>
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
          'Saved to your looks.'
        )
      )
      expect(screen.queryByTestId('status-bar-action-undo')).not.toBeInTheDocument()
      expect(store.items).toHaveLength(1)

      // Switch to a different look, Save it, and Undo Save cleanly
      await user.click(tryAnother)
      await user.click(saveBtn)
      await waitFor(() =>
        expect(screen.getByTestId('status-bar-action-undo')).toBeInTheDocument()
      )
      expect(store.items).toHaveLength(2)
      await user.click(screen.getByTestId('status-bar-action-undo'))
      await waitFor(() =>
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
          'Change undone.'
        )
      )
      expect(store.items).toHaveLength(1)

      // Remove the saved item -> Undo Remove restores it cleanly
      const savedRegion = await screen.findByTestId('sample-saved-looks')
      const removeBtn = within(savedRegion).getAllByRole('button', {
        name: /^Remove /,
      })[0]!
      await user.click(removeBtn)
      await waitFor(() =>
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent('Removed')
      )
      await user.click(screen.getByTestId('status-bar-action-undo'))
      await waitFor(() =>
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
          'Change undone.'
        )
      )

      // Simulate API failure on Remove -> shows Failed + Retry, then Retry succeeds
      const savedRegion2 = await screen.findByTestId('sample-saved-looks')
      const removeBtn2 = within(savedRegion2).getAllByRole('button', {
        name: /^Remove /,
      })[0]!
      let failDeleteOnce = true
      store.nextDeleteError = () => {
        if (!failDeleteOnce) return null
        failDeleteOnce = false
        return HttpResponse.json({ message: 'Server error' }, { status: 503 })
      }
      await user.click(removeBtn2)
      await waitFor(() =>
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
          'Could not save. Try again.'
        )
      )
      await user.click(screen.getByTestId('status-bar-action-retry'))
      await waitFor(() =>
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent('Removed')
      )

      // Failed Undo restore leaves store empty cleanly
      let failRestoreOnce = true
      store.nextRestoreError = () => {
        if (!failRestoreOnce) return null
        failRestoreOnce = false
        return HttpResponse.json({ message: 'Server error' }, { status: 503 })
      }
      await user.click(screen.getByTestId('status-bar-action-undo'))
      await waitFor(() =>
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
          'Could not save. Try again.'
        )
      )
      expect(store.items).toHaveLength(0)
    } finally {
      sessionMock.owner = null
      sessionStorage.clear()
    }
  })

  it('guards stale expectedRunId Undo and busy Undo on web SaveActionButton, and covers StylePiecePanel swap/save/remove/undo/offline/retry paths', async () => {
    const user = userEvent.setup()

    // 1. Starting a new Save dismisses prior notice and blocks stale expectedRunId or busy Undo
    const pendingSecondSave = Promise.withResolvers<boolean>()
    const onSave = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockReturnValueOnce(pendingSecondSave.promise)
    const onUndo = vi.fn(() => Promise.resolve(true))
    let ctrlRef: ReturnType<typeof useSaveAction> | null = null

    function GuardHarness() {
      const controller = useSaveAction({
        onSave,
        onUndo,
        ownerKey: 'w1',
        resetKey: 'r1',
      })
      ctrlRef = controller
      return <span data-testid="w-guard-state">{controller.state}</span>
    }

    const guardView = render(
      <SaveFeedbackProvider>
        <GuardHarness />
      </SaveFeedbackProvider>
    )
    await act(async () => {
      expect(await ctrlRef!.triggerSave()).toBe(true)
    })
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'Saved to your looks.'
    )
    let activeSave!: Promise<boolean>
    act(() => {
      activeSave = ctrlRef!.triggerSave()
    })
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
    expect(
      await ctrlRef!.triggerUndo({ ownerKey: 'w1', resetKey: 'r1', expectedRunId: 1 })
    ).toBe(false)
    await act(async () => {
      pendingSecondSave.resolve(true)
      expect(await activeSave).toBe(true)
    })
    expect(
      await ctrlRef!.triggerUndo({ ownerKey: 'w1', resetKey: 'r1', expectedRunId: 1 })
    ).toBe(false)
    expect(onUndo).not.toHaveBeenCalled()
    guardView.unmount()

    // 2. StylePiecePanel full swap/save/view/undo/remove/offline/retry coverage
    const owner = 'style-panel-cov-owner'
    const { store: styleSavedStore, handlers: styleSavedHandlers } =
      createSavedLooksMswHandlers()
    useMswHandlers(...styleSavedHandlers)
    const garment = createReadyGarmentFixture({
      id: 'style-panel-cov-garment',
      imageAccess: {
        url: 'https://photos.example.test/top.png',
        expiresAt: '2090-01-01T00:00:00.000Z',
      },
    })
    const loadInventory = vi.fn<() => Promise<(typeof garment)[]>>()
    loadInventory.mockResolvedValue([garment])

    sessionMock.owner = owner
    sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, owner)
    window.dispatchEvent(new Event('couture:session'))
    const invokerRef = createRef<HTMLButtonElement>()
    try {
      render(
        <SaveFeedbackProvider>
          <button ref={invokerRef} type="button">
            Open
          </button>
          <StylePiecePanel
            selection={{
              id: garment.id,
              category: garment.category ?? 'top',
              comfortRange: garment.comfortRange ?? 'mild',
            }}
            inWardrobe
            loadInventory={loadInventory}
            owner={owner}
            locale="en-US"
            invoker={invokerRef}
            onClose={vi.fn()}
          />
        </SaveFeedbackProvider>
      )

      const panel = await screen.findByTestId('style-piece-panel')
      await within(panel).findByRole('heading', { name: 'Look 1' })

      // Swap a companion -> Undo Swap
      const swapButtons = within(panel)
        .getAllByRole('button')
        .filter((btn) => btn.getAttribute('data-testid')?.startsWith('style-piece-swap-'))
      if (swapButtons[0]) {
        await user.click(swapButtons[0])
        const optionButtons = within(panel)
          .getAllByRole('button')
          .filter((btn) =>
            btn.getAttribute('data-testid')?.startsWith('style-piece-option-')
          )
        if (optionButtons[0]) {
          await user.click(optionButtons[0])
          await waitFor(() =>
            expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
              'Piece swapped.'
            )
          )
          await user.click(within(panel).getByTestId('status-bar-action-undo'))
          await waitFor(() =>
            expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
              'Change undone.'
            )
          )
        }
      }

      // Save look -> click View -> Save unchanged look again -> NO destructive Undo & original row remains intact
      const firstSave = within(panel).getAllByTestId('style-piece-save')[0]!
      await user.click(firstSave)
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'Saved to your looks.'
        )
      )
      expect(within(panel).getByTestId('status-bar-action-undo')).toBeInTheDocument()
      await user.click(within(panel).getByTestId('status-bar-action-view'))

      // Clicking Save again on an already-saved identical look does not offer Undo or duplicate the row.
      await user.click(firstSave)
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'Saved to your looks.'
        )
      )
      expect(
        within(panel).queryByTestId('status-bar-action-undo')
      ).not.toBeInTheDocument()
      expect(styleSavedStore.items).toHaveLength(1)

      // Remove -> fresh Save -> Undo Save works cleanly on a newly created row
      await user.click(await within(panel).findByTestId('style-piece-remove'))
      await waitFor(() => expect(styleSavedStore.items).toHaveLength(0))
      await user.click(firstSave)
      await waitFor(() =>
        expect(within(panel).getByTestId('status-bar-action-undo')).toBeInTheDocument()
      )
      await user.click(within(panel).getByTestId('status-bar-action-undo'))
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'Change undone.'
        )
      )
      expect(styleSavedStore.items).toHaveLength(0)

      // Save again so we have a saved item for Remove flows
      await user.click(firstSave)
      const removeBtn = await within(panel).findByTestId('style-piece-remove')

      // Remove while offline -> offline notice without calling loadInventory
      const callsBeforeOfflineRemove = loadInventory.mock.calls.length
      act(() => {
        setNavigatorOnline(false)
        window.dispatchEvent(new Event('offline'))
      })
      await user.click(removeBtn)
      expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
      expect(loadInventory).toHaveBeenCalledTimes(callsBeforeOfflineRemove)
      act(() => {
        setNavigatorOnline(true)
        window.dispatchEvent(new Event('online'))
      })

      // Remove fails with 503 -> Failed + Retry -> Retry hits offline error -> Retry succeeds
      loadInventory
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce([garment])
      await user.click(removeBtn)
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'Could not save. Try again.'
        )
      )
      await user.click(within(panel).getByTestId('status-bar-action-retry'))
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'You are offline. Save when you reconnect.'
        )
      )

      // Remove succeeds -> Undo Remove while offline -> offline notice
      await user.click(removeBtn)
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'Removed'
        )
      )
      act(() => {
        setNavigatorOnline(false)
        window.dispatchEvent(new Event('offline'))
      })
      await user.click(within(panel).getByTestId('status-bar-action-undo'))
      expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
      act(() => {
        setNavigatorOnline(true)
        window.dispatchEvent(new Event('online'))
      })

      // Save, Remove -> Undo Remove hits 503 (Failed); Save, Remove -> Undo Remove hits offline error; Save, Remove -> Undo Remove succeeds
      await user.click(within(panel).getAllByTestId('style-piece-save')[0]!)
      await user.click(await within(panel).findByTestId('style-piece-remove'))
      loadInventory.mockRejectedValueOnce(new Error('503 Service Unavailable'))
      await user.click(within(panel).getByTestId('status-bar-action-undo'))
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'Could not save. Try again.'
        )
      )

      await user.click(within(panel).getAllByTestId('style-piece-save')[0]!)
      await user.click(await within(panel).findByTestId('style-piece-remove'))
      loadInventory.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      await user.click(within(panel).getByTestId('status-bar-action-undo'))
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'You are offline. Save when you reconnect.'
        )
      )

      await user.click(within(panel).getAllByTestId('style-piece-save')[0]!)
      await user.click(await within(panel).findByTestId('style-piece-remove'))
      await user.click(within(panel).getByTestId('status-bar-action-undo'))
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'Change undone.'
        )
      )
      // API error on Remove surfaces Failed + Retry, and Retry succeeds
      let failDeleteOnce = true
      styleSavedStore.nextDeleteError = () => {
        if (!failDeleteOnce) return null
        failDeleteOnce = false
        return HttpResponse.json({ message: 'Server error' }, { status: 503 })
      }
      await user.click(await within(panel).findByTestId('style-piece-remove'))
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'Could not save. Try again.'
        )
      )
      await user.click(within(panel).getByTestId('status-bar-action-retry'))
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'Removed'
        )
      )
    } finally {
      sessionMock.owner = null
      sessionStorage.clear()
      localStorage.clear()
    }
  })
})

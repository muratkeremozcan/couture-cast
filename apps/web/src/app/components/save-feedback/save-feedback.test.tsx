// Learning path Step 59: Shared save, undo and status feedback.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-59-shared-save-undo-and-status-feedback
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReadyGarmentFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import { SAVE_FEEDBACK_TIMINGS } from '@couture/utils'
import { getI18n } from '../../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/browser-persistence'
import type * as WebSession from '../../../lib/web-session'
import { StylePiecePanel } from '../../wardrobe/style-piece-panel'
import {
  computeNonOverlappingBottomOffset,
  rectsOverlap,
  SaveActionButton,
  SaveFeedbackProvider,
  StatusFeedbackBar,
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
    } finally {
      sessionMock.owner = null
      sessionStorage.clear()
      localStorage.clear()
    }
  })
})

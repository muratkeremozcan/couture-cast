// Learning path Step 59: Shared save, undo and status feedback.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-59-shared-save-undo-and-status-feedback
import { useRef } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessibilityInfo, AppState, Platform, Text, View } from 'react-native'
import { SAVE_FEEDBACK_TIMINGS } from '@couture/utils'
import {
  DEFAULT_MOBILE_TAB_BAR_HEIGHT,
  MOBILE_STATUS_BAR_GAP,
  MOBILE_TAB_BAR_CLEARANCE,
  reportNetworkOffline,
  reportNetworkOnline,
  resetMobilePrimaryActionClearanceForTests,
  resetMobileTabBarHeightForTests,
  resetNetworkStatusForTests,
  SaveActionButton,
  SaveFeedbackProvider,
  setMobilePrimaryActionClearance,
  setMobileTabBarHeight,
  setNetworkConnectivityProbe,
  useStatusBar,
  type AnnouncementEntry,
} from './index'

const mocks = vi.hoisted(() => ({
  reducedMotion: true,
}))

vi.mock('@/src/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mocks.reducedMotion,
}))

vi.mock('react-i18next', () => {
  const dict: Record<string, string> = {
    'feedback.save': 'Save',
    'feedback.saving': 'Saving',
    'feedback.stillSaving': 'Still saving',
    'feedback.saved': 'Saved',
    'feedback.failed': 'Failed',
    'feedback.retry': 'Retry',
    'feedback.undo': 'Undo',
    'feedback.view': 'View',
    'feedback.dismiss': 'Dismiss',
    'feedback.savedToLooks': 'Saved to your looks.',
    'feedback.saveFailed': 'Could not save. Try again.',
    'feedback.offlineBanner': 'You are offline',
    'feedback.offlineAction': 'You are offline. Save when you reconnect.',
    'feedback.removed': 'Removed',
    'feedback.undone': 'Change undone.',
    'feedback.lookUpdated': 'Look updated.',
    'feedback.pieceSwapped': 'Piece swapped.',
    'feedback.close': 'Close',
  }
  return {
    useTranslation: () => ({
      t: (key: string) => dict[key] ?? key,
      i18n: { language: 'en-US' },
    }),
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const originalOS = Platform.OS
const originalOnLineDescriptor = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(navigator),
  'onLine'
)

function setPlatformOS(os: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os })
}

function ActionClampHarness() {
  const { showNotice } = useStatusBar()
  return (
    <Text
      testID="trigger-3-actions"
      onPress={() =>
        showNotice({
          id: 'clamp-test',
          message: 'Saved to your looks.',
          tone: 'success',
          actions: [
            { id: 'view', kind: 'view', label: 'View', onPress: () => undefined },
            { id: 'undo', kind: 'undo', label: 'Undo', onPress: () => undefined },
            { id: 'retry', kind: 'retry', label: 'Retry', onPress: () => undefined },
          ],
        })
      }
    >
      Trigger
    </Text>
  )
}

function RepeatShuffleHarness() {
  const { showNotice } = useStatusBar()
  const seqRef = useRef(0)
  return (
    <Text
      testID="trigger-shuffle"
      onPress={() => {
        seqRef.current += 1
        showNotice({
          id: `shuffle-${seqRef.current}`,
          announcementId: `shuffle:${seqRef.current}`,
          message: 'Look updated.',
          tone: 'neutral',
        })
      }}
    >
      Shuffle
    </Text>
  )
}

beforeEach(() => {
  mocks.reducedMotion = true
  setPlatformOS(originalOS)
  resetNetworkStatusForTests(true)
  resetMobileTabBarHeightForTests()
  resetMobilePrimaryActionClearanceForTests()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  setPlatformOS(originalOS)
  if (originalOnLineDescriptor) {
    Object.defineProperty(navigator, 'onLine', originalOnLineDescriptor)
  } else {
    Reflect.deleteProperty(navigator, 'onLine')
  }
  resetNetworkStatusForTests(true)
  resetMobileTabBarHeightForTests()
  resetMobilePrimaryActionClearanceForTests()
})

describe('mobile save-feedback components', () => {
  it('fast commit: transitions idle -> saving -> saved immediately announcing both states once, shows 5s bar above tab bar', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const announcements: AnnouncementEntry[] = []
    const pending = deferred<boolean>()
    const onView = vi.fn()
    const onUndo = vi.fn(() => true)

    await render(
      <SaveFeedbackProvider onAnnounce={(entry) => announcements.push(entry)}>
        <SaveActionButton
          testID="save-btn"
          onSave={() => pending.promise}
          onView={onView}
          onUndo={onUndo}
        />
      </SaveFeedbackProvider>
    )

    const button = screen.getByTestId('save-btn')
    expect(button).toHaveTextContent('Save')

    fireEvent.click(button)
    expect(button).toHaveTextContent('Saving')
    expect(screen.queryByTestId('save-action-check-icon')).toBeNull()
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
    // Immediate announcement without 80ms debounce dropping Saving on fast commits
    expect(announcements.map((a) => a.message)).toEqual(['Saving'])

    await act(async () => {
      vi.advanceTimersByTime(30)
      pending.resolve(true)
      await pending.promise
    })

    expect(button).toHaveTextContent('Saved')
    expect(screen.getByTestId('save-action-check-icon')).toBeVisible()

    const bar = screen.getByTestId('status-feedback-bar')
    expect(bar).toHaveTextContent('Saved to your looks.')
    const barButtons = within(bar).getAllByRole('button')
    expect(barButtons.map((b) => b.textContent)).toEqual(['View', 'Undo'])
    expect(announcements.map((a) => a.message)).toEqual([
      'Saving',
      'Saved to your looks.',
    ])

    // Floating host clears the bottom tab bar
    const host = screen.getByTestId('status-feedback-bar-host')
    expect(host.style.bottom).toBe(`${MOBILE_TAB_BAR_CLEARANCE}px`)

    act(() => {
      vi.advanceTimersByTime(SAVE_FEEDBACK_TIMINGS.statusBarDurationMs - 1)
    })
    expect(screen.getByTestId('status-feedback-bar')).toBeVisible()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
  })

  it('announces consecutive identical shuffle messages once each without suppression and dispatches native AccessibilityInfo on iOS', async () => {
    setPlatformOS('ios')
    const originalWithOptions = Object.getOwnPropertyDescriptor(
      AccessibilityInfo,
      'announceForAccessibilityWithOptions'
    )
    const announceOptionsSpy = vi.fn()
    Object.defineProperty(AccessibilityInfo, 'announceForAccessibilityWithOptions', {
      configurable: true,
      writable: true,
      value: announceOptionsSpy,
    })
    const announcements: AnnouncementEntry[] = []

    try {
      await render(
        <SaveFeedbackProvider onAnnounce={(entry) => announcements.push(entry)}>
          <RepeatShuffleHarness />
        </SaveFeedbackProvider>
      )

      fireEvent.click(screen.getByTestId('trigger-shuffle'))
      fireEvent.click(screen.getByTestId('trigger-shuffle'))

      expect(announcements.map((a) => a.message)).toEqual([
        'Look updated.',
        'Look updated.',
      ])
      expect(announceOptionsSpy).toHaveBeenCalledTimes(2)
      expect(announceOptionsSpy).toHaveBeenNthCalledWith(1, 'Look updated.', {
        queue: true,
      })
      expect(announceOptionsSpy).toHaveBeenNthCalledWith(2, 'Look updated.', {
        queue: true,
      })
    } finally {
      if (originalWithOptions) {
        Object.defineProperty(
          AccessibilityInfo,
          'announceForAccessibilityWithOptions',
          originalWithOptions
        )
      } else {
        Reflect.deleteProperty(AccessibilityInfo, 'announceForAccessibilityWithOptions')
      }
    }
  })

  it('slow commit: transitions saving -> still-saving at 1,000 ms then -> saved and announces each once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const announcements: AnnouncementEntry[] = []
    const pending = deferred<boolean>()

    await render(
      <SaveFeedbackProvider onAnnounce={(entry) => announcements.push(entry)}>
        <SaveActionButton testID="save-btn" onSave={() => pending.promise} />
      </SaveFeedbackProvider>
    )

    fireEvent.click(screen.getByTestId('save-btn'))
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saving')

    act(() => {
      vi.advanceTimersByTime(SAVE_FEEDBACK_TIMINGS.stillSavingAfterMs)
    })
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Still saving')
    expect(announcements.map((a) => a.message)).toEqual(['Saving', 'Still saving'])

    await act(async () => {
      pending.resolve(true)
      await pending.promise
    })

    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saved')
    expect(announcements.map((a) => a.message)).toEqual([
      'Saving',
      'Still saving',
      'Saved to your looks.',
    ])
  })

  it('failed save & retry: keeps content intact, shows Failed + Retry bar, and retries cleanly', async () => {
    const onSave = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('Request failed'))
      .mockResolvedValueOnce(true)

    await render(
      <SaveFeedbackProvider>
        <View testID="look-card">
          <Text>Office oxford</Text>
        </View>
        <SaveActionButton testID="save-btn" onSave={onSave} />
      </SaveFeedbackProvider>
    )

    fireEvent.click(screen.getByTestId('save-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('save-btn')).toHaveTextContent('Failed')
    )
    expect(screen.getByTestId('look-card')).toHaveTextContent('Office oxford')
    expect(screen.getByTestId('save-action-failed-icon')).toBeVisible()
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'Could not save. Try again.'
    )

    fireEvent.click(screen.getByTestId('status-bar-action-retry'))
    await waitFor(() => expect(screen.getByTestId('save-btn')).toHaveTextContent('Saved'))
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('offline line lifecycle & network guard: positions under top bar, blocks save while offline, recovers on reconnect', async () => {
    const onSave = vi.fn(() => Promise.resolve(true))

    await render(
      <SaveFeedbackProvider headerOffset={48}>
        <View testID="look-card">
          <Text>Silk midi</Text>
        </View>
        <SaveActionButton testID="save-btn" requiresNetwork onSave={onSave} />
      </SaveFeedbackProvider>
    )

    expect(screen.queryByTestId('offline-status-line')).toBeNull()

    act(() => reportNetworkOffline())
    const lines = screen.getAllByTestId('offline-status-line')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveTextContent('You are offline')
    expect(lines[0]!.style.top).toBe('48px')

    fireEvent.click(screen.getByTestId('save-btn'))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('look-card')).toHaveTextContent('Silk midi')
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'You are offline. Save when you reconnect.'
    )

    act(() => reportNetworkOnline())
    expect(screen.queryByTestId('offline-status-line')).toBeNull()

    fireEvent.click(screen.getByTestId('save-btn'))
    await waitFor(() => expect(screen.getByTestId('save-btn')).toHaveTextContent('Saved'))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('recovers from native offline state without deadlocking via connectivity probe on AppState active and explicit retry', async () => {
    setPlatformOS('ios')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: undefined })

    let appStateListener: ((state: string) => void) | undefined
    vi.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListener = listener as (state: string) => void
      return { remove: vi.fn() }
    })

    let reachable = false
    const probe = vi.fn(() => Promise.resolve(reachable))
    setNetworkConnectivityProbe(probe)

    const onSave = vi.fn(() => Promise.resolve(true))

    await render(
      <SaveFeedbackProvider>
        <SaveActionButton testID="save-btn" requiresNetwork onSave={onSave} />
      </SaveFeedbackProvider>
    )

    // Go offline after a network error
    act(() => reportNetworkOffline())
    expect(screen.getByTestId('offline-status-line')).toBeVisible()

    // Explicit tap while probe reports unreachable stays offline without calling onSave
    fireEvent.click(screen.getByTestId('save-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    expect(onSave).not.toHaveBeenCalled()

    // Connectivity returns and app resumes foreground -> offline line clears automatically
    reachable = true
    act(() => appStateListener?.('active'))
    await waitFor(() => expect(screen.queryByTestId('offline-status-line')).toBeNull())

    // Subsequent save succeeds
    fireEvent.click(screen.getByTestId('save-btn'))
    await waitFor(() => expect(screen.getByTestId('save-btn')).toHaveTextContent('Saved'))
    expect(onSave).toHaveBeenCalledTimes(1)

    // If offline again and connectivity returns before AppState fires, explicit tap recovers
    act(() => reportNetworkOffline())
    expect(screen.getByTestId('offline-status-line')).toBeVisible()
    fireEvent.click(screen.getByTestId('save-btn'))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('offline-status-line')).toBeNull()
  })

  it('scales status bar clearance dynamically with tab bar height growth and primary action clearance', async () => {
    await render(
      <SaveFeedbackProvider>
        <SaveActionButton testID="save-btn" onSave={() => true} />
      </SaveFeedbackProvider>
    )

    fireEvent.click(screen.getByTestId('save-btn'))
    const host = await screen.findByTestId('status-feedback-bar-host')
    expect(host.style.bottom).toBe(
      `${DEFAULT_MOBILE_TAB_BAR_HEIGHT + MOBILE_STATUS_BAR_GAP}px`
    )

    // Simulate Dynamic Type growing the tab bar by +24pt
    act(() => setMobileTabBarHeight(DEFAULT_MOBILE_TAB_BAR_HEIGHT + 24))
    expect(host.style.bottom).toBe(
      `${DEFAULT_MOBILE_TAB_BAR_HEIGHT + 24 + MOBILE_STATUS_BAR_GAP}px`
    )

    // Simulate a primary action obstacle above the tab bar (+52pt)
    act(() => setMobilePrimaryActionClearance(52))
    expect(host.style.bottom).toBe(
      `${DEFAULT_MOBILE_TAB_BAR_HEIGHT + 24 + MOBILE_STATUS_BAR_GAP + 52}px`
    )
  })

  it('undo save, action clamping, notice dismissal on owner switch/unmount, and stale run guard', async () => {
    const onUndo = vi.fn(() => Promise.resolve(true))
    const first = deferred<boolean>()
    const onSave = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockReturnValueOnce(first.promise)

    const view = await render(
      <SaveFeedbackProvider>
        <SaveActionButton
          testID="save-btn"
          ownerKey="member-1"
          onSave={onSave}
          onUndo={onUndo}
        />
        <ActionClampHarness />
      </SaveFeedbackProvider>
    )

    // Save -> Undo
    fireEvent.click(screen.getByTestId('save-btn'))
    await waitFor(() => expect(screen.getByTestId('save-btn')).toHaveTextContent('Saved'))
    fireEvent.click(screen.getByTestId('status-bar-action-undo'))
    await waitFor(() => expect(screen.getByTestId('save-btn')).toHaveTextContent('Save'))
    expect(onUndo).toHaveBeenCalledTimes(1)

    // Action clamping (3 passed -> 2 rendered)
    fireEvent.click(screen.getByTestId('trigger-3-actions'))
    const bar = screen.getByTestId('status-feedback-bar')
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['View', 'Undo'])

    // Stale run after owner switch is ignored and notice dismissed
    fireEvent.click(screen.getByTestId('save-btn'))
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Saving')

    await view.rerender(
      <SaveFeedbackProvider>
        <SaveActionButton
          testID="save-btn"
          ownerKey="member-2"
          onSave={onSave}
          onUndo={onUndo}
        />
        <ActionClampHarness />
      </SaveFeedbackProvider>
    )
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Save')

    await act(async () => {
      first.resolve(true)
      await first.promise
    })
    expect(screen.getByTestId('save-btn')).toHaveTextContent('Save')

    // Unmounting SaveActionButton dismisses its active provider notice
    await view.rerender(
      <SaveFeedbackProvider>
        <SaveActionButton testID="save-btn" ownerKey="member-2" onSave={() => true} />
      </SaveFeedbackProvider>
    )
    fireEvent.click(screen.getByTestId('save-btn'))
    await screen.findByTestId('status-feedback-bar')
    await view.rerender(
      <SaveFeedbackProvider>
        <Text>Gone</Text>
      </SaveFeedbackProvider>
    )
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
  })

  it('respects reduced motion when displaying the status bar', async () => {
    mocks.reducedMotion = true
    await render(
      <SaveFeedbackProvider>
        <SaveActionButton testID="save-btn" onSave={() => true} />
      </SaveFeedbackProvider>
    )

    fireEvent.click(screen.getByTestId('save-btn'))
    const bar = await screen.findByTestId('status-feedback-bar')
    expect(bar.style.opacity).toBe('1')
  })
})

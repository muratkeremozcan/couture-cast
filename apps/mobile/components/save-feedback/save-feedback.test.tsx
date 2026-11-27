// Learning path Step 59: Shared save, undo and status feedback.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-59-shared-save-undo-and-status-feedback
// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-NAT-023 (D7) for Style this piece, whose save
// confirmation's View closes the panel and opens the saved look's own screen.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import { useRef } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessibilityInfo, AppState, Platform, Text, View } from 'react-native'
import { router } from 'expo-router'
import { createReadyGarmentFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import { SAVE_FEEDBACK_TIMINGS } from '@couture/utils'
import { mobileIdentityEpoch, setMobileApplicationUserId } from '@/src/lib/mobile-auth'
import { StylePiecePanel } from '@/src/features/wardrobe/style-piece-panel'
import {
  checkNetworkOnlineForAction,
  DEFAULT_MOBILE_TAB_BAR_HEIGHT,
  dispatchMobileAnnouncement,
  getMobileTabBarHeight,
  getNetworkOnline,
  MOBILE_STATUS_BAR_GAP,
  MOBILE_TAB_BAR_CLEARANCE,
  probeNetworkConnectivity,
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
  useSaveAction,
  useStatusBar,
  type AnnouncementEntry,
} from './index'

const mocks = vi.hoisted(() => ({
  reducedMotion: true,
  listSavedLooksFromMobile: vi.fn(),
  createSavedLookFromMobile: vi.fn(),
  deleteSavedLookFromMobile: vi.fn(),
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
  listSavedLooksFromMobile: mocks.listSavedLooksFromMobile,
  createSavedLookFromMobile: mocks.createSavedLookFromMobile,
  getSavedLookFromMobile: vi.fn().mockResolvedValue(null),
  deleteSavedLookFromMobile: mocks.deleteSavedLookFromMobile,
  restoreSavedLookFromMobile: vi.fn().mockRejectedValue(new Error('503')),
  notifyMobileSavedLooksChanged: vi.fn(),
  subscribeMobileSavedLooksChanged: vi.fn(() => vi.fn()),
  ensureMobileLegacySavedLooksMigration: vi.fn().mockReturnValue(null),
  formatSavedLookIfMatch: (id: string, revision: number) =>
    `"saved-look:${id}:${revision}"`,
}))

vi.mock('expo-router', () => ({
  router: { navigate: vi.fn(), push: vi.fn(), replace: vi.fn() },
}))

vi.mock('@/src/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mocks.reducedMotion,
}))

vi.mock('@/src/lib/accessibility-focus', () => ({
  safeFindNodeHandle: () => null,
}))

const mockRecipeStore = new Map<string, string>()
vi.mock('@/src/lib/sample-recipe-storage', () => ({
  sampleRecipeStorage: (key: string) =>
    Promise.resolve({
      read: () => mockRecipeStore.get(key) ?? null,
      write: (value: string) => {
        mockRecipeStore.set(key, value)
      },
    }),
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

  // Story CC-7.10 test owner (TEA): a pending save must read disabled to assistive tech and take
  // no taps. React Native Web's Pressable writes aria-disabled from its own disabled prop over the
  // one the button passes, so before busy reached that prop a pending save showed no
  // aria-disabled at all. The second press pins that a tap on the pending button starts no
  // second save, and the settled check pins that busy alone drives the disabled state.
  it('[P1] [7.10-NAT-024] reports a pending save as disabled and ignores a press until it settles', async () => {
    const pending = deferred<boolean>()
    const onSave = vi.fn(() => pending.promise)

    await render(
      <SaveFeedbackProvider>
        <SaveActionButton testID="save-btn" onSave={onSave} />
      </SaveFeedbackProvider>
    )

    const button = screen.getByTestId('save-btn')
    expect(button).not.toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(button)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(button).toHaveTextContent('Saving')
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(button)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(button).toHaveTextContent('Saving')

    await act(async () => {
      pending.resolve(true)
      await pending.promise
    })
    expect(button).toHaveTextContent('Saved')
    expect(button).not.toHaveAttribute('aria-disabled', 'true')
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

    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      reportNetworkOffline()
    })
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

    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      reportNetworkOnline()
    })
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

  it('uses EXPO_PUBLIC_API_BASE_URL for default native probe, shares in-flight probe, and recovers on HTTP response', async () => {
    setPlatformOS('ios')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: undefined })
    const prevBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.couturecast.test/'

    const probeCall = deferred<Response>()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockReturnValueOnce(probeCall.promise)

    try {
      reportNetworkOffline()
      expect(getNetworkOnline()).toBe(false)

      // Transport error keeps offline
      const firstResult = await probeNetworkConnectivity()
      expect(firstResult).toBe(false)
      expect(getNetworkOnline()).toBe(false)
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.couturecast.test/api/health',
        expect.objectContaining({ method: 'HEAD' })
      )

      // Two concurrent calls share one in-flight probe; HTTP 503 proves connectivity (online)
      const p1 = probeNetworkConnectivity()
      const p2 = probeNetworkConnectivity()
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      probeCall.resolve(new Response(null, { status: 503 }))
      expect(await Promise.all([p1, p2])).toEqual([true, true])
      expect(getNetworkOnline()).toBe(true)
    } finally {
      if (prevBaseUrl === undefined) {
        delete process.env.EXPO_PUBLIC_API_BASE_URL
      } else {
        process.env.EXPO_PUBLIC_API_BASE_URL = prevBaseUrl
      }
    }
  })

  it('real mobile StylePiecePanel transport loss keeps look visible, flips offline, renders modal offline banner, and recovers on reconnect', async () => {
    setPlatformOS('ios')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: undefined })
    const prevBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.couturecast.test'
    setMobileApplicationUserId('mobile-style-owner')

    const garment = createReadyGarmentFixture({
      id: 'mobile-style-garment',
      imageAccess: {
        url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
        expiresAt: '2090-01-01T00:00:00.000Z',
      },
    })
    const loadInventory = vi
      .fn<() => Promise<(typeof garment)[]>>()
      .mockResolvedValueOnce([garment]) // initial mount
      .mockRejectedValueOnce(new TypeError('Network request failed')) // transport drop on Save
      .mockResolvedValueOnce([garment]) // recovery Save succeeds

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    mocks.listSavedLooksFromMobile.mockResolvedValue([])
    mocks.createSavedLookFromMobile.mockResolvedValue({
      id: 'sl-mob-1',
      ownerUserId: 'mobile-style-owner',
      source: 'style_piece',
      lookId: 'sample:l:soft-pleats',
      weather: 'mild-dry',
      title: null,
      anchorGarmentId: garment.id,
      anchorSnapshot: { garmentId: garment.id, category: 'top', comfortRange: 'mild' },
      composition: [
        {
          slotIndex: 0,
          category: 'top',
          kind: 'garment',
          itemId: garment.id,
          label: null,
          missing: false,
          imageAccess: null,
        },
      ],
      swaps: {},
      collection: null,
      comfort: null,
      availabilityStatus: 'ready',
      missingGarmentIds: [],
      needsReviewReasons: [],
      revision: 0,
      createdAt: '2026-11-22T00:00:00.000Z',
      updatedAt: '2026-11-22T00:00:00.000Z',
    })

    try {
      await render(
        <SaveFeedbackProvider>
          <StylePiecePanel
            selection={{
              id: garment.id,
              category: garment.category ?? 'top',
              comfortRange: garment.comfortRange ?? 'mild',
            }}
            inWardrobe
            loadInventory={loadInventory}
            visible
            owner="mobile-style-owner"
            epoch={mobileIdentityEpoch()}
            locale="en-US"
            onClose={vi.fn()}
            onDismiss={vi.fn()}
          />
        </SaveFeedbackProvider>
      )

      const panel = await screen.findByTestId('style-piece-panel')
      const saveButtons = await within(panel).findAllByTestId('style-piece-save')
      const firstSave = saveButtons[0]!
      await waitFor(() => expect(firstSave).not.toBeDisabled())

      // Transport failure during Save keeps look visible, enters offline, shows modal offline line
      fireEvent.click(firstSave)
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'You are offline. Save when you reconnect.'
        )
      )
      expect(within(panel).getAllByTestId('style-piece-look').length).toBeGreaterThan(0)
      expect(within(panel).getByTestId('offline-status-line')).toHaveTextContent(
        'You are offline'
      )
      expect(getNetworkOnline()).toBe(false)

      // Tapping Save again runs default EXPO_PUBLIC_API_BASE_URL probe -> recovers online -> saves!
      // A real click: react-native-web reconfigures Pressable's responder in a passive effect, so a
      // synchronous click in the commit's own task still meets the busy (disabled) responder. A
      // member's tap cannot land that fast.
      await userEvent.click(firstSave)
      await waitFor(() => expect(firstSave).toHaveTextContent('Saved'))
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.couturecast.test/api/health',
        expect.objectContaining({ method: 'HEAD' })
      )
      expect(getNetworkOnline()).toBe(true)
      expect(within(panel).queryByTestId('offline-status-line')).toBeNull()
    } finally {
      setMobileApplicationUserId(null)
      if (prevBaseUrl === undefined) {
        delete process.env.EXPO_PUBLIC_API_BASE_URL
      } else {
        process.env.EXPO_PUBLIC_API_BASE_URL = prevBaseUrl
      }
    }
  })

  it('[P1] [7.12-NAT-023] Style this piece View closes the panel, then opens the saved look screen', async () => {
    setMobileApplicationUserId('mobile-style-view-owner')
    const garment = createReadyGarmentFixture({
      id: 'mobile-style-view-garment',
      imageAccess: {
        url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
        expiresAt: '2090-01-01T00:00:00.000Z',
      },
    })
    mocks.listSavedLooksFromMobile.mockResolvedValue([])
    mocks.createSavedLookFromMobile.mockResolvedValue({
      id: 'sl-mob-view-1',
      ownerUserId: 'mobile-style-view-owner',
      source: 'style_piece',
      lookId: 'sample:l:soft-pleats',
      weather: 'mild-dry',
      title: null,
      anchorGarmentId: garment.id,
      anchorSnapshot: { garmentId: garment.id, category: 'top', comfortRange: 'mild' },
      composition: [
        {
          slotIndex: 0,
          category: 'top',
          kind: 'garment',
          itemId: garment.id,
          label: null,
          missing: false,
          imageAccess: null,
        },
      ],
      swaps: {},
      collection: null,
      comfort: null,
      availabilityStatus: 'ready',
      missingGarmentIds: [],
      needsReviewReasons: [],
      revision: 0,
      createdAt: '2026-11-22T00:00:00.000Z',
      updatedAt: '2026-11-22T00:00:00.000Z',
    })
    const onClose = vi.fn()
    try {
      await render(
        <SaveFeedbackProvider>
          <StylePiecePanel
            selection={{
              id: garment.id,
              category: garment.category ?? 'top',
              comfortRange: garment.comfortRange ?? 'mild',
            }}
            inWardrobe
            loadInventory={() => Promise.resolve([garment])}
            visible
            owner="mobile-style-view-owner"
            epoch={mobileIdentityEpoch()}
            locale="en-US"
            onClose={onClose}
            onDismiss={vi.fn()}
          />
        </SaveFeedbackProvider>
      )
      const panel = await screen.findByTestId('style-piece-panel')
      const save = (await within(panel).findAllByTestId('style-piece-save'))[0]!
      await waitFor(() => expect(save).not.toBeDisabled())
      await userEvent.click(save)
      const view = await within(panel).findByTestId('status-bar-action-view')
      expect(view).toHaveTextContent('View')
      expect(vi.mocked(router.push)).not.toHaveBeenCalled()

      fireEvent.click(view)
      // D7: the panel closes first, so the saved look's screen never sits under its layer.
      expect(onClose).toHaveBeenCalledTimes(1)
      await waitFor(() =>
        expect(vi.mocked(router.push).mock.calls).toEqual([
          [
            {
              pathname: '/saved-look/[savedLookId]',
              params: { savedLookId: 'sl-mob-view-1' },
            },
          ],
        ])
      )
    } finally {
      setMobileApplicationUserId(null)
    }
  })

  it('sibling SaveActionButton controls do not collide on announcements or unmount dismissal', async () => {
    const announcements: AnnouncementEntry[] = []

    const view = await render(
      <SaveFeedbackProvider onAnnounce={(entry) => announcements.push(entry)}>
        <SaveActionButton
          key="save-a"
          testID="save-a"
          onSave={() => true}
          onUndo={() => true}
        />
        <SaveActionButton
          key="save-b"
          testID="save-b"
          onSave={() => true}
          onUndo={() => true}
        />
      </SaveFeedbackProvider>
    )

    fireEvent.click(screen.getByTestId('save-a'))
    fireEvent.click(screen.getByTestId('save-b'))

    expect(announcements.map((a) => a.message)).toEqual([
      'Saving',
      'Saved to your looks.',
      'Saving',
      'Saved to your looks.',
    ])

    await view.rerender(
      <SaveFeedbackProvider onAnnounce={(entry) => announcements.push(entry)}>
        {null}
        <SaveActionButton
          key="save-b"
          testID="save-b"
          onSave={() => true}
          onUndo={() => true}
        />
      </SaveFeedbackProvider>
    )
    expect(screen.getByTestId('status-feedback-bar')).toBeVisible()
  })

  it('superseded deferred Save does not cancel a newer Save slow timer, and Retry respects live offline state', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const run1 = deferred<boolean>()
    const run2 = deferred<boolean>()
    const onSave = vi
      .fn<() => Promise<boolean>>()
      .mockReturnValueOnce(run1.promise)
      .mockReturnValueOnce(run2.promise)

    const view = await render(
      <SaveFeedbackProvider>
        <SaveActionButton testID="save-btn" ownerKey="m-1" onSave={onSave} />
      </SaveFeedbackProvider>
    )

    fireEvent.click(screen.getByTestId('save-btn'))
    await view.rerender(
      <SaveFeedbackProvider>
        <SaveActionButton testID="save-btn" ownerKey="m-2" onSave={onSave} />
      </SaveFeedbackProvider>
    )
    fireEvent.click(screen.getByTestId('save-btn'))

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

    // Offline Retry guard
    vi.useRealTimers()
    const onRetrySave = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce(true)
    await view.rerender(
      <SaveFeedbackProvider>
        <SaveActionButton
          testID="save-btn"
          ownerKey="m-3"
          requiresNetwork
          onSave={onRetrySave}
        />
      </SaveFeedbackProvider>
    )
    fireEvent.click(screen.getByTestId('save-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Could not save. Try again.'
      )
    )
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      reportNetworkOffline()
    })
    fireEvent.click(screen.getByTestId('status-bar-action-retry'))
    expect(onRetrySave).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'You are offline. Save when you reconnect.'
    )
  })

  it('covers network-status window events, probe aborts/timeouts/errors, unconfigured native fallback, and offline polling', async () => {
    // Web window offline/online events
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(getNetworkOnline()).toBe(false)
    expect(await checkNetworkOnlineForAction()).toBe(true) // navigator.onLine is true in test browser
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(getNetworkOnline()).toBe(true)
    expect(await checkNetworkOnlineForAction()).toBe(true)

    // probeNetworkConnectivity with already-aborted signal returns false immediately
    const aborted = new AbortController()
    aborted.abort()
    expect(await probeNetworkConnectivity(aborted.signal)).toBe(false)

    // probeNetworkConnectivity on web with no custom probe reads navigator.onLine
    expect(await probeNetworkConnectivity()).toBe(true)

    // Native without EXPO_PUBLIC_API_BASE_URL and without navigator.onLine
    setPlatformOS('ios')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: undefined })
    const prevBase = process.env.EXPO_PUBLIC_API_BASE_URL
    const prevApiBase = process.env.API_BASE_URL
    delete process.env.EXPO_PUBLIC_API_BASE_URL
    delete process.env.API_BASE_URL
    try {
      reportNetworkOffline()
      expect(await probeNetworkConnectivity()).toBe(false)
      // Explicit action check falls through to true when no probe is configured so native never deadlocks
      expect(await checkNetworkOnlineForAction()).toBe(true)

      // Custom probe throwing synchronously/asynchronously returns false cleanly
      setNetworkConnectivityProbe(() => Promise.reject(new Error('probe boom')))
      expect(await probeNetworkConnectivity()).toBe(false)

      // External signal aborting mid-flight and timeout aborting slow probe
      const external = new AbortController()
      const slow = deferred<boolean>()
      setNetworkConnectivityProbe(() => slow.promise)
      const abortedFlight = probeNetworkConnectivity(external.signal)
      external.abort()
      slow.resolve(true)
      expect(await abortedFlight).toBe(false)

      // Timeout abort and offline recovery interval poll
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
      })
      let capturedSignal: AbortSignal | undefined
      const hanging = deferred<boolean>()
      setNetworkConnectivityProbe((signal) => {
        capturedSignal = signal
        return hanging.promise
      })
      const timedOut = probeNetworkConnectivity()
      vi.advanceTimersByTime(4_000)
      expect(capturedSignal?.aborted).toBe(true)
      hanging.resolve(false)
      expect(await timedOut).toBe(false)

      // Offline interval polling while native is offline with a probe
      const pollProbe = vi.fn(() => Promise.resolve(true))
      setNetworkConnectivityProbe(pollProbe)
      const view = await render(
        <SaveFeedbackProvider>
          <Text>Online monitor</Text>
        </SaveFeedbackProvider>
      )
      await act(async () => {
        vi.advanceTimersByTime(10_000)
        await Promise.resolve()
      })
      expect(pollProbe).toHaveBeenCalled()
      expect(getNetworkOnline()).toBe(true)
      await view.unmount()

      // Native AppState 'active' with boolean navigator.onLine syncs navigator.onLine
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      let appStateListener: ((state: string) => void) | undefined
      vi.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
        appStateListener = listener as (state: string) => void
        return { remove: vi.fn() }
      })
      const view2 = await render(
        <SaveFeedbackProvider>
          <Text>AppState bool</Text>
        </SaveFeedbackProvider>
      )
      act(() => appStateListener?.('active'))
      expect(getNetworkOnline()).toBe(false)
      await view2.unmount()
      vi.useRealTimers()
    } finally {
      if (prevBase !== undefined) process.env.EXPO_PUBLIC_API_BASE_URL = prevBase
      if (prevApiBase !== undefined) process.env.API_BASE_URL = prevApiBase
    }
  })

  it('covers mobile context clamping, Android announcements, standalone useStatusBar, nested forwarding, animations, and standalone/undo SaveActionButton paths', async () => {
    // Tab bar & primary clearance clamping + getter
    setMobileTabBarHeight(Number.NaN)
    expect(getMobileTabBarHeight()).toBe(0)
    setMobilePrimaryActionClearance(-10)
    resetMobileTabBarHeightForTests()
    expect(getMobileTabBarHeight()).toBe(DEFAULT_MOBILE_TAB_BAR_HEIGHT)

    // Android AccessibilityInfo.announceForAccessibility fallback
    setPlatformOS('android')
    const announceFallback = vi
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined)
    dispatchMobileAnnouncement('Android notice', 'assertive')
    expect(announceFallback).toHaveBeenCalledWith('Android notice')
    setPlatformOS('web')

    // Standalone useStatusBar fallback
    function StandaloneStatusHarness() {
      const bar = useStatusBar()
      return (
        <Text
          testID="standalone-bar-call"
          onPress={() => {
            bar.showNotice({ id: 'noop', message: 'Noop' })
            bar.dismissNotice('noop')
            bar.announce('Noop', { announcementId: 'noop:1' })
          }}
        >
          {String(bar.hasProvider)}
        </Text>
      )
    }
    const standaloneBarView = await render(<StandaloneStatusHarness />)
    expect(screen.getByTestId('standalone-bar-call')).toHaveTextContent('false')
    fireEvent.click(screen.getByTestId('standalone-bar-call'))
    await standaloneBarView.unmount()

    // Non-reduced motion animation, nested non-inline forwarding, blank/dup/>200 announcements, and async rejecting bar action
    mocks.reducedMotion = false
    const parentAnnouncements: AnnouncementEntry[] = []
    function NestedHarness() {
      const bar = useStatusBar()
      return (
        <Text
          testID="nested-mobile-trigger"
          onPress={() => {
            bar.announce('   ', { announcementId: 'blank:1' })
            bar.announce('Nested msg', { announcementId: 'nested:1' })
            bar.announce('Nested msg', { announcementId: 'nested:1' })
            for (let i = 0; i < 205; i += 1) {
              bar.announce(`Flood ${i}`, { announcementId: `flood:${i}` })
            }
            bar.showNotice({
              id: 'mobile-async-reject',
              message: 'Async action',
              tone: 'neutral',
              actions: [
                {
                  id: 'async-act',
                  kind: 'undo',
                  label: 'Run',
                  onPress: () => Promise.reject(new Error('boom')),
                },
              ],
            })
          }}
        >
          Run
        </Text>
      )
    }
    const nestedView = await render(
      <SaveFeedbackProvider onAnnounce={(entry) => parentAnnouncements.push(entry)}>
        <SaveFeedbackProvider initialOnline={false}>
          <NestedHarness />
        </SaveFeedbackProvider>
      </SaveFeedbackProvider>
    )
    fireEvent.click(screen.getByTestId('nested-mobile-trigger'))
    expect(parentAnnouncements.filter((entry) => entry.id === 'nested:1')).toHaveLength(1)
    expect(parentAnnouncements.some((entry) => entry.id === 'blank:1')).toBe(false)
    fireEvent.click(screen.getByTestId('status-bar-action-undo'))
    await waitFor(() => expect(screen.queryByTestId('status-feedback-bar')).toBeNull())
    await nestedView.unmount()
    mocks.reducedMotion = true

    // Standalone SaveActionButton (auto-dismiss timer, onView, extraActions, showStatusBar=false, sync throw)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const onView = vi.fn()
    const standaloneSaveView = await render(
      <View>
        <SaveActionButton
          testID="standalone-save"
          onSave={() => true}
          onView={onView}
          extraActions={[{ id: 'extra', label: 'Extra', onPress: vi.fn() }]}
        />
        <SaveActionButton
          testID="silent-save"
          showStatusBar={false}
          onSave={() => {
            throw new Error('sync fail')
          }}
        />
        <SaveActionButton testID="disabled-save" disabled onSave={() => true} />
      </View>
    )
    fireEvent.click(screen.getByTestId('disabled-save'))
    expect(screen.getByTestId('disabled-save')).toHaveTextContent('Save')

    fireEvent.click(screen.getByTestId('standalone-save'))
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'Saved to your looks.'
    )
    fireEvent.click(screen.getByTestId('status-bar-action-view'))
    expect(onView).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()

    fireEvent.click(screen.getByTestId('standalone-save'))
    act(() => {
      vi.advanceTimersByTime(SAVE_FEEDBACK_TIMINGS.statusBarDurationMs)
    })
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()

    fireEvent.click(screen.getByTestId('silent-save'))
    expect(screen.getByTestId('silent-save')).toHaveTextContent('Failed')
    await standaloneSaveView.unmount()
    vi.useRealTimers()

    // useSaveAction Undo offline (web + native probe), Undo false, Undo throwing offline & generic error, and reset()
    let controllerRef: ReturnType<typeof useSaveAction> | null = null
    const onSave = vi.fn(() => Promise.resolve(true))
    const onUndo = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new Error('500'))

    function MobileControllerHarness() {
      const controller = useSaveAction({
        onSave,
        onUndo,
        requiresNetwork: true,
        ownerKey: 'o1',
        resetKey: 'r1',
      })
      controllerRef = controller
      return (
        <View>
          <Text testID="m-state">{controller.state}</Text>
          <Text testID="m-save" onPress={() => void controller.triggerSave()}>
            Save
          </Text>
          <Text testID="m-reset" onPress={() => controller.reset('saved')}>
            Reset
          </Text>
        </View>
      )
    }

    await render(
      <SaveFeedbackProvider>
        <MobileControllerHarness />
      </SaveFeedbackProvider>
    )

    // 1. Web offline blocks Undo when navigator.onLine is false
    fireEvent.click(screen.getByTestId('m-save'))
    await waitFor(() => expect(screen.getByTestId('m-state')).toHaveTextContent('saved'))
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      reportNetworkOffline()
    })
    fireEvent.click(screen.getByTestId('status-bar-action-undo'))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )

    // 2. Native offline Undo runs probe -> unreachable keeps offline, reachable proceeds
    setPlatformOS('ios')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: undefined })
    setNetworkConnectivityProbe(() => Promise.resolve(false))
    await act(async () => {
      expect(await controllerRef!.triggerUndo()).toBe(false)
    })
    setNetworkConnectivityProbe(() => Promise.resolve(true))
    // onUndo #1 returns false -> failed notice
    await act(async () => {
      expect(await controllerRef!.triggerUndo()).toBe(false)
    })
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Could not save. Try again.'
      )
    )

    // 3. onUndo #2 throws offline error -> reports offline
    await act(async () => {
      expect(await controllerRef!.triggerUndo()).toBe(false)
    })
    expect(getNetworkOnline()).toBe(false)
    act(() => reportNetworkOnline())

    // 4. onUndo #3 throws generic error -> failed notice
    await act(async () => {
      expect(await controllerRef!.triggerUndo()).toBe(false)
    })
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Could not save. Try again.'
      )
    )

    // reset() and mismatched origin guards
    fireEvent.click(screen.getByTestId('m-reset'))
    expect(screen.getByTestId('m-state')).toHaveTextContent('saved')
    expect(await controllerRef!.triggerSave({ ownerKey: 'wrong', resetKey: 'r1' })).toBe(
      false
    )
    expect(await controllerRef!.triggerUndo({ ownerKey: 'wrong', resetKey: 'r1' })).toBe(
      false
    )

    // Busy double-tap returns false and triggerSave/triggerUndo after unmount return false
    const pendingSave = deferred<boolean>()
    let busyCtrl: ReturnType<typeof useSaveAction> | null = null
    function MobileBusyHarness() {
      const controller = useSaveAction({
        onSave: () => pendingSave.promise,
        onView,
        ownerKey: 'mb1',
        resetKey: 'r1',
      })
      busyCtrl = controller
      return <Text testID="mb-state">{controller.state}</Text>
    }
    const busyView = await render(<MobileBusyHarness />)
    let firstRun!: Promise<boolean>
    act(() => {
      firstRun = busyCtrl!.triggerSave()
    })
    expect(await busyCtrl!.triggerSave()).toBe(false)
    pendingSave.resolve(true)
    await act(async () => {
      await firstRun
    })
    await busyView.unmount()
    expect(await busyCtrl!.triggerSave()).toBe(false)
    expect(await busyCtrl!.triggerUndo()).toBe(false)
  })

  it('keeps shared probe alive when one waiter cancels, prevents double-save during native probe, guards stale Undo after probe/runId change, allows Expo web recovery, and re-enables StylePiecePanel storage on Retry', async () => {
    // 1. Shared probe waiter isolation: cancelling caller A does NOT abort caller B
    setPlatformOS('ios')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: undefined })
    const sharedDeferred = deferred<boolean>()
    let underlyingSignal: AbortSignal | undefined
    setNetworkConnectivityProbe((signal) => {
      underlyingSignal = signal
      return sharedDeferred.promise
    })
    reportNetworkOffline()

    const callerA = new AbortController()
    const callerB = new AbortController()
    const waitA = probeNetworkConnectivity(callerA.signal)
    const waitB = probeNetworkConnectivity(callerB.signal)
    callerA.abort()
    expect(await waitA).toBe(false)
    expect(underlyingSignal?.aborted).toBe(false)
    sharedDeferred.resolve(true)
    expect(await waitB).toBe(true)
    expect(getNetworkOnline()).toBe(true)

    // 2. Rapid double-tap during a pending native probe invokes onSave only once
    reportNetworkOffline()
    const saveProbe = deferred<boolean>()
    setNetworkConnectivityProbe(() => saveProbe.promise)
    const doubleTapSave = vi.fn(() => Promise.resolve(true))
    const doubleTapView = await render(
      <SaveFeedbackProvider>
        <SaveActionButton
          testID="double-tap-save"
          requiresNetwork
          onSave={doubleTapSave}
        />
      </SaveFeedbackProvider>
    )
    fireEvent.click(screen.getByTestId('double-tap-save'))
    fireEvent.click(screen.getByTestId('double-tap-save'))
    await act(async () => {
      saveProbe.resolve(true)
      await saveProbe.promise
    })
    await waitFor(() =>
      expect(screen.getByTestId('double-tap-save')).toHaveTextContent('Saved')
    )
    expect(doubleTapSave).toHaveBeenCalledTimes(1)
    await doubleTapView.unmount()

    // 3. Stale Undo after owner switch during pending native probe does NOT invoke undoHandler or post offline notice
    //    AND starting a new Save dismisses prior notice & stale expectedRunId cannot orphan active Save
    const undoProbe = deferred<boolean>()
    setNetworkConnectivityProbe(() => undoProbe.promise)
    const undoSpy = vi.fn(() => Promise.resolve(true))
    const pendingSecondSave = deferred<boolean>()
    const saveSpy = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockReturnValueOnce(pendingSecondSave.promise)
    let ctrlRef: ReturnType<typeof useSaveAction> | null = null

    function GuardHarness({ owner }: { owner: string }) {
      const controller = useSaveAction({
        onSave: saveSpy,
        onUndo: undoSpy,
        requiresNetwork: true,
        ownerKey: owner,
        resetKey: 'r1',
      })
      ctrlRef = controller
      return <Text testID="guard-state">{controller.state}</Text>
    }

    const guardView = await render(
      <SaveFeedbackProvider>
        <GuardHarness owner="owner-a" />
      </SaveFeedbackProvider>
    )
    await act(async () => {
      expect(await ctrlRef!.triggerSave()).toBe(true)
    })
    expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
      'Saved to your looks.'
    )

    // Starting a new Save dismisses the prior success notice and blocks Undo while busy or with stale expectedRunId
    let activeSave!: Promise<boolean>
    act(() => {
      activeSave = ctrlRef!.triggerSave()
    })
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
    expect(
      await ctrlRef!.triggerUndo({
        ownerKey: 'owner-a',
        resetKey: 'r1',
        expectedRunId: 1,
      })
    ).toBe(false)
    expect(undoSpy).not.toHaveBeenCalled()
    await act(async () => {
      pendingSecondSave.resolve(true)
      expect(await activeSave).toBe(true)
    })
    // Stale expectedRunId (from save #1) rejected even when idle/saved
    expect(
      await ctrlRef!.triggerUndo({
        ownerKey: 'owner-a',
        resetKey: 'r1',
        expectedRunId: 1,
      })
    ).toBe(false)

    // Now go offline, start native Undo probe, switch owner before probe resolves -> no undo call, no offline notice
    act(() => reportNetworkOffline())
    let pendingUndo!: Promise<boolean>
    act(() => {
      pendingUndo = ctrlRef!.triggerUndo()
    })
    await guardView.rerender(
      <SaveFeedbackProvider>
        <GuardHarness owner="owner-b" />
      </SaveFeedbackProvider>
    )
    await act(async () => {
      undoProbe.resolve(false)
      expect(await pendingUndo).toBe(false)
    })
    expect(undoSpy).not.toHaveBeenCalled()
    expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
    await guardView.unmount()

    // 4. Expo web transport failure while navigator.onLine === true does NOT permanently block retry
    setPlatformOS('web')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    resetNetworkStatusForTests(true)
    const webRecoverSave = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(true)
    const webView = await render(
      <SaveFeedbackProvider>
        <SaveActionButton
          testID="expo-web-save"
          requiresNetwork
          onSave={webRecoverSave}
        />
      </SaveFeedbackProvider>
    )
    fireEvent.click(screen.getByTestId('expo-web-save'))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    expect(getNetworkOnline()).toBe(false)
    // Browser still reports navigator.onLine === true, so explicit retry runs and recovers online!
    // A real click: react-native-web reconfigures Pressable's responder in a passive effect, so a
    // synchronous click in the commit's own task still meets the busy (disabled) responder. A
    // member's tap cannot land that fast.
    await userEvent.click(screen.getByTestId('expo-web-save'))
    await waitFor(() =>
      expect(screen.getByTestId('expo-web-save')).toHaveTextContent('Saved')
    )
    expect(webRecoverSave).toHaveBeenCalledTimes(2)
    expect(getNetworkOnline()).toBe(true)
    await webView.unmount()

    // 5. Mobile StylePiecePanel retries API save failure with the same Idempotency-Key
    setMobileApplicationUserId('mobile-storage-retry-owner')
    const garment = createReadyGarmentFixture({
      id: 'mobile-storage-garment',
      imageAccess: {
        url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
        expiresAt: '2090-01-01T00:00:00.000Z',
      },
    })
    mocks.listSavedLooksFromMobile.mockResolvedValue([])
    mocks.createSavedLookFromMobile
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockImplementationOnce(
        (input: {
          source: 'style_piece' | 'home_sample'
          lookId: string
          weather: string
          title?: string | null
          anchorGarmentId?: string | null
          anchorSnapshot?: {
            garmentId: string
            category: 'top' | 'bottom' | 'shoes' | 'outerwear' | 'dress' | 'accessory'
            comfortRange: 'cool' | 'mild' | 'warm'
          } | null
          composition: {
            slotIndex: number
            category: 'top' | 'bottom' | 'shoes' | 'outerwear' | 'dress' | 'accessory'
            kind: 'garment' | 'catalog'
            itemId: string
            label?: string | null
          }[]
          swaps?: Record<string, string>
          collection?: string | null
          comfort?: string | null
        }) =>
          Promise.resolve({
            id: 'sl-mob-retry-1',
            ownerUserId: 'mobile-storage-retry-owner',
            source: input.source,
            lookId: input.lookId,
            weather: input.weather,
            title: input.title ?? null,
            anchorGarmentId: input.anchorGarmentId ?? null,
            anchorSnapshot: input.anchorSnapshot ?? null,
            composition: input.composition.map((slot) => ({
              ...slot,
              label: slot.label ?? null,
              missing: false,
              imageAccess: null,
            })),
            swaps: input.swaps ?? {},
            collection: input.collection ?? null,
            comfort: input.comfort ?? null,
            availabilityStatus: 'ready',
            missingGarmentIds: [],
            needsReviewReasons: [],
            revision: 0,
            createdAt: '2026-11-22T00:00:00.000Z',
            updatedAt: '2026-11-22T00:00:00.000Z',
          })
      )
    try {
      const panelView = await render(
        <SaveFeedbackProvider>
          <StylePiecePanel
            selection={{
              id: garment.id,
              category: garment.category ?? 'top',
              comfortRange: garment.comfortRange ?? 'mild',
            }}
            inWardrobe
            loadInventory={() => Promise.resolve([garment])}
            visible
            owner="mobile-storage-retry-owner"
            epoch={mobileIdentityEpoch()}
            locale="en-US"
            onClose={vi.fn()}
            onDismiss={vi.fn()}
          />
        </SaveFeedbackProvider>
      )
      const panel = await screen.findByTestId('style-piece-panel')
      const saveBtn = (await within(panel).findAllByTestId('style-piece-save'))[0]!
      await waitFor(() => expect(saveBtn).not.toBeDisabled())

      // First save fails API write -> shows Failed state on button + Retry bar
      fireEvent.click(saveBtn)
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'Could not save. Try again.'
        )
      )
      expect(saveBtn).toHaveTextContent('Failed')
      expect(within(panel).getByTestId('status-bar-action-retry')).toBeInTheDocument()

      // Clicking Retry succeeds and reuses the exact same Idempotency-Key
      fireEvent.click(within(panel).getByTestId('status-bar-action-retry'))
      await waitFor(() => expect(saveBtn).toHaveTextContent('Saved'))
      const calls = mocks.createSavedLookFromMobile.mock.calls.slice(-2)
      expect(calls[0]?.[1]?.idempotencyKey).toBeTruthy()
      expect(calls[0]?.[1]?.idempotencyKey).toBe(calls[1]?.[1]?.idempotencyKey)

      // Saving the same unchanged look again is a no-op without destructive Undo. A real click, as
      // above: the Retry save ended busy in a promise, so the responder re-enables a task later.
      await userEvent.click(saveBtn)
      await waitFor(() =>
        expect(
          within(panel).queryByTestId('status-bar-action-undo')
        ).not.toBeInTheDocument()
      )
      expect(saveBtn).toHaveTextContent('Saved')
      expect(mocks.createSavedLookFromMobile).toHaveBeenCalledTimes(2)

      // Removing a saved look handles 503 failure -> Retry -> Undo Remove
      mocks.deleteSavedLookFromMobile
        .mockRejectedValueOnce(new Error('503'))
        .mockResolvedValueOnce(undefined)
      const removeLookBtn = await within(panel).findByTestId('style-piece-remove')
      fireEvent.click(removeLookBtn)
      await waitFor(() =>
        expect(within(panel).getByTestId('status-bar-action-retry')).toBeInTheDocument()
      )
      fireEvent.click(within(panel).getByTestId('status-bar-action-retry'))
      await waitFor(() =>
        expect(within(panel).getByTestId('status-bar-action-undo')).toBeInTheDocument()
      )
      fireEvent.click(within(panel).getByTestId('status-bar-action-undo'))
      await waitFor(() =>
        expect(within(panel).getByTestId('status-feedback-bar')).toHaveTextContent(
          'Could not save. Try again.'
        )
      )
      await panelView.unmount()
    } finally {
      setMobileApplicationUserId(null)
    }
  })
})

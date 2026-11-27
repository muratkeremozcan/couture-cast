// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 M-GATE-*, M-* functional, M-STORAGE-DENIED and the D1 session check for the
// mobile guest preview, through the real store and policy.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-NAT-031, the sample item detail hands accessibility focus
// back to the item that opened it (its `returnFocusRef`). [Codex 7.11 #3], 7.11-NAT-032: each
// preview sheet header is the layer's swipe handle, through the same close as its X.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
// Learning path Step 76: Garment subtypes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-76-garment-subtypes
import {
  act,
  configure,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactNativeModule from 'react-native'
import {
  createGuestPreviewStore,
  GUEST_PREVIEW_STRINGS,
  SAMPLE_CATALOG,
  type GuestPreviewStorageAdapter,
} from '@couture/utils'
import { screenFocus } from '../../test-utils/focus-effect.js'
import { press } from '@/src/test-utils/press'
import { dragFrom } from '@/src/test-utils/layer-swipe'
import { LAYER_SWIPE_CLOSE_PX } from '@/components/edge-to-edge-modal'

// D13: native accessibility focus. react-native-web's findNodeHandle always throws, so each node
// gets a stable fake tag; on web (every other case here) nothing asks for one.
const a11y = vi.hoisted(() => {
  const tags = new Map<unknown, number>()
  return {
    tags,
    tagOf: (node: unknown) => {
      if (!tags.has(node)) tags.set(node, 400 + tags.size)
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

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('expo-router', async () => ({
  router: navigation,
  useRouter: () => navigation,
  useLocalSearchParams: () => ({}),
  useFocusEffect: (await import('../../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
const session = vi.hoisted(() => ({
  state: 'signed-out' as 'restoring' | 'member' | 'signed-out' | 'unavailable',
  retry: vi.fn(),
}))
vi.mock('@/src/lib/member-session', () => ({
  useMemberSessionState: () => [session.state, session.retry],
}))
const analytics = vi.hoisted(() => ({ capture: vi.fn(), reset: vi.fn() }))
vi.mock('@/src/analytics/mobile-analytics', () => ({
  mobileAnalyticsClient: {
    capture: analytics.capture,
    screen: vi.fn(),
    getDistinctId: () => 'x',
  },
  resetMobileAnalyticsIdentity: analytics.reset,
}))

import { Platform } from 'react-native'
import { setMobileGuestPreviewStoreForTests } from '@/src/lib/guest-preview'
import { initI18n } from '@/src/lib/i18n'
import { GuestPreviewReviewScreen } from './guest-preview-review-screen'
import { GuestPreviewScreen } from './guest-preview-screen'

const en = GUEST_PREVIEW_STRINGS['en-US']
const directConversion = { intent: 'guest-preview-first-garment' }

function memoryAdapter(options: { failWrites?: boolean } = {}) {
  let value: string | null = null
  const adapter: GuestPreviewStorageAdapter & { value: () => string | null } = {
    value: () => value,
    read: () => Promise.resolve(value),
    write: (text) => {
      if (options.failWrites) return Promise.reject(new Error('quota'))
      value = text
      return Promise.resolve()
    },
    remove: () => {
      value = null
      return Promise.resolve()
    },
  }
  return adapter
}

let adapter: ReturnType<typeof memoryAdapter>

function useStore(next = memoryAdapter()) {
  adapter = next
  const store = createGuestPreviewStore({ adapter, catalog: SAMPLE_CATALOG })
  setMobileGuestPreviewStoreForTests(store)
  return store
}

const garmentIds = () =>
  Array.from(document.querySelectorAll('[data-testid^="guest-preview-garment-"]')).map(
    (node) =>
      (node.getAttribute('data-testid') ?? '').replace('guest-preview-garment-', '')
  )

async function passGate() {
  await render(<GuestPreviewScreen />)
  fireEvent.change(await screen.findByTestId('guest-preview-birthdate'), {
    target: { value: '2000-01-15' },
  })
  press(screen.getByTestId('guest-preview-gate-submit'))
  return screen.findByTestId('guest-preview-outfit')
}

beforeAll(async () => {
  configure({ asyncUtilTimeout: 5_000 })
  await initI18n()
})

beforeEach(() => {
  navigation.push.mockClear()
  navigation.replace.mockClear()
  session.state = 'signed-out'
  useStore()
})

afterEach(() => {
  screenFocus.reset()
  setMobileGuestPreviewStoreForTests(undefined)
})

describe('mobile guest preview session check (D1)', () => {
  it('sends a verified member back to Home', async () => {
    session.state = 'member'
    await render(<GuestPreviewScreen />)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    expect(screen.queryByTestId('guest-preview-gate')).toBeNull()
  })

  // Review F3: guest state left on a shared device never reaches a member.
  function useStoredIntent() {
    const store = useStore()
    store.start()
    store.update((state) => ({
      ...state,
      conversion: { intent: 'guest-preview-carryover' as const },
    }))
    return store.flush()
  }
  const storedConversion = () =>
    (JSON.parse(adapter.value() ?? '{}') as { conversion?: unknown }).conversion

  it('clears guest state when a verified member opens the preview', async () => {
    await useStoredIntent()
    session.state = 'member'
    await render(<GuestPreviewScreen />)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    await waitFor(() => expect(adapter.value()).toBeNull())
  })

  it('drops a stored intent when the preview opens signed out, and keeps the preview', async () => {
    await useStoredIntent()
    await render(<GuestPreviewScreen />)
    expect(await screen.findByTestId('guest-preview-outfit')).toBeTruthy()
    await waitFor(() => expect(storedConversion()).toBeUndefined())
    expect(adapter.value()).not.toBeNull()
  })

  it('shows a member no proposal on the review after a guest backed out', async () => {
    await useStoredIntent()
    const guest = await render(<GuestPreviewScreen />)
    await screen.findByTestId('guest-preview-outfit')
    await waitFor(() => expect(storedConversion()).toBeUndefined())
    await guest.unmount()
    navigation.replace.mockClear()
    await render(<GuestPreviewReviewScreen />)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    expect(screen.queryByTestId('guest-preview-review-proposed')).toBeNull()
  })

  // TEA M1: the preview stays mounted under signup and sign-in. A sign-in there makes the
  // session a member while the preview is not focused; acting then cleared the intent and
  // replaced the review with Home.
  it('does nothing while unfocused when the session becomes a member', async () => {
    await useStoredIntent()
    const view = await render(<GuestPreviewScreen />)
    await screen.findByTestId('guest-preview-outfit')
    await waitFor(() => expect(storedConversion()).toBeUndefined())
    press(screen.getByTestId('guest-preview-create-account'))
    await waitFor(() => expect(storedConversion()).toEqual(directConversion))
    act(() => screenFocus.set(false))
    session.state = 'member'
    await view.rerender(<GuestPreviewScreen />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(navigation.replace).not.toHaveBeenCalled()
    expect(storedConversion()).toEqual(directConversion)
    // Focused again as a member, it clears guest state and goes Home.
    act(() => screenFocus.set(true))
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    await waitFor(() => expect(adapter.value()).toBeNull())
  })

  it('drops the intent when Back returns to the mounted preview signed out', async () => {
    await render(<GuestPreviewScreen />)
    fireEvent.change(await screen.findByTestId('guest-preview-birthdate'), {
      target: { value: '2000-01-15' },
    })
    press(screen.getByTestId('guest-preview-gate-submit'))
    await screen.findByTestId('guest-preview-outfit')
    press(screen.getByTestId('guest-preview-create-account'))
    await waitFor(() => expect(storedConversion()).toEqual(directConversion))
    act(() => screenFocus.set(false))
    act(() => screenFocus.set(true))
    await waitFor(() => expect(storedConversion()).toBeUndefined())
    expect(screen.getByTestId('guest-preview-outfit')).toBeTruthy()
  })

  it('shows a status while restoring and a retry when the session is unavailable', async () => {
    session.state = 'restoring'
    const view = await render(<GuestPreviewScreen />)
    expect(screen.getByTestId('guest-preview-checking').textContent).toBe(
      en.chrome.checkingSession
    )
    session.state = 'unavailable'
    await view.rerender(<GuestPreviewScreen />)
    press(await screen.findByTestId('guest-preview-retry'))
    expect(session.retry).toHaveBeenCalledOnce()
  })
})

describe('mobile guest preview gate (M-GATE-*)', () => {
  it('blocks under-13 with the existing copy and stores nothing', async () => {
    await render(<GuestPreviewScreen />)
    const input = await screen.findByTestId('guest-preview-birthdate')
    fireEvent.change(input, { target: { value: '2020-01-01' } })
    press(screen.getByTestId('guest-preview-gate-submit'))
    expect((await screen.findByTestId('guest-preview-gate-error')).textContent).toBe(
      en.gate.underage
    )
    expect((input as HTMLInputElement).value).toBe('')
    expect(adapter.value()).toBeNull()
    expect(analytics.capture).not.toHaveBeenCalled()
  })

  it('rejects an invalid date and exits home', async () => {
    await render(<GuestPreviewScreen />)
    fireEvent.change(await screen.findByTestId('guest-preview-birthdate'), {
      target: { value: '2010-02-30' },
    })
    press(screen.getByTestId('guest-preview-gate-submit'))
    expect((await screen.findByTestId('guest-preview-gate-error')).textContent).toBe(
      en.gate.invalid
    )
    press(screen.getByTestId('guest-preview-gate-exit'))
    expect(navigation.replace).toHaveBeenCalledWith('/')
  })

  it('opens the preview, stores no birthdate and reports the start', async () => {
    await passGate()
    await waitFor(() => expect(adapter.value()).not.toBeNull())
    expect(adapter.value()).not.toContain('2000-01-15')
    expect(screen.getByTestId('guest-preview-label').textContent).toBe(
      en.chrome.sampleLabel
    )
    expect(analytics.capture).toHaveBeenCalledWith('guest_preview_started', {
      platform: expect.stringMatching(/^(ios|android)$/) as string,
      catalog_version: SAMPLE_CATALOG.catalogVersion,
    })
  })
})

describe('mobile guest preview surfaces', () => {
  it('changes the outfit with comfort and weather controls (AC2)', async () => {
    await passGate()
    expect(garmentIds()).toEqual(['oxford-shirt', 'dark-jeans', 'loafers'])
    press(screen.getByTestId('guest-preview-thermal-cold'))
    await waitFor(() => expect(garmentIds()[0]).toBe('fleece-zip'))
    expect(screen.getByTestId('guest-preview-explanation').textContent).toContain(
      'Fleece zip jacket adds warmth below 59°F.'
    )
    press(screen.getByTestId('guest-preview-weather-cool-windy'))
    await waitFor(() => expect(garmentIds()[0]).toBe('wool-overcoat'))
    press(screen.getByTestId('guest-preview-wind-high'))
    press(screen.getByTestId('guest-preview-rain-low'))
    await waitFor(() => expect(garmentIds()[0]).toBe('fleece-zip'))
    expect(analytics.capture).toHaveBeenCalledWith('guest_preview_interacted', {
      platform: expect.any(String) as string,
      catalog_version: SAMPLE_CATALOG.catalogVersion,
      action: 'control_changed',
      control: 'rain',
    })
  })

  it('tries another look and says when none is left', async () => {
    const store = useStore()
    store.start()
    store.update((state) => ({
      ...state,
      votes: Object.fromEntries(
        SAMPLE_CATALOG.looks
          .filter(
            (look) =>
              look.id !== 'sample:l:office-oxford' && look.id !== 'sample:l:silk-midi'
          )
          .map((look) => [look.id, 'dislike' as const])
      ),
    }))
    await store.flush()
    await render(<GuestPreviewScreen />)
    const first = (await screen.findByTestId('guest-preview-look-name')).textContent
    press(screen.getByTestId('guest-preview-try-another'))
    await waitFor(() =>
      expect(screen.getByTestId('guest-preview-look-name').textContent).not.toBe(first)
    )
    await act(async () => {
      store.update((state) => ({
        ...state,
        votes: {
          ...state.votes,
          [state.selectedLookId === 'sample:l:silk-midi'
            ? 'sample:l:office-oxford'
            : 'sample:l:silk-midi']: 'dislike',
        },
      }))
      await store.flush()
    })
    press(await screen.findByTestId('guest-preview-try-another'))
    expect((await screen.findByTestId('guest-preview-no-alternative')).textContent).toBe(
      en.outfit.noAlternative
    )
  })

  it('swaps a garment through the sheet and undoes it (D6)', async () => {
    await passGate()
    const baseCopy = en.looks['office-oxford'].description
    expect(screen.getByText(baseCopy)).toBeVisible()
    press(screen.getByTestId('guest-preview-swap-shoes'))
    const sheet = await screen.findByTestId('guest-preview-swap-sheet')
    expect(within(sheet).getByText('Swap the shoes')).toBeTruthy()
    press(within(sheet).getByTestId('guest-preview-swap-option-white-sneakers'))
    await waitFor(() => expect(garmentIds()).toContain('white-sneakers'))
    expect(screen.queryByText(baseCopy)).toBeNull()
    press(screen.getByTestId('guest-preview-undo-swaps'))
    await waitFor(() => expect(garmentIds()).toContain('loafers'))
    expect(screen.getByText(baseCopy)).toBeVisible()
  })

  it('reopens an unedited bookmark without an Undo swaps action', async () => {
    await passGate()
    press(screen.getByTestId('sample-save-look'))
    const reopen = await screen.findByTestId('sample-open-sample:l:office-oxford')
    press(screen.getByTestId('guest-preview-try-another'))
    expect(screen.getByText('Silk midi')).toBeVisible()
    press(reopen)
    expect(screen.getByTestId('guest-preview-look-name')).toHaveTextContent('School day')
    expect(screen.queryByTestId('guest-preview-undo-swaps')).toBeNull()
    expect(screen.getByText(en.looks['office-oxford'].description)).toBeVisible()
  })

  it('reopens saved swaps without describing the original garments', async () => {
    await passGate()
    press(screen.getByTestId('guest-preview-swap-shoes'))
    press(await screen.findByTestId('guest-preview-swap-option-white-sneakers'))
    press(screen.getByTestId('sample-save-look'))
    const reopen = await screen.findByTestId('sample-open-sample:l:office-oxford')
    press(screen.getByTestId('guest-preview-try-another'))
    press(reopen)
    expect(garmentIds()).toContain('white-sneakers')
    expect(screen.getByTestId('guest-preview-look-name')).toHaveTextContent(
      en.outfit.heading
    )
    expect(screen.getByTestId('guest-preview-undo-swaps')).toBeVisible()
    expect(screen.queryByText(en.looks['office-oxford'].description)).toBeNull()
  })

  it('shows no suitable alternative and closes the sheet', async () => {
    await passGate()
    press(screen.getByTestId('guest-preview-weather-warm-rainy'))
    press(screen.getByTestId('guest-preview-thermal-warm'))
    press(await screen.findByTestId('guest-preview-swap-outerwear'))
    expect((await screen.findByTestId('guest-preview-no-suitable')).textContent).toBe(
      en.outfit.noSuitableAlternative
    )
    press(screen.getByTestId('guest-preview-swap-sheet-close'))
    await waitFor(() =>
      expect(screen.queryByTestId('guest-preview-no-suitable')).toBeNull()
    )
  })

  it('[Codex 7.11 #3] [7.11-NAT-032] a swipe down on the swap sheet header closes it and keeps the garment', async () => {
    await passGate()
    press(screen.getByTestId('guest-preview-swap-shoes'))
    const sheet = await screen.findByTestId('guest-preview-swap-sheet')
    const handle = within(sheet).getByTestId('layer-swipe-handle')
    expect(handle.contains(within(sheet).getByText('Swap the shoes'))).toBe(true)
    expect(
      handle.contains(within(sheet).getByTestId('guest-preview-swap-sheet-close'))
    ).toBe(true)

    await dragFrom(within(sheet).getByText('Swap the shoes'), {
      dy: LAYER_SWIPE_CLOSE_PX + 40,
    })
    await waitFor(() =>
      expect(screen.queryByTestId('guest-preview-swap-sheet')).toBeNull()
    )
    // Closed without a choice: the look keeps its shoes and offers no Undo.
    expect(garmentIds()).toContain('loafers')
    expect(garmentIds()).not.toContain('white-sneakers')
    expect(screen.queryByTestId('guest-preview-undo-swaps')).toBeNull()
  })

  it('records reversible votes with progress and an empty state', async () => {
    await passGate()
    press(screen.getByTestId('guest-preview-nav-preferences'))
    const like = await screen.findByTestId('guest-preview-vote-like-city-wool')
    press(like)
    await waitFor(() =>
      expect(screen.getByTestId('guest-preview-feedback-progress').textContent).toBe(
        '1 of 9 reviewed'
      )
    )
    press(screen.getByTestId('guest-preview-vote-like-city-wool'))
    await waitFor(() =>
      expect(screen.getByTestId('guest-preview-feedback-progress').textContent).toBe(
        '0 of 9 reviewed'
      )
    )
    press(screen.getByTestId('guest-preview-vote-dislike-city-wool'))
    press(screen.getByTestId('guest-preview-feedback-reset'))
    await waitFor(() =>
      expect(screen.getByTestId('guest-preview-feedback-progress').textContent).toBe(
        '0 of 9 reviewed'
      )
    )
  })

  it('shows the honest empty state when every suitable look is disliked', async () => {
    const store = useStore()
    store.start()
    store.update((state) => ({
      ...state,
      votes: Object.fromEntries(
        SAMPLE_CATALOG.looks.map((look) => [look.id, 'dislike' as const])
      ),
    }))
    await store.flush()
    await render(<GuestPreviewScreen />)
    const empty = await screen.findByTestId('guest-preview-empty')
    expect(empty.textContent).toContain(en.outfit.allDisliked)
    press(within(empty).getByTestId('guest-preview-reset-choices'))
    expect(await screen.findByTestId('guest-preview-outfit')).toBeTruthy()
    store.update((state) => ({
      ...state,
      votes: Object.fromEntries(
        SAMPLE_CATALOG.looks.map((look) => [look.id, 'dislike' as const])
      ),
    }))
    press(await screen.findByTestId('guest-preview-review-choices'))
    expect(await screen.findByTestId('guest-preview-feedback')).toBeTruthy()
  })

  it('filters, inspects and uses a sample item', async () => {
    await passGate()
    press(screen.getByTestId('guest-preview-browse-wardrobe'))
    await screen.findByTestId('guest-preview-wardrobe')
    press(screen.getByTestId('guest-preview-category-shoes'))
    press(screen.getByTestId('guest-preview-collection-menswear'))
    await waitFor(() =>
      expect(screen.getByTestId('guest-preview-item-count').textContent).toBe(
        '5 sample items'
      )
    )
    expect(screen.getByTestId('guest-preview-item-moto-boots')).toBeVisible()
    press(screen.getByTestId('guest-preview-item-white-sneakers'))
    const detail = await screen.findByTestId('guest-preview-item-detail')
    expect(within(detail).getByText('Synthetic')).toBeTruthy()
    press(within(detail).getByTestId('guest-preview-use-item'))
    await waitFor(() => expect(adapter.value()).toContain('sample:g:white-sneakers'))
    press(screen.getByTestId('guest-preview-category-dress'))
    await waitFor(() =>
      expect(screen.getByTestId('guest-preview-item-count').textContent).toBe(
        en.wardrobe.empty
      )
    )
    press(screen.getByTestId('guest-preview-back-to-outfit'))
    expect(await screen.findByTestId('guest-preview-outfit')).toBeTruthy()
    expect(garmentIds()).toContain('white-sneakers')
  })

  // Story CC-7.11 D13. The close runs the native focus path (Android); react-native-web would
  // also refocus the pressed item on its own, which would hide a lost `returnFocusRef`.
  it('[7.11-NAT-031] closing a sample item detail returns accessibility focus to the item that opened it', async () => {
    await passGate()
    press(screen.getByTestId('guest-preview-browse-wardrobe'))
    await screen.findByTestId('guest-preview-wardrobe')
    const item = screen.getByTestId('guest-preview-item-white-sneakers')
    press(item)
    const detail = await screen.findByTestId('guest-preview-item-detail')
    a11y.tags.clear()
    a11y.setAccessibilityFocus.mockClear()
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
    try {
      press(within(detail).getByTestId('guest-preview-item-detail-close'))
      await waitFor(() =>
        expect(screen.queryByTestId('guest-preview-item-detail')).toBeNull()
      )
      await waitFor(() =>
        expect(a11y.setAccessibilityFocus).toHaveBeenLastCalledWith(a11y.tagOf(item))
      )
      expect(a11y.setAccessibilityFocus).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
    }
  })
})

describe('mobile guest preview item detail swipe', () => {
  it('[Codex 7.11 #3] [7.11-NAT-032] a swipe down on the item detail header closes it and focus returns to the item', async () => {
    await passGate()
    press(screen.getByTestId('guest-preview-browse-wardrobe'))
    await screen.findByTestId('guest-preview-wardrobe')
    const item = screen.getByTestId('guest-preview-item-white-sneakers')
    press(item)
    const detail = await screen.findByTestId('guest-preview-item-detail')
    const handle = within(detail).getByTestId('layer-swipe-handle')
    a11y.tags.clear()
    a11y.setAccessibilityFocus.mockClear()
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
    try {
      await dragFrom(handle, { dy: LAYER_SWIPE_CLOSE_PX + 40 })
      await waitFor(() =>
        expect(screen.queryByTestId('guest-preview-item-detail')).toBeNull()
      )
      await waitFor(() =>
        expect(a11y.setAccessibilityFocus).toHaveBeenLastCalledWith(a11y.tagOf(item))
      )
      expect(a11y.setAccessibilityFocus).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
    }
  })
})

describe('mobile guest preview lifecycle', () => {
  it('stores the intent, reports the click, rotates the id and opens signup', async () => {
    await passGate()
    press(screen.getByTestId('guest-preview-create-account'))
    await waitFor(() => expect(adapter.value()).toContain(directConversion.intent))
    expect(analytics.capture).toHaveBeenLastCalledWith('guest_preview_signup_clicked', {
      platform: expect.any(String) as string,
      catalog_version: SAMPLE_CATALOG.catalogVersion,
      action: 'create_account',
    })
    expect(analytics.reset).toHaveBeenCalledOnce()
    expect(navigation.push).toHaveBeenCalledWith('/signup?from=preview')
    press(screen.getByTestId('guest-preview-sign-in'))
    expect(navigation.push).toHaveBeenCalledWith('/signin?from=preview')
  })

  it('resets to defaults and exits by deleting stored state', async () => {
    await passGate()
    press(screen.getByTestId('guest-preview-thermal-cold'))
    await waitFor(() => expect(garmentIds()[0]).toBe('fleece-zip'))
    press(screen.getByTestId('guest-preview-reset'))
    await waitFor(() => expect(garmentIds()[0]).toBe('oxford-shirt'))
    press(screen.getByTestId('guest-preview-exit'))
    await waitFor(() => expect(adapter.value()).toBeNull())
    expect(navigation.replace).toHaveBeenCalledWith('/')
  })

  it('discloses in-memory mode when storage fails (M-STORAGE-DENIED)', async () => {
    useStore(memoryAdapter({ failWrites: true }))
    await passGate()
    expect((await screen.findByTestId('guest-preview-storage')).textContent).toBe(
      en.chrome.storageUnavailable
    )
    press(screen.getByTestId('guest-preview-thermal-cold'))
    await waitFor(() => expect(garmentIds()[0]).toBe('fleece-zip'))
  })

  it('announces a swap for screen readers', async () => {
    await passGate()
    press(screen.getByTestId('guest-preview-swap-shoes'))
    press(await screen.findByTestId('guest-preview-swap-option-white-sneakers'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('guest-preview-announcement').textContent).toBe(
      'White sneakers is now in the outfit.'
    )
  })
})

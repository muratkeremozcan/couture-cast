// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 M-GATE-*, M-* functional, M-STORAGE-DENIED and the D1 session check for the
// mobile guest preview, through the real store and policy.
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
import {
  createGuestPreviewStore,
  GUEST_PREVIEW_STRINGS,
  SAMPLE_CATALOG,
  type GuestPreviewStorageAdapter,
} from '@couture/utils'
import { press } from '@/src/test-utils/press'

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('expo-router', () => ({
  router: navigation,
  useRouter: () => navigation,
  useLocalSearchParams: () => ({}),
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

import { setMobileGuestPreviewStoreForTests } from '@/src/lib/guest-preview'
import { initI18n } from '@/src/lib/i18n'
import { GuestPreviewReviewScreen } from './guest-preview-review-screen'
import { GuestPreviewScreen } from './guest-preview-screen'

const en = GUEST_PREVIEW_STRINGS['en-US']

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
  session.state = 'signed-out'
  useStore()
})

afterEach(() => setMobileGuestPreviewStoreForTests(undefined))

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
    press(screen.getByTestId('guest-preview-swap-shoes'))
    const sheet = await screen.findByTestId('guest-preview-swap-sheet')
    expect(within(sheet).getByText('Swap the shoes')).toBeTruthy()
    press(within(sheet).getByTestId('guest-preview-swap-option-white-sneakers'))
    await waitFor(() => expect(garmentIds()).toContain('white-sneakers'))
    press(screen.getByTestId('guest-preview-undo-swaps'))
    await waitFor(() => expect(garmentIds()).toContain('loafers'))
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
        '4 sample items'
      )
    )
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
})

describe('mobile guest preview lifecycle', () => {
  it('stores the intent, reports the click, rotates the id and opens signup', async () => {
    await passGate()
    press(screen.getByTestId('guest-preview-create-account'))
    await waitFor(() => expect(adapter.value()).toContain('guest-preview-carryover'))
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

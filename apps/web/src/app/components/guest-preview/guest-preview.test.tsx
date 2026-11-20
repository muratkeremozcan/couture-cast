// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 W-GATE-*, W-* functional, W-STORAGE-DENIED, W-OFFLINE-AFTER-LOAD and
// L-CROSS-TAB-* for the web guest preview, through the real store and policy.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGuestPreviewStore,
  GUEST_PREVIEW_STRINGS,
  SAMPLE_CATALOG,
  type GuestPreviewStorageAdapter,
} from '@couture/utils'
import type * as GuestPreviewLib from '../../../lib/guest-preview'
import { setWebGuestPreviewStoreForTests } from '../../../lib/guest-preview'
import { GuestPreview } from './guest-preview'
import { GuestPreviewReview } from './guest-preview-review'

const navigation = vi.hoisted(() => {
  const push = vi.fn()
  const replace = vi.fn()
  // Next.js hands out one stable router object, so the mock does too.
  return { params: new URLSearchParams(), push, replace, router: { push, replace } }
})
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.params,
}))

const session = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('../../../lib/guest-preview', async (importOriginal) => ({
  ...(await importOriginal<typeof GuestPreviewLib>()),
  resolveWebPreviewSession: session.resolve,
}))

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
  setWebGuestPreviewStoreForTests(store)
  return store
}

async function passGate() {
  render(<GuestPreview />)
  const input = await screen.findByTestId('guest-preview-birthdate')
  fireEvent.change(input, { target: { value: '2000-01-15' } })
  fireEvent.click(screen.getByTestId('guest-preview-gate-submit'))
  return screen.findByTestId('guest-preview-outfit')
}

const garmentIds = () =>
  screen.getAllByTestId('guest-preview-garment').map((item) => item.dataset.garmentId)

beforeEach(() => {
  navigation.params = new URLSearchParams()
  navigation.push.mockReset()
  navigation.replace.mockReset()
  session.resolve.mockReset().mockResolvedValue('guest')
  window.__enableAnalyticsTestHook = true
  window.__capturedAnalyticsEvents = []
  window.__analyticsIdentityResets = 0
  useStore()
})

afterEach(() => {
  setWebGuestPreviewStoreForTests(undefined)
  delete window.__enableAnalyticsTestHook
})

describe('guest preview session check (D1)', () => {
  it('sends a verified member back to the app without showing the preview', async () => {
    session.resolve.mockResolvedValue('member')
    render(<GuestPreview />)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    expect(screen.queryByTestId('guest-preview-gate')).toBeNull()
    expect(screen.getByTestId('guest-preview-checking').textContent).toBe(
      en.chrome.checkingSession
    )
  })

  // Review F3: guest state left on a shared browser never reaches a member.
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
    session.resolve.mockResolvedValue('member')
    render(<GuestPreview />)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    await waitFor(() => expect(adapter.value()).toBeNull())
  })

  it('drops a stored intent when the preview opens signed out, and keeps the preview', async () => {
    await useStoredIntent()
    render(<GuestPreview />)
    expect(await screen.findByTestId('guest-preview-outfit')).toBeInTheDocument()
    await waitFor(() => expect(storedConversion()).toBeUndefined())
    expect(adapter.value()).not.toBeNull()
  })

  it('shows a member no proposal on /preview/continue after a guest backed out', async () => {
    await useStoredIntent()
    const guest = render(<GuestPreview />)
    await screen.findByTestId('guest-preview-outfit')
    await waitFor(() => expect(storedConversion()).toBeUndefined())
    guest.unmount()
    render(<GuestPreviewReview />)
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
    expect(screen.queryByTestId('guest-preview-review-proposed')).toBeNull()
  })

  it('keeps an unverifiable session and offers a retry (L-RESTORE)', async () => {
    session.resolve.mockResolvedValueOnce('unavailable').mockResolvedValueOnce('guest')
    render(<GuestPreview />)
    const unavailable = await screen.findByTestId('guest-preview-session-unavailable')
    expect(within(unavailable).getByRole('alert').textContent).toBe(
      en.chrome.sessionUnavailable
    )
    fireEvent.click(within(unavailable).getByRole('button', { name: en.chrome.retry }))
    expect(await screen.findByTestId('guest-preview-gate')).toBeInTheDocument()
  })

  it('rechecks when the session changes in this tab', async () => {
    render(<GuestPreview />)
    await screen.findByTestId('guest-preview-gate')
    session.resolve.mockResolvedValue('member')
    act(() => {
      window.dispatchEvent(new Event('couture:session'))
    })
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'))
  })
})

describe('guest preview gate (W-GATE-*)', () => {
  it('blocks under-13 with the existing copy, stores nothing and sends no event', async () => {
    render(<GuestPreview />)
    const input = await screen.findByTestId('guest-preview-birthdate')
    fireEvent.change(input, { target: { value: '2020-01-01' } })
    fireEvent.click(screen.getByTestId('guest-preview-gate-submit'))
    expect(screen.getByTestId('guest-preview-gate-error').textContent).toBe(
      en.gate.underage
    )
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.queryByTestId('guest-preview-outfit')).toBeNull()
    expect(adapter.value()).toBeNull()
    expect(window.__capturedAnalyticsEvents).toEqual([])
  })

  it('rejects an invalid date with the existing copy', async () => {
    render(<GuestPreview />)
    fireEvent.change(await screen.findByTestId('guest-preview-birthdate'), {
      target: { value: '2010-02-30' },
    })
    fireEvent.click(screen.getByTestId('guest-preview-gate-submit'))
    expect(screen.getByTestId('guest-preview-gate-error').textContent).toBe(
      en.gate.invalid
    )
  })

  it('opens the preview for an eligible visitor and stores no birthdate (C-GATE-CLEARS)', async () => {
    await passGate()
    const stored = adapter.value() ?? ''
    expect(stored).not.toContain('2000-01-15')
    expect((JSON.parse(stored) as { eligibility: unknown }).eligibility).toEqual({
      eligible: true,
      expiresAt: expect.any(Number) as number,
    })
    expect(window.__capturedAnalyticsEvents).toEqual([
      {
        event: 'guest_preview_started',
        properties: { platform: 'web', catalog_version: SAMPLE_CATALOG.catalogVersion },
      },
    ])
  })
})

describe('guest preview surfaces', () => {
  it('shows the label, a complete outfit, sample weather and why it works (AC1, D4)', async () => {
    const outfit = await passGate()
    expect(screen.getByTestId('guest-preview-label').textContent).toBe(
      en.chrome.sampleLabel
    )
    expect(garmentIds()).toEqual([
      'sample:g:oxford-shirt',
      'sample:g:dark-jeans',
      'sample:g:loafers',
    ])
    expect(within(outfit).getByTestId('guest-preview-weather-chip').textContent).toBe(
      en.values.weather['mild-dry']
    )
    expect(
      within(screen.getByTestId('guest-preview-explanation')).getAllByRole('listitem')[0]
        ?.textContent
    ).toBe('Mild and dry example, feels like 61°F.')
  })

  it('updates outfit and explanation together when thermal comfort changes (AC2)', async () => {
    await passGate()
    fireEvent.click(screen.getByTestId('guest-preview-thermal-cold'))
    expect(garmentIds()[0]).toBe('sample:g:fleece-zip')
    expect(screen.getByTestId('guest-preview-explanation').textContent).toContain(
      'Fleece zip jacket adds warmth below 59°F.'
    )
    expect(window.__capturedAnalyticsEvents?.at(-1)).toEqual({
      event: 'guest_preview_interacted',
      properties: {
        platform: 'web',
        catalog_version: SAMPLE_CATALOG.catalogVersion,
        action: 'control_changed',
        control: 'thermal',
      },
    })
  })

  it('changes weather, wind and rain through their controls', async () => {
    await passGate()
    fireEvent.click(screen.getByTestId('guest-preview-weather-cool-windy'))
    expect(garmentIds()[0]).toBe('sample:g:wool-overcoat')
    fireEvent.click(screen.getByTestId('guest-preview-wind-high'))
    expect(garmentIds()[0]).toBe('sample:g:fleece-zip')
    fireEvent.click(screen.getByTestId('guest-preview-weather-warm-rainy'))
    expect(garmentIds()[0]).toBe('sample:g:rain-shell')
    fireEvent.click(screen.getByTestId('guest-preview-rain-low'))
    expect(garmentIds()).not.toContain('sample:g:rain-shell')
  })

  it('tries another look, and says so when none is left', async () => {
    await passGate()
    const first = screen.getByTestId('guest-preview-outfit').dataset.lookId
    fireEvent.click(screen.getByTestId('guest-preview-try-another'))
    expect(screen.getByTestId('guest-preview-outfit').dataset.lookId).not.toBe(first)
    expect(screen.getByTestId('guest-preview-announcement').textContent).toContain(
      'Outfit updated'
    )
  })

  it('reports no alternative when only one look suits', async () => {
    const store = useStore()
    store.start()
    store.update((state) => ({
      ...state,
      votes: Object.fromEntries(
        SAMPLE_CATALOG.looks
          .filter((look) => look.id !== 'sample:l:office-oxford')
          .map((look) => [look.id, 'dislike' as const])
      ),
    }))
    await store.flush()
    render(<GuestPreview />)
    fireEvent.click(await screen.findByTestId('guest-preview-try-another'))
    expect(screen.getByTestId('guest-preview-no-alternative').textContent).toBe(
      en.outfit.noAlternative
    )
  })

  it('swaps a garment through the dialog, then undoes it (D6)', async () => {
    await passGate()
    fireEvent.click(screen.getByTestId('guest-preview-swap-shoes'))
    const dialog = await screen.findByRole('dialog', { name: 'Swap the shoes' })
    fireEvent.click(
      within(dialog).getByTestId('guest-preview-swap-option-white-sneakers')
    )
    expect(garmentIds()).toContain('sample:g:white-sneakers')
    expect(screen.getByTestId('guest-preview-announcement').textContent).toBe(
      'White sneakers is now in the outfit.'
    )
    fireEvent.click(screen.getByTestId('guest-preview-undo-swaps'))
    expect(garmentIds()).toContain('sample:g:loafers')
  })

  it('says when a slot has no suitable alternative', async () => {
    await passGate()
    fireEvent.click(screen.getByTestId('guest-preview-weather-warm-rainy'))
    fireEvent.click(screen.getByTestId('guest-preview-thermal-warm'))
    fireEvent.click(screen.getByTestId('guest-preview-swap-outerwear'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('guest-preview-no-suitable').textContent).toBe(
      en.outfit.noSuitableAlternative
    )
    fireEvent.click(within(dialog).getByRole('button', { name: en.chrome.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
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
    render(<GuestPreview />)
    const empty = await screen.findByTestId('guest-preview-empty')
    expect(within(empty).getByRole('heading').textContent).toBe(en.outfit.allDisliked)
    fireEvent.click(within(empty).getByTestId('guest-preview-review-choices'))
    expect(navigation.push).toHaveBeenCalledWith('/preview?view=preferences', {
      scroll: false,
    })
    fireEvent.click(within(empty).getByTestId('guest-preview-reset-choices'))
    expect(await screen.findByTestId('guest-preview-outfit')).toBeInTheDocument()
  })
})

describe('guest preview feedback and wardrobe views', () => {
  it('records reversible votes with progress (U-VOTES on web)', async () => {
    navigation.params = new URLSearchParams('view=preferences')
    await passGateOn('guest-preview-feedback')
    const [card] = screen.getAllByTestId('guest-preview-card')
    const like = within(card as HTMLElement).getByTestId('guest-preview-vote-like')
    fireEvent.click(like)
    expect(like.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('guest-preview-feedback-progress').textContent).toBe(
      '1 of 9 reviewed'
    )
    fireEvent.click(like)
    expect(like.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(within(card as HTMLElement).getByTestId('guest-preview-vote-dislike'))
    fireEvent.click(screen.getByTestId('guest-preview-feedback-reset'))
    expect(screen.getByTestId('guest-preview-feedback-progress').textContent).toBe(
      '0 of 9 reviewed'
    )
  })

  it('filters, inspects and uses a sample item, then returns to the outfit', async () => {
    navigation.params = new URLSearchParams('view=wardrobe')
    await passGateOn('guest-preview-wardrobe')
    expect(screen.getAllByTestId('guest-preview-item')).toHaveLength(
      SAMPLE_CATALOG.garments.length
    )
    fireEvent.click(screen.getByTestId('guest-preview-category-shoes'))
    fireEvent.click(screen.getByTestId('guest-preview-collection-menswear'))
    const items = screen.getAllByTestId('guest-preview-item')
    expect(items.every((item) => item.dataset.garmentId?.startsWith('sample:g:'))).toBe(
      true
    )
    const sneakers = items.find(
      (item) => item.dataset.garmentId === 'sample:g:white-sneakers'
    )
    fireEvent.click(sneakers as HTMLElement)
    const detail = await screen.findByTestId('guest-preview-item-detail')
    expect(within(detail).getByText('Synthetic')).toBeInTheDocument()
    fireEvent.click(within(detail).getByTestId('guest-preview-use-item'))
    await waitFor(() => {
      const state = JSON.parse(adapter.value() ?? '{}') as {
        swaps: Record<string, unknown>
      }
      expect(Object.values(state.swaps)).toEqual([{ shoes: 'sample:g:white-sneakers' }])
    })
    fireEvent.click(screen.getByTestId('guest-preview-back-to-outfit'))
    expect(navigation.push).toHaveBeenCalledWith('/preview', { scroll: false })
  })

  it('shows an empty category honestly', async () => {
    navigation.params = new URLSearchParams('view=wardrobe')
    await passGateOn('guest-preview-wardrobe')
    fireEvent.click(screen.getByTestId('guest-preview-collection-menswear'))
    fireEvent.click(screen.getByTestId('guest-preview-category-dress'))
    expect(screen.getByTestId('guest-preview-item-count').textContent).toBe(
      en.wardrobe.empty
    )
  })

  it('moves between surfaces through the nav and records the wardrobe visit', async () => {
    await passGate()
    fireEvent.click(screen.getByTestId('guest-preview-nav-wardrobe'))
    expect(navigation.push).toHaveBeenCalledWith('/preview?view=wardrobe', {
      scroll: false,
    })
    expect(window.__capturedAnalyticsEvents?.at(-1)?.properties).toMatchObject({
      action: 'wardrobe_opened',
    })
    expect(
      screen.getByTestId('guest-preview-nav-outfit').getAttribute('aria-current')
    ).toBe('page')
  })
})

async function passGateOn(testId: string) {
  render(<GuestPreview />)
  fireEvent.change(await screen.findByTestId('guest-preview-birthdate'), {
    target: { value: '2000-01-15' },
  })
  fireEvent.click(screen.getByTestId('guest-preview-gate-submit'))
  return screen.findByTestId(testId)
}

describe('guest preview lifecycle', () => {
  it('stores the conversion intent, reports a click and rotates the anonymous id', async () => {
    await passGate()
    const link = screen.getByTestId('guest-preview-create-account')
    expect(link.getAttribute('href')).toBe('/signup?from=preview')
    fireEvent.click(link)
    await waitFor(() =>
      expect(
        (JSON.parse(adapter.value() ?? '{}') as { conversion?: unknown }).conversion
      ).toEqual({
        intent: 'guest-preview-first-garment',
      })
    )
    expect(window.__capturedAnalyticsEvents?.at(-1)).toEqual({
      event: 'guest_preview_signup_clicked',
      properties: {
        platform: 'web',
        catalog_version: SAMPLE_CATALOG.catalogVersion,
        action: 'create_account',
      },
    })
    expect(window.__analyticsIdentityResets).toBe(1)
    fireEvent.click(screen.getByTestId('guest-preview-sign-in'))
    expect(window.__capturedAnalyticsEvents?.at(-1)?.properties).toMatchObject({
      action: 'sign_in',
    })
  })

  it('resets to defaults and exits by deleting stored state', async () => {
    await passGate()
    fireEvent.click(screen.getByTestId('guest-preview-thermal-cold'))
    fireEvent.click(screen.getByTestId('guest-preview-reset'))
    expect(garmentIds()[0]).toBe('sample:g:oxford-shirt')
    fireEvent.click(screen.getByTestId('guest-preview-exit'))
    await waitFor(() => expect(adapter.value()).toBeNull())
    expect(navigation.push).toHaveBeenCalledWith('/')
  })

  it('discloses in-memory mode when storage fails (W-STORAGE-DENIED)', async () => {
    useStore(memoryAdapter({ failWrites: true }))
    await passGate()
    expect((await screen.findByTestId('guest-preview-storage')).textContent).toBe(
      en.chrome.storageUnavailable
    )
    fireEvent.click(screen.getByTestId('guest-preview-thermal-cold'))
    expect(garmentIds()[0]).toBe('sample:g:fleece-zip')
  })

  it('keeps working offline and says signup needs a connection (W-OFFLINE-AFTER-LOAD)', async () => {
    await passGate()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByTestId('guest-preview-offline').textContent).toBe(
      en.chrome.connectionNeeded
    )
    fireEvent.click(screen.getByTestId('guest-preview-thermal-cold'))
    expect(garmentIds()[0]).toBe('sample:g:fleece-zip')
    online.mockRestore()
  })

  it('adopts an exit made in another tab (L-CROSS-TAB-EXIT)', async () => {
    await passGate()
    await adapter.remove()
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'couturecast.guest-preview' })
      )
    })
    expect(await screen.findByTestId('guest-preview-gate')).toBeInTheDocument()
  })

  it('ignores storage events for other keys', async () => {
    await passGate()
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }))
    })
    expect(screen.getByTestId('guest-preview-outfit')).toBeInTheDocument()
  })
})

// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 D7, D8: a sign-in from the preview with a stored carryover intent goes to the
// review step; any other sign-in deletes guest state.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGuestPreviewStore,
  GUEST_PREVIEW_STRINGS,
  SAMPLE_CATALOG,
} from '@couture/utils'
import i18n, { initI18n } from '../lib/i18n'

const auth = vi.hoisted(() => ({ request: vi.fn(), verify: vi.fn() }))
vi.mock('../lib/native-session', () => ({
  requestNativeOtp: auth.request,
  verifyNativeOtp: auth.verify,
}))
const route = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  router: {
    back: vi.fn(),
    replace: vi.fn(),
    dismissTo: vi.fn(),
    push: vi.fn(),
    canGoBack: vi.fn(() => true),
  },
}))
vi.mock('expo-router', () => ({
  router: route.router,
  useLocalSearchParams: () => route.params,
}))
vi.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: 'America/Chicago' }],
  getLocales: () => [{ languageTag: 'en-US' }],
}))
import { setMobileGuestPreviewStoreForTests } from '../lib/guest-preview-store'
import SignInScreen from '../../app/signin'

const label = (key: string) => i18n.t(`community.notifications.${key}`)

function memoryAdapter() {
  let value: string | null = null
  return {
    value: () => value,
    read: () => Promise.resolve(value),
    write: (text: string) => {
      value = text
      return Promise.resolve()
    },
    remove: () => {
      value = null
      return Promise.resolve()
    },
  }
}

async function seed(withIntent: boolean) {
  const adapter = memoryAdapter()
  const store = createGuestPreviewStore({ adapter, catalog: SAMPLE_CATALOG })
  setMobileGuestPreviewStoreForTests(store)
  store.start()
  if (withIntent)
    store.update((state) => ({
      ...state,
      conversion: { intent: 'guest-preview-carryover' },
    }))
  await store.flush()
  return adapter
}

async function signIn() {
  await render(<SignInScreen />)
  fireEvent.change(screen.getByLabelText(label('email')), {
    target: { value: 'member@example.test' },
  })
  fireEvent.click(screen.getByText(label('sendCode')))
  fireEvent.change(await screen.findByLabelText(label('code')), {
    target: { value: '123456' },
  })
  fireEvent.click(screen.getByText(label('verify')))
}

beforeAll(async () => {
  await initI18n()
  await i18n.changeLanguage('en-US')
})
beforeEach(() => {
  auth.request.mockReset().mockResolvedValue(undefined)
  auth.verify.mockReset().mockResolvedValue(undefined)
  route.params = {}
})
afterEach(() => setMobileGuestPreviewStoreForTests(undefined))

describe('native sign-in after the guest preview', () => {
  it('goes to the review with from=preview and a stored intent', async () => {
    route.params = { from: 'preview' }
    const adapter = await seed(true)
    await signIn()
    await waitFor(() =>
      expect(route.router.replace).toHaveBeenCalledWith('/preview-continue')
    )
    expect(route.router.back).not.toHaveBeenCalled()
    expect(adapter.value()).not.toBeNull()
  })

  it('clears a stored intent when the sign-in did not come from the preview (L-G-THEN-A-ELSEWHERE)', async () => {
    const adapter = await seed(true)
    await signIn()
    await waitFor(() => expect(route.router.back).toHaveBeenCalled())
    expect(route.router.replace).not.toHaveBeenCalled()
    expect(adapter.value()).toBeNull()
  })

  it('deletes guest state after a plain sign-in (L-G-SIGNIN)', async () => {
    route.params = { from: 'preview' }
    const adapter = await seed(false)
    await signIn()
    await waitFor(() => expect(route.router.back).toHaveBeenCalled())
    expect(adapter.value()).toBeNull()
  })

  it('offers the way back only for the exact literal', async () => {
    route.params = { from: 'preview' }
    await seed(false)
    const view = await render(<SignInScreen />)
    const back = await screen.findByTestId('signin-back-to-preview')
    expect(back.textContent).toBe(
      GUEST_PREVIEW_STRINGS['en-US'].conversionDetail.backToPreview
    )
    fireEvent.click(back)
    expect(route.router.dismissTo).toHaveBeenCalledWith('/preview')
    route.params = { from: 'https://evil.example' }
    await view.rerender(<SignInScreen />)
    expect(screen.queryByTestId('signin-back-to-preview')).toBeNull()
  })
})

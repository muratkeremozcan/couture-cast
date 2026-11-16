// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA sign-off: the mobile sign-in door with Google. L-G-EXISTING and L-G-PLAIN-SIGNIN
// (S-20, D6): a Google member follows the email code's destination rule, so a sign-in without
// the preview deletes guest state. U-CALLBACK-ROUTES (D5, cold start): `/auth/callback` hands a
// closed `google=<kind>` value to `/signin`, which shows that outcome's fixed localized message
// and nothing for any other value.
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGuestPreviewStore,
  FEDERATED_SIGNIN_STRINGS,
  SAMPLE_CATALOG,
} from '@couture/utils'
import i18n, { initI18n } from '../lib/i18n'

const auth = vi.hoisted(() => ({
  request: vi.fn(),
  verify: vi.fn(),
  google: vi.fn(),
}))
vi.mock('../lib/native-session', () => ({
  requestNativeOtp: auth.request,
  verifyNativeOtp: auth.verify,
  startNativeGoogleSignIn: auth.google,
}))
const route = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  router: {
    back: vi.fn(),
    replace: vi.fn(),
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

const strings = FEDERATED_SIGNIN_STRINGS['en-US']

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

async function continueWithGoogle() {
  await render(<SignInScreen />)
  fireEvent.click(await screen.findByTestId('google-sign-in'))
}

beforeAll(async () => {
  await initI18n()
  await i18n.changeLanguage('en-US')
})
beforeEach(() => {
  auth.request.mockReset().mockResolvedValue(undefined)
  auth.verify.mockReset().mockResolvedValue(undefined)
  auth.google.mockReset().mockResolvedValue({ kind: 'member' })
  route.params = {}
  route.router.back.mockReset()
  route.router.canGoBack.mockReset().mockReturnValue(true)
  route.router.replace.mockReset()
  route.router.push.mockReset()
})
afterEach(() => setMobileGuestPreviewStoreForTests(undefined))

describe('Google on the mobile sign-in door', () => {
  it('L-G-EXISTING: from=preview with a stored intent goes to the review and keeps the intent', async () => {
    route.params = { from: 'preview' }
    const adapter = await seed(true)
    await continueWithGoogle()
    await waitFor(() =>
      expect(route.router.replace).toHaveBeenCalledWith('/preview-continue')
    )
    expect(auth.google).toHaveBeenCalledWith({ from: 'preview', door: 'signin' })
    expect(route.router.back).not.toHaveBeenCalled()
    expect(adapter.value()).not.toBeNull()
  })

  it('L-G-PLAIN-SIGNIN (S-20): a Google sign-in without the preview deletes guest state', async () => {
    const adapter = await seed(true)
    await continueWithGoogle()
    await waitFor(() => expect(route.router.back).toHaveBeenCalled())
    expect(auth.google).toHaveBeenCalledWith({ from: null, door: 'signin' })
    expect(route.router.replace).not.toHaveBeenCalled()
    expect(adapter.value()).toBeNull()
  })

  // Antigravity P1-1: a cold callback replaces into /signin, so sign-in can be the stack's root.
  it('a member signed in on a root sign-in screen goes Home instead of back', async () => {
    await seed(false)
    route.router.canGoBack.mockReturnValue(false)
    await continueWithGoogle()
    await waitFor(() => expect(route.router.replace).toHaveBeenCalledWith('/'))
    expect(route.router.back).not.toHaveBeenCalled()
  })

  it('L-G-NEW: no account goes to the finish step carrying from=preview', async () => {
    route.params = { from: 'preview' }
    await seed(true)
    auth.google.mockResolvedValue({ kind: 'no_account' })
    await continueWithGoogle()
    await waitFor(() =>
      expect(route.router.replace).toHaveBeenCalledWith('/signup-finish?from=preview')
    )
  })

  it.each(['refused', 'cancelled', 'unavailable'] as const)(
    'M-FAIL: an in-process %s outcome shows its fixed message',
    async (kind) => {
      await seed(false)
      auth.google.mockResolvedValue({ kind })
      await continueWithGoogle()
      expect((await screen.findByTestId('google-sign-in-status')).textContent).toBe(
        strings[kind]
      )
      expect(route.router.replace).not.toHaveBeenCalled()
    }
  )
})

// app/signin.tsx reads the closed `google` parameter the cold callback route passes.
describe('U-CALLBACK-ROUTES: the cold callback outcome on /signin', () => {
  it.each(['refused', 'cancelled', 'unavailable'] as const)(
    'google=%s shows that outcome message',
    async (kind) => {
      await seed(false)
      route.params = { google: kind }
      await render(<SignInScreen />)
      expect((await screen.findByTestId('google-sign-in-status')).textContent).toBe(
        strings[kind]
      )
    }
  )

  it.each(['member', 'no_account', '<img src=x onerror=alert(1)>', 'continueWithGoogle'])(
    'google=%s is outside the closed set and shows nothing',
    async (value) => {
      await seed(false)
      route.params = { google: value }
      await render(<SignInScreen />)
      await screen.findByTestId('google-sign-in')
      expect(screen.queryByTestId('google-sign-in-status')).toBeNull()
      expect(document.body.textContent).not.toContain(value)
    }
  )
})

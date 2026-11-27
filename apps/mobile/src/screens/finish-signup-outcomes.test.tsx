// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 M lane (google-under13 device flow): an outcome the finish step reaches stays on
// screen. The under-13 refusal signs the identity out, and the teen guardian step keeps the
// identity; neither may be replaced by a later re-read of the identity (the device showed "Your
// Google sign-in has ended" in place of the age refusal). The route renders with its default
// seams, as on a device.
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import type * as ReactNativeModule from 'react-native'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n, { initI18n } from '../lib/i18n'

type Listener = { handler: () => boolean; removed: boolean }
const back = vi.hoisted(() => ({
  listeners: [] as { handler: () => boolean; removed: boolean }[],
  /** The registrations still in place, newest last, as Android dispatches them. */
  active() {
    return this.listeners.filter((entry) => !entry.removed)
  },
  /** Android calls the newest handler first and stops at the first that returns true. */
  press() {
    for (const entry of [...this.active()].reverse()) if (entry.handler()) return true
    return false
  },
}))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    BackHandler: {
      addEventListener: vi.fn((event: string, handler: () => boolean) => {
        const entry: Listener = { handler, removed: false }
        if (event === 'hardwareBackPress') back.listeners.push(entry)
        return {
          remove: () => {
            entry.removed = true
          },
        }
      }),
    },
  }
})

const flow = vi.hoisted(() => ({
  cancel: vi.fn<() => Promise<void>>(),
  finish: vi.fn(),
  read: vi.fn(),
  params: {} as Record<string, string>,
  router: { back: vi.fn(), replace: vi.fn(), push: vi.fn() },
  setOptions: vi.fn(),
  awaiting: vi.fn<(token: string) => Promise<string | null>>(),
  signOut: vi.fn<() => Promise<void>>(),
}))
vi.mock('@/src/lib/native-session', () => ({
  readNativeFederatedIdentity: flow.read,
  cancelNativeFederatedSignup: flow.cancel,
  finishNativeFederatedSignup: flow.finish,
  fetchNativeAwaitingGuardianAccount: flow.awaiting,
  signOutNativeSession: flow.signOut,
}))
vi.mock('expo-router', async () => ({
  router: flow.router,
  useRouter: () => flow.router,
  useLocalSearchParams: () => flow.params,
  useNavigation: () => ({ setOptions: flow.setOptions }),
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: 'America/Chicago' }],
  getLocales: () => [{ languageTag: 'en-US' }],
}))
import { createGuestPreviewStore, SAMPLE_CATALOG } from '@couture/utils'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import { setMobileGuestPreviewStoreForTests } from '@/src/lib/guest-preview-store'
import SignupFinishRoute from '../../app/signup-finish'

async function submit(birthdate: string) {
  await render(
    <AccessibilityAnnouncerProvider>
      <SignupFinishRoute />
    </AccessibilityAnnouncerProvider>
  )
  const input = await screen.findByTestId('finish-signup-birthdate')
  await userEvent.fill(input, birthdate)
  await userEvent.click(screen.getByTestId('finish-signup-create'))
}

beforeAll(async () => {
  await initI18n()
  await i18n.changeLanguage('en-US')
})
beforeEach(() => {
  back.listeners = []
  flow.params = {}
  flow.read
    .mockReset()
    .mockResolvedValue({ accessToken: 'signed-google', email: 'n@synthetic.test' })
  flow.cancel.mockReset().mockResolvedValue(undefined)
  flow.finish.mockReset()
  flow.router.replace.mockReset()
  flow.router.push.mockReset()
  flow.router.back.mockReset()
  flow.setOptions.mockReset()
  // Most cases are a new identity: the finish step asks the birthdate.
  flow.awaiting.mockReset().mockResolvedValue(null)
  flow.signOut.mockReset().mockResolvedValue(undefined)
})

/** The header title the route last set. */
const headerTitle = () =>
  (flow.setOptions.mock.calls.at(-1)?.[0] as { title?: string } | undefined)?.title

describe('finish step outcomes', () => {
  it('keeps the under-13 refusal after the identity is signed out', async () => {
    flow.finish.mockImplementation(() => {
      // The refusal signs out locally: from here on there is no identity to read.
      flow.read.mockResolvedValue(null)
      return Promise.resolve({ kind: 'underage' })
    })
    await submit('2016-05-17')
    await waitFor(() =>
      expect(screen.getByTestId('finish-signup-outcome').textContent).toBe(
        'You must be 13 or older'
      )
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(screen.getByTestId('finish-signup-outcome').textContent).toBe(
      'You must be 13 or older'
    )
    expect(flow.read).toHaveBeenCalledTimes(1)
    // The refusal is no longer the finish step: the header drops its title.
    expect(headerTitle()).toBe('')
  })

  it('keeps the guardian step for a teen while the identity stays signed in', async () => {
    flow.finish.mockResolvedValue({
      kind: 'created',
      account: {
        userId: 'teen-1',
        age: 14,
        accountStatus: 'pending_guardian_consent',
        guardianConsentRequired: true,
      },
    })
    await submit('2012-05-17')
    await screen.findByTestId('finish-signup-outcome')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(screen.queryByTestId('finish-signup-birthdate')).toBeNull()
    expect(screen.getByTestId('finish-signup-outcome').textContent).toMatch(
      /guardian must approve/
    )
    expect(flow.read).toHaveBeenCalledTimes(1)
    // The account exists: the header names the guardian wait instead of finishing it.
    expect(headerTitle()).toBe('Waiting for your guardian')
  })
})

// TEA sign-off F-2 (guardian consent off): the server creates a 13 to 15 year old active with
// no guardian, and the screen keys on that answer alone, never on the age it carries.
describe('M-OFF-TEEN-CREATED: an active 13 to 15 account goes straight in', () => {
  it('leaves for home with no guardian step', async () => {
    const store = createGuestPreviewStore({
      adapter: {
        read: () => Promise.resolve(null),
        write: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      catalog: SAMPLE_CATALOG,
    })
    setMobileGuestPreviewStoreForTests(store)
    try {
      flow.finish.mockResolvedValue({
        kind: 'created',
        account: {
          userId: 'teen-off-1',
          age: 14,
          accountStatus: 'active',
          guardianConsentRequired: false,
        },
      })
      await submit('2012-05-17')
      await waitFor(() => expect(flow.router.replace).toHaveBeenCalledWith('/'))
      expect(flow.router.replace).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('guardian-invite-email')).toBeNull()
      expect(screen.queryByTestId('guardian-step-continue')).toBeNull()
      expect(screen.queryByText('Waiting for your guardian')).toBeNull()
      expect(
        flow.setOptions.mock.calls.map(([options]) => options as { title?: string })
      ).not.toContainEqual({ title: 'Waiting for your guardian' })
    } finally {
      setMobileGuestPreviewStoreForTests(undefined)
    }
  })
})

describe('finish step form', () => {
  it('titles the header while the form shows', async () => {
    await render(
      <AccessibilityAnnouncerProvider>
        <SignupFinishRoute />
      </AccessibilityAnnouncerProvider>
    )
    await screen.findByTestId('finish-signup-birthdate')
    expect(headerTitle()).toBe('Finish setup')
  })

  // TEA sign-off: replaces the 13 to 15 guardian hint, which policy off removed, with the one
  // guidance message a typed date still has, so the error-versus-hint split stays proven.
  it('shows an under-13 birthdate as an error alert and a malformed date as a hint', async () => {
    await render(
      <AccessibilityAnnouncerProvider>
        <SignupFinishRoute />
      </AccessibilityAnnouncerProvider>
    )
    const input = await screen.findByTestId('finish-signup-birthdate')
    await userEvent.fill(input, '2016-05-17')
    const underage = await screen.findByTestId('finish-signup-inline-message')
    expect(underage.getAttribute('role')).toBe('alert')
    const errorColor = getComputedStyle(underage).color
    await userEvent.fill(input, '2012-13-45')
    await waitFor(() =>
      expect(screen.getByTestId('finish-signup-inline-message').textContent).toBe(
        'Enter your birthdate as YYYY-MM-DD'
      )
    )
    const hint = screen.getByTestId('finish-signup-inline-message')
    expect(hint.getAttribute('role')).toBeNull()
    expect(getComputedStyle(hint).color).not.toBe(errorColor)
  })

  // Guardian consent is off (owner ruling 2026-11-16): a teen birthdate clears the alert and
  // shows nothing, since the guardian message was the only guidance a valid date had.
  it('shows an under-13 birthdate as an error alert and clears it for a teen', async () => {
    await render(
      <AccessibilityAnnouncerProvider>
        <SignupFinishRoute />
      </AccessibilityAnnouncerProvider>
    )
    const input = await screen.findByTestId('finish-signup-birthdate')
    await userEvent.fill(input, '2016-05-17')
    const underage = await screen.findByTestId('finish-signup-inline-message')
    expect(underage.getAttribute('role')).toBe('alert')
    await userEvent.fill(input, '2012-05-17')
    await waitFor(() =>
      expect(screen.queryByTestId('finish-signup-inline-message')).toBeNull()
    )
  })
})

// Antigravity P2-1, D3: an age refusal clears any guest preview stored on this device, whichever
// door started the round trip, and Continue leaves only once that removal is written.
describe('under-13 refusal and the stored guest preview', () => {
  it.each<Record<string, string>>([{}, { from: 'preview' }])(
    'clears it with params %j before Continue',
    async (params) => {
      let value: string | null = null
      let finishRemove: () => void = () => undefined
      const adapter = {
        read: () => Promise.resolve(value),
        write: (text: string) => {
          value = text
          return Promise.resolve()
        },
        remove: () =>
          new Promise<void>((resolve) => {
            finishRemove = () => {
              value = null
              resolve()
            }
          }),
      }
      const store = createGuestPreviewStore({ adapter, catalog: SAMPLE_CATALOG })
      setMobileGuestPreviewStoreForTests(store)
      store.start()
      store.update((state) => ({
        ...state,
        conversion: { intent: 'guest-preview-carryover' },
      }))
      await store.flush()
      expect(value).not.toBeNull()

      flow.params = params
      flow.finish.mockResolvedValue({ kind: 'underage' })
      await submit('2016-05-17')
      await screen.findByTestId('finish-signup-outcome')
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(flow.router.replace).not.toHaveBeenCalled()
      finishRemove()
      await waitFor(() => expect(flow.router.replace).toHaveBeenCalledWith('/'))
      expect(value).toBeNull()
      setMobileGuestPreviewStoreForTests(undefined)
    }
  )
})

// Owner's production loop (2026-11-15): a returning teen the guardian lock refuses gets the
// guardian invitation, and leaving the step ends the session before going home.
describe('a returning teen waiting on a guardian', () => {
  it('shows the guardian invitation and Sign out ends the session, then goes home', async () => {
    flow.awaiting.mockResolvedValue('teen-pending-1')
    let settle: () => void = () => undefined
    flow.signOut.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve
      })
    )
    await render(
      <AccessibilityAnnouncerProvider>
        <SignupFinishRoute />
      </AccessibilityAnnouncerProvider>
    )
    await waitFor(() =>
      expect(screen.getByTestId('finish-signup-outcome').textContent).toBe(
        'Your guardian still needs to approve your account. Send the invite, then sign in after they approve.'
      )
    )
    expect(flow.awaiting).toHaveBeenCalledWith('signed-google')
    expect(screen.queryByTestId('finish-signup-birthdate')).toBeNull()
    await waitFor(() => expect(headerTitle()).toBe('Waiting for your guardian'))
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(flow.signOut).toHaveBeenCalledTimes(1))
    expect(flow.router.replace).not.toHaveBeenCalled()
    settle()
    await waitFor(() => expect(flow.router.replace).toHaveBeenCalledWith('/'))
  })
})

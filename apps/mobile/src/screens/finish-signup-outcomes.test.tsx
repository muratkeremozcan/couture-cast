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
}))
vi.mock('@/src/lib/native-session', () => ({
  readNativeFederatedIdentity: flow.read,
  cancelNativeFederatedSignup: flow.cancel,
  finishNativeFederatedSignup: flow.finish,
}))
vi.mock('expo-router', async () => ({
  router: flow.router,
  useRouter: () => flow.router,
  useLocalSearchParams: () => flow.params,
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: 'America/Chicago' }],
  getLocales: () => [{ languageTag: 'en-US' }],
}))
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
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
})

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
        'You must be 13 or older to use CoutureCast.'
      )
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(screen.getByTestId('finish-signup-outcome').textContent).toBe(
      'You must be 13 or older to use CoutureCast.'
    )
    expect(flow.read).toHaveBeenCalledTimes(1)
  })

  it('keeps the guardian step for a teen while the identity stays signed in', async () => {
    flow.finish.mockResolvedValue({
      kind: 'created',
      account: { userId: 'teen-1', guardianConsentRequired: true },
    })
    await submit('2012-05-17')
    await screen.findByTestId('finish-signup-outcome')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(screen.queryByTestId('finish-signup-birthdate')).toBeNull()
    expect(screen.getByTestId('finish-signup-outcome').textContent).toMatch(
      /guardian needs to approve/
    )
    expect(flow.read).toHaveBeenCalledTimes(1)
  })
})

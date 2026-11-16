// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA sign-off: M-RESUME Android Back (D3, finding 1 ruling). Hardware Back on the
// open finish step is Cancel: the event is consumed, the waiting identity is cancelled exactly
// once, and the step leaves to the door, so Home never shows only to push the step straight back.
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import type * as ReactNativeModule from 'react-native'
import { act, screen, waitFor } from '@testing-library/react'
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
  read: vi.fn(),
  params: {} as Record<string, string>,
  router: { back: vi.fn(), replace: vi.fn(), push: vi.fn() },
}))
vi.mock('@/src/lib/native-session', () => ({
  readNativeFederatedIdentity: flow.read,
  cancelNativeFederatedSignup: flow.cancel,
  finishNativeFederatedSignup: vi.fn(),
  // No teen waits on a guardian here; the finish step asks the birthdate.
  fetchNativeAwaitingGuardianAccount: () => Promise.resolve(null),
}))
vi.mock('expo-router', async () => ({
  router: flow.router,
  useRouter: () => flow.router,
  useLocalSearchParams: () => flow.params,
  useNavigation: () => ({ setOptions: vi.fn() }),
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: 'America/Chicago' }],
  getLocales: () => [{ languageTag: 'en-US' }],
}))
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import SignupFinishRoute from '../../app/signup-finish'

async function openFinishStep() {
  const view = await render(
    <AccessibilityAnnouncerProvider>
      <SignupFinishRoute />
    </AccessibilityAnnouncerProvider>
  )
  await screen.findByTestId('finish-signup-birthdate')
  // Passive effects run after the form commits; exactly one Back handler stays registered.
  await waitFor(() => expect(back.active()).toHaveLength(1))
  return view
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
  flow.router.replace.mockReset()
  flow.router.push.mockReset()
  flow.router.back.mockReset()
})

describe('Android Back on the finish step', () => {
  it('is consumed and cancels the waiting identity once, then leaves for /signin', async () => {
    await openFinishStep()
    let consumed = false
    act(() => {
      consumed = back.press()
    })
    expect(consumed).toBe(true)
    await waitFor(() => expect(flow.router.replace).toHaveBeenCalledWith('/signin'))
    expect(flow.cancel).toHaveBeenCalledTimes(1)
    expect(flow.router.back).not.toHaveBeenCalled()
    expect(flow.router.push).not.toHaveBeenCalled()
    expect(flow.router.replace).not.toHaveBeenCalledWith('/')
  })

  it('a second press while the cancel runs is consumed and cancels nothing more', async () => {
    let finishCancel: () => void = () => undefined
    flow.cancel.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCancel = resolve
        })
    )
    await openFinishStep()
    act(() => {
      expect(back.press()).toBe(true)
    })
    await waitFor(() => expect(flow.cancel).toHaveBeenCalledTimes(1))
    act(() => {
      expect(back.press()).toBe(true)
    })
    expect(flow.cancel).toHaveBeenCalledTimes(1)
    expect(flow.router.replace).not.toHaveBeenCalled()
    await act(async () => {
      finishCancel()
      await Promise.resolve()
    })
    await waitFor(() => expect(flow.router.replace).toHaveBeenCalledTimes(1))
    expect(flow.router.replace).toHaveBeenCalledWith('/signin')
  })

  // D5 (the web TEA ruling, Antigravity P1-1): Back returns to the door that started the round
  // trip, which keeps the preview hint and its Back to preview link.
  it.each([
    [{ from: 'preview' }, '/signin?from=preview'],
    [{ door: 'signup' }, '/signup'],
    [{ door: 'signup', from: 'preview' }, '/signup?from=preview'],
  ])('Back with %j cancels and returns to %s', async (params, destination) => {
    flow.params = params
    await openFinishStep()
    act(() => {
      expect(back.press()).toBe(true)
    })
    await waitFor(() => expect(flow.router.replace).toHaveBeenCalledWith(destination))
    expect(flow.cancel).toHaveBeenCalledTimes(1)
  })

  it('stops answering Back once the step unmounts', async () => {
    const view = await openFinishStep()
    await view.unmount()
    expect(back.active()).toEqual([])
  })
})

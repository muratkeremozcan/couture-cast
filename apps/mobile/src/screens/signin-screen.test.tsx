/* eslint-disable @typescript-eslint/await-thenable */
// Story 6.5: native sign-in tells denial, a wrong code and a temporary failure apart.
import { fireEvent, screen } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n, { initI18n } from '../lib/i18n'

const auth = vi.hoisted(() => ({ request: vi.fn(), verify: vi.fn() }))
vi.mock('../lib/native-session', () => ({
  requestNativeOtp: auth.request,
  verifyNativeOtp: auth.verify,
}))
vi.mock('expo-router', () => ({ router: { back: vi.fn() } }))
vi.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: 'America/Chicago' }],
  getLocales: () => [{ languageTag: 'en-US' }],
}))
import { NativeSignInError } from '../lib/native-signin-error'
import SignInScreen from '../../app/signin'

const label = (key: string) => i18n.t(`community.notifications.${key}`)

beforeAll(async () => {
  await initI18n()
  await i18n.changeLanguage('en-US')
})
beforeEach(() => {
  auth.request.mockReset().mockResolvedValue(undefined)
  auth.verify.mockReset().mockResolvedValue(undefined)
})

async function submitCode() {
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

describe('native sign-in failures', () => {
  it.each([
    ['denied', 'signinDenied'],
    ['code_invalid', 'signinCodeInvalid'],
    ['unavailable', 'signinUnavailable'],
  ] as const)('shows the %s message, never the settings failure', async (reason, key) => {
    auth.verify.mockRejectedValueOnce(new NativeSignInError(reason, 'Sign-in failed.'))
    await submitCode()
    await screen.findByText(label(key))
    expect(screen.queryByText(label('failed'))).toBeNull()
  })

  it('treats a code that could not be sent, or any unclassified failure, as temporary', async () => {
    auth.request.mockRejectedValueOnce(new TypeError('Network request failed'))
    await render(<SignInScreen />)
    fireEvent.change(screen.getByLabelText(label('email')), {
      target: { value: 'member@example.test' },
    })
    fireEvent.click(screen.getByText(label('sendCode')))
    await screen.findByText(label('signinUnavailable'))
  })
})

// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getI18n } from '../../i18n'
import type * as WebSession from '../../lib/web-session'
const auth = vi.hoisted(() => ({ request: vi.fn(), verify: vi.fn() }))
vi.mock('../../lib/web-session', async (importOriginal) => ({
  WebSignInError: (await importOriginal<typeof WebSession>()).WebSignInError,
  requestWebOtp: auth.request,
  verifyWebOtp: auth.verify,
}))
import { WebSignInError } from '../../lib/web-session'
import SignInPage from './page'
const label = (key: string) => getI18n().t(`community.notifications.${key}`)
beforeEach(async () => {
  await getI18n().changeLanguage('en-US')
  auth.request.mockResolvedValue(undefined)
  auth.verify.mockResolvedValue(undefined)
})
describe('OTP sign-in recovery', () => {
  it('keeps email entry retryable after send failure and verifies the entered code on retry', async () => {
    auth.request.mockRejectedValueOnce(
      new WebSignInError('unavailable', 'Sign-in could not be started.')
    )
    render(<SignInPage />)
    fireEvent.change(screen.getByLabelText(label('email')), {
      target: { value: 'member@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: label('sendCode') }))
    await screen.findByText(label('signinUnavailable'))
    expect(screen.queryByText(label('failed'))).toBeNull()
    expect(screen.getByLabelText(label('email'))).toBeEnabled()
    expect(screen.queryByLabelText(label('code'))).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: label('sendCode') }))
    const code = await screen.findByLabelText(label('code'))
    expect(screen.getByLabelText(label('email'))).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(label('codeSent'))
    auth.verify.mockRejectedValueOnce(
      new WebSignInError('code_invalid', 'Sign-in code could not be verified.')
    )
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: label('verify') }))
    await screen.findByText(label('signinCodeInvalid'))
    expect(auth.verify).toHaveBeenCalledWith('member@example.test', '123456')
    expect(code).toHaveValue('123456')
    fireEvent.change(code, { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: label('verify') }))
    await waitFor(() =>
      expect(auth.verify).toHaveBeenLastCalledWith('member@example.test', '654321')
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: label('verify') })).toBeEnabled()
    )
    expect(auth.request).toHaveBeenCalledTimes(2)
  })
  it('disables repeated submission while issuance is pending', async () => {
    let release!: () => void
    auth.request.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve
      })
    )
    render(<SignInPage />)
    fireEvent.change(screen.getByLabelText(label('email')), {
      target: { value: 'pending@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: label('sendCode') }))
    expect(screen.getByRole('button', { name: label('sendCode') })).toBeDisabled()
    expect(screen.getByLabelText(label('email'))).toBeDisabled()
    release()
    await screen.findByLabelText(label('code'))
    expect(auth.request).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['denied', 'signinDenied'],
    ['unavailable', 'signinUnavailable'],
  ] as const)('tells a %s sign-in apart from a settings failure', async (reason, key) => {
    auth.verify.mockRejectedValueOnce(new WebSignInError(reason, 'Sign-in failed.'))
    render(<SignInPage />)
    fireEvent.change(screen.getByLabelText(label('email')), {
      target: { value: 'member@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: label('sendCode') }))
    fireEvent.change(await screen.findByLabelText(label('code')), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: label('verify') }))
    await screen.findByText(label(key))
    expect(screen.queryByText(label('failed'))).toBeNull()
    // The three outcomes read differently, so a person knows whether to retry.
    expect(
      new Set([
        label('signinDenied'),
        label('signinUnavailable'),
        label('signinCodeInvalid'),
      ]).size
    ).toBe(3)
  })
  it('treats an unclassified failure as temporary', async () => {
    auth.request.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<SignInPage />)
    fireEvent.change(screen.getByLabelText(label('email')), {
      target: { value: 'member@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: label('sendCode') }))
    await screen.findByText(label('signinUnavailable'))
  })
})

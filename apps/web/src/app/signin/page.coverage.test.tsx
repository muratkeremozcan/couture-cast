import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getI18n } from '../../i18n'
const auth = vi.hoisted(() => ({ request: vi.fn(), verify: vi.fn() }))
vi.mock('../../lib/web-session', () => ({
  requestWebOtp: auth.request,
  verifyWebOtp: auth.verify,
}))
import SignInPage from './page'
const label = (key: string) => getI18n().t(`community.notifications.${key}`)
beforeEach(async () => {
  await getI18n().changeLanguage('en-US')
  auth.request.mockResolvedValue(undefined)
  auth.verify.mockResolvedValue(undefined)
})
describe('OTP sign-in recovery', () => {
  it('keeps email entry retryable after send failure and verifies the entered code on retry', async () => {
    auth.request.mockRejectedValueOnce(new Error('mail unavailable'))
    render(<SignInPage />)
    fireEvent.change(screen.getByLabelText(label('email')), {
      target: { value: 'member@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: label('sendCode') }))
    await screen.findByText(label('failed'))
    expect(screen.getByLabelText(label('email'))).toBeEnabled()
    expect(screen.queryByLabelText(label('code'))).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: label('sendCode') }))
    const code = await screen.findByLabelText(label('code'))
    expect(screen.getByLabelText(label('email'))).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(label('codeSent'))
    auth.verify.mockRejectedValueOnce(new Error('code expired'))
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: label('verify') }))
    await screen.findByText(label('failed'))
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
})

// Story 6.16 D8: signup from the guest preview keeps a way back and continues to a
// verified sign-in. The signup response itself never authenticates anyone.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GUEST_PREVIEW_STRINGS } from '@couture/utils'

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('expo-router', () => ({
  router: navigation,
  useLocalSearchParams: () => ({ from: 'preview' }),
}))
import SignupRoute from '../../../app/signup'
import { SignupScreen } from './signup-screen'

const detail = GUEST_PREVIEW_STRINGS['en-US'].conversionDetail

function fill() {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'guest@example.com' },
  })
  fireEvent.change(screen.getByLabelText('Birthdate'), {
    target: { value: '2000-04-15' },
  })
  fireEvent.click(screen.getByLabelText('Create account'))
}

describe('mobile signup from the guest preview', () => {
  it('shows Back to preview, then Sign in to continue once the account exists', async () => {
    const submitSignup = vi.fn().mockResolvedValue({
      userId: 'user-123',
      age: 26,
      accountStatus: 'active',
      guardianConsentRequired: false,
    })
    const navigate = vi.fn()
    render(
      <SignupScreen
        submitSignup={submitSignup}
        fromPreview
        onPreviewNavigate={navigate}
      />
    )
    fireEvent.click(screen.getByTestId('signup-back-to-preview'))
    expect(navigate).toHaveBeenCalledWith('/preview')
    expect(screen.queryByTestId('signup-sign-in-to-continue')).toBeNull()
    fill()
    const next = await screen.findByTestId('signup-sign-in-to-continue')
    expect(next.textContent).toBe(detail.signInToContinue)
    fireEvent.click(next)
    expect(navigate).toHaveBeenCalledWith('/signin?from=preview')
  })

  it('continues for a teen awaiting guardian consent too', async () => {
    const submitSignup = vi.fn().mockResolvedValue({
      userId: 'teen-1',
      age: 14,
      accountStatus: 'pending_guardian_consent',
      guardianConsentRequired: true,
    })
    render(<SignupScreen submitSignup={submitSignup} fromPreview />)
    fill()
    await waitFor(() =>
      expect(screen.getByTestId('signup-sign-in-to-continue')).toBeTruthy()
    )
  })

  it('passes the exact literal from the route and navigates through the router', () => {
    const { unmount } = render(<SignupRoute />)
    fireEvent.click(screen.getByTestId('signup-back-to-preview'))
    expect(navigation.replace).toHaveBeenCalledWith('/preview')
    unmount()
    render(<SignupScreen submitSignup={vi.fn()} />)
    expect(screen.queryByTestId('signup-back-to-preview')).toBeNull()
  })
})

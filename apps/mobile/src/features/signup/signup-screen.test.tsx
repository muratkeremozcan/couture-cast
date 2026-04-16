import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SignupScreen } from './signup-screen'

describe('SignupScreen', () => {
  it('shows the under-13 message before submitting', () => {
    render(<SignupScreen submitSignup={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2016-04-16' },
    })

    expect(screen.getByTestId('signup-inline-message').textContent).toBe(
      'You must be 13 or older'
    )
  })

  it('shows the guardian consent message for ages thirteen through fifteen', () => {
    render(<SignupScreen submitSignup={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2011-04-15' },
    })

    expect(screen.getByTestId('signup-inline-message').textContent).toBe(
      'Guardian consent required'
    )
  })

  it('submits eligible signups and shows the success state', async () => {
    const submitSignup = vi.fn().mockResolvedValue({
      userId: 'user-123',
      age: 16,
      accountStatus: 'active',
      guardianConsentRequired: false,
    })

    render(<SignupScreen submitSignup={submitSignup} />)

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'eligible@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2010-04-15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(submitSignup).toHaveBeenCalledWith({
        email: 'eligible@example.com',
        birthdate: '2010-04-15',
      })
    })
    expect(screen.getByTestId('signup-success-message').textContent).toBe(
      'Account created. You can continue to onboarding.'
    )
  })
})

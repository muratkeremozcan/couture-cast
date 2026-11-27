// Story 6.16 D8: signup from the guest preview keeps a way back and continues to a
// verified sign-in. The signup response itself never authenticates anyone.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createGuestPreviewStore,
  GUEST_PREVIEW_STRINGS,
  SAMPLE_CATALOG,
} from '@couture/utils'

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('expo-router', () => ({
  router: navigation,
  useLocalSearchParams: () => ({ from: 'preview' }),
}))
import SignupRoute from '../../../app/signup'
import { setMobileGuestPreviewStoreForTests } from '../../lib/guest-preview-store'
import { SignupRefusedError } from '../../lib/signup'
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

/** A started preview in memory; `stored()` reads what the adapter holds. */
async function startedPreview() {
  let value: string | null = null
  const store = createGuestPreviewStore({
    catalog: SAMPLE_CATALOG,
    adapter: {
      read: () => Promise.resolve(value),
      write: (text) => {
        value = text
        return Promise.resolve()
      },
      remove: () => {
        value = null
        return Promise.resolve()
      },
    },
  })
  setMobileGuestPreviewStoreForTests(store)
  store.start()
  await store.flush()
  return { stored: () => value }
}

describe('mobile signup from the guest preview', () => {
  it('shows Back to preview, then Sign in once the account exists', async () => {
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

  it('discards the preview when the client age check refuses the visitor', async () => {
    const preview = await startedPreview()
    const submitSignup = vi.fn()
    render(<SignupScreen submitSignup={submitSignup} fromPreview />)
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'kid@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2020-01-01' },
    })
    fireEvent.click(screen.getByLabelText('Create account'))
    await waitFor(() => expect(preview.stored()).toBeNull())
    expect(submitSignup).not.toHaveBeenCalled()
    setMobileGuestPreviewStoreForTests(undefined)
  })

  it('discards the preview when the server refuses the visitor (E-GATE-SERVER-WINS)', async () => {
    const preview = await startedPreview()
    const submitSignup = vi
      .fn()
      .mockRejectedValue(new SignupRefusedError('You must be 13 or older'))
    render(<SignupScreen submitSignup={submitSignup} fromPreview />)
    fill()
    await screen.findByText('You must be 13 or older')
    await waitFor(() => expect(preview.stored()).toBeNull())
    setMobileGuestPreviewStoreForTests(undefined)
  })

  it('keeps the preview after a signup failure the visitor can retry', async () => {
    const preview = await startedPreview()
    const submitSignup = vi.fn().mockRejectedValue(new Error('Email already registered'))
    render(<SignupScreen submitSignup={submitSignup} fromPreview />)
    fill()
    await screen.findByText('Email already registered')
    expect(preview.stored()).not.toBeNull()
    setMobileGuestPreviewStoreForTests(undefined)
  })
})

// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 D8: signup from the guest preview keeps a way back and continues to a
// verified sign-in. The signup response itself never authenticates anyone.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): the top bar's history-aware back reads the router (D11).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type * as NextNavigation from 'next/navigation'
import {
  createGuestPreviewStore,
  GUEST_PREVIEW_STRINGS,
  SAMPLE_CATALOG,
} from '@couture/utils'
import { setWebGuestPreviewStoreForTests } from '../../lib/guest-preview'
import { SignupRefusedError } from '../../lib/signup'
import SignupPage from './page'
import { SignupForm } from './signup-form'

// Story CC-7.11 D11: the top bar's back reads the router. Outside a mounted app router the real
// hook throws, so the test supplies one and keeps the rest of next/navigation.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof NextNavigation>()),
  useRouter: () => ({
    back: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

const detail = GUEST_PREVIEW_STRINGS['en-US'].conversionDetail

function fill() {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'guest@example.com' },
  })
  fireEvent.change(screen.getByLabelText('Birthdate'), {
    target: { value: '2000-04-15' },
  })
  fireEvent.submit(screen.getByRole('button', { name: 'Create account' }))
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
  setWebGuestPreviewStoreForTests(store)
  store.start()
  await store.flush()
  return { stored: () => value }
}

describe('signup from the guest preview', () => {
  it('shows Back to preview, then Sign in to continue after the account is created', async () => {
    const submitSignup = vi.fn().mockResolvedValue({
      userId: 'user-123',
      age: 26,
      accountStatus: 'active',
      guardianConsentRequired: false,
    })
    render(<SignupForm submitSignup={submitSignup} fromPreview />)
    expect(screen.getByTestId('signup-back-to-preview').getAttribute('href')).toBe(
      '/preview'
    )
    expect(screen.queryByTestId('signup-sign-in-to-continue')).toBeNull()
    fill()
    const next = await screen.findByTestId('signup-sign-in-to-continue')
    expect(next.textContent).toBe(detail.signInToContinue)
    expect(next.getAttribute('href')).toBe('/signin?from=preview')
  })

  it('also continues to sign-in for a teen awaiting guardian consent', async () => {
    const submitSignup = vi.fn().mockResolvedValue({
      userId: 'teen-1',
      age: 14,
      accountStatus: 'pending_guardian_consent',
      guardianConsentRequired: true,
    })
    render(<SignupForm submitSignup={submitSignup} fromPreview />)
    fill()
    await waitFor(() =>
      expect(screen.getByTestId('signup-sign-in-to-continue')).toBeInTheDocument()
    )
  })

  it('keeps the preview reachable after a failed signup', async () => {
    const submitSignup = vi.fn().mockRejectedValue(new Error('Email already registered'))
    render(<SignupForm submitSignup={submitSignup} fromPreview />)
    fill()
    await screen.findByText('Email already registered')
    expect(screen.getByTestId('signup-back-to-preview')).toBeInTheDocument()
    expect(screen.queryByTestId('signup-sign-in-to-continue')).toBeNull()
  })

  it('discards the preview when the client age check refuses the visitor', async () => {
    const preview = await startedPreview()
    const submitSignup = vi.fn()
    render(<SignupForm submitSignup={submitSignup} fromPreview />)
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'kid@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Birthdate'), {
      target: { value: '2020-01-01' },
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(preview.stored()).toBeNull())
    expect(submitSignup).not.toHaveBeenCalled()
    setWebGuestPreviewStoreForTests(undefined)
  })

  it('discards the preview when the server refuses the visitor (E-GATE-SERVER-WINS)', async () => {
    const preview = await startedPreview()
    const submitSignup = vi
      .fn()
      .mockRejectedValue(new SignupRefusedError('You must be 13 or older'))
    render(<SignupForm submitSignup={submitSignup} fromPreview />)
    fill()
    await screen.findByText('You must be 13 or older')
    await waitFor(() => expect(preview.stored()).toBeNull())
    setWebGuestPreviewStoreForTests(undefined)
  })

  it('keeps the preview after a signup failure the visitor can retry', async () => {
    const preview = await startedPreview()
    const submitSignup = vi.fn().mockRejectedValue(new Error('Email already registered'))
    render(<SignupForm submitSignup={submitSignup} fromPreview />)
    fill()
    await screen.findByText('Email already registered')
    expect(preview.stored()).not.toBeNull()
    setWebGuestPreviewStoreForTests(undefined)
  })

  it('shows no preview links without from=preview', async () => {
    render(await SignupPage({ searchParams: Promise.resolve({ from: 'Preview' }) }))
    expect(screen.queryByTestId('signup-back-to-preview')).toBeNull()
  })

  it('passes the exact literal through the page', async () => {
    render(await SignupPage({ searchParams: Promise.resolve({ from: 'preview' }) }))
    expect(screen.getByTestId('signup-back-to-preview')).toBeInTheDocument()
  })
})

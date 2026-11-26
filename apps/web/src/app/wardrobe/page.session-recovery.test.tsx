// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-CLOSET-007 (D5, D6: setup progress and Silhouette moved
// into the Closet More menu, so the recovered reads show there).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Pre-existing bug found by the real-session AS-0 (2026-11-19): the Wardrobe hub and the guided
// onboarding read the bearer once at mount and never retried, so a mount before this tab held a
// verified bearer stayed on "Your session expired" with Silhouette disabled. A failed mount read
// now reads again when the verified identity is published (`couture:session` with a member).
// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screenSnapshot } from '../../lib/screen-snapshot'
import type {
  GarmentItemContract,
  SilhouetteProfileContract,
  WardrobeOnboardingStateContract,
} from '@couture/api-client/contracts/http'
import type * as WebSession from '../../lib/web-session'

const SIGNED_OUT_MESSAGE = 'Your session expired. Sign in again before adding a garment.'

const wardrobe = vi.hoisted(() => ({
  listGarmentsFromWeb: vi.fn<(signal?: AbortSignal) => Promise<GarmentItemContract[]>>(),
  getOnboardingStateFromWeb:
    vi.fn<(signal?: AbortSignal) => Promise<WardrobeOnboardingStateContract>>(),
  resolveCurrentUserId: vi.fn<() => Promise<string>>(),
  getSilhouetteProfileFromWeb:
    vi.fn<(signal?: AbortSignal) => Promise<SilhouetteProfileContract>>(),
}))
/** The verified member the session layer reports; the page under test only reads it. */
const session = vi.hoisted(() => ({ member: null as string | null }))

const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
  forward: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/wardrobe',
  // Story 7.5: the closet reads the open garment from useSearchParams, which Next keeps in sync
  // with native History API calls and Back/Forward. This stand-in does the same for jsdom.
  useSearchParams: () => useMockSearchParams(),
}))

/** A useSearchParams stand-in that re-renders on pushState, replaceState and popstate. */
function useMockSearchParams() {
  const search = useSyncExternalStore(
    (onChange) => {
      window.addEventListener('popstate', onChange)
      window.addEventListener('test:history', onChange)
      return () => {
        window.removeEventListener('popstate', onChange)
        window.removeEventListener('test:history', onChange)
      }
    },
    () => window.location.search,
    () => ''
  )
  return new URLSearchParams(search)
}
for (const method of ['pushState', 'replaceState'] as const) {
  const original = window.history[method].bind(window.history)
  window.history[method] = (...args: Parameters<History['pushState']>) => {
    original(...args)
    window.dispatchEvent(new Event('test:history'))
  }
}

vi.mock('../../lib/wardrobe', () => ({
  ...wardrobe,
  advanceOnboardingStepFromWeb: vi.fn(),
  uploadGarmentImageFromWeb: vi.fn(),
  suggestGarmentTagsFromWeb: vi.fn(),
  updateGarmentTagsFromWeb: vi.fn(),
  updateSilhouetteSlidersFromWeb: vi.fn(),
  uploadMyFormPhotoFromWeb: vi.fn(),
  deleteMyFormPhotoFromWeb: vi.fn(),
  onboardingETag: (userId: string, revision: number) =>
    `"onboarding:${userId}:${revision}"`,
  silhouetteETag: (userId: string, revision: number) =>
    `"silhouette:${userId}:${revision}"`,
  isStaleRevisionError: () => false,
  generateIdempotencyKey: () => 'test-idempotency-key',
}))
// The real identity publication (`onWebSessionIdentity`) runs; only the member it reports is set.
vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.member,
}))

import WardrobePage from './page'
import WardrobeOnboardingPage from './onboarding/page'

function inProgress(): WardrobeOnboardingStateContract {
  return {
    status: 'in_progress',
    currentStep: 'silhouette',
    usedStarterWardrobe: true,
    garmentsCapturedCount: 0,
    startedAt: '2026-11-19T09:00:00.000Z',
    completedAt: null,
    revision: 2,
  }
}
function completed(): WardrobeOnboardingStateContract {
  return {
    status: 'completed',
    currentStep: 'complete',
    usedStarterWardrobe: true,
    garmentsCapturedCount: 0,
    startedAt: '2026-11-19T09:00:00.000Z',
    completedAt: '2026-11-19T09:30:00.000Z',
    revision: 3,
  }
}
/** Story CC-7.11 D5: opens the Closet top bar More menu if it is closed. */
function openMore() {
  const more = screen.getByTestId('closet-more-menu')
  if (more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more)
}
function silhouetteProfile(): SilhouetteProfileContract {
  return {
    mode: 'default_mannequin',
    heightSlider: 50,
    buildSlider: 50,
    myForm: null,
    revision: 0,
    updatedAt: '2026-11-19T09:00:00.000Z',
  }
}
/** The session layer announces a verified (or a cleared) identity. */
function publishIdentity(member: string | null) {
  act(() => {
    session.member = member
    window.dispatchEvent(new Event('couture:session'))
  })
}
/** Every mount-time read fails once for want of a bearer, then succeeds. */
function signedOutAtMount() {
  wardrobe.resolveCurrentUserId
    .mockRejectedValueOnce(new Error(SIGNED_OUT_MESSAGE))
    .mockResolvedValue('member-a')
  wardrobe.getOnboardingStateFromWeb
    .mockRejectedValueOnce(new Error(SIGNED_OUT_MESSAGE))
    .mockResolvedValue(inProgress())
  wardrobe.listGarmentsFromWeb
    .mockRejectedValueOnce(new Error(SIGNED_OUT_MESSAGE))
    .mockResolvedValue([])
}

beforeEach(() => {
  // Story CC-7.7: the Closet keeps a per-member snapshot in module memory, so one test's closet
  // would open the next test's hub for the same member (CI, 61d7156e).
  screenSnapshot.clear()
  session.member = null
  for (const mock of Object.values(wardrobe)) mock.mockReset()
  wardrobe.getSilhouetteProfileFromWeb.mockResolvedValue(silhouetteProfile())
})
afterEach(() => cleanup())

describe('Step 58 follow-up: mount-time reads recover when the verified identity arrives', () => {
  it('the hub reads the account, setup progress and closet again once a member is published', async () => {
    signedOutAtMount()
    // CC-7.11 D5: the recovered progress is completed, so the More menu's setup item can only
    // read done once the second read lands.
    wardrobe.getOnboardingStateFromWeb.mockResolvedValue(completed())
    render(<WardrobePage />)

    expect(await screen.findByText(SIGNED_OUT_MESSAGE)).toBeInTheDocument()
    expect(await screen.findByText(/Unable to load your account, so/)).toBeInTheDocument()
    expect(
      await screen.findByText('Unable to check your closet setup progress.')
    ).toBeInTheDocument()
    // CC-7.11 D6: Silhouette is a route link in the More menu, never gated on the account read.
    expect(screen.queryByRole('button', { name: 'Silhouette' })).toBeNull()
    openMore()
    expect(screen.getByTestId('closet-more-silhouette')).toHaveAttribute(
      'href',
      '/wardrobe/silhouette'
    )
    expect(screen.getByTestId('closet-more-setup')).toHaveTextContent(/^Closet setup$/)

    // A publication with no member (verification still running, or a sign-out) reads nothing.
    publishIdentity(null)
    expect(wardrobe.resolveCurrentUserId).toHaveBeenCalledOnce()
    expect(wardrobe.listGarmentsFromWeb).toHaveBeenCalledOnce()

    publishIdentity('member-a')

    await waitFor(() =>
      expect(screen.queryByText(/Unable to load your account/)).not.toBeInTheDocument()
    )
    expect(await screen.findByText('No garments added yet')).toBeInTheDocument()
    openMore()
    await waitFor(() =>
      expect(screen.getByTestId('closet-more-setup')).toHaveTextContent(
        /^Closet setup: done$/
      )
    )
    expect(screen.queryByRole('link', { name: 'Set up your closet' })).toBeNull()
    expect(screen.queryByText(SIGNED_OUT_MESSAGE)).not.toBeInTheDocument()
    expect(screen.queryByText(/Unable to load your account/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('Unable to check your closet setup progress.')
    ).not.toBeInTheDocument()
    expect(wardrobe.resolveCurrentUserId).toHaveBeenCalledTimes(2)
    expect(wardrobe.getOnboardingStateFromWeb).toHaveBeenCalledTimes(2)
    expect(wardrobe.listGarmentsFromWeb).toHaveBeenCalledTimes(2)

    // Once recovered, a later publication (a token refresh) reads nothing again.
    publishIdentity('member-a')
    expect(wardrobe.listGarmentsFromWeb).toHaveBeenCalledTimes(2)
  })

  it('the guided onboarding reads its progress again once a member is published', async () => {
    wardrobe.resolveCurrentUserId
      .mockRejectedValueOnce(new Error(SIGNED_OUT_MESSAGE))
      .mockResolvedValue('member-a')
    wardrobe.getOnboardingStateFromWeb.mockResolvedValue(inProgress())
    render(<WardrobeOnboardingPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(SIGNED_OUT_MESSAGE)

    publishIdentity('member-a')

    expect(await screen.findByLabelText('Height')).toBeInTheDocument()
    expect(screen.queryByText(SIGNED_OUT_MESSAGE)).not.toBeInTheDocument()
    expect(wardrobe.resolveCurrentUserId).toHaveBeenCalledTimes(2)
  })
})

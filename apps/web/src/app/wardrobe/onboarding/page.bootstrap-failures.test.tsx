// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Story 4.4 Task 5 owner: unit-test the web wardrobe onboarding guided flow's
// bootstrap and step-advance failure paths. Split out of `page.test.tsx`
// (Claude's TEA test review on PR #120, story 4.4 tasks 8/9): that file had
// grown past this repo's 1000-line test-file ceiling with 3 independent
// describe blocks. Verbatim test bodies, no behavior change -- only the file
// boundary moved, and this file's preamble is trimmed to what only these
// tests use (no starter-wardrobe/tagging fixtures, no `WardrobeOnboardingPageForTests`
// poll-interval override, no `captureAndCommitGarment`/`CONFIRM_CHECKBOX_LABEL`).
// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  SilhouetteProfileContract,
  UpdateWardrobeOnboardingStateInput,
  WardrobeOnboardingStateContract,
} from '@couture/api-client/contracts/http'

const routerReplace = vi.fn()
const routerPush = vi.fn()

const globalRestorers: (() => void)[] = []

/** Mirrors garment-capture-modal.test.tsx's installCameraMock: capture the
 * original descriptor and restore it, rather than leaving `navigator.mediaDevices`
 * permanently overwritten for later tests/files. */
function installMediaDevicesMock(value: unknown) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value,
  })

  globalRestorers.push(() => {
    if (originalDescriptor) {
      Object.defineProperty(navigator, 'mediaDevices', originalDescriptor)
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices')
    }
  })
}

const {
  resolveCurrentUserId,
  getOnboardingStateFromWeb,
  advanceOnboardingStepFromWeb,
  listGarmentsFromWeb,
  uploadGarmentImageFromWeb,
  suggestGarmentTagsFromWeb,
  updateGarmentTagsFromWeb,
  getSilhouetteProfileFromWeb,
  updateSilhouetteSlidersFromWeb,
  uploadMyFormPhotoFromWeb,
  deleteMyFormPhotoFromWeb,
} = vi.hoisted(() => ({
  resolveCurrentUserId: vi.fn<() => Promise<string>>(),
  getOnboardingStateFromWeb:
    vi.fn<(signal?: AbortSignal) => Promise<WardrobeOnboardingStateContract>>(),
  advanceOnboardingStepFromWeb:
    vi.fn<
      (
        input: UpdateWardrobeOnboardingStateInput,
        ifMatch: string,
        signal?: AbortSignal
      ) => Promise<WardrobeOnboardingStateContract>
    >(),
  listGarmentsFromWeb: vi.fn<(signal?: AbortSignal) => Promise<GarmentItemContract[]>>(),
  uploadGarmentImageFromWeb: vi.fn(),
  suggestGarmentTagsFromWeb: vi.fn(),
  updateGarmentTagsFromWeb: vi.fn(),
  getSilhouetteProfileFromWeb:
    vi.fn<(signal?: AbortSignal) => Promise<SilhouetteProfileContract>>(),
  updateSilhouetteSlidersFromWeb: vi.fn(),
  uploadMyFormPhotoFromWeb: vi.fn(),
  deleteMyFormPhotoFromWeb: vi.fn(),
}))

function isStaleRevisionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('ONBOARDING_REVISION_MISMATCH') ||
      error.message.includes('SILHOUETTE_REVISION_MISMATCH'))
  )
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: routerPush }),
  usePathname: () => '/wardrobe/onboarding',
}))

vi.mock('../../../lib/wardrobe', () => ({
  WardrobeRequestError: class WardrobeRequestError extends Error {
    code?: string
    constructor(message: string, code?: string) {
      super(message)
      this.name = 'WardrobeRequestError'
      this.code = code
    }
  },
  resolveCurrentUserId,
  getOnboardingStateFromWeb,
  advanceOnboardingStepFromWeb,
  listGarmentsFromWeb,
  uploadGarmentImageFromWeb,
  suggestGarmentTagsFromWeb,
  updateGarmentTagsFromWeb,
  getSilhouetteProfileFromWeb,
  updateSilhouetteSlidersFromWeb,
  uploadMyFormPhotoFromWeb,
  deleteMyFormPhotoFromWeb,
  onboardingETag: (userId: string, revision: number) =>
    `"onboarding:${userId}:${revision}"`,
  silhouetteETag: (userId: string, revision: number) =>
    `"silhouette:${userId}:${revision}"`,
  isStaleRevisionError,
  generateIdempotencyKey: () => 'test-idempotency-key',
}))

import WardrobeOnboardingPage from './page'

const SIGNED_IN_USER = 'user-onboarding-1'

const STATE_STARTED_AT = '2026-08-04T09:00:00.000Z'
const STATE_COMPLETED_AT = '2026-08-04T09:30:00.000Z'

/**
 * The contract is a discriminated union, so spreading arbitrary overrides over a
 * single base can produce a state the server never emits (a `completed` status
 * with a null `completedAt`, say). Deriving the correlated fields from `status`
 * keeps every fixture a state that can actually occur.
 */
function state(
  overrides: {
    status?: WardrobeOnboardingStateContract['status']
    currentStep?: WardrobeOnboardingStateContract['currentStep']
    usedStarterWardrobe?: boolean
    garmentsCapturedCount?: number
    revision?: number
  } = {}
): WardrobeOnboardingStateContract {
  const {
    status = 'not_started',
    currentStep,
    usedStarterWardrobe = false,
    garmentsCapturedCount = 0,
    revision,
  } = overrides
  const shared = { usedStarterWardrobe, garmentsCapturedCount }

  if (status === 'not_started') {
    return {
      status,
      currentStep: 'permission',
      ...shared,
      startedAt: null,
      completedAt: null,
      revision: 0,
    }
  }

  if (status === 'completed') {
    return {
      status,
      currentStep: 'complete',
      ...shared,
      startedAt: STATE_STARTED_AT,
      completedAt: STATE_COMPLETED_AT,
      revision: revision ?? 5,
    }
  }

  return {
    status,
    currentStep: currentStep && currentStep !== 'complete' ? currentStep : 'capture',
    ...shared,
    startedAt: STATE_STARTED_AT,
    completedAt: null,
    revision: revision ?? 1,
  }
}

function defaultSilhouetteProfile(): SilhouetteProfileContract {
  return {
    mode: 'default_mannequin',
    heightSlider: 50,
    buildSlider: 50,
    myForm: null,
    revision: 0,
    updatedAt: '2026-08-09T09:00:00.000Z',
  }
}

const committedGarment: GarmentItemContract = {
  id: 'garment-onboarding-1',
  status: 'awaiting_tags',
  category: null,
  material: null,
  comfortRange: null,
  tagsConfirmedAt: null,
  fileSizeBytes: 1024,
  mimeType: 'image/png',
  retentionStatus: 'active',
  createdAt: '2026-08-09T09:00:00.000Z',
  committedAt: '2026-08-09T09:01:00.000Z',
  imageAccess: null,
}

beforeEach(() => {
  resolveCurrentUserId.mockReset().mockResolvedValue(SIGNED_IN_USER)
  getOnboardingStateFromWeb.mockReset()
  advanceOnboardingStepFromWeb.mockReset()
  listGarmentsFromWeb.mockReset().mockResolvedValue([])
  uploadGarmentImageFromWeb.mockReset()
  suggestGarmentTagsFromWeb.mockReset().mockRejectedValue(new Error('no suggestions'))
  updateGarmentTagsFromWeb.mockReset()
  getSilhouetteProfileFromWeb.mockReset().mockResolvedValue(defaultSilhouetteProfile())
  routerReplace.mockReset()
  routerPush.mockReset()
})

afterEach(() => {
  for (const restore of globalRestorers.splice(0).reverse()) {
    restore()
  }
  cleanup()
  vi.restoreAllMocks()
})

describe('WardrobeOnboardingPage bootstrap and step-advance failures', () => {
  it('surfaces the reason when onboarding progress cannot be loaded', async () => {
    getOnboardingStateFromWeb.mockRejectedValue(new Error('onboarding service down'))
    render(<WardrobeOnboardingPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('onboarding service down')
    // The spinner must clear, or the flow looks hung with no way forward.
    expect(
      screen.queryByText('Loading your onboarding progress…')
    ).not.toBeInTheDocument()
  })

  it('falls back to translated copy when the load rejection is not an Error', async () => {
    getOnboardingStateFromWeb.mockRejectedValue('ECONNRESET')
    render(<WardrobeOnboardingPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to load your onboarding progress.'
    )
  })

  it('surfaces the reason when a step advance is rejected outright', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(state())
    advanceOnboardingStepFromWeb.mockRejectedValue(new Error('step write rejected'))
    installMediaDevicesMock({
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    })
    render(<WardrobeOnboardingPage />)

    await user.click(
      await screen.findByRole('button', { name: 'Allow camera and photo access' })
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('step write rejected')
    // A failed advance must not announce progress the user did not make.
    expect(screen.getByTestId('onboarding-status-region')).not.toHaveTextContent(
      'Camera access granted'
    )
    expect(
      screen.getByRole('button', { name: 'Allow camera and photo access' })
    ).toBeEnabled()
  })

  it('falls back to translated copy when a step advance rejects with a non-Error', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(state())
    advanceOnboardingStepFromWeb.mockRejectedValue('socket hang up')
    installMediaDevicesMock({
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    })
    render(<WardrobeOnboardingPage />)

    await user.click(
      await screen.findByRole('button', { name: 'Allow camera and photo access' })
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to save this step. Try again.'
    )
  })

  it('discards a bootstrap result that lands after the page unmounts', async () => {
    let settleState: (next: WardrobeOnboardingStateContract) => void = () => undefined
    getOnboardingStateFromWeb.mockReturnValue(
      new Promise((resolve) => {
        settleState = resolve
      })
    )
    const { unmount } = render(<WardrobeOnboardingPage />)
    await screen.findByRole('status')
    unmount()

    settleState(state({ status: 'completed', currentStep: 'complete' }))
    await waitFor(() => expect(getOnboardingStateFromWeb).toHaveBeenCalledTimes(1))

    // A completed state normally redirects; after teardown it must not navigate
    // a page the user has already left.
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('discards a bootstrap failure that lands after the page unmounts', async () => {
    let failState: (reason: Error) => void = () => undefined
    getOnboardingStateFromWeb.mockReturnValue(
      new Promise((_resolve, reject) => {
        failState = reject
      })
    )
    const { unmount } = render(<WardrobeOnboardingPage />)
    await screen.findByRole('status')
    unmount()

    failState(new Error('late bootstrap failure'))
    await waitFor(() => expect(getOnboardingStateFromWeb).toHaveBeenCalledTimes(1))

    getOnboardingStateFromWeb.mockReset().mockResolvedValue(state())
    render(<WardrobeOnboardingPage />)

    // A fresh mount must start clean rather than inherit the discarded failure.
    await screen.findByRole('button', { name: 'Allow camera and photo access' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('discards a garment list that lands after the page unmounts', async () => {
    let settleGarments: (garments: GarmentItemContract[]) => void = () => undefined
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture' })
    )
    listGarmentsFromWeb.mockReset().mockReturnValue(
      new Promise((resolve) => {
        settleGarments = resolve
      })
    )
    const { unmount } = render(<WardrobeOnboardingPage />)
    await waitFor(() => expect(listGarmentsFromWeb).toHaveBeenCalledTimes(1))
    unmount()

    settleGarments([committedGarment])
    await waitFor(() => expect(listGarmentsFromWeb).toHaveBeenCalledTimes(1))

    // Nothing to render into; the checklist must not resurrect itself.
    expect(screen.queryByTestId('onboarding-garment-checklist')).not.toBeInTheDocument()
  })

  it('discards a step-advance result that lands after the page unmounts', async () => {
    const user = userEvent.setup()
    let settleAdvance: (next: WardrobeOnboardingStateContract) => void = () => undefined
    getOnboardingStateFromWeb.mockResolvedValue(state())
    advanceOnboardingStepFromWeb.mockReturnValue(
      new Promise((resolve) => {
        settleAdvance = resolve
      })
    )
    installMediaDevicesMock({
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    })
    const { unmount } = render(<WardrobeOnboardingPage />)

    await user.click(
      await screen.findByRole('button', { name: 'Allow camera and photo access' })
    )
    await waitFor(() => expect(advanceOnboardingStepFromWeb).toHaveBeenCalledTimes(1))
    unmount()

    settleAdvance(state({ status: 'in_progress', currentStep: 'capture', revision: 1 }))
    await waitFor(() => expect(advanceOnboardingStepFromWeb).toHaveBeenCalledTimes(1))

    expect(
      screen.queryByRole('button', { name: 'Add another garment' })
    ).not.toBeInTheDocument()
  })

  it('stays silent when a step-advance rejection lands after the page unmounts', async () => {
    const user = userEvent.setup()
    let failAdvance: (reason: Error) => void = () => undefined
    getOnboardingStateFromWeb.mockResolvedValue(state())
    advanceOnboardingStepFromWeb.mockReturnValue(
      new Promise((_resolve, reject) => {
        failAdvance = reject
      })
    )
    installMediaDevicesMock({
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    })
    const { unmount } = render(<WardrobeOnboardingPage />)

    await user.click(
      await screen.findByRole('button', { name: 'Allow camera and photo access' })
    )
    await waitFor(() => expect(advanceOnboardingStepFromWeb).toHaveBeenCalledTimes(1))
    unmount()

    failAdvance(new Error('late advance failure'))
    await waitFor(() => expect(advanceOnboardingStepFromWeb).toHaveBeenCalledTimes(1))

    advanceOnboardingStepFromWeb
      .mockReset()
      .mockResolvedValue(
        state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
      )
    render(<WardrobeOnboardingPage />)

    await screen.findByRole('button', { name: 'Allow camera and photo access' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// Story 4.4 Task 5 owner: unit-test the web wardrobe onboarding guided flow's
// remaining paths (a denied camera prompt, continuing from tagging). Split
// out of `page.test.tsx` (Claude's TEA test review on PR #120, story 4.4
// tasks 8/9): that file had grown past this repo's 1000-line test-file
// ceiling with 3 independent describe blocks. Verbatim test bodies, no
// behavior change -- only the file boundary moved, and this file's preamble
// is trimmed to what only these tests use (no `WardrobeOnboardingPageForTests`
// poll-interval override, no `captureAndCommitGarment`/`CONFIRM_CHECKBOX_LABEL`/
// `committedGarment2`).
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
import { createReadyGarmentFixture } from '@couture/api-client/testing/wardrobe-fixtures'

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

describe('WardrobeOnboardingPage remaining guided-flow paths', () => {
  it('treats a rejected camera prompt as denied and still advances', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(state())
    advanceOnboardingStepFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    installMediaDevicesMock({
      getUserMedia: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
    })

    render(<WardrobeOnboardingPage />)
    await user.click(
      await screen.findByRole('button', { name: 'Allow camera and photo access' })
    )

    // A refused prompt must not dead-end the flow; file import still works.
    await screen.findByRole('button', { name: 'Add another garment' })
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-status-region')).toHaveTextContent(/camera/i)
    )
  })

  it('continues from tagging to the silhouette step once every garment is tagged', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'tagging', revision: 2 })
    )
    listGarmentsFromWeb.mockResolvedValue([
      createReadyGarmentFixture({ id: committedGarment.id, category: 'top' }),
    ])
    advanceOnboardingStepFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'silhouette', revision: 3 })
    )

    render(<WardrobeOnboardingPage />)

    await user.click(await screen.findByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(advanceOnboardingStepFromWeb).toHaveBeenCalledWith(
        { targetStep: 'silhouette' },
        '"onboarding:user-onboarding-1:2"',
        expect.anything()
      )
    )
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-status-region')).toHaveTextContent(
        /silhouette/i
      )
    )
  })
})

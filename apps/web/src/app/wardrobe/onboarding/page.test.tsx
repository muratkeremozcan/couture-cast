// Story 4.4 Task 5 owner: unit-test the web wardrobe onboarding guided flow
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
}))

import WardrobeOnboardingPage from './page'

const SIGNED_IN_USER = 'user-onboarding-1'

function state(
  overrides: Partial<WardrobeOnboardingStateContract> = {}
): WardrobeOnboardingStateContract {
  return {
    status: 'not_started',
    currentStep: 'permission',
    usedStarterWardrobe: false,
    garmentsCapturedCount: 0,
    startedAt: null,
    completedAt: null,
    revision: 0,
    ...overrides,
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
  cleanup()
  vi.restoreAllMocks()
})

describe('WardrobeOnboardingPage', () => {
  it('redirects to the wardrobe hub when onboarding is already completed', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'completed', currentStep: 'complete', revision: 5 })
    )
    render(<WardrobeOnboardingPage />)

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/wardrobe'))
  })

  it('grants camera permission and advances to the capture step', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(state())
    advanceOnboardingStepFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })

    render(<WardrobeOnboardingPage />)

    await user.click(
      await screen.findByRole('button', { name: 'Allow camera and photo access' })
    )

    await waitFor(() => {
      expect(advanceOnboardingStepFromWeb).toHaveBeenCalledWith(
        { targetStep: 'capture' },
        '"onboarding:user-onboarding-1:0"',
        expect.anything()
      )
    })
    expect(getUserMedia).toHaveBeenCalled()
    await screen.findByRole('button', { name: 'Add another garment' })
  })

  it('denies camera permission, shows guidance, and still advances to the capture step', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(state())
    advanceOnboardingStepFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    })

    render(<WardrobeOnboardingPage />)

    await user.click(
      await screen.findByRole('button', { name: 'Allow camera and photo access' })
    )

    await screen.findByText(
      /We couldn't access your camera or photos\. You can still import files or use the starter wardrobe\./
    )
    await screen.findByRole('button', { name: 'Add another garment' })
  })

  it('shows a checklist row for a captured garment and chains into tagging', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    uploadGarmentImageFromWeb.mockResolvedValue(committedGarment)

    render(<WardrobeOnboardingPage />)

    await user.click(await screen.findByRole('button', { name: 'Add another garment' }))
    await user.upload(
      screen.getByLabelText('Garment image file'),
      new File(['fixture'], 'garment.png', { type: 'image/png' })
    )
    await user.click(await screen.findByRole('button', { name: 'Use This Image' }))

    await screen.findByText('Garment 1: needs tags')

    await user.click(await screen.findByRole('button', { name: 'Done' }))
    await screen.findByText('Organize Garment Tags')
  })

  it('uses the starter wardrobe to skip straight to the silhouette step', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    advanceOnboardingStepFromWeb.mockResolvedValue(
      state({
        status: 'in_progress',
        currentStep: 'silhouette',
        usedStarterWardrobe: true,
        revision: 2,
      })
    )

    render(<WardrobeOnboardingPage />)

    await user.click(await screen.findByRole('button', { name: 'Use starter wardrobe' }))

    await waitFor(() => {
      expect(advanceOnboardingStepFromWeb).toHaveBeenCalledWith(
        { targetStep: 'silhouette', usedStarterWardrobe: true },
        '"onboarding:user-onboarding-1:1"',
        expect.anything()
      )
    })
    await screen.findByRole('heading', { name: 'Silhouette' })
    expect(listGarmentsFromWeb).not.toHaveBeenCalledTimes(2)
  })

  it('renders the silhouette settings panel at the silhouette step and finishes onboarding', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'silhouette', revision: 3 })
    )
    advanceOnboardingStepFromWeb.mockResolvedValue(
      state({ status: 'completed', currentStep: 'complete', revision: 4 })
    )

    render(<WardrobeOnboardingPage />)

    await screen.findByLabelText('Height')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(advanceOnboardingStepFromWeb).toHaveBeenCalledWith(
        { targetStep: 'complete' },
        '"onboarding:user-onboarding-1:3"',
        expect.anything()
      )
    })
    await screen.findByText('Your closet is ready')

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(routerPush).toHaveBeenCalledWith('/wardrobe')
  })

  it('surfaces a guardian-consent rejection for a teen actor during capture', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    uploadGarmentImageFromWeb.mockRejectedValue(new Error('GUARDIAN_CONSENT_REQUIRED'))

    render(<WardrobeOnboardingPage />)

    await user.click(await screen.findByRole('button', { name: 'Add another garment' }))
    await user.upload(
      screen.getByLabelText('Garment image file'),
      new File(['fixture'], 'garment.png', { type: 'image/png' })
    )
    await user.click(await screen.findByRole('button', { name: 'Use This Image' }))

    await screen.findByText('GUARDIAN_CONSENT_REQUIRED')
  })

  it('restores focus to the invoking button after the capture modal closes', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )

    render(<WardrobeOnboardingPage />)

    const addAnother = await screen.findByRole('button', { name: 'Add another garment' })
    await user.click(addAnother)
    await screen.findByRole('dialog')
    await user.click(screen.getByLabelText('Close capture modal'))

    await waitFor(() => expect(addAnother).toHaveFocus())
  })

  it('announces resuming an in-progress onboarding on load', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )

    render(<WardrobeOnboardingPage />)

    await waitFor(() => {
      expect(screen.getByText('Picking up where you left off')).toBeInTheDocument()
    })
  })

  it('resumes at the persisted step after a reload instead of restarting at permission', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'tagging', revision: 2 })
    )
    listGarmentsFromWeb.mockResolvedValue([
      { ...committedGarment, status: 'awaiting_tags' },
    ])

    render(<WardrobeOnboardingPage />)

    await screen.findByText('Garment 1: needs tags')
    expect(
      screen.queryByRole('button', { name: 'Allow camera and photo access' })
    ).not.toBeInTheDocument()
  })
})

// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  SilhouetteProfileContract,
  SuggestGarmentTagsData,
  UpdateGarmentTagsInput,
  WardrobeOnboardingStateContract,
} from '@couture/api-client/contracts/http'
import type { UploadGarmentImageInput } from '../../lib/wardrobe'

const {
  listGarmentsFromWeb,
  uploadGarmentImageFromWeb,
  suggestGarmentTagsFromWeb,
  updateGarmentTagsFromWeb,
  getOnboardingStateFromWeb,
  resolveCurrentUserId,
  getSilhouetteProfileFromWeb,
  updateSilhouetteSlidersFromWeb,
  uploadMyFormPhotoFromWeb,
  deleteMyFormPhotoFromWeb,
} = vi.hoisted(() => ({
  listGarmentsFromWeb: vi.fn<(signal?: AbortSignal) => Promise<GarmentItemContract[]>>(),
  uploadGarmentImageFromWeb:
    vi.fn<(input: UploadGarmentImageInput) => Promise<GarmentItemContract>>(),
  suggestGarmentTagsFromWeb:
    vi.fn<(garmentId: string, signal?: AbortSignal) => Promise<SuggestGarmentTagsData>>(),
  updateGarmentTagsFromWeb:
    vi.fn<
      (
        garmentId: string,
        tags: UpdateGarmentTagsInput,
        signal?: AbortSignal
      ) => Promise<GarmentItemContract>
    >(),
  getOnboardingStateFromWeb:
    vi.fn<(signal?: AbortSignal) => Promise<WardrobeOnboardingStateContract>>(),
  resolveCurrentUserId: vi.fn<() => Promise<string>>(),
  getSilhouetteProfileFromWeb:
    vi.fn<(signal?: AbortSignal) => Promise<SilhouetteProfileContract>>(),
  updateSilhouetteSlidersFromWeb: vi.fn(),
  uploadMyFormPhotoFromWeb: vi.fn(),
  deleteMyFormPhotoFromWeb: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/wardrobe',
}))

vi.mock('../../lib/wardrobe', () => ({
  listGarmentsFromWeb,
  uploadGarmentImageFromWeb,
  suggestGarmentTagsFromWeb,
  updateGarmentTagsFromWeb,
  getOnboardingStateFromWeb,
  resolveCurrentUserId,
  getSilhouetteProfileFromWeb,
  updateSilhouetteSlidersFromWeb,
  uploadMyFormPhotoFromWeb,
  deleteMyFormPhotoFromWeb,
  silhouetteETag: (userId: string, revision: number) =>
    `"silhouette:${userId}:${revision}"`,
  isStaleRevisionError: (error: unknown) =>
    error instanceof Error &&
    (error.message.includes('ONBOARDING_REVISION_MISMATCH') ||
      error.message.includes('SILHOUETTE_REVISION_MISMATCH')),
  generateIdempotencyKey: () => 'test-idempotency-key',
}))

import WardrobePage from './page'

const persistedGarment: GarmentItemContract = {
  id: 'persisted-garment-1',
  status: 'processing',
  category: null,
  material: null,
  comfortRange: null,
  tagsConfirmedAt: null,
  fileSizeBytes: 1024,
  mimeType: 'image/png',
  retentionStatus: 'active',
  createdAt: '2026-08-04T09:25:00.000Z',
  committedAt: '2026-08-04T09:26:22.000Z',
  imageAccess: {
    url: 'https://example.test/garment.png',
    expiresAt: '2026-08-04T09:41:22.000Z',
  },
}

function onboardingState(
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

function silhouetteProfile(): SilhouetteProfileContract {
  return {
    mode: 'default_mannequin',
    heightSlider: 50,
    buildSlider: 50,
    myForm: null,
    revision: 0,
    updatedAt: '2026-08-09T09:00:00.000Z',
  }
}

describe('WardrobePage persistence', () => {
  beforeEach(() => {
    listGarmentsFromWeb.mockReset()
    uploadGarmentImageFromWeb.mockReset()
    suggestGarmentTagsFromWeb.mockReset()
    updateGarmentTagsFromWeb.mockReset()
    getOnboardingStateFromWeb.mockReset().mockResolvedValue(onboardingState())
    resolveCurrentUserId.mockReset().mockResolvedValue('user-hub-1')
    getSilhouetteProfileFromWeb.mockReset().mockResolvedValue(silhouetteProfile())
    updateSilhouetteSlidersFromWeb.mockReset()
    uploadMyFormPhotoFromWeb.mockReset()
    deleteMyFormPhotoFromWeb.mockReset()
  })

  it('reconciles a committed garment and hydrates it again after reload', async () => {
    const user = userEvent.setup()
    listGarmentsFromWeb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([persistedGarment])
    uploadGarmentImageFromWeb.mockResolvedValue(persistedGarment)

    const firstRender = render(<WardrobePage />)
    await screen.findByText('No garments added yet')
    await user.click(screen.getByRole('button', { name: '+ Add Garment' }))
    await user.upload(
      screen.getByLabelText('Garment image file'),
      new File(['fixture-image'], 'garment.png', { type: 'image/png' })
    )
    await user.click(await screen.findByRole('button', { name: 'Use This Image' }))

    await screen.findByText('Garment Upload Complete!')
    expect(uploadGarmentImageFromWeb).toHaveBeenCalledOnce()
    expect(screen.getByText(persistedGarment.id)).toBeInTheDocument()

    firstRender.unmount()
    render(<WardrobePage />)

    await waitFor(() => expect(listGarmentsFromWeb).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(persistedGarment.id)).toBeInTheDocument()
  })
})

describe('WardrobePage onboarding entry card', () => {
  beforeEach(() => {
    listGarmentsFromWeb.mockReset().mockResolvedValue([])
    uploadGarmentImageFromWeb.mockReset()
    suggestGarmentTagsFromWeb.mockReset()
    updateGarmentTagsFromWeb.mockReset()
    getOnboardingStateFromWeb.mockReset()
    resolveCurrentUserId.mockReset().mockResolvedValue('user-hub-1')
    getSilhouetteProfileFromWeb.mockReset().mockResolvedValue(silhouetteProfile())
    updateSilhouetteSlidersFromWeb.mockReset()
    uploadMyFormPhotoFromWeb.mockReset()
    deleteMyFormPhotoFromWeb.mockReset()
  })

  it('shows the "Set up your closet" entry card while onboarding is not completed', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(
      onboardingState({ status: 'in_progress' })
    )
    render(<WardrobePage />)

    const link = await screen.findByRole('link', { name: 'Set up your closet' })
    expect(link).toHaveAttribute('href', '/wardrobe/onboarding')
  })

  it('hides the entry card once onboarding is completed', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(
      onboardingState({ status: 'completed', currentStep: 'complete' })
    )
    render(<WardrobePage />)

    await screen.findByText('No garments added yet')
    expect(
      screen.queryByRole('link', { name: 'Set up your closet' })
    ).not.toBeInTheDocument()
  })

  it('does not break the wardrobe hub when the onboarding status fetch fails', async () => {
    getOnboardingStateFromWeb.mockRejectedValue(new Error('network down'))
    render(<WardrobePage />)

    await screen.findByText('No garments added yet')
    expect(
      screen.queryByRole('link', { name: 'Set up your closet' })
    ).not.toBeInTheDocument()
  })

  it('surfaces a visible, retryable error instead of silently hiding the onboarding entry point', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockRejectedValueOnce(new Error('network down'))
    render(<WardrobePage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to check your closet setup progress.')

    getOnboardingStateFromWeb.mockResolvedValueOnce(
      onboardingState({ status: 'in_progress' })
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByRole('link', { name: 'Set up your closet' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('opens the silhouette settings in an accessible modal and restores focus on close', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(onboardingState({ status: 'completed' }))
    render(<WardrobePage />)

    const silhouetteButton = await screen.findByRole('button', { name: 'Silhouette' })
    await user.click(silhouetteButton)

    await screen.findByRole('dialog')
    await screen.findByLabelText('Height')

    await user.click(screen.getByLabelText('Close modal'))

    await waitFor(() => expect(silhouetteButton).toHaveFocus())
  })

  it('disables the Silhouette button until the signed-in user id has resolved', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(onboardingState({ status: 'completed' }))
    let resolveUserId: (id: string) => void = () => undefined
    resolveCurrentUserId.mockReset().mockReturnValue(
      new Promise((resolve) => {
        resolveUserId = resolve
      })
    )
    render(<WardrobePage />)

    const silhouetteButton = await screen.findByRole('button', { name: 'Silhouette' })
    expect(silhouetteButton).toBeDisabled()

    resolveUserId('user-hub-1')

    await waitFor(() => expect(silhouetteButton).toBeEnabled())
  })

  it('surfaces an error and keeps the Silhouette button disabled when resolving the user id fails', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(onboardingState({ status: 'completed' }))
    resolveCurrentUserId.mockReset().mockRejectedValue(new Error('unauthorized'))
    render(<WardrobePage />)

    const silhouetteButton = await screen.findByRole('button', { name: 'Silhouette' })
    await waitFor(() => expect(silhouetteButton).toBeDisabled())
    await screen.findByRole('alert')
  })

  it('keeps the silhouette modal open while a My Form upload is still in flight', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(onboardingState({ status: 'completed' }))
    uploadMyFormPhotoFromWeb.mockReturnValue(new Promise(() => undefined))
    render(<WardrobePage />)

    const silhouetteButton = await screen.findByRole('button', { name: 'Silhouette' })
    await waitFor(() => expect(silhouetteButton).toBeEnabled())
    await user.click(silhouetteButton)
    await screen.findByRole('dialog')
    await screen.findByLabelText('Height')

    await user.click(screen.getByLabelText(/I'm wearing plain white or black clothing/))
    await user.click(screen.getByRole('button', { name: 'Upload a full-body photo' }))
    await user.upload(
      screen.getByLabelText('My Form photo file', { selector: 'input' }),
      new File(['x'.repeat(20)], 'photo.png', { type: 'image/png' })
    )
    await screen.findByText('Processing your photo…')

    await user.click(screen.getByLabelText('Close modal'))

    // Escape and the close button both funnel through the same busy-guarded
    // handler; the dialog must still be here after either close attempt.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

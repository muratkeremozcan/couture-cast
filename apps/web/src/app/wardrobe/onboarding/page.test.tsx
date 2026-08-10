// Story 4.4 Task 5 owner: unit-test the web wardrobe onboarding guided flow
// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  SilhouetteProfileContract,
  UpdateWardrobeOnboardingStateInput,
  WardrobeOnboardingStateContract,
} from '@couture/api-client/contracts/http'
import {
  createReadyGarmentFixture,
  createSuggestGarmentTagsDataFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'

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

const committedGarment2: GarmentItemContract = {
  ...committedGarment,
  id: 'garment-onboarding-2',
  createdAt: '2026-08-09T09:02:00.000Z',
  committedAt: '2026-08-09T09:03:00.000Z',
}

// An apostrophe-containing string literal cannot satisfy this project's `quotes`
// (forces single) and `prettier/prettier` (forces double to avoid escaping) rules
// at once, so this label is a regex literal instead of a string literal.
const CONFIRM_CHECKBOX_LABEL = /I'm wearing plain white or black clothing/

/**
 * Opens the capture modal, uploads a file, and confirms the crop. Shared by
 * every test that needs a committed garment (3+ uses), per the project's
 * fixture-extraction convention.
 */
async function captureAndCommitGarment(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Add another garment' }))
  await user.upload(
    screen.getByLabelText('Garment image file'),
    new File(['fixture'], 'garment.png', { type: 'image/png' })
  )
  await user.click(await screen.findByRole('button', { name: 'Use This Image' }))
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
    installMediaDevicesMock({ getUserMedia })

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
    installMediaDevicesMock(undefined)

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

    await captureAndCommitGarment(user)

    await screen.findByText('Garment 1: needs tags')

    await user.click(await screen.findByRole('button', { name: 'Done' }))
    await screen.findByText('Organize Garment Tags')
  })

  it('hides "Use starter wardrobe" once a garment has been captured, so it cannot bypass required tagging', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    uploadGarmentImageFromWeb.mockResolvedValue(committedGarment)

    render(<WardrobeOnboardingPage />)

    expect(
      await screen.findByRole('button', { name: 'Use starter wardrobe' })
    ).toBeInTheDocument()

    await captureAndCommitGarment(user)
    await screen.findByText('Garment 1: needs tags')

    expect(
      screen.queryByRole('button', { name: 'Use starter wardrobe' })
    ).not.toBeInTheDocument()
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

    await captureAndCommitGarment(user)

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

  it('keeps a garment’s checklist position stable once assigned, instead of renumbering on newest-first reorder', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    uploadGarmentImageFromWeb
      .mockResolvedValueOnce(committedGarment)
      .mockResolvedValueOnce(committedGarment2)

    render(<WardrobeOnboardingPage />)

    await captureAndCommitGarment(user)
    await user.click(await screen.findByRole('button', { name: 'Done' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await captureAndCommitGarment(user)
    await user.click(await screen.findByRole('button', { name: 'Done' }))
    await screen.findByRole('dialog')

    // Newest-first display would put committedGarment2 at index 0 and
    // committedGarment at index 1; a live-index label would renumber the
    // first-captured garment from "Garment 1" to "Garment 2" here.
    await screen.findByText('Garment 2: needs tags')
    expect(screen.getByText('Garment 1: needs tags')).toBeInTheDocument()
  })

  it('restores focus to the specific checklist row that opened tagging, not the Add another button', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'tagging', revision: 2 })
    )
    listGarmentsFromWeb.mockResolvedValue([
      { ...committedGarment2, status: 'awaiting_tags' },
      { ...committedGarment, status: 'awaiting_tags' },
    ])

    render(<WardrobeOnboardingPage />)

    const secondRow = await screen.findByRole('button', { name: 'Garment 2: needs tags' })
    await user.click(secondRow)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(secondRow).toHaveFocus())
  })

  it('maps a stale onboarding revision to an actionable retry message', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    advanceOnboardingStepFromWeb.mockRejectedValueOnce(
      new Error('ONBOARDING_REVISION_MISMATCH')
    )

    render(<WardrobeOnboardingPage />)

    await user.click(await screen.findByRole('button', { name: 'Use starter wardrobe' }))

    await screen.findByText(
      'This step changed elsewhere. Review the latest version and try again.'
    )
  })

  it('disables the permission button while a step-advance request is in flight, guarding against a double submit', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(state())
    let resolveAdvance: (value: WardrobeOnboardingStateContract) => void = () => undefined
    advanceOnboardingStepFromWeb.mockReturnValue(
      new Promise((resolve) => {
        resolveAdvance = resolve
      })
    )
    installMediaDevicesMock({
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    })

    render(<WardrobeOnboardingPage />)

    const allowButton = await screen.findByRole('button', {
      name: 'Allow camera and photo access',
    })
    await user.click(allowButton)

    await waitFor(() => expect(allowButton).toBeDisabled())

    resolveAdvance(state({ status: 'in_progress', currentStep: 'capture', revision: 1 }))
  })

  it('aborts an in-flight step-advance request on unmount instead of leaking it', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    let capturedSignal: AbortSignal | undefined
    advanceOnboardingStepFromWeb.mockImplementation(
      (_input, _ifMatch, signal) =>
        new Promise(() => {
          capturedSignal = signal
        })
    )

    const { unmount } = render(<WardrobeOnboardingPage />)
    await user.click(await screen.findByRole('button', { name: 'Use starter wardrobe' }))
    await waitFor(() => expect(capturedSignal).toBeDefined())

    unmount()

    expect(capturedSignal?.aborted).toBe(true)
  })

  it('disables the silhouette Continue button while the panel is mid-upload, guarding against an early finish', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'silhouette', revision: 3 })
    )
    uploadMyFormPhotoFromWeb.mockReturnValue(new Promise(() => undefined))

    render(<WardrobeOnboardingPage />)

    await screen.findByLabelText('Height')
    await user.click(screen.getByLabelText(CONFIRM_CHECKBOX_LABEL))
    await user.click(screen.getByRole('button', { name: 'Upload a full-body photo' }))
    await user.upload(
      screen.getByLabelText('My Form photo file', { selector: 'input' }),
      new File(['x'.repeat(20)], 'photo.png', { type: 'image/png' })
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })
  })

  it('disables the silhouette Continue button while a slider edit is still debounced or saving, not only during a My Form upload', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'silhouette', revision: 3 })
    )
    updateSilhouetteSlidersFromWeb.mockReturnValue(new Promise(() => undefined))

    render(<WardrobeOnboardingPage />)

    const heightSlider = await screen.findByLabelText('Height')
    fireEvent.change(heightSlider, { target: { value: '80' } })

    // Busy from the moment the edit is scheduled, before the debounce
    // timer even fires: a quick Continue click must not race an unsaved
    // silhouette edit past completion.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })
  })

  it('shows a committed-but-processing garment as non-interactive: no tagging action exists for an image still being processed', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    const processingGarment = { ...committedGarment, status: 'processing' as const }
    uploadGarmentImageFromWeb.mockResolvedValueOnce(processingGarment)
    // Long enough that no poll attempt fires during this test.
    render(<WardrobeOnboardingPage garmentPollIntervalsMs={[60_000]} />)

    await captureAndCommitGarment(user)
    await user.click(await screen.findByRole('button', { name: 'Done' }))

    expect(screen.getByText('Garment 1: processing')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Garment 1: needs tags' })
    ).not.toBeInTheDocument()
  })

  it('live-updates a processing garment to a taggable row once smart tagging finishes', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    const processingGarment = { ...committedGarment, status: 'processing' as const }
    uploadGarmentImageFromWeb.mockResolvedValueOnce(processingGarment)
    listGarmentsFromWeb.mockResolvedValue([
      { ...committedGarment, status: 'awaiting_tags' },
    ])

    render(<WardrobeOnboardingPage garmentPollIntervalsMs={[5]} />)

    await captureAndCommitGarment(user)
    await user.click(await screen.findByRole('button', { name: 'Done' }))

    await screen.findByRole('button', { name: 'Garment 1: needs tags' })
  })

  it('offers a manual recheck once every scheduled poll attempt still reports processing', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    const processingGarment = { ...committedGarment, status: 'processing' as const }
    uploadGarmentImageFromWeb.mockResolvedValueOnce(processingGarment)
    listGarmentsFromWeb.mockResolvedValue([processingGarment])

    render(<WardrobeOnboardingPage garmentPollIntervalsMs={[5, 5]} />)

    await captureAndCommitGarment(user)
    await user.click(await screen.findByRole('button', { name: 'Done' }))

    // Every poll attempt exhausted without leaving "processing": the row
    // becomes a manual recheck action instead of staying stuck forever.
    await screen.findByRole('button', { name: 'Garment 1: needs tags' })
  })

  it('shows a failed garment as non-interactive without blocking Continue once the rest are tagged', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'tagging', revision: 2 })
    )
    listGarmentsFromWeb.mockResolvedValue([
      { ...committedGarment, status: 'failed' },
      { ...committedGarment2, tagsConfirmedAt: '2026-08-09T09:10:00.000Z' },
    ])

    render(<WardrobeOnboardingPage />)

    await screen.findByText('Garment 1: processing failed')
    await screen.findByText('Garment 2: tags confirmed')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('does not permanently block Continue when every captured garment failed processing', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'tagging', revision: 2 })
    )
    listGarmentsFromWeb.mockResolvedValue([{ ...committedGarment, status: 'failed' }])

    render(<WardrobeOnboardingPage />)

    await screen.findByText('Garment 1: processing failed')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('announces camera permission granted when advancing to capture', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(state())
    advanceOnboardingStepFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    installMediaDevicesMock({
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    })

    render(<WardrobeOnboardingPage />)

    await user.click(
      await screen.findByRole('button', { name: 'Allow camera and photo access' })
    )

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-status-region')).toHaveTextContent(
        'Camera access granted. Capture your garments.'
      )
    })
  })

  it('announces camera access being unavailable when advancing to capture without it', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(state())
    advanceOnboardingStepFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    installMediaDevicesMock(undefined)

    render(<WardrobeOnboardingPage />)

    await user.click(
      await screen.findByRole('button', { name: 'Allow camera and photo access' })
    )

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-status-region')).toHaveTextContent(
        'Camera access unavailable. Import photos or use the starter wardrobe.'
      )
    })
  })

  it('announces reaching the tagging step', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    // `processing`, not `awaiting_tags`: avoids the auto-chain into the
    // tagging modal so "Continue" stays reachable without an intervening
    // dialog; this test only cares about the step-transition announcement.
    uploadGarmentImageFromWeb.mockResolvedValue({
      ...committedGarment,
      status: 'processing',
    })
    advanceOnboardingStepFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'tagging', revision: 2 })
    )

    render(<WardrobeOnboardingPage />)

    await captureAndCommitGarment(user)
    await user.click(await screen.findByRole('button', { name: 'Done' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-status-region')).toHaveTextContent(
        'All garments captured. Confirm tags to continue.'
      )
    })
  })

  it('announces reaching the silhouette step via the starter wardrobe', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    advanceOnboardingStepFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'silhouette', revision: 2 })
    )

    render(<WardrobeOnboardingPage />)

    await user.click(await screen.findByRole('button', { name: 'Use starter wardrobe' }))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-status-region')).toHaveTextContent(
        'Set up your silhouette.'
      )
    })
  })

  it('announces a garment being tagged', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'tagging', revision: 2 })
    )
    listGarmentsFromWeb.mockResolvedValue([committedGarment])
    suggestGarmentTagsFromWeb.mockReset().mockResolvedValue(
      createSuggestGarmentTagsDataFixture({
        material: { confidence: 0.75 },
        comfortRange: { confidence: 0.9 },
      })
    )
    updateGarmentTagsFromWeb.mockResolvedValue(
      createReadyGarmentFixture({ id: committedGarment.id, category: 'top' })
    )

    render(<WardrobeOnboardingPage />)

    await user.click(await screen.findByRole('button', { name: 'Garment 1: needs tags' }))
    await screen.findByRole('radio', { name: /Top/ })
    await user.click(screen.getByRole('button', { name: 'Confirm & Save Tags' }))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-status-region')).toHaveTextContent(
        'top tagged.'
      )
    })
  })

  it('moves focus to the new step region on a step transition', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(state())
    advanceOnboardingStepFromWeb.mockResolvedValue(
      state({ status: 'in_progress', currentStep: 'capture', revision: 1 })
    )
    installMediaDevicesMock({
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    })

    render(<WardrobeOnboardingPage />)

    await user.click(
      await screen.findByRole('button', { name: 'Allow camera and photo access' })
    )

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-region')).toHaveFocus()
    })
  })
})

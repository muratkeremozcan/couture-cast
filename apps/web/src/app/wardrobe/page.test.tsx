// Learning path Step 63: Garment detail and tag edit (placeholder photo name).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  SilhouetteProfileContract,
  SuggestGarmentTagsData,
  UpdateGarmentTagsInput,
  WardrobeOnboardingStateContract,
} from '@couture/api-client/contracts/http'
import { createSuggestGarmentTagsDataFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import type { UploadGarmentImageInput } from '../../lib/wardrobe'
import type * as WebSession from '../../lib/web-session'
import { stubGarmentPreviewUrl } from '../../test-utils/garment-capture'

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

const verifiedSession = vi.hoisted(() => ({ owner: null as string | null }))
vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => verifiedSession.owner,
}))

vi.mock('../../lib/wardrobe', async () => ({
  prepareGarmentImage: (await import('../../test-utils/garment-capture'))
    .prepareGarmentImageFixture,
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

const savedLooksMocks = vi.hoisted(() => ({
  listSavedLooksPageFromWeb: vi.fn().mockResolvedValue({
    data: [],
    total: 0,
    limit: 50,
    offset: 0,
  }),
  listeners: new Set<(owner: string | null) => void>(),
}))

vi.mock('../../lib/saved-looks', () => ({
  listSavedLooksFromWeb: vi.fn().mockResolvedValue([]),
  listSavedLooksPageFromWeb: savedLooksMocks.listSavedLooksPageFromWeb,
  createSavedLookFromWeb: vi.fn(),
  getSavedLookFromWeb: vi.fn(),
  deleteSavedLookFromWeb: vi.fn(),
  restoreSavedLookFromWeb: vi.fn(),
  notifySavedLooksChanged: vi.fn(),
  subscribeSavedLooksChanged: (listener: (owner: string | null) => void) => {
    savedLooksMocks.listeners.add(listener)
    return () => {
      savedLooksMocks.listeners.delete(listener)
    }
  },
  formatSavedLookIfMatch: (id: string, revision: number) =>
    `"saved-look:${id}:${revision}"`,
}))

import WardrobePage from './page'

beforeEach(stubGarmentPreviewUrl)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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

const ONBOARDING_STARTED_AT = '2026-08-04T09:00:00.000Z'
const ONBOARDING_COMPLETED_AT = '2026-08-04T09:30:00.000Z'

/**
 * The contract is a discriminated union, so spreading arbitrary overrides over a
 * single base can produce a state the server never emits (a `completed` status
 * with a null `completedAt`, say). Deriving the correlated fields from `status`
 * keeps every fixture a state that can actually occur.
 */
function onboardingState(
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
      startedAt: ONBOARDING_STARTED_AT,
      completedAt: ONBOARDING_COMPLETED_AT,
      revision: revision ?? 5,
    }
  }

  return {
    status,
    currentStep: currentStep && currentStep !== 'complete' ? currentStep : 'capture',
    ...shared,
    startedAt: ONBOARDING_STARTED_AT,
    completedAt: null,
    revision: revision ?? 1,
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

function garmentFixture(
  id: string,
  status: GarmentItemContract['status'],
  overrides: Partial<GarmentItemContract> = {}
): GarmentItemContract {
  return { ...persistedGarment, id, status, ...overrides }
}

const confidentSuggestions: SuggestGarmentTagsData = createSuggestGarmentTagsDataFixture()

/**
 * The commit poll sleeps until 1s/2s/4s/8s after the commit, measured against
 * `Date.now()`. A clock that jumps a minute per read collapses every one of
 * those `setTimeout` delays to 0, so the whole retry ladder runs at task speed
 * instead of costing 15 real seconds and inviting a timing flake. React's
 * scheduler reads `performance.now()`, so it is untouched by this.
 */
function collapsePollSchedule() {
  let clock = Date.parse('2026-08-04T09:26:22.000Z')
  vi.spyOn(Date, 'now').mockImplementation(() => {
    clock += 60_000
    return clock
  })
}

async function commitGarmentThroughCapture(
  user: ReturnType<typeof userEvent.setup>,
  garment: GarmentItemContract,
  trigger: HTMLElement
) {
  uploadGarmentImageFromWeb.mockResolvedValue(garment)
  await user.click(trigger)
  await user.upload(
    screen.getByLabelText('Garment image file'),
    new File(['fixture-image'], 'garment.png', { type: 'image/png' })
  )
  await confirmCrop(user)
  await screen.findByText('Garment Upload Complete!')
}

async function confirmCrop(user: ReturnType<typeof userEvent.setup>) {
  const useImage = await screen.findByRole('button', { name: 'Use This Image' })
  await waitFor(() => expect(useImage).toBeEnabled())
  await user.click(useImage)
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
    await confirmCrop(user)

    await screen.findByText('Garment Upload Complete!')
    expect(uploadGarmentImageFromWeb).toHaveBeenCalledOnce()
    expectPersistedGarmentCard(screen.getByTestId(`garment-card-${persistedGarment.id}`))

    firstRender.unmount()
    render(<WardrobePage />)

    await waitFor(() => expect(listGarmentsFromWeb).toHaveBeenCalledTimes(2))
    expectPersistedGarmentCard(
      await screen.findByTestId(`garment-card-${persistedGarment.id}`)
    )
  })
})

describe('WardrobePage garment card label', () => {
  beforeEach(() => {
    getOnboardingStateFromWeb.mockReset().mockResolvedValue(onboardingState())
    resolveCurrentUserId.mockReset().mockResolvedValue('user-hub-1')
    getSilhouetteProfileFromWeb.mockReset().mockResolvedValue(silhouetteProfile())
  })

  it('names a tagged garment by category and material, never by its id', async () => {
    const tagged = garmentFixture('tagged-garment-1', 'ready', {
      category: 'top',
      material: 'cotton',
    })
    listGarmentsFromWeb.mockReset().mockResolvedValue([tagged])

    render(<WardrobePage />)

    const card = await screen.findByTestId(`garment-card-${tagged.id}`)
    // Story CC-7.5: the label is localized, with the singular category noun.
    expect(within(card).getByTestId('garment-card-label')).toHaveTextContent(
      'Top · Cotton'
    )
    expect(card).not.toHaveTextContent(tagged.id)
  })
})

// The card names the garment by its tags (Untagged before tagging) and never prints its id:
// Jade saw raw garment UUIDs on every card on 2026-11-19.
function expectPersistedGarmentCard(card: HTMLElement) {
  expect(within(card).getByTestId('garment-card-label')).toHaveTextContent('Untagged')
  expect(card).not.toHaveTextContent(persistedGarment.id)
}

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

function resetWardrobeMocks() {
  listGarmentsFromWeb.mockReset().mockResolvedValue([])
  uploadGarmentImageFromWeb.mockReset()
  suggestGarmentTagsFromWeb.mockReset().mockResolvedValue(confidentSuggestions)
  updateGarmentTagsFromWeb.mockReset()
  getOnboardingStateFromWeb
    .mockReset()
    .mockResolvedValue(onboardingState({ status: 'completed' }))
  resolveCurrentUserId.mockReset().mockResolvedValue('user-hub-1')
  getSilhouetteProfileFromWeb.mockReset().mockResolvedValue(silhouetteProfile())
  updateSilhouetteSlidersFromWeb.mockReset()
  uploadMyFormPhotoFromWeb.mockReset()
  deleteMyFormPhotoFromWeb.mockReset()
}

describe('WardrobePage wardrobe load failures', () => {
  beforeEach(resetWardrobeMocks)

  it('surfaces the failure reason and clears the loading state', async () => {
    listGarmentsFromWeb.mockReset().mockRejectedValue(new Error('Wardrobe service down'))
    render(<WardrobePage />)

    expect(await screen.findByText('Wardrobe service down')).toBeInTheDocument()
    // A failed load must still stop the spinner, or the hub looks hung forever.
    expect(screen.queryByText('Loading your wardrobe...')).not.toBeInTheDocument()
  })

  it('falls back to generic copy when the rejection carries no message', async () => {
    listGarmentsFromWeb.mockReset().mockRejectedValue('socket hang up')
    render(<WardrobePage />)

    expect(await screen.findByText('Unable to load your wardrobe.')).toBeInTheDocument()
  })

  it('restores the closet-progress banner when the retry fails again', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockReset().mockRejectedValue(new Error('network down'))
    render(<WardrobePage />)

    await screen.findByText('Unable to check your closet setup progress.')
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    // A retry that also fails must leave the affordance in place; dropping the
    // banner would strand an incomplete user with no route into setup.
    await waitFor(() => expect(getOnboardingStateFromWeb).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByText('Unable to check your closet setup progress.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('ignores bootstrap responses that land after the hub unmounts', async () => {
    let rejectList: (reason: Error) => void = () => undefined
    let rejectUserId: (reason: Error) => void = () => undefined
    let rejectOnboarding: (reason: Error) => void = () => undefined
    const listSignals: (AbortSignal | undefined)[] = []
    listGarmentsFromWeb.mockReset().mockImplementation((signal?: AbortSignal) => {
      listSignals.push(signal)
      return new Promise((_resolve, reject) => {
        rejectList = reject
      })
    })
    resolveCurrentUserId.mockReset().mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectUserId = reject
      })
    )
    getOnboardingStateFromWeb.mockReset().mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectOnboarding = reject
      })
    )

    const view = render(<WardrobePage />)
    await screen.findByText('Loading your wardrobe...')
    view.unmount()

    // Unmount must abort the in-flight fetches; that abort is what lets the
    // late handlers below know their result is no longer wanted.
    expect(listSignals.every((signal) => signal?.aborted === true)).toBe(true)

    rejectList(new Error('late list failure'))
    rejectUserId(new Error('late auth failure'))
    rejectOnboarding(new Error('late onboarding failure'))
    await waitFor(() => expect(listSignals).toHaveLength(1))

    listGarmentsFromWeb.mockReset().mockResolvedValue([])
    resolveCurrentUserId.mockReset().mockResolvedValue('user-hub-1')
    getOnboardingStateFromWeb
      .mockReset()
      .mockResolvedValue(onboardingState({ status: 'completed' }))
    render(<WardrobePage />)

    await screen.findByText('No garments added yet')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('WardrobePage direct garment entry', () => {
  let previousUrl: string

  function publishMember(owner: string) {
    verifiedSession.owner = owner
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, `test-token-${owner}`)
    window.dispatchEvent(new Event('couture:session'))
  }

  beforeEach(() => {
    resetWardrobeMocks()
    previousUrl = window.location.href
    window.history.replaceState(window.history.state, '', '/wardrobe?entry=add&from=home')
    publishMember('user-hub-1')
  })

  afterEach(() => {
    cleanup()
    verifiedSession.owner = null
    window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    window.history.replaceState(window.history.state, '', previousUrl)
  })

  it('retries the closet before opening capture and consumes the direct entry once', async () => {
    const user = userEvent.setup()
    listGarmentsFromWeb.mockRejectedValueOnce('connection lost').mockResolvedValue([])
    const view = render(<WardrobePage />)

    const error = await screen.findByRole('alert')
    const opener = screen.getByRole('button', { name: '+ Add Garment' })
    expect(error).toHaveTextContent('Unable to load your wardrobe.')
    expect(screen.queryByText('No garments added yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.location.search).toBe('?entry=add&from=home')
    await user.click(within(error).getByRole('button', { name: 'Try again' }))

    const capture = await screen.findByRole('dialog', { name: 'Garment Capture Flow' })
    expect(window.location.search).toBe('?from=home')
    await user.upload(
      within(capture).getByLabelText('Garment image file'),
      new File(['fixture-image'], 'garment.png', { type: 'image/png' })
    )
    const useImage = await within(capture).findByRole('button', {
      name: 'Use This Image',
    })
    await waitFor(() => expect(useImage).toBeEnabled())
    await user.keyboard('{Escape}')
    expect(within(capture).getByText('Discard this photo?')).toBeVisible()
    expect(within(capture).getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    await user.click(within(capture).getByRole('button', { name: 'Keep editing' }))
    expect(within(capture).getByRole('button', { name: 'Use This Image' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await user.click(within(capture).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(uploadGarmentImageFromWeb).not.toHaveBeenCalled()

    view.unmount()
    render(<WardrobePage />)
    expect(await screen.findByText('No garments added yet')).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('resumes an unfinished tag review and keeps the updated tile through a retry', async () => {
    const user = userEvent.setup()
    const pending = garmentFixture('garment-pending', 'awaiting_tags')
    const ready = garmentFixture(pending.id, 'ready')
    listGarmentsFromWeb
      .mockResolvedValueOnce([pending])
      .mockRejectedValueOnce(new Error('Refresh rejected'))
      .mockResolvedValue([ready])
    updateGarmentTagsFromWeb.mockResolvedValue(ready)
    render(<WardrobePage />)

    const tagging = await screen.findByRole('dialog', { name: 'Organize Garment Tags' })
    expect(window.location.search).toBe('?from=home')
    await user.click(
      await within(tagging).findByRole('button', { name: 'Confirm & Save Tags' })
    )
    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Refresh rejected')
    expect(error).toHaveTextContent('Showing your saved garments. Refresh failed.')
    expect(
      within(screen.getByTestId(`garment-card-${pending.id}`)).getByText('ready')
    ).toBeVisible()
    expect(screen.getByRole('link', { name: "Back to today's outfit" })).toHaveAttribute(
      'href',
      '/'
    )
    expect(updateGarmentTagsFromWeb).toHaveBeenCalledWith(
      pending.id,
      expect.any(Object),
      expect.any(AbortSignal)
    )
    await user.click(within(error).getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(uploadGarmentImageFromWeb).not.toHaveBeenCalled()
  })

  it('checks an existing processing garment without starting a second upload', async () => {
    const user = userEvent.setup()
    collapsePollSchedule()
    const processing = garmentFixture('garment-processing', 'processing')
    listGarmentsFromWeb
      .mockResolvedValueOnce([processing])
      .mockResolvedValue([garmentFixture(processing.id, 'ready')])
    render(<WardrobePage />)

    const check = await screen.findByRole('button', { name: 'Check garment status' })
    expect(window.location.search).toBe('?from=home')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(check)

    const card = screen.getByTestId(`garment-card-${processing.id}`)
    expect(await within(card).findByText('ready')).toBeVisible()
    expect(screen.getByRole('link', { name: "Back to today's outfit" })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(uploadGarmentImageFromWeb).not.toHaveBeenCalled()
  })

  it('drops an earlier member’s held wardrobe list when the verified owner changes', async () => {
    const olderList = Promise.withResolvers<GarmentItemContract[]>()
    const previous = garmentFixture('garment-previous', 'awaiting_tags')
    const current = garmentFixture('garment-current', 'ready')
    listGarmentsFromWeb
      .mockReturnValueOnce(olderList.promise)
      .mockResolvedValue([current])
    render(<WardrobePage />)
    const [firstSignal] = listGarmentsFromWeb.mock.calls[0] ?? []
    expect(await screen.findByText('Loading your wardrobe...')).toBeVisible()

    act(() => publishMember('user-hub-2'))
    expect(await screen.findByTestId(`garment-card-${current.id}`)).toBeVisible()
    expect(firstSignal?.aborted).toBe(true)
    await act(async () => {
      olderList.resolve([previous])
      await olderList.promise
    })

    expect(screen.queryByTestId(`garment-card-${previous.id}`)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('dialog', { name: 'Organize Garment Tags' })
    ).not.toBeInTheDocument()
  })
})

describe('WardrobePage garment grid', () => {
  beforeEach(resetWardrobeMocks)

  it('opens the capture modal from the empty-state call to action', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)

    await user.click(
      await screen.findByRole('button', { name: 'Snap or Import Garment' })
    )

    expect(await screen.findByText('Garment Capture Flow')).toBeInTheDocument()
  })

  it('renders a placeholder tile when a garment has no signed image URL', async () => {
    listGarmentsFromWeb.mockReset().mockResolvedValue([
      garmentFixture('garment-no-image', 'ready', {
        category: 'top',
        material: 'cotton',
        comfortRange: 'mild',
        imageAccess: null,
      }),
    ])
    render(<WardrobePage />)

    const card = await screen.findByTestId('garment-card-garment-no-image')
    // Story 7.5: the placeholder is named like a photo would be (D6), and it is not an <img>:
    // rendering <img src={undefined}> would show a broken-image glyph instead.
    expect(within(card).getByRole('img', { name: 'Top' })).toHaveTextContent('👗')
    expect(card.querySelector('img')).toBeNull()
  })

  it('opens capture for a failed garment and restores the replacement action on close', async () => {
    const user = userEvent.setup()
    listGarmentsFromWeb.mockResolvedValue([garmentFixture('garment-failed', 'failed')])
    render(<WardrobePage />)

    const replace = await screen.findByRole('button', { name: 'Choose another photo' })
    await user.click(replace)
    expect(
      await screen.findByRole('dialog', { name: 'Garment Capture Flow' })
    ).toBeVisible()
    await user.keyboard('{Escape}')

    await waitFor(() => expect(replace).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(uploadGarmentImageFromWeb).not.toHaveBeenCalled()
  })

  it('closes the tagging modal without saving when the user cancels', async () => {
    const user = userEvent.setup()
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValue([garmentFixture('garment-awaiting', 'awaiting_tags')])
    render(<WardrobePage />)

    await user.click(await screen.findByRole('button', { name: 'Needs tags' }))
    await screen.findByText('Organize Garment Tags')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByText('Organize Garment Tags')).not.toBeInTheDocument()
    )
    expect(updateGarmentTagsFromWeb).not.toHaveBeenCalled()
  })
})

describe('WardrobePage tag confirmation', () => {
  beforeEach(resetWardrobeMocks)

  async function confirmTagsOnAwaitingGarment() {
    const user = userEvent.setup()
    render(<WardrobePage />)
    await user.click(await screen.findByRole('button', { name: 'Needs tags' }))
    await screen.findByText('Organize Garment Tags')
    await user.click(await screen.findByRole('button', { name: 'Confirm & Save Tags' }))
    return user
  }

  it('applies the confirmation to the matching card only and rehydrates the grid', async () => {
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValueOnce([
        garmentFixture('garment-awaiting', 'awaiting_tags'),
        garmentFixture('garment-other', 'ready'),
      ])
      .mockResolvedValueOnce([
        garmentFixture('garment-awaiting', 'ready'),
        garmentFixture('garment-other', 'ready'),
      ])
    updateGarmentTagsFromWeb.mockResolvedValue(
      garmentFixture('garment-awaiting', 'ready')
    )

    await confirmTagsOnAwaitingGarment()

    await waitFor(() =>
      expect(screen.queryByText('Organize Garment Tags')).not.toBeInTheDocument()
    )
    // The unrelated card must survive the targeted update.
    expect(screen.getByTestId('garment-card-garment-other')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Needs tags' })).not.toBeInTheDocument()
    )
    expect(listGarmentsFromWeb).toHaveBeenCalledTimes(2)
  })

  it('reports a post-confirmation refresh failure while keeping the local update', async () => {
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValueOnce([garmentFixture('garment-awaiting', 'awaiting_tags')])
      .mockRejectedValueOnce(new Error('Refresh rejected'))
    updateGarmentTagsFromWeb.mockResolvedValue(
      garmentFixture('garment-awaiting', 'ready')
    )

    await confirmTagsOnAwaitingGarment()

    expect(await screen.findByText('Refresh rejected')).toBeInTheDocument()
    // The optimistic local update stays; the user does not lose the card.
    expect(screen.getByTestId('garment-card-garment-awaiting')).toBeInTheDocument()
  })

  it('falls back to generic copy when the refresh rejection carries no message', async () => {
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValueOnce([garmentFixture('garment-awaiting', 'awaiting_tags')])
      .mockRejectedValueOnce('gateway reset')
    updateGarmentTagsFromWeb.mockResolvedValue(
      garmentFixture('garment-awaiting', 'ready')
    )

    await confirmTagsOnAwaitingGarment()

    expect(
      await screen.findByText('Unable to refresh your wardrobe.')
    ).toBeInTheDocument()
  })
})

describe('WardrobePage commit reconciliation', () => {
  beforeEach(resetWardrobeMocks)

  it('defers tagging until the capture modal closes on an awaiting_tags commit', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    await screen.findByText('No garments added yet')

    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-awaiting', 'awaiting_tags'),
      screen.getByRole('button', { name: '+ Add Garment' })
    )

    // Stacking tagging on top of capture would trap focus in two dialogs.
    expect(screen.queryByText('Organize Garment Tags')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(await screen.findByText('Organize Garment Tags')).toBeInTheDocument()
  })

  it('adds an already-ready commit to the grid without polling or tagging', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    await screen.findByText('No garments added yet')

    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-ready', 'ready'),
      screen.getByRole('button', { name: '+ Add Garment' })
    )
    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.getByTestId('garment-card-garment-ready')).toBeInTheDocument()
    expect(screen.queryByText('Organize Garment Tags')).not.toBeInTheDocument()
    // Only the initial hydration; a terminal status must not start a poll.
    expect(listGarmentsFromWeb).toHaveBeenCalledTimes(1)
  })
})

describe('WardrobePage processing poll', () => {
  beforeEach(resetWardrobeMocks)

  it('does not let a styling snapshot undo a processing poll that settled first', async () => {
    const user = userEvent.setup()
    collapsePollSchedule()
    const poll = Promise.withResolvers<GarmentItemContract[]>()
    const styling = Promise.withResolvers<GarmentItemContract[]>()
    const authoritative = Promise.withResolvers<GarmentItemContract[]>()
    const photo = {
      url: 'https://example.test/styling-photo.png',
      expiresAt: '2090-01-01T00:00:00.000Z',
    }
    const anchor = garmentFixture('styling-anchor', 'ready', {
      category: 'top',
      comfortRange: 'mild',
      imageAccess: photo,
    })
    const processing = garmentFixture('styling-while-processing', 'processing')
    const ready = { ...processing, status: 'ready' } as const
    listGarmentsFromWeb
      .mockResolvedValueOnce([anchor])
      .mockReturnValueOnce(poll.promise)
      .mockReturnValueOnce(styling.promise)
      .mockReturnValueOnce(authoritative.promise)
    verifiedSession.owner = 'styling-while-processing-member'
    sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-styling-member')
    try {
      render(<WardrobePage />)
      const openStyling = await screen.findByRole('button', { name: 'Style this piece' })
      await commitGarmentThroughCapture(
        user,
        processing,
        screen.getByRole('button', { name: '+ Add Garment' })
      )
      await user.click(screen.getByRole('button', { name: 'Done' }))
      await waitFor(() => expect(listGarmentsFromWeb).toHaveBeenCalledTimes(2))
      await user.click(openStyling)
      const panel = await screen.findByRole('dialog', { name: 'Style this piece' })
      await waitFor(() => expect(listGarmentsFromWeb).toHaveBeenCalledTimes(3))
      const card = screen.getByTestId(`garment-card-${processing.id}`)
      await act(async () => {
        poll.resolve([anchor, ready])
        await poll.promise
      })
      expect(within(card).getByTestId('garment-status-ready')).toBeVisible()

      await act(async () => {
        styling.resolve([anchor, processing])
        await styling.promise
      })
      expect(within(card).getByTestId('garment-status-ready')).toBeVisible()
      expect(
        within(panel).queryByRole('img', { name: 'Your piece' })
      ).not.toBeInTheDocument()
      expect(listGarmentsFromWeb).toHaveBeenCalledTimes(4)
      await act(async () => {
        authoritative.resolve([ready])
        await authoritative.promise
      })
      expect(screen.queryByTestId(`garment-card-${anchor.id}`)).not.toBeInTheDocument()
      expect(
        within(panel).queryByRole('img', { name: 'Your piece' })
      ).not.toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(within(card).getByTestId('garment-status-ready')).toBeVisible()
    } finally {
      cleanup()
      verifiedSession.owner = null
      sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    }
  })

  it('queues tagging when the poll finishes while capture is still open', async () => {
    const user = userEvent.setup()
    collapsePollSchedule()
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([garmentFixture('garment-poll', 'processing')])
      .mockResolvedValue([garmentFixture('garment-poll', 'awaiting_tags')])
    render(<WardrobePage />)
    await screen.findByText('No garments added yet')

    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-poll', 'processing'),
      screen.getByRole('button', { name: '+ Add Garment' })
    )

    // Wait on the state the poll actually commits, not on the call count: the
    // count ticks when the request is issued, before its continuation has
    // queued the pending tagging id that closing the modal depends on.
    await screen.findByTestId('garment-status-awaiting_tags')
    expect(screen.queryByText('Organize Garment Tags')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(await screen.findByText('Organize Garment Tags')).toBeInTheDocument()
  })

  it('opens tagging straight away when the poll finishes after capture closed', async () => {
    const user = userEvent.setup()
    collapsePollSchedule()
    let releasePoll: (garments: GarmentItemContract[]) => void = () => undefined
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releasePoll = resolve
        })
      )
    render(<WardrobePage />)
    await screen.findByText('No garments added yet')

    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-poll', 'processing'),
      screen.getByRole('button', { name: '+ Add Garment' })
    )
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(screen.queryByText('Garment Capture Flow')).not.toBeInTheDocument()
    )

    releasePoll([garmentFixture('garment-poll', 'awaiting_tags')])

    expect(await screen.findByText('Organize Garment Tags')).toBeInTheDocument()
  })

  it('stops polling without tagging once the garment reaches a terminal status', async () => {
    const user = userEvent.setup()
    collapsePollSchedule()
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValue([garmentFixture('garment-poll', 'ready')])
    render(<WardrobePage />)
    await screen.findByText('No garments added yet')

    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-poll', 'processing'),
      screen.getByRole('button', { name: '+ Add Garment' })
    )

    // Same reason as above: the rendered status proves the poll settled.
    await screen.findByTestId('garment-status-ready')
    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.getByTestId('garment-status-ready')).toBeInTheDocument()
    expect(screen.queryByText('Organize Garment Tags')).not.toBeInTheDocument()
    // A single poll settles it; the ladder must not keep firing.
    expect(listGarmentsFromWeb).toHaveBeenCalledTimes(2)
  })

  it('checks processing again after a timeout and opens tags once analysis completes', async () => {
    const user = userEvent.setup()
    collapsePollSchedule()
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValueOnce([])
      // The first poll runs before the garment is queryable at all, the rest
      // find it still processing; both shapes have to keep the ladder going.
      .mockResolvedValueOnce([])
      .mockResolvedValue([garmentFixture('garment-poll', 'processing')])
    render(<WardrobePage />)
    await screen.findByText('No garments added yet')

    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-poll', 'processing'),
      screen.getByRole('button', { name: '+ Add Garment' })
    )
    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(
      await screen.findByText(/Smart tagging is taking longer than expected/)
    ).toBeInTheDocument()
    expect(listGarmentsFromWeb).toHaveBeenCalledTimes(5)
    expect(screen.queryByRole('button', { name: 'Needs tags' })).not.toBeInTheDocument()
    listGarmentsFromWeb.mockResolvedValue([
      garmentFixture('garment-poll', 'awaiting_tags'),
    ])
    await user.click(screen.getByRole('button', { name: 'Check garment status' }))
    expect(await screen.findByText('Organize Garment Tags')).toBeInTheDocument()
  })

  it('reports the reason when a poll request fails', async () => {
    const user = userEvent.setup()
    collapsePollSchedule()
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error('Poll request failed'))
    render(<WardrobePage />)
    await screen.findByText('No garments added yet')

    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-poll', 'processing'),
      screen.getByRole('button', { name: '+ Add Garment' })
    )
    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(await screen.findByText('Poll request failed')).toBeInTheDocument()
  })

  it('falls back to generic copy when a poll rejection carries no message', async () => {
    const user = userEvent.setup()
    collapsePollSchedule()
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValueOnce([])
      .mockRejectedValue('ECONNRESET')
    render(<WardrobePage />)
    await screen.findByText('No garments added yet')

    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-poll', 'processing'),
      screen.getByRole('button', { name: '+ Add Garment' })
    )
    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(
      await screen.findByText('Unable to refresh garment status.')
    ).toBeInTheDocument()
  })

  it('restores focus to the header button when the invoking control has unmounted', async () => {
    const user = userEvent.setup()
    collapsePollSchedule()
    let releasePoll: (garments: GarmentItemContract[]) => void = () => undefined
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releasePoll = resolve
        })
      )
    render(<WardrobePage />)

    // The empty-state CTA opens capture and then unmounts the moment the first
    // garment lands, so tagging has to fall back to a control that still exists.
    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-poll', 'processing'),
      await screen.findByRole('button', { name: 'Snap or Import Garment' })
    )
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(screen.queryByText('Garment Capture Flow')).not.toBeInTheDocument()
    )

    releasePoll([garmentFixture('garment-poll', 'awaiting_tags')])
    await screen.findByText('Organize Garment Tags')

    await user.click(screen.getByLabelText('Close modal'))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Add Garment' })).toHaveFocus()
    )
  })
})

describe('WardrobePage late bootstrap results', () => {
  beforeEach(resetWardrobeMocks)

  it('discards successful bootstrap results that land after the hub unmounts', async () => {
    let settleUserId: (id: string) => void = () => undefined
    let settleOnboarding: (state: WardrobeOnboardingStateContract) => void = () =>
      undefined
    resolveCurrentUserId.mockReset().mockReturnValue(
      new Promise((resolve) => {
        settleUserId = resolve
      })
    )
    getOnboardingStateFromWeb.mockReset().mockReturnValue(
      new Promise((resolve) => {
        settleOnboarding = resolve
      })
    )

    const view = render(<WardrobePage />)
    await screen.findByRole('button', { name: '+ Add Garment' })
    view.unmount()

    settleUserId('user-hub-1')
    settleOnboarding(onboardingState({ status: 'in_progress' }))
    await waitFor(() => expect(resolveCurrentUserId).toHaveBeenCalledTimes(1))

    // A remount must render from its own fetches, not from state a torn-down
    // instance tried to write after the fact.
    resetWardrobeMocks()
    render(<WardrobePage />)

    await screen.findByText('No garments added yet')
    expect(
      screen.queryByRole('link', { name: 'Set up your closet' })
    ).not.toBeInTheDocument()
  })
})

describe('WardrobePage commit deduplication', () => {
  beforeEach(resetWardrobeMocks)

  it('replaces an existing tile when the same garment id is committed again', async () => {
    const user = userEvent.setup()
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValue([garmentFixture('garment-existing', 'ready')])
    render(<WardrobePage />)
    await screen.findByTestId('garment-card-garment-existing')

    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-existing', 'awaiting_tags'),
      screen.getByRole('button', { name: '+ Add Garment' })
    )

    // Re-committing must update the tile in place, never stack a duplicate.
    expect(screen.getAllByTestId('garment-card-garment-existing')).toHaveLength(1)
    expect(screen.getByTestId('garment-status-awaiting_tags')).toBeInTheDocument()
  })

  it('returns focus to a usable control after confirming tags from a poll-opened dialog', async () => {
    const user = userEvent.setup()
    collapsePollSchedule()
    let releasePoll: (garments: GarmentItemContract[]) => void = () => undefined
    listGarmentsFromWeb
      .mockReset()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releasePoll = resolve
        })
      )
      .mockResolvedValue([garmentFixture('garment-poll', 'ready')])
    updateGarmentTagsFromWeb.mockResolvedValue(garmentFixture('garment-poll', 'ready'))
    render(<WardrobePage />)

    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-poll', 'processing'),
      await screen.findByRole('button', { name: 'Snap or Import Garment' })
    )
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(screen.queryByText('Garment Capture Flow')).not.toBeInTheDocument()
    )

    releasePoll([garmentFixture('garment-poll', 'awaiting_tags')])
    await screen.findByText('Organize Garment Tags')

    await user.click(await screen.findByRole('button', { name: 'Confirm & Save Tags' }))

    await waitFor(() =>
      expect(screen.queryByText('Organize Garment Tags')).not.toBeInTheDocument()
    )
    // Confirming removes the Needs tags button that opened nothing here, so the
    // restore target has to be a control that still exists on the page.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Add Garment' })).toHaveFocus()
    )
  })

  it('loads, paginates, refreshes on change notifications, and retries failed Closet saved looks', async () => {
    const user = userEvent.setup()
    verifiedSession.owner = 'member-saved-looks'
    window.sessionStorage.setItem(
      WEB_ACCESS_TOKEN_STORAGE_KEY,
      'test-token-member-saved-looks'
    )
    window.dispatchEvent(new Event('couture:session'))
    const anchorGarment: GarmentItemContract = {
      ...persistedGarment,
      id: 'garment-anchor-1',
      status: 'ready',
      category: 'top',
      material: 'cotton',
      comfortRange: 'mild',
      imageAccess: {
        url: 'https://example.test/anchor.png',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    }
    listGarmentsFromWeb.mockResolvedValue([anchorGarment])
    const { SAMPLE_CATALOG, stylePieceAnchor, stylePieceLooks } = await import(
      '@couture/utils'
    )
    const piece = stylePieceAnchor(anchorGarment)!
    const exactLook = stylePieceLooks(piece, 'mild-dry', SAMPLE_CATALOG).looks[0]!

    const makeSavedLook = (id: string, isStylePiece = false) =>
      isStylePiece
        ? {
            id,
            ownerUserId: 'member-saved-looks',
            source: 'style_piece' as const,
            lookId: exactLook.recipe.lookId,
            weather: 'mild-dry',
            title: `Look ${id}`,
            anchorGarmentId: anchorGarment.id,
            anchorSnapshot: {
              category: 'top' as const,
              comfortRange: 'mild' as const,
            },
            composition: [
              {
                slotIndex: 0,
                category: 'top' as const,
                kind: 'garment' as const,
                itemId: anchorGarment.id,
                label: null,
                missing: false,
                imageAccess: anchorGarment.imageAccess,
              },
              ...exactLook.companions.map((companion, idx) => ({
                slotIndex: idx + 1,
                category: companion.category,
                kind: 'catalog' as const,
                itemId: companion.id,
                label: null,
                missing: false,
                imageAccess: null,
              })),
            ],
            swaps: {},
            collection: null,
            comfort: null,
            availabilityStatus: 'ready' as const,
            missingGarmentIds: [],
            needsReviewReasons: [],
            revision: 0,
            createdAt: '2026-11-22T01:00:00.000Z',
            updatedAt: '2026-11-22T01:00:00.000Z',
          }
        : {
            id,
            ownerUserId: 'member-saved-looks',
            source: 'home_sample' as const,
            lookId: 'sample:l:silk-midi',
            weather: 'warm-rainy',
            title: `Look ${id}`,
            anchorGarmentId: null,
            anchorSnapshot: null,
            composition: [
              {
                slotIndex: 0,
                category: 'top' as const,
                kind: 'catalog' as const,
                itemId: 'sample:g:knit-tee',
                label: null,
                missing: false,
                imageAccess: null,
              },
            ],
            swaps: {},
            collection: 'all',
            comfort: null,
            availabilityStatus: 'ready' as const,
            missingGarmentIds: [],
            needsReviewReasons: [],
            revision: 0,
            createdAt: '2026-11-22T01:00:00.000Z',
            updatedAt: '2026-11-22T01:00:00.000Z',
          }

    savedLooksMocks.listSavedLooksPageFromWeb
      .mockRejectedValueOnce(new Error('Saved looks temporarily unavailable'))
      .mockResolvedValueOnce({
        data: [makeSavedLook('sl-1')],
        total: 2,
        limit: 50,
        offset: 0,
      })
      .mockResolvedValueOnce({
        data: [makeSavedLook('sl-2', true)],
        total: 2,
        limit: 50,
        offset: 1,
      })
      .mockResolvedValue({
        data: [makeSavedLook('sl-1'), makeSavedLook('sl-2', true)],
        total: 2,
        limit: 50,
        offset: 0,
      })

    try {
      render(<WardrobePage />)
      await user.click(await screen.findByTestId('saved-looks-retry'))
      await waitFor(() =>
        expect(screen.getByTestId('closet-saved-looks-row')).toHaveTextContent('2')
      )

      await user.click(screen.getByTestId('closet-saved-looks-row'))
      await user.click(await screen.findByTestId('saved-looks-load-more'))
      await waitFor(() => expect(screen.getByText('Look sl-2')).toBeInTheDocument())

      // Reopen exact style_piece look in StylePiecePanel from ClosetSavedLooksRow, then remove a look.
      const reopenBtns = screen.getAllByTestId('saved-look-reopen')
      await user.click(reopenBtns[1]!)
      expect(
        await screen.findByRole('dialog', { name: 'Style this piece' })
      ).toBeVisible()
      await user.click(screen.getAllByTestId('saved-look-remove')[0]!)

      act(() => {
        for (const listener of savedLooksMocks.listeners) {
          listener('member-saved-looks')
        }
      })
      await waitFor(() =>
        expect(
          savedLooksMocks.listSavedLooksPageFromWeb.mock.calls.length
        ).toBeGreaterThanOrEqual(4)
      )
    } finally {
      verifiedSession.owner = null
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
      savedLooksMocks.listSavedLooksPageFromWeb.mockReset().mockResolvedValue({
        data: [],
        total: 0,
        limit: 50,
        offset: 0,
      })
    }
  })
})

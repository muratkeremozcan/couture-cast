// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-UNIT-CLOSET-001 and the screen gate (D8: the Closet shows
// no saved looks row, reads no saved looks and its gate waits on the closet only).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-CLOSET-001 to 7.11-CMP-CLOSET-009 (D4 to D6: setup and
// Silhouette moved from the Closet body into the top bar More menu and the Silhouette route).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
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
import React, { useSyncExternalStore } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type {
  GarmentItemContract,
  SilhouetteProfileContract,
  SuggestGarmentTagsData,
  UpdateGarmentTagsInput,
  WardrobeOnboardingStateContract,
} from '@couture/api-client/contracts/http'
import { createSuggestGarmentTagsDataFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/browser-persistence'
import { screenSnapshot } from '../../lib/screen-snapshot'
import { currentWebSessionScope } from '../../lib/use-web-session'
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

// Story CC-7.11 D11: the top bar back reads the router.
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
import WardrobeSilhouettePage from './silhouette/page'
import enUS from '../../i18n/locales/en-US.json'

/** Story CC-7.11 D5: opens the Closet top bar More menu (if closed) and returns its setup item. */
async function openMoreSetupItem() {
  const more = await screen.findByTestId('closet-more-menu')
  if (more.getAttribute('aria-expanded') !== 'true') {
    act(() => {
      more.click()
    })
  }
  return screen.getByTestId('closet-more-setup')
}

beforeEach(stubGarmentPreviewUrl)
// Story CC-7.7: the Closet snapshot lives in module memory; each test starts without one.
beforeEach(() => screenSnapshot.clear())
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
    await screen.findByText('No pieces yet')
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

  it('leaves an unfamiliar status off the card', async () => {
    // Review P2-11: the status list is an open set; a newer backend code is diagnostic data.
    const unfamiliar = garmentFixture('unfamiliar-status-1', 'ready', {
      status: 'quarantine_review' as GarmentItemContract['status'],
    })
    listGarmentsFromWeb.mockReset().mockResolvedValue([unfamiliar])

    render(<WardrobePage />)

    const card = await screen.findByTestId(`garment-card-${unfamiliar.id}`)
    expect(within(card).queryByTestId(/^garment-status-/)).toBeNull()
    expect(card).not.toHaveTextContent(/quarantine/i)
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

  // Story CC-7.11 D4, D5: the setup banner left the space above the grid; setup progress now
  // shows in the top bar More menu, whose setup item reads "Closet setup: done" once completed.
  it('7.11-CMP-CLOSET-001 offers Closet setup from the More menu, with no banner above the grid, while onboarding is not completed', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(
      onboardingState({ status: 'in_progress' })
    )
    render(<WardrobePage />)

    await screen.findByText('No pieces yet')
    await waitFor(() => expect(getOnboardingStateFromWeb).toHaveBeenCalled())
    expect(
      screen.queryByRole('link', { name: 'Set up your closet' })
    ).not.toBeInTheDocument()
    const setup = await openMoreSetupItem()
    expect(setup).toHaveTextContent(/^Closet setup$/)
    expect(setup).toHaveAttribute('href', '/wardrobe/onboarding')
  })

  it('7.11-CMP-CLOSET-002 marks Closet setup done in the More menu once onboarding is completed', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(
      onboardingState({ status: 'completed', currentStep: 'complete' })
    )
    render(<WardrobePage />)

    await screen.findByText('No pieces yet')
    expect(
      screen.queryByRole('link', { name: 'Set up your closet' })
    ).not.toBeInTheDocument()
    await openMoreSetupItem()
    await waitFor(() =>
      expect(screen.getByTestId('closet-more-setup')).toHaveTextContent(
        /^Closet setup: done$/
      )
    )
    expect(screen.getByTestId('closet-more-setup')).toHaveAttribute(
      'href',
      '/wardrobe/onboarding'
    )
  })

  it('does not break the wardrobe hub when the onboarding status fetch fails', async () => {
    getOnboardingStateFromWeb.mockRejectedValue(new Error('network down'))
    render(<WardrobePage />)

    await screen.findByText('No pieces yet')
    expect(
      screen.queryByRole('link', { name: 'Set up your closet' })
    ).not.toBeInTheDocument()
    // CC-7.11 D5: setup stays reachable from More, unmarked, when the progress is unknown.
    const setup = await openMoreSetupItem()
    expect(setup).toHaveTextContent(/^Closet setup$/)
    expect(setup).toHaveAttribute('href', '/wardrobe/onboarding')
  })

  it('surfaces a visible, retryable error instead of silently hiding the onboarding entry point', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockRejectedValueOnce(new Error('network down'))
    render(<WardrobePage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("We can't check your closet setup yet.")

    // CC-7.11 D5: the Retry's answer is the only way the setup item can read done.
    getOnboardingStateFromWeb.mockResolvedValueOnce(
      onboardingState({ status: 'completed', currentStep: 'complete' })
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await openMoreSetupItem()
    await waitFor(() =>
      expect(screen.getByTestId('closet-more-setup')).toHaveTextContent(
        /^Closet setup: done$/
      )
    )
  })

  // CodeRabbit round 2 on PR 292 (#10): the automatic read and Retry share one request sequence.
  it('7.7-CMP-053 an automatic onboarding read that is older than a Retry never overwrites its answer', async () => {
    const user = userEvent.setup()
    verifiedSession.owner = 'onboarding-member'
    window.sessionStorage.setItem(
      WEB_ACCESS_TOKEN_STORAGE_KEY,
      'test-token-onboarding-member'
    )
    onTestFinished(() => {
      verifiedSession.owner = null
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    })
    const automatic = Promise.withResolvers<WardrobeOnboardingStateContract>()
    getOnboardingStateFromWeb
      // The mount's read fails, so the page reads again once the session is verified.
      .mockRejectedValueOnce(new Error('network down'))
      // That automatic read is slow.
      .mockReturnValueOnce(automatic.promise)
      // The member's Retry, sent after it, answers first. CC-7.11 D5: completed, so the More
      // menu's setup item is the evidence that this answer landed.
      .mockResolvedValueOnce(
        onboardingState({ status: 'completed', currentStep: 'complete' })
      )
    render(<WardrobePage />)
    await screen.findByRole('alert')

    // The same member is verified again: the automatic read goes out, and Retry is still offered.
    act(() => {
      window.dispatchEvent(new Event('couture:session'))
    })
    await waitFor(() => expect(getOnboardingStateFromWeb).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await openMoreSetupItem()
    await waitFor(() =>
      expect(screen.getByTestId('closet-more-setup')).toHaveTextContent(
        /^Closet setup: done$/
      )
    )

    // The older automatic read fails late: the Retry's answer stays, with no error.
    await act(async () => {
      automatic.reject(new Error('late onboarding failure'))
      await automatic.promise.catch(() => undefined)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('closet-more-setup')).toHaveTextContent(
      /^Closet setup: done$/
    )
  })

  // Story CC-7.11 D6: the Silhouette modal on the Closet became the `/wardrobe/silhouette` route;
  // the More menu links there and Escape returns focus to More.
  it('7.11-CMP-CLOSET-003 opens Silhouette from the More menu as the Silhouette route and returns focus to More on Escape', async () => {
    const user = userEvent.setup()
    getOnboardingStateFromWeb.mockResolvedValue(onboardingState({ status: 'completed' }))
    render(<WardrobePage />)

    await screen.findByText('No pieces yet')
    expect(screen.queryByRole('button', { name: 'Silhouette' })).toBeNull()
    await openMoreSetupItem()
    const silhouette = screen.getByRole('menuitem', { name: 'Silhouette' })
    expect(silhouette).toHaveAttribute('href', '/wardrobe/silhouette')
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('closet-more-menu')).toHaveFocus()
  })

  it('7.11-CMP-CLOSET-004 offers Silhouette before the signed-in user id has resolved, since the route reads its own account', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(onboardingState({ status: 'completed' }))
    resolveCurrentUserId.mockReset().mockReturnValue(new Promise(() => undefined))
    render(<WardrobePage />)

    await openMoreSetupItem()
    const silhouette = screen.getByRole('menuitem', { name: 'Silhouette' })
    expect(silhouette).toHaveAttribute('href', '/wardrobe/silhouette')
    expect(silhouette).not.toHaveAttribute('aria-disabled')
    expect(resolveCurrentUserId).toHaveBeenCalled()
  })

  it('7.11-CMP-CLOSET-005 surfaces the account error and still links Silhouette to its route when resolving the user id fails', async () => {
    getOnboardingStateFromWeb.mockResolvedValue(onboardingState({ status: 'completed' }))
    resolveCurrentUserId.mockReset().mockRejectedValue(new Error('unauthorized'))
    render(<WardrobePage />)

    await screen.findByRole('alert')
    await openMoreSetupItem()
    expect(screen.getByRole('menuitem', { name: 'Silhouette' })).toHaveAttribute(
      'href',
      '/wardrobe/silhouette'
    )
  })

  // The busy guard lived on the Closet modal's close; on the route the panel stays mounted while
  // a My Form upload is in flight and the screen announces the save (CC-7.11 D6).
  it('7.11-CMP-CLOSET-006 the Silhouette route keeps the panel and announces the save while a My Form upload is still in flight', async () => {
    const user = userEvent.setup()
    verifiedSession.owner = 'silhouette-member'
    window.sessionStorage.setItem(
      WEB_ACCESS_TOKEN_STORAGE_KEY,
      'test-token-silhouette-member'
    )
    onTestFinished(() => {
      verifiedSession.owner = null
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    })
    uploadMyFormPhotoFromWeb.mockReturnValue(new Promise(() => undefined))
    render(<WardrobeSilhouettePage />)

    expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent(/^Silhouette$/)
    expect(screen.getByTestId('app-top-bar-back')).toHaveAttribute('href', '/wardrobe')
    await screen.findByLabelText('Height')

    await user.click(screen.getByLabelText(/I'm wearing plain white or black clothing/))
    await user.click(screen.getByRole('button', { name: 'Upload a full-body photo' }))
    await user.upload(
      screen.getByLabelText('My Form photo file', { selector: 'input' }),
      new File(['x'.repeat(20)], 'photo.png', { type: 'image/png' })
    )
    await screen.findByText('Processing your photo…')

    await waitFor(() =>
      expect(screen.getByText(enUS.wardrobe.hub.silhouetteSaving)).toBeInTheDocument()
    )
    expect(screen.getByLabelText('Height')).toBeInTheDocument()
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
    expect(screen.queryByText('Loading your closet')).not.toBeInTheDocument()
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

    await screen.findByText("We can't check your closet setup yet.")
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    // A retry that also fails must leave the affordance in place; dropping the
    // banner would strand an incomplete user with no route into setup.
    await waitFor(() => expect(getOnboardingStateFromWeb).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByText("We can't check your closet setup yet.")
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
    await screen.findByText('Loading your closet')
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

    await screen.findByText('No pieces yet')
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
    expect(screen.queryByText('No pieces yet')).not.toBeInTheDocument()
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
    expect(await screen.findByText('No pieces yet')).toBeVisible()
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
    expect(screen.getByTestId(`garment-open-${pending.id}`)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to outfit' })).toHaveAttribute(
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

    const check = await screen.findByRole('button', {
      name: /Processing\. Check your piece/,
    })
    expect(window.location.search).toBe('?from=home')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(check)

    const card = screen.getByTestId(`garment-card-${processing.id}`)
    expect(await within(card).findByTestId(`garment-open-${processing.id}`)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to outfit' })).toBeVisible()
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
    expect(await screen.findByText('Loading your closet')).toBeVisible()

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

  it('7.16 filters the Closet by category and restores the full grid with All', async () => {
    const user = userEvent.setup()
    listGarmentsFromWeb.mockResolvedValue([
      garmentFixture('tee', 'ready', { category: 'top' }),
      garmentFixture('trousers', 'ready', { category: 'bottom' }),
    ])
    render(<WardrobePage />)

    const tops = await screen.findByTestId('closet-category-top')
    const all = screen.getByTestId('closet-category-all')
    expect(all).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('garment-card-tee')).toBeVisible()
    expect(screen.getByTestId('garment-card-trousers')).toBeVisible()

    await user.click(tops)
    expect(tops).toHaveAttribute('aria-pressed', 'true')
    expect(all).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('garment-card-tee')).toBeVisible()
    expect(screen.queryByTestId('garment-card-trousers')).not.toBeInTheDocument()

    await user.click(all)
    expect(all).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('garment-card-trousers')).toBeVisible()
  })

  it('opens the capture modal from the empty-state call to action', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)

    await user.click(await screen.findByRole('button', { name: 'Add a photo' }))

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

    const replace = await screen.findByRole('button', {
      name: /Failed\. Choose another photo/,
    })
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

    expect(await screen.findByText("We couldn't update your closet.")).toBeInTheDocument()
  })
})

describe('WardrobePage commit reconciliation', () => {
  beforeEach(resetWardrobeMocks)

  it('defers tagging until the capture modal closes on an awaiting_tags commit', async () => {
    const user = userEvent.setup()
    render(<WardrobePage />)
    await screen.findByText('No pieces yet')

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
    await screen.findByText('No pieces yet')

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
    const previousUrl = window.location.href
    const previousHistory = window.history.state as unknown
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
      const openDetail = await screen.findByTestId(`garment-open-${anchor.id}`)
      await commitGarmentThroughCapture(
        user,
        processing,
        screen.getByRole('button', { name: '+ Add Garment' })
      )
      await user.click(screen.getByRole('button', { name: 'Done' }))
      await waitFor(() => expect(listGarmentsFromWeb).toHaveBeenCalledTimes(2))
      await user.click(openDetail)
      await user.click(await screen.findByTestId('style-piece-open'))
      const panel = await screen.findByRole('dialog', { name: 'Style this piece' })
      await waitFor(() => expect(listGarmentsFromWeb).toHaveBeenCalledTimes(3))
      const card = screen.getByTestId(`garment-card-${processing.id}`)
      await act(async () => {
        poll.resolve([anchor, ready])
        await poll.promise
      })
      expect(within(card).getByTestId(`garment-open-${processing.id}`)).toBeEnabled()

      await act(async () => {
        styling.resolve([anchor, processing])
        await styling.promise
      })
      expect(within(card).getByTestId(`garment-open-${processing.id}`)).toBeEnabled()
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
      expect(within(card).getByTestId(`garment-open-${processing.id}`)).toBeEnabled()
    } finally {
      cleanup()
      window.history.replaceState(previousHistory, '', previousUrl)
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
    await screen.findByText('No pieces yet')

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
    await screen.findByText('No pieces yet')

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
    await screen.findByText('No pieces yet')

    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-poll', 'processing'),
      screen.getByRole('button', { name: '+ Add Garment' })
    )

    // Same reason as above: the rendered status proves the poll settled.
    await screen.findByTestId('garment-open-garment-poll')
    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.getByTestId('garment-open-garment-poll')).toBeInTheDocument()
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
    await screen.findByText('No pieces yet')

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
    await user.click(
      screen.getByRole('button', { name: /Processing\. Check your piece/ })
    )
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
    await screen.findByText('No pieces yet')

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
    await screen.findByText('No pieces yet')

    await commitGarmentThroughCapture(
      user,
      garmentFixture('garment-poll', 'processing'),
      screen.getByRole('button', { name: '+ Add Garment' })
    )
    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(
      await screen.findByText("We couldn't check this piece again.")
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
      await screen.findByRole('button', { name: 'Add a photo' })
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

    await screen.findByText('No pieces yet')
    expect(
      screen.queryByRole('link', { name: 'Set up your closet' })
    ).not.toBeInTheDocument()
    // CC-7.11 D5: the remount's own completed read marks setup done in the More menu; the
    // torn-down instance's late in_progress answer never reaches it.
    await openMoreSetupItem()
    await waitFor(() =>
      expect(screen.getByTestId('closet-more-setup')).toHaveTextContent(
        /^Closet setup: done$/
      )
    )
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
      await screen.findByRole('button', { name: 'Add a photo' })
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

  // Story CC-7.12 D8 (7.12-E2E-016 at unit level): saved looks left the Closet for Looks, so the
  // Closet shows no saved looks row and sends no saved looks read, even for a member with looks.
  // Replaces the CC-7.2 "loads, paginates, refreshes on change notifications, and retries failed
  // Closet saved looks" case; that behaviour is on the Looks tab (app/looks/page.test.tsx) and
  // the saved look detail (components/looks/saved-look-detail-screen.test.tsx).
  it('7.12-UNIT-CLOSET-001 shows no saved looks row and reads no saved looks', async () => {
    verifiedSession.owner = 'member-saved-looks'
    window.sessionStorage.setItem(
      WEB_ACCESS_TOKEN_STORAGE_KEY,
      'test-token-member-saved-looks'
    )
    window.dispatchEvent(new Event('couture:session'))
    savedLooksMocks.listSavedLooksPageFromWeb.mockClear()
    listGarmentsFromWeb.mockReset().mockResolvedValue([persistedGarment])
    try {
      render(<WardrobePage />)
      expect(
        await screen.findByTestId(`garment-card-${persistedGarment.id}`)
      ).toBeInTheDocument()

      act(() => {
        for (const listener of savedLooksMocks.listeners) listener('member-saved-looks')
      })
      expect(screen.queryByTestId('closet-saved-looks-row')).toBeNull()
      expect(screen.queryByTestId('closet-saved-looks-list')).toBeNull()
      expect(screen.queryByTestId('saved-looks-load-more')).toBeNull()
      expect(screen.queryByTestId('saved-looks-retry')).toBeNull()
      expect(savedLooksMocks.listSavedLooksPageFromWeb).not.toHaveBeenCalled()
    } finally {
      verifiedSession.owner = null
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    }
  })
})

// Story CC-7.7 D3 (7.7-CMP-006): the Closet body appears once the closet has answered (CC-7.12
// D8: the saved looks read left the Closet), so nothing is inserted above the grid afterwards. The measured budget is
// 7.7-E2E-001. Story CC-7.11 D4, D5 and TEA d: the setup banner left the body; the setup progress
// only names the top bar More menu's Closet setup item, which sits outside the gate and updates
// in place, and the account and setup notices sit below the closet, so neither the setup progress
// nor the account read holds the gate.
describe('WardrobePage screen gate', () => {
  beforeEach(() => {
    resetWardrobeMocks()
    document.documentElement.setAttribute('data-session', 'member')
    verifiedSession.owner = 'gate-member'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-gate-member')
    window.dispatchEvent(new Event('couture:session'))
  })

  afterEach(() => {
    cleanup()
    verifiedSession.owner = null
    window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    document.documentElement.removeAttribute('data-session')
  })

  it('7.7-CMP-006 waits for the closet only, then the setup progress updates the More menu in place with no setup banner above the grid', async () => {
    const inventory = Promise.withResolvers<GarmentItemContract[]>()
    const onboarding = Promise.withResolvers<WardrobeOnboardingStateContract>()
    listGarmentsFromWeb.mockReset().mockReturnValue(inventory.promise)
    getOnboardingStateFromWeb.mockReset().mockReturnValue(onboarding.promise)
    render(<WardrobePage />)

    const gate = screen.getByTestId('screen-gate')
    expect(gate).toHaveAttribute('data-screen', 'closet')
    expect(screen.getByTestId('screen-placeholder')).toBeVisible()
    expect(screen.getByTestId('wardrobe-closet-view')).not.toBeVisible()

    await act(async () => {
      inventory.resolve([])
      await inventory.promise
    })
    // The closet answered; the setup progress has not, and the body is revealed anyway.
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    expect(screen.getByTestId('wardrobe-closet-view')).toBeVisible()
    expect(screen.getByTestId('screen-placeholder')).not.toBeVisible()
    expect(getOnboardingStateFromWeb).toHaveBeenCalled()
    expect(await openMoreSetupItem()).toHaveTextContent(/^Closet setup$/)

    await act(async () => {
      onboarding.resolve(
        onboardingState({ status: 'completed', currentStep: 'complete' })
      )
      await onboarding.promise
    })
    // The late progress lands in the top bar item, never as a banner above the grid.
    await waitFor(() =>
      expect(screen.getByTestId('closet-more-setup')).toHaveTextContent(
        /^Closet setup: done$/
      )
    )
    expect(gate).toHaveAttribute('data-ready', 'true')
    expect(
      screen.queryByRole('link', { name: 'Set up your closet', hidden: true })
    ).toBeNull()
    expect(screen.getByTestId('wardrobe-closet-view')).toBeVisible()
  })

  // Story CC-7.12 D8: the Closet no longer reads saved looks, so the gate waits on the closet
  // read only (the saved looks read and its "3 saved" evidence left with the row).
  type GateRead = 'garments' | 'onboarding' | 'profile'
  const GATE_READS: GateRead[] = ['garments', 'onboarding', 'profile']

  /**
   * Holds one of the gate's four reads (or none, the control); the others answer at once with
   * values that leave evidence on the page. Returns the release.
   */
  /** Reads whose answer has been handed to the page (CC-7.11: the account read shows nothing). */
  const answered = new Set<GateRead>()

  function holdOneRead(read: GateRead | 'none') {
    const held = Promise.withResolvers<void>()
    answered.clear()
    const answer = <T,>(name: GateRead, value: T) =>
      (read === name ? held.promise.then(() => value) : Promise.resolve(value)).then(
        (result) => {
          answered.add(name)
          return result
        }
      )
    listGarmentsFromWeb
      .mockReset()
      .mockImplementation(() => answer('garments', [persistedGarment]))
    getOnboardingStateFromWeb
      .mockReset()
      .mockImplementation(() =>
        answer(
          'onboarding',
          onboardingState({ status: 'completed', currentStep: 'complete' })
        )
      )
    resolveCurrentUserId
      .mockReset()
      .mockImplementation(() => answer('profile', 'user-hub-1'))
    savedLooksMocks.listSavedLooksPageFromWeb.mockClear()
    return held
  }

  /** Positive evidence that an answered read landed, rendered under the closed gate. */
  function expectLanded(read: GateRead) {
    switch (read) {
      case 'garments':
        expect(listGarmentsFromWeb).toHaveBeenCalled()
        expect(
          screen.getByTestId(`garment-card-${persistedGarment.id}`)
        ).toBeInTheDocument()
        return
      case 'onboarding': {
        // CC-7.11 D5: the top bar sits outside the gate; its More menu marks setup done once
        // the completed progress lands.
        expect(getOnboardingStateFromWeb).toHaveBeenCalled()
        const more = screen.getByTestId('closet-more-menu')
        if (more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more)
        expect(screen.getByTestId('closet-more-setup')).toHaveTextContent(
          /^Closet setup: done$/
        )
        return
      }
      case 'profile':
        // CC-7.11 D6: Silhouette left the Closet for its route, so the account read renders
        // nothing here; its answer having been handed to the page is the evidence.
        expect(resolveCurrentUserId).toHaveBeenCalled()
        expect(answered.has('profile')).toBe(true)
    }
  }

  it('7.7-CMP-006 control: with every read answered the gate opens once they land', async () => {
    holdOneRead('none')
    render(<WardrobePage />)
    const gate = screen.getByTestId('screen-gate')

    await waitFor(() => {
      for (const read of GATE_READS) expectLanded(read)
    })
    await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
    expect(screen.getByTestId('wardrobe-closet-view')).toBeVisible()
    expect(
      screen.queryByRole('link', { name: 'Set up your closet', hidden: true })
    ).toBeNull()
    // CC-7.12 D8: the gate opened with no saved looks read at all.
    expect(savedLooksMocks.listSavedLooksPageFromWeb).not.toHaveBeenCalled()
    expect(screen.queryByTestId('closet-saved-looks-row')).toBeNull()
  })

  // CC-7.7 D3, CC-7.12 D8: the closet is the one read the gate waits for.
  const HOLDING_READS: GateRead[] = ['garments']
  // CC-7.11 TEA d: the setup progress and the account read land after the reveal, in place.
  const LATE_READS: GateRead[] = ['onboarding', 'profile']

  it.each(HOLDING_READS)(
    '7.7-CMP-006 stays closed while the %s read is unanswered and the others have landed, then opens',
    async (read) => {
      const held = holdOneRead(read)
      render(<WardrobePage />)
      const gate = screen.getByTestId('screen-gate')

      // Judge the gate only once every answered read has visibly landed under it.
      await waitFor(() => {
        for (const other of GATE_READS) if (other !== read) expectLanded(other)
      })
      expect(gate).not.toHaveAttribute('data-ready')
      expect(screen.getByTestId('screen-placeholder')).toBeVisible()
      expect(screen.getByTestId('wardrobe-closet-view')).not.toBeVisible()

      await act(async () => {
        held.resolve()
        await held.promise
      })
      await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
      expectLanded(read)
      expect(screen.getByTestId('wardrobe-closet-view')).toBeVisible()
      expect(screen.getByTestId('screen-placeholder')).not.toBeVisible()
    }
  )

  it.each(LATE_READS)(
    '7.11-CMP-CLOSET-009 opens while the %s read is unanswered, and its answer lands in place without closing the gate',
    async (read) => {
      const held = holdOneRead(read)
      render(<WardrobePage />)
      const gate = screen.getByTestId('screen-gate')

      await waitFor(() => {
        for (const other of GATE_READS) if (other !== read) expectLanded(other)
      })
      await waitFor(() => expect(gate).toHaveAttribute('data-ready', 'true'))
      expect(answered.has(read), `the ${read} read is still held`).toBe(false)
      expect(screen.getByTestId('wardrobe-closet-view')).toBeVisible()
      expect(screen.getByTestId('screen-placeholder')).not.toBeVisible()

      await act(async () => {
        held.resolve()
        await held.promise
      })
      await waitFor(() => expectLanded(read))
      expect(gate).toHaveAttribute('data-ready', 'true')
      expect(screen.getByTestId('wardrobe-closet-view')).toBeVisible()
      expect(
        screen.queryByRole('link', { name: 'Set up your closet', hidden: true })
      ).toBeNull()
    }
  )

  // Codex review of 8327b4fb, P2-1: the e2e fixture bearers share one owner, so the owner check
  // alone let a closet read sent with one fixture bearer land for the next.
  it('7.7-CMP-019 a closet read sent with one fixture bearer never lands for the next, on screen or in the snapshot', async () => {
    screenSnapshot.clear()
    onTestFinished(() => {
      screenSnapshot.clear()
      vi.unstubAllEnvs()
    })
    verifiedSession.owner = null
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-fixture-a')
    window.dispatchEvent(new Event('couture:session'))
    const fixtureA = garmentFixture('garment-fixture-a', 'ready')
    const fixtureB = garmentFixture('garment-fixture-b', 'ready')
    const listForA = Promise.withResolvers<GarmentItemContract[]>()
    listGarmentsFromWeb
      .mockReset()
      .mockReturnValueOnce(listForA.promise)
      .mockResolvedValue([fixtureB])
    render(<WardrobePage />)
    await waitFor(() => expect(listGarmentsFromWeb).toHaveBeenCalledTimes(1))

    // The tab switches fixture members while A's closet read is still out.
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-fixture-b')
    await act(async () => {
      listForA.resolve([fixtureA])
      await listForA.promise
    })

    expect(await screen.findByTestId(`garment-card-${fixtureB.id}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`garment-card-${fixtureA.id}`)).not.toBeInTheDocument()
    expect(listGarmentsFromWeb).toHaveBeenCalledTimes(2)
    await waitFor(() =>
      expect(
        screenSnapshot
          .recall<{
            garments: GarmentItemContract[]
          }>(currentWebSessionScope(), 'closet', 'closet')
          ?.garments.map((garment) => garment.id)
      ).toEqual([fixtureB.id])
    )
  })

  /** The e2e fixture member, with its first bearer in the tab. */
  function signInFixtureA() {
    screenSnapshot.clear()
    onTestFinished(() => {
      screenSnapshot.clear()
      vi.unstubAllEnvs()
    })
    verifiedSession.owner = null
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-fixture-a')
    window.dispatchEvent(new Event('couture:session'))
  }

  /** The tab switches fixture members (one owner, a new bearer), as the e2e fixtures do. */
  const switchBearer = (token: string) =>
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, token)

  // CodeRabbit round 1 on PR 292 (#14): the closet read is retried once for the bearer the tab
  // holds; when that one is overtaken too, the read used to return with nothing on screen.
  it('7.7-CMP-040 a closet read overtaken by a second bearer switch shows the load error and Retry, never a blank closet', async () => {
    signInFixtureA()
    const fixtureA = garmentFixture('garment-fixture-a', 'ready')
    const fixtureB = garmentFixture('garment-fixture-b', 'ready')
    const listForA = Promise.withResolvers<GarmentItemContract[]>()
    const listForB = Promise.withResolvers<GarmentItemContract[]>()
    listGarmentsFromWeb
      .mockReset()
      .mockReturnValueOnce(listForA.promise)
      .mockReturnValueOnce(listForB.promise)
      .mockResolvedValue([])
    render(<WardrobePage />)
    await waitFor(() => expect(listGarmentsFromWeb).toHaveBeenCalledTimes(1))

    switchBearer('test-token-fixture-b')
    await act(async () => {
      listForA.resolve([fixtureA])
      await listForA.promise
    })
    await waitFor(() => expect(listGarmentsFromWeb).toHaveBeenCalledTimes(2))
    switchBearer('test-token-fixture-c')
    await act(async () => {
      listForB.resolve([fixtureB])
      await listForB.promise
    })

    expect(await screen.findByTestId('wardrobe-list-retry')).toBeVisible()
    expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
    expect(screen.queryByTestId(`garment-card-${fixtureA.id}`)).toBeNull()
    expect(screen.queryByTestId(`garment-card-${fixtureB.id}`)).toBeNull()
    expect(listGarmentsFromWeb).toHaveBeenCalledTimes(2)
  })

  // CodeRabbit round 1 on PR 292 (#15): the account read had no scope guard, so an answer read
  // with the last fixture bearer landed for the next, on screen and in its Closet snapshot.
  it('7.7-CMP-041 an account read sent with one fixture bearer never lands for the next, on screen or in the snapshot', async () => {
    signInFixtureA()
    const remember = vi.spyOn(screenSnapshot, 'remember')
    onTestFinished(() => remember.mockRestore())
    const fixtureB = garmentFixture('garment-fixture-b', 'ready')
    const accountForA = Promise.withResolvers<string>()
    resolveCurrentUserId
      .mockReset()
      .mockReturnValueOnce(accountForA.promise)
      .mockResolvedValue('user-fixture-b')
    const listForA = Promise.withResolvers<GarmentItemContract[]>()
    listGarmentsFromWeb
      .mockReset()
      .mockReturnValueOnce(listForA.promise)
      .mockResolvedValue([fixtureB])
    render(<WardrobePage />)
    await waitFor(() => expect(resolveCurrentUserId).toHaveBeenCalledTimes(1))

    // The bearer switches while A's account read is out; the closet reloads for B.
    switchBearer('test-token-fixture-b')
    await act(async () => {
      listForA.resolve([])
      await listForA.promise
    })
    expect(await screen.findByTestId(`garment-card-${fixtureB.id}`)).toBeInTheDocument()

    // A's account read answers last: it is dropped and the account is read again for B.
    await act(async () => {
      accountForA.resolve('user-fixture-a')
      await accountForA.promise
    })
    await waitFor(() => expect(resolveCurrentUserId).toHaveBeenCalledTimes(2))
    const keptUserId = () =>
      screenSnapshot.recall<{ userId: string | null }>(
        currentWebSessionScope(),
        'closet',
        'closet'
      )?.userId
    await waitFor(() => expect(keptUserId()).toBe('user-fixture-b'))
    // CC-7.11 D6: no Silhouette button reads the account on the Closet any more; B's account
    // answered, so no account error shows either.
    expect(screen.queryByText(/Unable to load your account/)).toBeNull()
    const storedUserIds = remember.mock.calls
      .filter(([, screenName, part]) => screenName === 'closet' && part === 'closet')
      .map(([, , , value]) => (value as { userId: string | null }).userId)
    expect(storedUserIds).not.toContain('user-fixture-a')
  })
})

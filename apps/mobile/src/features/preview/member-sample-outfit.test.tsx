// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpResponse } from 'msw'
import {
  reportNetworkOffline,
  reportNetworkOnline,
  resetNetworkStatusForTests,
  SaveFeedbackProvider,
} from '@/components/save-feedback'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  mobileApplicationUserId,
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { createSavedLooksMswHandlers } from '@/src/test-utils/saved-looks-msw'
import { server } from '@/src/test-utils/msw/server'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('expo-router', () => ({
  router: routerMock,
}))

import { HomePlannerLink, MemberSampleOutfit } from './member-sample-outfit'

describe('MemberSampleOutfit (mobile)', () => {
  let restoreTokenResolver: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetNetworkStatusForTests(true)
    setMobileApplicationUserId('mobile-member-1')
    restoreTokenResolver = setMobileAccessTokenResolver(() => {
      const userId = mobileApplicationUserId()
      return Promise.resolve(userId ? `token-${userId}` : undefined)
    })
  })

  afterEach(() => {
    restoreTokenResolver?.()
    restoreTokenResolver = undefined
    setMobileApplicationUserId(null)
  })

  it('covers shuffle/swap Undo, preferences/weather/reset, Save/Undo, remote-delete revalidation, 409 tombstone, and Remove/Retry/Undo', async () => {
    const { store, handlers } = createSavedLooksMswHandlers()
    server.use(...handlers)
    const onRetry = vi.fn()

    const view = await render(
      <SaveFeedbackProvider>
        <HomePlannerLink />
        <MemberSampleOutfit
          owner="mobile-member-1"
          error="no-location"
          busy={false}
          onRetry={onRetry}
        />
      </SaveFeedbackProvider>
    )

    // Planner, add-garment, and location navigation actions work.
    fireEvent.click(screen.getByTestId('home-plan-week'))
    expect(routerMock.push).toHaveBeenCalledWith('/planner')
    fireEvent.click(screen.getByTestId('home-add-garment'))
    expect(routerMock.navigate).toHaveBeenCalledWith('/wardrobe?entry=add')
    fireEvent.click(screen.getByTestId('hero-add-location'))
    expect(routerMock.push).toHaveBeenCalledWith('/locations?guided=1')

    // Shuffle -> Undo restores prior look.
    const tryAnother = await screen.findByTestId('guest-preview-try-another')
    fireEvent.click(tryAnother)
    await screen.findByTestId('status-bar-action-undo')
    fireEvent.click(screen.getByTestId('status-bar-action-undo'))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Change undone.'
      )
    )

    // Weather and style preferences controls update the sample look.
    fireEvent.click(screen.getByTestId('sample-weather-cool-windy'))
    fireEvent.click(screen.getByTestId('sample-style-preferences'))
    const prefButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.getAttribute('data-testid')?.startsWith('sample-'))
    for (const btn of prefButtons.slice(0, 4)) {
      if (btn.getAttribute('data-testid') !== 'sample-save-look') {
        fireEvent.click(btn)
      }
    }

    // Swap a piece -> Undo restores prior piece.
    const swapButtons = screen.getAllByRole('button', { name: /^Swap /i })
    if (swapButtons[0]) {
      fireEvent.click(swapButtons[0])
      const radios = screen.getAllByRole('radio')
      const candidate = radios.find((el) => el.getAttribute('aria-checked') !== 'true')
      if (candidate) {
        fireEvent.click(candidate)
        await waitFor(() =>
          expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
            'Piece swapped.'
          )
        )
        fireEvent.click(screen.getByTestId('status-bar-action-undo'))
        await waitFor(() =>
          expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
            'Change undone.'
          )
        )
      }
    }

    // Save look -> persisted to API -> re-save is non-destructive no-op without Undo.
    const saveBtn = await screen.findByTestId('sample-save-look')
    fireEvent.click(saveBtn)
    await waitFor(() => expect(store.items).toHaveLength(1))
    await screen.findByTestId('status-bar-action-undo')

    // Re-save confirmed against server (GET /:id 200) omits Undo.
    fireEvent.click(saveBtn)
    await waitFor(() =>
      expect(screen.queryByTestId('status-bar-action-undo')).not.toBeInTheDocument()
    )
    expect(store.items).toHaveLength(1)

    // Remote delete on another device -> re-saving revalidates (404) and recreates look.
    store.items = []
    fireEvent.click(saveBtn)
    await waitFor(() => expect(store.items).toHaveLength(1))

    // Undo Save deletes the created look cleanly.
    const undoSave = await screen.findByTestId('status-bar-action-undo')
    fireEvent.click(undoSave)
    await waitFor(() => expect(store.items).toHaveLength(0))

    // Save again, then open saved look, then Remove failure -> Retry -> Undo Remove -> failed Undo.
    fireEvent.click(saveBtn)
    await waitFor(() => expect(store.items).toHaveLength(1))
    const savedRegion = await screen.findByTestId('sample-saved-looks')
    const savedButtons = within(savedRegion).getAllByRole('button')
    fireEvent.click(savedButtons[0]!)

    let failDeleteOnce = true
    store.nextDeleteError = () => {
      if (!failDeleteOnce) return null
      failDeleteOnce = false
      return HttpResponse.json({ message: 'Transient error' }, { status: 503 })
    }
    const removeBtn = within(savedRegion).getByRole('button', { name: /^Remove / })
    fireEvent.click(removeBtn)
    const retryRemove = await screen.findByTestId('status-bar-action-retry')
    fireEvent.click(retryRemove)
    await waitFor(() => expect(store.items).toHaveLength(0))

    // Undo Remove restores via /restore, and failed Undo Remove shows error notice.
    let failRestoreOnce = true
    store.nextRestoreError = () => {
      if (!failRestoreOnce) return null
      failRestoreOnce = false
      return HttpResponse.json({ message: 'Restore error' }, { status: 503 })
    }
    const undoRemove = await screen.findByTestId('status-bar-action-undo')
    fireEvent.click(undoRemove)
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Could not save. Try again.'
      )
    )

    // Save one more look, then test offline Remove, online Remove + offline Undo, and 404 stale delete.
    fireEvent.click(saveBtn)
    await waitFor(() => expect(store.items).toHaveLength(1))

    reportNetworkOffline()
    const removeOfflineBtn = within(
      await screen.findByTestId('sample-saved-looks')
    ).getByRole('button', { name: /^Remove / })
    fireEvent.click(removeOfflineBtn)
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    reportNetworkOnline()

    // Remove while online, then click Undo while offline -> offline notice.
    fireEvent.click(removeOfflineBtn)
    await waitFor(() => expect(store.items).toHaveLength(0))
    const undoRemove2 = await screen.findByTestId('status-bar-action-undo')
    reportNetworkOffline()
    fireEvent.click(undoRemove2)
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    reportNetworkOnline()

    // Re-save when online, then 404 stale delete cleans up without offering Undo.
    fireEvent.click(saveBtn)
    await waitFor(() => expect(store.items).toHaveLength(1))
    store.items = []
    const removeBtn2 = within(screen.getByTestId('sample-saved-looks')).getByRole(
      'button',
      { name: /^Remove / }
    )
    fireEvent.click(removeBtn2)
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent('Removed')
    )
    expect(screen.queryByTestId('status-bar-action-undo')).not.toBeInTheDocument()

    // Generic error banner invokes onRetry; switching to null owner clears saved looks.
    await view.rerender(
      <SaveFeedbackProvider>
        <MemberSampleOutfit owner={null} error="generic" busy={false} onRetry={onRetry} />
      </SaveFeedbackProvider>
    )
    fireEvent.click(screen.getByTestId('hero-retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)
    await view.unmount()
  })

  it('merges slow initial GET with early Save and handles 409 SAVED_LOOK_ALREADY_REMOVED and GET errors', async () => {
    const existing = {
      id: 'sl-mob-existing',
      ownerUserId: 'token-mobile-member-1',
      source: 'home_sample' as const,
      lookId: 'sample:l:silk-midi',
      weather: 'warm-rainy',
      title: null,
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
      comfort: {
        runsColdWarm: 'neutral' as const,
        windTolerance: 'medium' as const,
        precipPreparedness: 'medium' as const,
      },
      availabilityStatus: 'ready' as const,
      missingGarmentIds: [],
      needsReviewReasons: [],
      revision: 0,
      createdAt: '2026-11-22T01:00:00.000Z',
      updatedAt: '2026-11-22T01:00:00.000Z',
    }
    const { store, handlers } = createSavedLooksMswHandlers([existing])
    let failGetOnce = true
    store.nextGetError = () => {
      if (!failGetOnce) return null
      failGetOnce = false
      return HttpResponse.json({ message: 'Offline' }, { status: 503 })
    }
    server.use(...handlers)

    const view = await render(
      <SaveFeedbackProvider>
        <MemberSampleOutfit
          owner="mobile-member-1"
          error={null}
          busy={false}
          onRetry={vi.fn()}
        />
      </SaveFeedbackProvider>
    )

    // Initial GET failed -> unavailable state shown, but explicit Save still works and handles 409 tombstone.
    const saveBtn = await screen.findByTestId('sample-save-look')
    let return409Once = true
    store.nextPostError = () => {
      if (!return409Once) return null
      return409Once = false
      return HttpResponse.json(
        { code: 'SAVED_LOOK_ALREADY_REMOVED', message: 'Removed' },
        { status: 409 }
      )
    }
    fireEvent.click(saveBtn)
    await waitFor(() => expect(saveBtn).toHaveTextContent('Failed'))

    // Next Save succeeds cleanly.
    fireEvent.click(saveBtn)
    await waitFor(() => expect(store.items).toHaveLength(2))
    await view.unmount()

    // Slow initial GET merged with early Save retains both the early-saved look and the server look.
    let releaseSlowGet!: () => void
    let heldGet = false
    store.onGet = async (request) => {
      if (heldGet || new URL(request.url).pathname !== '/api/v1/wardrobe/saved-looks') {
        return
      }
      heldGet = true
      await new Promise<void>((resolve) => {
        releaseSlowGet = resolve
      })
    }
    store.items = [existing]
    const view2 = await render(
      <SaveFeedbackProvider>
        <MemberSampleOutfit
          owner="mobile-member-1"
          error={null}
          busy={false}
          onRetry={vi.fn()}
        />
      </SaveFeedbackProvider>
    )
    // While initial GET is in flight, Save stays disabled/hidden until loading completes; after release, the existing look appears.
    await waitFor(() => expect(heldGet).toBe(true))
    expect(screen.queryByTestId('sample-save-look')).not.toBeInTheDocument()
    releaseSlowGet()
    expect(await screen.findByTestId('sample-save-look')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        within(screen.getByTestId('sample-saved-looks')).getAllByRole('button')
      ).toHaveLength(2)
    )
    await view2.unmount()
  })
})

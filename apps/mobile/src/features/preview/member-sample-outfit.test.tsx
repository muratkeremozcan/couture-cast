// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Learning path Step 75: Find mini skirts, tights and socks.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-75-find-mini-skirts-tights-and-socks
// Story CC-7.12 test owner (TEA): 7.12-NAT-023 (D7: the Home sample save confirmation gains View,
// which opens the saved look's own screen) and 7.12-NAT-031 (D11: Plan your week opens the Looks
// tab on Plan in one press).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
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

  it.each([
    { weather: 'cool-windy', weatherLabel: 'Cool and windy' },
    { weather: 'mild-dry', weatherLabel: 'Mild and dry' },
  ])(
    '[7.18-PICK-001/SAVE-001/SWAP-001] previews and saves a mini skirt with socks in $weatherLabel weather',
    async ({ weather, weatherLabel }) => {
      const { store, handlers } = createSavedLooksMswHandlers()
      server.use(...handlers)
      const view = await render(
        <SaveFeedbackProvider>
          <MemberSampleOutfit
            owner="mobile-member-1"
            error="no-location"
            busy={false}
            onRetry={vi.fn()}
          />
        </SaveFeedbackProvider>
      )

      await userEvent.click(screen.getByTestId('home-edit-sample'))
      await userEvent.click(screen.getByTestId(`sample-weather-${weather}`))
      expect(screen.getByTestId('guest-preview-weather-chip')).toHaveTextContent(
        weatherLabel
      )

      for (const { filter, id, label } of [
        { filter: 'skirts', id: 'mini-skirt', label: 'Mini skirt' },
        { filter: 'tights', id: 'opaque-tights', label: 'Opaque tights' },
      ]) {
        await userEvent.click(screen.getByTestId('guest-preview-browse-wardrobe'))
        expect(screen.getByTestId('guest-preview-collection-all')).toBeChecked()
        const category = screen.getByTestId(`guest-preview-category-${filter}`)
        await userEvent.click(category)
        expect(category).toBeChecked()
        await userEvent.click(screen.getByTestId(`guest-preview-item-${id}`))
        const detail = await screen.findByTestId('guest-preview-item-detail')
        expect(within(detail).getByRole('heading', { name: label })).toBeVisible()
        expect(within(detail).getByTestId('sample-garment-art')).toBeVisible()
        await userEvent.click(within(detail).getByTestId('guest-preview-use-item'))
        expect(await screen.findByTestId(`guest-preview-garment-${id}`)).toBeVisible()
      }

      const swapTrigger = screen.getByTestId('guest-preview-swap-accessory')
      await userEvent.click(swapTrigger)
      const sheet = await screen.findByTestId('guest-preview-swap-sheet')
      const selected = within(sheet).getByRole('radio', { checked: true })
      expect(selected).toHaveAccessibleName(/Opaque tights.*current/i)
      const socks = within(sheet).getByRole('group', { name: 'Socks' })
      expect(within(socks).getByRole('radio', { name: 'Ribbed socks' })).toBeVisible()
      await userEvent.click(selected)
      await waitFor(() =>
        expect(screen.queryByTestId('guest-preview-swap-sheet')).toBeNull()
      )
      expect(screen.getByTestId('guest-preview-garment-opaque-tights')).toBeVisible()

      await userEvent.click(swapTrigger)
      await userEvent.click(
        await screen.findByTestId('guest-preview-swap-option-ribbed-socks')
      )
      expect(
        await screen.findByTestId('guest-preview-garment-ribbed-socks')
      ).toBeVisible()
      expect(screen.queryByTestId('guest-preview-garment-opaque-tights')).toBeNull()

      const liveRegion = screen.getByTestId('save-feedback-announcer')
      expect(liveRegion).toHaveTextContent('Piece swapped.')
      const announcement = liveRegion.firstElementChild
      expect(announcement).not.toBeNull()
      await userEvent.click(swapTrigger)
      await userEvent.click(
        await screen.findByTestId('guest-preview-swap-option-ribbed-socks')
      )
      await waitFor(() =>
        expect(screen.queryByTestId('guest-preview-swap-sheet')).toBeNull()
      )
      expect(liveRegion.firstElementChild).toBe(announcement)
      await userEvent.click(screen.getByTestId('status-bar-action-undo'))
      expect(
        await screen.findByTestId('guest-preview-garment-opaque-tights')
      ).toBeVisible()
      expect(liveRegion).toHaveTextContent('Change undone.')

      await userEvent.click(swapTrigger)
      await userEvent.click(
        await screen.findByTestId('guest-preview-swap-option-ribbed-socks')
      )
      expect(
        await screen.findByTestId('guest-preview-garment-ribbed-socks')
      ).toBeVisible()
      await userEvent.click(await screen.findByTestId('sample-save-look'))
      await waitFor(() =>
        expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
          'Saved to your looks.'
        )
      )
      expect(store.items).toEqual([
        expect.objectContaining({
          collection: 'all',
          weather,
          swaps: expect.objectContaining({ accessory: 'sample:g:ribbed-socks' }),
          composition: expect.arrayContaining([
            expect.objectContaining({ itemId: 'sample:g:mini-skirt' }),
            expect.objectContaining({ itemId: 'sample:g:ribbed-socks' }),
          ]),
        }),
      ])

      await userEvent.click(swapTrigger)
      await userEvent.click(
        await screen.findByTestId('guest-preview-swap-option-opaque-tights')
      )
      expect(
        await screen.findByTestId('guest-preview-garment-opaque-tights')
      ).toBeVisible()
      const saved = within(await screen.findByTestId('sample-saved-looks'))
      await userEvent.click(
        saved.getByRole('button', { name: /^Mini skirt and tights$/ })
      )
      expect(await screen.findByTestId('guest-preview-garment-mini-skirt')).toBeVisible()
      expect(screen.getByTestId('guest-preview-garment-ribbed-socks')).toBeVisible()
      expect(screen.queryByTestId('guest-preview-garment-opaque-tights')).toBeNull()
      await view.unmount()
    }
  )

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

    fireEvent.click(screen.getByTestId('home-set-city'))
    expect(routerMock.push).toHaveBeenCalledWith('/locations?guided=1')
    fireEvent.click(screen.getByTestId('home-edit-sample'))

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

    // Swap from the picture and verify that Undo restores the original piece.
    const piece = screen.getByTestId('today-outfit-slot-0')
    const originalName = piece.getAttribute('aria-label')
    fireEvent.click(piece)
    const swap = await screen.findByTestId('today-outfit-swap')
    expect(within(swap).getByRole('radio', { checked: true })).toBeVisible()
    fireEvent.click(within(swap).getAllByRole('radio', { checked: false })[0]!)
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Piece swapped.'
      )
    )
    expect(piece.getAttribute('aria-label')).not.toBe(originalName)
    fireEvent.click(screen.getByTestId('status-bar-action-undo'))
    await waitFor(() =>
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Change undone.'
      )
    )
    expect(piece.getAttribute('aria-label')).toBe(originalName)

    // Every step below waits for the screen, never only for the fake API: the store changes
    // when a request lands, before the app has read the reply and rendered it, so a step that
    // acted on the store alone raced the render (CI 7c284e60 and e5d4cfa5, two steps of this case).
    const bar = () => screen.getByTestId('status-feedback-bar')
    const barSays = (text: string) => waitFor(() => expect(bar()).toHaveTextContent(text))
    const removeButtons = () =>
      within(screen.getByTestId('sample-saved-looks')).getAllByRole('button', {
        name: /^Remove /,
      })
    const savedLooksShown = (count: number) =>
      waitFor(() => {
        if (count === 0) expect(screen.queryByTestId('sample-saved-looks')).toBeNull()
        else expect(removeButtons()).toHaveLength(count)
      })
    const saved = async (count: number) => {
      await waitFor(() => expect(store.items).toHaveLength(count))
      await savedLooksShown(count)
    }
    // A save has settled when the bar holds its success notice, with Undo for a new look and
    // without it for a confirmed re-save. Mid-save the bar shows neither (Codex check 3), so
    // "no Undo" alone can pass before the save finishes.
    const saveSettled = (undoable: boolean) =>
      waitFor(() => {
        expect(bar()).toHaveTextContent('Saved to your looks.')
        if (undoable)
          expect(screen.getByTestId('status-bar-action-undo')).toBeInTheDocument()
        else
          expect(screen.queryByTestId('status-bar-action-undo')).not.toBeInTheDocument()
      })

    // Save look -> persisted to API -> re-save is non-destructive no-op without Undo.
    if (!screen.queryByTestId('guest-preview-try-another'))
      fireEvent.click(screen.getByTestId('home-edit-sample'))
    const saveBtn = await screen.findByTestId('sample-save-look')
    fireEvent.click(saveBtn)
    await saved(1)
    await saveSettled(true)

    // Re-save confirmed against server (GET /:id 200) omits Undo.
    fireEvent.click(saveBtn)
    await saveSettled(false)
    expect(store.items).toHaveLength(1)
    await savedLooksShown(1)

    // Remote delete on another device -> re-saving revalidates (404) and recreates look.
    store.items = []
    fireEvent.click(saveBtn)
    await saved(1)
    // The recreated look brings its own Undo; the bar showed none since the confirmed re-save.
    await saveSettled(true)
    const undoSave = screen.getByTestId('status-bar-action-undo')

    // Undo Save deletes the created look cleanly.
    fireEvent.click(undoSave)
    await saved(0)

    // Save again, then open saved look, then Remove failure -> Retry -> Undo Remove -> failed Undo.
    fireEvent.click(saveBtn)
    await saved(1)
    await saveSettled(true)
    const savedRegion = screen.getByTestId('sample-saved-looks')
    const savedButtons = within(savedRegion).getAllByRole('button')
    fireEvent.click(savedButtons[0]!)

    let failDeleteOnce = true
    store.nextDeleteError = () => {
      if (!failDeleteOnce) return null
      failDeleteOnce = false
      return HttpResponse.json({ message: 'Transient error' }, { status: 503 })
    }
    fireEvent.click(removeButtons()[0]!)
    const retryRemove = await screen.findByTestId('status-bar-action-retry')
    fireEvent.click(retryRemove)
    await saved(0)
    await barSays('Removed')

    // Undo Remove restores via /restore, and failed Undo Remove shows error notice.
    let failRestoreOnce = true
    store.nextRestoreError = () => {
      if (!failRestoreOnce) return null
      failRestoreOnce = false
      return HttpResponse.json({ message: 'Restore error' }, { status: 503 })
    }
    fireEvent.click(screen.getByTestId('status-bar-action-undo'))
    await barSays('Could not save. Try again.')

    // Save one more look, then test offline Remove, online Remove + offline Undo, and 404 stale delete.
    fireEvent.click(saveBtn)
    await saved(1)
    await saveSettled(true)

    reportNetworkOffline()
    fireEvent.click(removeButtons()[0]!)
    await barSays('You are offline. Save when you reconnect.')
    // Offline, nothing was sent: the look is still saved and still listed.
    expect(store.items).toHaveLength(1)
    await savedLooksShown(1)
    reportNetworkOnline()

    // Remove while online, then click Undo while offline -> offline notice.
    fireEvent.click(removeButtons()[0]!)
    await saved(0)
    // Until the bar says Removed, its Undo is still the earlier Save's (CI 7c284e60).
    await barSays('Removed')
    const undoRemove2 = screen.getByTestId('status-bar-action-undo')
    reportNetworkOffline()
    fireEvent.click(undoRemove2)
    await barSays('You are offline. Save when you reconnect.')
    reportNetworkOnline()

    // Re-save when online, then 404 stale delete cleans up without offering Undo.
    fireEvent.click(saveBtn)
    await saved(1)
    await saveSettled(true)
    store.items = []
    fireEvent.click(removeButtons()[0]!)
    await barSays('Removed')
    await savedLooksShown(0)
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

  it('[P1] [7.12-NAT-023] the save confirmation View opens the saved look screen of the look just saved', async () => {
    const { store, handlers } = createSavedLooksMswHandlers()
    server.use(...handlers)

    await render(
      <SaveFeedbackProvider>
        <MemberSampleOutfit
          owner="mobile-member-1"
          error={null}
          busy={false}
          onRetry={vi.fn()}
        />
      </SaveFeedbackProvider>
    )

    fireEvent.click(screen.getByTestId('home-edit-sample'))
    fireEvent.click(await screen.findByTestId('sample-save-look'))
    await waitFor(() => expect(store.items).toHaveLength(1))
    const view = await screen.findByTestId('status-bar-action-view')
    expect(view).toHaveTextContent('View')
    expect(routerMock.push).not.toHaveBeenCalled()

    fireEvent.click(view)
    // D7: View names the look, with no `from`: the screen below is Today, not a Saved filter.
    expect(routerMock.push.mock.calls).toEqual([
      [
        {
          pathname: '/saved-look/[savedLookId]',
          params: { savedLookId: store.items[0]!.id },
        },
      ],
    ])
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
    if (!screen.queryByTestId('guest-preview-try-another'))
      fireEvent.click(screen.getByTestId('home-edit-sample'))
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
    // A real click: react-native-web reconfigures Pressable's responder in a passive effect, so a
    // synchronous click in the commit's own task still meets the busy (disabled) responder. A
    // member's tap cannot land that fast.
    await userEvent.click(saveBtn)
    await waitFor(() => expect(store.items).toHaveLength(2))
    // The store fills when the POST lands, before the app reads the reply. The settled save then
    // broadcasts a saved-looks change, and this view's refresh GET merges the server look in.
    // Unmounting before both finish let the late broadcast reach the next view, whose refresh
    // GET ran beside the held initial GET and showed Save early (CI 215a46ee, line 361 below).
    await waitFor(() => {
      expect(screen.getByTestId('status-feedback-bar')).toHaveTextContent(
        'Saved to your looks.'
      )
      expect(
        within(screen.getByTestId('sample-saved-looks')).getAllByRole('button', {
          name: /^Remove /,
        })
      ).toHaveLength(2)
    })
    await view.unmount()

    // Slow initial GET merged with early Save retains both the early-saved look and the server look.
    let releaseSlowGet!: () => void
    let heldGet = false
    let listGets = 0
    store.onGet = async (request) => {
      if (new URL(request.url).pathname !== '/api/v1/wardrobe/saved-looks') return
      listGets += 1
      if (heldGet) return
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
    fireEvent.click(screen.getByTestId('home-edit-sample'))
    // While initial GET is in flight, Save stays disabled/hidden until loading completes; after release, the existing look appears.
    await waitFor(() => expect(heldGet).toBe(true))
    // The held GET is this view's only list request, so nothing else can mark storage ready.
    expect(listGets).toBe(1)
    expect(screen.queryByTestId('sample-save-look')).not.toBeInTheDocument()
    releaseSlowGet()
    expect(await screen.findByTestId('sample-save-look')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        within(screen.getByTestId('sample-saved-looks')).getAllByRole('button', {
          name: /^Remove /,
        })
      ).toHaveLength(1)
    )
    await view2.unmount()
  })
})

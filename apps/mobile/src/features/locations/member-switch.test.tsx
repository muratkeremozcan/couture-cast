// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19), Codex review 5 findings 1 and 2,
// mobile. The Locations screen belongs to one member at a time. When the phone's session moves
// from member A to member B (or signs out):
// - A's saved rows leave the screen, whether A's list had finished or was still loading, and B's
//   own list loads;
// - a save A started never writes A's place to B's account (switch before the request goes out),
//   and a save already sent as A changes nothing on B's screen when it answers.
import React from 'react'
import { userEvent } from 'vitest/browser'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type * as Locations from '@/src/lib/locations'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
const router = vi.hoisted(() => ({
  back: vi.fn(),
  canGoBack: vi.fn(() => true),
  push: vi.fn(),
}))
vi.mock('expo-router', () => ({ router }))
vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  PermissionStatus: {
    GRANTED: 'granted',
    DENIED: 'denied',
    UNDETERMINED: 'undetermined',
  },
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
}))

/** The list and save calls, kept until they settle, so a test waits for late answers. */
const tracked = vi.hoisted(() => ({
  promises: [] as Promise<unknown>[],
  /** When set, the screen's save call gets this promise: the test answers it by hand. */
  saveAnswer: null as Promise<unknown> | null,
}))

vi.mock('@/src/lib/locations', async (importOriginal) => {
  const actual = await importOriginal<typeof Locations>()
  const track =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    (...args: A) => {
      const pending = call(...args)
      tracked.promises.push(pending)
      return pending
    }
  return {
    ...actual,
    listLocationsFromMobile: track(actual.listLocationsFromMobile),
    saveLocationFromSearchFromMobile: (
      ...args: Parameters<typeof actual.saveLocationFromSearchFromMobile>
    ) => {
      if (tracked.saveAnswer) return tracked.saveAnswer
      const pending = actual.saveLocationFromSearchFromMobile(...args)
      tracked.promises.push(pending)
      return pending
    },
  }
})

import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import { locationCandidate, savedLocation } from '@/src/test-utils/locations'
import { LocationsScreen } from './locations-screen'

const A_HOME = savedLocation({ id: 'a-1', label: 'Alpha Home' })
const A_CABIN = savedLocation({
  id: 'a-2',
  label: 'Alpha Cabin',
  isPrimary: false,
  sortOrder: 1,
  locationKey: 'cabin-key',
})
const B_OFFICE = savedLocation({
  id: 'b-1',
  label: 'Bravo Office',
  city: 'Springfield',
  region: 'Missouri',
  locationKey: 'springfield-key',
})
const SPRINGFIELD = locationCandidate({
  city: 'Springfield',
  region: 'Missouri',
  displayLabel: 'Springfield, Missouri, United States',
  candidateToken: 'springfield-payload.signature',
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function renderScreen(guided = false) {
  const view = render(
    <AccessibilityAnnouncerProvider>
      <LocationsScreen guided={guided} />
    </AccessibilityAnnouncerProvider>
  )
  return {
    /** The member taps Back: Locations leaves, the app (and its announcer) stays. */
    back: () =>
      view.rerender(
        <AccessibilityAnnouncerProvider>
          <></>
        </AccessibilityAnnouncerProvider>
      ),
  }
}

/**
 * Every tracked list and save has settled (including any they started) and React has applied
 * what their handlers set.
 */
async function settle() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await Promise.allSettled(tracked.promises)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/**
 * The accessibility announcer publishes its live-region message 80 ms after a call
 * (apps/mobile/src/hooks/use-accessibility-announcer.ts). Wait past that, so a late completion's
 * announcement is on screen before the test looks for it.
 */
const ANNOUNCER_DEBOUNCE_MS = 80
async function waitPastAnnouncements() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ANNOUNCER_DEBOUNCE_MS * 3))
  })
}

describe(
  'the Locations screen belongs to one member at a time (mobile)',
  { timeout: 30_000 },
  () => {
    let bearer: string | undefined
    let holdNextToken: boolean
    let heldToken: { resolve: (token: string | undefined) => void } | null
    let listBearers: (string | null)[]
    let saveBearers: (string | null)[]
    let holdAList: { promise: Promise<void>; resolve: () => void } | null
    let holdBList: { promise: Promise<void>; resolve: () => void } | null
    let aRows: ReturnType<typeof savedLocation>[]
    /** Every rename, primary and delete request: method, path and bearer. */
    let mutations: string[]
    let restoreAccessTokenResolver: () => void
    const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

    beforeAll(async () => {
      await initI18n()
      await i18n.changeLanguage('en-US')
    })

    beforeEach(() => {
      bearer = 'token-a'
      holdNextToken = false
      heldToken = null
      listBearers = []
      saveBearers = []
      holdAList = null
      holdBList = null
      tracked.saveAnswer = null
      aRows = [A_HOME]
      mutations = []
      tracked.promises = []
      router.back.mockClear()
      process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
      setMobileApplicationUserId('member-a')
      restoreAccessTokenResolver = setMobileAccessTokenResolver(() => {
        if (!holdNextToken) return bearer
        holdNextToken = false
        const token = deferred<string | undefined>()
        heldToken = token
        return token.promise
      })
      server.use(
        http.get('*/api/v1/locations', async ({ request }) => {
          const authorization = request.headers.get('authorization')
          listBearers.push(authorization)
          if (authorization === 'Bearer token-b') {
            if (holdBList) await holdBList.promise
            return HttpResponse.json({ data: [B_OFFICE] })
          }
          if (holdAList) await holdAList.promise
          return HttpResponse.json({ data: aRows })
        }),
        http.get('*/api/v1/locations/search', () =>
          HttpResponse.json({ data: [SPRINGFIELD] })
        ),
        http.patch('*/api/v1/locations/:id', ({ request }) => {
          mutations.push(
            `PATCH ${new URL(request.url).pathname} ${request.headers.get('authorization')}`
          )
          return HttpResponse.json({ data: { ...A_HOME, label: 'Alpha Renamed' } })
        }),
        http.post('*/api/v1/locations/:id/primary', ({ request }) => {
          mutations.push(
            `PRIMARY ${new URL(request.url).pathname} ${request.headers.get('authorization')}`
          )
          return HttpResponse.json({ data: { ...A_CABIN, isPrimary: true } })
        }),
        http.delete('*/api/v1/locations/:id', ({ request }) => {
          mutations.push(
            `DELETE ${new URL(request.url).pathname} ${request.headers.get('authorization')}`
          )
          return new HttpResponse(null, { status: 204 })
        })
      )
    })

    afterEach(() => {
      if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL
      else process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
      restoreAccessTokenResolver()
      setMobileApplicationUserId(null)
    })

    function switchTo(member: 'member-b' | null) {
      act(() => {
        bearer = member === 'member-b' ? 'token-b' : undefined
        setMobileApplicationUserId(member)
      })
    }

    const noAlpha = () => expect(screen.queryByText(/Alpha/)).toBeNull()

    it('LOC-MEMBER-MOB-01 A rows that had loaded leave the screen, and B list loads', async () => {
      renderScreen()
      expect(await screen.findByText('Alpha Home')).toBeTruthy()

      switchTo('member-b')

      expect(await screen.findByText('Bravo Office')).toBeTruthy()
      noAlpha()
      expect(listBearers).toEqual(['Bearer token-a', 'Bearer token-b'])
    })

    it('LOC-MEMBER-MOB-02 A rows leave the screen on sign-out', async () => {
      renderScreen()
      expect(await screen.findByText('Alpha Home')).toBeTruthy()

      switchTo(null)
      await settle()

      noAlpha()
      expect(screen.queryByTestId('location-item-0')).toBeNull()
    })

    it('LOC-MEMBER-MOB-03 an A list still loading at the switch never fills B screen', async () => {
      holdAList = deferred<void>()
      renderScreen()
      await waitFor(() => expect(listBearers).toEqual(['Bearer token-a']))

      switchTo('member-b')
      expect(await screen.findByText('Bravo Office')).toBeTruthy()
      act(() => holdAList!.resolve())
      await settle()

      expect(screen.getByText('Bravo Office')).toBeTruthy()
      noAlpha()
    })

    /** A picks Springfield and names it, ready to save. */
    async function prepareSave() {
      renderScreen(true)
      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Spring')
      await userEvent.click(await screen.findByTestId('location-search-option-0'))
      const label = await screen.findByTestId('location-label-input')
      await userEvent.fill(label, 'Alpha Studio')
    }

    it('LOC-MEMBER-MOB-04 a save waiting for its bearer at the switch writes nothing to B account', async () => {
      server.use(
        http.post('*/api/v1/locations/from-search', ({ request }) => {
          saveBearers.push(request.headers.get('authorization'))
          return HttpResponse.json(
            { data: savedLocation({ label: 'Alpha Studio' }) },
            { status: 201 }
          )
        })
      )
      await prepareSave()

      holdNextToken = true
      await userEvent.click(screen.getByTestId('location-save-button'))
      await waitFor(() => expect(heldToken).not.toBeNull())
      switchTo('member-b')
      await act(async () => {
        heldToken!.resolve('token-b')
        await Promise.resolve()
      })
      await settle()

      expect(saveBearers).toEqual([])
      expect(router.back).not.toHaveBeenCalled()
      noAlpha()
    })

    it('LOC-MEMBER-MOB-05 a save already sent as A changes nothing on B screen when it answers', async () => {
      const answer = deferred<void>()
      server.use(
        http.post('*/api/v1/locations/from-search', async ({ request }) => {
          saveBearers.push(request.headers.get('authorization'))
          await answer.promise
          return HttpResponse.json(
            { data: savedLocation({ label: 'Alpha Studio' }) },
            { status: 201 }
          )
        })
      )
      await prepareSave()

      await userEvent.click(screen.getByTestId('location-save-button'))
      await waitFor(() => expect(saveBearers).toEqual(['Bearer token-a']))
      switchTo('member-b')
      expect(await screen.findByText('Bravo Office')).toBeTruthy()
      const search = await screen.findByTestId('locations-search-input')
      await userEvent.fill(search, 'Bra')
      const listsBefore = [...listBearers]

      act(() => answer.resolve())
      await settle()

      await waitPastAnnouncements()

      expect(router.back).not.toHaveBeenCalled()
      expect(screen.getByTestId('locations-search-input')).toHaveValue('Bra')
      expect(listBearers).toEqual(listsBefore)
      // The live region included: A's label is never announced on B's screen.
      noAlpha()
    })

    it('LOC-MEMBER-MOB-06 A rows and A rename editor are gone while B list is still loading', async () => {
      holdBList = deferred<void>()
      renderScreen()
      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      await userEvent.click(await screen.findByTestId('location-rename-0'))
      expect(await screen.findByTestId('location-rename-input-0')).toBeTruthy()

      switchTo('member-b')
      await waitFor(() => expect(listBearers).toContain('Bearer token-b'))

      noAlpha()
      expect(screen.queryByTestId('location-item-0')).toBeNull()
      expect(screen.queryByTestId('location-rename-input-0')).toBeNull()

      act(() => holdBList!.resolve())
      expect(await screen.findByText('Bravo Office')).toBeTruthy()
      noAlpha()
    })

    it('LOC-MEMBER-MOB-07 a save sent as A that fails after the switch shows no error on B screen', async () => {
      const answer = deferred<void>()
      server.use(
        http.post('*/api/v1/locations/from-search', async ({ request }) => {
          saveBearers.push(request.headers.get('authorization'))
          await answer.promise
          return HttpResponse.json(
            {
              statusCode: 503,
              code: 'provider_unavailable',
              retryable: true,
              message: 'down',
              error: 'Service Unavailable',
            },
            { status: 503 }
          )
        })
      )
      await prepareSave()

      await userEvent.click(screen.getByTestId('location-save-button'))
      await waitFor(() => expect(saveBearers).toEqual(['Bearer token-a']))
      switchTo('member-b')
      expect(await screen.findByText('Bravo Office')).toBeTruthy()

      act(() => answer.resolve())
      await settle()
      await waitPastAnnouncements()

      expect(screen.queryByTestId('location-error')).toBeNull()
      expect(screen.queryByTestId('location-retry-button')).toBeNull()
      noAlpha()

      // B goes on to pick a city: A's failure is not waiting in B's save form either.
      await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Spring')
      await userEvent.click(await screen.findByTestId('location-search-option-0'))
      expect(await screen.findByTestId('location-save-button')).toBeTruthy()
      expect(screen.queryByTestId('location-error')).toBeNull()
      expect(screen.queryByTestId('location-retry-button')).toBeNull()
    })

    /** A mutation whose bearer lookup is still pending when the phone switches to B. */
    async function switchWhileBearerPending(start: () => Promise<void>) {
      holdNextToken = true
      await start()
      await waitFor(() => expect(heldToken).not.toBeNull())
      switchTo('member-b')
      await act(async () => {
        heldToken!.resolve('token-b')
        await Promise.resolve()
      })
      await settle()
      expect(mutations).toEqual([])
      expect(await screen.findByText('Bravo Office')).toBeTruthy()
      noAlpha()
    }

    it('LOC-MEMBER-MOB-08 a rename waiting for its bearer at the switch sends nothing', async () => {
      renderScreen()
      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      await userEvent.click(screen.getByTestId('location-rename-0'))
      await userEvent.fill(
        await screen.findByTestId('location-rename-input-0'),
        'Alpha Renamed'
      )
      await switchWhileBearerPending(() =>
        userEvent.click(screen.getByTestId('location-rename-save-0'))
      )
    })

    it('LOC-MEMBER-MOB-09 a primary change waiting for its bearer at the switch sends nothing', async () => {
      aRows = [A_HOME, A_CABIN]
      renderScreen()
      expect(await screen.findByText('Alpha Cabin')).toBeTruthy()
      await switchWhileBearerPending(() =>
        userEvent.click(screen.getByTestId('location-make-primary-1'))
      )
    })

    it('LOC-MEMBER-MOB-10 a delete waiting for its bearer at the switch sends nothing', async () => {
      renderScreen()
      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      await userEvent.click(screen.getByTestId('location-delete-0'))
      await switchWhileBearerPending(() =>
        userEvent.click(screen.getByTestId('location-delete-confirm'))
      )
    })

    it('LOC-MEMBER-MOB-11 a guided save answering after Back navigates nowhere and announces nothing', async () => {
      const answer = deferred<void>()
      server.use(
        http.post('*/api/v1/locations/from-search', async ({ request }) => {
          saveBearers.push(request.headers.get('authorization'))
          await answer.promise
          return HttpResponse.json(
            { data: savedLocation({ label: 'Alpha Studio' }) },
            { status: 201 }
          )
        })
      )
      const { back } = renderScreen(true)
      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Spring')
      await userEvent.click(await screen.findByTestId('location-search-option-0'))
      await userEvent.fill(
        await screen.findByTestId('location-label-input'),
        'Alpha Studio'
      )
      await userEvent.click(screen.getByTestId('location-save-button'))
      await waitFor(() => expect(saveBearers).toEqual(['Bearer token-a']))

      // The member taps Back while the save is in flight; the router has already gone back once.
      act(() => back())
      act(() => answer.resolve())
      await settle()
      await waitPastAnnouncements()

      expect(router.back).not.toHaveBeenCalled()
      expect(screen.queryByText(/Alpha Studio/)).toBeNull()
    })

    it('LOC-MEMBER-MOB-12 a save announcement still queued when the phone switches is never delivered', async () => {
      server.use(
        http.post('*/api/v1/locations/from-search', ({ request }) => {
          saveBearers.push(request.headers.get('authorization'))
          return HttpResponse.json(
            { data: savedLocation({ label: 'Alpha Studio' }) },
            { status: 201 }
          )
        })
      )
      renderScreen()
      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Spring')
      await userEvent.click(await screen.findByTestId('location-search-option-0'))
      await userEvent.fill(
        await screen.findByTestId('location-label-input'),
        'Alpha Studio'
      )
      await userEvent.click(screen.getByTestId('location-save-button'))
      // The save completes as A (its announcement is queued for 80 ms), then the phone switches.
      await waitFor(() => expect(saveBearers).toEqual(['Bearer token-a']))
      await act(async () => {
        await Promise.allSettled(tracked.promises)
      })
      switchTo('member-b')
      await waitPastAnnouncements()

      expect(screen.queryByText(/Alpha Studio/)).toBeNull()
    })

    // Codex review 8: the screen itself receives A's provider failure after B loaded (no abort can
    // hide it), and neither the screen nor its screen-reader announcement shows it to B.
    it('LOC-MEMBER-MOB-07b a provider failure delivered to the screen after the switch reaches neither B screen nor B screen reader', async () => {
      let fail!: (error: unknown) => void
      tracked.saveAnswer = new Promise((_resolve, reject) => {
        fail = reject
      })
      await prepareSave()
      await userEvent.click(screen.getByTestId('location-save-button'))

      switchTo('member-b')
      expect(await screen.findByText('Bravo Office')).toBeTruthy()
      const { LocationRequestError } =
        await vi.importActual<typeof Locations>('@/src/lib/locations')
      await act(async () => {
        fail(new LocationRequestError('provider_unavailable', 'HTTP 503'))
        await tracked.saveAnswer!.catch(() => undefined)
      })
      await settle()
      await waitPastAnnouncements()

      expect(screen.queryByTestId('location-error')).toBeNull()
      expect(screen.queryByTestId('location-retry-button')).toBeNull()
      // The localized save failure is not in the live region (or anywhere) either.
      expect(screen.queryByText(i18n.t('locations.errors.save_unavailable'))).toBeNull()
      noAlpha()

      // B can keep using the form: search, pick, and the save button is ready.
      tracked.saveAnswer = null
      await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Spring')
      await userEvent.click(await screen.findByTestId('location-search-option-0'))
      expect(await screen.findByTestId('location-save-button')).toBeTruthy()
      expect(screen.queryByTestId('location-error')).toBeNull()
    })
  }
)

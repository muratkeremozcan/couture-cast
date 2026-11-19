// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19), Codex review 5 findings 1 and 2,
// mobile. The Locations screen belongs to one member at a time. When the phone's session moves
// from member A to member B (or signs out):
// - A's saved rows leave the screen, whether A's list had finished or was still loading, and B's
//   own list loads;
// - a save A started never writes A's place to B's account (switch before the request goes out),
//   and a save already sent as A changes nothing on B's screen when it answers.
import React, { useEffect } from 'react'
import { userEvent } from 'vitest/browser'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type * as Locations from '@/src/lib/locations'
import type * as AccessibilityFocus from '@/src/lib/accessibility-focus'

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
  /** How many times the screen called save while saveAnswer was set. */
  saveCalls: 0,
}))

/** Every node the screen asked to focus for assistive technology (a no-op on web, recorded here). */
const focusCalls = vi.hoisted(() => [] as unknown[])
vi.mock('@/src/lib/accessibility-focus', async (importOriginal) => {
  const actual = await importOriginal<typeof AccessibilityFocus>()
  return {
    ...actual,
    safeFindNodeHandle: (node: unknown) => {
      focusCalls.push(node)
      return actual.safeFindNodeHandle(node)
    },
  }
})

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
    searchLocationsFromMobile: track(actual.searchLocationsFromMobile),
    renameLocationFromMobile: track(actual.renameLocationFromMobile),
    setPrimaryLocationFromMobile: track(actual.setPrimaryLocationFromMobile),
    deleteLocationFromMobile: track(actual.deleteLocationFromMobile),
    saveLocationFromSearchFromMobile: (
      ...args: Parameters<typeof actual.saveLocationFromSearchFromMobile>
    ) => {
      if (tracked.saveAnswer) {
        tracked.saveCalls += 1
        return tracked.saveAnswer
      }
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
import { LOCATION_SEARCH_DEBOUNCE_MS, LocationsScreen } from './locations-screen'

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
    /** Locations opens again under the same announcer. */
    reopen: () =>
      view.rerender(
        <AccessibilityAnnouncerProvider>
          <LocationsScreen guided={guided} />
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

/** Every message the shared announcer renders, in order: each mounts a fresh live-region node. */
function recordAnnouncements(): { announcements: string[]; stop: () => void } {
  const announcements: string[] = []
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of Array.from(record.addedNodes))
        if (node instanceof HTMLElement && node.id === 'a11y-live-announcer')
          announcements.push(node.textContent ?? '')
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return { announcements, stop: () => observer.disconnect() }
}

/**
 * Holds the announcer's delivery timers (its 80 ms debounce) instead of scheduling them, so a
 * test can switch members while an announcement is queued and then deliver it on purpose.
 */
function holdAnnouncerTimers() {
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const held = new Map<number, () => void>()
  let nextId = 900_000
  const setSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: () => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (delay !== ANNOUNCER_DEBOUNCE_MS) return realSetTimeout(callback, delay, ...args)
    nextId += 1
    held.set(nextId, () => callback())
    return nextId
  }) as unknown as typeof setTimeout)
  const clearSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((
    id?: number
  ) => {
    if (id !== undefined && held.delete(id)) return
    realClearTimeout(id)
  }) as unknown as typeof clearTimeout)
  return {
    held: () => held.size,
    release: () =>
      act(() => {
        const due = [...held.values()]
        held.clear()
        for (const deliver of due) deliver()
      }),
    restore: () => {
      setSpy.mockRestore()
      clearSpy.mockRestore()
    },
  }
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
      tracked.saveCalls = 0
      aRows = [A_HOME]
      mutations = []
      tracked.promises = []
      focusCalls.length = 0
      router.back.mockReset()
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
          // What the API answers (location-preferences.controller.ts).
          return HttpResponse.json({ data: { deleted: true } })
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
      // Earlier announcements (search results) are delivered before the announcer's timer is held.
      await waitPastAnnouncements()
      const timers = holdAnnouncerTimers()
      const { announcements, stop } = recordAnnouncements()
      try {
        await userEvent.click(screen.getByTestId('location-save-button'))
        // The save completed as A and its announcement is queued, not yet delivered.
        await waitFor(() => expect(saveBearers).toEqual(['Bearer token-a']))
        await settle()
        await waitFor(() => expect(timers.held()).toBeGreaterThan(0))
        expect(announcements).toEqual([])

        switchTo('member-b')
        timers.release()
        await settle()
        await waitPastAnnouncements()

        expect(announcements.filter((text) => /Alpha/.test(text))).toEqual([])
        noAlpha()
      } finally {
        timers.restore()
        stop()
      }
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
      // The screen really called save and holds the deferred answer.
      await waitFor(() => expect(tracked.saveCalls).toBe(1))

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

    // Codex product review 7. Each case below is one window where the phone's member has already
    // changed (or is about to) while A's screen, press or deferred effect is still in play.

    /** A from-search handler that records each save's bearer and answers with the sent label. */
    function answerSaves() {
      server.use(
        http.post('*/api/v1/locations/from-search', async ({ request }) => {
          saveBearers.push(request.headers.get('authorization'))
          const { label } = (await request.json()) as { label: string }
          return HttpResponse.json(
            { data: savedLocation({ id: 'a-9', label }) },
            { status: 201 }
          )
        })
      )
    }

    /** The member picks Springfield and names it, ready to save. */
    async function pickAndName(label = 'Alpha Studio') {
      await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Spring')
      await userEvent.click(await screen.findByTestId('location-search-option-0'))
      await userEvent.fill(await screen.findByTestId('location-label-input'), label)
      await settle()
    }

    /**
     * The phone's session moves to B, and B's render is only queued: the identity listener ran
     * outside any act scope, so React has not committed it when the next line runs.
     */
    function switchWithoutRender() {
      bearer = 'token-b'
      setMobileApplicationUserId('member-b')
    }

    /** A press that was already queued on A's screen: the DOM click reaches A's handler now. */
    function pressNow(testId: string) {
      const target = screen.getByTestId(testId)
      act(() => {
        target.click()
      })
    }

    // Finding 2: an A-era press handled after the switch must not bind A's data to B.
    it('LOC-MEMBER-MOB-13 a Save press queued on A screen when the phone switched sends nothing', async () => {
      answerSaves()
      renderScreen()
      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      await pickAndName()

      switchWithoutRender()
      // A's screen is still the one on screen when the queued press is handled.
      expect(screen.getByTestId('location-save-button')).toBeTruthy()
      pressNow('location-save-button')
      await settle()
      await waitPastAnnouncements()

      expect(saveBearers).toEqual([])
      expect(await screen.findByText('Bravo Office')).toBeTruthy()
      noAlpha()
    })

    it('LOC-MEMBER-MOB-14 a Make primary press queued on A screen when the phone switched sends nothing', async () => {
      aRows = [A_HOME, A_CABIN]
      renderScreen()
      expect(await screen.findByText('Alpha Cabin')).toBeTruthy()
      await settle()

      switchWithoutRender()
      expect(screen.getByTestId('location-make-primary-1')).toBeTruthy()
      pressNow('location-make-primary-1')
      await settle()

      expect(mutations).toEqual([])
      expect(await screen.findByText('Bravo Office')).toBeTruthy()
      noAlpha()
    })

    // Finding 3: the city A picked is A's; its announcement dies with A's turn.
    it('LOC-MEMBER-MOB-15 a city A picked is not announced after A signs out inside the debounce', async () => {
      renderScreen()
      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Spring')
      expect(await screen.findByTestId('location-search-option-0')).toBeTruthy()
      // The result-count announcement is delivered before the announcer's timer is held.
      await waitPastAnnouncements()
      const timers = holdAnnouncerTimers()
      const { announcements, stop } = recordAnnouncements()
      try {
        await userEvent.click(screen.getByTestId('location-search-option-0'))
        await waitFor(() => expect(timers.held()).toBeGreaterThan(0))
        expect(announcements).toEqual([])

        switchTo(null)
        timers.release()
        await settle()
        await waitPastAnnouncements()

        expect(announcements.filter((text) => /Springfield/.test(text))).toEqual([])
        expect(screen.queryByText(/Springfield/)).toBeNull()
      } finally {
        timers.restore()
        stop()
      }
    })

    // Finding 4: the root announcer outlives the screen; what it already said for A goes with A.
    it('LOC-MEMBER-MOB-16 an announcement already delivered for A leaves the live region when A signs out', async () => {
      answerSaves()
      const { back } = renderScreen()
      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      await pickAndName()
      await userEvent.click(screen.getByTestId('location-save-button'))
      await settle()
      const liveRegion = () => document.getElementById('a11y-live-announcer')
      await waitFor(() => expect(liveRegion()?.textContent).toBe('Alpha Studio saved.'))

      // A leaves Locations; the app and its announcer stay; then A signs out.
      act(() => back())
      switchTo(null)
      await settle()
      await waitPastAnnouncements()

      expect(liveRegion()?.textContent ?? '').not.toMatch(/Alpha/)
      expect(document.body.textContent).not.toMatch(/Alpha/)
    })

    // Codex review 12 finding 4: clearing A's message must also clear the memory the announcer
    // uses to skip repeats, or B's identical feedback is silently dropped.
    it('LOC-MEMBER-MOB-16b feedback B earns is heard even when it repeats what A last heard', async () => {
      const { back, reopen } = renderScreen()
      const liveRegion = () => document.getElementById('a11y-live-announcer')
      const resultCount = i18n.t('locations.resultCount', { count: 1 })
      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      // The last thing A hears is the result count of a search.
      await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Spring')
      await waitFor(() => expect(liveRegion()?.textContent).toBe(resultCount))
      await settle()

      act(() => back())
      switchTo(null)
      await settle()
      expect(liveRegion()?.textContent ?? '').toBe('')

      // B signs in on the same app, opens Locations and runs the same search: the first thing B
      // hears is the very message A heard last.
      switchTo('member-b')
      act(() => reopen())
      expect(await screen.findByText('Bravo Office')).toBeTruthy()
      await settle()
      await waitPastAnnouncements()
      const { announcements, stop } = recordAnnouncements()
      try {
        await userEvent.fill(
          await screen.findByTestId('locations-search-input'),
          'Spring'
        )
        expect(await screen.findByTestId('location-search-option-0')).toBeTruthy()
        await settle()
        await waitPastAnnouncements()

        expect(announcements).toEqual([resultCount])
      } finally {
        stop()
      }
    })

    // Finding 5: a guided save that succeeds goes Back and still confirms, exactly once.
    it('LOC-MEMBER-MOB-17 a guided save confirms once on the screen Back returns to', async () => {
      answerSaves()
      const { back } = renderScreen(true)
      // The router really leaves Locations when the screen calls Back.
      router.back.mockImplementationOnce(() => back())
      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      await pickAndName()
      await waitPastAnnouncements()
      const { announcements, stop } = recordAnnouncements()
      try {
        await userEvent.click(screen.getByTestId('location-save-button'))
        await settle()
        await waitPastAnnouncements()

        expect(saveBearers).toEqual(['Bearer token-a'])
        expect(router.back).toHaveBeenCalledTimes(1)
        expect(screen.queryByTestId('locations-search-input')).toBeNull()
        expect(
          announcements.filter((text) => text === 'Alpha Studio saved.')
        ).toHaveLength(1)
      } finally {
        stop()
      }
    })

    // Codex product review 8 finding 1: A's keyboard delivers a text change after the identity
    // listener queued B's reset but before B's render commits.
    it('LOC-MEMBER-MOB-20 a text change queued on A screen when the phone switched never searches for B', async () => {
      const searchBearers: (string | null)[] = []
      server.use(
        http.get('*/api/v1/locations/search', ({ request }) => {
          searchBearers.push(request.headers.get('authorization'))
          return HttpResponse.json({ data: [SPRINGFIELD] })
        })
      )
      // Hold the search debounce so the test, not the clock, decides when it fires.
      const realSetTimeout = globalThis.setTimeout
      const realClearTimeout = globalThis.clearTimeout
      const held: { run: () => void; cleared: boolean }[] = []
      const setSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        callback: () => void,
        delay?: number,
        ...args: unknown[]
      ) => {
        if (delay !== LOCATION_SEARCH_DEBOUNCE_MS)
          return realSetTimeout(callback, delay, ...args)
        const entry = { run: callback, cleared: false }
        held.push(entry)
        return entry as unknown as ReturnType<typeof setTimeout>
      }) as unknown as typeof setTimeout)
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((
        id?: ReturnType<typeof setTimeout>
      ) => {
        const entry = held.find((each) => (each as unknown) === id)
        if (entry) entry.cleared = true
        else realClearTimeout(id)
      }) as unknown as typeof clearTimeout)
      try {
        renderScreen()
        expect(await screen.findByText('Alpha Home')).toBeTruthy()
        await settle()
        const input = screen.getByTestId<HTMLInputElement>('locations-search-input')

        switchWithoutRender()
        // The queued keystroke: React sees an input event on A's field in the same batch.
        act(() => {
          // The native value setter, as a keyboard sets it, so React's input tracking sees the change.
          Reflect.set(HTMLInputElement.prototype, 'value', 'Spring', input)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await settle()
        for (const entry of held.filter((each) => !each.cleared)) {
          entry.cleared = true
          act(() => entry.run())
        }
        await settle()

        expect(searchBearers).toEqual([])
        expect(await screen.findByText('Bravo Office')).toBeTruthy()
        expect(screen.getByTestId<HTMLInputElement>('locations-search-input').value).toBe(
          ''
        )
        noAlpha()
      } finally {
        setSpy.mockRestore()
        clearSpy.mockRestore()
      }
    })

    // Finding 4: verification publishes the member after the screen rendered, before it subscribed.
    it('LOC-MEMBER-MOB-21 a member published between the first render and the subscription still gets a list', async () => {
      setMobileApplicationUserId(null)
      /** Placed before the screen: its passive effect runs before the screen's own. */
      function VerificationLands() {
        useEffect(() => {
          setMobileApplicationUserId('member-a')
        }, [])
        return null
      }
      render(
        <AccessibilityAnnouncerProvider>
          <VerificationLands />
          <LocationsScreen />
        </AccessibilityAnnouncerProvider>
      )

      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      expect(listBearers).toEqual(['Bearer token-a'])
    })

    // Finding 6: the focus a delete decided for A is not carried out after the phone switched.
    describe('focus after a delete', () => {
      /** A deletes Alpha Home; optionally the phone switches the moment the outcome is announced. */
      async function deleteAlphaHome(switchOnAnnouncement: boolean) {
        aRows = [A_HOME, A_CABIN]
        server.use(
          http.delete('*/api/v1/locations/:id', ({ request }) => {
            mutations.push(`DELETE ${new URL(request.url).pathname}`)
            aRows = [A_CABIN]
            return HttpResponse.json({ data: { deleted: true } })
          })
        )
        renderScreen()
        expect(await screen.findByText('Alpha Home')).toBeTruthy()
        await settle()
        await userEvent.click(screen.getByTestId('location-delete-0'))
        const realSetTimeout = globalThis.setTimeout
        const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
          callback: () => void,
          delay?: number,
          ...args: unknown[]
        ) => {
          // The delete's announcement is queued in the same step that decides the focus.
          if (
            switchOnAnnouncement &&
            delay === ANNOUNCER_DEBOUNCE_MS &&
            mutations.length > 0
          ) {
            switchOnAnnouncement = false
            switchWithoutRender()
          }
          return realSetTimeout(callback, delay, ...args)
        }) as unknown as typeof setTimeout)
        focusCalls.length = 0
        try {
          await userEvent.click(screen.getByTestId('location-delete-confirm'))
          await settle()
          await waitPastAnnouncements()
        } finally {
          spy.mockRestore()
        }
        expect(mutations).toEqual(['DELETE /api/v1/locations/a-1'])
      }

      it('LOC-MEMBER-MOB-18 control: with no switch, focus goes to the Locations heading', async () => {
        await deleteAlphaHome(false)
        // Exactly the Locations intro, the element the screen's heading ref points at.
        expect(focusCalls).toHaveLength(1)
        expect(focusCalls[0]).toBe(screen.getByText(i18n.t('locations.intro')))
      })

      it('LOC-MEMBER-MOB-19 a focus decided for A is not carried out after the phone switched', async () => {
        await deleteAlphaHome(true)
        expect(focusCalls).toEqual([])
        expect(await screen.findByText('Bravo Office')).toBeTruthy()
        noAlpha()
      })
    })
  }
)

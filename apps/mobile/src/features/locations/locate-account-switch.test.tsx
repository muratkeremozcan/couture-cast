// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19), Codex review 3 finding 1, mobile:
// member A taps Use my location and the phone's session switches to member B before the answer
// comes back. A's position must never be sent under B's account, and a city A's lookup finds must
// never appear on B's screen. Checked with the switch before the position returns and after the
// lookup has started.
import React from 'react'
import { userEvent } from 'vitest/browser'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type * as DevicePosition from './device-position'
import type * as Locations from '@/src/lib/locations'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('expo-router', () => ({
  router: { back: vi.fn(), canGoBack: vi.fn(() => false), push: vi.fn() },
}))

const location = vi.hoisted(() => ({
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
}))
vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: location.requestForegroundPermissionsAsync,
  getCurrentPositionAsync: location.getCurrentPositionAsync,
  PermissionStatus: {
    GRANTED: 'granted',
    DENIED: 'denied',
    UNDETERMINED: 'undetermined',
  },
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
}))

/** The calls the switch is about, counted when they start and kept until they settle. */
const tracked = vi.hoisted(() => ({
  nearbyLookups: 0,
  promises: [] as Promise<unknown>[],
}))

vi.mock('./device-position', async (importOriginal) => {
  const actual = await importOriginal<typeof DevicePosition>()
  return {
    ...actual,
    readDevicePosition: (...args: Parameters<typeof actual.readDevicePosition>) => {
      const reading = actual.readDevicePosition(...args)
      tracked.promises.push(reading)
      return reading
    },
  }
})

vi.mock('@/src/lib/locations', async (importOriginal) => {
  const actual = await importOriginal<typeof Locations>()
  return {
    ...actual,
    locationsNearFromMobile: (
      ...args: Parameters<typeof actual.locationsNearFromMobile>
    ) => {
      tracked.nearbyLookups += 1
      const lookup = actual.locationsNearFromMobile(...args)
      tracked.promises.push(lookup)
      return lookup
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
import { locationCandidate } from '@/src/test-utils/locations'
import { LocationsScreen } from './locations-screen'

const CHICAGO = locationCandidate()
const DEVICE = { latitude: 41.878113, longitude: -87.629799 }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function settleClient() {
  await act(async () => {
    await Promise.allSettled(tracked.promises)
  })
  await act(async () => {
    await Promise.resolve()
  })
}

function renderScreen() {
  render(
    <AccessibilityAnnouncerProvider>
      <LocationsScreen />
    </AccessibilityAnnouncerProvider>
  )
}

describe(
  'Use my location never crosses an account switch (mobile)',
  { timeout: 30_000 },
  () => {
    /** The bearer the session resolver hands out right now. */
    let bearer: string
    /** When set, the next bearer lookup waits for the test, as a native session read can. */
    let holdNextToken = false
    let heldToken: { resolve: (token: string) => void } | null = null
    let postedBearers: (string | null)[]
    let restoreAccessTokenResolver: () => void
    const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

    beforeAll(async () => {
      await initI18n()
      await i18n.changeLanguage('en-US')
    })

    beforeEach(() => {
      bearer = 'token-a'
      postedBearers = []
      tracked.nearbyLookups = 0
      tracked.promises = []
      location.requestForegroundPermissionsAsync.mockReset()
      location.getCurrentPositionAsync.mockReset()
      location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' })
      process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
      setMobileApplicationUserId('member-a')
      heldToken = null
      restoreAccessTokenResolver = setMobileAccessTokenResolver(() => {
        if (!holdNextToken) return bearer
        holdNextToken = false
        const token = deferred<string>()
        heldToken = token
        return token.promise
      })
      server.use(http.get('*/api/v1/locations', () => HttpResponse.json({ data: [] })))
    })

    afterEach(() => {
      if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL
      else process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
      restoreAccessTokenResolver()
      setMobileApplicationUserId(null)
    })

    /** The native session moves to member B. */
    function switchToB() {
      act(() => {
        bearer = 'token-b'
        setMobileApplicationUserId('member-b')
      })
    }

    /** Nothing of A's lookup is on B's screen. */
    function expectNothingOfA() {
      expect(screen.queryByTestId('location-search-option-0')).toBeNull()
      expect(screen.queryByText(/Chicago/)).toBeNull()
      expect(screen.queryByTestId('location-error')).toBeNull()
    }

    it('LOC-SWITCH-MOB-01 a switch before the position returns sends nothing under the next member', async () => {
      const position = deferred<unknown>()
      location.getCurrentPositionAsync.mockReturnValue(position.promise)
      server.use(
        http.post('*/api/v1/locations/from-coordinates', ({ request }) => {
          postedBearers.push(request.headers.get('authorization'))
          return HttpResponse.json({ data: [CHICAGO] })
        })
      )
      renderScreen()
      await userEvent.click(await screen.findByTestId('locations-use-my-location'))
      await waitFor(() => expect(location.getCurrentPositionAsync).toHaveBeenCalled())

      switchToB()
      await act(async () => {
        position.resolve({ coords: { ...DEVICE, accuracy: 3000 }, timestamp: 0 })
        await position.promise
      })
      await settleClient()

      expect(tracked.nearbyLookups).toBe(0)
      expect(postedBearers).toEqual([])
      expectNothingOfA()
    })

    it('LOC-SWITCH-MOB-02 a switch while the lookup is in flight keeps its city off the next member screen', async () => {
      location.getCurrentPositionAsync.mockResolvedValue({
        coords: { ...DEVICE, accuracy: 3000 },
        timestamp: 0,
      })
      const lookup = deferred<void>()
      server.use(
        http.post('*/api/v1/locations/from-coordinates', async ({ request }) => {
          postedBearers.push(request.headers.get('authorization'))
          await lookup.promise
          return HttpResponse.json({ data: [CHICAGO] })
        })
      )
      renderScreen()
      await userEvent.click(await screen.findByTestId('locations-use-my-location'))
      await waitFor(() => expect(postedBearers).toEqual(['Bearer token-a']))

      switchToB()
      await act(async () => {
        lookup.resolve()
        await lookup.promise
      })
      await settleClient()

      expect(postedBearers).toEqual(['Bearer token-a'])
      expectNothingOfA()
    })

    it('LOC-SWITCH-MOB-03 a switch while the lookup waits for its bearer sends nothing, and B can still search', async () => {
      location.getCurrentPositionAsync.mockResolvedValue({
        coords: { ...DEVICE, accuracy: 3000 },
        timestamp: 0,
      })
      server.use(
        http.post('*/api/v1/locations/from-coordinates', ({ request }) => {
          postedBearers.push(request.headers.get('authorization'))
          return HttpResponse.json({ data: [CHICAGO] })
        }),
        http.get('*/api/v1/locations/search', ({ request }) => {
          postedBearers.push(`search ${request.headers.get('authorization')}`)
          return HttpResponse.json({ data: [CHICAGO] })
        })
      )
      renderScreen()
      // The first list has finished before the tap.
      await screen.findByTestId('locations-use-my-location')
      await waitFor(() => expect(screen.queryByTestId('locations-loading')).toBeNull())

      holdNextToken = true
      await userEvent.click(screen.getByTestId('locations-use-my-location'))
      await waitFor(() => expect(heldToken).not.toBeNull())

      switchToB()
      await act(async () => {
        heldToken!.resolve('token-b')
        await Promise.resolve()
      })
      await settleClient()

      expect(postedBearers).toEqual([])
      expectNothingOfA()

      // B can still use the screen.
      await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Chicago')
      await waitFor(() =>
        expect(screen.getByTestId('location-search-option-0').textContent).toContain(
          'Chicago'
        )
      )
      expect(postedBearers).toEqual(['search Bearer token-b'])
    })

    // Codex product review 8 finding 3: the OS permission decision is still pending when the tap
    // stops counting. Granting it afterwards starts no reading and sends nothing.
    function holdPermission() {
      const decision = deferred<{ status: string }>()
      location.requestForegroundPermissionsAsync.mockReturnValueOnce(decision.promise)
      location.getCurrentPositionAsync.mockResolvedValue({
        coords: { ...DEVICE, accuracy: 3000 },
        timestamp: 0,
      })
      server.use(
        http.post('*/api/v1/locations/from-coordinates', ({ request }) => {
          postedBearers.push(request.headers.get('authorization'))
          return HttpResponse.json({ data: [CHICAGO] })
        }),
        http.get('*/api/v1/locations/search', ({ request }) => {
          postedBearers.push(`search ${request.headers.get('authorization')}`)
          return HttpResponse.json({ data: [CHICAGO] })
        })
      )
      return decision
    }

    async function tapUseMyLocation() {
      renderScreen()
      await screen.findByTestId('locations-use-my-location')
      await waitFor(() => expect(screen.queryByTestId('locations-loading')).toBeNull())
      await userEvent.click(screen.getByTestId('locations-use-my-location'))
      await waitFor(() =>
        expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1)
      )
    }

    it('LOC-SWITCH-MOB-04 a permission granted after the member started typing starts no position reading', async () => {
      const decision = holdPermission()
      await tapUseMyLocation()

      // The member types instead of waiting; that supersedes the tap.
      await userEvent.fill(screen.getByTestId('locations-search-input'), 'Chi')
      await act(async () => {
        decision.resolve({ status: 'granted' })
        await Promise.resolve()
      })
      await settleClient()

      expect(location.getCurrentPositionAsync).not.toHaveBeenCalled()
      expect(postedBearers.filter((entry) => !entry?.startsWith('search'))).toEqual([])
      expect(screen.queryByTestId('location-error')).toBeNull()
    })

    it('LOC-SWITCH-MOB-05 a permission granted after the phone switched members starts no position reading', async () => {
      const decision = holdPermission()
      await tapUseMyLocation()

      switchToB()
      await act(async () => {
        decision.resolve({ status: 'granted' })
        await Promise.resolve()
      })
      await settleClient()

      expect(location.getCurrentPositionAsync).not.toHaveBeenCalled()
      expect(postedBearers).toEqual([])
      expectNothingOfA()
    })

    // Finding 6: the same member's token refreshes during the OS prompt; the lookup uses the fresh
    // one (an account switch in the same window is LOC-SWITCH-MOB-05: nothing at all).
    it('LOC-SWITCH-MOB-06 a token refreshed for the same member during the prompt sends the fresh token', async () => {
      const decision = holdPermission()
      await tapUseMyLocation()

      bearer = 'token-a2'
      await act(async () => {
        decision.resolve({ status: 'granted' })
        await Promise.resolve()
      })
      await settleClient()

      expect(location.getCurrentPositionAsync).toHaveBeenCalledTimes(1)
      expect(postedBearers).toEqual(['Bearer token-a2'])
      await waitFor(() =>
        expect(screen.getByTestId('location-search-option-0').textContent).toContain(
          'Chicago'
        )
      )
    })
  }
)

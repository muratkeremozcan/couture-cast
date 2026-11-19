// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19), Codex review 1 finding 5, mobile: a
// member taps Use my location, then types another city while the phone is still finding the
// position. Whatever answers last, the typed search wins: the late position (or its denial)
// changes neither the picks, the message nor the focus, and the typed city is the one saved.
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

/**
 * The client calls the race is about, counted when they start and kept until they settle, so a
 * test waits for the late answer to reach the screen instead of sleeping.
 */
const tracked = vi.hoisted(() => ({
  positionReads: 0,
  nearbyLookups: 0,
  promises: [] as Promise<unknown>[],
}))

vi.mock('./device-position', async (importOriginal) => {
  const actual = await importOriginal<typeof DevicePosition>()
  return {
    ...actual,
    readDevicePosition: (...args: Parameters<typeof actual.readDevicePosition>) => {
      tracked.positionReads += 1
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

/** Every tracked call has settled and React has applied what its handlers set. */
async function settleClient() {
  await act(async () => {
    await Promise.allSettled(tracked.promises)
  })
  await act(async () => {
    await Promise.resolve()
  })
}

import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import { locationCandidate } from '@/src/test-utils/locations'
import { LocationsScreen } from './locations-screen'

const CHICAGO = locationCandidate()
const SPRINGFIELD = locationCandidate({
  city: 'Springfield',
  region: 'Missouri',
  displayLabel: 'Springfield, Missouri, United States',
  candidateToken: 'springfield-payload.springfield-signature',
})
const DEVICE = { latitude: 41.878113, longitude: -87.629799 }

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderScreen() {
  render(
    <AccessibilityAnnouncerProvider>
      <LocationsScreen />
    </AccessibilityAnnouncerProvider>
  )
}

async function typeSpringfield() {
  const input = await screen.findByTestId('locations-search-input')
  await userEvent.fill(input, 'Springfield')
  await waitFor(() =>
    expect(screen.getByTestId('location-search-option-0').textContent).toContain(
      'Springfield'
    )
  )
  return input
}

/** After the late answer: the typed search still owns the picks, the message and the focus. */
async function expectTypedSearchWins(input: HTMLElement, savedTokens: string[]) {
  await settleClient()
  expect(screen.getByTestId('location-search-option-0').textContent).toContain(
    'Springfield'
  )
  expect(screen.queryByTestId('location-search-option-1')).toBeNull()
  expect(screen.queryByText(/Chicago/)).toBeNull()
  expect(screen.queryByTestId('location-error')).toBeNull()
  expect(document.activeElement).toBe(input)
  expect((input as HTMLInputElement).value).toBe('Springfield')

  await userEvent.click(screen.getByTestId('location-search-option-0'))
  await userEvent.click(await screen.findByTestId('location-save-button'))
  await waitFor(() => expect(savedTokens).toEqual([SPRINGFIELD.candidateToken]))
}

describe(
  'Use my location never overrides a city the member typed (mobile)',
  { timeout: 30_000 },
  () => {
    let posted: number
    let savedTokens: string[]
    let restoreAccessTokenResolver: () => void
    const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

    beforeAll(async () => {
      await initI18n()
      await i18n.changeLanguage('en-US')
    })

    beforeEach(() => {
      posted = 0
      savedTokens = []
      tracked.positionReads = 0
      tracked.nearbyLookups = 0
      tracked.promises = []
      location.requestForegroundPermissionsAsync.mockReset()
      location.getCurrentPositionAsync.mockReset()
      location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' })
      process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
      restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
      server.use(
        http.get('*/api/v1/locations', () => HttpResponse.json({ data: [] })),
        http.get('*/api/v1/locations/search', ({ request }) => {
          const q = new URL(request.url).searchParams.get('q') ?? ''
          return HttpResponse.json({
            data: q.toLowerCase().startsWith('spring') ? [SPRINGFIELD] : [CHICAGO],
          })
        }),
        http.post('*/api/v1/locations/from-search', async ({ request }) => {
          const body = (await request.json()) as { candidateToken: string; label: string }
          savedTokens.push(body.candidateToken)
          return HttpResponse.json(
            {
              data: {
                id: 'loc-1',
                label: body.label,
                locationKey: 'springfield-key',
                latitude: 37.209,
                longitude: -93.292,
                timezone: 'America/Chicago',
                city: 'Springfield',
                region: 'Missouri',
                country: 'US',
                isPrimary: true,
                sortOrder: 0,
                createdAt: '2026-11-19T12:00:00.000Z',
                updatedAt: '2026-11-19T12:00:00.000Z',
              },
            },
            { status: 201 }
          )
        })
      )
    })

    afterEach(() => {
      if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL
      else process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
      restoreAccessTokenResolver()
    })

    it('LOC-RACE-MOB-01 typing while the position is pending: the late position sends nothing and changes nothing', async () => {
      const position = deferred<unknown>()
      location.getCurrentPositionAsync.mockReturnValue(position.promise)
      server.use(
        http.post('*/api/v1/locations/from-coordinates', () => {
          posted += 1
          return HttpResponse.json({ data: [CHICAGO] })
        })
      )
      renderScreen()
      await userEvent.click(await screen.findByTestId('locations-use-my-location'))
      await waitFor(() => expect(location.getCurrentPositionAsync).toHaveBeenCalled())

      const input = await typeSpringfield()
      await act(async () => {
        position.resolve({ coords: { ...DEVICE, accuracy: 3000 }, timestamp: 0 })
        await position.promise
      })

      await settleClient()
      expect(tracked.positionReads).toBe(1)
      // Counted when the screen would start the lookup, so a late one cannot slip past.
      expect(tracked.nearbyLookups).toBe(0)
      expect(posted).toBe(0)
      await expectTypedSearchWins(input, savedTokens)
    })

    it('LOC-RACE-MOB-02 typing while the city lookup is in flight: the late Chicago is dropped', async () => {
      location.getCurrentPositionAsync.mockResolvedValue({
        coords: { ...DEVICE, accuracy: 3000 },
        timestamp: 0,
      })
      const lookup = deferred<void>()
      server.use(
        http.post('*/api/v1/locations/from-coordinates', async () => {
          posted += 1
          await lookup.promise
          return HttpResponse.json({ data: [CHICAGO] })
        })
      )
      renderScreen()
      await userEvent.click(await screen.findByTestId('locations-use-my-location'))
      await waitFor(() => expect(posted).toBe(1))

      const input = await typeSpringfield()
      await act(async () => {
        lookup.resolve()
        await lookup.promise
      })

      await expectTypedSearchWins(input, savedTokens)
    })

    it('LOC-RACE-MOB-03 typing while permission is pending: a late denial says nothing and keeps the focus', async () => {
      const permission = deferred<{ status: string }>()
      location.requestForegroundPermissionsAsync.mockReturnValue(permission.promise)
      renderScreen()
      await userEvent.click(await screen.findByTestId('locations-use-my-location'))
      await waitFor(() =>
        expect(location.requestForegroundPermissionsAsync).toHaveBeenCalled()
      )

      const input = await typeSpringfield()
      await act(async () => {
        permission.resolve({ status: 'denied' })
        await permission.promise
      })

      await settleClient()
      expect(location.getCurrentPositionAsync).not.toHaveBeenCalled()
      expect(tracked.nearbyLookups).toBe(0)
      await expectTypedSearchWins(input, savedTokens)
    })
  }
)

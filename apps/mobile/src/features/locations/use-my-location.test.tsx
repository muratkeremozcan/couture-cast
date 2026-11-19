// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19): Jade asked for the app to find her city with her approval.
// Use my location on the mobile Locations screen asks for when-in-use permission only on the
// tap, reads one low-accuracy fix, rounds it to two decimals, posts it in a body and offers the
// cities the API finds as ordinary picks. Denial, no position, no nearby city and a provider
// outage each say why and leave city search focused and working. The device is the boundary
// here (expo-location is mocked); requests still run through MSW and the real client.
import React from 'react'
import { userEvent } from 'vitest/browser'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type { SavedLocation } from '@couture/api-client/contracts/http'

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

import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import * as Location from 'expo-location'
import { approximateCoordinate } from '@/src/lib/locations'
import {
  locationCandidate,
  locationUnavailableResponse,
  savedLocation,
} from '@/src/test-utils/locations'
import { DevicePositionError, readDevicePosition } from './device-position'
import { LocationsScreen } from './locations-screen'

const CANDIDATE = locationCandidate()
/** More precise than the phone may send; rounds to 41.88, -87.63. */
const DEVICE = { latitude: 41.878113, longitude: -87.629799 }
const FROM_COORDINATES = '*/api/v1/locations/from-coordinates'

const DENIED = 'Location access is off. Search for your city instead.'
const UNAVAILABLE =
  'Your location is not available right now. Search for your city instead.'
const NO_CITY = 'No city found near you. Search for your city instead.'
const SEARCH_DOWN = 'City search is temporarily unavailable. Try again.'

function grant() {
  location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' })
  location.getCurrentPositionAsync.mockResolvedValue({
    coords: { ...DEVICE, accuracy: 3000 },
    timestamp: 0,
  })
}

function renderScreen() {
  render(
    <AccessibilityAnnouncerProvider>
      <LocationsScreen />
    </AccessibilityAnnouncerProvider>
  )
}

async function tapUseMyLocation() {
  await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
}

/** Failure leaves manual search working: the field has focus and still finds a city. */
async function expectSearchStillWorks() {
  const input = await screen.findByTestId('locations-search-input')
  await waitFor(() => expect(document.activeElement).toBe(input))
  await userEvent.fill(input, 'Chicago')
  await screen.findByTestId('location-search-option-0')
}

describe('Use my location (mobile)', { timeout: 30_000 }, () => {
  let saved: SavedLocation[]
  let posted: { url: string; body: unknown; platform: string | null }[]
  let restoreAccessTokenResolver: () => void
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    saved = []
    posted = []
    location.requestForegroundPermissionsAsync.mockReset()
    location.getCurrentPositionAsync.mockReset()
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    server.use(
      http.get('*/api/v1/locations', () => HttpResponse.json({ data: saved })),
      http.get('*/api/v1/locations/search', () =>
        HttpResponse.json({ data: [CANDIDATE] })
      )
    )
  })

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL
    else process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
    restoreAccessTokenResolver()
    setMobileApplicationUserId(null)
  })

  function fromCoordinatesHandler(respond: () => Response) {
    return http.post(FROM_COORDINATES, async ({ request }) => {
      posted.push({
        url: request.url,
        body: await request.json(),
        platform: request.headers.get('x-couture-platform'),
      })
      return respond()
    })
  }

  it('ULM-MOB-01 asks only on the tap, sends the rounded position in the body, and saves the city it finds', async () => {
    grant()
    let saveBody: unknown
    server.use(
      fromCoordinatesHandler(() => HttpResponse.json({ data: [CANDIDATE] })),
      http.post('*/api/v1/locations/from-search', async ({ request }) => {
        saveBody = await request.json()
        saved = [savedLocation()]
        return HttpResponse.json({ data: saved[0] }, { status: 201 })
      })
    )

    renderScreen()
    await screen.findByTestId('locations-search-input')
    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled()
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled()

    await tapUseMyLocation()

    const option = await screen.findByTestId('location-search-option-0')
    expect(option).toHaveTextContent(CANDIDATE.displayLabel)
    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1)
    expect(location.getCurrentPositionAsync).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.Lowest,
    })
    expect(posted).toHaveLength(1)
    expect(new URL(posted[0]!.url).search).toBe('')
    expect(posted[0]!.body).toEqual({
      latitude: 41.88,
      longitude: -87.63,
      locale: 'en-US',
    })
    expect(posted[0]!.platform).toBe('mobile')

    await userEvent.click(option)
    await userEvent.fill(await screen.findByTestId('location-label-input'), 'Home')
    await userEvent.click(screen.getByTestId('location-save-button'))

    await screen.findByTestId('location-primary-badge-0')
    expect(screen.getByTestId('location-label-0').textContent).toBe('Home')
    expect(saveBody).toEqual({ candidateToken: CANDIDATE.candidateToken, label: 'Home' })
  })

  it('ULM-MOB-02 a member who says no is told why, nothing is sent, and search keeps working', async () => {
    location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' })
    server.use(fromCoordinatesHandler(() => HttpResponse.json({ data: [CANDIDATE] })))

    renderScreen()
    await tapUseMyLocation()

    expect((await screen.findByTestId('location-error')).textContent).toBe(DENIED)
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled()
    expect(posted).toHaveLength(0)
    await expectSearchStillWorks()
  })

  it('ULM-MOB-03 a phone with no position says so, sends nothing, and search keeps working', async () => {
    location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' })
    location.getCurrentPositionAsync.mockRejectedValue(
      new Error('Location services are disabled')
    )
    server.use(fromCoordinatesHandler(() => HttpResponse.json({ data: [CANDIDATE] })))

    renderScreen()
    await tapUseMyLocation()

    expect((await screen.findByTestId('location-error')).textContent).toBe(UNAVAILABLE)
    expect(posted).toHaveLength(0)
    await expectSearchStillWorks()
  })

  it('ULM-MOB-04 no city near the member: a clear message, no picks, and search keeps working', async () => {
    grant()
    server.use(fromCoordinatesHandler(() => HttpResponse.json({ data: [] })))

    renderScreen()
    await tapUseMyLocation()

    expect((await screen.findByTestId('location-error')).textContent).toBe(NO_CITY)
    expect(screen.queryByTestId('location-search-option-0')).toBeNull()
    expect(posted).toHaveLength(1)
    await expectSearchStillWorks()
  })

  it('ULM-MOB-05 a provider outage reads as the search outage, and Try again asks again', async () => {
    grant()
    let attempts = 0
    server.use(
      fromCoordinatesHandler(() => {
        attempts += 1
        return attempts === 1
          ? locationUnavailableResponse()
          : HttpResponse.json({ data: [CANDIDATE] })
      })
    )

    renderScreen()
    await tapUseMyLocation()

    expect((await screen.findByTestId('location-error')).textContent).toBe(SEARCH_DOWN)
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('locations-search-input'))
    )

    await userEvent.click(screen.getByTestId('location-retry-button'))

    await screen.findByTestId('location-search-option-0')
    expect(screen.queryByTestId('location-error')).toBeNull()
    expect(attempts).toBe(2)
    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2)
  })
  /*
   * Review finding (2026-11-19): a tap belongs to the member who made it. A
   * session switch while the position or the request is pending must not send
   * A's position under B's bearer, nor show A's city to B.
   */
  function hold<T>() {
    let release!: (value: T) => void
    const promise = new Promise<T>((resolve) => {
      release = resolve
    })
    return { promise, release }
  }

  async function expectNothingLeftForTheNextMember() {
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Use my location' })).not.toHaveAttribute(
        'aria-busy',
        'true'
      )
    )
    expect(screen.queryByTestId('location-search-option-0')).toBeNull()
    expect(screen.queryByTestId('location-error')).toBeNull()
  }

  it('ULM-MOB-09 a member switch before the position arrives sends nothing', async () => {
    setMobileApplicationUserId('member-a')
    const fix = hold<unknown>()
    location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' })
    location.getCurrentPositionAsync.mockReturnValue(fix.promise)
    server.use(fromCoordinatesHandler(() => HttpResponse.json({ data: [CANDIDATE] })))
    renderScreen()

    await tapUseMyLocation()
    await waitFor(() => expect(location.getCurrentPositionAsync).toHaveBeenCalled())
    act(() => setMobileApplicationUserId('member-b'))
    await act(async () => {
      fix.release({ coords: { ...DEVICE, accuracy: 3000 }, timestamp: 0 })
      await fix.promise
    })

    await expectNothingLeftForTheNextMember()
    expect(posted).toHaveLength(0)
  })

  it('ULM-MOB-10 a member switch after the request starts drops its answer', async () => {
    setMobileApplicationUserId('member-a')
    grant()
    const answer = hold<void>()
    const bearers: (string | null)[] = []
    server.use(
      http.post(FROM_COORDINATES, async ({ request }) => {
        bearers.push(request.headers.get('authorization'))
        posted.push({ url: request.url, body: null, platform: null })
        await answer.promise
        return HttpResponse.json({ data: [CANDIDATE] })
      })
    )
    renderScreen()

    await tapUseMyLocation()
    await waitFor(() => expect(posted).toHaveLength(1))
    act(() => setMobileApplicationUserId('member-b'))
    await act(async () => {
      answer.release()
      await answer.promise
    })

    await expectNothingLeftForTheNextMember()
    expect(bearers).toEqual(['Bearer session-token'])
  })

  /*
   * Review finding (2026-11-19): a save belongs to the member who picked the
   * place. A switch while the bearer is still resolving sends nothing; a switch
   * after the POST left leaves the next member's screen alone.
   */
  async function pickTheCityNearby() {
    grant()
    server.use(fromCoordinatesHandler(() => HttpResponse.json({ data: [CANDIDATE] })))
    renderScreen()
    await tapUseMyLocation()
    await userEvent.click(await screen.findByTestId('location-search-option-0'))
    await userEvent.fill(await screen.findByTestId('location-label-input'), 'Home')
  }

  function liveRegionText() {
    return document.getElementById('a11y-live-announcer')?.textContent ?? ''
  }

  it('ULM-MOB-11 a member switch while the save waits for its bearer sends nothing', async () => {
    setMobileApplicationUserId('member-a')
    const saves: (string | null)[] = []
    server.use(
      http.post('*/api/v1/locations/from-search', ({ request }) => {
        saves.push(request.headers.get('authorization'))
        return HttpResponse.json({ data: savedLocation() }, { status: 201 })
      })
    )
    await pickTheCityNearby()
    const token = hold<string>()
    const restore = setMobileAccessTokenResolver(() => token.promise)

    await userEvent.click(screen.getByTestId('location-save-button'))
    act(() => setMobileApplicationUserId('member-b'))
    await act(async () => {
      token.release('member-b-token')
      await token.promise
    })
    restore()

    await waitFor(() => expect(screen.queryByTestId('location-label-input')).toBeNull())
    expect(saves).toEqual([])
    expect(liveRegionText()).not.toContain('Home saved.')
  })

  it('ULM-MOB-12 a save that answers after the switch leaves the next member alone', async () => {
    setMobileApplicationUserId('member-a')
    const answer = hold<void>()
    const saves: (string | null)[] = []
    server.use(
      http.post('*/api/v1/locations/from-search', async ({ request }) => {
        saves.push(request.headers.get('authorization'))
        await answer.promise
        return HttpResponse.json({ data: savedLocation() }, { status: 201 })
      })
    )
    await pickTheCityNearby()

    await userEvent.click(screen.getByTestId('location-save-button'))
    await waitFor(() => expect(saves).toHaveLength(1))
    act(() => setMobileApplicationUserId('member-b'))
    // The next member starts a search of their own.
    const input = await screen.findByTestId('locations-search-input')
    await userEvent.fill(input, 'Spr')
    await act(async () => {
      answer.release()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(saves).toEqual(['Bearer session-token'])
    expect(input).toHaveValue('Spr')
    expect(liveRegionText()).not.toContain('Home saved.')
  })
})

describe('readDevicePosition', () => {
  beforeEach(() => {
    location.requestForegroundPermissionsAsync.mockReset()
    location.getCurrentPositionAsync.mockReset()
  })

  it('ULM-MOB-06 gives up on a position that never comes, as unavailable', async () => {
    location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' })
    location.getCurrentPositionAsync.mockReturnValue(new Promise(() => undefined))

    const failure = await readDevicePosition(20).catch((caught: unknown) => caught)

    expect(failure).toBeInstanceOf(DevicePositionError)
    expect((failure as DevicePositionError).reason).toBe('location_unavailable')
  })

  it('ULM-MOB-07 reads a permission prompt that fails as unavailable, never as denied', async () => {
    location.requestForegroundPermissionsAsync.mockRejectedValue(new Error('no activity'))

    const failure = await readDevicePosition().catch((caught: unknown) => caught)

    expect((failure as DevicePositionError).reason).toBe('location_unavailable')
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled()
  })

  it('ULM-MOB-08 rounds to two decimals, about a kilometre, with no negative zero', () => {
    expect(approximateCoordinate(41.878113)).toBe(41.88)
    expect(approximateCoordinate(-87.629799)).toBe(-87.63)
    expect(approximateCoordinate(-0.004)).toBe(0)
    expect(Object.is(approximateCoordinate(-0.004), -0)).toBe(false)
  })
})

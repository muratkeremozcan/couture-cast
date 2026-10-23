// Story 1.2b: the mobile Locations screen through MSW, so the request shapes,
// the platform header and the contract parsing run with the UI.
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type { SavedLocation } from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const routerMock = vi.hoisted(() => ({
  back: vi.fn(),
  canGoBack: vi.fn(() => true),
  push: vi.fn(),
}))
vi.mock('expo-router', () => ({ router: routerMock }))

import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import { onLocationsChanged } from '@/src/lib/locations'
import { press } from '@/src/test-utils/press'
import { LocationsScreen } from './locations-screen'

const CANDIDATE = {
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  latitude: 41.878,
  longitude: -87.63,
  displayLabel: 'Chicago, Illinois, United States',
  candidateToken: 'candidate-payload.candidate-signature',
}

function location(overrides: Partial<SavedLocation> = {}): SavedLocation {
  return {
    id: 'loc-1',
    label: 'Home',
    locationKey: 'chicago-illinois-us-41-878n-87-630w',
    latitude: 41.878,
    longitude: -87.63,
    timezone: 'America/Chicago',
    city: 'Chicago',
    region: 'Illinois',
    country: 'US',
    isPrimary: true,
    sortOrder: 0,
    createdAt: '2026-10-22T12:00:00.000Z',
    updatedAt: '2026-10-22T12:00:00.000Z',
    ...overrides,
  }
}

const office = location({
  id: 'loc-2',
  label: 'Office',
  locationKey: 'monaco-mc-43-738n-7-425e',
  city: 'Monaco',
  region: null,
  country: 'MC',
  isPrimary: false,
  sortOrder: 1,
})

function renderScreen(guided = false) {
  render(
    <AccessibilityAnnouncerProvider>
      <LocationsScreen guided={guided} />
    </AccessibilityAnnouncerProvider>
  )
}

function liveRegion() {
  return document.getElementById('a11y-live-announcer')?.textContent ?? ''
}

describe('LocationsScreen', () => {
  let saved: SavedLocation[]
  let restoreAccessTokenResolver: () => void
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    saved = []
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    server.use(http.get('*/api/v1/locations', () => HttpResponse.json({ data: saved })))
  })

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL
    else process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
    restoreAccessTokenResolver()
    routerMock.back.mockClear()
    routerMock.push.mockClear()
  })

  function searchHandler(onRequest?: (request: Request) => void) {
    return http.get('*/api/v1/locations/search', ({ request }) => {
      onRequest?.(request)
      return HttpResponse.json({ data: [CANDIDATE] })
    })
  }

  it('1.2b-MOB-01 lists label, place and the primary marker', async () => {
    saved = [location(), office]

    renderScreen()

    expect((await screen.findByTestId('location-label-0')).textContent).toBe('Home')
    expect(screen.getByTestId('location-primary-badge-0')).toBeTruthy()
    expect(screen.queryByTestId('location-primary-badge-1')).toBeNull()
    expect(screen.getByText('Monaco')).toBeTruthy()
    expect(screen.getByTestId('locations-count').textContent).toBe('2 of 3 saved')
  })

  it('1.2b-MOB-02 debounces search, sends the mobile platform and announces the count once', async () => {
    const requests: Request[] = []
    server.use(searchHandler((request) => requests.push(request)))

    renderScreen()
    const input = await screen.findByTestId('locations-search-input')
    fireEvent.change(input, { target: { value: 'Ch' } })
    fireEvent.change(input, { target: { value: 'Chicago' } })

    await screen.findByTestId('location-search-option-0')
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0]!.url).searchParams.get('q')).toBe('Chicago')
    expect(requests[0]!.headers.get('x-couture-platform')).toBe('mobile')
    await waitFor(() => expect(liveRegion()).toBe('Results: 1'))
  })

  it('1.2b-MOB-03 saves a chosen city, reloads the list and notifies listeners', async () => {
    const changed = vi.fn()
    const unsubscribe = onLocationsChanged(changed)
    let body: unknown
    server.use(
      searchHandler(),
      http.post('*/api/v1/locations/from-search', async ({ request }) => {
        body = await request.json()
        saved = [location()]
        return HttpResponse.json({ data: saved[0] }, { status: 201 })
      })
    )

    renderScreen()
    fireEvent.change(await screen.findByTestId('locations-search-input'), {
      target: { value: 'Chicago' },
    })
    press(await screen.findByTestId('location-search-option-0'))
    const label = await screen.findByTestId('location-label-input')
    fireEvent.change(label, { target: { value: 'Home' } })
    press(screen.getByTestId('location-save-button'))

    await screen.findByTestId('location-primary-badge-0')
    expect(body).toEqual({ candidateToken: CANDIDATE.candidateToken, label: 'Home' })
    expect(changed).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(liveRegion()).toBe('Home saved.'))
    expect(routerMock.back).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('1.2b-MOB-04 returns to the originating screen after a guided save', async () => {
    server.use(
      searchHandler(),
      http.post('*/api/v1/locations/from-search', () => {
        saved = [location()]
        return HttpResponse.json({ data: saved[0] }, { status: 201 })
      })
    )

    renderScreen(true)
    fireEvent.change(await screen.findByTestId('locations-search-input'), {
      target: { value: 'Chicago' },
    })
    press(await screen.findByTestId('location-search-option-0'))
    press(await screen.findByTestId('location-save-button'))

    await waitFor(() => expect(routerMock.back).toHaveBeenCalledTimes(1))
  })

  it('1.2b-MOB-05 keeps the chosen city on a 503 and saves on retry', async () => {
    let attempts = 0
    server.use(
      searchHandler(),
      http.post('*/api/v1/locations/from-search', () => {
        attempts += 1
        if (attempts === 1) {
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
        }
        saved = [location()]
        return HttpResponse.json({ data: saved[0] }, { status: 201 })
      })
    )

    renderScreen()
    fireEvent.change(await screen.findByTestId('locations-search-input'), {
      target: { value: 'Chicago' },
    })
    press(await screen.findByTestId('location-search-option-0'))
    press(await screen.findByTestId('location-save-button'))

    expect((await screen.findByTestId('location-error')).textContent).toBe(
      'City search is temporarily unavailable. Try again.'
    )
    expect(screen.getByTestId('location-selected')).toBeTruthy()
    press(screen.getByTestId('location-retry-button'))

    await screen.findByTestId('location-primary-badge-0')
    expect(attempts).toBe(2)
  })

  it('1.2b-MOB-06 explains the three-location limit instead of the add form', async () => {
    saved = [
      location(),
      office,
      location({ id: 'loc-3', label: 'Gym', isPrimary: false }),
    ]

    renderScreen()

    expect((await screen.findByTestId('locations-limit')).textContent).toBe(
      'You have saved three locations. Delete one to add another.'
    )
    expect(screen.queryByTestId('locations-search-input')).toBeNull()
  })

  it('1.2b-MOB-07 switches primary in one tap and announces it once', async () => {
    saved = [location(), office]
    server.use(
      http.post('*/api/v1/locations/loc-2/primary', () => {
        saved = [location({ isPrimary: false }), { ...office, isPrimary: true }]
        return HttpResponse.json({ data: saved[1] })
      })
    )

    renderScreen()
    press(await screen.findByTestId('location-make-primary-1'))

    await screen.findByTestId('location-primary-badge-1')
    await waitFor(() => expect(liveRegion()).toBe('Office is now your primary location.'))
  })

  it('1.2b-MOB-08 renames and deletes after an inline confirmation', async () => {
    saved = [location(), office]
    server.use(
      http.patch('*/api/v1/locations/loc-2', async ({ request }) => {
        const { label } = (await request.json()) as { label: string }
        saved = [location(), { ...office, label }]
        return HttpResponse.json({ data: saved[1] })
      }),
      http.delete('*/api/v1/locations/loc-1', () => {
        saved = [{ ...saved[1]!, isPrimary: true }]
        return HttpResponse.json({ data: { deleted: true } })
      })
    )

    renderScreen()
    press(await screen.findByTestId('location-rename-1'))
    fireEvent.change(screen.getByTestId('location-rename-input-1'), {
      target: { value: 'Studio' },
    })
    press(screen.getByTestId('location-rename-save-1'))
    await waitFor(() =>
      expect(screen.getByTestId('location-label-1').textContent).toBe('Studio')
    )

    press(screen.getByTestId('location-delete-0'))
    expect(screen.getByText('Delete Home?')).toBeTruthy()
    press(screen.getByTestId('location-delete-confirm'))
    await waitFor(() => expect(screen.queryByTestId('location-item-1')).toBeNull())
    await waitFor(() => expect(liveRegion()).toBe('Home deleted.'))
  })

  it('1.2b-MOB-09 keeps every action target at least 44 points', async () => {
    saved = [location(), office]

    renderScreen()
    await screen.findByTestId('location-make-primary-1')

    for (const testId of [
      'location-make-primary-1',
      'location-rename-0',
      'location-delete-0',
      'locations-search-input',
    ]) {
      const style = window.getComputedStyle(screen.getByTestId(testId))
      expect(Number.parseFloat(style.minHeight), testId).toBeGreaterThanOrEqual(44)
    }
  })
})

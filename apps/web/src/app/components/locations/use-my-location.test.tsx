// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19). Jade: the app never offered to use
// her location. Locations now has "Use my location": the browser is asked for the position only
// on the tap, the client rounds it to two decimals and POSTs it, and the nearest city comes back
// as an option in the same list, saved through the same pick, name and save steps. Every failure
// says why and hands focus to the city search. The browser proof is UL-1..UL-5 in
// playwright/tests/location-use-my-location.spec.ts; these pin the client half of each case.
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LocationSearchCandidate,
  SavedLocation,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../../i18n'
import { DEVICE_POSITION_TIMEOUT_MS } from '../../../lib/device-position'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/wardrobe'
import { useMswHandlers } from '../../../test-utils/msw/runtime'
import { LocationsSection } from './locations-section'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const FROM_COORDINATES_PATH = '/api/v1/locations/from-coordinates'
const DENIED = 'Location access is off. Search for your city instead.'
const UNAVAILABLE =
  'Your location is not available right now. Search for your city instead.'
const NO_CITY = 'No city found near you. Search for your city instead.'
const SEARCH_UNAVAILABLE = 'City search is temporarily unavailable. Try again.'

/** More precise than the client may send; rounds to 41.88, -87.63. */
const DEVICE = { latitude: 41.878113, longitude: -87.629799 }

const CHICAGO: LocationSearchCandidate = {
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  latitude: 41.878,
  longitude: -87.63,
  displayLabel: 'Chicago, Illinois, United States',
  candidateToken: 'chicago-payload.chicago-signature',
}

const HOME: SavedLocation = {
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
}

type PositionAnswer =
  | { kind: 'position'; latitude: number; longitude: number }
  | { kind: 'error'; code: 1 | 2 | 3 }

/** A browser geolocation that answers what the test says, and records each request. */
function installGeolocation(answer: PositionAnswer) {
  const getCurrentPosition = vi.fn(
    (
      success: PositionCallback,
      failure?: PositionErrorCallback | null,
      _options?: PositionOptions
    ) => {
      if (answer.kind === 'position') {
        success({
          coords: { latitude: answer.latitude, longitude: answer.longitude },
        } as GeolocationPosition)
      } else {
        failure?.({ code: answer.code, message: 'no' } as GeolocationPositionError)
      }
    }
  )
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  })
  return getCurrentPosition
}

function removeGeolocation() {
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: undefined,
  })
}

function renderSection() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <main>
        <LocationsSection />
      </main>
    </I18nextProvider>
  )
}

function useMyLocation() {
  return screen.findByRole('button', { name: 'Use my location' })
}

function searchInput() {
  return screen.getByRole('combobox', { name: 'Search for a city' })
}

describe('Use my location (web)', () => {
  let user: UserEvent
  let saved: SavedLocation[]
  let posted: Request[]
  let fromCoordinates: () => Response

  beforeEach(async () => {
    user = userEvent.setup()
    saved = []
    posted = []
    fromCoordinates = () => HttpResponse.json({ data: [CHICAGO] })
    // Only the e2e fixture bearer counts without a verified member.
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-member')
    useMswHandlers(
      http.get('/api/v1/locations', () => HttpResponse.json({ data: saved })),
      http.post(FROM_COORDINATES_PATH, ({ request }) => {
        posted.push(request.clone())
        return fromCoordinates()
      }),
      http.get('/api/v1/locations/search', () => HttpResponse.json({ data: [CHICAGO] })),
      http.post('/api/v1/locations/from-search', () => {
        saved = [HOME]
        return HttpResponse.json({ data: HOME }, { status: 201 })
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    window.sessionStorage.clear()
    Reflect.deleteProperty(window.navigator, 'geolocation')
  })

  /** A failure leaves manual search working: the field has focus and still finds a city. */
  async function expectManualSearchStillWorks() {
    const input = searchInput()
    await waitFor(() => expect(input).toHaveFocus())
    await user.type(input, 'Chicago')
    expect(
      await screen.findByRole('option', { name: CHICAGO.displayLabel })
    ).toBeInTheDocument()
  }

  it('LOC-USE-WEB-01 asks for the position only on the tap and saves the city it finds', async () => {
    const getCurrentPosition = installGeolocation({ kind: 'position', ...DEVICE })
    renderSection()
    const action = await useMyLocation()
    expect(getCurrentPosition).not.toHaveBeenCalled()

    await user.click(action)

    const option = await screen.findByRole('option', { name: CHICAGO.displayLabel })
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition.mock.calls[0]?.[2]).toMatchObject({
      enableHighAccuracy: false,
      timeout: DEVICE_POSITION_TIMEOUT_MS,
    })
    expect(posted).toHaveLength(1)
    const request = posted[0]!
    expect(new URL(request.url).search).toBe('')
    expect(request.headers.get('x-couture-platform')).toBe('web')
    expect(await request.json()).toEqual({
      latitude: 41.88,
      longitude: -87.63,
      locale: 'en-US',
    })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Results: 1')
    )

    await user.click(option)
    const label = screen.getByRole('textbox', { name: 'Name this place' })
    await waitFor(() => expect(label).toHaveFocus())
    await user.clear(label)
    await user.type(label, 'Home{Enter}')
    expect(await screen.findByTestId('location-item-label')).toHaveTextContent('Home')
  })

  it('LOC-USE-WEB-02 explains a denial, sends nothing and keeps search working', async () => {
    installGeolocation({ kind: 'error', code: 1 })
    renderSection()

    await user.click(await useMyLocation())

    expect(await screen.findByRole('alert')).toHaveTextContent(DENIED)
    expect(posted).toHaveLength(0)
    await expectManualSearchStillWorks()
  })

  it('LOC-USE-WEB-03 explains a browser without geolocation and keeps search working', async () => {
    removeGeolocation()
    renderSection()

    await user.click(await useMyLocation())

    expect(await screen.findByRole('alert')).toHaveTextContent(UNAVAILABLE)
    expect(posted).toHaveLength(0)
    await expectManualSearchStillWorks()
  })

  it.each([
    ['a timeout', 3 as const],
    ['an unknown position', 2 as const],
  ])('LOC-USE-WEB-04 reads %s as unavailable', async (_case, code) => {
    installGeolocation({ kind: 'error', code })
    renderSection()

    await user.click(await useMyLocation())

    expect(await screen.findByRole('alert')).toHaveTextContent(UNAVAILABLE)
    expect(posted).toHaveLength(0)
    await waitFor(() => expect(searchInput()).toHaveFocus())
  })

  it('LOC-USE-WEB-05 reads a provider outage as the search outage and locates again on retry', async () => {
    installGeolocation({ kind: 'position', ...DEVICE })
    fromCoordinates = () =>
      HttpResponse.json(
        {
          statusCode: 503,
          code: 'provider_unavailable',
          retryable: true,
          message: 'down',
          error: 'Service Unavailable',
        },
        { status: 503 }
      )
    renderSection()

    await user.click(await useMyLocation())

    expect(await screen.findByRole('alert')).toHaveTextContent(SEARCH_UNAVAILABLE)
    await waitFor(() => expect(searchInput()).toHaveFocus())

    fromCoordinates = () => HttpResponse.json({ data: [CHICAGO] })
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByRole('option', { name: CHICAGO.displayLabel })
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(posted).toHaveLength(2)
  })

  it('LOC-USE-WEB-06 says no city is near and offers no option', async () => {
    installGeolocation({ kind: 'position', latitude: 0, longitude: 0 })
    fromCoordinates = () => HttpResponse.json({ data: [] })
    renderSection()

    await user.click(await useMyLocation())

    expect(await screen.findByRole('alert')).toHaveTextContent(NO_CITY)
    expect(screen.queryByRole('option')).toBeNull()
    await expectManualSearchStillWorks()
  })
})

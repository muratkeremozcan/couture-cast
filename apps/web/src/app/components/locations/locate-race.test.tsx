// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19), Codex review 1 finding 5: a member
// taps Use my location, then types another city while the browser is still finding the position.
// Whatever answers last, the typed search wins: the late device position (or its error) changes
// neither the options, the feedback nor the focus, and Enter picks the typed city. A save in
// flight also blocks a new locate.
import { http, HttpResponse } from 'msw'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LocationSearchCandidate,
  SavedLocation,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/wardrobe'
import { useMswHandlers } from '../../../test-utils/msw/runtime'
import type * as DevicePosition from '../../../lib/device-position'
import type * as Locations from '../../../lib/locations'
import { LocationsSection } from './locations-section'

/**
 * The client calls the race is about, counted when they start and kept until they settle, so a
 * test can wait for the late answer to reach the component instead of sleeping.
 */
const tracked = vi.hoisted(() => ({
  positionReads: 0,
  coordinateLookups: 0,
  promises: [] as Promise<unknown>[],
}))

vi.mock('../../../lib/device-position', async (importOriginal) => {
  const actual = await importOriginal<typeof DevicePosition>()
  return {
    ...actual,
    readApproximatePosition: () => {
      tracked.positionReads += 1
      const reading = actual.readApproximatePosition()
      tracked.promises.push(reading)
      return reading
    },
  }
})

vi.mock('../../../lib/locations', async (importOriginal) => {
  const actual = await importOriginal<typeof Locations>()
  return {
    ...actual,
    locationsFromCoordinatesFromWeb: (
      ...args: Parameters<typeof actual.locationsFromCoordinatesFromWeb>
    ) => {
      tracked.coordinateLookups += 1
      const lookup = actual.locationsFromCoordinatesFromWeb(...args)
      tracked.promises.push(lookup)
      return lookup
    },
  }
})

/** Every tracked client call has settled and React has applied what its handlers set. */
async function settleClient() {
  await act(async () => {
    await Promise.allSettled(tracked.promises)
  })
  await act(async () => {
    await Promise.resolve()
  })
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

function candidate(city: string, region: string): LocationSearchCandidate {
  return {
    city,
    region,
    country: 'US',
    latitude: 41.878,
    longitude: -87.63,
    displayLabel: `${city}, ${region}, United States`,
    candidateToken: `${city.toLowerCase()}-payload.signature`,
  }
}

const CHICAGO = candidate('Chicago', 'Illinois')
const SPRINGFIELD = candidate('Springfield', 'Missouri')

/** The browser's pending position request, answered by the test. */
let pendingPosition: {
  success: PositionCallback
  failure?: PositionErrorCallback | null
} | null
let fromCoordinatesPosts: number
let holdFromCoordinates: { release: () => void } | null
let holdSave: { release: () => void } | null
let getCurrentPosition: ReturnType<typeof vi.fn>

function installPendingGeolocation() {
  getCurrentPosition = vi.fn(
    (success: PositionCallback, failure?: PositionErrorCallback | null) => {
      pendingPosition = { success, failure }
    }
  )
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
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

const searchInput = () => screen.getByRole('combobox', { name: 'Search for a city' })
const useMyLocation = () => screen.findByRole('button', { name: 'Use my location' })

async function typeSpringfield(user: UserEvent) {
  await user.type(searchInput(), 'Springfield')
  expect(
    await screen.findByRole('option', { name: SPRINGFIELD.displayLabel })
  ).toBeInTheDocument()
}

/** After the late answer: the typed search still owns the list, the focus and the feedback. */
async function expectTypedSearchWins(user: UserEvent) {
  await settleClient()
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    expect.stringContaining('Springfield'),
  ])
  expect(screen.queryByRole('option', { name: CHICAGO.displayLabel })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(searchInput()).toHaveFocus()
  expect(searchInput()).toHaveValue('Springfield')
  const action = screen.getByRole('button', { name: 'Use my location' })
  expect(action).not.toHaveAttribute('aria-busy', 'true')

  await user.keyboard('{ArrowDown}{Enter}')
  const label = screen.getByRole('textbox', { name: 'Name this place' })
  await waitFor(() => expect(label).toHaveValue('Springfield'))
}

describe('Use my location never overrides a city the member typed (web)', () => {
  let user: UserEvent

  beforeEach(async () => {
    user = userEvent.setup()
    pendingPosition = null
    fromCoordinatesPosts = 0
    tracked.positionReads = 0
    tracked.coordinateLookups = 0
    tracked.promises = []
    holdFromCoordinates = null
    holdSave = null
    installPendingGeolocation()
    // Only the e2e fixture bearer counts without a verified member.
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-member')
    useMswHandlers(
      http.get('/api/v1/locations', () =>
        HttpResponse.json({ data: [] as SavedLocation[] })
      ),
      http.get('/api/v1/locations/search', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q') ?? ''
        return HttpResponse.json({
          data: q.toLowerCase().startsWith('spring') ? [SPRINGFIELD] : [CHICAGO],
        })
      }),
      http.post('/api/v1/locations/from-coordinates', async () => {
        fromCoordinatesPosts += 1
        if (holdFromCoordinates === null)
          await new Promise<void>((resolve) => {
            holdFromCoordinates = { release: resolve }
          })
        return HttpResponse.json({ data: [CHICAGO] })
      }),
      http.post('/api/v1/locations/from-search', async () => {
        await new Promise<void>((resolve) => {
          holdSave = { release: resolve }
        })
        return HttpResponse.json({ data: null }, { status: 503 })
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    window.sessionStorage.clear()
    Reflect.deleteProperty(window.navigator, 'geolocation')
  })

  it('LOC-RACE-WEB-01 typing while the position is pending: the late position sends nothing and changes nothing', async () => {
    // A lookup that does start answers at once, so a regression fails on the assertions below.
    holdFromCoordinates = { release: () => undefined }
    renderSection()
    await user.click(await useMyLocation())
    await waitFor(() => expect(pendingPosition).not.toBeNull())

    await typeSpringfield(user)
    await act(async () => {
      pendingPosition!.success({
        coords: { latitude: 41.878113, longitude: -87.629799 },
      } as GeolocationPosition)
      await Promise.resolve()
    })

    await settleClient()
    expect(tracked.positionReads).toBe(1)
    // Counted when the client would start the lookup, so a late one cannot slip past.
    expect(tracked.coordinateLookups).toBe(0)
    expect(fromCoordinatesPosts).toBe(0)
    await expectTypedSearchWins(user)
  })

  it('LOC-RACE-WEB-02 typing while the city lookup is in flight: the late Chicago is dropped', async () => {
    renderSection()
    await user.click(await useMyLocation())
    await waitFor(() => expect(pendingPosition).not.toBeNull())
    await act(async () => {
      pendingPosition!.success({
        coords: { latitude: 41.878113, longitude: -87.629799 },
      } as GeolocationPosition)
      await Promise.resolve()
    })
    await waitFor(() => expect(holdFromCoordinates).not.toBeNull())
    expect(tracked.coordinateLookups).toBe(1)

    await typeSpringfield(user)
    await act(async () => {
      holdFromCoordinates!.release()
      await Promise.resolve()
    })

    await expectTypedSearchWins(user)
  })

  it('LOC-RACE-WEB-03 typing while the position is pending: a late denial says nothing and keeps the focus', async () => {
    renderSection()
    await user.click(await useMyLocation())
    await waitFor(() => expect(pendingPosition).not.toBeNull())

    await typeSpringfield(user)
    await act(async () => {
      pendingPosition!.failure?.({ code: 1, message: 'no' } as GeolocationPositionError)
      await Promise.resolve()
    })
    await settleClient()
    expect(tracked.coordinateLookups).toBe(0)

    await expectTypedSearchWins(user)
  })

  it('LOC-RACE-WEB-04 a save in flight blocks Use my location', async () => {
    renderSection()
    await user.type(
      await screen.findByRole('combobox', { name: 'Search for a city' }),
      'Springfield'
    )
    await user.click(
      await screen.findByRole('option', { name: SPRINGFIELD.displayLabel })
    )
    await user.click(screen.getByRole('button', { name: 'Save location' }))
    await waitFor(() => expect(holdSave).not.toBeNull())

    const action = screen.getByRole('button', { name: 'Use my location' })
    expect(action).toBeDisabled()
    await user.click(action)
    expect(getCurrentPosition).not.toHaveBeenCalled()

    await act(async () => {
      holdSave!.release()
      await Promise.resolve()
    })
  })
})

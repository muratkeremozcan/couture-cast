// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), Codex product review 7 findings 1 and 6: the session bridge
// can already hold member B's token while React still shows member A's Locations section (the
// couture:session event has not reached it yet). Nothing A started or presses in that window may
// reach the API: a held device position, an armed search timer, a save, a rename, a primary change
// or a delete sends zero requests. A focus decided for A is not carried out on B's turn either.
import { http, HttpResponse } from 'msw'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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
import type * as WebSession from '../../../lib/web-session'
import { LOCATION_SEARCH_DEBOUNCE_MS } from './location-search-form'
import { LocationsSection } from './locations-section'

/** Every client call the section or form starts, kept until it settles. */
const tracked = vi.hoisted(() => ({ promises: [] as Promise<unknown>[] }))

function track<T>(promise: Promise<T>): Promise<T> {
  tracked.promises.push(promise)
  return promise
}

vi.mock('../../../lib/device-position', async (importOriginal) => {
  const actual = await importOriginal<typeof DevicePosition>()
  return {
    ...actual,
    readApproximatePosition: () => track(actual.readApproximatePosition()),
  }
})

vi.mock('../../../lib/locations', async (importOriginal) => {
  const actual = await importOriginal<typeof Locations>()
  const wrap =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    (...args: A) =>
      track(call(...args))
  return {
    ...actual,
    listLocationsFromWeb: wrap(actual.listLocationsFromWeb),
    searchLocationsFromWeb: wrap(actual.searchLocationsFromWeb),
    locationsFromCoordinatesFromWeb: wrap(actual.locationsFromCoordinatesFromWeb),
    saveLocationFromSearchFromWeb: wrap(actual.saveLocationFromSearchFromWeb),
    renameLocationFromWeb: wrap(actual.renameLocationFromWeb),
    setPrimaryLocationFromWeb: wrap(actual.setPrimaryLocationFromWeb),
    deleteLocationFromWeb: wrap(actual.deleteLocationFromWeb),
  }
})

/** Every tracked call has settled and React has applied what its handlers set. */
async function settleClient() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await Promise.allSettled(tracked.promises)
    })
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    })
  }
}

/** The session bridge's state, driven by hand. */
const session = vi.hoisted(() => ({
  identity: null as string | null,
  stored: false,
}))

vi.mock('../../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.identity,
  hasStoredWebSession: () => session.stored,
  resolveWebSessionToken: () =>
    Promise.resolve(
      session.identity
        ? (window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY) ?? undefined)
        : undefined
    ),
}))

const navigation = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(),
}))

function place(id: string, label: string, isPrimary: boolean): SavedLocation {
  return {
    id,
    label,
    locationKey: `${id}-key`,
    latitude: 41.878,
    longitude: -87.63,
    timezone: 'America/Chicago',
    city: 'Chicago',
    region: 'Illinois',
    country: 'US',
    isPrimary,
    sortOrder: isPrimary ? 0 : 1,
    createdAt: '2026-10-22T12:00:00.000Z',
    updatedAt: '2026-10-22T12:00:00.000Z',
  }
}

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

const A_HOME = place('a-1', 'Alpha Home', true)
const A_WORK = place('a-2', 'Alpha Work', false)
const B_OFFICE = place('b-1', 'Bravo Office', true)
const CHICAGO = candidate('Chicago', 'Illinois')
const SPRINGFIELD = candidate('Springfield', 'Missouri')

/** Every request the API saw, and whether it came after the bridge moved to B. */
let requests: {
  method: string
  path: string
  bearer: string | null
  afterMove: boolean
}[]
let bridgeMoved: boolean
let renamedTo: string | null
let pendingPosition: { success: PositionCallback } | null

/** Requests sent after the bridge moved, before the section heard: all of them are A's. */
const staleRequests = () => requests.filter((request) => request.afterMove)

/** The bridge now names B and holds B's token; no couture:session event has fired yet. */
function moveBridgeToB() {
  session.identity = 'member-b'
  session.stored = true
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-b')
  bridgeMoved = true
}

/** The event the bridge fires after it moved: B's section loads. */
async function publishB() {
  act(() => {
    window.dispatchEvent(new Event('couture:session'))
  })
  expect(await screen.findByText('Bravo Office')).toBeInTheDocument()
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
const statusRegion = () => screen.getByTestId('locations-status-region')

async function renderA() {
  renderSection()
  expect(await screen.findByText('Alpha Home')).toBeInTheDocument()
  expect(screen.getByText('Alpha Work')).toBeInTheDocument()
  await settleClient()
}

/** After B's section loaded: nothing of A's form or rows is left. */
async function expectCleanB() {
  await publishB()
  await settleClient()
  expect(screen.queryByText(/Alpha/)).toBeNull()
  expect(screen.queryByRole('option')).toBeNull()
  expect(searchInput()).toHaveValue('')
  expect(statusRegion()).not.toHaveTextContent(/Alpha|Chicago|Springfield/)
  expect(requests.filter((request) => request.bearer === 'Bearer token-b')).toEqual([
    {
      method: 'GET',
      path: '/api/v1/locations',
      bearer: 'Bearer token-b',
      afterMove: true,
    },
  ])
}

describe('nothing A started reaches the API once the bridge holds B', () => {
  let user: UserEvent

  beforeEach(async () => {
    user = userEvent.setup()
    requests = []
    bridgeMoved = false
    renamedTo = null
    pendingPosition = null
    tracked.promises = []
    navigation.push.mockClear()
    session.identity = 'member-a'
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-a')
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success: PositionCallback) => {
          pendingPosition = { success }
        }),
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    })
    const log = (request: Request) => {
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        bearer: request.headers.get('authorization'),
        afterMove: bridgeMoved,
      })
    }
    useMswHandlers(
      http.get('/api/v1/locations', ({ request }) => {
        log(request)
        if (request.headers.get('authorization') === 'Bearer token-b')
          return HttpResponse.json({ data: [B_OFFICE] })
        return HttpResponse.json({
          data: [renamedTo ? { ...A_HOME, label: renamedTo } : A_HOME, A_WORK],
        })
      }),
      http.get('/api/v1/locations/search', ({ request }) => {
        log(request)
        return HttpResponse.json({ data: [SPRINGFIELD] })
      }),
      http.post('/api/v1/locations/from-coordinates', ({ request }) => {
        log(request)
        return HttpResponse.json({ data: [CHICAGO] })
      }),
      http.post('/api/v1/locations/from-search', ({ request }) => {
        log(request)
        return HttpResponse.json({ data: place('a-3', 'Springfield', false) })
      }),
      http.patch('/api/v1/locations/:id', async ({ request }) => {
        log(request)
        const body = (await request.json()) as { label: string }
        renamedTo = body.label
        return HttpResponse.json({ data: { ...A_HOME, label: body.label } })
      }),
      http.post('/api/v1/locations/:id/primary', ({ request }) => {
        log(request)
        return HttpResponse.json({ data: { ...A_WORK, isPrimary: true } })
      }),
      http.delete('/api/v1/locations/:id', ({ request }) => {
        log(request)
        return HttpResponse.json({ data: { deleted: true } })
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
    Reflect.deleteProperty(window.navigator, 'geolocation')
  })

  it('LOC-BRIDGE-WEB-01 a device position that arrives after the bridge moved asks no city lookup', async () => {
    await renderA()
    await user.click(screen.getByRole('button', { name: 'Use my location' }))
    await waitFor(() => expect(pendingPosition).not.toBeNull())

    moveBridgeToB()
    await act(async () => {
      pendingPosition!.success({
        coords: { latitude: 41.878113, longitude: -87.629799 },
      } as GeolocationPosition)
      await Promise.resolve()
    })
    await settleClient()

    expect(staleRequests()).toEqual([])
    expect(screen.queryByRole('option', { name: CHICAGO.displayLabel })).toBeNull()
    await expectCleanB()
  })

  it('LOC-BRIDGE-WEB-02 a search timer A armed and that fires after the bridge moved searches nothing', async () => {
    await renderA()
    // Hold the form's debounce so the bridge can move between arming and firing.
    const held: { run: () => void; cleared: boolean }[] = []
    const realSetTimeout = globalThis.setTimeout
    const realClearTimeout = globalThis.clearTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => void,
      delay?: number,
      ...rest: unknown[]
    ) => {
      if (delay === LOCATION_SEARCH_DEBOUNCE_MS) {
        const entry = { run: handler, cleared: false }
        held.push(entry)
        return entry as unknown as ReturnType<typeof setTimeout>
      }
      return realSetTimeout(handler, delay, ...rest)
    }) as typeof setTimeout)
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((
      id?: ReturnType<typeof setTimeout>
    ) => {
      const entry = held.find((each) => (each as unknown) === id)
      if (entry) entry.cleared = true
      else realClearTimeout(id)
    }) as typeof clearTimeout)

    await user.type(searchInput(), 'Sp')
    const armed = held.filter((entry) => !entry.cleared)
    expect(armed).toHaveLength(1)

    moveBridgeToB()
    await act(async () => {
      armed[0]!.run()
      await Promise.resolve()
    })
    await settleClient()

    expect(staleRequests()).toEqual([])
    expect(screen.queryByRole('option', { name: SPRINGFIELD.displayLabel })).toBeNull()
    vi.restoreAllMocks()
    await expectCleanB()
  })

  it('LOC-BRIDGE-WEB-03 Save pressed after the bridge moved sends no save', async () => {
    await renderA()
    await user.type(searchInput(), 'Springfield')
    await user.click(
      await screen.findByRole('option', { name: SPRINGFIELD.displayLabel })
    )
    await settleClient()

    moveBridgeToB()
    await user.click(screen.getByRole('button', { name: 'Save location' }))
    await settleClient()

    expect(staleRequests()).toEqual([])
    expect(statusRegion()).not.toHaveTextContent('Springfield saved.')
    await expectCleanB()
  })

  it('LOC-BRIDGE-WEB-04 Save name pressed after the bridge moved sends no rename', async () => {
    await renderA()
    await user.click(screen.getByRole('button', { name: 'Rename, Alpha Home' }))
    const field = screen.getByRole('textbox', { name: 'New name' })
    await user.clear(field)
    await user.type(field, 'Alpha Studio')

    moveBridgeToB()
    await user.click(screen.getByRole('button', { name: /Save name/ }))
    await settleClient()

    expect(staleRequests()).toEqual([])
    await expectCleanB()
  })

  it('LOC-BRIDGE-WEB-05 Make primary pressed after the bridge moved changes nothing', async () => {
    await renderA()

    moveBridgeToB()
    await user.click(screen.getByRole('button', { name: 'Make primary, Alpha Work' }))
    await settleClient()

    expect(staleRequests()).toEqual([])
    await expectCleanB()
  })

  it('LOC-BRIDGE-WEB-06 a delete confirmed after the bridge moved deletes nothing', async () => {
    await renderA()
    await user.click(screen.getByRole('button', { name: 'Delete, Alpha Work' }))
    const item = screen.getByText('Alpha Work').closest('li')!

    moveBridgeToB()
    await user.click(within(item).getByRole('button', { name: /Yes, delete/ }))
    await settleClient()

    expect(staleRequests()).toEqual([])
    await expectCleanB()
  })

  describe('focus after a rename (finding 6)', () => {
    async function renameAlphaHome(moveOnAnnouncement: boolean) {
      await renderA()
      await user.click(screen.getByRole('button', { name: 'Rename, Alpha Home' }))
      const field = screen.getByRole('textbox', { name: 'New name' })
      await user.clear(field)
      await user.type(field, 'Alpha Studio')
      if (moveOnAnnouncement) {
        // The section decides focus and queues its announcement in one step after the reload; the
        // bridge moves right there, before React commits and the focus is carried out.
        const realFrame = window.requestAnimationFrame.bind(window)
        let moved = false
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
          if (!moved && renamedTo !== null) {
            moved = true
            moveBridgeToB()
          }
          return realFrame(callback)
        })
      }
      await user.click(screen.getByRole('button', { name: /Save name/ }))
      await settleClient()
    }

    it('LOC-BRIDGE-WEB-07 control: with no member change, focus lands on the renamed place', async () => {
      await renameAlphaHome(false)
      expect(screen.getByText('Alpha Studio')).toHaveFocus()
      expect(statusRegion()).toHaveTextContent('Renamed to Alpha Studio.')
    })

    it('LOC-BRIDGE-WEB-08 a focus decided for A is dropped when the bridge moved before it ran', async () => {
      await renameAlphaHome(true)
      expect(bridgeMoved).toBe(true)
      expect(screen.queryAllByTestId('location-item-label')).not.toContainEqual(
        document.activeElement
      )
      expect(statusRegion()).not.toHaveTextContent(/Alpha/)
      vi.restoreAllMocks()
      await expectCleanB()
    })
  })
})

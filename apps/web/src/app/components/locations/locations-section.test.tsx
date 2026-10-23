// Story 1.2b: the Web settings Locations section, through MSW so the request
// shapes, the platform header and the contract parsing are exercised with the UI.
// Interactions go through user-event, so typing reaches the debounce one key at a
// time and keyboard presses land on the focused element, as they do for a reader.
import axe from 'axe-core'
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
import { LocationsSection } from './locations-section'

const push = vi.fn()
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}))

const SEARCH_PATH = '/api/v1/locations/search'
const FROM_SEARCH_PATH = '/api/v1/locations/from-search'

function candidate(
  overrides: Partial<LocationSearchCandidate> = {}
): LocationSearchCandidate {
  return {
    city: 'Chicago',
    region: 'Illinois',
    country: 'US',
    latitude: 41.878,
    longitude: -87.63,
    displayLabel: 'Chicago, Illinois, United States',
    candidateToken: 'candidate-payload.candidate-signature',
    ...overrides,
  }
}

const CANDIDATE = candidate()

/** Three same-named cities, so the arrow keys have somewhere to move. */
const SPRINGFIELDS = [
  candidate({
    city: 'Springfield',
    region: 'Illinois',
    latitude: 39.799,
    longitude: -89.644,
    displayLabel: 'Springfield, Illinois, United States',
    candidateToken: 'springfield-il.signature',
  }),
  candidate({
    city: 'Springfield',
    region: 'Missouri',
    latitude: 37.209,
    longitude: -93.292,
    displayLabel: 'Springfield, Missouri, United States',
    candidateToken: 'springfield-mo.signature',
  }),
  candidate({
    city: 'Springfield',
    region: 'Massachusetts',
    latitude: 42.101,
    longitude: -72.59,
    displayLabel: 'Springfield, Massachusetts, United States',
    candidateToken: 'springfield-ma.signature',
  }),
]

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

function requestError(status: number, code: string) {
  return HttpResponse.json(
    { statusCode: status, code, message: 'no', error: 'Bad Request' },
    { status }
  )
}

function unavailable(code = 'provider_unavailable') {
  return HttpResponse.json(
    {
      statusCode: 503,
      code,
      retryable: true,
      message: 'down',
      error: 'Service Unavailable',
    },
    { status: 503 }
  )
}

/** A promise the test resolves by hand, so a pending request needs no timer. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
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

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

function status() {
  return screen.getByRole('status')
}

const observers: MutationObserver[] = []

/**
 * Every non-empty text the status region shows, in order: what a screen reader
 * speaks. The section clears the region before each message, so the same outcome
 * announced twice lands here twice, where the final text alone would hide it.
 */
function recordAnnouncements(): string[] {
  const region = status()
  const spoken: string[] = []
  const observer = new MutationObserver(() => {
    const text = region.textContent ?? ''
    if (text) spoken.push(text)
  })
  observer.observe(region, { childList: true, characterData: true, subtree: true })
  observers.push(observer)
  return spoken
}

/**
 * Two animation frames: an announcement queued before the first lands in it and
 * renders before the second, so "nothing was said" is checked after it could be.
 */
async function settleAnnouncements() {
  for (let frame = 0; frame < 2; frame += 1) {
    await act(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )
  }
}

function searchInput() {
  return screen.findByRole('combobox', { name: 'Search for a city' })
}

async function searchFor(user: UserEvent, text: string) {
  const input = await searchInput()
  await user.type(input, text)
  return input
}

/** By role, so an option the listbox hides cannot be found or picked. */
function findOption(name: string) {
  return screen.findByRole('option', { name })
}

describe('LocationsSection', () => {
  let saved: SavedLocation[]
  let user: UserEvent

  beforeEach(() => {
    saved = []
    searchParams = new URLSearchParams()
    push.mockClear()
    user = userEvent.setup()
    void getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    for (const observer of observers.splice(0)) observer.disconnect()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
  })

  function listHandler() {
    return http.get('/api/v1/locations', () => HttpResponse.json({ data: saved }))
  }

  function searchHandler(
    onRequest?: (request: Request) => void,
    data: LocationSearchCandidate[] = [CANDIDATE]
  ) {
    return http.get(SEARCH_PATH, ({ request }) => {
      onRequest?.(request)
      return HttpResponse.json({ data })
    })
  }

  function saveHandler() {
    return http.post(FROM_SEARCH_PATH, () => {
      saved = [location()]
      return HttpResponse.json({ data: saved[0] }, { status: 201 })
    })
  }

  it('1.2b-WEB-01 renders a calm signed-out shell with no request', () => {
    renderSection()

    expect(screen.getByRole('heading', { name: 'Locations' })).toBeInTheDocument()
    expect(screen.getByTestId('locations-signed-out')).toHaveTextContent(
      'Sign in to manage your locations.'
    )
    expect(screen.queryByTestId('location-search-input')).not.toBeInTheDocument()
  })

  it('1.2b-WEB-02 lists label, localized place and the primary marker', async () => {
    signIn()
    saved = [location(), office]
    useMswHandlers(listHandler())

    renderSection()

    const items = await screen.findAllByTestId('location-item')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByTestId('location-item-label').textContent).toBe('Home')
    expect(within(items[0]!).getByTestId('location-item-place').textContent).toBe(
      'Chicago, Illinois, United States'
    )
    expect(within(items[0]!).getByTestId('location-primary-badge')).toBeInTheDocument()
    expect(within(items[1]!).getByTestId('location-item-place').textContent).toBe(
      'Monaco'
    )
    expect(within(items[1]!).queryByTestId('location-primary-badge')).toBeNull()
    expect(screen.getByTestId('locations-count').textContent).toBe('2 of 3 saved')
  })

  it('1.2b-WEB-03 debounces search, sends the platform and locale, and announces the count once', async () => {
    signIn()
    const requests: Request[] = []
    useMswHandlers(
      listHandler(),
      searchHandler((request) => requests.push(request))
    )

    renderSection()
    const input = await searchInput()
    const spoken = recordAnnouncements()
    await user.type(input, 'Chicago')

    await findOption(CANDIDATE.displayLabel)
    expect(requests).toHaveLength(1)
    const url = new URL(requests[0]!.url)
    expect(url.searchParams.get('q')).toBe('Chicago')
    expect(url.searchParams.get('locale')).toBe('en-US')
    expect(requests[0]!.headers.get('x-couture-platform')).toBe('web')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(status().textContent).toBe('Results: 1'))
    await settleAnnouncements()
    expect(spoken).toEqual(['Results: 1'])
  })

  it('1.2b-WEB-04 picks the option the arrow key made active and saves its token by keyboard', async () => {
    signIn()
    let body: unknown
    useMswHandlers(
      listHandler(),
      searchHandler(undefined, SPRINGFIELDS),
      http.post(FROM_SEARCH_PATH, async ({ request }) => {
        body = await request.json()
        saved = [location()]
        return HttpResponse.json({ data: saved[0] }, { status: 201 })
      })
    )

    renderSection()
    const input = await searchFor(user, 'Springfield')
    await findOption(SPRINGFIELDS[0]!.displayLabel)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[1]!.id)
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ])

    await user.keyboard('{Enter}')
    expect(screen.getByTestId('location-selected')).toHaveTextContent(
      'Selected: Springfield, Missouri, United States'
    )
    const label = screen.getByRole('textbox', { name: 'Name this place' })
    expect(label).toHaveValue('Springfield')
    await waitFor(() => expect(label).toHaveFocus())
    await user.clear(label)
    await user.type(label, 'Home{Enter}')

    await screen.findByTestId('location-primary-badge')
    expect(body).toEqual({
      candidateToken: SPRINGFIELDS[1]!.candidateToken,
      label: 'Home',
    })
    await waitFor(() => expect(status().textContent).toBe('Home saved.'))
    expect(push).not.toHaveBeenCalled()
  })

  it('1.2b-WEB-05 keeps the chosen candidate on a 503 and saves on retry', async () => {
    signIn()
    let attempts = 0
    useMswHandlers(
      listHandler(),
      searchHandler(),
      http.post(FROM_SEARCH_PATH, () => {
        attempts += 1
        if (attempts === 1) return unavailable()
        saved = [location()]
        return HttpResponse.json({ data: saved[0] }, { status: 201 })
      })
    )

    renderSection()
    await searchFor(user, 'Chicago')
    await user.click(await findOption(CANDIDATE.displayLabel))
    await waitFor(() =>
      expect(status().textContent).toBe(`Selected: ${CANDIDATE.displayLabel}`)
    )
    const spoken = recordAnnouncements()
    await user.click(await screen.findByRole('button', { name: 'Save location' }))

    // The failure is the alert's to say; the status region stays quiet.
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This city could not be saved right now. Try again.'
    )
    await settleAnnouncements()
    expect(spoken).toEqual([])
    expect(screen.getByTestId('location-selected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await screen.findByTestId('location-primary-badge')
    expect(attempts).toBe(2)
  })

  it('1.2b-WEB-06 clears an expired candidate and explains the duplicate refusal', async () => {
    signIn()
    const codes = ['invalid_candidate', 'location_duplicate']
    let searches = 0
    useMswHandlers(
      listHandler(),
      searchHandler(() => {
        searches += 1
      }),
      http.post(FROM_SEARCH_PATH, () => requestError(400, codes.shift() ?? 'unknown'))
    )

    renderSection()
    await searchFor(user, 'Chicago')
    await user.click(await findOption(CANDIDATE.displayLabel))
    await user.click(await screen.findByRole('button', { name: 'Save location' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That search result expired. Search again.'
    )
    expect(screen.queryByTestId('location-selected')).toBeNull()

    // A fresh search, not the hidden options the first one left behind.
    await searchFor(user, 'o')
    await waitFor(() => expect(searches).toBe(2))
    await user.click(await findOption(CANDIDATE.displayLabel))
    await user.click(await screen.findByRole('button', { name: 'Save location' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'That location is already saved.'
      )
    )
  })

  it('1.2b-WEB-07 replaces the add form with the limit explanation at three locations', async () => {
    signIn()
    saved = [
      location(),
      office,
      location({ id: 'loc-3', label: 'Gym', isPrimary: false }),
    ]
    useMswHandlers(listHandler())

    renderSection()

    expect((await screen.findByTestId('locations-limit')).textContent).toBe(
      'You have saved three locations. Delete one to add another.'
    )
    expect(screen.queryByTestId('location-search-input')).toBeNull()
  })

  it('1.2b-WEB-08 switches primary in one press, moves focus and announces once', async () => {
    signIn()
    saved = [location(), office]
    useMswHandlers(
      listHandler(),
      http.post('/api/v1/locations/loc-2/primary', () => {
        saved = [location({ isPrimary: false }), { ...office, isPrimary: true }]
        return HttpResponse.json({ data: saved[1] })
      })
    )

    renderSection()
    const makePrimary = await screen.findByRole('button', {
      name: 'Make primary, Office',
    })
    const spoken = recordAnnouncements()
    await user.click(makePrimary)

    await waitFor(() =>
      expect(status().textContent).toBe('Office is now your primary location.')
    )
    const items = screen.getAllByTestId('location-item')
    expect(items[1]).toHaveAttribute('data-primary', 'true')
    expect(document.activeElement?.textContent).toBe('Office')
    await settleAnnouncements()
    expect(spoken).toEqual(['Office is now your primary location.'])
  })

  it('1.2b-WEB-09 renames and deletes after an inline confirmation, promoting the next primary', async () => {
    signIn()
    saved = [location(), office]
    const renames: unknown[] = []
    useMswHandlers(
      listHandler(),
      http.patch('/api/v1/locations/loc-2', async ({ request }) => {
        const body = (await request.json()) as { label: string }
        renames.push(body)
        saved = [location(), { ...office, label: body.label }]
        return HttpResponse.json({ data: saved[1] })
      }),
      http.delete('/api/v1/locations/loc-1', () => {
        saved = [{ ...saved[1]!, isPrimary: true }]
        return HttpResponse.json({ data: { deleted: true } })
      })
    )

    renderSection()
    await user.click(await screen.findByRole('button', { name: 'Rename, Office' }))
    const rename = screen.getByRole('textbox', { name: 'New name' })
    expect(rename).toHaveFocus()
    await user.clear(rename)
    await user.type(rename, 'Studio')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(status().textContent).toBe('Renamed to Studio.'))
    expect(renames).toEqual([{ label: 'Studio' }])
    expect(
      within(screen.getAllByTestId('location-item')[1]!).getByTestId(
        'location-item-label'
      )
    ).toHaveTextContent('Studio')

    await user.click(screen.getByRole('button', { name: 'Delete, Home' }))
    expect(screen.getByText('Delete Home?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(status().textContent).toBe('Home deleted.'))
    const items = screen.getAllByTestId('location-item')
    expect(items).toHaveLength(1)
    // The server promoted the remaining location; the list shows what it says.
    expect(within(items[0]!).getByTestId('location-item-label')).toHaveTextContent(
      'Studio'
    )
    expect(within(items[0]!).getByTestId('location-primary-badge')).toHaveTextContent(
      'Primary'
    )
    expect(items[0]).toHaveAttribute('data-primary', 'true')
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Locations' })
    )
  })

  it('1.2b-WEB-10 focuses search on the guided path and returns to the origin after saving', async () => {
    signIn()
    searchParams = new URLSearchParams('addLocation=1&returnTo=%2F')
    useMswHandlers(listHandler(), searchHandler(), saveHandler())

    renderSection()
    const input = await searchInput()
    await waitFor(() => expect(input).toHaveFocus())
    await user.keyboard('Chicago')
    await user.click(await findOption(CANDIDATE.displayLabel))
    await user.click(await screen.findByRole('button', { name: 'Save location' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
  })

  it('1.2b-WEB-11 sends a return target outside this origin home', async () => {
    signIn()
    searchParams = new URLSearchParams('addLocation=1&returnTo=%2F%2Fevil.example')
    useMswHandlers(listHandler(), searchHandler(), saveHandler())

    renderSection()
    await searchFor(user, 'Chicago')
    await user.click(await findOption(CANDIDATE.displayLabel))
    await user.click(await screen.findByRole('button', { name: 'Save location' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    expect(push).not.toHaveBeenCalledWith('//evil.example')
  })

  it('1.2b-WEB-12 passes axe with results open and with a saved list', async () => {
    signIn()
    saved = [location(), office]
    useMswHandlers(listHandler(), searchHandler())

    const view = renderSection()
    await screen.findAllByTestId('location-item')
    await searchFor(user, 'Chicago')
    await findOption(CANDIDATE.displayLabel)

    const results = await axe.run(view.container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    })
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })

  it('1.2b-WEB-13 says search is down on a search 503 and searches again on retry', async () => {
    signIn()
    let attempts = 0
    useMswHandlers(
      listHandler(),
      http.get(SEARCH_PATH, () => {
        attempts += 1
        return attempts === 1 ? unavailable() : HttpResponse.json({ data: [CANDIDATE] })
      })
    )

    renderSection()
    const input = await searchInput()
    const spoken = recordAnnouncements()
    await user.type(input, 'Chicago')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'City search is temporarily unavailable. Try again.'
    )
    // One announcement per failure: the alert, never also "no cities match".
    await settleAnnouncements()
    expect(spoken).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await findOption(CANDIDATE.displayLabel)
    expect(attempts).toBe(2)
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(status().textContent).toBe('Results: 1'))
    // The retry says only the new outcome, never the stale empty result first.
    await settleAnnouncements()
    expect(spoken).toEqual(['Results: 1'])
  })

  it('1.2b-WEB-14 wraps the active option with the arrow keys and closes on Escape', async () => {
    signIn()
    useMswHandlers(listHandler(), searchHandler(undefined, SPRINGFIELDS))

    renderSection()
    const input = await searchFor(user, 'Springfield')
    await findOption(SPRINGFIELDS[0]!.displayLabel)
    const options = screen.getAllByRole('option')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id)

    await user.keyboard('{ArrowUp}')
    expect(input).toHaveAttribute('aria-activedescendant', options[2]!.id)
    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[2]).toHaveAttribute('aria-selected', 'false')

    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('1.2b-WEB-15 explains a failed list load', async () => {
    signIn()
    useMswHandlers(
      http.get('/api/v1/locations', () =>
        HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 })
      )
    )

    renderSection()

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Unable to load your locations.'
    )
    expect(screen.queryByTestId('location-search-input')).toBeNull()
  })

  it('1.2b-WEB-16 reports a failed primary switch and keeps the list as it was', async () => {
    signIn()
    saved = [location(), office]
    useMswHandlers(
      listHandler(),
      http.post('/api/v1/locations/loc-2/primary', () =>
        HttpResponse.json({ statusCode: 404, message: 'gone' }, { status: 404 })
      )
    )

    renderSection()
    await user.click(await screen.findByRole('button', { name: 'Make primary, Office' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Something went wrong. Try again.'
    )
    expect(screen.getAllByTestId('location-item')[0]).toHaveAttribute(
      'data-primary',
      'true'
    )
  })

  it('1.2b-WEB-17 cancels a rename with Escape or Cancel and a delete with Cancel', async () => {
    signIn()
    saved = [location(), office]
    useMswHandlers(listHandler())

    renderSection()
    await user.click(await screen.findByRole('button', { name: 'Rename, Office' }))
    expect(screen.getByRole('textbox', { name: 'New name' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'New name' })).toBeNull()
    // Focus returns to the item, as after every list action.
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Office'))

    await user.click(screen.getByRole('button', { name: 'Rename, Office' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'New name' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Delete, Home' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Yes, delete' })).toBeNull()
    expect(screen.getAllByTestId('location-item')).toHaveLength(2)
  })

  it('1.2b-WEB-18 searches after 300 ms of quiet typing and restarts the wait on each key', async () => {
    vi.useFakeTimers()
    // Testing Library drains each user-event call with a zero-delay timeout and
    // only advances it when it sees Jest's fake timers. This names Vitest's clock
    // for it; without it every `user` call waits on a timer nothing fires.
    vi.stubGlobal('jest', { advanceTimersByTime: vi.advanceTimersByTime.bind(vi) })
    user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })
    signIn()
    const requests: URL[] = []
    useMswHandlers(
      listHandler(),
      searchHandler((request) => requests.push(new URL(request.url)))
    )

    renderSection()
    await act(() => vi.advanceTimersByTimeAsync(0))
    const input = screen.getByRole('combobox', { name: 'Search for a city' })

    await user.type(input, 'Chic')
    await act(() => vi.advanceTimersByTimeAsync(200))
    await user.type(input, 'ago')
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(requests).toHaveLength(0)

    await act(() => vi.advanceTimersByTimeAsync(1))
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]!.searchParams.get('q')).toBe('Chicago')
    expect(requests[0]!.searchParams.get('locale')).toBe('en-US')
  })

  it('1.2b-WEB-19 shows the save as busy and sends one request for a double press', async () => {
    signIn()
    const gate = deferred()
    let posts = 0
    useMswHandlers(
      listHandler(),
      searchHandler(),
      http.post(FROM_SEARCH_PATH, async () => {
        posts += 1
        await gate.promise
        saved = [location()]
        return HttpResponse.json({ data: saved[0] }, { status: 201 })
      })
    )

    renderSection()
    await searchFor(user, 'Chicago')
    await user.click(await findOption(CANDIDATE.displayLabel))
    const save = await screen.findByRole('button', { name: 'Save location' })
    await user.click(save)

    await waitFor(() => expect(posts).toBe(1))
    expect(save).toHaveAttribute('aria-busy', 'true')
    expect(save).toHaveTextContent('Saving...')
    // Busy, never disabled, so focus stays on the control.
    expect(save).toBeEnabled()
    await user.click(save)
    gate.resolve()

    await screen.findByTestId('location-primary-badge')
    await waitFor(() => expect(status().textContent).toBe('Home saved.'))
    expect(posts).toBe(1)
  })

  it.each([
    [
      429,
      () => HttpResponse.json({ message: 'Too Many Requests' }, { status: 429 }),
      'Too many searches. Wait a moment and try again.',
    ],
    [
      400,
      () => requestError(400, 'invalid_request'),
      'Type between 2 and 80 characters.',
    ],
  ])(
    '1.2b-WEB-20 explains a search refused with HTTP %i and offers no retry',
    async (_status, respond, copy) => {
      signIn()
      useMswHandlers(listHandler(), http.get(SEARCH_PATH, respond))

      renderSection()
      const input = await searchInput()
      const spoken = recordAnnouncements()
      await user.type(input, 'Chicago')

      expect((await screen.findByRole('alert')).textContent).toBe(copy)
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
      expect(input).toHaveAttribute('aria-expanded', 'false')
      await settleAnnouncements()
      expect(spoken).toEqual([])
    }
  )

  it('1.2b-WEB-21 explains a save the server refused at the three-location limit', async () => {
    signIn()
    useMswHandlers(
      listHandler(),
      searchHandler(),
      http.post(FROM_SEARCH_PATH, () => requestError(400, 'location_limit_reached'))
    )

    renderSection()
    await searchFor(user, 'Chicago')
    await user.click(await findOption(CANDIDATE.displayLabel))
    await user.click(await screen.findByRole('button', { name: 'Save location' }))

    // Another device filled the last slot after this list loaded.
    expect((await screen.findByRole('alert')).textContent).toBe(
      'You have saved three locations. Delete one to add another.'
    )
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})

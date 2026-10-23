// Story 1.2b: the Web settings Locations section, through MSW so the request
// shapes, the platform header and the contract parsing are exercised with the UI.
import axe from 'axe-core'
import { http, HttpResponse } from 'msw'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedLocation } from '@couture/api-client/contracts/http'
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
  return screen.getByTestId('locations-status-region')
}

async function searchFor(text: string) {
  const input = await screen.findByTestId('location-search-input')
  fireEvent.change(input, { target: { value: text } })
  return input
}

describe('LocationsSection', () => {
  let saved: SavedLocation[]

  beforeEach(() => {
    saved = []
    searchParams = new URLSearchParams()
    push.mockClear()
    void getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  function listHandler() {
    return http.get('/api/v1/locations', () => HttpResponse.json({ data: saved }))
  }

  function searchHandler(onRequest?: (request: Request) => void) {
    return http.get('/api/v1/locations/search', ({ request }) => {
      onRequest?.(request)
      return HttpResponse.json({ data: [CANDIDATE] })
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
    const input = await searchFor('C')
    fireEvent.change(input, { target: { value: 'Ch' } })
    fireEvent.change(input, { target: { value: 'Chicago' } })

    await screen.findByTestId('location-search-option')
    expect(requests).toHaveLength(1)
    const url = new URL(requests[0]!.url)
    expect(url.searchParams.get('q')).toBe('Chicago')
    expect(url.searchParams.get('locale')).toBe('en-US')
    expect(requests[0]!.headers.get('x-couture-platform')).toBe('web')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(status().textContent).toBe('Results: 1'))
  })

  it('1.2b-WEB-04 picks a candidate by keyboard and saves it as the first, primary location', async () => {
    signIn()
    let body: unknown
    useMswHandlers(
      listHandler(),
      searchHandler(),
      http.post('/api/v1/locations/from-search', async ({ request }) => {
        body = await request.json()
        saved = [location()]
        return HttpResponse.json({ data: saved[0] }, { status: 201 })
      })
    )

    renderSection()
    const input = await searchFor('Chicago')
    await screen.findByTestId('location-search-option')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    const label = await screen.findByTestId('location-label-input')
    expect(label).toHaveValue('Chicago')
    fireEvent.change(label, { target: { value: 'Home' } })
    fireEvent.click(screen.getByTestId('location-save-button'))

    await screen.findByTestId('location-primary-badge')
    expect(body).toEqual({ candidateToken: CANDIDATE.candidateToken, label: 'Home' })
    await waitFor(() => expect(status().textContent).toBe('Home saved.'))
    expect(push).not.toHaveBeenCalled()
  })

  it('1.2b-WEB-05 keeps the chosen candidate on a 503 and saves on retry', async () => {
    signIn()
    let attempts = 0
    useMswHandlers(
      listHandler(),
      searchHandler(),
      http.post('/api/v1/locations/from-search', () => {
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

    renderSection()
    await searchFor('Chicago')
    fireEvent.click(await screen.findByTestId('location-search-option'))
    fireEvent.click(await screen.findByTestId('location-save-button'))

    expect((await screen.findByTestId('location-error')).textContent).toBe(
      'City search is temporarily unavailable. Try again.'
    )
    expect(screen.getByTestId('location-selected')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('location-retry-button'))

    await screen.findByTestId('location-primary-badge')
    expect(attempts).toBe(2)
  })

  it('1.2b-WEB-06 clears an expired candidate and explains the duplicate refusal', async () => {
    signIn()
    const codes = ['invalid_candidate', 'location_duplicate']
    useMswHandlers(
      listHandler(),
      searchHandler(),
      http.post('/api/v1/locations/from-search', () =>
        HttpResponse.json(
          { statusCode: 400, code: codes.shift(), message: 'no', error: 'Bad Request' },
          { status: 400 }
        )
      )
    )

    renderSection()
    await searchFor('Chicago')
    fireEvent.click(await screen.findByTestId('location-search-option'))
    fireEvent.click(await screen.findByTestId('location-save-button'))
    expect((await screen.findByTestId('location-error')).textContent).toBe(
      'That search result expired. Search again.'
    )
    expect(screen.queryByTestId('location-selected')).toBeNull()

    await searchFor('Chicagoo')
    fireEvent.click(await screen.findByTestId('location-search-option'))
    fireEvent.click(await screen.findByTestId('location-save-button'))
    await waitFor(() =>
      expect(screen.getByTestId('location-error').textContent).toBe(
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
    fireEvent.click(await screen.findByRole('button', { name: 'Make primary, Office' }))

    await waitFor(() =>
      expect(status().textContent).toBe('Office is now your primary location.')
    )
    const items = screen.getAllByTestId('location-item')
    expect(items[1]).toHaveAttribute('data-primary', 'true')
    expect(document.activeElement?.textContent).toBe('Office')
  })

  it('1.2b-WEB-09 renames and deletes after an inline confirmation', async () => {
    signIn()
    saved = [location(), office]
    useMswHandlers(
      listHandler(),
      http.patch('/api/v1/locations/loc-2', async ({ request }) => {
        const { label } = (await request.json()) as { label: string }
        saved = [location(), { ...office, label }]
        return HttpResponse.json({ data: saved[1] })
      }),
      http.delete('/api/v1/locations/loc-1', () => {
        saved = [{ ...saved[1]!, isPrimary: true }]
        return HttpResponse.json({ data: { deleted: true } })
      })
    )

    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Rename, Office' }))
    const rename = screen.getByTestId('location-rename-input')
    expect(document.activeElement).toBe(rename)
    fireEvent.change(rename, { target: { value: 'Studio' } })
    fireEvent.click(screen.getByTestId('location-rename-save'))
    await waitFor(() => expect(status().textContent).toBe('Renamed to Studio.'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete, Home' }))
    expect(screen.getByText('Delete Home?')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('location-delete-confirm'))
    await waitFor(() => expect(status().textContent).toBe('Home deleted.'))
    expect(screen.getAllByTestId('location-item')).toHaveLength(1)
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Locations' })
    )
  })

  it('1.2b-WEB-10 focuses search on the guided path and returns to the origin after saving', async () => {
    signIn()
    searchParams = new URLSearchParams('addLocation=1&returnTo=%2F')
    useMswHandlers(
      listHandler(),
      searchHandler(),
      http.post('/api/v1/locations/from-search', () => {
        saved = [location()]
        return HttpResponse.json({ data: saved[0] }, { status: 201 })
      })
    )

    renderSection()
    const input = await screen.findByTestId('location-search-input')
    await waitFor(() => expect(document.activeElement).toBe(input))
    await searchFor('Chicago')
    fireEvent.click(await screen.findByTestId('location-search-option'))
    fireEvent.click(await screen.findByTestId('location-save-button'))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
  })

  it('1.2b-WEB-11 sends a return target outside this origin home', async () => {
    signIn()
    searchParams = new URLSearchParams('addLocation=1&returnTo=%2F%2Fevil.example')
    useMswHandlers(
      listHandler(),
      searchHandler(),
      http.post('/api/v1/locations/from-search', () => {
        saved = [location()]
        return HttpResponse.json({ data: saved[0] }, { status: 201 })
      })
    )

    renderSection()
    await searchFor('Chicago')
    fireEvent.click(await screen.findByTestId('location-search-option'))
    fireEvent.click(await screen.findByTestId('location-save-button'))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    expect(push).not.toHaveBeenCalledWith('//evil.example')
  })

  it('1.2b-WEB-12 passes axe with results open and with a saved list', async () => {
    signIn()
    saved = [location(), office]
    useMswHandlers(listHandler(), searchHandler())

    const view = renderSection()
    await screen.findAllByTestId('location-item')
    await searchFor('Chicago')
    await screen.findByTestId('location-search-option')

    const results = await axe.run(view.container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    })
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })
})

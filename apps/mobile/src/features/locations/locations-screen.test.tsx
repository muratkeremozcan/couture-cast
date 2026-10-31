// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
// Story 1.2b: the mobile Locations screen through MSW, so the request shapes,
// the platform header and the contract parsing run with the UI. Input goes
// through the browser runner's real user events.
import React from 'react'
import { userEvent } from 'vitest/browser'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type {
  LocationRequestErrorCode,
  SavedLocation,
} from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const routerMock = vi.hoisted(() => ({
  back: vi.fn(),
  canGoBack: vi.fn(() => true),
  push: vi.fn(),
}))
vi.mock('expo-router', () => ({ router: routerMock }))
// Passthrough spies: requests still reach MSW, and the debounce and double-submit
// tests can see a call the moment the screen makes it.
vi.mock('@/src/lib/locations', { spy: true })

import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import {
  onLocationsChanged,
  saveLocationFromSearchFromMobile,
  searchLocationsFromMobile,
} from '@/src/lib/locations'
import {
  locationCandidate,
  locationRequestErrorResponse,
  locationUnavailableResponse,
  officeLocation,
  savedLocation,
} from '@/src/test-utils/locations'
import { LocationsScreen } from './locations-screen'

const CANDIDATE = locationCandidate()

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

interface Announcement {
  text: string
  live: string | null
}

/**
 * Every announcement the shared announcer renders, in order. Each one mounts a
 * fresh live-region node, so the list shows a repeat that the final text hides.
 */
function recordAnnouncements(): { announcements: Announcement[]; stop: () => void } {
  const announcements: Announcement[] = []
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof HTMLElement && node.id === 'a11y-live-announcer') {
          announcements.push({
            text: node.textContent ?? '',
            live: node.getAttribute('aria-live'),
          })
        }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return { announcements, stop: () => observer.disconnect() }
}

/** Visible elements that read `text` with the alert role, which speaks it a second time. */
function alertsReading(text: string) {
  return Array.from(document.querySelectorAll('[role="alert"]')).filter((node) =>
    node.textContent?.includes(text)
  )
}

describe('LocationsScreen', () => {
  let saved: SavedLocation[]
  let restoreAccessTokenResolver: () => void
  const cleanups: (() => void)[] = []
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    saved = []
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    routerMock.canGoBack.mockReturnValue(true)
    server.use(http.get('*/api/v1/locations', () => HttpResponse.json({ data: saved })))
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const cleanup of cleanups.splice(0)) cleanup()
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

  function saveHandler(onRequest?: (request: Request) => void | Promise<void>) {
    return http.post('*/api/v1/locations/from-search', async ({ request }) => {
      await onRequest?.(request)
      saved = [savedLocation()]
      return HttpResponse.json({ data: saved[0] }, { status: 201 })
    })
  }

  async function searchAndChoose() {
    await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Chicago')
    await userEvent.click(await screen.findByTestId('location-search-option-0'))
    return screen.findByTestId('location-save-button')
  }

  it('1.2b-MOB-01 lists label, place and the primary marker', async () => {
    saved = [savedLocation(), officeLocation()]

    renderScreen()

    expect((await screen.findByTestId('location-label-0')).textContent).toBe('Home')
    expect(screen.getByTestId('location-primary-badge-0')).toBeTruthy()
    expect(screen.queryByTestId('location-primary-badge-1')).toBeNull()
    expect(screen.getByTestId('location-item-1')).toHaveTextContent('Monaco')
    expect(screen.getByTestId('locations-count').textContent).toBe('2 of 3 saved')
  })

  it('1.2b-MOB-02 searches after 300 ms of quiet typing with the locale and mobile platform, and announces the count once', async () => {
    const requests: Request[] = []
    server.use(searchHandler((request) => requests.push(request)))
    const { announcements, stop } = recordAnnouncements()
    cleanups.push(stop)

    renderScreen()
    const input = await screen.findByTestId('locations-search-input')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await userEvent.fill(input, 'Ch')
    await vi.advanceTimersByTimeAsync(200)
    // Typing again restarts the quiet window.
    await userEvent.fill(input, 'Chicago')
    await vi.advanceTimersByTimeAsync(299)
    expect(vi.mocked(searchLocationsFromMobile)).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(vi.mocked(searchLocationsFromMobile)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(searchLocationsFromMobile)).toHaveBeenCalledWith(
      'Chicago',
      'en-US',
      expect.anything()
    )
    vi.useRealTimers()

    await screen.findByTestId('location-search-option-0')
    expect(requests).toHaveLength(1)
    const url = new URL(requests[0]!.url)
    expect(url.searchParams.get('q')).toBe('Chicago')
    expect(url.searchParams.get('locale')).toBe('en-US')
    expect(requests[0]!.headers.get('x-couture-platform')).toBe('mobile')
    await waitFor(() =>
      expect(announcements).toEqual([{ text: 'Results: 1', live: 'polite' }])
    )
  })

  it('1.2b-MOB-03 saves a chosen city, reloads the list and notifies listeners', async () => {
    const changed = vi.fn()
    cleanups.push(onLocationsChanged(changed))
    let body: unknown
    server.use(
      searchHandler(),
      saveHandler(async (request) => {
        body = await request.json()
      })
    )

    renderScreen()
    await searchAndChoose()
    await userEvent.fill(await screen.findByTestId('location-label-input'), 'Home')
    await userEvent.click(screen.getByTestId('location-save-button'))

    await screen.findByTestId('location-primary-badge-0')
    expect(body).toEqual({ candidateToken: CANDIDATE.candidateToken, label: 'Home' })
    expect(changed).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(liveRegion()).toBe('Home saved.'))
    expect(routerMock.back).not.toHaveBeenCalled()
  })

  it('1.2b-MOB-03b shows the busy state while a save runs and sends one save for a second press', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let posts = 0
    server.use(
      searchHandler(),
      saveHandler(async () => {
        posts += 1
        await held
      })
    )

    renderScreen()
    const saveButton = await searchAndChoose()
    expect(saveButton.getAttribute('aria-busy')).toBe('false')
    try {
      await userEvent.click(saveButton)
      // `aria-busy` is what react-native-web 0.21 renders; it dropped the
      // `accessibilityState.busy` mapping.
      await waitFor(() => expect(saveButton.getAttribute('aria-busy')).toBe('true'))
      expect(saveButton.textContent).toBe('Saving...')
      expect(within(saveButton).getByRole('progressbar')).toBeTruthy()

      await userEvent.click(saveButton)
      expect(vi.mocked(saveLocationFromSearchFromMobile)).toHaveBeenCalledTimes(1)
    } finally {
      release()
    }

    await screen.findByTestId('location-primary-badge-0')
    expect(posts).toBe(1)
  })

  it('1.2b-MOB-04 returns to the originating screen after a guided save', async () => {
    server.use(searchHandler(), saveHandler())

    renderScreen(true)
    await userEvent.click(await searchAndChoose())

    await waitFor(() => expect(routerMock.back).toHaveBeenCalledTimes(1))
  })

  it('1.2b-MOB-04b reloads in place after a guided save with no screen to return to', async () => {
    routerMock.canGoBack.mockReturnValue(false)
    server.use(searchHandler(), saveHandler())

    renderScreen(true)
    await userEvent.click(await searchAndChoose())

    await screen.findByTestId('location-primary-badge-0')
    expect(screen.getByTestId('location-label-0').textContent).toBe('Home')
    expect(routerMock.back).not.toHaveBeenCalled()
  })

  it('1.2b-MOB-05 keeps the chosen city on a 503 and saves on retry', async () => {
    let attempts = 0
    server.use(
      searchHandler(),
      http.post('*/api/v1/locations/from-search', () => {
        attempts += 1
        if (attempts === 1) return locationUnavailableResponse()
        saved = [savedLocation()]
        return HttpResponse.json({ data: saved[0] }, { status: 201 })
      })
    )

    renderScreen()
    await userEvent.click(await searchAndChoose())

    const message = 'This city could not be saved right now. Try again.'
    expect((await screen.findByTestId('location-error')).textContent).toBe(message)
    // Announced exactly once: by the announcer's live region, and by no alert
    // role on the visible error.
    await waitFor(() => expect(liveRegion()).toBe(message))
    expect(alertsReading(message)).toHaveLength(0)
    expect(screen.getByTestId('location-selected')).toBeTruthy()
    await userEvent.click(screen.getByTestId('location-retry-button'))

    await screen.findByTestId('location-primary-badge-0')
    expect(attempts).toBe(2)
  })

  it('1.2b-MOB-05b says search is down, once and assertively, on a 503 and searches again on retry', async () => {
    let attempts = 0
    server.use(
      http.get('*/api/v1/locations/search', () => {
        attempts += 1
        return attempts === 1
          ? locationUnavailableResponse()
          : HttpResponse.json({ data: [CANDIDATE] })
      })
    )
    const { announcements, stop } = recordAnnouncements()
    cleanups.push(stop)

    renderScreen()
    await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Chicago')

    const message = 'City search is temporarily unavailable. Try again.'
    expect((await screen.findByTestId('location-error')).textContent).toBe(message)
    expect(alertsReading(message)).toHaveLength(0)
    await waitFor(() =>
      expect(announcements).toEqual([{ text: message, live: 'assertive' }])
    )

    await userEvent.click(screen.getByTestId('location-retry-button'))

    await screen.findByTestId('location-search-option-0')
    expect(screen.queryByTestId('location-error')).toBeNull()
    expect(attempts).toBe(2)
    await waitFor(() =>
      expect(announcements).toEqual([
        { text: message, live: 'assertive' },
        { text: 'Results: 1', live: 'polite' },
      ])
    )
  })

  it('1.2b-MOB-05c explains a search rate limit with no retry', async () => {
    server.use(
      http.get('*/api/v1/locations/search', () =>
        HttpResponse.json(
          { statusCode: 429, message: 'ThrottlerException: Too Many Requests' },
          { status: 429, headers: { 'Retry-After': '30' } }
        )
      )
    )

    renderScreen()
    await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Chicago')

    const message = 'Too many searches. Wait a moment and try again.'
    expect((await screen.findByTestId('location-error')).textContent).toBe(message)
    await waitFor(() => expect(liveRegion()).toBe(message))
    expect(screen.queryByTestId('location-retry-button')).toBeNull()
  })

  it.each<[LocationRequestErrorCode, string, boolean]>([
    ['invalid_candidate', 'That search result expired. Search again.', false],
    ['location_duplicate', 'That location is already saved.', true],
    [
      'location_limit_reached',
      'You have saved three locations. Delete one to add another.',
      true,
    ],
  ])(
    '1.2b-MOB-05d explains a save refused with %s',
    async (code, message, keepsSelection) => {
      server.use(
        searchHandler(),
        http.post('*/api/v1/locations/from-search', () =>
          locationRequestErrorResponse(code)
        )
      )

      const { announcements, stop } = recordAnnouncements()
      cleanups.push(stop)
      renderScreen()
      const saveButton = await searchAndChoose()
      // The choice announces itself; once it has, everything after belongs to the save.
      await waitFor(() =>
        expect(announcements.at(-1)?.text).toBe(
          'Selected: Chicago, Illinois, United States'
        )
      )
      announcements.splice(0)
      await userEvent.click(saveButton)

      await waitFor(() =>
        expect(announcements.map(({ text }) => text)).toContain(message)
      )
      // An expired candidate cannot be saved again; the member has to search, and
      // the query searches again on its own. Its results keep the save error.
      expect(screen.queryByTestId('location-selected') !== null).toBe(keepsSelection)
      if (keepsSelection) {
        expect(announcements.map(({ text }) => text)).toEqual([message])
      } else {
        await waitFor(() =>
          expect(announcements.map(({ text }) => text)).toEqual([message, 'Results: 1'])
        )
        expect(screen.getByTestId('location-search-option-0')).toBeTruthy()
      }
      expect(screen.getByTestId('location-error').textContent).toBe(message)
      expect(screen.queryByTestId('location-retry-button')).toBeNull()
    }
  )

  it('1.2b-MOB-06 explains the three-location limit instead of the add form', async () => {
    saved = [
      savedLocation(),
      officeLocation(),
      savedLocation({ id: 'loc-3', label: 'Gym', isPrimary: false }),
    ]

    renderScreen()

    expect((await screen.findByTestId('locations-limit')).textContent).toBe(
      'You have saved three locations. Delete one to add another.'
    )
    expect(screen.queryByTestId('locations-search-input')).toBeNull()
  })

  it('1.2b-MOB-07 switches primary in one tap and announces it once', async () => {
    saved = [savedLocation(), officeLocation()]
    server.use(
      http.post('*/api/v1/locations/loc-2/primary', () => {
        saved = [savedLocation({ isPrimary: false }), officeLocation({ isPrimary: true })]
        return HttpResponse.json({ data: saved[1] })
      })
    )

    renderScreen()
    await userEvent.click(await screen.findByTestId('location-make-primary-1'))

    await screen.findByTestId('location-primary-badge-1')
    await waitFor(() => expect(liveRegion()).toBe('Office is now your primary location.'))
  })

  it.each<[string, string, () => Promise<void>, string, string]>([
    [
      'make primary',
      'post',
      // One tap: the action is already on screen.
      () => Promise.resolve(),
      'location-make-primary-1',
      'Office is now your primary location.',
    ],
    [
      'rename',
      'patch',
      async () => {
        await userEvent.click(screen.getByTestId('location-rename-1'))
        await userEvent.fill(screen.getByTestId('location-rename-input-1'), 'Studio')
      },
      'location-rename-save-1',
      'Renamed to Studio.',
    ],
    [
      'delete',
      'delete',
      () => userEvent.click(screen.getByTestId('location-delete-1')),
      'location-delete-confirm',
      'Office deleted.',
    ],
  ])(
    '1.2b-MOB-07b marks the %s action busy while its request runs',
    async (_action, method, open, testId, outcome) => {
      saved = [savedLocation(), officeLocation()]
      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      const route =
        method === 'post'
          ? '*/api/v1/locations/loc-2/primary'
          : '*/api/v1/locations/loc-2'
      server.use(
        http[method as 'post' | 'patch' | 'delete'](route, async () => {
          await held
          return HttpResponse.json({
            data:
              method === 'delete'
                ? { deleted: true }
                : officeLocation({ label: 'Studio' }),
          })
        })
      )

      renderScreen()
      await screen.findByTestId('location-make-primary-1')
      await open()
      const button = screen.getByTestId(testId)
      expect(button.getAttribute('aria-busy')).toBe('false')
      try {
        await userEvent.click(button)
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'))
      } finally {
        release()
      }

      await waitFor(() => expect(liveRegion()).toBe(outcome))
      const stillBusy = Array.from(
        screen.getByTestId('locations-screen').querySelectorAll('[aria-busy="true"]')
      )
      expect(stillBusy).toHaveLength(0)
    }
  )

  it('1.2b-MOB-08 renames a location in place', async () => {
    saved = [savedLocation(), officeLocation()]
    let body: unknown
    server.use(
      http.patch('*/api/v1/locations/loc-2', async ({ request }) => {
        body = await request.json()
        const { label } = body as { label: string }
        saved = [savedLocation(), officeLocation({ label })]
        return HttpResponse.json({ data: saved[1] })
      })
    )

    renderScreen()
    await userEvent.click(await screen.findByTestId('location-rename-1'))
    await userEvent.fill(screen.getByTestId('location-rename-input-1'), 'Studio')
    await userEvent.click(screen.getByTestId('location-rename-save-1'))

    await waitFor(() =>
      expect(screen.getByTestId('location-label-1').textContent).toBe('Studio')
    )
    expect(body).toEqual({ label: 'Studio' })
    await waitFor(() => expect(liveRegion()).toBe('Renamed to Studio.'))
  })

  it('1.2b-MOB-08b deletes the primary after an inline confirmation and shows the promoted primary', async () => {
    saved = [savedLocation(), officeLocation()]
    server.use(
      http.delete('*/api/v1/locations/loc-1', () => {
        saved = [officeLocation({ isPrimary: true, sortOrder: 0 })]
        return HttpResponse.json({ data: { deleted: true } })
      })
    )

    renderScreen()
    await userEvent.click(await screen.findByTestId('location-delete-0'))
    expect(screen.getByTestId('location-item-0')).toHaveTextContent('Delete Home?')
    await userEvent.click(screen.getByTestId('location-delete-confirm'))

    await waitFor(() => expect(screen.queryByTestId('location-item-1')).toBeNull())
    expect(screen.getByTestId('location-label-0').textContent).toBe('Office')
    expect(screen.getByTestId('location-primary-badge-0').textContent).toBe('Primary')
    await waitFor(() => expect(liveRegion()).toBe('Home deleted.'))
  })

  it('1.2b-MOB-09 keeps every action target at least 44 by 44 points', async () => {
    saved = [savedLocation(), officeLocation()]
    server.use(
      searchHandler(),
      http.post('*/api/v1/locations/from-search', () => locationUnavailableResponse())
    )

    function expectEveryButtonAtLeast44(state: string) {
      const buttons = Array.from(
        screen
          .getByTestId('locations-screen')
          .querySelectorAll<HTMLElement>('[role="button"]')
      )
      expect(buttons.length, state).toBeGreaterThan(0)
      for (const button of buttons) {
        const { height, width } = button.getBoundingClientRect()
        const name = `${state}: ${button.textContent ?? ''}`
        expect(height, name).toBeGreaterThanOrEqual(44)
        expect(width, name).toBeGreaterThanOrEqual(44)
      }
    }

    renderScreen()
    await screen.findByTestId('location-make-primary-1')
    const input = screen.getByTestId('locations-search-input')
    expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)

    // List actions and search options.
    await userEvent.fill(input, 'Chicago')
    await screen.findByTestId('location-search-option-0')
    expectEveryButtonAtLeast44('list and options')

    // Rename: save name and cancel.
    await userEvent.click(screen.getByTestId('location-rename-0'))
    expectEveryButtonAtLeast44('rename')

    // Delete confirmation: confirm and cancel.
    await userEvent.click(screen.getByTestId('location-delete-1'))
    expectEveryButtonAtLeast44('delete confirmation')

    // Save, and the retry a failed save offers.
    await userEvent.click(screen.getByTestId('location-search-option-0'))
    await userEvent.click(await screen.findByTestId('location-save-button'))
    await screen.findByTestId('location-retry-button')
    expectEveryButtonAtLeast44('save and retry')
  })

  it('1.2b-MOB-10 asks a signed-out member to sign in', async () => {
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)

    renderScreen()

    expect((await screen.findByTestId('locations-signed-out')).textContent).toBe(
      'Sign in to manage your locations.'
    )
    expect(screen.queryByTestId('location-add-form')).toBeNull()
  })

  it('1.2b-MOB-11 says the list could not load when it fails', async () => {
    server.use(
      http.get('*/api/v1/locations', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'Internal server error', error: 'Error' },
          { status: 500 }
        )
      )
    )

    renderScreen()

    expect((await screen.findByTestId('locations-load-error')).textContent).toBe(
      'Unable to load your locations.'
    )
    expect(screen.queryByTestId('locations-signed-out')).toBeNull()
    expect(screen.queryByTestId('location-add-form')).toBeNull()
  })
})

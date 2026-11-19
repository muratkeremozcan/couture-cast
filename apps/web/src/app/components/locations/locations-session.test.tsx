// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19). Jade reloaded /settings while
// signed in and Locations said "Sign in to manage your locations": the section checked the bearer
// once, on mount, while the session bridge was still verifying the stored session (it clears a
// stale bearer and writes the fresh one only after the profile check). The section now follows
// the session: a stored session under verification is `checking`, never signed out, and the list
// is requested once per member. The browser proof is PL-1 and PL-2 in
// playwright/tests/settings-locations-real-session.spec.ts; these pin each transition.
import { useLayoutEffect, useSyncExternalStore } from 'react'
import { http, HttpResponse } from 'msw'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LocationSearchCandidate,
  SavedLocation,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/wardrobe'
import { useMswHandlers } from '../../../test-utils/msw/runtime'
import type * as WebSession from '../../../lib/web-session'
import { readApproximatePosition } from '../../../lib/device-position'
import { locationsFromCoordinatesFromWeb } from '../../../lib/locations'
import { LocationsSection } from './locations-section'

/** The session bridge's state, driven by hand: who verification named, and its pending answer. */
const session = vi.hoisted(() => ({
  identity: null as string | null,
  stored: false,
  verify: null as null | ((token: string | undefined) => void),
  fail: null as null | ((error: Error) => void),
  verifications: 0,
}))

vi.mock('../../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.identity,
  hasStoredWebSession: () => session.stored,
  resolveWebSessionToken: () => {
    session.verifications += 1
    return new Promise<string | undefined>((resolve, reject) => {
      session.verify = resolve
      session.fail = reject
    })
  },
}))

// Passthrough spies: every position reading and lookup still runs, and a test can settle the
// reading the section started and see whether a lookup followed it.
vi.mock('../../../lib/device-position', { spy: true })
vi.mock('../../../lib/locations', { spy: true })

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

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

/** Every list request's bearer, in order. */
let listBearers: (string | null)[]

function listHandler() {
  return http.get('/api/v1/locations', ({ request }) => {
    listBearers.push(request.headers.get('authorization'))
    return HttpResponse.json({ data: [HOME] })
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

function section() {
  return screen.getByTestId('locations-section')
}

/** What the session bridge does when verification names (or clears) the member. */
function publish(change: { identity: string | null; bearer: string | null }) {
  act(() => {
    session.identity = change.identity
    if (change.bearer === null)
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    else window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, change.bearer)
    window.dispatchEvent(new Event('couture:session'))
  })
}

async function finishVerification(token: string | undefined) {
  await act(async () => {
    session.verify?.(token)
    await Promise.resolve()
  })
}

describe('LocationsSection follows the web session', () => {
  beforeEach(async () => {
    listBearers = []
    session.identity = null
    session.stored = false
    session.verify = null
    session.fail = null
    session.verifications = 0
    useMswHandlers(listHandler())
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    window.sessionStorage.clear()
  })

  it('LOC-SESSION-WEB-01 waits through a reload verification and lists once with the fresh bearer', async () => {
    // A reload: the stored session and last load's bearer are there; nothing is verified yet.
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'stale-token')

    renderSection()

    expect(section()).toHaveAttribute('data-state', 'checking')
    expect(screen.queryByTestId('locations-signed-out')).toBeNull()
    expect(session.verifications).toBe(1)

    // The bridge clears the stale bearer first: still checking, still no request.
    publish({ identity: null, bearer: null })
    expect(section()).toHaveAttribute('data-state', 'checking')
    expect(screen.queryByTestId('locations-signed-out')).toBeNull()

    publish({ identity: 'member-1', bearer: 'fresh-token' })
    expect(await screen.findByTestId('location-item')).toHaveTextContent('Home')
    expect(section()).toHaveAttribute('data-state', 'ready')

    // The verification this section joined answers too, and the bridge may publish again.
    await finishVerification('fresh-token')
    publish({ identity: 'member-1', bearer: 'fresh-token' })
    expect(section()).toHaveAttribute('data-state', 'ready')
    expect(listBearers).toEqual(['Bearer fresh-token'])
  })

  it('LOC-SESSION-WEB-02 lists in a new tab once verification writes the bearer', async () => {
    session.stored = true

    renderSection()
    expect(section()).toHaveAttribute('data-state', 'checking')

    publish({ identity: 'member-1', bearer: 'tab-token' })

    await screen.findByTestId('location-item')
    expect(listBearers).toEqual(['Bearer tab-token'])
  })

  it('LOC-SESSION-WEB-03 says sign in only once verification ends without a member', async () => {
    session.stored = true

    renderSection()
    expect(screen.queryByTestId('locations-signed-out')).toBeNull()

    await finishVerification(undefined)

    expect(section()).toHaveAttribute('data-state', 'signed_out')
    expect(screen.getByTestId('locations-signed-out')).toHaveTextContent(
      'Sign in to manage your locations.'
    )
    expect(listBearers).toEqual([])
  })

  it('LOC-SESSION-WEB-04 lists again for a new member and clears on sign out', async () => {
    session.identity = 'member-1'
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'first-token')

    renderSection()
    await screen.findByTestId('location-item')

    // An account switch: the bridge clears the first member, then names the second.
    publish({ identity: null, bearer: null })
    expect(section()).toHaveAttribute('data-state', 'checking')
    publish({ identity: 'member-2', bearer: 'second-token' })
    await screen.findByTestId('location-item')
    expect(listBearers).toEqual(['Bearer first-token', 'Bearer second-token'])

    // Sign out: no stored session, no bearer.
    session.stored = false
    publish({ identity: null, bearer: null })
    expect(section()).toHaveAttribute('data-state', 'signed_out')
    expect(screen.queryByTestId('location-item')).toBeNull()
    expect(listBearers).toHaveLength(2)
  })

  it('LOC-SESSION-WEB-05 reads a failed verification as a load failure whose retry verifies again', async () => {
    session.stored = true
    renderSection()

    await act(async () => {
      session.fail?.(new Error('Session verification is unavailable.'))
      await Promise.resolve()
    })

    expect(section()).toHaveAttribute('data-state', 'load_failed')
    expect(screen.getByTestId('locations-load-error')).toHaveTextContent(
      'Unable to load your locations.'
    )
    expect(screen.queryByTestId('locations-signed-out')).toBeNull()
    expect(session.verifications).toBe(1)

    act(() => {
      screen.getByTestId('locations-load-retry').click()
    })
    expect(section()).toHaveAttribute('data-state', 'checking')
    expect(session.verifications).toBe(2)

    publish({ identity: 'member-1', bearer: 'recovered-token' })
    await screen.findByTestId('location-item')
    await finishVerification('recovered-token')
    expect(listBearers).toEqual(['Bearer recovered-token'])
  })

  it('LOC-SESSION-WEB-06 counts a leftover bearer only as the e2e fixture', async () => {
    // Another tab cleared the shared session; this restored tab still holds a bearer.
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'previous-member-token')
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
    const leftover = renderSection()
    expect(section()).toHaveAttribute('data-state', 'signed_out')
    leftover.unmount()

    // The fixture prefix alone is not enough without the e2e flag.
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-member')
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'false')
    const unflagged = renderSection()
    expect(section()).toHaveAttribute('data-state', 'signed_out')
    unflagged.unmount()
    expect(listBearers).toEqual([])

    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
    renderSection()
    await screen.findByTestId('location-item')
    expect(listBearers).toEqual(['Bearer test-token-member'])
  })

  it.each([
    [403, 'signed_out'],
    [503, 'load_failed'],
  ])(
    'LOC-SESSION-WEB-07 a profile %i during verification reads as %s',
    async (status, state) => {
      session.stored = true
      renderSection()

      await act(async () => {
        session.fail?.(
          Object.assign(new Error(`HTTP ${status}`), {
            response: new Response(null, { status }),
          })
        )
        await Promise.resolve()
      })

      expect(section()).toHaveAttribute('data-state', state)
      expect(screen.queryByTestId('locations-load-retry') !== null).toBe(
        state === 'load_failed'
      )
      expect(screen.queryByTestId('locations-signed-out') !== null).toBe(
        state === 'signed_out'
      )
    }
  )

  it('LOC-SESSION-WEB-08 a rename that settles after the next member loaded touches nothing of theirs', async () => {
    const user = userEvent.setup()
    let releasePatch: (() => void) | undefined
    useMswHandlers(
      http.patch('/api/v1/locations/:id', async () => {
        await new Promise<void>((resolve) => {
          releasePatch = resolve
        })
        return HttpResponse.json({ data: { ...HOME, label: 'Studio' } })
      })
    )
    session.identity = 'member-1'
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'first-token')
    renderSection()
    await screen.findByTestId('location-item')

    await user.click(screen.getByTestId('location-rename'))
    await user.clear(screen.getByTestId('location-rename-input'))
    await user.type(screen.getByTestId('location-rename-input'), 'Studio{Enter}')
    await waitFor(() => expect(releasePatch).toBeDefined())

    publish({ identity: null, bearer: null })
    publish({ identity: 'member-2', bearer: 'second-token' })
    await screen.findByTestId('location-item')
    // The next member opens their own editor.
    await user.click(screen.getByTestId('location-rename'))
    expect(screen.getByTestId('location-rename-input')).toHaveValue('Home')

    await act(async () => {
      releasePatch?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getByTestId('location-rename-input')).toHaveValue('Home')
    expect(screen.getByTestId('locations-status-region')).toHaveTextContent('')
    expect(listBearers).toEqual(['Bearer first-token', 'Bearer second-token'])
  })

  it('LOC-SESSION-WEB-09 a rename that settles after the section unmounted and the member changed sends no list', async () => {
    const user = userEvent.setup()
    let releasePatch: (() => void) | undefined
    useMswHandlers(
      http.patch('/api/v1/locations/:id', async () => {
        await new Promise<void>((resolve) => {
          releasePatch = resolve
        })
        return HttpResponse.json({ data: { ...HOME, label: 'Studio' } })
      })
    )
    session.identity = 'member-1'
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'first-token')
    const view = renderSection()
    await screen.findByTestId('location-item')
    await user.click(screen.getByTestId('location-rename'))
    await user.clear(screen.getByTestId('location-rename-input'))
    await user.type(screen.getByTestId('location-rename-input'), 'Studio{Enter}')
    await waitFor(() => expect(releasePatch).toBeDefined())
    const listsBefore = listBearers.length

    // The member leaves Profile, and the next member signs in elsewhere in the app.
    view.unmount()
    publish({ identity: 'member-2', bearer: 'second-token' })
    await act(async () => {
      releasePatch?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(listBearers.length - listsBefore).toBe(0)
  })

  /*
   * Review round 8 (2026-11-19): member-owned UI is keyed by the owner the
   * bridge names, read as an external store, so the next member's first commit
   * holds none of the last member's rows, before any effect has run.
   */
  it('LOC-KEYED-WEB-01 the next member first commit shows none of the last member rows', async () => {
    const commits: number[] = []
    const subscribe = (onChange: () => void) => {
      window.addEventListener('couture:session', onChange)
      return () => window.removeEventListener('couture:session', onChange)
    }
    /** Re-renders with every session change and records each commit, before passive effects. */
    function CommitProbe() {
      useSyncExternalStore(subscribe, () => session.identity)
      useLayoutEffect(() => {
        commits.push(document.querySelectorAll('[data-testid="location-item"]').length)
      })
      return null
    }
    session.identity = 'member-1'
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'first-token')
    render(
      <I18nextProvider i18n={getI18n()}>
        <main>
          <LocationsSection />
          <CommitProbe />
        </main>
      </I18nextProvider>
    )
    await screen.findByTestId('location-item')
    const before = commits.length

    publish({ identity: 'member-2', bearer: 'second-token' })

    expect(commits[before]).toBe(0)
  })

  it('LOC-SAVE-WEB-02 the third save removes the form, confirms once and focuses the saved place', async () => {
    const user = userEvent.setup()
    const office = {
      ...HOME,
      id: 'loc-2',
      label: 'Office',
      isPrimary: false,
      sortOrder: 1,
    }
    const studio = {
      ...HOME,
      id: 'loc-3',
      label: 'Studio',
      isPrimary: false,
      sortOrder: 2,
    }
    const candidate: LocationSearchCandidate = {
      city: 'Chicago',
      region: 'Illinois',
      country: 'US',
      latitude: 41.878,
      longitude: -87.63,
      displayLabel: 'Chicago, Illinois, United States',
      candidateToken: 'chicago.signature',
    }
    let saved = [HOME, office]
    useMswHandlers(
      http.get('/api/v1/locations', () => HttpResponse.json({ data: saved })),
      http.get('/api/v1/locations/search', () =>
        HttpResponse.json({ data: [candidate] })
      ),
      http.post('/api/v1/locations/from-search', () => {
        saved = [HOME, office, studio]
        return HttpResponse.json({ data: studio }, { status: 201 })
      })
    )
    session.identity = 'member-1'
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'first-token')
    renderSection()
    await user.type(await screen.findByTestId('location-search-input'), 'Chicago')
    await user.click(await screen.findByRole('option', { name: candidate.displayLabel }))
    const spoken: string[] = []
    const region = screen.getByTestId('locations-status-region')
    const observer = new MutationObserver(() => {
      if (region.textContent) spoken.push(region.textContent)
    })
    observer.observe(region, { childList: true, characterData: true, subtree: true })
    try {
      await user.clear(screen.getByRole('textbox', { name: 'Name this place' }))
      await user.type(
        screen.getByRole('textbox', { name: 'Name this place' }),
        'Studio{Enter}'
      )

      await waitFor(() => expect(screen.getAllByTestId('location-item')).toHaveLength(3))
      expect(screen.queryByTestId('location-add-form')).toBeNull()
      const studioLabel = screen.getAllByTestId('location-item-label')[2]!
      await waitFor(() => expect(studioLabel).toHaveFocus())
      await waitFor(() => expect(region).toHaveTextContent('Studio saved.'))
      expect(spoken.filter((text) => text === 'Studio saved.')).toHaveLength(1)
    } finally {
      observer.disconnect()
    }
  })

  /*
   * Review round 8: the owner is pinned at the tap and the bearer read when the
   * lookup is sent, so a token the same member refreshed during the browser's
   * consent is the one used, and another member's never is.
   */
  function holdPosition() {
    const held: { answer?: PositionCallback } = {}
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          held.answer = success
        },
      },
    })
    return held
  }

  it('LOC-ROTATE-WEB-01 a token the same member refreshed during consent is the one sent', async () => {
    const user = userEvent.setup()
    const lookups: (string | null)[] = []
    useMswHandlers(
      http.post('/api/v1/locations/from-coordinates', ({ request }) => {
        lookups.push(request.headers.get('authorization'))
        return HttpResponse.json({ data: [] })
      })
    )
    const held = holdPosition()
    try {
      session.identity = 'member-1'
      session.stored = true
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'first-token')
      renderSection()
      await screen.findByTestId('location-item')
      await user.click(screen.getByRole('button', { name: 'Use my location' }))
      await waitFor(() => expect(held.answer).toBeDefined())

      // The same member's session refreshes while the browser asks for consent.
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'refreshed-token')
      act(() => {
        held.answer!({
          coords: { latitude: 41.88, longitude: -87.63 },
        } as GeolocationPosition)
      })

      await waitFor(() => expect(lookups).toEqual(['Bearer refreshed-token']))
    } finally {
      Reflect.deleteProperty(window.navigator, 'geolocation')
    }
  })

  it('LOC-ROTATE-WEB-02 a position that arrives after another member signed in is never sent', async () => {
    const user = userEvent.setup()
    const lookups: (string | null)[] = []
    const office: SavedLocation = { ...HOME, id: 'loc-2', label: 'Office' }
    useMswHandlers(
      http.post('/api/v1/locations/from-coordinates', ({ request }) => {
        lookups.push(request.headers.get('authorization'))
        return HttpResponse.json({ data: [] })
      }),
      http.get('/api/v1/locations', ({ request }) => {
        const bearer = request.headers.get('authorization')
        listBearers.push(bearer)
        return HttpResponse.json({
          data: [bearer === 'Bearer second-token' ? office : HOME],
        })
      })
    )
    const held = holdPosition()
    try {
      session.identity = 'member-1'
      session.stored = true
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'first-token')
      renderSection()
      await screen.findByTestId('location-item')
      await user.click(screen.getByRole('button', { name: 'Use my location' }))
      await waitFor(() => expect(held.answer).toBeDefined())

      publish({ identity: 'member-2', bearer: 'second-token' })
      const reading = vi.mocked(readApproximatePosition).mock.results.at(-1)!
        .value as Promise<unknown>
      // The reading settles; the continuation the section registered on it runs before this
      // test's, so a lookup it started would already be recorded.
      await act(async () => {
        held.answer!({
          coords: { latitude: 41.88, longitude: -87.63 },
        } as GeolocationPosition)
        await reading
      })

      expect(vi.mocked(locationsFromCoordinatesFromWeb)).not.toHaveBeenCalled()
      expect(lookups).toEqual([])

      // The second member's own list still loads, and the lookup stays unsent after it.
      expect(await screen.findByText('Office')).toBeInTheDocument()
      expect(screen.queryByText('Home')).not.toBeInTheDocument()
      expect(listBearers).toEqual(['Bearer first-token', 'Bearer second-token'])
      expect(lookups).toEqual([])
    } finally {
      Reflect.deleteProperty(window.navigator, 'geolocation')
    }
  })
})

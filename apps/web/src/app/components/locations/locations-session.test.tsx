// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19). Jade reloaded /settings while
// signed in and Locations said "Sign in to manage your locations": the section checked the bearer
// once, on mount, while the session bridge was still verifying the stored session (it clears a
// stale bearer and writes the fresh one only after the profile check). The section now follows
// the session: a stored session under verification is `checking`, never signed out, and the list
// is requested once per member. The browser proof is PL-1 and PL-2 in
// playwright/tests/settings-locations-real-session.spec.ts; these pin each transition.
import { http, HttpResponse } from 'msw'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedLocation } from '@couture/api-client/contracts/http'
import { getI18n } from '../../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/wardrobe'
import { useMswHandlers } from '../../../test-utils/msw/runtime'
import type * as WebSession from '../../../lib/web-session'
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
})

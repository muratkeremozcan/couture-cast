// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19), Codex review 1 finding 3: a session
// check that fails (a timeout, a 503 from the profile check) was read like a session that has no
// member, so a signed-in member was told to sign in and lost city search. A failed check is now
// an outage the member can retry: the load error with Try again, never the Sign in hint, and one
// list request once the retry verifies. The browser proof is PL-3 in
// playwright/tests/settings-locations-real-session.spec.ts.
import { http, HttpResponse } from 'msw'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedLocation } from '@couture/api-client/contracts/http'
import { getI18n } from '../../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/wardrobe'
import { useMswHandlers } from '../../../test-utils/msw/runtime'
import type * as WebSession from '../../../lib/web-session'
import { LocationsSection } from './locations-section'

/** Each verification the section starts, settled by the test. */
const session = vi.hoisted(() => ({
  identity: null as string | null,
  stored: true,
  pending: [] as {
    resolve: (token: string | undefined) => void
    reject: (error: Error) => void
  }[],
}))

vi.mock('../../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.identity,
  hasStoredWebSession: () => session.stored,
  resolveWebSessionToken: () =>
    new Promise<string | undefined>((resolve, reject) => {
      session.pending.push({ resolve, reject })
    }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const HOME: SavedLocation = {
  id: 'loc-1',
  label: 'Home',
  locationKey: 'chicago-key',
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

let listRequests: number

function renderSection() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <main>
        <LocationsSection />
      </main>
    </I18nextProvider>
  )
}

const section = () => screen.getByTestId('locations-section')

/** What the bridge does when a verification names the member and writes the bearer. */
function verifyMember(index: number) {
  return act(async () => {
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'fresh-token')
    window.dispatchEvent(new Event('couture:session'))
    session.pending[index]!.resolve('fresh-token')
    await Promise.resolve()
  })
}

function failVerification(index: number) {
  return act(async () => {
    session.pending[index]!.reject(new Error('Session verification is unavailable.'))
    await Promise.resolve()
  })
}

function expectOutage() {
  expect(section()).toHaveAttribute('data-state', 'load_failed')
  expect(screen.getByTestId('locations-load-error')).toHaveTextContent(
    'Unable to load your locations.'
  )
  expect(screen.getByTestId('locations-load-retry')).toHaveTextContent('Try again')
  expect(screen.queryByTestId('locations-signed-out')).toBeNull()
}

describe('LocationsSection treats a failed session check as an outage, never as signed out', () => {
  beforeEach(async () => {
    listRequests = 0
    session.identity = null
    session.stored = true
    session.pending = []
    useMswHandlers(
      http.get('/api/v1/locations', () => {
        listRequests += 1
        return HttpResponse.json({ data: [HOME] })
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('LOC-OUTAGE-WEB-01 a failed check offers Try again, and the retry that verifies lists once', async () => {
    renderSection()
    expect(section()).toHaveAttribute('data-state', 'checking')

    await failVerification(0)
    expectOutage()
    expect(listRequests).toBe(0)

    await userEvent.setup().click(screen.getByTestId('locations-load-retry'))
    expect(session.pending).toHaveLength(2)
    await verifyMember(1)

    expect(await screen.findByTestId('location-item')).toHaveTextContent('Home')
    expect(section()).toHaveAttribute('data-state', 'ready')
    expect(screen.queryByTestId('locations-load-error')).toBeNull()
    expect(listRequests).toBe(1)
  })

  it('LOC-OUTAGE-WEB-02 a retry that fails again stays an outage, still never Sign in', async () => {
    renderSection()
    await failVerification(0)
    await userEvent.setup().click(screen.getByTestId('locations-load-retry'))
    await failVerification(1)

    expectOutage()
    expect(listRequests).toBe(0)
  })

  it('LOC-OUTAGE-WEB-03 a check that fails after the bridge already named the member changes nothing', async () => {
    renderSection()
    expect(session.pending).toHaveLength(1)

    // The bridge verifies the member on its own while this section's check is still pending.
    await act(async () => {
      session.identity = 'member-1'
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'fresh-token')
      window.dispatchEvent(new Event('couture:session'))
      await Promise.resolve()
    })
    await screen.findByTestId('location-item')

    // The superseded check now fails late.
    await failVerification(0)

    expect(section()).toHaveAttribute('data-state', 'ready')
    expect(screen.getByTestId('location-item')).toHaveTextContent('Home')
    expect(screen.queryByTestId('locations-load-error')).toBeNull()
    expect(screen.queryByTestId('locations-load-retry')).toBeNull()
    expect(listRequests).toBe(1)
  })

  it('LOC-OUTAGE-WEB-05 member A check failing late while member B is still checking leaves B checking, then B lists once', async () => {
    const bearers: (string | null)[] = []
    useMswHandlers(
      http.get('/api/v1/locations', ({ request }) => {
        listRequests += 1
        bearers.push(request.headers.get('authorization'))
        return HttpResponse.json({ data: [HOME] })
      })
    )
    renderSection()
    expect(session.pending).toHaveLength(1)

    // The bridge names member A on its own; A's check from this section stays outstanding.
    await act(async () => {
      session.identity = 'member-a'
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-a')
      window.dispatchEvent(new Event('couture:session'))
      await Promise.resolve()
    })
    await screen.findByTestId('location-item')

    // An account switch: A is cleared, the stored session now belongs to B, a new check starts.
    await act(async () => {
      session.identity = null
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
      window.dispatchEvent(new Event('couture:session'))
      await Promise.resolve()
    })
    expect(section()).toHaveAttribute('data-state', 'checking')
    expect(session.pending).toHaveLength(2)

    // A's original check fails late. Nothing in it is about B.
    await failVerification(0)
    expect(section()).toHaveAttribute('data-state', 'checking')
    expect(screen.queryByTestId('locations-load-error')).toBeNull()
    expect(screen.queryByTestId('locations-signed-out')).toBeNull()

    await act(async () => {
      session.identity = 'member-b'
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-b')
      window.dispatchEvent(new Event('couture:session'))
      session.pending[1]!.resolve('token-b')
      await Promise.resolve()
    })
    await screen.findByTestId('location-item')
    expect(section()).toHaveAttribute('data-state', 'ready')
    expect(bearers).toEqual(['Bearer token-a', 'Bearer token-b'])
  })

  it('LOC-OUTAGE-WEB-04 a check that verifies no member is signed out, as before', async () => {
    session.stored = true
    renderSection()
    await act(async () => {
      session.stored = false
      session.pending[0]!.resolve(undefined)
      await Promise.resolve()
    })

    expect(section()).toHaveAttribute('data-state', 'signed_out')
    expect(screen.getByTestId('locations-signed-out')).toBeInTheDocument()
    expect(screen.queryByTestId('locations-load-retry')).toBeNull()
  })
})

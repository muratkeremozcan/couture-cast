// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19), Codex review 3 findings 2 and 4.
//
// Finding 2: a restored tab can keep the previous session's bearer in session storage after
// another tab signed out. With no verified member and no stored session, that leftover bearer is
// not a member: the section reads nothing with it. Only the e2e fixture bearer (NEXT_PUBLIC_E2E_AUTH
// and a test-token prefix) skips verification.
//
// Finding 4: the API refusing the profile check (401, 403, 404) is a definitive answer, so the
// section signs the member out; only a timeout or a 5xx is the retryable outage.
import { http, HttpResponse } from 'msw'
import { act, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedLocation } from '@couture/api-client/contracts/http'
import { getI18n } from '../../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/wardrobe'
import { useMswHandlers } from '../../../test-utils/msw/runtime'
import type * as WebSession from '../../../lib/web-session'
import { LocationsSection } from './locations-section'

const session = vi.hoisted(() => ({
  identity: null as string | null,
  stored: false,
  pending: [] as {
    resolve: (token: string | undefined) => void
    reject: (error: unknown) => void
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
  label: 'Previous Home',
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

let listBearers: (string | null)[]

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

/** What the generated API client throws when the profile check answers `status`. */
function profileCheckFailure(status: number) {
  return Object.assign(new Error(`Response returned an error code ${status}`), {
    name: 'ResponseError',
    response: new Response(null, { status }),
  })
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('LocationsSection trusts only a verified member', () => {
  beforeEach(async () => {
    listBearers = []
    session.identity = null
    session.stored = false
    session.pending = []
    vi.unstubAllEnvs()
    // Explicit in every case, never inherited from the build that runs the suite.
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'false')
    useMswHandlers(
      http.get('/api/v1/locations', ({ request }) => {
        listBearers.push(request.headers.get('authorization'))
        return HttpResponse.json({ data: [HOME] })
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
    vi.unstubAllEnvs()
  })

  it('LOC-TRUST-WEB-01 a leftover bearer with no verified member and no stored session reads nothing', async () => {
    window.sessionStorage.setItem(
      WEB_ACCESS_TOKEN_STORAGE_KEY,
      'eyJleftover.previous.member'
    )

    renderSection()
    await flush()

    expect(section()).toHaveAttribute('data-state', 'signed_out')
    expect(screen.getByTestId('locations-signed-out')).toBeInTheDocument()
    expect(screen.queryByText('Previous Home')).toBeNull()
    expect(listBearers).toEqual([])
  })

  it('LOC-TRUST-WEB-02 a test-token bearer outside the e2e build is not a member either', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-guardian')

    renderSection()
    await flush()

    expect(section()).toHaveAttribute('data-state', 'signed_out')
    expect(listBearers).toEqual([])
  })

  it('LOC-TRUST-WEB-03 the e2e fixture bearer still lists, as the local lane needs', async () => {
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-guardian')

    renderSection()

    expect(await screen.findByText('Previous Home')).toBeInTheDocument()
    expect(listBearers).toEqual(['Bearer test-token-guardian'])
  })

  it('LOC-TRUST-WEB-06 under the e2e build, a bearer that is not the fixture is still no member', async () => {
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
    window.sessionStorage.setItem(
      WEB_ACCESS_TOKEN_STORAGE_KEY,
      'eyJleftover.previous.member'
    )

    renderSection()
    await flush()

    expect(section()).toHaveAttribute('data-state', 'signed_out')
    expect(screen.getByTestId('locations-signed-out')).toBeInTheDocument()
    expect(screen.queryByText('Previous Home')).toBeNull()
    expect(listBearers).toEqual([])
  })

  it.each([401, 403, 404])(
    'LOC-TRUST-WEB-04 a profile check refused with %i signs the member out, with no retry',
    async (status) => {
      session.stored = true
      renderSection()
      expect(session.pending).toHaveLength(1)

      // The bridge cleared the bearer, but the Supabase session can stay stored.
      await act(async () => {
        session.pending[0]!.reject(profileCheckFailure(status))
        await Promise.resolve()
      })
      await flush()

      expect(section()).toHaveAttribute('data-state', 'signed_out')
      expect(screen.getByTestId('locations-signed-out')).toBeInTheDocument()
      expect(screen.queryByTestId('locations-load-retry')).toBeNull()
      expect(listBearers).toEqual([])
    }
  )

  it('LOC-TRUST-WEB-05 a profile check that fails with 503 is the retryable outage', async () => {
    session.stored = true
    renderSection()

    await act(async () => {
      session.pending[0]!.reject(profileCheckFailure(503))
      await Promise.resolve()
    })
    await flush()

    expect(section()).toHaveAttribute('data-state', 'load_failed')
    expect(screen.getByTestId('locations-load-retry')).toHaveTextContent('Try again')
    expect(screen.queryByTestId('locations-signed-out')).toBeNull()
  })
})

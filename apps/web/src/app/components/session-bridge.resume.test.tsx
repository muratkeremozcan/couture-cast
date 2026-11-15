// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D3: W-RESUME on web. A stored Google identity with no account goes back to the
// finish step on any page load, the server's status decides (so a new tab with no marker still
// resumes), and from=preview survives only when the marker carries it. A member and the
// callback and finish pages are left alone.
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import type { Session } from '@supabase/supabase-js'
import { act, cleanup, render } from '@testing-library/react'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useMswHandlers as installHandlers } from '../../test-utils/msw/runtime'

vi.mock(
  '@couture/api-client',
  () => import('../../../../../packages/api-client/src/index')
)
vi.mock(
  '@couture/api-client/contracts/http',
  () => import('../../../../../packages/api-client/src/contracts/http/index')
)

// The root layout mounts the bridge once; Next.js reports each client-side route change here.
const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

const sdk = vi.hoisted(() => ({
  session: null as Session | null,
  createClient: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }))

const apiBase = 'http://localhost'
const AUTH_STORAGE_KEY = 'couturecast.auth-session'
const FINISH_MARKER = 'couturecast.federated-finish'
const realLocation = window.location
let replace: Mock

function waitingIdentity(): Session {
  return {
    access_token: 'signed-waiting-identity',
    refresh_token: 'synthetic-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: 'supabase-waiting-identity',
      aud: 'authenticated',
      email: 'waiting@synthetic.test',
      app_metadata: { provider: 'google' },
      user_metadata: {},
      created_at: '2026-11-15T00:00:00Z',
    },
  }
}

const json =
  (body: JsonBodyType, status = 200) =>
  () =>
    HttpResponse.json(body, { status })

/** Profile and federated status answers; returns the requests each one saw. */
function server(profile: () => Response, status: () => Response) {
  const seen = { profile: 0, status: 0 }
  installHandlers(
    http.get(`${apiBase}/api/v1/user/profile`, () => {
      seen.profile++
      return profile()
    }),
    http.get(`${apiBase}/api/v1/auth/signup/federated`, () => {
      seen.status++
      return status()
    })
  )
  return seen
}

const unauthorized = json({ message: 'Invalid access token' }, 401)
const needsBirthdate = json({ status: 'needs_birthdate' })
const member = json({
  user: {
    id: 'app-member',
    email: 'member@synthetic.test',
    displayName: null,
    birthdate: null,
    role: 'guardian',
  },
  linkedGuardians: [],
  linkedTeens: [],
})

function at(path: string) {
  nav.pathname = path
  window.history.replaceState(null, '', path)
  replace = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      get href() {
        return realLocation.href
      },
      get origin() {
        return realLocation.origin
      },
      get pathname() {
        return realLocation.pathname
      },
      get search() {
        return realLocation.search
      },
      get hash() {
        return realLocation.hash
      },
      replace,
      assign: vi.fn(),
    },
  })
}

/** Mounts the bridge and lets the session start, the profile check and the status settle. */
async function settle() {
  for (let turn = 0; turn < 20; turn++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
}

async function mountBridge() {
  const { SessionBridge } = await import('./session-bridge')
  const view = render(<SessionBridge />)
  await settle()
  return { rerender: () => view.rerender(<SessionBridge />) }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'false')
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', apiBase)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://identity.synthetic.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon')
  sessionStorage.clear()
  localStorage.clear()
  // A Google identity the browser kept: the SDK restores it and its storage key exists.
  sdk.session = waitingIdentity()
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ synthetic: true }))
  sdk.createClient.mockImplementation(() => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: sdk.session }, error: null }),
      signOut: () => Promise.resolve({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }))
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  window.history.replaceState(null, '', '/')
  sessionStorage.clear()
  localStorage.clear()
  vi.unstubAllEnvs()
})

describe('W-RESUME: a stored identity without an account returns to the finish step', () => {
  it('a new tab with no marker still resumes, because the server status decides', async () => {
    at('/wardrobe')
    const seen = server(unauthorized, needsBirthdate)
    await mountBridge()
    expect(seen.status).toBeGreaterThanOrEqual(1)
    expect(replace.mock.calls).toEqual([['/signup/finish']])
  })

  it('carries from=preview only when the marker says so', async () => {
    at('/')
    sessionStorage.setItem(FINISH_MARKER, JSON.stringify({ from: 'preview' }))
    server(unauthorized, needsBirthdate)
    await mountBridge()
    expect(replace.mock.calls).toEqual([['/signup/finish?from=preview']])
  })

  it('ignores from=preview in the page URL when the marker does not carry it', async () => {
    at('/settings?from=preview')
    server(unauthorized, needsBirthdate)
    await mountBridge()
    expect(replace.mock.calls).toEqual([['/signup/finish']])
  })

  it('does not resume when the server says the identity is complete', async () => {
    at('/wardrobe')
    sessionStorage.setItem(FINISH_MARKER, JSON.stringify({ from: null }))
    server(unauthorized, json({ status: 'complete' }))
    await mountBridge()
    expect(replace).not.toHaveBeenCalled()
  })

  it('leaves a verified member alone, even with a stale marker', async () => {
    at('/wardrobe')
    sessionStorage.setItem(FINISH_MARKER, JSON.stringify({ from: null }))
    const seen = server(member, needsBirthdate)
    await mountBridge()
    expect(seen.profile).toBeGreaterThanOrEqual(1)
    expect(replace).not.toHaveBeenCalled()
  })

  // The legal pages too: Google's consent screen and the finish step link to them mid-signup.
  it.each(['/signup/finish', '/auth/callback', '/privacy', '/terms'])(
    'leaves %s alone',
    async (path) => {
      at(path)
      sessionStorage.setItem(FINISH_MARKER, JSON.stringify({ from: null }))
      server(unauthorized, needsBirthdate)
      await mountBridge()
      expect(replace).not.toHaveBeenCalled()
    }
  )

  // Antigravity P1-2: a Link from a legal page is a client-side navigation, which never
  // remounts the root layout's bridge; the resume must run again on the new route.
  it('resumes after a client-side navigation out of an exempt legal page', async () => {
    at('/privacy')
    const seen = server(unauthorized, needsBirthdate)
    const bridge = await mountBridge()
    expect(replace).not.toHaveBeenCalled()
    const before = seen.status
    window.history.replaceState(null, '', '/')
    nav.pathname = '/'
    bridge.rerender()
    await settle()
    expect(seen.status).toBeGreaterThan(before)
    expect(replace.mock.calls).toEqual([['/signup/finish']])
  })
})

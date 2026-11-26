// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D5, D6: the web OAuth callback page. U-CALLBACK-CLEAN (call order: the address bar
// is clean before the exchange starts), W-FAIL-NO-RAW-ERROR, L-G-PLAIN-SIGNIN and the door rule
// (a failure started from /signup returns to /signup).
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  createGuestPreviewStore,
  getFederatedSignInStrings,
  SAMPLE_CATALOG,
} from '@couture/utils'
import type * as WebSession from '../../../lib/web-session'

vi.mock(
  '@couture/api-client',
  () => import('../../../../../../packages/api-client/src/index')
)
vi.mock(
  '@couture/api-client/contracts/http',
  () => import('../../../../../../packages/api-client/src/contracts/http/index')
)

// Only the external Supabase SDK is replaced; the session module runs for real. The callback's
// call into it is wrapped so a test can read the address bar at the moment of the call.
const sdk = vi.hoisted(() => ({
  createClient: vi.fn(),
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: sdk.createClient }))

const flow = vi.hoisted(() => ({
  urlAtCall: [] as string[],
  outcome: null as null | { kind: string },
  /** The exchange itself throws, so the page shows its own failure line. */
  rejects: false,
}))
vi.mock('../../../lib/web-session', async (importOriginal) => {
  const actual = await importOriginal<typeof WebSession>()
  return {
    ...actual,
    completeWebOAuth: (params: URLSearchParams) => {
      flow.urlAtCall.push(`${window.location.search}${window.location.hash}`)
      if (flow.rejects) return Promise.reject(new Error('synthetic exchange failure'))
      return flow.outcome
        ? Promise.resolve(flow.outcome as WebSession.WebOAuthOutcome)
        : actual.completeWebOAuth(params)
    },
  }
})

const strings = getFederatedSignInStrings('en-US')
const realLocation = window.location
let replace: Mock

/** The real jsdom URL (so history.replaceState is observed) with a spy for navigation. */
function at(url: string) {
  window.history.replaceState(null, '', url)
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

function memoryAdapter() {
  let value: string | null = null
  return {
    value: () => value,
    read: () => Promise.resolve(value),
    write: (text: string) => {
      value = text
      return Promise.resolve()
    },
    remove: () => {
      value = null
      return Promise.resolve()
    },
  }
}

async function renderCallback() {
  const { default: OAuthCallbackPage } = await import('./page')
  return render(<OAuthCallbackPage />)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  flow.urlAtCall = []
  flow.outcome = null
  flow.rejects = false
  vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'false')
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://identity.synthetic.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon')
  sessionStorage.clear()
  localStorage.clear()
  sdk.createClient.mockImplementation(() => ({
    auth: {
      signInWithOAuth: sdk.signInWithOAuth,
      exchangeCodeForSession: sdk.exchangeCodeForSession,
      getSession: sdk.getSession,
      signOut: sdk.signOut,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }))
  sdk.signInWithOAuth.mockResolvedValue({
    data: { provider: 'google', url: null },
    error: null,
  })
  sdk.getSession.mockResolvedValue({ data: { session: null }, error: null })
  sdk.signOut.mockResolvedValue({ error: null })
})

afterEach(async () => {
  cleanup()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  window.history.replaceState(null, '', '/')
  const { setWebGuestPreviewStoreForTests } = await import('../../../lib/guest-preview')
  setWebGuestPreviewStoreForTests(undefined)
  vi.unstubAllEnvs()
})

describe('U-CALLBACK-CLEAN: the address bar is clean before the exchange starts', () => {
  it.each([
    ['/auth/callback?code=one-time-code&state=s#error_description=x', ''],
    ['/auth/callback?code=one-time-code&from=preview&state=s', '?from=preview'],
  ])('%s is %j when completeWebOAuth is called', async (url, expected) => {
    at(url)
    flow.outcome = { kind: 'no_account' }
    await renderCallback()
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    expect(flow.urlAtCall).toEqual([expected])
    expect(realLocation.href).not.toContain('one-time-code')
  })
})

// A teen waiting on a guardian goes to the finish step, which shows the guardian invitation.
describe('W-AWAITING-GUARDIAN: the callback sends a waiting teen to the finish step', () => {
  it.each([
    ['/auth/callback?code=teen-code&state=s', '/signup/finish'],
    ['/auth/callback?code=teen-code&door=signup&state=s', '/signup/finish?door=signup'],
  ])('%s goes to %s', async (url, destination) => {
    at(url)
    flow.outcome = { kind: 'awaiting_guardian' }
    await renderCallback()
    await waitFor(() => expect(replace).toHaveBeenCalledWith(destination))
  })
})

// Story CC-7.9 D6: each visible callback state sits under the shared top bar, like /signin.
describe('7.9 D6: the callback status and failure show the shared top bar', () => {
  function expectSharedBar() {
    const bar = screen.getByTestId('app-header')
    expect(within(bar).getByRole('heading', { level: 1 })).toHaveTextContent(
      strings.continueWithGoogle
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(within(bar).getByTestId('app-top-bar-back')).toHaveAttribute('href', '/')
    expect(bar.closest('[data-surface="page"]')).not.toBeNull()
  }

  it('while the exchange runs', async () => {
    at('/auth/callback?code=slow-code')
    flow.outcome = { kind: 'member' }
    await renderCallback()

    expect(screen.getByTestId('oauth-callback-status')).toHaveTextContent(
      strings.finishing
    )
    expectSharedBar()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  })

  it('after the exchange fails', async () => {
    at('/auth/callback?code=failing-code')
    flow.rejects = true
    await renderCallback()

    await waitFor(() =>
      expect(screen.getByTestId('oauth-callback-status')).toHaveTextContent(
        strings.unavailable
      )
    )
    expectSharedBar()
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('W-FAIL-NO-RAW-ERROR: provider text never reaches the page or the next URL', () => {
  const raw = '<img src=x onerror=alert(1)> Provider free text that must stay unseen'

  it('renders only a fixed localized string and sends a fixed outcome name to the door', async () => {
    at(
      `/auth/callback?error=server_error&error_description=${encodeURIComponent(raw)}#error_description=${encodeURIComponent(raw)}`
    )
    await renderCallback()
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    const html = document.body.innerHTML
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('Provider free text')
    expect([strings.finishing, strings.unavailable]).toContain(
      screen.getByTestId('oauth-callback-status').textContent
    )
    const destination = String(replace.mock.calls[0]![0])
    expect(destination).toMatch(/^\/signin\?google=unavailable(&|$)/)
    expect(destination).not.toMatch(/error_description|onerror|free/i)
  })
})

describe('L-G-PLAIN-SIGNIN: a Google sign-in without from=preview deletes guest state', () => {
  it('clears a stored conversion and goes to /', async () => {
    const { setWebGuestPreviewStoreForTests } = await import('../../../lib/guest-preview')
    const adapter = memoryAdapter()
    const store = createGuestPreviewStore({ adapter, catalog: SAMPLE_CATALOG })
    setWebGuestPreviewStoreForTests(store)
    store.start()
    store.update((state) => ({
      ...state,
      conversion: { intent: 'guest-preview-carryover' },
    }))
    await store.flush()
    expect(adapter.value()).not.toBeNull()

    at('/auth/callback?code=member-code')
    flow.outcome = { kind: 'member' }
    await renderCallback()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(adapter.value()).toBeNull()
  })
})

describe('D5 door rule: a round trip started on /signup comes back to /signup', () => {
  // Review finding 5: the door survives the round trip (red on the pre-fix range).
  it('a cancelled chooser started from the signup form returns to /signup', async () => {
    at('/signup')
    const { SignupForm } = await import('../../signup/signup-form')
    render(<SignupForm />)
    fireEvent.click(screen.getByTestId('google-sign-in'))
    await waitFor(() => expect(sdk.signInWithOAuth).toHaveBeenCalledTimes(1))
    const redirectTo = new URL(
      (
        sdk.signInWithOAuth.mock.calls[0]![0] as { options: { redirectTo: string } }
      ).options.redirectTo
    )
    cleanup()

    const query = new URLSearchParams(redirectTo.search)
    query.set('error', 'access_denied')
    query.set('error_description', 'The person closed the chooser')
    at(`${redirectTo.pathname}?${query.toString()}`)
    await renderCallback()
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    expect(String(replace.mock.calls[0]![0])).toMatch(/^\/signup(\?|$)/)
    expect(String(replace.mock.calls[0]![0])).toContain('google=cancelled')
  })
})

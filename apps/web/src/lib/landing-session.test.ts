// Owner report 2026-11-16: the landing showed a signed-in member Start signup and Sign in.
// These cases pin the session decision the landing reads, the head script that makes it before
// first paint.
import { describe, expect, it } from 'vitest'
import {
  AUTH_SESSION_STORAGE_KEY,
  LANDING_BEARER_STORAGE_KEY,
  landingSessionFrom,
  landingSessionScript,
  type LandingSession,
} from './landing-session'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'

const storage = (values: Record<string, string>) => ({
  getItem: (key: string) => values[key] ?? null,
})
type Case = {
  name: string
  local: Record<string, string>
  session: Record<string, string>
  e2eAuth?: boolean
  before: LandingSession
  after: LandingSession
}

const nowSeconds = () => Math.floor(Date.now() / 1000)
const stored = (session: unknown) => ({
  [AUTH_SESSION_STORAGE_KEY]:
    typeof session === 'string' ? session : JSON.stringify(session),
})
const STORED = stored({
  access_token: 'eyJ.access',
  refresh_token: 'refresh-1',
  expires_at: nowSeconds() + 3600,
})
const EXPIRED = stored({
  access_token: 'eyJ.access',
  refresh_token: 'refresh-1',
  expires_at: nowSeconds() - 60,
})
const BEARER = { [LANDING_BEARER_STORAGE_KEY]: 'eyJ.verified' }
const FIXTURE = { [LANDING_BEARER_STORAGE_KEY]: 'test-token-guardian' }

// `before` is the state while this page's session start runs (and the head script's); `after`
// is the state once it finished.
const CASES: Case[] = [
  { name: 'nothing stored', local: {}, session: {}, before: 'none', after: 'none' },
  {
    name: 'a verified member in this tab',
    local: STORED,
    session: BEARER,
    before: 'member',
    after: 'member',
  },
  {
    name: 'a stored session not verified in this tab yet (a new tab)',
    local: STORED,
    session: {},
    before: 'pending',
    after: 'none',
  },
  {
    name: 'a bearer whose stored session another tab signed out',
    local: {},
    session: BEARER,
    before: 'none',
    after: 'none',
  },
  {
    name: 'the end-to-end fixture bearer, with fixtures on',
    local: {},
    session: FIXTURE,
    e2eAuth: true,
    before: 'member',
    after: 'member',
  },
  {
    name: 'the end-to-end fixture bearer, with fixtures off',
    local: {},
    session: FIXTURE,
    before: 'none',
    after: 'none',
  },
  // TEA H-1: an expired session may have been revoked; it waits for the refresh.
  {
    name: "an expired stored session with this tab's old bearer",
    local: EXPIRED,
    session: BEARER,
    before: 'pending',
    // TEA F1: a tab back from sleep waits for the refresh instead of showing Sign in.
    after: 'pending',
  },
  // TEA H-2: corrupt storage is signed out, never pending and never member.
  {
    name: 'malformed stored JSON',
    local: stored('{"access_token":'),
    session: BEARER,
    before: 'none',
    after: 'none',
  },
  {
    name: 'a stored session without expires_at',
    local: stored({ access_token: 'eyJ.access', refresh_token: 'refresh-1' }),
    session: BEARER,
    before: 'none',
    after: 'none',
  },
  {
    name: 'a stored session without a refresh token',
    local: stored({ access_token: 'eyJ.access', expires_at: nowSeconds() + 3600 }),
    session: {},
    before: 'none',
    after: 'none',
  },
  {
    name: 'a stored session without an access token',
    local: stored({ refresh_token: 'refresh-1', expires_at: nowSeconds() + 3600 }),
    session: BEARER,
    before: 'none',
    after: 'none',
  },
  {
    name: 'a stored JSON value that is not an object',
    local: stored('"just a string"'),
    session: BEARER,
    before: 'none',
    after: 'none',
  },
  {
    name: 'a blank bearer',
    local: STORED,
    session: { [LANDING_BEARER_STORAGE_KEY]: '  ' },
    before: 'pending',
    after: 'none',
  },
]

type HeadScript = (window: unknown, document: unknown) => void
/** The head script as a function of window and document; it is static source under test. */
const compile = (e2eAuth: boolean) =>
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', 'document', landingSessionScript({ e2eAuth })) as HeadScript

/** Runs the head script against fake storage and returns what it wrote on <html>. */
function runHeadScript(testCase: Case) {
  let written: string | undefined
  const fakeWindow = {
    localStorage: storage(testCase.local),
    sessionStorage: storage(testCase.session),
  }
  const fakeDocument = {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        expect(name).toBe('data-session')
        written = value
      },
    },
  }
  compile(!!testCase.e2eAuth)(fakeWindow, fakeDocument)
  return written
}

describe('landing session', () => {
  it('reads the bearer under the key the session code writes', () => {
    expect(LANDING_BEARER_STORAGE_KEY).toBe(WEB_ACCESS_TOKEN_STORAGE_KEY)
  })

  for (const testCase of CASES) {
    it(`${testCase.name}: ${testCase.before}, then ${testCase.after}`, () => {
      const stores = {
        local: storage(testCase.local),
        session: storage(testCase.session),
      }
      const e2eAuth = !!testCase.e2eAuth
      expect(landingSessionFrom(stores, { settled: false, e2eAuth })).toBe(
        testCase.before
      )
      expect(landingSessionFrom(stores, { settled: true, e2eAuth })).toBe(testCase.after)
      // The head script decides exactly as the page does before its session start finishes.
      expect(runHeadScript(testCase)).toBe(testCase.before)
    })
  }

  it('falls back to signed out when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError')
      },
    }
    let written: string | undefined
    compile(false)(
      { localStorage: blocked, sessionStorage: blocked },
      {
        documentElement: {
          setAttribute: (_: string, value: string) => (written = value),
        },
      }
    )
    expect(written).toBe('none')
  })
})

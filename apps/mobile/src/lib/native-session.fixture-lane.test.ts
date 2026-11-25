// Story 7.5 Codex P1: the dev-only Maestro fixture lane names its member from the API's profile
// answer for the injected bearer, so owner-checked actions (garment tag edits, Style this piece)
// run on Android the way they do for a signed-in member. The real session path is untouched.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../test-utils/msw/server'

const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: vi.fn() }),
  },
}))
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }))
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@supabase/supabase-js', () => ({
  processLock: vi.fn(),
  createClient: supabase.createClient,
}))

const FIXTURE_BEARER = 'fixture-lane-bearer'
const MEMBER = 'fixture-lane-member'

function profile(id: string) {
  return {
    user: {
      id,
      email: 'fixture@synthetic.test',
      displayName: null,
      birthdate: '1990-01-01T00:00:00.000Z',
      role: 'guardian',
    },
    linkedGuardians: [],
    linkedTeens: [],
  }
}

/** Fresh module state per test: the session and the owner are process singletons. */
async function load(): Promise<{
  mobileApplicationUserId: () => string | null
  startNativeSession: () => Promise<() => void>
}> {
  vi.resetModules()
  const { mobileApplicationUserId } = await import('./mobile-auth.js')
  const { startNativeSession } = await import('./native-session.js')
  return { mobileApplicationUserId, startNativeSession }
}

let bearers: (string | null)[]

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN = FIXTURE_BEARER
  delete process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE
  delete process.env.EXPO_PUBLIC_E2E_AUTH_MODE
  bearers = []
  supabase.createClient.mockReset()
})

afterEach(() => {
  delete process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN
  vi.useRealTimers()
})

describe('startNativeSession in the fixture lane', () => {
  it('[P0] names the member the API verified for the injected bearer', async () => {
    server.use(
      http.get('*/api/v1/user/profile', ({ request }) => {
        bearers.push(request.headers.get('Authorization'))
        return HttpResponse.json(profile(MEMBER))
      })
    )
    const { mobileApplicationUserId, startNativeSession } = await load()
    expect(mobileApplicationUserId()).toBeNull()

    const cleanup = await startNativeSession()

    expect(mobileApplicationUserId()).toBe(MEMBER)
    expect(bearers).toEqual([`Bearer ${FIXTURE_BEARER}`])
    // The fixture lane never starts a Supabase session.
    expect(supabase.createClient).not.toHaveBeenCalled()
    expect(cleanup()).toBeUndefined()
  })

  it('[P1] retries a transient failure, then names the member', async () => {
    let calls = 0
    server.use(
      http.get('*/api/v1/user/profile', () => {
        calls += 1
        return calls === 1
          ? HttpResponse.json({ message: 'unavailable' }, { status: 503 })
          : HttpResponse.json(profile(MEMBER))
      })
    )
    const { mobileApplicationUserId, startNativeSession } = await load()

    await startNativeSession()

    expect(calls).toBe(2)
    expect(mobileApplicationUserId()).toBe(MEMBER)
  })

  it('[P0] leaves the lane without an owner when the API refuses the bearer', async () => {
    let calls = 0
    server.use(
      http.get('*/api/v1/user/profile', () => {
        calls += 1
        return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
      })
    )
    const { mobileApplicationUserId, startNativeSession } = await load()

    await startNativeSession()

    expect(calls).toBe(1)
    expect(mobileApplicationUserId()).toBeNull()
  })

  it('[P1] gives up after three failed checks without an owner', async () => {
    let calls = 0
    server.use(
      http.get('*/api/v1/user/profile', () => {
        calls += 1
        return HttpResponse.json({ message: 'unavailable' }, { status: 503 })
      })
    )
    const { mobileApplicationUserId, startNativeSession } = await load()

    await startNativeSession()

    expect(calls).toBe(3)
    expect(mobileApplicationUserId()).toBeNull()
  })
})

// Story 6.5: native sign-in classifies its failures the way the web does.
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../test-utils/msw/server'

const sdk = vi.hoisted(() => ({
  verify: vi.fn(),
  request: vi.fn(),
  current: { access_token: 'local-session', user: { id: 'auth-principal' } },
}))
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) },
}))
vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        supabaseUrl: 'http://127.0.0.1:54321',
        supabaseAnonKey: 'local-fixture-only',
      },
    },
  },
}))
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@supabase/supabase-js', () => ({
  processLock: vi.fn(),
  createClient: () => ({
    auth: {
      verifyOtp: sdk.verify,
      signInWithOtp: sdk.request,
      signOut: () => Promise.resolve({ error: null }),
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    },
  }),
}))
import { requestNativeOtp, signOutNativeSession, verifyNativeOtp } from './native-session'

const reason = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: unknown) =>
      error && typeof error === 'object' && 'reason' in error ? error.reason : 'untyped'
  )
const profile = {
  user: {
    id: 'app-member',
    email: 'member@synthetic.test',
    displayName: null,
    birthdate: '1990-01-01T00:00:00.000Z',
    role: 'guardian',
  },
  linkedGuardians: [],
  linkedTeens: [],
}

beforeEach(async () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  await signOutNativeSession()
  sdk.request.mockResolvedValue({ error: null })
  sdk.verify.mockResolvedValue({ data: { session: sdk.current }, error: null })
})

describe('native sign-in failure reasons', () => {
  it('reports a code that could not be sent as temporary', async () => {
    sdk.request.mockResolvedValue({ error: new Error('mail unavailable') })
    expect(await reason(requestNativeOtp('member@synthetic.test'))).toBe('unavailable')
  })

  it.each([
    ['an expired or wrong code', 403, 'code_invalid'],
    ['an Auth rate limit', 429, 'unavailable'],
    ['an Auth outage', 500, 'unavailable'],
    ['a network failure', undefined, 'unavailable'],
  ] as const)('classifies %s', async (_label, status, expected) => {
    sdk.verify.mockResolvedValue({
      data: { session: null },
      error: Object.assign(new Error('Auth refused'), status ? { status } : {}),
    })
    expect(await reason(verifyNativeOtp('member@synthetic.test', '123456'))).toBe(
      expected
    )
  })

  it.each([
    [404, 'denied'],
    [403, 'denied'],
    [503, 'unavailable'],
  ] as const)(
    'classifies a verified code whose account check answers %i as %s',
    async (status, expected) => {
      server.use(
        http.get('*/api/v1/user/profile', () => HttpResponse.json({}, { status }))
      )
      expect(await reason(verifyNativeOtp('member@synthetic.test', '123456'))).toBe(
        expected
      )
    }
  )

  it('signs in when the account check succeeds', async () => {
    server.use(http.get('*/api/v1/user/profile', () => HttpResponse.json(profile)))
    expect(await reason(verifyNativeOtp('member@synthetic.test', '123456'))).toBe(
      'resolved'
    )
  })
})

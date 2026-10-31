// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
/* eslint-disable @typescript-eslint/await-thenable */
// T07 controls external SDK/storage/native/HTTP boundaries. Production session,
// canonical profile client, initial screen effects and community wrappers execute.
import type * as ReactNativeModule from 'react-native'
import { vi, beforeAll, afterAll, expect, it } from 'vitest'
const sdk = vi.hoisted(() => ({
  current: { access_token: 'cold-screen-token', user: { id: 'cold-screen-principal' } },
  getSession: vi.fn(),
  unsubscribe: vi.fn(),
  removeLifecycle: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  processLock: vi.fn(),
  createClient: () => ({
    auth: {
      getSession: sdk.getSession,
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: sdk.unsubscribe } },
      }),
      startAutoRefresh: () => Promise.resolve(),
      stopAutoRefresh: () => Promise.resolve(),
      signOut: () => Promise.resolve(),
    },
  }),
}))
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: () => Promise.resolve(null),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
}))
vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        supabaseUrl: 'https://identity.synthetic.test',
        supabaseAnonKey: 'synthetic-anon',
      },
    },
  },
}))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: sdk.removeLifecycle }),
    },
  }
})
vi.mock('expo-router', async () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: vi.fn(), push: vi.fn() }),
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('expo-haptics', () => ({ selectionAsync: () => Promise.resolve() }))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: vi.fn(),
    getDistinctId: () => 'cold-screen',
    screen: vi.fn(),
  }),
  MobileAnalyticsDiagnosticsPanel: () => null,
}))
vi.mock('@/src/lib/community', { spy: true })
vi.mock('socket.io-client', () => ({
  io: () => {
    const callbacks = new Map<string, () => void>()
    const socket = {
      on: (name: string, fn: () => void) => {
        callbacks.set(name, fn)
        return socket
      },
      connect: () => queueMicrotask(() => callbacks.get('connect')?.()),
      disconnect: () => undefined,
      removeAllListeners: () => callbacks.clear(),
    }
    return socket
  },
}))
import { act, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { delay, http, HttpResponse } from 'msw'
import { CommunityScreen } from '@/src/features/community/community-screen'
import { startNativeSession, nativeSessionIdentity } from '@/src/lib/native-session'
import { mobileApplicationUserId, resolveMobileAccessToken } from '@/src/lib/mobile-auth'
import * as community from '@/src/lib/community'
import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import { feedJson, item } from '@/src/test-utils/community-screen/harness'
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
beforeAll(async () => {
  vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', window.location.origin)
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  vi.stubEnv('EXPO_PUBLIC_E2E_AUTH_MODE', 'real')
  process.env.EXPO_PUBLIC_E2E_AUTH_MODE = 'real'
  await initI18n()
  await i18n.changeLanguage('en-US')
})
afterAll(() => vi.unstubAllEnvs())
it('T07 C01 cold initial screen suppliers recover without a false signed-out feed', async () => {
  sdk.getSession.mockImplementation(() =>
    Promise.resolve({ data: { session: sdk.current }, error: null })
  )
  server.use(
    http.get('*/api/v1/user/profile', () =>
      HttpResponse.json({ message: 'Dependency unavailable' }, { status: 503 })
    )
  )
  const cleanup = await startNativeSession()
  expect(nativeSessionIdentity()).toBeNull()
  const first = gate(),
    second = gate(),
    rest = gate(),
    feedSession = gate()
  let sessionCalls = 0
  sdk.getSession.mockImplementation(async () => {
    if (++sessionCalls === 1) await feedSession.promise
    return { data: { session: sdk.current }, error: null }
  })
  let profileCalls = 0
  const feedAuthorizations: boolean[] = []
  server.use(
    http.get('*/api/v1/user/profile', async ({ request }) => {
      const number = ++profileCalls
      expect(request.headers.has('authorization')).toBe(true)
      await (number === 1 ? first.promise : number === 2 ? second.promise : rest.promise)
      return HttpResponse.json({
        user: {
          id: 'cold-canonical-member',
          email: 'cold@synthetic.test',
          displayName: null,
          birthdate: null,
          role: 'guardian',
        },
        linkedGuardians: [],
        linkedTeens: [],
      })
    }),
    http.get('*/api/v1/community/feed', ({ request }) => {
      feedAuthorizations.push(
        request.headers.get('authorization') === `Bearer ${sdk.current.access_token}`
      )
      return feedJson({ items: [item()] })
    }),
    http.get('*/api/v1/community/events', () =>
      HttpResponse.json({
        data: {
          events: [],
          nextCursor: 'cold-cursor',
          hasMore: false,
          resyncRequired: false,
        },
      })
    ),
    http.post('*/api/v1/community/targets/resolve', async ({ request }) => {
      const body = (await request.json()) as { targets: { key: string }[] }
      return HttpResponse.json({
        data: {
          targets: body.targets.map((target) => ({
            key: target.key,
            status: 'available',
            communityRevision: '0',
            post: item({
              reactions: {
                counts: { applause: 0, love: 0, inspiration: 0 },
                total: 0,
                viewerReaction: null,
                revision: 0,
                generation: 0,
              },
            }),
            comment: null,
            parent: null,
            pageCursor: null,
            parentPageCursor: null,
            threadPosition: null,
          })),
        },
      })
    })
  )
  let unmount: (() => void) | undefined
  const outcomes: boolean[] = []
  const actual = await vi.importActual<typeof community>('@/src/lib/community')
  const pending: Promise<unknown>[] = []
  vi.mocked(community.getCommunityFeedFromMobile).mockImplementation((...args) => {
    const flight = actual.getCommunityFeedFromMobile(...args)
    pending.push(flight)
    void flight.then(
      () => outcomes.push(false),
      (error: unknown) =>
        outcomes.push(community.communityFailureReason(error) === 'signed_out')
    )
    return flight
  })
  try {
    const mounted = await render(<CommunityScreen />)
    unmount = () => mounted.unmount()
    await waitFor(() => expect(profileCalls).toBeGreaterThan(0))
    await waitFor(() =>
      expect(sdk.getSession.mock.calls.length).toBeGreaterThanOrEqual(3)
    )
    // Hold the first external SDK completion until the other canonical HTTP
    // request has started, then model a
    // 50ms provider response latency so both consumers are genuinely concurrent.
    feedSession.release()
    await delay(50)
    first.release()
    await waitFor(() => expect(outcomes.length > 0 || profileCalls >= 3).toBe(true))
    second.release()
    await waitFor(() => expect(outcomes.length).toBeGreaterThan(0))
    expect(outcomes.some(Boolean)).toBe(false)
    rest.release()
    await screen.findByTestId('community-post-card-post-a')
    expect(profileCalls).toBe(1)
    expect(nativeSessionIdentity()).toBe('cold-canonical-member')
    expect(mobileApplicationUserId()).toBe('cold-canonical-member')
    expect((await resolveMobileAccessToken()) === sdk.current.access_token).toBe(true)
    expect(feedAuthorizations.length).toBeGreaterThan(0)
    expect(feedAuthorizations.every(Boolean)).toBe(true)
  } finally {
    feedSession.release()
    first.release()
    second.release()
    rest.release()
    await act(async () => {
      await Promise.allSettled(pending)
    })
    unmount?.()
    cleanup()
  }
})

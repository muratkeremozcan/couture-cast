import type * as ReactNativeModule from 'react-native'
import React, { createElement, useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { ShareCardSource } from '@couture/api-client'
import { preparedShareCardFixture as card } from '@couture/api-client/testing/share-card-fixture'
import i18n, { initI18n } from '@/src/lib/i18n'
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
const boundary = vi.hoisted(() => {
  process.env.EXPO_OS = 'android'
  return {
    prepare: vi.fn(),
    permission: vi.fn(),
    save: vi.fn(),
    available: true,
    member: 'member-a' as string | null,
    subscribers: new Set<() => void>(),
    appState: new Set<(state: string) => void>(),
    focus: vi.fn(),
    announce: vi.fn(),
    settings: vi.fn(),
    imageLoads: [] as (() => void)[],
    dismissals: [] as (() => void)[],
    closeRequests: [] as (() => void)[],
  }
})
vi.mock('@/src/lib/share-card-save', () => ({
  nativeShareCardSaveAvailable: () => boundary.available,
  shareCardSavePermission: boundary.permission,
  saveShareCard: boundary.save,
}))
vi.mock('@/src/lib/accessibility-focus', () => ({
  safeFindNodeHandle: (node: HTMLElement | null) =>
    ({
      'share-card-title': 41,
      'share-card-save': 42,
      'share-card-retry': 43,
      'share-card-refresh': 43,
      'share-card-settings': 43,
      'share-card-cancel': 44,
    })[node?.getAttribute('data-testid') ?? ''] ?? 41,
}))
vi.mock('../modules/accessibility-focus', () => ({
  focusAccessibilityElement: (tag: number) => {
    boundary.focus(tag)
    return Promise.resolve(true)
  },
}))
vi.mock('./edge-to-edge-modal', () => ({
  useModalInsets: () => ({ top: 10, bottom: 10, left: 0, right: 0 }),
  EdgeToEdgeModal: ({
    visible,
    children,
    onShow,
    onDismiss,
    onRequestClose,
  }: {
    visible: boolean
    children: React.ReactNode
    onShow?: () => void
    onDismiss?: () => void
    onRequestClose?: () => void
  }) => {
    if (visible && onDismiss) boundary.dismissals.push(onDismiss)
    if (visible && onRequestClose) boundary.closeRequests.push(onRequestClose)
    useEffect(() => {
      if (visible) onShow?.()
      return () => {
        if (visible) onDismiss?.()
      }
    }, [visible])
    return visible ? createElement('div', { role: 'dialog' }, children) : null
  },
}))
vi.mock('react-native', async (original) => {
  const actual = await original<typeof ReactNativeModule>()
  return {
    ...actual,
    Platform: { ...actual.Platform, OS: 'android' },
    Image: ({
      testID,
      accessibilityLabel,
      onLoad,
      onError,
    }: {
      testID: string
      accessibilityLabel: string
      onLoad: () => void
      onError: () => void
    }) => {
      boundary.imageLoads.push(onLoad)
      return createElement('img', {
        'data-testid': testID,
        alt: accessibilityLabel,
        onLoad,
        onError,
      })
    },
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: boundary.focus,
      announceForAccessibilityWithOptions: boundary.announce,
    },
    Linking: { ...actual.Linking, openSettings: boundary.settings },
    AppState: {
      ...actual.AppState,
      currentState: 'active',
      addEventListener: (_event: string, listener: (state: string) => void) => {
        boundary.appState.add(listener)
        return { remove: () => boundary.appState.delete(listener) }
      },
    },
  }
})
vi.mock('@/src/lib/use-share-card-status-bar', () => ({
  useShareCardStatusBar: () => true,
}))
vi.mock('../modules/modal-system-bars', () => ({
  modalSystemBarsAvailable: () => false,
  setModalDarkStatusBar: () => undefined,
}))

const sdk = vi.hoisted(() => ({
  current: null as { access_token: string; user: { id: string } } | null,
  callbacks: new Set<(event: string, session: unknown) => void>(),
  starts: vi.fn(() => Promise.resolve()),
  stops: vi.fn(() => Promise.resolve()),
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
  getItemAsync: vi.fn(() => Promise.resolve(null)),
  setItemAsync: vi.fn(() => Promise.resolve()),
  deleteItemAsync: vi.fn(() => Promise.resolve()),
}))
vi.mock('@supabase/supabase-js', () => ({
  processLock: vi.fn(),
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: sdk.current }, error: null }),
      verifyOtp: () => Promise.resolve({ data: { session: sdk.current }, error: null }),
      signOut: () => Promise.resolve(),
      startAutoRefresh: sdk.starts,
      stopAutoRefresh: sdk.stops,
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        sdk.callbacks.add(callback)
        return {
          data: { subscription: { unsubscribe: () => sdk.callbacks.delete(callback) } },
        }
      },
    },
  }),
}))
import { http, HttpResponse } from 'msw'
import { server } from '@/src/test-utils/msw/server'
import { trackJsonBodies } from '@/src/test-utils/late-response'
import { mobileApplicationUserId } from '@/src/lib/mobile-auth'
import {
  signOutNativeSession,
  startNativeSession,
  verifyNativeOtp,
} from '@/src/lib/native-session'
import {
  AndroidShareCardPresentation,
  useShareCardPresentationOpener,
} from './android-share-card-presentation'
const sources = [
  { kind: 'outfit', recommendationId: 'owned-outfit' },
  { kind: 'community_post', postId: 'owned-post' },
] as const
function Export({ source }: { source: ShareCardSource }) {
  const open = useShareCardPresentationOpener()
  return (
    <button
      onClick={() => open(source, source.kind === 'outfit' ? 'outfit' : 'community')}
    >
      Export
    </button>
  )
}
function Host({ source }: { source: ShareCardSource }) {
  return (
    <AndroidShareCardPresentation pathname="/">
      <Export source={source} />
    </AndroidShareCardPresentation>
  )
}
const profile = {
  user: {
    id: 'verified-member-a',
    email: 'auth@synthetic.test',
    displayName: null,
    birthdate: '1990-01-01T00:00:00.000Z',
    role: 'teen',
  },
  linkedGuardians: [],
  linkedTeens: [],
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
async function ready() {
  await waitFor(() =>
    expect(screen.queryByText(i18n.t('shareCard.preparing'))).not.toBeInTheDocument()
  )
  fireEvent.load(await screen.findByTestId('share-card-preview'))
  await waitFor(() =>
    expect(screen.getByTestId('share-card-save')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  )
}
let cleanup: (() => void) | undefined
let requests: { bearer: string | null; input: unknown }[] = []
beforeEach(async () => {
  vi.stubGlobal('__DEV__', false)
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  await initI18n()
  await i18n.changeLanguage('en-US')
  await signOutNativeSession()
  sdk.current = { access_token: 'verified-token-a', user: { id: 'secure-principal-a' } }
  boundary.available = true
  boundary.permission.mockReset().mockResolvedValue({ granted: true, canAskAgain: true })
  boundary.save.mockReset().mockResolvedValue(undefined)
  requests = []
  server.use(
    http.get('*/api/v1/user/profile', () => HttpResponse.json(profile)),
    http.post('*/api/v1/share-cards/prepare', async ({ request }) => {
      const bearer = request.headers.get('authorization')
      requests.push({ bearer, input: await request.json() })
      return bearer === `Bearer ${sdk.current?.access_token}`
        ? HttpResponse.json({ data: card })
        : new HttpResponse(null, { status: 401 })
    })
  )
  await verifyNativeOtp('auth@synthetic.test', 'fixture-code')
})
afterEach(async () => {
  cleanup?.()
  cleanup = undefined
  await signOutNativeSession()
  vi.unstubAllGlobals()
})
describe('real native session and share composer root replacement', () => {
  it.each(sources)(
    'authenticates restored $kind before lifecycle reinstall across the dynamic bootstrap gap',
    async (source) => {
      const retire = await startNativeSession()
      const old = render(<Host source={source} />)
      await userEvent.click(screen.getByRole('button', { name: 'Export' }))
      await ready()
      await userEvent.click(screen.getByTestId('share-card-watermark'))
      await ready()
      old.unmount()
      retire()
      render(<Host source={source} />)
      // The successor root's dynamic native-session import has not run yet.
      await ready()
      expect(requests).toHaveLength(3)
      expect(requests.every(({ bearer }) => bearer === 'Bearer verified-token-a')).toBe(
        true
      )
      expect(requests.at(-1)?.input).toMatchObject({
        source,
        watermark: false,
        purpose: 'preview',
      })
      cleanup = await startNativeSession()
      expect(
        screen.queryByText(i18n.t('shareCard.sourceUnavailable'))
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('share-card-watermark')).toHaveAttribute(
        'aria-checked',
        'false'
      )
      expect(boundary.save).not.toHaveBeenCalled()
      expect(boundary.permission).not.toHaveBeenCalled()
    }
  )
  it('revalidation waits for the secure token and profile while old root teardown cannot invalidate the successor', async () => {
    const retire = await startNativeSession()
    const old = render(<Host source={sources[0]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await ready()
    sdk.current = {
      access_token: 'verified-token-refreshed',
      user: { id: 'secure-principal-a' },
    }
    const held = deferred<void>()
    let entered = false
    server.use(
      http.get('*/api/v1/user/profile', async () => {
        entered = true
        await held.promise
        return HttpResponse.json(profile)
      })
    )
    const successor = startNativeSession()
    try {
      render(<Host source={sources[0]} />)
      await waitFor(() => expect(entered).toBe(true))
      old.unmount()
      const stops = sdk.stops.mock.calls.length
      retire()
      expect(sdk.stops.mock.calls.length).toBe(stops)
      expect(screen.getByTestId('share-card-save')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      expect(requests).toHaveLength(1)
      held.resolve()
      cleanup = await successor
      await ready()
      expect(requests.at(-1)?.bearer).toBe('Bearer verified-token-refreshed')
      expect(mobileApplicationUserId()).toBe('verified-member-a')
      expect(boundary.save).not.toHaveBeenCalled()
    } finally {
      held.resolve()
      ;(await successor)()
      retire()
    }
  })

  it('a different secure principal during the root gap cannot adopt the former source', async () => {
    const retire = await startNativeSession()
    const old = render(<Host source={sources[1]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await ready()
    old.unmount()
    retire()
    sdk.current = { access_token: 'foreign-token-b', user: { id: 'secure-principal-b' } }
    server.use(
      http.get('*/api/v1/user/profile', () =>
        HttpResponse.json({
          ...profile,
          user: { ...profile.user, id: 'verified-member-b' },
        })
      )
    )
    render(<Host source={sources[1]} />)
    await waitFor(() => expect(mobileApplicationUserId()).toBe('verified-member-b'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(requests).toHaveLength(1)
    expect(boundary.save).not.toHaveBeenCalled()
  })
  it('signout while restored verification waits clears the presentation and rejects late bytes', async () => {
    const retire = await startNativeSession()
    const old = render(<Host source={sources[1]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await ready()
    old.unmount()
    retire()
    sdk.current = { access_token: 'later-token', user: { id: 'secure-principal-a' } }
    const held = deferred<void>()
    let entered = false
    server.use(
      http.get('*/api/v1/user/profile', async () => {
        entered = true
        await held.promise
        return HttpResponse.json(profile)
      })
    )
    render(<Host source={sources[1]} />)
    try {
      await waitFor(() => expect(entered).toBe(true))
      await act(async () => {
        await signOutNativeSession()
      })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      const late = trackJsonBodies('/api/v1/user/profile')
      held.resolve()
      await late.settled()
      expect(mobileApplicationUserId()).toBeNull()
      expect(screen.queryByTestId('share-card-preview-loaded')).not.toBeInTheDocument()
      expect(boundary.save).not.toHaveBeenCalled()
    } finally {
      held.resolve()
    }
  })
})

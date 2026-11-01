// Learning path Step 8: Shared analytics contracts and event tracking.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-8-shared-analytics-contracts-and-event-tracking
import { renderHook } from 'vitest-browser-react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { unhandledRejectionsDuring } from '@/src/test-utils/unhandled-rejections'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const {
  providerCaptureMock,
  providerScreenMock,
  providerGetDistinctIdMock,
  hookCaptureMock,
  hookScreenMock,
  hookGetDistinctIdMock,
  providerRenderSpy,
} = vi.hoisted(() => ({
  providerCaptureMock: vi.fn(),
  providerScreenMock: vi.fn(),
  providerGetDistinctIdMock: vi.fn(() => 'provider-user'),
  hookCaptureMock: vi.fn(),
  hookScreenMock: vi.fn(),
  hookGetDistinctIdMock: vi.fn(() => 'hook-user'),
  providerRenderSpy: vi.fn(),
}))
const hookPostHog = vi.hoisted(() => ({
  current: {
    capture: hookCaptureMock,
    screen: hookScreenMock,
    getDistinctId: hookGetDistinctIdMock,
  },
}))

vi.mock('../config/posthog', () => ({
  posthogProviderClient: {
    capture: providerCaptureMock,
    screen: providerScreenMock,
    getDistinctId: providerGetDistinctIdMock,
  },
}))

vi.mock('posthog-react-native', () => ({
  PostHogProvider: (props: {
    children: ReactNode
    client: unknown
    autocapture: unknown
  }) => {
    providerRenderSpy(props)
    return <>{props.children}</>
  },
  // The provider's context hands every render the same PostHog instance.
  usePostHog: () => hookPostHog.current,
}))

import {
  MobileAnalyticsProvider,
  createMobileAnalyticsClient,
  mobileAnalyticsClient,
  useMobileAnalytics,
} from './mobile-analytics'

describe('mobile analytics facade', () => {
  it('wraps a runtime client behind the repo-local contract', async () => {
    const capture = vi.fn()
    const screen = vi.fn()
    const getDistinctId = vi.fn(() => 'runtime-user')
    const client = createMobileAnalyticsClient({
      capture,
      screen,
      getDistinctId,
    })

    client.capture('tab_one_viewed', { source: 'test' })
    await client.screen('tab-one', { previous_screen: null })

    expect(capture).toHaveBeenCalledWith('tab_one_viewed', {
      source: 'test',
      locale: 'en-US',
    })
    expect(screen).toHaveBeenCalledWith('tab-one', {
      previous_screen: null,
      locale: 'en-US',
    })
    expect(client.getDistinctId()).toBe('runtime-user')
  })

  it('normalizes empty distinct ids to undefined', () => {
    const client = createMobileAnalyticsClient({
      capture: vi.fn(),
      screen: vi.fn(),
      getDistinctId: () => '',
    })

    expect(client.getDistinctId()).toBeUndefined()
  })

  it('adapts the provider-backed client once for app-level consumers', () => {
    mobileAnalyticsClient.capture('app_opened')

    expect(providerCaptureMock).toHaveBeenCalledWith('app_opened', {
      locale: 'en-US',
    })
    expect(mobileAnalyticsClient.getDistinctId()).toBe('provider-user')
  })

  it('provides the PostHog client through the repo-local provider wrapper', async () => {
    await renderHook(() => null, {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <MobileAnalyticsProvider>{children}</MobileAnalyticsProvider>
      ),
    })

    expect(providerRenderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        client: expect.objectContaining({
          capture: providerCaptureMock,
          screen: providerScreenMock,
          getDistinctId: providerGetDistinctIdMock,
        }),
      })
    )
  })

  it('adapts the vendor hook behind useMobileAnalytics', async () => {
    const { result } = await renderHook(() => useMobileAnalytics())

    result.current.capture('modal_opened')
    void result.current.screen('modal')

    expect(hookCaptureMock).toHaveBeenCalledWith('modal_opened', {
      locale: 'en-US',
    })
    expect(hookScreenMock).toHaveBeenCalledWith('modal', {
      locale: 'en-US',
    })
    expect(result.current.getDistinctId()).toBe('hook-user')
  })

  it('keeps one client across renders until the PostHog instance changes', async () => {
    // Screens list this client in effect dependencies, and test mocks of the hook mirror it
    // through mobileAnalyticsModuleMock in src/test-utils/mobile-analytics.ts.
    const initial = hookPostHog.current
    const { result, rerender } = await renderHook(() => useMobileAnalytics())
    const firstClient = result.current

    await rerender()
    expect(result.current).toBe(firstClient)

    hookPostHog.current = { ...initial }
    try {
      await rerender()
      expect(result.current).not.toBe(firstClient)
    } finally {
      hookPostHog.current = initial
    }
  })

  it('C-COMP-SHARE-ANALYTICS-DOWN: a provider throw or rejection never reaches the caller', async () => {
    // A plain function, never a vi.fn: see unhandledRejectionsDuring.
    let rejectedCalls = 0
    const rejected = () => {
      rejectedCalls += 1
      return Promise.reject(new Error('network down'))
    }
    const throwing = createMobileAnalyticsClient({
      capture: () => {
        throw new Error('sdk exploded')
      },
      screen: vi.fn(),
      getDistinctId: () => 'runtime-user',
    })
    const rejecting = createMobileAnalyticsClient({
      // Typed as void, but a provider may still hand back a rejecting promise.
      capture: rejected as () => void,
      screen: vi.fn(),
      getDistinctId: () => 'runtime-user',
    })
    expect(() => throwing.capture('share_card_shared', { client: 'ios' })).not.toThrow()
    const unhandled = await unhandledRejectionsDuring(() => {
      expect(() =>
        rejecting.capture('share_card_shared', { client: 'ios' })
      ).not.toThrow()
    })
    expect(rejectedCalls).toBe(1)
    expect(unhandled).toEqual([])
  })
})

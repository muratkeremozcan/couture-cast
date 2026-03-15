import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

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
  usePostHog: () => ({
    capture: hookCaptureMock,
    screen: hookScreenMock,
    getDistinctId: hookGetDistinctIdMock,
  }),
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

    expect(capture).toHaveBeenCalledWith('tab_one_viewed', { source: 'test' })
    expect(screen).toHaveBeenCalledWith('tab-one', { previous_screen: null })
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

    expect(providerCaptureMock).toHaveBeenCalledWith('app_opened', undefined)
    expect(mobileAnalyticsClient.getDistinctId()).toBe('provider-user')
  })

  it('provides the PostHog client through the repo-local provider wrapper', () => {
    renderHook(() => null, {
      wrapper: ({ children }) => (
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

  it('adapts the vendor hook behind useMobileAnalytics', () => {
    const { result } = renderHook(() => useMobileAnalytics())

    result.current.capture('modal_opened')
    void result.current.screen('modal')

    expect(hookCaptureMock).toHaveBeenCalledWith('modal_opened', undefined)
    expect(hookScreenMock).toHaveBeenCalledWith('modal', undefined)
    expect(result.current.getDistinctId()).toBe('hook-user')
  })
})

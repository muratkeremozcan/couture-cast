// Learning path Step 28: Accessibility hardening.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-28-accessibility-hardening
import type { PropsWithChildren } from 'react'
import type * as ReactNativeModule from 'react-native'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AccessibilityAnnouncerProvider,
  useAccessibilityAnnouncer,
} from '../hooks/use-accessibility-announcer'
import { useReducedMotion } from '../hooks/use-reduced-motion'

const accessibilityMocks = vi.hoisted(() => ({
  announceForAccessibility: vi.fn(),
  announceForAccessibilityWithOptions: vi.fn(),
  isReduceMotionEnabled: vi.fn(),
}))
const reduceMotionListeners = vi.hoisted(() => new Set<(value: boolean) => void>())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      const messages: Record<string, string> = {
        'accessibility.live_announcement_refresh': 'Daily guidance updated',
        'accessibility.live_announcement_swap': 'Garment swapped',
        'accessibility.live_announcement_chip_change': `Showing ${values?.chip ?? ''} recommendations`,
        'accessibility.live_announcement_alert': `Severe weather alert: ${values?.alert ?? ''}`,
      }
      return messages[key] ?? key
    },
  }),
}))

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    Platform: { ...actual.Platform, OS: 'ios' },
    AccessibilityInfo: {
      announceForAccessibility: accessibilityMocks.announceForAccessibility,
      announceForAccessibilityWithOptions:
        accessibilityMocks.announceForAccessibilityWithOptions,
      isReduceMotionEnabled: accessibilityMocks.isReduceMotionEnabled,
      addEventListener: vi.fn((_event: string, callback: (value: boolean) => void) => {
        reduceMotionListeners.add(callback)
        return { remove: () => reduceMotionListeners.delete(callback) }
      }),
    },
  }
})

function AnnouncerWrapper({ children }: PropsWithChildren) {
  return <AccessibilityAnnouncerProvider>{children}</AccessibilityAnnouncerProvider>
}

describe('mobile accessibility hardening', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    reduceMotionListeners.clear()
    accessibilityMocks.isReduceMotionEnabled.mockResolvedValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces polite announcements and uses the iOS queue', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncer(), {
      wrapper: AnnouncerWrapper,
    })

    act(() => {
      result.current.announce('refresh', 'Sunny')
      result.current.announce('swap', 'Wool coat')
      vi.advanceTimersByTime(80)
    })

    expect(accessibilityMocks.announceForAccessibilityWithOptions).toHaveBeenCalledOnce()
    expect(accessibilityMocks.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
      'Garment swapped: Wool coat',
      { queue: true }
    )
  })

  it('keeps an assertive alert when a polite event arrives in the same burst', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncer(), {
      wrapper: AnnouncerWrapper,
    })

    act(() => {
      result.current.announce('alert', 'Flood warning')
      result.current.announce('refresh', 'Sunny')
      vi.advanceTimersByTime(80)
    })

    expect(accessibilityMocks.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
      'Severe weather alert: Flood warning',
      { queue: false }
    )
  })

  it('deduplicates consecutive identical announcements', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncer(), {
      wrapper: AnnouncerWrapper,
    })

    act(() => {
      result.current.announce('swap', 'Wool coat')
      vi.advanceTimersByTime(80)
      result.current.announce('swap', 'Wool coat')
      vi.advanceTimersByTime(80)
    })

    expect(accessibilityMocks.announceForAccessibilityWithOptions).toHaveBeenCalledOnce()
  })

  it('defaults to reduced motion and resolves the system preference', async () => {
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current).toBe(false)
  })

  it('uses the latest event when the initial preference resolves late', async () => {
    let resolveInitial: ((value: boolean) => void) | undefined
    accessibilityMocks.isReduceMotionEnabled.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveInitial = resolve
      })
    )
    const { result } = renderHook(() => useReducedMotion())

    act(() => {
      for (const listener of reduceMotionListeners) {
        listener(false)
      }
    })
    await act(async () => {
      resolveInitial?.(true)
      await Promise.resolve()
    })
    expect(result.current).toBe(false)
  })

  it('keeps reduced motion enabled when the system query rejects', async () => {
    accessibilityMocks.isReduceMotionEnabled.mockRejectedValue(new Error('unavailable'))
    const { result } = renderHook(() => useReducedMotion())

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current).toBe(true)
  })
})

import type * as ReactNativeModule from 'react-native'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useReducedMotion } from './use-reduced-motion'

type ReduceMotionListener = (enabled: boolean) => void
type Subscription = { remove: () => void } | undefined

/** Held on a plain object so assertions never reference an unbound method. */
const accessibilityInfo = vi.hoisted(() => ({
  addEventListener:
    vi.fn<(event: string, listener: ReduceMotionListener) => Subscription>(),
  isReduceMotionEnabled: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    AccessibilityInfo: { ...actual.AccessibilityInfo, ...accessibilityInfo },
  }
})

/** A promise the test settles by hand, standing in for the OS query. */
function deferredPreference() {
  let settle!: { resolve: (enabled: boolean) => void; reject: (error: Error) => void }
  const promise = new Promise<boolean>((resolve, reject) => {
    settle = { resolve, reject }
  })
  accessibilityInfo.isReduceMotionEnabled.mockReturnValue(promise)
  return settle
}

/** The `reduceMotionChanged` callback the hook registered on mount. */
function registeredListener(): ReduceMotionListener {
  const call = accessibilityInfo.addEventListener.mock.calls.at(-1)
  return call?.[1] as ReduceMotionListener
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useReducedMotion', () => {
  beforeEach(() => {
    accessibilityInfo.addEventListener.mockReturnValue({ remove: vi.fn() })
  })

  /** Animating before the preference is known is the failure worth avoiding. */
  it('reports reduced motion until the system preference resolves', () => {
    deferredPreference()

    const { result } = renderHook(() => useReducedMotion())

    expect(result.current).toBe(true)
  })

  it('allows motion once the system reports the preference is off', async () => {
    const preference = deferredPreference()
    const { result } = renderHook(() => useReducedMotion())

    preference.resolve(false)
    await flush()

    expect(result.current).toBe(false)
  })

  it('follows a preference change made while the screen is open', async () => {
    const preference = deferredPreference()
    const { result } = renderHook(() => useReducedMotion())
    preference.resolve(false)
    await flush()

    act(() => registeredListener()(true))

    expect(result.current).toBe(true)
  })

  /**
   * The one-shot read and the change event race on a cold start. The event is
   * the newer truth, so a slow read must not overwrite it.
   */
  it('lets a preference change win over a slower initial read', async () => {
    const preference = deferredPreference()
    const { result } = renderHook(() => useReducedMotion())

    act(() => registeredListener()(false))
    preference.resolve(true)
    await flush()

    expect(result.current).toBe(false)
  })

  it('keeps motion reduced when the initial read fails', async () => {
    const preference = deferredPreference()
    const { result } = renderHook(() => useReducedMotion())

    preference.reject(new Error('accessibility bridge unavailable'))
    await flush()

    // Also the pre-resolution default: the point is that a failed read never
    // flips the preference open.
    expect(result.current).toBe(true)
  })

  it('lets a preference change win over a failing initial read', async () => {
    const preference = deferredPreference()
    const { result } = renderHook(() => useReducedMotion())

    act(() => registeredListener()(false))
    preference.reject(new Error('accessibility bridge unavailable'))
    await flush()

    expect(result.current).toBe(false)
  })

  it.each([
    ['resolves', (settle: { resolve: (v: boolean) => void }) => settle.resolve(false)],
    [
      'rejects',
      (settle: { reject: (error: Error) => void }) => settle.reject(new Error('gone')),
    ],
  ])('ignores an initial read that %s after unmount', async (_label, settleIt) => {
    const preference = deferredPreference()
    const { unmount } = renderHook(() => useReducedMotion())

    unmount()
    settleIt(preference)

    await expect(flush()).resolves.toBeUndefined()
  })

  it('ignores a preference change delivered after unmount', () => {
    deferredPreference()
    const { unmount } = renderHook(() => useReducedMotion())
    const listener = registeredListener()

    unmount()

    expect(() => listener(false)).not.toThrow()
  })

  it('removes its subscription on unmount', () => {
    const remove = vi.fn()
    accessibilityInfo.addEventListener.mockReturnValue({ remove })
    deferredPreference()
    const { unmount } = renderHook(() => useReducedMotion())

    unmount()

    expect(remove).toHaveBeenCalledOnce()
  })

  /** Some platforms return no subscription handle; unmount must still be safe. */
  it('unmounts cleanly when the platform returns no subscription handle', () => {
    accessibilityInfo.addEventListener.mockReturnValue(undefined)
    deferredPreference()
    const { unmount } = renderHook(() => useReducedMotion())

    expect(() => unmount()).not.toThrow()
  })
})

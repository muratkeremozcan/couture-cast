// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 builder test: 7.7-NAT-005, spec D6 (modals follow the OS reduced-motion setting).
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md.
import type * as ReactNativeModule from 'react-native'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useModalAnimation } from './use-modal-animation'

type ReduceMotionListener = (enabled: boolean) => void

const accessibilityInfo = vi.hoisted(() => ({
  addEventListener:
    vi.fn<
      (
        event: string,
        listener: ReduceMotionListener
      ) => { remove: () => void } | undefined
    >(),
  isReduceMotionEnabled: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    AccessibilityInfo: { ...actual.AccessibilityInfo, ...accessibilityInfo },
  }
})

async function settle() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useModalAnimation', () => {
  beforeEach(() => {
    accessibilityInfo.addEventListener.mockReturnValue({ remove: vi.fn() })
  })

  it.each(['slide', 'fade'] as const)(
    '7.7-NAT-005 keeps the %s presentation while reduced motion is off',
    async (motion) => {
      accessibilityInfo.isReduceMotionEnabled.mockResolvedValue(false)

      const { result } = renderHook(() => useModalAnimation(motion))
      await settle()

      expect(result.current).toBe(motion)
    }
  )

  it('7.7-NAT-005 is instant under the reduced-motion setting', async () => {
    accessibilityInfo.isReduceMotionEnabled.mockResolvedValue(true)

    const { result } = renderHook(() => useModalAnimation('slide'))
    await settle()

    expect(result.current).toBe('none')
  })

  it('7.7-NAT-005 is instant until the setting is known, and follows a change', () => {
    accessibilityInfo.isReduceMotionEnabled.mockReturnValue(new Promise(() => undefined))

    const { result } = renderHook(() => useModalAnimation('fade'))
    expect(result.current).toBe('none')

    const listener = accessibilityInfo.addEventListener.mock.calls.at(-1)?.[1]
    act(() => listener?.(false))
    expect(result.current).toBe('fade')
    act(() => listener?.(true))
    expect(result.current).toBe('none')
  })
})

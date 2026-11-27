// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { usePhotoBeforeExpiry } from './use-photo-before-expiry'

afterEach(() => vi.useRealTimers())

it('drops a displayed private photo at its expiry and accepts a fresh timestamp', () => {
  vi.useFakeTimers()
  const now = Date.parse('2026-11-20T15:00:00Z')
  vi.setSystemTime(now)
  const { result, rerender, unmount } = renderHook(usePhotoBeforeExpiry, {
    initialProps: now + 1000,
  })
  expect(result.current).toBe(true)
  act(() => {
    vi.advanceTimersByTime(999)
  })
  expect(result.current).toBe(true)
  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(result.current).toBe(false)
  rerender(now + 2000)
  expect(result.current).toBe(true)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('allows an undated legacy image and refuses already expired or invalid timestamps', () => {
  const { result, rerender } = renderHook(usePhotoBeforeExpiry, {
    initialProps: undefined as number | undefined,
  })
  expect(result.current).toBe(true)
  rerender(Date.now() - 1000)
  expect(result.current).toBe(false)
  rerender(Number.NaN)
  expect(result.current).toBe(false)
})

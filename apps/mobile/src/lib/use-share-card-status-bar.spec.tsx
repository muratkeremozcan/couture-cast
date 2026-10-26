import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const boundary = vi.hoisted(() => ({
  os: 'android',
  push: vi.fn(),
  pop: vi.fn(),
  frame: null as FrameRequestCallback | null,
  cancel: vi.fn(),
}))
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return boundary.os
    },
  },
  StatusBar: { pushStackEntry: boundary.push, popStackEntry: boundary.pop },
}))
import { useShareCardStatusBar } from './use-share-card-status-bar'
beforeEach(() => {
  boundary.os = 'android'
  boundary.push.mockReset().mockReturnValue({ barStyle: 'dark-content' })
  boundary.pop.mockReset()
  boundary.frame = null
  boundary.cancel.mockClear()
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
    boundary.frame = frame
    return 9
  })
  vi.stubGlobal('cancelAnimationFrame', boundary.cancel)
})
it('installs dark icons before the modal window mounts and restores the previous stack on every close/reopen', () => {
  const { result, rerender } = renderHook(({ open }) => useShareCardStatusBar(open), {
    initialProps: { open: true },
  })
  expect(result.current).toBe(false)
  expect(boundary.push).toHaveBeenCalledExactlyOnceWith({ barStyle: 'dark-content' })
  act(() => boundary.frame!(0))
  expect(result.current).toBe(true)
  rerender({ open: false })
  expect(result.current).toBe(false)
  expect(boundary.pop).toHaveBeenCalledExactlyOnceWith(
    boundary.push.mock.results[0]?.value
  )
  expect(boundary.cancel).toHaveBeenCalledWith(9)
  rerender({ open: true })
  expect(result.current).toBe(false)
  expect(boundary.push).toHaveBeenCalledTimes(2)
  act(() => boundary.frame!(0))
  expect(result.current).toBe(true)
})
it('leaves iOS system appearance to its native modal and cancels a pending Android open on unmount', () => {
  boundary.os = 'ios'
  const ios = renderHook(() => useShareCardStatusBar(true))
  expect(ios.result.current).toBe(true)
  expect(boundary.push).not.toHaveBeenCalled()
  ios.unmount()
  boundary.os = 'android'
  const android = renderHook(() => useShareCardStatusBar(true))
  android.unmount()
  expect(boundary.pop).toHaveBeenCalledOnce()
  expect(boundary.cancel).toHaveBeenCalledWith(9)
})
it('lets the attached native Dialog window own its system bar appearance without changing the Activity stack', () => {
  const { result, rerender } = renderHook(
    ({ open }) => useShareCardStatusBar(open, true),
    { initialProps: { open: true } }
  )
  expect(result.current).toBe(true)
  expect(boundary.push).not.toHaveBeenCalled()
  rerender({ open: false })
  expect(result.current).toBe(false)
  expect(boundary.pop).not.toHaveBeenCalled()
})

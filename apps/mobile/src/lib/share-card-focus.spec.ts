import { beforeEach, expect, it, vi } from 'vitest'
const bridge = vi.hoisted(() => ({ focus: vi.fn(), fallback: vi.fn() }))
vi.mock('react-native', () => ({
  AccessibilityInfo: { setAccessibilityFocus: bridge.fallback },
}))
vi.mock('../../modules/accessibility-focus', () => ({
  focusAccessibilityElement: bridge.focus,
}))
import { focusShareCardElement } from './share-card-focus'
// The fallback runs in a promise chain on the bridge result; one macrotask drains it,
// however many hops the chain has.
const drainBridgeChain = () => new Promise((resolve) => setTimeout(resolve, 0))
beforeEach(() => {
  bridge.focus.mockReset()
  bridge.fallback.mockReset()
})
it('uses the real native bridge and falls back only for an attached current target', async () => {
  bridge.focus.mockReturnValue(null)
  focusShareCardElement(41)
  expect(bridge.fallback).toHaveBeenCalledExactlyOnceWith(41)
  bridge.fallback.mockClear()
  bridge.focus.mockResolvedValue(true)
  focusShareCardElement(42)
  await drainBridgeChain()
  expect(bridge.fallback).not.toHaveBeenCalled()
  bridge.focus.mockRejectedValue(new Error('unavailable'))
  focusShareCardElement(43)
  await drainBridgeChain()
  expect(bridge.fallback).toHaveBeenCalledExactlyOnceWith(43)
})
it('drops a delayed fallback after close or identity replacement, including a return to the same member', async () => {
  let complete!: (value: boolean) => void
  bridge.focus.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        complete = resolve
      })
  )
  let generation = 1
  focusShareCardElement(41, () => generation === 1)
  generation = 3
  complete(false)
  await drainBridgeChain()
  expect(bridge.fallback).not.toHaveBeenCalled()
  bridge.focus.mockClear()
  focusShareCardElement(null)
  focusShareCardElement(42, () => false)
  expect(bridge.focus).not.toHaveBeenCalled()
})

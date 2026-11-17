// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import { beforeEach, expect, it, vi } from 'vitest'
const bridge = vi.hoisted(() => ({
  focus: vi.fn(),
  placement: vi.fn(),
  fallback: vi.fn(),
}))
vi.mock('react-native', () => ({
  AccessibilityInfo: { setAccessibilityFocus: bridge.fallback },
}))
vi.mock('../../modules/accessibility-focus', () => ({
  focusAccessibilityElement: bridge.focus,
  focusAccessibilityElementAfterPlacement: bridge.placement,
}))
import {
  focusShareCardElement,
  focusShareCardElementAfterPlacement,
} from './share-card-focus'
// The fallback runs in a promise chain on the bridge result; drainMacrotask settles it.
import { drainMacrotask } from '@/src/test-utils/drain-macrotask'
beforeEach(() => {
  bridge.focus.mockReset()
  bridge.placement.mockReset()
  bridge.fallback.mockReset()
})
it('uses the real native bridge and falls back only for an attached current target', async () => {
  bridge.focus.mockReturnValue(null)
  focusShareCardElement(41)
  expect(bridge.fallback).toHaveBeenCalledExactlyOnceWith(41)
  bridge.fallback.mockClear()
  bridge.focus.mockResolvedValue(true)
  focusShareCardElement(42)
  await drainMacrotask()
  expect(bridge.fallback).not.toHaveBeenCalled()
  bridge.focus.mockRejectedValue(new Error('unavailable'))
  focusShareCardElement(43)
  await drainMacrotask()
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
  await drainMacrotask()
  expect(bridge.fallback).not.toHaveBeenCalled()
  bridge.focus.mockClear()
  focusShareCardElement(null)
  focusShareCardElement(42, () => false)
  expect(bridge.focus).not.toHaveBeenCalled()
})
it('moves after TalkBack placement where the module offers it, and falls back only when that did not land', async () => {
  bridge.focus.mockResolvedValue(true)
  for (const outcome of ['focused', 'superseded'] as const) {
    bridge.placement.mockResolvedValueOnce(outcome)
    focusShareCardElementAfterPlacement(44)
    await drainMacrotask()
  }
  expect(bridge.placement.mock.calls).toEqual([[44], [44]])
  expect(bridge.focus).not.toHaveBeenCalled()
  expect(bridge.fallback).not.toHaveBeenCalled()
  for (const outcome of [
    'no_screen_reader',
    'no_target',
    'no_window_focus',
    'no_initial_placement',
    'not_held',
  ] as const) {
    bridge.placement.mockResolvedValueOnce(outcome)
    focusShareCardElementAfterPlacement(44)
    await drainMacrotask()
  }
  bridge.placement.mockRejectedValueOnce(new Error('unavailable'))
  focusShareCardElementAfterPlacement(45)
  await drainMacrotask()
  expect(bridge.focus.mock.calls).toEqual([[44], [44], [44], [44], [44], [45]])
  expect(bridge.fallback).not.toHaveBeenCalled()
})
it('without the placement call it is the single-shot move, and a stale or missing target moves nothing', async () => {
  bridge.placement.mockReturnValue(null)
  bridge.focus.mockResolvedValue(true)
  focusShareCardElementAfterPlacement(44)
  await drainMacrotask()
  expect(bridge.focus.mock.calls).toEqual([[44]])
  bridge.focus.mockClear()
  bridge.placement.mockReset()
  let complete!: (outcome: string) => void
  bridge.placement.mockReturnValue(
    new Promise<string>((resolve) => {
      complete = resolve
    })
  )
  let current = true
  focusShareCardElementAfterPlacement(44, () => current)
  current = false
  complete('no_initial_placement')
  await drainMacrotask()
  focusShareCardElementAfterPlacement(null)
  focusShareCardElementAfterPlacement(46, () => false)
  expect(bridge.placement.mock.calls).toEqual([[44]])
  expect(bridge.focus).not.toHaveBeenCalled()
  expect(bridge.fallback).not.toHaveBeenCalled()
})

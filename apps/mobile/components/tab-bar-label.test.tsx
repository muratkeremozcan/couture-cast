// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i: the bottom tab bar grows with its labels, and a label wider than its tab
// shrinks to fit instead of ellipsizing.
import type * as ReactNative from 'react-native'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ props: [] as ReactNative.TextProps[] }))
vi.mock('react-native', async (original) => {
  const actual = await original<typeof ReactNative>()
  const { forwardRef, createElement } = await import('react')
  return {
    ...actual,
    Text: forwardRef<ReactNative.Text, ReactNative.TextProps>((props, ref) => {
      captured.props.push(props)
      return createElement(actual.Text, { ...props, ref })
    }),
  }
})

import { TAB_LABEL_MIN_SCALE, TabBarLabel, tabBarGrowth } from './tab-bar-label'

describe('6.15 tab bar label', () => {
  it('6.15-MOB-TAB-01 keeps the bar at its default height at or below the default text size', () => {
    expect(tabBarGrowth([14, 14.1], 1)).toBe(0)
    expect(tabBarGrowth([14], 0.85)).toBe(0)
    expect(tabBarGrowth([14], Number.NaN)).toBe(0)
    expect(tabBarGrowth([], 2)).toBe(0)
  })

  it('6.15-MOB-TAB-02 grows the bar by what the tallest label grew', () => {
    // A 28 high label at 2.0 was 14 at the default size: the bar grows by 14.
    expect(tabBarGrowth([20, 28, 0], 2)).toBe(14)
    expect(tabBarGrowth([21], 1.5)).toBe(7)
  })

  it('6.15-MOB-TAB-03 draws one centred 10 pt line that shrinks to fit and reports its height', async () => {
    captured.props.length = 0
    const onHeight = vi.fn()
    render(
      <TabBarLabel color="rgb(1, 2, 3)" onHeight={onHeight}>
        Community
      </TabBarLabel>
    )
    const label = screen.getByText('Community')
    expect(getComputedStyle(label).fontSize).toBe('10px')
    expect(getComputedStyle(label).textAlign).toBe('center')
    expect(getComputedStyle(label).color).toBe('rgb(1, 2, 3)')
    const props = captured.props.find((entry) => entry.children === 'Community')!
    expect(props.numberOfLines).toBe(1)
    expect(props.adjustsFontSizeToFit).toBe(true)
    expect(props.minimumFontScale).toBe(TAB_LABEL_MIN_SCALE)
    await waitFor(() =>
      expect(onHeight).toHaveBeenCalledWith('Community', expect.any(Number))
    )
    expect(onHeight.mock.calls.at(-1)?.[1]).toBeGreaterThan(0)
  })
})

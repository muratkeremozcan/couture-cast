// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i: the bottom tab bar grows with its labels, and a label wider than its tab
// shrinks to fit instead of ellipsizing.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 (TEA): D3 (P6, P7) floors the shrink at 12 rendered px and lets a label that still
// does not fit wrap to two lines, so at the default text size a 12 px label never shrinks; the
// active label is semibold. The full locale sweep is five-tab-label-floor.test.tsx (7.11-NAT-004).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import type * as ReactNative from 'react-native'
import { act, render, screen, waitFor } from '@testing-library/react'
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

import { StyleSheet } from 'react-native'
import {
  nextTabLabelFit,
  recordTabLabelHeight,
  TAB_LABEL_MIN_SCALE,
  TabBarLabel,
  tabBarGrowth,
  tallestTabLabel,
} from './tab-bar-label'

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

  it('6.15-MOB-TAB-03 draws a centred 12 pt label that is never cut and reports its height', async () => {
    captured.props.length = 0
    const onHeight = vi.fn()
    render(
      <TabBarLabel color="rgb(1, 2, 3)" onHeight={onHeight}>
        Community
      </TabBarLabel>
    )
    const label = screen.getByText('Community')
    expect(getComputedStyle(label).fontSize).toBe('12px')
    expect(getComputedStyle(label).textAlign).toBe('center')
    expect(getComputedStyle(label).color).toBe('rgb(1, 2, 3)')
    const props = captured.props.find((entry) => entry.children === 'Community')!
    // r45 P2-4: Fabric Android drops minimumFontScale, so adjustsFontSizeToFit could shrink a
    // label toward 4 dp. The label fits itself from its own text layout. CC-7.11 D3 (P7): at its
    // 12 px floor a label wraps to two lines at most, with no ellipsis mode of its own.
    expect(props.numberOfLines).toBe(2)
    expect(props.ellipsizeMode).toBeUndefined()
    expect(props.adjustsFontSizeToFit).toBeUndefined()
    expect(props.onTextLayout).toEqual(expect.any(Function))
    await waitFor(() =>
      expect(onHeight).toHaveBeenCalledWith('Community', expect.any(Number), 'below-icon')
    )
    expect(onHeight.mock.calls.at(-1)?.[1]).toBeGreaterThan(0)
  })
})

describe('6.15 tab bar label line box', () => {
  it('6.15-MOB-TAB-04 keeps heights per text scale and drops them when the scale changes', () => {
    let state = recordTabLabelHeight({ fontScale: 2, heights: {} }, 2, 'Home', 27)
    state = recordTabLabelHeight(state, 2, 'Community', 24)
    expect(tallestTabLabel(state, 2)).toBe(27)
    // The same report again keeps the same state, so a layout pass cannot loop.
    expect(recordTabLabelHeight(state, 2, 'Home', 27)).toBe(state)
    // After a change to 1.0 the 2.0 heights are stale: nothing until a label reports again.
    expect(tallestTabLabel(state, 1)).toBeUndefined()
    state = recordTabLabelHeight(state, 1, 'Home', 14)
    expect(state.heights).toEqual({ Home: 14 })
    expect(tallestTabLabel(state, 1)).toBe(14)
  })

  it('6.15-MOB-TAB-05 holds the line box at the tallest height with the label at its bottom', () => {
    captured.props.length = 0
    render(
      <TabBarLabel color="rgb(1, 2, 3)" onHeight={vi.fn()} lineBoxHeight={27}>
        Community
      </TabBarLabel>
    )
    const label = screen.getByText('Community')
    const lineBox = label.parentElement!
    expect(getComputedStyle(lineBox).minHeight).toBe('27px')
    expect(getComputedStyle(lineBox).justifyContent).toBe('flex-end')
    // The text keeps its own height: textAlignVertical on a held text view drew a shrunk label
    // above its own box on Android 2.0.
    const props = captured.props.find((entry) => entry.children === 'Community')!
    const style = StyleSheet.flatten(props.style)
    expect(style.minHeight).toBeUndefined()
    expect(style.textAlignVertical).toBeUndefined()
    expect(label.getBoundingClientRect().bottom).toBeCloseTo(
      lineBox.getBoundingClientRect().bottom,
      0
    )
  })
})

describe('6.15 tab bar label fit and position', () => {
  it('6.15-MOB-TAB-06 shrinks a wrapped label by its overflow, never below half its size', () => {
    // One line fits: the factor stays.
    expect(nextTabLabelFit(1, [120])).toBe(1)
    // Two lines of 100 and 20 in a 100 wide tab: 120 natural, shrink to 100/120 with slack.
    expect(nextTabLabelFit(1, [100, 20])).toBeCloseTo((100 / 120) * 0.98, 5)
    // A label that would need a third of its size is held at half and stays wrapped, never cut.
    expect(nextTabLabelFit(1, [100, 100, 100])).toBe(TAB_LABEL_MIN_SCALE)
    expect(nextTabLabelFit(TAB_LABEL_MIN_SCALE, [100, 100, 100])).toBe(
      TAB_LABEL_MIN_SCALE
    )
  })

  it('6.15-MOB-TAB-07 [7.11 D3] keeps a wrapped 12 pt label at 12 px at the default text size, on two lines', () => {
    captured.props.length = 0
    render(
      <TabBarLabel color="rgb(1, 2, 3)" onHeight={vi.fn()}>
        Community
      </TabBarLabel>
    )
    const first = captured.props.findLast((entry) => entry.children === 'Community')!
    act(() =>
      first.onTextLayout!({
        nativeEvent: { lines: [{ width: 100 }, { width: 20 }] },
      } as never)
    )
    // Before CC-7.11 this shrank to 12 * (100 / 120) * 0.98 px; the floor now holds 12 px and
    // the label wraps instead.
    expect(getComputedStyle(screen.getByText('Community')).fontSize).toBe('12px')
    expect(
      captured.props.findLast((entry) => entry.children === 'Community')!.numberOfLines
    ).toBe(2)
  })

  it('[7.11-NAT-003] [7.11 D3, P6] draws the active label semibold and an inactive one medium', () => {
    render(
      <>
        <TabBarLabel color="rgb(1, 2, 3)" onHeight={vi.fn()} focused>
          Closet
        </TabBarLabel>
        <TabBarLabel color="rgb(1, 2, 3)" onHeight={vi.fn()}>
          Looks
        </TabBarLabel>
      </>
    )
    expect(getComputedStyle(screen.getByText('Closet')).fontWeight).toBe('600')
    expect(getComputedStyle(screen.getByText('Looks')).fontWeight).toBe('500')
  })

  it('6.15-MOB-TAB-08 draws a label beside its icon the way React Navigation does', () => {
    render(
      <TabBarLabel color="rgb(1, 2, 3)" onHeight={vi.fn()} position="beside-icon">
        Settings
      </TabBarLabel>
    )
    const label = getComputedStyle(screen.getByText('Settings'))
    expect(label.fontSize).toBe('14px')
    expect(label.lineHeight).toBe('24px')
    expect(label.marginInlineStart).toBe('4px')
    expect(label.marginInlineEnd).toBe('12px')
  })
})

describe('6.15 tab bar sizing (r46)', () => {
  it('6.15-MOB-TAB-10 [7.11 D3] shrinks a beside-icon label with its line height, only down to 12 px, and lets it shrink in its row', () => {
    captured.props.length = 0
    render(
      <TabBarLabel color="rgb(1, 2, 3)" onHeight={vi.fn()} position="beside-icon">
        Community
      </TabBarLabel>
    )
    const first = captured.props.findLast((entry) => entry.children === 'Community')!
    act(() =>
      first.onTextLayout!({
        nativeEvent: { lines: [{ width: 100 }, { width: 20 }] },
      } as never)
    )
    const label = getComputedStyle(screen.getByText('Community'))
    // The overflow asks for 14 * (100 / 120) * 0.98 = 11.4 px; the D3 floor stops it at 12 px,
    // and the line height shrinks by the same factor.
    const fit = 12 / 14
    expect(Number.parseFloat(label.fontSize)).toBeCloseTo(12, 1)
    expect(Number.parseFloat(label.lineHeight)).toBeCloseTo(24 * fit, 1)
    const props = captured.props.findLast((entry) => entry.children === 'Community')!
    expect(StyleSheet.flatten(props.style).flexShrink).toBe(1)
  })

  it('6.15-MOB-TAB-12 centres a beside-icon label on its icon and lets its line box shrink', () => {
    render(
      <TabBarLabel
        color="rgb(1, 2, 3)"
        onHeight={vi.fn()}
        position="beside-icon"
        lineBoxHeight={30}
      >
        Settings
      </TabBarLabel>
    )
    const lineBox = getComputedStyle(screen.getByText('Settings').parentElement!)
    expect(lineBox.justifyContent).toBe('center')
    expect(lineBox.flexShrink).toBe('1')
  })
})

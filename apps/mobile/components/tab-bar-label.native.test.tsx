// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 r46: on a native platform a tab label reports its height only once it has settled,
// and a new text, scale or position starts unsettled again.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 (TEA): the labels read Today and Community (D1); at text scale 2 on Android a
// wrapped label shrinks only to its 12 rendered px floor (D3, P7).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import type * as ReactNative from 'react-native'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ props: [] as ReactNative.TextProps[] }))
vi.mock('react-native', async (original) => {
  const actual = await original<typeof ReactNative>()
  const { forwardRef, createElement } = await import('react')
  return {
    ...actual,
    Platform: { ...actual.Platform, OS: 'android' },
    useWindowDimensions: () => ({ width: 400, height: 800, scale: 2.625, fontScale: 2 }),
    Text: forwardRef<ReactNative.Text, ReactNative.TextProps>((props, ref) => {
      captured.props.push(props)
      return createElement(actual.Text, { ...props, ref })
    }),
  }
})

import { StyleSheet } from 'react-native'
import { TabBarLabel, useTabBarSizing } from './tab-bar-label'

const latest = (text: string) =>
  captured.props.findLast((entry) => entry.children === text)!
const layout = (props: ReactNative.TextProps, height: number) =>
  act(() => props.onLayout!({ nativeEvent: { layout: { height } } } as never))
const oneLine = (props: ReactNative.TextProps) =>
  act(() => props.onTextLayout!({ nativeEvent: { lines: [{ width: 50 }] } } as never))

describe('6.15 tab bar label on a native platform', () => {
  it('6.15-MOB-TAB-11 reports again only after a changed label settles', () => {
    captured.props.length = 0
    const onHeight = vi.fn()
    const view = render(
      <TabBarLabel color="rgb(1, 2, 3)" onHeight={onHeight}>
        Today
      </TabBarLabel>
    )
    // Unsettled: a layout before the text layout reports nothing.
    layout(latest('Today'), 40)
    expect(onHeight).not.toHaveBeenCalled()
    oneLine(latest('Today'))
    expect(onHeight).toHaveBeenLastCalledWith('Today', 40, 'below-icon')

    view.rerender(
      <TabBarLabel color="rgb(1, 2, 3)" onHeight={onHeight}>
        Community
      </TabBarLabel>
    )
    onHeight.mockClear()
    // A new text starts unsettled: its first layout, which may be wrapped, is not reported.
    layout(latest('Community'), 80)
    expect(onHeight).not.toHaveBeenCalled()
    oneLine(latest('Community'))
    expect(onHeight).toHaveBeenLastCalledWith('Community', 80, 'below-icon')
  })

  it('6.15-MOB-TAB-09 drops the underline with the bar only below the icon', () => {
    let sizing: ReturnType<typeof useTabBarSizing> | undefined
    function Probe() {
      sizing = useTabBarSizing()
      return null
    }
    render(<Probe />)
    // At 2.0 a 28 high label grew 14: the bar grows 14 and, below the icon, the underline too.
    act(() => sizing!.onLabelHeight('Today', 28, 'below-icon'))
    expect(sizing!.growth).toBe(14)
    expect(sizing!.indicatorDrop).toBe(14)
    // Beside the icon the bar still fits the label, but the underline stays put.
    act(() => sizing!.onLabelHeight('Today', 28, 'beside-icon'))
    expect(sizing!.growth).toBe(14)
    expect(sizing!.indicatorDrop).toBe(0)
  })

  it('[7.11-NAT-004] at text scale 2 shrinks a wrapped label to 12 rendered px and no further, on two lines', () => {
    captured.props.length = 0
    render(
      <TabBarLabel color="rgb(1, 2, 3)" onHeight={vi.fn()}>
        Community
      </TabBarLabel>
    )
    // A label three times wider than its tab asks for a third of its size; the floor at scale 2
    // is half of 12 px, which the device draws at 12 px.
    for (let pass = 0; pass < 3; pass += 1)
      act(() =>
        latest('Community').onTextLayout!({
          nativeEvent: { lines: [{ width: 100 }, { width: 100 }, { width: 100 }] },
        } as never)
      )
    const props = latest('Community')
    const fontSize = Number(StyleSheet.flatten(props.style).fontSize)
    expect(fontSize).toBe(6)
    expect(fontSize * 2).toBe(12)
    expect(props.numberOfLines).toBe(2)
  })

  it('6.15-MOB-TAB-13 never reports the previous label height after a change', () => {
    captured.props.length = 0
    const onHeight = vi.fn()
    const view = render(
      <TabBarLabel color="rgb(1, 2, 3)" onHeight={onHeight}>
        Today
      </TabBarLabel>
    )
    layout(latest('Today'), 40)
    oneLine(latest('Today'))
    view.rerender(
      <TabBarLabel color="rgb(1, 2, 3)" onHeight={onHeight}>
        Community
      </TabBarLabel>
    )
    onHeight.mockClear()
    // The text layout settles before this label's own layout: Home's 40 must not be reported.
    oneLine(latest('Community'))
    expect(onHeight).not.toHaveBeenCalled()
    layout(latest('Community'), 80)
    expect(onHeight).toHaveBeenLastCalledWith('Community', 80, 'below-icon')
  })
})

// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 r46: on a native platform a tab label reports its height only once it has settled,
// and a new text, scale or position starts unsettled again.
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
        Home
      </TabBarLabel>
    )
    // Unsettled: a layout before the text layout reports nothing.
    layout(latest('Home'), 40)
    expect(onHeight).not.toHaveBeenCalled()
    oneLine(latest('Home'))
    expect(onHeight).toHaveBeenLastCalledWith('Home', 40, 'below-icon')

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
    act(() => sizing!.onLabelHeight('Home', 28, 'below-icon'))
    expect(sizing!.growth).toBe(14)
    expect(sizing!.indicatorDrop).toBe(14)
    // Beside the icon the bar still fits the label, but the underline stays put.
    act(() => sizing!.onLabelHeight('Home', 28, 'beside-icon'))
    expect(sizing!.growth).toBe(14)
    expect(sizing!.indicatorDrop).toBe(0)
  })

  it('6.15-MOB-TAB-13 never reports the previous label height after a change', () => {
    captured.props.length = 0
    const onHeight = vi.fn()
    const view = render(
      <TabBarLabel color="rgb(1, 2, 3)" onHeight={onHeight}>
        Home
      </TabBarLabel>
    )
    layout(latest('Home'), 40)
    oneLine(latest('Home'))
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

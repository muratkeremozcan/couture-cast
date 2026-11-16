// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// React Native 0.81 lays text out once per paragraph and keeps it through a live text size
// change (iOS dispatch 43815625762: the composer title stayed 31 pt where a cold launch at the
// new size measures 42). A paragraph lays out again when its props change, so every outermost
// Text carries a font-scale dependent maxFontSizeMultiplier no text ever reaches.
import {
  createContext,
  createElement,
  createRef,
  forwardRef,
  useEffect,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Text as NativeText, useWindowDimensions } from 'react-native'
import { createFontScaleText, remeasureCap } from './font-scale-text'

const seen = {
  texts: [] as { children: unknown; maxFontSizeMultiplier?: number }[],
  fontScale: 1,
  listeners: new Set<() => void>(),
}

/** react-native's TextAncestorContext: true inside a Text, reset to false by a View. */
const TextAncestor = createContext(false)

/**
 * react-native's Text as the shim hands it over: records the props each render receives, and
 * marks its children as inside a paragraph, as react-native's Text does.
 */
const Text = forwardRef(function Text(
  props: { children?: ReactNode; maxFontSizeMultiplier?: number },
  ref: Ref<HTMLSpanElement>
) {
  seen.texts.push({
    children: typeof props.children === 'string' ? props.children : 'nested',
    maxFontSizeMultiplier: props.maxFontSizeMultiplier,
  })
  return createElement(
    TextAncestor.Provider,
    { value: true },
    createElement('span', { ref }, props.children)
  )
}) as unknown as typeof NativeText

/** react-native's View: a Text inside it starts a paragraph of its own. */
const View = ({ children }: { children?: ReactNode }) =>
  createElement(
    TextAncestor.Provider,
    { value: false },
    createElement('div', null, children)
  )

/** useWindowDimensions with a font scale the test changes, as a live text size change does. */
const useDimensions = (() => {
  const [, rerender] = useState(0)
  useEffect(() => {
    const listener = () => rerender((n) => n + 1)
    seen.listeners.add(listener)
    return () => {
      seen.listeners.delete(listener)
    }
  }, [])
  return { width: 402, height: 874, scale: 3, fontScale: seen.fontScale }
}) as typeof useWindowDimensions

const FontScaleText = createFontScaleText(Text, useDimensions, TextAncestor)

function setFontScale(fontScale: number) {
  seen.fontScale = fontScale
  act(() => seen.listeners.forEach((listener) => listener()))
}

beforeEach(() => {
  seen.texts.length = 0
  seen.fontScale = 1
})

describe('remeasureCap', () => {
  it('gives a cap no text reaches, different at each font scale', () => {
    const scales = [0.823, 1, 1.353, 1.786, 3.12]
    const caps = scales.map((scale) => remeasureCap(undefined, scale))
    expect(new Set(caps).size).toBe(scales.length)
    for (const cap of caps) expect(cap).toBeGreaterThan(50)
    // 0 and null mean no cap, like undefined.
    expect(remeasureCap(0, 1.353)).toBe(remeasureCap(undefined, 1.353))
    expect(remeasureCap(null, 1.353)).toBe(remeasureCap(undefined, 1.353))
  })

  it("keeps a caller's own cap within a millionth, still different at each font scale", () => {
    const capped = [1, 1.353, 1.786].map((scale) => remeasureCap(1.5, scale))
    expect(new Set(capped).size).toBe(3)
    for (const cap of capped) expect(Math.abs(cap - 1.5)).toBeLessThan(1e-5)
  })
})

describe('FontScaleText', () => {
  it('changes the outermost Text props when the font scale changes, and only those', () => {
    render(
      <FontScaleText>
        Outer
        <FontScaleText>Inner</FontScaleText>
      </FontScaleText>
    )
    const first = seen.texts.find((text) => text.children === 'nested')
    expect(first?.maxFontSizeMultiplier).toBe(remeasureCap(undefined, 1))
    expect(
      seen.texts.find((text) => text.children === 'Inner')?.maxFontSizeMultiplier
    ).toBe(undefined)
    seen.texts.length = 0
    setFontScale(1.353)
    const outer = seen.texts.filter((text) => text.children === 'nested')
    expect(outer.at(-1)?.maxFontSizeMultiplier).toBe(remeasureCap(undefined, 1.353))
    expect(outer.at(-1)?.maxFontSizeMultiplier).not.toBe(first?.maxFontSizeMultiplier)
    // A nested Text inherits from its paragraph: it is laid out with it, and a cap of its own
    // would override one the paragraph sets.
    expect(
      seen.texts
        .filter((text) => text.children === 'Inner')
        .map((text) => text.maxFontSizeMultiplier)
    ).toEqual(seen.texts.filter((text) => text.children === 'Inner').map(() => undefined))
  })

  // CodeRabbit on PR 242: react-native resets its paragraph context at a View, so a Text inside a
  // View inside a Text is a paragraph of its own and needs its own changing cap.
  it('gives a Text behind a View inside a Text a cap of its own', () => {
    render(
      <FontScaleText>
        Outer
        <View>
          <FontScaleText>Boxed</FontScaleText>
        </View>
      </FontScaleText>
    )
    expect(
      seen.texts.find((text) => text.children === 'Boxed')?.maxFontSizeMultiplier
    ).toBe(remeasureCap(undefined, 1))
    seen.texts.length = 0
    setFontScale(1.353)
    expect(
      seen.texts.filter((text) => text.children === 'Boxed').at(-1)?.maxFontSizeMultiplier
    ).toBe(remeasureCap(undefined, 1.353))
  })

  it("keeps the caller's cap and forwards the ref", () => {
    const ref = createRef<HTMLSpanElement>()
    render(
      <FontScaleText ref={ref as never} maxFontSizeMultiplier={1.5}>
        Capped
      </FontScaleText>
    )
    expect(seen.texts.at(-1)?.maxFontSizeMultiplier).toBe(remeasureCap(1.5, 1))
    expect(ref.current?.textContent).toBe('Capped')
  })
})

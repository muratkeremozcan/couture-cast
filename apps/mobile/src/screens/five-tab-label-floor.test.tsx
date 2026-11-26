// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-NAT-004 (P7, spec D3): every tab label of every mobile
// locale, active and inactive, at text scale 1 and 2 in a tab of the smallest supported phone
// (360 dp / 5 tabs), renders at 12 px or more, on at most two lines, never cut.
// The browser has no text scale and no text layout event, so the test plays the device: a
// label at scale `s` in a 72 dp tab lays out like the CSS label in a 72 / s px box (the device
// draws every px `s` times larger), and the label's own `onTextLayout` is fed the line widths
// the browser laid out, until its fit settles, as a device's layout passes would.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import type * as ReactNative from 'react-native'
import { act, render, screen } from '@testing-library/react'
import { APP_TABS } from '@couture/utils'
import { describe, expect, it, vi } from 'vitest'

const device = vi.hoisted(() => ({ fontScale: 1 }))
const captured = vi.hoisted(() => ({ props: [] as ReactNative.TextProps[] }))
vi.mock('react-native', async (original) => {
  const actual = await original<typeof ReactNative>()
  const { forwardRef, createElement } = await import('react')
  return {
    ...actual,
    useWindowDimensions: () => ({
      width: 360,
      height: 640,
      scale: 3,
      fontScale: device.fontScale,
    }),
    Text: forwardRef<ReactNative.Text, ReactNative.TextProps>((props, ref) => {
      captured.props.push(props)
      return createElement(actual.Text, { ...props, ref })
    }),
  }
})

import { View } from 'react-native'
import deDE from '../../assets/locales/de-DE.json'
import enCA from '../../assets/locales/en-CA.json'
import enUS from '../../assets/locales/en-US.json'
import es419 from '../../assets/locales/es-419.json'
import frCA from '../../assets/locales/fr-CA.json'
import frFR from '../../assets/locales/fr-FR.json'
import itIT from '../../assets/locales/it-IT.json'
import ptBR from '../../assets/locales/pt-BR.json'
import ptPT from '../../assets/locales/pt-PT.json'
import trTR from '../../assets/locales/tr-TR.json'
import {
  TAB_LABEL_MAX_LINES,
  TAB_LABEL_MIN_PX,
  TabBarLabel,
  tabLabelFitFloor,
} from '@/components/tab-bar-label'

const CATALOGS = {
  'en-US': enUS,
  'en-CA': enCA,
  'de-DE': deDE,
  'es-419': es419,
  'fr-CA': frCA,
  'fr-FR': frFR,
  'it-IT': itIT,
  'pt-BR': ptBR,
  'pt-PT': ptPT,
  'tr-TR': trTR,
} as const

/** P7: the smallest supported phone is 360 dp wide, and the bar holds five equal tabs. */
const TAB_WIDTH_DP = 360 / APP_TABS.length

/** The laid-out width of each line of `element`'s text, top to bottom. */
function lineWidths(element: HTMLElement): number[] {
  const range = document.createRange()
  range.selectNodeContents(element)
  const lines = new Map<number, number>()
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width <= 0) continue
    const top = Math.round(rect.top)
    lines.set(top, (lines.get(top) ?? 0) + rect.width)
  }
  return [...lines.entries()].sort(([a], [b]) => a - b).map(([, width]) => width)
}

const latest = (text: string) =>
  captured.props.findLast((entry) => entry.children === text)!

/** Feeds the label its own layout until its fit stops changing (at most ten passes). */
function settle(text: string) {
  const element = () => screen.getByText(text)
  for (let pass = 0; pass < 10; pass += 1) {
    const before = getComputedStyle(element()).fontSize
    const lines = lineWidths(element()).map((width) => ({ width }))
    act(() => latest(text).onTextLayout!({ nativeEvent: { lines } } as never))
    if (getComputedStyle(element()).fontSize === before) break
  }
  return element()
}

const CASES = Object.entries(CATALOGS).flatMap(([locale, catalog]) =>
  APP_TABS.flatMap((tab) =>
    [1, 2].map(
      (fontScale) =>
        [
          locale,
          (catalog.tabs as Record<string, string>)[tab.labelKey]!,
          fontScale,
        ] as const
    )
  )
)

describe('7.11-NAT-004 tab label floor', () => {
  it('[P1] [7.11-NAT-004] the fit floor renders 12 px at every text scale and never grows a label', () => {
    expect(TAB_LABEL_MIN_PX).toBe(12)
    expect(TAB_LABEL_MAX_LINES).toBe(2)
    // At the default scale a 12 px label never shrinks; at 2.0 it may shrink to half.
    expect(tabLabelFitFloor(12, 1)).toBe(1)
    expect(tabLabelFitFloor(12, 2)).toBe(0.5)
    expect(12 * tabLabelFitFloor(12, 2) * 2).toBe(12)
    expect(tabLabelFitFloor(14, 1.3) * 14 * 1.3).toBeCloseTo(12, 5)
    // A smaller scale or a broken one never lets the label grow past its size.
    expect(tabLabelFitFloor(12, 0.85)).toBe(1)
    expect(tabLabelFitFloor(12, Number.NaN)).toBe(1)
  })

  it.each(CASES)(
    '[P1] [7.11-NAT-004] %s "%s" at text scale %s: 12 px or more, two lines at most, not cut',
    (_locale, label, fontScale) => {
      expect(label, 'catalog label').toBeTruthy()
      device.fontScale = fontScale
      for (const focused of [true, false]) {
        captured.props.length = 0
        const { unmount } = render(
          <View style={{ width: TAB_WIDTH_DP / fontScale }}>
            <TabBarLabel
              color="rgb(1, 2, 3)"
              onHeight={() => undefined}
              focused={focused}
            >
              {label}
            </TabBarLabel>
          </View>
        )
        const element = settle(label)
        const props = latest(label)
        expect(props.numberOfLines).toBe(TAB_LABEL_MAX_LINES)
        expect(props.ellipsizeMode).toBeUndefined()

        const rendered = Number.parseFloat(getComputedStyle(element).fontSize) * fontScale
        expect(
          rendered,
          `${label} rendered px (${focused ? 'active' : 'inactive'})`
        ).toBeGreaterThanOrEqual(TAB_LABEL_MIN_PX - 0.01)
        expect(lineWidths(element).length, `${label} lines`).toBeLessThanOrEqual(
          TAB_LABEL_MAX_LINES
        )
        // A clamped or clipped label scrolls past the box it shows.
        expect(element.scrollHeight, `${label} cut below`).toBeLessThanOrEqual(
          element.clientHeight + 1
        )
        expect(element.scrollWidth, `${label} cut at the side`).toBeLessThanOrEqual(
          element.clientWidth + 1
        )
        unmount()
      }
      device.fontScale = 1
    }
  )
})

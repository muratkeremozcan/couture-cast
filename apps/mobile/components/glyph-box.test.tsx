// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 F-00i: a glyph box grows with the text size, so its glyph stays inside it.
import type * as ReactNative from 'react-native'
import { screen } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dimensions = vi.hoisted(() => ({ fontScale: 1 }))
vi.mock('react-native', async (original) => {
  const actual = await original<typeof ReactNative>()
  return {
    ...actual,
    useWindowDimensions: () => ({
      width: 400,
      height: 800,
      scale: 1,
      fontScale: dimensions.fontScale,
    }),
  }
})

import { glyphBoxSide } from './glyph-box'
import { InfoBanner } from './info-banner'
import { initI18n } from '@/src/lib/i18n'

const iconBox = () => {
  const glyph = screen.getByText('i')
  return glyph.parentElement as HTMLElement
}

describe('6.15 glyph box', () => {
  beforeAll(async () => {
    await initI18n()
  })
  beforeEach(() => {
    dimensions.fontScale = 1
  })

  it('6.15-MOB-GLYPH-01 keeps the base side at or below the default text size', () => {
    expect(glyphBoxSide(30, 1)).toBe(30)
    expect(glyphBoxSide(30, 0.85)).toBe(30)
    expect(glyphBoxSide(30, Number.NaN)).toBe(30)
    // Unrounded: a 22.3 box stays 22.3, so Yoga places it exactly as it did before the fix.
    expect(glyphBoxSide(22.3, 1)).toBe(22.3)
  })

  it('6.15-MOB-GLYPH-02 scales the side by the text size above it', () => {
    expect(glyphBoxSide(30, 1.5)).toBe(45)
    expect(glyphBoxSide(22, 2)).toBe(44)
    expect(glyphBoxSide(52, 3.1)).toBeCloseTo(161.2, 0)
  })

  it('6.15-MOB-GLYPH-03 draws the info dot at 22 by default and at 44, still round, at 2.0', async () => {
    const view = await render(<InfoBanner message="Look unavailable." />)
    let box = iconBox().getBoundingClientRect()
    expect([box.width, box.height]).toEqual([22, 22])
    expect(getComputedStyle(iconBox()).borderTopLeftRadius).toBe('11px')

    dimensions.fontScale = 2
    await view.rerender(<InfoBanner message="Look unavailable!" />)
    box = iconBox().getBoundingClientRect()
    expect([box.width, box.height]).toEqual([44, 44])
    expect(getComputedStyle(iconBox()).borderTopLeftRadius).toBe('22px')
  })
})

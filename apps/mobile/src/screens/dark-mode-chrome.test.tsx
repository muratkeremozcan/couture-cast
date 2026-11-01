// OS dark mode across app chrome: the chip band, the information modal, a stack screen and the
// light/dark tokens they read. PR 167's Android dark screenshots showed a white chip band and a
// near-black header title on the dark header; the tab title has its own case in
// components/share-card-tab-heading.test.tsx.
import React from 'react'
import type * as ReactNativeModule from 'react-native'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio } from '@couture/utils'

const scheme = vi.hoisted(() => ({ current: 'dark' as 'dark' | 'light' }))

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    findNodeHandle: vi.fn(),
    useColorScheme: () => scheme.current,
  }
})

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

vi.mock('expo-status-bar', () => ({ StatusBar: () => null }))

vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn() },
  useRouter: () => ({ back: vi.fn() }),
  Stack: { Screen: () => null },
}))

vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock()
)

vi.mock('@/src/hooks/use-accessibility-announcer', () => ({
  useAccessibilityAnnouncer: () => ({ announce: vi.fn() }),
}))

import Colors, { type SchemeColors } from '@/constants/colors'
import i18n, { initI18n } from '@/src/lib/i18n'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { MobileChipNavigation } from '@/components/chip-navigation'
import ModalScreen from '../../app/modal'
import WardrobeCapsulesScreen from '../../app/wardrobe-capsules'

/** The `rgb(r, g, b)` a browser computes for a `#rgb` or `#rrggbb` token. */
function rgb(hex: string) {
  const digits = hex.replace('#', '')
  const full = digits.length === 3 ? digits.replace(/./g, (d) => d + d) : digits
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

const style = (element: Element) => getComputedStyle(element)

describe('OS light/dark chrome tokens', () => {
  const pairs: [keyof SchemeColors, keyof SchemeColors][] = [
    ['text', 'background'],
    ['text', 'surface'],
    ['text', 'subtleSurface'],
    ['mutedText', 'background'],
    ['mutedText', 'surface'],
    ['mutedText', 'subtleSurface'],
    ['accentText', 'background'],
    ['accentText', 'surface'],
    ['onInverse', 'inverseSurface'],
    ['onAccent', 'accent'],
    ['noticeText', 'noticeSurface'],
    ['dangerText', 'dangerSurface'],
    ['dangerText', 'background'],
    ['successText', 'background'],
  ]
  for (const name of ['light', 'dark'] as const)
    it.each(pairs)(`${name}: %s on %s clears WCAG AA`, (foreground, background) => {
      expect(
        contrastRatio(Colors[name][foreground], Colors[name][background])
      ).toBeGreaterThanOrEqual(4.5)
    })
})

describe('chip band', () => {
  afterEach(() => {
    scheme.current = 'dark'
  })

  it('follows the dark scheme: dark band, subtle rule, legible inactive chips', () => {
    render(<MobileChipNavigation activeCategory="Personal" onCategoryChange={vi.fn()} />)
    const band = screen.getByTestId('mobile-chip-navigation')
    expect(style(band).backgroundColor).toBe(rgb(Colors.dark.background))
    expect(style(band).borderBottomColor).toBe(rgb(Colors.dark.border))
    const inactive = screen.getByTestId('chip-community')
    expect(style(inactive).backgroundColor).toBe(rgb(Colors.dark.subtleSurface))
    expect(style(inactive.querySelector('div') ?? inactive).color).toBe(
      rgb(Colors.dark.mutedText)
    )
    // The active gold chip keeps its own fill and dark label in both schemes.
    expect(style(screen.getByTestId('chip-personal')).backgroundColor).toBe(
      rgb(Colors.dark.accent)
    )
  })

  it('keeps the light band white', () => {
    scheme.current = 'light'
    render(<MobileChipNavigation activeCategory="Personal" onCategoryChange={vi.fn()} />)
    expect(style(screen.getByTestId('mobile-chip-navigation')).backgroundColor).toBe(
      rgb(Colors.light.background)
    )
  })
})

describe('screens', () => {
  let restoreAccessTokenResolver: () => void

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    scheme.current = 'dark'
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)
  })

  afterEach(() => {
    restoreAccessTokenResolver()
  })

  it('the information modal Cancel button stays visible on the dark screen', () => {
    // It was #111111 on the black modal.
    render(<ModalScreen />)
    const close = screen.getByTestId('information-modal-close')
    expect(style(close).backgroundColor).toBe(rgb(Colors.dark.inverseSurface))
    expect(style(screen.getByText(i18n.t('common.cancel'))).color).toBe(
      rgb(Colors.dark.onInverse)
    )
  })

  it('the capsule screen is dark, its error legible and its filter chips one row tall', async () => {
    render(<WardrobeCapsulesScreen />)
    const banner = await screen.findByTestId('capsule-error-banner')
    expect(style(banner).backgroundColor).toBe(rgb(Colors.dark.dangerSurface))
    expect(style(screen.getByText('Sign in to manage capsules.')).color).toBe(
      rgb(Colors.dark.dangerText)
    )
    const screenRoot = banner.parentElement!
    expect(style(screenRoot).backgroundColor).toBe(rgb(Colors.dark.background))
    // The horizontal filter row once grew to fill the screen and stretched every chip
    // to the bottom edge.
    await waitFor(() =>
      expect(
        screen.getByTestId('capsule-occasion-filter-all').getBoundingClientRect().height
      ).toBeLessThan(60)
    )
    expect(style(screen.getByTestId('capsule-occasion-filter-work')).borderTopColor).toBe(
      rgb(Colors.dark.strongBorder)
    )
  })
})

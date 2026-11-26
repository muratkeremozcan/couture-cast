// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner: 7.9-NAT-003 (the active tab is gold through `tabActive`, inactive
// `inkMuted`, D3) and 7.9-NAT-004 (the tab shell repaints its page surface on a live scheme flip,
// AC 2). The tab navigator is stood in for so its options can be read; the header it is handed is
// rendered for real.
// Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md
import React, { type ReactNode } from 'react'
import type * as ReactNativeModule from 'react-native'
import { act, render, screen } from '@testing-library/react'
import { colorRoles, shell } from '@couture/utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { liveColorScheme } from '@/src/test-utils/live-color-scheme'

type TabsProps = { screenOptions: Record<string, unknown>; children?: ReactNode }

const navigator = vi.hoisted(() => ({ latest: null as TabsProps | null }))

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  const { liveColorScheme: live } = await import('@/src/test-utils/live-color-scheme.js')
  return { ...actual, useColorScheme: live.useColorScheme }
})
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('expo-router', () => {
  const Tabs = (props: TabsProps) => {
    navigator.latest = props
    return null
  }
  Tabs.Screen = () => null
  return { Tabs, Link: ({ children }: { children: ReactNode }) => children, router: {} }
})
vi.mock('react-native-safe-area-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  }
})
vi.mock('@/components/android-share-card-presentation', () => ({
  useAndroidNavigationIntent: () => () => undefined,
}))
vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock()
)

import i18n, { initI18n } from '@/src/lib/i18n'
import TabLayout from '../../app/(tabs)/_layout'

const options = () => navigator.latest?.screenOptions ?? {}

/** The `rgb(r, g, b)` a browser computes for `#rrggbb`. */
function rgb(hex: string) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

describe('the tab shell reads the token roles', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    liveColorScheme.reset()
    navigator.latest = null
  })

  it.each(['light', 'dark'] as const)(
    '7.9-NAT-003 %s: the active tab tint is tabActive and the inactive one inkMuted',
    (scheme) => {
      liveColorScheme.set(scheme)
      render(<TabLayout />)

      expect(options().tabBarActiveTintColor).toBe(colorRoles[scheme].tabActive)
      expect(options().tabBarInactiveTintColor).toBe(colorRoles[scheme].inkMuted)
      expect(options().tabBarStyle).toMatchObject({
        backgroundColor: colorRoles[scheme].page,
        height: shell.tabBarHeight,
      })
    }
  )

  it('7.9-NAT-004 repaints the scene, the tab bar and the top bar on a live flip', () => {
    render(<TabLayout />)
    const header = options().header as (props: unknown) => ReactNode
    const Header = () => (
      <>
        {header({
          options: { title: 'Home' },
          route: { name: 'index' },
          navigation: { goBack: () => undefined, canGoBack: () => false },
        })}
      </>
    )
    render(<Header />)
    expect(options().sceneStyle).toEqual({ backgroundColor: colorRoles.light.page })
    expect(getComputedStyle(screen.getByTestId('app-top-bar')).backgroundColor).toBe(
      rgb(colorRoles.light.page)
    )

    act(() => liveColorScheme.set('dark'))

    expect(options().sceneStyle).toEqual({ backgroundColor: colorRoles.dark.page })
    expect(options().tabBarStyle).toMatchObject({ backgroundColor: colorRoles.dark.page })
    expect(getComputedStyle(screen.getByTestId('app-top-bar')).backgroundColor).toBe(
      rgb(colorRoles.dark.page)
    )
  })
})

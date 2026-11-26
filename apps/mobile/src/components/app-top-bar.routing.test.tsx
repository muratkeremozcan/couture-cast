// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner: 7.9-NAT-002, the stack top bar's Back through real Expo Router
// navigation (D6). A cold deep link makes Expo Router insert the `(tabs)` anchor below the
// linked screen and pass `back` for it; Back then goes to the screen's parent tab, while a
// screen pushed by a real caller still returns to that caller.
// Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-NAT-020 and 022 through real Expo Router: the five tabs
// from the shared tab list, and every D10 route a cold link or a system back returns to its
// parent tab (Closet for garment, setup and Silhouette; Looks for Capsules and Plan; Profile for
// Style, palette, notifications, locations and the dashboards). 7.11-NAT-003: the active tab
// button reports itself selected.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import React, { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Text } from 'react-native'

// Vite does not pick the `.web.js` modules these Expo packages ship, so the prebundled
// expo-router asks for their native modules. Each stub is the inert part of the web module.
vi.hoisted(() => {
  const expo = (globalThis as { expo?: { modules: Record<string, unknown> } }).expo
  if (!expo) return
  expo.modules.ExpoAsset ??= { downloadAsync: (url: string) => Promise.resolve(url) }
  expo.modules.ExpoLinking ??= {
    addListener: () => ({ remove: () => undefined }),
    getLinkingURL: () => null,
  }
  expo.modules.ExpoFontLoader ??= {
    getLoadedFonts: () => [],
    loadAsync: () => Promise.resolve(),
    isLoaded: () => true,
  }
})

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

import { APP_TABS } from '@couture/utils'
import { ExpoRoot, Stack, Tabs, router, usePathname } from 'expo-router'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  forgetSeenTabAnchorsForTesting,
  renderStackTopBar,
  renderTabTopBar,
  tabsAnchorListeners,
} from './app-top-bar'

/** Expo Router's in-memory route context (expo-router/testing-library inMemoryContext). */
function inMemoryContext(modules: Record<string, Record<string, unknown>>) {
  return Object.assign(
    (id: string) => modules[id.replace(/^\.\//, '').replace(/\.\w*$/, '')],
    {
      resolve: (key: string) => key,
      id: '0',
      keys: () => Object.keys(modules).map((key) => `./${key}.tsx`),
    }
  )
}

function Pathname() {
  return <Text testID="pathname">{usePathname()}</Text>
}

/** Mounts of the tab group, to tell a pop onto the anchor from a replace with a new one. */
const tabGroupMounts = { count: 0 }

const body = (text: string) => ({ default: () => <Text>{text}</Text> })

/** Spec D10: each native sub-screen route and its parent tab, by tab. */
const CLOSET_SCREENS = [
  'wardrobe-onboarding',
  'wardrobe-silhouette',
  'wardrobe-garment',
] as const
const LOOKS_SCREENS = ['wardrobe-capsules', 'planner'] as const
const PROFILE_SCREENS = [
  'settings-style',
  'palette-advisor',
  'notification-settings',
  'locations',
  'guardian-dashboard',
  'teen-dashboard',
] as const
const SUB_SCREENS = [...CLOSET_SCREENS, ...LOOKS_SCREENS, ...PROFILE_SCREENS]

const COLD_LINKS: readonly (readonly [string, string, string])[] = [
  ...CLOSET_SCREENS.map((name) => [name, '/wardrobe', 'closet body'] as const),
  ...LOOKS_SCREENS.map((name) => [name, '/looks', 'looks body'] as const),
  ...PROFILE_SCREENS.map((name) => [name, '/settings', 'profile body'] as const),
]

/** A cold link to `name`: the garment detail takes its id. */
const linkTo = (name: string) =>
  name === 'wardrobe-garment' ? `/${name}?id=g1` : `/${name}`

/**
 * The routing config of app/_layout.tsx and app/(tabs)/_layout.tsx: the `(tabs)` initial route,
 * the shared stack and tab headers, the five tabs from the shared tab list, and the tab group's
 * anchor listeners. Screens are stand-ins.
 */
const appContext = inMemoryContext({
  _layout: {
    unstable_settings: { initialRouteName: '(tabs)' },
    default: function RootLayout() {
      return (
        <>
          <Stack screenOptions={{ header: renderStackTopBar }}>
            <Stack.Screen
              name="(tabs)"
              options={{ headerShown: false }}
              listeners={tabsAnchorListeners}
            />
            {SUB_SCREENS.map((name) => (
              <Stack.Screen key={name} name={name} options={{ title: name }} />
            ))}
          </Stack>
          <Pathname />
        </>
      )
    },
  },
  '(tabs)/_layout': {
    default: function TabLayout() {
      useEffect(() => {
        tabGroupMounts.count += 1
      }, [])
      return (
        <Tabs screenOptions={{ header: renderTabTopBar }}>
          {APP_TABS.map((tab) => (
            <Tabs.Screen
              key={tab.id}
              name={tab.nativeRoute}
              options={{ title: tab.label, tabBarButtonTestID: `tab-${tab.id}` }}
            />
          ))}
        </Tabs>
      )
    },
  },
  '(tabs)/index': body('home body'),
  '(tabs)/wardrobe': body('closet body'),
  '(tabs)/looks': body('looks body'),
  '(tabs)/community': body('community body'),
  '(tabs)/settings': body('profile body'),
  ...Object.fromEntries(SUB_SCREENS.map((name) => [name, body(`${name} body`)])),
})

const pathname = () => screen.getByTestId('pathname')

async function openApp(location: string) {
  render(<ExpoRoot context={appContext as never} location={location} />)
  const path = new URL(location, 'https://couture.test').pathname
  await waitFor(() => expect(pathname().textContent).toBe(path))
}

/**
 * Runs a navigation and waits for it to settle. On web Expo Router mirrors each state in the
 * browser history and pops it with an async `history.go`, so a test also waits for the address.
 */
async function navigate(action: () => void, expectedPathname: string) {
  await act(async () => {
    action()
    await Promise.resolve()
  })
  await waitFor(() => {
    expect(pathname().textContent).toBe(expectedPathname)
    expect(window.location.pathname).toBe(expectedPathname)
  })
}

/** Presses the one visible Back: the stack header of the screen in front. */
async function pressBack(expectedPathname: string) {
  const backs = screen
    .getAllByTestId('app-top-bar-back')
    .filter((node) => node.checkVisibility())
  expect(backs).toHaveLength(1)
  await navigate(() => fireEvent.click(backs[0]!), expectedPathname)
}

describe('7.9-NAT-002 stack top bar Back through Expo Router', () => {
  beforeAll(async () => {
    // The prebundled expo-router keeps classic JSX, which reads React from the global scope.
    ;(globalThis as { React?: unknown }).React = React
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  const testerUrl = window.location.href
  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', testerUrl)
  })

  beforeEach(() => {
    // react-native-web flags the `pointerEvents` prop React Navigation's web screens pass.
    const warn = console.warn
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('props.pointerEvents is deprecated')) return
      warn(...args)
    })
  })

  it.each(COLD_LINKS)(
    '[7.11-NAT-020] a cold link to %s goes back to %s',
    async (name, parent, parentBody) => {
      await openApp(linkTo(name))
      // Expo Router reports caller history: the `(tabs)` anchor it inserted below the link.
      expect(router.canGoBack()).toBe(true)

      await pressBack(parent)
      await waitFor(() => expect(screen.getByText(parentBody)).toBeVisible())
    }
  )

  it('[7.11-NAT-003] the five tab buttons sit in order and only the open tab reports selected', async () => {
    await openApp('/')
    await navigate(() => router.navigate('/looks'), '/looks')

    const buttons = APP_TABS.map((tab) => screen.getByTestId(`tab-${tab.id}`))
    for (let index = 1; index < buttons.length; index += 1)
      expect(
        buttons[index - 1]!.compareDocumentPosition(buttons[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    expect(
      buttons.map((button) => button.getAttribute('aria-selected') === 'true')
    ).toEqual([false, false, true, false, false])
  })

  it('a screen pushed from Home goes back to Home, its real caller', async () => {
    await openApp('/')
    tabGroupMounts.count = 0
    await navigate(() => router.push('/planner'), '/planner')

    await pressBack('/')
    await waitFor(() => expect(screen.getByText('home body')).toBeVisible())
    // Popped onto the same tab group: a replace would have mounted a new one on the parent tab.
    expect(tabGroupMounts.count).toBe(0)
  })

  it('a screen pushed from Closet pops back to that Closet', async () => {
    await openApp('/')
    await navigate(() => router.navigate('/wardrobe'), '/wardrobe')
    tabGroupMounts.count = 0
    await navigate(() => router.push('/wardrobe-onboarding'), '/wardrobe-onboarding')

    await pressBack('/wardrobe')
    await waitFor(() => expect(screen.getByText('closet body')).toBeVisible())
    expect(tabGroupMounts.count).toBe(0)
  })

  it('[7.11-NAT-022] Plan pushed from Looks pops back to that Looks', async () => {
    await openApp('/')
    await navigate(() => router.navigate('/looks'), '/looks')
    tabGroupMounts.count = 0
    await navigate(() => router.push('/planner'), '/planner')

    await pressBack('/looks')
    await waitFor(() => expect(screen.getByText('looks body')).toBeVisible())
    expect(tabGroupMounts.count).toBe(0)
  })

  it('after a cold link, a pushed screen returns to the linked one, then to Closet', async () => {
    await openApp('/wardrobe-onboarding')
    await navigate(() => router.push('/wardrobe-garment?id=g1'), '/wardrobe-garment')

    await pressBack('/wardrobe-onboarding')
    await pressBack('/wardrobe')
  })

  // Android hardware back, the iOS swipe and any other pop that bypasses the top bar reach the
  // stack as `goBack()`, which `router.back()` dispatches here.
  it.each(COLD_LINKS)(
    '[7.11-NAT-022] a system back from a cold link to %s lands on %s',
    async (name, parent, parentBody) => {
      await openApp(linkTo(name))

      await navigate(() => router.back(), parent)
      await waitFor(() => expect(screen.getByText(parentBody)).toBeVisible())
    }
  )

  it('a system back from a screen pushed from Home stays on Home, its real caller', async () => {
    await openApp('/')
    await navigate(() => router.push('/wardrobe-onboarding'), '/wardrobe-onboarding')

    await navigate(() => router.back(), '/')
    await waitFor(() => expect(screen.getByText('home body')).toBeVisible())
  })

  // CI on 3d7af2a2 (Android): Home, Add location, Locations, Save landed on Profile. The launch's
  // first focus of the tab group reached no listener, so the real caller looked like a cold
  // link's anchor. The push over it still blurs it, which is what marks it as a caller.
  it('a guided Locations save from Home returns to Home even when the first focus went unheard', async () => {
    await openApp('/')
    forgetSeenTabAnchorsForTesting()
    await navigate(() => router.push('/locations?guided=1'), '/locations')

    // The guided save leaves with router.back().
    await navigate(() => router.back(), '/')
    await waitFor(() => expect(screen.getByText('home body')).toBeVisible())
  })

  it('the top bar Back from Locations pushed by Home returns to Home after an unheard first focus', async () => {
    await openApp('/')
    forgetSeenTabAnchorsForTesting()
    await navigate(() => router.push('/locations?guided=1'), '/locations')

    await pressBack('/')
    await waitFor(() => expect(screen.getByText('home body')).toBeVisible())
  })
})

// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner: 7.9-NAT-002, the stack top bar's Back through real Expo Router
// navigation (D6). A cold deep link makes Expo Router insert the `(tabs)` anchor below the
// linked screen and pass `back` for it; Back then goes to the screen's parent tab, while a
// screen pushed by a real caller still returns to that caller.
// Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md
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

import { ExpoRoot, Stack, Tabs, router, usePathname } from 'expo-router'
import i18n, { initI18n } from '@/src/lib/i18n'
import { renderStackTopBar, renderTabTopBar, tabsAnchorListeners } from './app-top-bar'

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

const WARDROBE_SCREENS = [
  'wardrobe-onboarding',
  'wardrobe-silhouette',
  'wardrobe-capsules',
  'wardrobe-garment',
] as const

/**
 * The routing config of app/_layout.tsx and app/(tabs)/_layout.tsx: the `(tabs)` initial route,
 * the shared stack and tab headers, and the tab group's anchor listeners. Screens are stand-ins.
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
            {WARDROBE_SCREENS.map((name) => (
              <Stack.Screen key={name} name={name} options={{ title: name }} />
            ))}
            <Stack.Screen name="planner" options={{ title: 'planner' }} />
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
          <Tabs.Screen name="index" options={{ title: 'Home' }} />
          <Tabs.Screen name="wardrobe" options={{ title: 'Wardrobe' }} />
          <Tabs.Screen name="settings" options={{ title: 'Profile' }} />
        </Tabs>
      )
    },
  },
  '(tabs)/index': body('home body'),
  '(tabs)/wardrobe': body('wardrobe body'),
  '(tabs)/settings': body('profile body'),
  ...Object.fromEntries(WARDROBE_SCREENS.map((name) => [name, body(`${name} body`)])),
  planner: body('planner body'),
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

  it.each(WARDROBE_SCREENS)('a cold link to %s goes back to Wardrobe', async (name) => {
    await openApp(name === 'wardrobe-garment' ? `/${name}?id=g1` : `/${name}`)
    // Expo Router reports caller history: the `(tabs)` anchor it inserted below the link.
    expect(router.canGoBack()).toBe(true)

    await pressBack('/wardrobe')
    expect(screen.getByText('wardrobe body')).toBeVisible()
  })

  it('a cold link to a Profile sub-screen goes back to Profile', async () => {
    await openApp('/planner')

    await pressBack('/settings')
    expect(screen.getByText('profile body')).toBeVisible()
  })

  it('a screen pushed from Home goes back to Home, its real caller', async () => {
    await openApp('/')
    tabGroupMounts.count = 0
    await navigate(() => router.push('/planner'), '/planner')

    await pressBack('/')
    expect(screen.getByText('home body')).toBeVisible()
    // Popped onto the same tab group: a replace would have mounted a new one on the parent tab.
    expect(tabGroupMounts.count).toBe(0)
  })

  it('a screen pushed from Wardrobe pops back to that Wardrobe', async () => {
    await openApp('/')
    await navigate(() => router.navigate('/wardrobe'), '/wardrobe')
    tabGroupMounts.count = 0
    await navigate(() => router.push('/wardrobe-onboarding'), '/wardrobe-onboarding')

    await pressBack('/wardrobe')
    expect(screen.getByText('wardrobe body')).toBeVisible()
    expect(tabGroupMounts.count).toBe(0)
  })

  it('after a cold link, a pushed screen returns to the linked one, then to Wardrobe', async () => {
    await openApp('/wardrobe-onboarding')
    await navigate(() => router.push('/wardrobe-garment?id=g1'), '/wardrobe-garment')

    await pressBack('/wardrobe-onboarding')
    await pressBack('/wardrobe')
  })

  // Android hardware back, the iOS swipe and any other pop that bypasses the top bar reach the
  // stack as `goBack()`, which `router.back()` dispatches here.
  it.each(WARDROBE_SCREENS)(
    'a system back from a cold link to %s lands on Wardrobe',
    async (name) => {
      await openApp(name === 'wardrobe-garment' ? `/${name}?id=g1` : `/${name}`)

      await navigate(() => router.back(), '/wardrobe')
      expect(screen.getByText('wardrobe body')).toBeVisible()
    }
  )

  it('a system back from a cold link to a Profile sub-screen lands on Profile', async () => {
    await openApp('/planner')

    await navigate(() => router.back(), '/settings')
    expect(screen.getByText('profile body')).toBeVisible()
  })

  it('a system back from a screen pushed from Home stays on Home, its real caller', async () => {
    await openApp('/')
    await navigate(() => router.push('/wardrobe-onboarding'), '/wardrobe-onboarding')

    await navigate(() => router.back(), '/')
    expect(screen.getByText('home body')).toBeVisible()
  })
})

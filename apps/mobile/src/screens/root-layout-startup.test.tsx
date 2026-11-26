// Learning path Step 49: Native platform sharing.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-49-native-platform-sharing
/**
 * Story 6.9 G01: the root layout runs the share-card startup sweeps.
 *
 * `app/**` sits outside the vitest include, so this file lives under `src/` and mounts
 * `@/app/_layout` with the navigation shell, fonts, splash and native sessions mocked.
 * Covers U-SHARE-LEASE "age sweep at startup" (AC4), plus the modal options and the root
 * status bar the layout ships.
 *
 * Requires `react-native-reanimated` aliased to a stub in `vitest.config.ts`: the layout's
 * side-effect import reaches React Native's Flow-typed `ReactFabric` shim, which Vite's
 * dependency scan cannot parse, and a `vi.mock` factory cannot stop that scan.
 */
import type { ReactNode } from 'react'
import { waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const layout = vi.hoisted(() => {
  // Metro resolves `require('../assets/fonts/...')` at build time; the browser runner has
  // no `require`, and the mocked `useFonts` ignores the asset ids anyway.
  ;(globalThis as { require?: unknown }).require ??= () => 1
  return {
    screens: [] as { name: string; options?: Record<string, unknown> }[],
    stackOptions: [] as Record<string, unknown>[],
    reduceMotion: false,
    statusBars: [] as Record<string, unknown>[],
    // Plain counters: a `vi.fn` subscribes to every promise it returns (settledResults),
    // which would handle a rejection the layout forgot to catch and hide the bug.
    sweepCalls: 0,
    cleanupCalls: 0,
    notificationListeners: 0,
    startupResult: (): Promise<void> => Promise.resolve(),
    pathname: '/',
    trackedScreens: [] as string[],
  }
})

vi.mock('@/src/lib/share-card-share', () => ({
  sweepExpiredShareCardFiles: () => {
    layout.sweepCalls += 1
    return layout.startupResult()
  },
}))
vi.mock('@/src/lib/share-card-save', () => ({
  cleanOrphanShareCards: () => {
    layout.cleanupCalls += 1
    return layout.startupResult()
  },
}))
vi.mock('@/src/lib/share-card-native-fixture', () => ({
  startShareCardNativeFixture: () => () => undefined,
}))
vi.mock('@/components/android-share-card-presentation', () => ({
  AndroidShareCardPresentation: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: { font: {} } }))
vi.mock('@expo-google-fonts/playfair-display', () => ({
  PlayfairDisplay_400Regular: 1,
  PlayfairDisplay_400Regular_Italic: 1,
  PlayfairDisplay_700Bold: 1,
}))
vi.mock('@expo-google-fonts/space-grotesk', () => ({
  SpaceGrotesk_400Regular: 1,
  SpaceGrotesk_700Bold: 1,
}))
vi.mock('expo-constants', () => ({
  default: { appOwnership: null },
  AppOwnership: { Expo: 'expo' },
}))
vi.mock('expo-font', () => ({ useFonts: () => [true, null] }))
vi.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: () => Promise.resolve(),
  hideAsync: () => Promise.resolve(),
}))
vi.mock('expo-status-bar', () => ({
  StatusBar: (props: Record<string, unknown>) => {
    layout.statusBars.push(props)
    return null
  },
}))
vi.mock('expo-router', () => {
  const Stack = ({
    children,
    screenOptions,
  }: {
    children: ReactNode
    screenOptions?: Record<string, unknown>
  }) => {
    if (screenOptions) layout.stackOptions.push(screenOptions)
    return children
  }
  Stack.Screen = (props: { name: string; options?: Record<string, unknown> }) => {
    layout.screens.push(props)
    return null
  }
  const router = { push: () => undefined, replace: () => undefined }
  return {
    ErrorBoundary: () => null,
    Stack,
    usePathname: () => layout.pathname,
    useRouter: () => router,
    useRootNavigationState: () => ({ key: 'root' }),
  }
})
vi.mock('expo-notifications', () => ({
  addNotificationReceivedListener: () => {
    layout.notificationListeners += 1
    return { remove: () => undefined }
  },
}))
vi.mock('@react-navigation/native', () => ({
  DarkTheme: {},
  DefaultTheme: {},
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}))
vi.mock('@/src/analytics/mobile-analytics', () => ({
  MobileAnalyticsProvider: ({ children }: { children: ReactNode }) => children,
  mobileAnalyticsClient: {
    screen: (name: string) => {
      layout.trackedScreens.push(name)
      return Promise.resolve()
    },
    getDistinctId: () => '',
  },
}))
vi.mock('@/src/analytics/track-events', () => ({
  trackMobileAlertReceived: () => undefined,
}))
vi.mock('@/src/lib/i18n', () => ({ initI18n: () => Promise.resolve() }))
vi.mock('@/src/lib/background-task', () => ({
  registerRitualBackgroundTaskAsync: () => Promise.resolve(),
}))
// Story CC-7.7 D6: the stack's transitions follow the OS reduced-motion setting.
vi.mock('@/src/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => layout.reduceMotion,
}))
vi.mock('@/src/hooks/use-accessibility-announcer', () => ({
  AccessibilityAnnouncerProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/src/theme/theme-context', () => ({
  AppThemeProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/src/lib/native-session', () => ({
  startNativeSession: () => Promise.resolve(() => undefined),
}))
vi.mock('@/src/lib/native-notifications', () => ({
  startNativeNotifications: () => Promise.resolve(() => undefined),
}))
vi.mock('@/src/lib/native-notification-fixture', () => ({
  startNativeNotificationFixture: () => Promise.resolve(() => undefined),
}))

import { Platform } from 'react-native'
import RootLayout from '@/app/_layout'

const originalOS = Platform.OS
function setOS(os: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os })
}

/** Lets the startup promises settle and the browser dispatch any unhandledrejection. */
async function settleTasks() {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function mountLayout() {
  await render(<RootLayout />)
  await waitFor(() => expect(layout.screens.length).toBeGreaterThan(0))
  // On a native OS the layout subscribes to notifications through a dynamic import. A test
  // that ends first leaves that import to settle after the file's mocks are gone, and the
  // layout then logs "listener unavailable" against no test.
  const expectedListeners = Platform.OS === 'web' ? 0 : 1
  await waitFor(() => expect(layout.notificationListeners).toBe(expectedListeners))
}

describe('RootLayout startup', () => {
  beforeEach(() => {
    layout.screens.length = 0
    layout.stackOptions.length = 0
    layout.reduceMotion = false
    layout.statusBars.length = 0
    layout.sweepCalls = 0
    layout.cleanupCalls = 0
    layout.notificationListeners = 0
    layout.startupResult = () => Promise.resolve()
    layout.pathname = '/'
    layout.trackedScreens.length = 0
    setOS(originalOS)
  })

  afterEach(() => {
    setOS(originalOS)
  })

  it('U-SHARE-LEASE runs the share handoff age sweep and the orphan save cleanup once at mount', async () => {
    await mountLayout()

    expect(layout.sweepCalls).toBe(1)
    expect(layout.cleanupCalls).toBe(1)
  })

  it('U-SHARE-LEASE a rejecting startup sweep raises no unhandled rejection', async () => {
    layout.startupResult = () => Promise.reject(new Error('startup sweep down'))
    const unhandled = vi.fn()
    window.addEventListener('unhandledrejection', unhandled)
    try {
      await mountLayout()
      expect(layout.sweepCalls).toBe(1)
      expect(layout.cleanupCalls).toBe(1)
      await settleTasks()
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('unhandledrejection', unhandled)
    }
  })

  it.each([
    ['ios', false],
    ['android', true],
  ])(
    'the modal screen has an empty title and on %s headerShown is %s',
    async (os, shown) => {
      setOS(os)
      await mountLayout()

      const modal = layout.screens.filter((screen) => screen.name === 'modal').at(-1)
      expect(modal?.options).toMatchObject({
        presentation: 'modal',
        title: '',
        headerShown: shown,
      })
    }
  )

  // P2-9: the `default` animation ignores animationDuration (UIKit push on iOS, 450 ms tween
  // XML on Android API 33+); `fade` ships 150 ms on Android and honors 200 ms on iOS.
  it.each(['ios', 'android'])(
    '7.7-NAT-005 gives the %s root stack the bounded fade transition while motion is on',
    async (os) => {
      setOS(os)
      await mountLayout()

      expect(layout.stackOptions.at(-1)).toMatchObject({
        animationDuration: 200,
        animation: 'fade',
      })
    }
  )

  it.each([
    ['ios', 'default'],
    ['android', undefined],
  ])(
    '7.7-NAT-005 the %s modal route keeps its platform presentation while motion is on',
    async (os, animation) => {
      setOS(os)
      await mountLayout()

      const modal = layout.screens.filter((screen) => screen.name === 'modal').at(-1)
      // iOS keeps the system page sheet (D6 exception); `fade` would cross-dissolve it.
      // Android draws the route as a stack screen and inherits the 150 ms fade.
      expect(modal).toBeDefined()
      expect(modal?.options?.animation).toBe(animation)
    }
  )

  it.each(['ios', 'android'])(
    '7.7-NAT-005 turns %s root stack and modal transitions off under reduced motion',
    async (os) => {
      setOS(os)
      layout.reduceMotion = true
      await mountLayout()

      expect(layout.stackOptions.at(-1)).toMatchObject({
        animationDuration: 200,
        animation: 'none',
      })
      const modal = layout.screens.filter((screen) => screen.name === 'modal').at(-1)
      expect(modal?.options).not.toHaveProperty('animation')
    }
  )

  it('mounts one root status bar that follows the OS scheme', async () => {
    await mountLayout()

    expect(layout.statusBars.length).toBeGreaterThan(0)
    expect(layout.statusBars.every((props) => props.style === 'auto')).toBe(true)
  })

  // Story 6.16 D10: the guest preview and its review are never recorded as screens.
  it.each(['/preview', '/preview-continue'])(
    'sends no screen view for %s',
    async (pathname) => {
      layout.pathname = pathname
      await mountLayout()
      expect(layout.trackedScreens).toEqual([])
      expect(
        layout.screens.find((screen) => screen.name === 'preview')?.options
      ).toMatchObject({
        title: 'Try a sample wardrobe',
      })
    }
  )

  it('still sends screen views elsewhere', async () => {
    layout.pathname = '/settings'
    await mountLayout()
    expect(layout.trackedScreens).toEqual(['/settings'])
  })
})

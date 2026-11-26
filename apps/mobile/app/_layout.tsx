import { startShareCardNativeFixture } from '@/src/lib/share-card-native-fixture'
import { AndroidShareCardPresentation } from '@/components/android-share-card-presentation'
import { cleanOrphanShareCards } from '@/src/lib/share-card-save'
import { sweepExpiredShareCardFiles } from '@/src/lib/share-card-share'
// Step 2 step 3 owner: searchable owner anchor
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native'
import Constants, { AppOwnership } from 'expo-constants'
import { useFonts } from 'expo-font'
import type { Notification } from 'expo-notifications'
import { Stack, usePathname, useRouter, useRootNavigationState } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import 'react-native-reanimated'

import { Platform, StyleSheet, View } from 'react-native'
import {
  MobileAnalyticsProvider,
  mobileAnalyticsClient,
} from '@/src/analytics/mobile-analytics'
import { trackMobileAlertReceived } from '@/src/analytics/track-events'
import { initI18n } from '@/src/lib/i18n'
import { registerRitualBackgroundTaskAsync } from '@/src/lib/background-task'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import { useReducedMotion } from '@/src/hooks/use-reduced-motion'
import { AppThemeProvider } from '@/src/theme/theme-context'
import { useTokens, type Tokens } from '@/src/theme/tokens'
import { renderStackTopBar, tabsAnchorListeners } from '@/src/components/app-top-bar'
import {
  underModalAccessibility,
  useEdgeToEdgeModalOpen,
} from '@/components/edge-to-edge-modal'
import { LiveFontMountMarker } from '@/components/live-font-mount-marker'
import { SaveFeedbackProvider } from '@/components/save-feedback'
import { useTranslation } from 'react-i18next'
import { getFederatedSignInStrings, getGuestPreviewStrings } from '@couture/utils'

const isExpoGoAndroid =
  Platform.OS === 'android' && Constants.appOwnership === AppOwnership.Expo

const GUEST_PREVIEW_ROUTE = /^\/preview(?:-continue)?(?:\/|$)/

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router'

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
}

/**
 * Story CC-7.7 D6: stack transitions last 200 ms or less, and none plays under the OS
 * reduced-motion setting.
 *
 * `fade` is the one react-native-screens 4.16 transition whose shipped duration stays inside
 * the budget on both platforms (checked in node_modules/react-native-screens):
 * - Android ignores `animationDuration` (ScreenViewManager's setter is a no-op) and plays the
 *   tween XML of the chosen animation. `fade` maps to res/base/anim/rns_fade_in.xml and
 *   rns_fade_out.xml, 150 ms each (utils/FragmentTransactionKt.kt). The `default` animation
 *   runs 450 ms on API 33+ (res/v33/anim-v33/rns_default_*.xml), and `slide_from_*` uses
 *   config_mediumAnimTime (400 ms).
 * - iOS runs `fade` through RNSScreenStackAnimator, a custom animator whose duration is the
 *   screen's `animationDuration` in ms (transitionDuration:, 500 ms when unset). The `default`
 *   animation is UIKit's own push, which ignores `animationDuration`.
 */
export function rootStackMotionOptions(reduceMotion: boolean): {
  animationDuration: number
  animation: 'fade' | 'none'
} {
  return { animationDuration: 200, animation: reduceMotion ? 'none' : 'fade' }
}

/**
 * The `modal` route on iOS is a system page sheet; `fade` would turn it into a cross-dissolve
 * (RNSScreen setStackAnimation). It keeps its system-timed sheet presentation while motion is on,
 * the platform sheet exception in D6, and inherits `none` under reduced motion. Android shows the
 * route as a stack screen, so it keeps the stack's 150 ms fade.
 */
export function rootModalMotionOptions(
  reduceMotion: boolean,
  os: typeof Platform.OS = Platform.OS
): { animation?: 'default' } {
  return os === 'ios' && !reduceMotion ? { animation: 'default' } : {}
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
void SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  useEffect(() => startShareCardNativeFixture(), [])
  useEffect(() => {
    void cleanOrphanShareCards().catch(() => undefined)
    // Story 6.9: share handoff files outlive the app process for a 30-minute lease.
    void sweepExpiredShareCardFiles().catch(() => undefined)
  }, [])
  type FontLoadTuple = readonly [boolean, Error | null]
  /* eslint-disable @typescript-eslint/no-unsafe-assignment */
  // Expo's types return an untyped tuple; narrow locally to satisfy type-aware linting.
  const fontLoadResult = useFonts({
    // Story CC-7.9 D4: screens use the system font, so only the template's SpaceMono and the
    // icon font load here. The widget and watch targets copy their own faces at build time.
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  }) as unknown as FontLoadTuple
  const [loaded, fontError]: FontLoadTuple = fontLoadResult
  /* eslint-enable @typescript-eslint/no-unsafe-assignment */

  const [i18nLoaded, setI18nLoaded] = useState(false)

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (fontError) throw fontError
  }, [fontError])

  useEffect(() => {
    void initI18n()
      .catch((error: unknown) => {
        console.warn('[i18n] unable to initialize localization', error)
      })
      .finally(() => {
        setI18nLoaded(true)
      })
  }, [])

  useEffect(() => {
    if (loaded && i18nLoaded) {
      void SplashScreen.hideAsync()
      void registerRitualBackgroundTaskAsync()
    }
  }, [loaded, i18nLoaded])

  if (!loaded || !i18nLoaded) {
    return null
  }

  return <RootLayoutNav />
}

function RootLayoutNav() {
  /* eslint-disable @typescript-eslint/no-unsafe-assignment */
  const tokens = useTokens()
  const theme = navigationTheme(tokens)
  const { t, i18n } = useTranslation()
  const modalOpen = useEdgeToEdgeModalOpen()
  const reduceMotion = useReducedMotion()

  const router = useRouter()
  const navigation = useRootNavigationState()
  const readyListeners = useRef(new Set<() => void>())
  const readyRef = useRef(false)
  readyRef.current = Boolean(navigation?.key)
  useEffect(() => {
    readyListeners.current.forEach((listener) => listener())
  }, [navigation?.key])
  useEffect(() => {
    let stopped = false
    const cleanups: (() => void)[] = []
    void import('../src/lib/native-session.js')
      .then(async ({ startNativeSession }) => {
        const cleanup = await startNativeSession()
        if (stopped) cleanup()
        else cleanups.push(cleanup)
      })
      .catch(() => undefined)
    if (!isExpoGoAndroid)
      void import('../src/lib/native-notifications.js')
        .then(async ({ startNativeNotifications }) => {
          const cleanup = await startNativeNotifications({
            ready: () => readyRef.current,
            subscribeReady: (listener) => {
              readyListeners.current.add(listener)
              return () => {
                readyListeners.current.delete(listener)
              }
            },
            open: (params) => router.push({ pathname: '/(tabs)/community', params }),
          })
          if (stopped) cleanup()
          else cleanups.push(cleanup)
        })
        .catch(() => undefined)
    if (__DEV__ && !isExpoGoAndroid)
      void import('../src/lib/native-notification-fixture.js')
        .then(async ({ startNativeNotificationFixture }) => {
          const cleanup = await startNativeNotificationFixture()
          if (stopped) cleanup()
          else cleanups.push(cleanup)
        })
        .catch(() => undefined)
    return () => {
      stopped = true
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [router])

  const pathname = usePathname()
  const previousPathname = useRef<string | undefined>(undefined)

  // Manual screen tracking for Expo Router
  // @see https://posthog.com/docs/libraries/react-native#screen-tracking
  // Story 6.16 D10: the guest preview and its review are never recorded as screens, so no
  // view is sent before eligibility; guest usage is counted by guest_preview_* only.
  useEffect(() => {
    if (previousPathname.current !== pathname) {
      if (GUEST_PREVIEW_ROUTE.test(pathname)) {
        previousPathname.current = undefined
        return
      }
      void mobileAnalyticsClient.screen(pathname, {
        previous_screen: previousPathname.current ?? null,
      })
      previousPathname.current = pathname
    }
  }, [pathname])

  useEffect(() => {
    if (Platform.OS === 'web' || isExpoGoAndroid) {
      return
    }

    let isActive = true
    let subscription: { remove: () => void } | undefined

    const handleNotification = (notification: Notification) => {
      const data = notification.request.content.data as Record<string, unknown>
      const severityCandidate = data?.severity
      const severity =
        severityCandidate === 'warning' || severityCandidate === 'critical'
          ? severityCandidate
          : 'info'

      trackMobileAlertReceived(mobileAnalyticsClient, {
        userId: mobileAnalyticsClient.getDistinctId() || 'mobile-anonymous-user',
        // Never the notification title: it is free text and may name the member.
        alertType:
          (typeof data?.alertType === 'string' && data.alertType) || 'push_notification',
        severity,
        weatherSeverity:
          typeof data?.weatherSeverity === 'string' ? data.weatherSeverity : undefined,
      })
    }

    void import('expo-notifications')
      .then((Notifications) => {
        if (!isActive) {
          return
        }

        subscription = Notifications.addNotificationReceivedListener(handleNotification)
      })
      .catch((error: unknown) => {
        console.warn('[mobile-notifications] listener unavailable', error)
      })

    return () => {
      isActive = false
      subscription?.remove()
    }
  }, [])

  return (
    <MobileAnalyticsProvider>
      <AccessibilityAnnouncerProvider>
        {/*
          Story 5.3 Decision 12: inside the announcer and outside React Navigation's
          `ThemeProvider`. Analytics and the announcer stay above it, where later work
          may want to report a palette change, and navigation chrome stays below it.
          The two providers answer different questions and must not be merged: the
          navigation one carries the OS light/dark scheme, this one carries the
          reader's own premium palette.
        */}
        <AppThemeProvider>
          <ThemeProvider value={theme}>
            {/* iOS labels the back button with the previous route's title; the tab
                group has none, so it read "(tabs)". */}
            <LiveFontMountMarker scope="root" />
            {/* While an EdgeToEdgeModal is up, the screens under it leave the accessibility
                tree (shard 3, run 43800364098: Home's text sat under the share card composer).
                Never flattened, so the flag toggles on one native view and the screens keep
                theirs. */}
            <View
              collapsable={false}
              style={styles.screens}
              {...underModalAccessibility(modalOpen)}
            >
              <SaveFeedbackProvider>
                <AndroidShareCardPresentation
                  pathname={pathname}
                  navigationReady={Boolean(navigation?.key)}
                  onRestoreRoute={(path) => router.replace(path)}
                >
                  <Stack
                    screenOptions={{
                      // Story CC-7.9 D6, D7: the one app top bar on every root stack screen
                      // that shows a header, over the page surface.
                      header: renderStackTopBar,
                      contentStyle: { backgroundColor: tokens.colors.page },
                      headerBackTitle: t('common.back'),
                      ...rootStackMotionOptions(reduceMotion),
                    }}
                  >
                    {/* A cold deep link mounts the tab group below the linked screen without
                      focusing it; the listener tells the top bar which anchors were seen. */}
                    <Stack.Screen
                      name="(tabs)"
                      options={{ headerShown: false }}
                      listeners={tabsAnchorListeners}
                    />
                    {/* The modal names itself in its own heading; an untitled header would
                      show the raw route name "modal". Android keeps the bar for its back
                      arrow; an iOS sheet dismisses by swipe or Cancel and needs no empty bar. */}
                    <Stack.Screen
                      name="modal"
                      options={{
                        presentation: 'modal',
                        title: '',
                        headerShown: Platform.OS !== 'ios',
                        ...rootModalMotionOptions(reduceMotion),
                      }}
                    />
                    <Stack.Screen
                      name="wardrobe-capsules"
                      options={{ title: t('wardrobe.capsules.title') }}
                    />
                    {/* Story CC-7.11 D7, D10: Profile > Style, and the guardian and teen
                      dashboards, whose bars name them (the bodies drop their second title). */}
                    <Stack.Screen
                      name="settings-style"
                      options={{ title: t('settings.style.title') }}
                    />
                    <Stack.Screen
                      name="guardian-dashboard"
                      options={{ title: t('guardian.dashboard.title') }}
                    />
                    <Stack.Screen
                      name="teen-dashboard"
                      options={{ title: t('teen.dashboard.title') }}
                    />
                    {/* The native header carries each title; the screens render no second one. */}
                    <Stack.Screen
                      name="signin"
                      options={{ title: t('community.notifications.signin') }}
                    />
                    <Stack.Screen
                      name="notification-settings"
                      options={{ title: t('community.notifications.title') }}
                    />
                    <Stack.Screen
                      name="locations"
                      options={{ title: t('locations.title') }}
                    />
                    <Stack.Screen
                      name="preview"
                      options={{
                        title: getGuestPreviewStrings(i18n.language).chrome.entry,
                      }}
                    />
                    {/* The web signup bar's title; the body keeps its own heading. */}
                    <Stack.Screen
                      name="signup"
                      options={{ title: getFederatedSignInStrings(i18n.language).create }}
                    />
                    {/* Story 6.17 D3, D5: the Google finish step and its callback. The header
                      carries the finish step's title; the screen renders no second one. */}
                    <Stack.Screen
                      name="signup-finish"
                      options={{
                        title: getFederatedSignInStrings(i18n.language).finishTitle,
                        headerBackVisible: false,
                        gestureEnabled: false,
                      }}
                    />
                    <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
                    <Stack.Screen
                      name="preview-continue"
                      options={{
                        title: getGuestPreviewStrings(i18n.language).review.heading,
                        headerBackVisible: false,
                      }}
                    />
                  </Stack>
                </AndroidShareCardPresentation>
              </SaveFeedbackProvider>
            </View>
            {/* Android edge-to-edge leaves the status bar icons light whatever the theme, so
                they vanished on the light headers. `auto` follows the OS scheme the navigation
                theme follows; screens that need another style push their own entry on top. */}
            <StatusBar style="auto" />
            {/* UI automation marker: commits with the navigator, so it exists on
                every route once the JS tree has mounted and never on the splash.
                maestro/subflows/open-app.yaml waits for it before deciding
                whether a pushed route needs popping. */}
            <View
              testID="app-root-mounted"
              collapsable={false}
              style={styles.mountedMarker}
            />
          </ThemeProvider>
        </AppThemeProvider>
      </AccessibilityAnnouncerProvider>
    </MobileAnalyticsProvider>
  )
  /* eslint-enable @typescript-eslint/no-unsafe-assignment */
}

const styles = StyleSheet.create({
  screens: { flex: 1 },
  // Mid-screen: at the window's top-left it sat under the status bar, and the
  // Android accessibility tree dropped it there.
  mountedMarker: {
    position: 'absolute',
    pointerEvents: 'none',
    top: '50%',
    left: 0,
    width: 1,
    height: 1,
  },
})

/**
 * Story CC-7.9 D1: React Navigation's theme from the token roles, so navigator chrome it still
 * paints (a modal card, a scene behind a transition) is the page surface of the OS scheme.
 */
function navigationTheme({ scheme, colors }: Tokens) {
  // The navigation themes type as `error` under the lint program, as in RootLayoutNav above.
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access */
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.ink,
      background: colors.page,
      card: colors.page,
      text: colors.ink,
      border: colors.line,
      notification: colors.danger,
    },
  }
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access */
}

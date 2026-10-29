import { startShareCardNativeFixture } from '@/src/lib/share-card-native-fixture'
import { AndroidShareCardPresentation } from '@/components/android-share-card-presentation'
import { cleanOrphanShareCards } from '@/src/lib/share-card-save'
// Step 2 step 3 owner: searchable owner anchor
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native'
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_700Bold,
} from '@expo-google-fonts/playfair-display'
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk'
import Constants, { AppOwnership } from 'expo-constants'
import { useFonts } from 'expo-font'
import type { Notification } from 'expo-notifications'
import { Stack, usePathname, useRouter, useRootNavigationState } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useRef, useState } from 'react'
import 'react-native-reanimated'

import { Platform, StyleSheet, useColorScheme, View } from 'react-native'
import {
  MobileAnalyticsProvider,
  mobileAnalyticsClient,
} from '@/src/analytics/mobile-analytics'
import { trackMobileAlertReceived } from '@/src/analytics/track-events'
import { initI18n } from '@/src/lib/i18n'
import { registerBackgroundFetchAsync } from '@/src/lib/background-fetch'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import { AppThemeProvider } from '@/src/theme/theme-context'
import { useTranslation } from 'react-i18next'

const isExpoGoAndroid =
  Platform.OS === 'android' && Constants.appOwnership === AppOwnership.Expo

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router'

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
void SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  useEffect(() => startShareCardNativeFixture(), [])
  useEffect(() => {
    void cleanOrphanShareCards().catch(() => undefined)
  }, [])
  type FontLoadTuple = readonly [boolean, Error | null]
  /* eslint-disable @typescript-eslint/no-unsafe-assignment */
  // Expo's types return an untyped tuple; narrow locally to satisfy type-aware linting.
  const fontLoadResult = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    'Playfair Display': PlayfairDisplay_400Regular,
    'Playfair Display Bold': PlayfairDisplay_700Bold,
    'Space Grotesk': SpaceGrotesk_400Regular,
    'Space Grotesk Bold': SpaceGrotesk_700Bold,
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
      void registerBackgroundFetchAsync()
    }
  }, [loaded, i18nLoaded])

  if (!loaded || !i18nLoaded) {
    return null
  }

  return <RootLayoutNav />
}

function RootLayoutNav() {
  /* eslint-disable @typescript-eslint/no-unsafe-assignment */
  const colorScheme = useColorScheme()
  const theme = colorScheme === 'dark' ? DarkTheme : DefaultTheme
  const { t } = useTranslation()

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
  useEffect(() => {
    if (previousPathname.current !== pathname) {
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
        alertType:
          (typeof data?.alertType === 'string' && data.alertType) ||
          notification.request.content.title ||
          'push_notification',
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
            <AndroidShareCardPresentation
              pathname={pathname}
              navigationReady={Boolean(navigation?.key)}
              onRestoreRoute={(path) => router.replace(path)}
            >
              <Stack
                screenOptions={{
                  headerBackTitle: t('common.back'),
                }}
              >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
                <Stack.Screen
                  name="wardrobe-capsules"
                  options={{ title: t('wardrobe.capsules.title') }}
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
              </Stack>
            </AndroidShareCardPresentation>
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

// Step 2 step 3 owner: searchable owner anchor
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native'
import Constants, { AppOwnership } from 'expo-constants'
import { useFonts } from 'expo-font'
import type { Notification } from 'expo-notifications'
import { Stack, usePathname } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useRef } from 'react'
import 'react-native-reanimated'

import { Platform, useColorScheme } from 'react-native'
import {
  MobileAnalyticsProvider,
  mobileAnalyticsClient,
} from '@/src/analytics/mobile-analytics'
import { trackMobileAlertReceived } from '@/src/analytics/track-events'

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
  type FontLoadTuple = readonly [boolean, Error | null]
  /* eslint-disable @typescript-eslint/no-unsafe-assignment */
  // Expo's types return an untyped tuple; narrow locally to satisfy type-aware linting.
  const fontLoadResult = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  }) as unknown as FontLoadTuple
  const [loaded, fontError]: FontLoadTuple = fontLoadResult
  /* eslint-enable @typescript-eslint/no-unsafe-assignment */

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (fontError) throw fontError
  }, [fontError])

  useEffect(() => {
    if (loaded) {
      void SplashScreen.hideAsync()
    }
  }, [loaded])

  if (!loaded) {
    return null
  }

  return <RootLayoutNav />
}

function RootLayoutNav() {
  /* eslint-disable @typescript-eslint/no-unsafe-assignment */
  const colorScheme = useColorScheme()
  const theme = colorScheme === 'dark' ? DarkTheme : DefaultTheme

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
    const isExpoGoAndroid =
      Platform.OS === 'android' && Constants.appOwnership === AppOwnership.Expo
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
      <ThemeProvider value={theme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
      </ThemeProvider>
    </MobileAnalyticsProvider>
  )
  /* eslint-enable @typescript-eslint/no-unsafe-assignment */
}

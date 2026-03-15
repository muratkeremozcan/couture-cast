import { useMemo, type PropsWithChildren } from 'react'
import { PostHogProvider, usePostHog } from 'posthog-react-native'
import { posthogProviderClient } from '../config/posthog'

type MobileAnalyticsValue =
  | boolean
  | number
  | string
  | null
  | MobileAnalyticsValue[]
  | { [key: string]: MobileAnalyticsValue }

type MobileAnalyticsProperties = Record<string, MobileAnalyticsValue>

type MobileAnalyticsRuntime = {
  capture: (event: string, properties?: MobileAnalyticsProperties) => void
  screen: (
    screenName: string,
    properties?: MobileAnalyticsProperties
  ) => Promise<void> | void
  getDistinctId: () => string | undefined
}

export interface MobileAnalyticsClient {
  capture(event: string, properties?: MobileAnalyticsProperties): void
  screen(screenName: string, properties?: MobileAnalyticsProperties): Promise<void> | void
  getDistinctId(): string | undefined
}

/** Story 0.7 Task 8.5 owner file: provider-neutral mobile analytics facade.
 * Why this file exists:
 * - Feature code should depend on one repo-local analytics contract instead of
 *   importing `posthog-react-native` directly.
 * - Keeping the boundary local makes a future provider swap a localized
 *   adapter task instead of a cross-screen refactor.
 * Alternatives:
 * - Keep calling `usePostHog()` in screens and components.
 * - Hide nothing and accept vendor imports throughout the app.
 * Flow refs:
 * - S0.7/T3/1: feature surfaces still emit the same analytics events.
 * - S0.7/T8.5/1: Expo/mobile analytics access now flows through a repo-local
 *   facade instead of vendor hooks in feature code.
 */
export function createMobileAnalyticsClient(
  client: MobileAnalyticsRuntime
): MobileAnalyticsClient {
  return {
    capture(event, properties) {
      client.capture(event, properties)
    },
    screen(screenName, properties) {
      return client.screen(screenName, properties)
    },
    getDistinctId() {
      const distinctId = client.getDistinctId()
      return distinctId && distinctId.length > 0 ? distinctId : undefined
    },
  }
}

export const mobileAnalyticsClient = createMobileAnalyticsClient(posthogProviderClient)

const mobileAnalyticsAutocapture = {
  captureScreens: false,
  captureTouches: true,
  propsToCapture: ['testID'],
  maxElementsCaptured: 20,
}

export function MobileAnalyticsProvider({ children }: PropsWithChildren) {
  return (
    <PostHogProvider
      client={posthogProviderClient}
      autocapture={mobileAnalyticsAutocapture}
    >
      {children}
    </PostHogProvider>
  )
}

export function useMobileAnalytics(): MobileAnalyticsClient {
  const posthog = usePostHog()
  return useMemo(
    () =>
      createMobileAnalyticsClient({
        capture(event, properties) {
          posthog.capture(event, properties)
        },
        screen(screenName, properties) {
          return posthog.screen(screenName, properties)
        },
        getDistinctId() {
          return posthog.getDistinctId()
        },
      }),
    [posthog]
  )
}

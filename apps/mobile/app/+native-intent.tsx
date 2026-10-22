// Story 6.5: system links Expo Router must not turn into screens.
import { isNativeNotificationFixtureUrl } from '@/src/lib/native-notification-fixture'

/**
 * The isolated debug app's notification fixture URL is consumed by its own listener,
 * which schedules an OS notification. Routed, it showed "This screen doesn't exist".
 * An empty path tells Expo Router not to navigate; a cold launch through the fixture
 * lands on the root.
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string
  initial: boolean
}) {
  if (isNativeNotificationFixtureUrl(path)) return initial ? '/' : ''
  return path
}

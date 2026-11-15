import { isShareCardNativeFixtureUrl } from '@/src/lib/share-card-native-fixture-url'
// Story 6.5: system links Expo Router must not turn into screens.
import { isNativeNotificationFixtureUrl } from '@/src/lib/native-notification-fixture'
import {
  isNativeOAuthCallbackPath,
  isNativeOAuthInFlight,
} from '@/src/lib/native-oauth-flight'

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
  if (isNativeNotificationFixtureUrl(path) || isShareCardNativeFixtureUrl(path))
    return initial ? '/' : ''
  // Story 6.17 D5: an OAuth callback link. While sign-in waits on it in process, the router
  // stays where it is; otherwise (a cold start from the link) it opens the callback route
  // with the link's query. Before this it fell through to +not-found.
  if (isNativeOAuthCallbackPath(path)) {
    if (isNativeOAuthInFlight()) return ''
    const query = path.includes('?') ? path.slice(path.indexOf('?')) : ''
    return `/auth/callback${query}`
  }
  return path
}

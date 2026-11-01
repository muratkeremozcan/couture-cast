import { vi } from 'vitest'
import type * as MobileAnalyticsModule from '@/src/analytics/mobile-analytics'
import type { MobileAnalyticsClient } from '@/src/analytics/mobile-analytics'

/**
 * A `vi.mock` factory result for `@/src/analytics/mobile-analytics` whose hook returns one
 * client for the life of the module, as the real hook does.
 *
 * `useMobileAnalytics` memoizes its client on the PostHog instance, and that instance never
 * changes while the provider is mounted, so screens list the client in effect and callback
 * dependencies. A mock that builds `{ capture, ... }` inside the hook hands every render a new
 * client, which re-runs those effects on each render. Under Vitest 5 that brought a dismissed
 * deep-link banner back in `hero-cache-recovery.test.tsx`: the test failed while the app was
 * correct.
 *
 * Use it from the mock factory, which runs once per test file:
 *
 *   vi.mock('@/src/analytics/mobile-analytics', async () =>
 *     (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock({
 *       capture: captureMock,
 *     })
 *   )
 *
 * Every function a test passes must come from `vi.hoisted`, because the factory reads it when
 * the module loads. Unset methods record nothing and report a fixed distinct id.
 */
export function mobileAnalyticsModuleMock(
  overrides: Partial<MobileAnalyticsClient> = {}
): Pick<typeof MobileAnalyticsModule, 'useMobileAnalytics'> {
  const client: MobileAnalyticsClient = {
    capture: vi.fn(),
    getDistinctId: () => 'test-user-id',
    screen: vi.fn(),
    ...overrides,
  }
  return { useMobileAnalytics: () => client }
}

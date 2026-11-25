/**
 * The app routes analytics may name, one list per client. A path that matches a route
 * keeps its static segments and sends `:param` for each dynamic one; any other path is
 * sent as `/:unknown`, whatever its spelling. `testing/analytics-routes.spec.ts`
 * derives both lists from `apps/web/src/app` and `apps/mobile/app` and fails when a
 * route is added or removed without updating them.
 *
 * Web routes use the Next.js folder spelling, so `[caseId]` is a dynamic segment.
 */
export const WEB_ANALYTICS_ROUTES = Object.freeze([
  '/',
  '/auth/callback',
  '/community',
  '/guardian/accept',
  '/guardian/dashboard',
  '/moderation',
  '/moderation/cases/[caseId]',
  '/moderation/evidence',
  '/moderation/sla',
  '/notification-settings',
  '/palette',
  '/preview',
  '/preview/continue',
  '/privacy',
  '/settings',
  '/signin',
  '/signup',
  '/signup/finish',
  '/teen/dashboard',
  '/terms',
  '/wardrobe',
  '/wardrobe/capsules',
  '/wardrobe/onboarding',
] as const)

/** Expo Router paths: route groups such as `(tabs)` are not part of the path. */
export const MOBILE_ANALYTICS_ROUTES = Object.freeze([
  '/',
  '/auth/callback',
  '/community',
  '/guardian-accept',
  '/guardian-dashboard',
  '/locations',
  '/modal',
  '/notification-settings',
  '/palette-advisor',
  '/planner',
  '/preview',
  '/preview-continue',
  '/settings',
  '/signin',
  '/signup',
  '/signup-finish',
  '/teen-dashboard',
  // Story 6.15 F-00i: the text layout probe's fixture; it renders nothing outside probe builds.
  '/text-clip-fixture',
  '/two',
  '/wardrobe',
  '/wardrobe-capsules',
  // Story CC-7.5 D3: the garment detail, /wardrobe-garment?id=<garment id>.
  '/wardrobe-garment',
  '/wardrobe-onboarding',
  '/wardrobe-silhouette',
] as const)

export type AnalyticsPlatform = 'web' | 'mobile'

/** What an unknown path is sent as. */
export const UNKNOWN_ANALYTICS_ROUTE = '/:unknown'
/** What a dynamic segment of a known route is sent as. */
export const ANALYTICS_ROUTE_PARAMETER = ':param'

const isDynamic = (segment: string) => /^\[[^\]]+\]$/.test(segment)
const routeSegments: Record<AnalyticsPlatform, readonly (readonly string[])[]> = {
  web: WEB_ANALYTICS_ROUTES.map((route) => route.split('/').filter(Boolean)),
  mobile: MOBILE_ANALYTICS_ROUTES.map((route) => route.split('/').filter(Boolean)),
}

/**
 * The route template for a path on `platform`: query string and fragment dropped,
 * static segments kept, dynamic segments sent as `:param`, and `/:unknown` for a path
 * that matches no known route.
 */
export function templateAnalyticsRoute(
  path: string,
  platform: AnalyticsPlatform
): string {
  const segments = path.split(/[?#]/, 1)[0]!.split('/').filter(Boolean)
  for (const route of routeSegments[platform]) {
    if (route.length !== segments.length) continue
    if (
      route.every((segment, index) => isDynamic(segment) || segment === segments[index])
    )
      return `/${route
        .map((segment) => (isDynamic(segment) ? ANALYTICS_ROUTE_PARAMETER : segment))
        .join('/')}`
  }
  return UNKNOWN_ANALYTICS_ROUTE
}

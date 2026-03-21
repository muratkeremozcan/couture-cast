# Feature flags

Updated: 2026-03-21
Reason: documented Story 0.7 PostHog-backed flag usage patterns and
fallback flow

Status: active

## Source of truth

Flag behavior is split across five files:

- `packages/config/src/flags.ts`
- `apps/api/src/posthog/posthog.service.ts`
- `apps/api/src/modules/feature-flags/feature-flags.service.ts`
- `apps/api/src/modules/feature-flags/feature-flags.repository.ts`
- `apps/api/src/modules/feature-flags/feature-flags.cron.ts`

## Canonical flag catalog

- `premium_themes_enabled`
  default: `false`
  purpose: gates premium visual themes until rollout is approved
  runtime type: boolean
- `community_feed_enabled`
  default: `false`
  purpose: gates community/social feed exposure
  runtime type: boolean
- `color_analysis_enabled`
  default: `true`
  purpose: keeps wardrobe color extraction enabled by default
  runtime type: boolean
- `weather_alerts_enabled`
  default: `true`
  purpose: keeps weather alert delivery enabled by default
  runtime type: boolean

## Request-time evaluation order

Every request-time flag read follows the same policy:

1. Validate the requested flag key against the registry in
   `packages/config/src/flags.ts`.
2. Ask the remote provider for the current PostHog answer.
3. Coerce the remote value to the declared flag type.
4. If the remote provider has no valid answer, read the cached Postgres
   fallback value.
5. If the cache is empty, return the code default from the shared registry.

This order matters because it preserves the last known rollout during PostHog
outages instead of snapping back to hardcoded defaults too early.

## Sync and cache behavior

The API keeps the fallback cache warm in two ways:

- `FeatureFlagsCron.onModuleInit()` runs a startup warm sync so fresh
  boots do not wait for the first cron tick.
- `FeatureFlagsCron.syncFeatureFlags()` refreshes the canonical flag set
  every 5 minutes.

Sync reads use the stable synthetic distinct ID
`feature-flags-fallback-sync` so the sync path can refresh shared fallback
state without pretending to be a real end user.

## Usage patterns

Use repo-local contracts, not raw vendor SDK calls, in feature code.

Preferred API-side pattern:

```ts
const enabled = await featureFlagsService.getFeatureFlag('premium_themes_enabled', userId)

if (!enabled) {
  return { locked: true }
}
```

Guidelines:

- Call `FeatureFlagsService.getFeatureFlag(...)` from API feature code.
- Keep flag keys in the shared registry; unknown keys should fail fast.
- Treat `undefined` from the remote provider as "no answer", not "false".
- Leave PostHog-specific behavior inside `PostHogService`; feature code
  should not import `posthog-node` directly.
- Keep `sendFeatureFlagEvents: false` on server-side reads unless you
  intentionally want exposure events from request-time evaluation.

## Failure-mode expectations

- Missing `POSTHOG_API_KEY`: `PostHogService` behaves like
  "remote answer unavailable" and requests fall back safely.
- PostHog outage or exception: request-time reads use the cached
  Postgres value when present.
- Empty cache plus remote miss:
  the shared registry default is returned.
- Sync-time remote miss: keep the last known cached value; do not
  overwrite healthy cache entries with defaults.

## Testing evidence

The flag flow is covered at multiple levels:

- `packages/config/src/flags.spec.ts`
- `apps/api/src/posthog/posthog.service.spec.ts`
- `apps/api/src/modules/feature-flags/feature-flags.service.spec.ts`
- `apps/api/src/modules/feature-flags/feature-flags.cron.spec.ts`

Those tests verify:

- legal flag keys and defaults
- remote value coercion
- fallback-to-cache behavior
- fallback-to-default behavior
- startup warm sync and periodic refresh

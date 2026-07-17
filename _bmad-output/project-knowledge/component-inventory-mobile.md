# Mobile component inventory

Updated: 2026-07-17 - BMAD brownfield deep scan of `apps/mobile`.

## Scan scope

This inventory describes the current Expo application under
[`apps/mobile`](../../apps/mobile). It covers file-based routing, screens, reusable
UI, state and data access, service integrations, assets, tests, release automation,
and known implementation gaps.

The app is Expo 54, React Native 0.81, React 19, and Expo Router 6. Its entry point
is `expo-router/entry`, as declared in
[`package.json`](../../apps/mobile/package.json). TypeScript is strict and maps
`@/*` to the mobile workspace root through
[`tsconfig.json`](../../apps/mobile/tsconfig.json).

## Expo Router structure

### Layouts

- [`app/_layout.tsx`](../../apps/mobile/app/_layout.tsx) is the root stack layout.
  It loads Space Mono and Font Awesome, controls the splash screen, selects the
  React Navigation light or dark theme, wraps the tree in
  `MobileAnalyticsProvider`, and tracks route changes as PostHog screen events.
- The root stack sets `(tabs)` as the initial route. It explicitly configures the
  tab group without a header and presents `modal` as a modal. Other route files
  are discovered implicitly by Expo Router.
- The root layout also installs a foreground notification-received listener on
  supported native runtimes. Android Expo Go and web skip this listener.
- [`app/(tabs)/_layout.tsx`](<../../apps/mobile/app/(tabs)/_layout.tsx>) defines
  two starter tabs, `index` and `two`, both with generic code icons. The first tab
  header links to `/modal`.
- [`app/+html.tsx`](../../apps/mobile/app/+html.tsx) supplies static web HTML, viewport
  metadata, body scroll reset, and light/dark background CSS.
- [`app/+not-found.tsx`](../../apps/mobile/app/+not-found.tsx) is the unmatched-route
  fallback and links back to `/`.

### Route inventory

| URL                   | Route file                                                                   | Rendered surface          | Current role                                  |
| --------------------- | ---------------------------------------------------------------------------- | ------------------------- | --------------------------------------------- |
| `/`                   | [`app/(tabs)/index.tsx`](<../../apps/mobile/app/(tabs)/index.tsx>)           | `TabOneScreen`            | Starter home and analytics diagnostics        |
| `/two`                | [`app/(tabs)/two.tsx`](<../../apps/mobile/app/(tabs)/two.tsx>)               | `TabTwoScreen`            | API health and alert diagnostics              |
| `/modal`              | [`app/modal.tsx`](../../apps/mobile/app/modal.tsx)                           | `ModalScreen`             | Expo starter information modal                |
| `/signup`             | [`app/signup.tsx`](../../apps/mobile/app/signup.tsx)                         | `SignupScreen`            | Signup, age gate, and guardian invitation     |
| `/guardian-accept`    | [`app/guardian-accept.tsx`](../../apps/mobile/app/guardian-accept.tsx)       | `GuardianAcceptScreen`    | Accept invitation token from query parameters |
| `/guardian-dashboard` | [`app/guardian-dashboard.tsx`](../../apps/mobile/app/guardian-dashboard.tsx) | `GuardianDashboardScreen` | Review teens and revoke consent               |
| `/teen-dashboard`     | [`app/teen-dashboard.tsx`](../../apps/mobile/app/teen-dashboard.tsx)         | `TeenDashboardScreen`     | Review guardian consent status                |

Typed routes are enabled in
[`app.json`](../../apps/mobile/app.json). The generated route declaration at
[`app/.expo/types/router.d.ts`](../../apps/mobile/.expo/types/router.d.ts) confirms
these paths, but `.expo` is generated state and is not a source file.

Only `/signup` is linked from the tab UI. The guardian and teen dashboard routes
are addressable but have no in-app entry points, role-based redirects, or
authenticated navigation shell.

## Feature screens

### Signup and age gate

[`src/features/signup/signup-screen.tsx`](../../apps/mobile/src/features/signup/signup-screen.tsx)
contains the most complete mobile feature flow:

- Collects email and birthdate with local controlled input state.
- Uses shared `@couture/utils` age-gate logic before sending a request.
- Submits eligible users to `/api/v1/auth/signup`.
- For ages 13 through 15, retains the returned teen ID and reveals the guardian
  invitation form.
- Validates guardian email through the shared HTTP contract schema.
- Supports `read_only` and `full_access` consent levels.
- Shows loading, error, success, and invitation-link states.

The screen does not collect credentials, establish a session, persist identity,
or navigate to onboarding after success.

### Guardian consent

- [`src/features/guardian/guardian-accept-screen.tsx`](../../apps/mobile/src/features/guardian/guardian-accept-screen.tsx)
  accepts a query-string token and posts it to the guardian acceptance endpoint.
  It handles missing tokens, loading, API errors, and success copy.
- [`src/features/guardian/guardian-dashboard-screen.tsx`](../../apps/mobile/src/features/guardian/guardian-dashboard-screen.tsx)
  loads a user profile, lists linked teens, formats consent timestamps in UTC, and
  performs optimistic local replacement after consent revocation.
- Both screens use injected request functions as test seams, but production requests
  currently lack authenticated user context.

### Teen dashboard

[`src/features/teen/teen-dashboard-screen.tsx`](../../apps/mobile/src/features/teen/teen-dashboard-screen.tsx)
loads the user profile, derives pending, granted, or revoked consent status from
linked guardians, and lists each guardian relationship. It has loading and
terminal error states but no retry, refresh, or navigation behavior.

### Starter and diagnostic screens

- [`app/(tabs)/index.tsx`](<../../apps/mobile/app/(tabs)/index.tsx>) remains an
  Expo template screen. It contains `EditScreenInfo`, generic "Tab One" copy, a
  link to signup, and buttons that emit ritual and wardrobe-upload analytics. Outside
  diagnostics mode, image selection and file inspection are real, but no wardrobe
  file is uploaded.
- [`app/(tabs)/two.tsx`](<../../apps/mobile/app/(tabs)/two.tsx>) remains a generic
  "Tab Two" screen. It calls the generated API health client, applies a five-second
  UI timeout, and can emit a synthetic alert event in diagnostics mode.
- [Modal route](../../apps/mobile/app/modal.tsx) is unchanged starter-style UI
  and records `modal_opened`.

## Shared and template components

| Component                                                                                              | Responsibility                                       | Assessment                                        |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------- |
| [`components/themed.tsx`](../../apps/mobile/components/themed.tsx)                                     | Theme-aware `Text`, `View`, and color lookup         | Small reusable primitive layer                    |
| [`components/styled-text.tsx`](../../apps/mobile/components/styled-text.tsx)                           | Space Mono text wrapper                              | Reusable but starter-derived                      |
| [`components/external-link.tsx`](../../apps/mobile/components/external-link.tsx)                       | External links, native in-app browser, tap analytics | Useful shared adapter                             |
| [`components/edit-screen-info.tsx`](../../apps/mobile/components/edit-screen-info.tsx)                 | Expo editing instructions                            | Development template UI; not product UI           |
| [`components/use-client-only-value.ts`](../../apps/mobile/components/use-client-only-value.ts)         | Native client-only value helper                      | Starter compatibility helper                      |
| [`components/use-client-only-value.web.ts`](../../apps/mobile/components/use-client-only-value.web.ts) | Hydration-safe web value helper                      | Starter web compatibility helper                  |
| [`components/use-color-scheme.ts`](../../apps/mobile/components/use-color-scheme.ts)                   | Native color-scheme export                           | Starter helper                                    |
| [`components/use-color-scheme.web.ts`](../../apps/mobile/components/use-color-scheme.web.ts)           | Web color-scheme hydration handling                  | Starter web helper                                |
| [`constants/colors.ts`](../../apps/mobile/constants/colors.ts)                                         | Minimal light/dark palette                           | Generic Expo palette, not a product design system |

Feature screens duplicate cards, labels, inputs, buttons, status colors, spacing,
and typography in local `StyleSheet` objects. There is no product component
library, form abstraction, screen container, navigation header pattern, or shared
loading and error component.

## State and data patterns

- State is component-local `useState`; lifecycle fetches use `useEffect`.
- There is no global store, server-state cache, query library, authentication context,
  or persisted local state.
- Data-fetching screens guard against updates after unmount with local booleans.
- Feature request functions are passed as optional props, enabling deterministic
  component tests without mocking screen internals.
- API inputs and outputs are parsed with canonical Zod schemas from
  `@couture/api-client/contracts/http`.
- The dashboard revoke flow updates the in-memory profile after a successful request.
  There is no cache invalidation or synchronization between screens.
- [`src/realtime/mobile-fallback-controller.ts`](../../apps/mobile/src/realtime/mobile-fallback-controller.ts)
  provides an idempotent socket-disconnect polling fallback using the shared
  `PollingService`. No mobile runtime imports or starts this controller, so it is
  currently an isolated utility rather than active app behavior.

## API and authentication integration

[`src/lib/api-client.ts`](../../apps/mobile/src/lib/api-client.ts) is the intended
generated-client factory. It:

- Resolves `EXPO_PUBLIC_API_BASE_URL`, falling back to `API_BASE_URL`.
- Removes trailing slashes.
- Passes client options, including a possible access-token provider, to
  `@couture/api-client`.

[`src/lib/api-health.ts`](../../apps/mobile/src/lib/api-health.ts) uses that generated
client for `/api/health`. The feature endpoints instead use small direct `fetch`
wrappers:

- [`src/lib/signup.ts`](../../apps/mobile/src/lib/signup.ts) posts signup data.
- [`src/lib/guardian.ts`](../../apps/mobile/src/lib/guardian.ts) posts guardian
  invitation, acceptance, and revocation data.
- [`src/lib/user.ts`](../../apps/mobile/src/lib/user.ts) fetches the user profile.

These wrappers still import shared schemas, parse both directions, and normalize
API errors. However, they do not use `createMobileApiClient`, attach bearer
credentials, or share transport/error handling.

No Supabase client, sign-in flow, token refresh, secure token storage, session restore,
logout, route guard, or role-based access control exists in `apps/mobile`. The API
client test proves that an injected access-token provider can be forwarded, but
no production provider supplies one.

## Analytics

[`src/analytics/mobile-analytics.tsx`](../../apps/mobile/src/analytics/mobile-analytics.tsx)
defines a provider-neutral facade over `posthog-react-native`. The root layout
installs the provider and manually tracks Expo Router path changes. Touch
autocapture is enabled for elements with `testID`; automatic screen capture is
disabled.

[`src/config/posthog.ts`](../../apps/mobile/src/config/posthog.ts) builds the PostHog
client from Expo `extra` values or public environment variables. It disables delivery
when no real key exists and configures lifecycle capture, batching, retries, and
feature-flag loading. [`app.config.ts`](../../apps/mobile/app.config.ts) loads root
environment files and exposes the PostHog host, key, and diagnostics flag.

[`src/analytics/track-events.ts`](../../apps/mobile/src/analytics/track-events.ts)
delegates canonical payload creation to shared API-client analytics wrappers for:

- `ritual_created`
- `wardrobe_upload_started`
- `alert_received`

Direct UI events also include `tab_one_viewed`, `tab_two_viewed`,
`modal_opened`, and `external_link_tapped`. No identify/reset calls connect
PostHog distinct IDs to an authenticated user because authentication is not wired.

[`src/analytics/mobile-analytics-diagnostics.tsx`](../../apps/mobile/src/analytics/mobile-analytics-diagnostics.tsx)
keeps the latest 20 events in module memory, logs them, and renders the latest five
when diagnostics are enabled. This is test/E2E support, not durable telemetry state.

## Notifications and deep links

The root layout dynamically imports `expo-notifications` and records analytics for
notifications received while the app is running. It normalizes `severity`,
`alertType`, and optional `weatherSeverity` from notification data.

Current notification wiring does not:

- Request notification permission.
- Configure a notification handler or presentation policy.
- Obtain or register an Expo/device push token.
- Associate a token with an authenticated account.
- Listen for notification responses or route users after a tap.
- Handle cold-start notification payloads.
- Configure notification channels or the `expo-notifications` config plugin.

Deep-link support is mostly implicit.
[`app.json`](../../apps/mobile/app.json) sets the custom scheme to `mobile`, and
Expo Router can resolve `/guardian-accept?token=...`.
The route reads the token with `useLocalSearchParams`. There is no explicit universal
link/app-link domain configuration, incoming-link validation, auth-aware redirect,
or notification-to-route mapping.

Guardian invitation links must be checked across API/web/mobile ownership: the mobile
route is `/guardian-accept`, while the component test fixture uses
`/guardian/accept?token=...`. The fixture alone does not prove the production API
emits the wrong path, but mobile acceptance links need an explicit routing
contract.

## Assets and platform configuration

The app includes only Expo starter assets:

- [`assets/fonts/SpaceMono-Regular.ttf`](../../apps/mobile/assets/fonts/SpaceMono-Regular.ttf)
- [`assets/images/icon.png`](../../apps/mobile/assets/images/icon.png)
- [`assets/images/adaptive-icon.png`](../../apps/mobile/assets/images/adaptive-icon.png)
- [`assets/images/splash-icon.png`](../../apps/mobile/assets/images/splash-icon.png)
- [`assets/images/favicon.png`](../../apps/mobile/assets/images/favicon.png)

[`app.json`](../../apps/mobile/app.json) configures portrait orientation, automatic
theme, static web output, the new architecture, tablet support, Android edge-to-edge,
and Expo Router typed routes. Both native identifiers remain placeholders:
`com.anonymous.mobile`. The generic scheme `mobile` and starter artwork should
also be replaced before distribution.

## Test coverage

### Unit and component tests

[`vitest.config.ts`](../../apps/mobile/vitest.config.ts) runs TypeScript component
and source tests in JSDOM, aliases React Native to React Native Web, and collects
coverage
from `app`, `components`, and `src`. [`vitest.setup.ts`](../../apps/mobile/vitest.setup.ts)
installs Testing Library cleanup and strict MSW lifecycle handling.

The current TypeScript suite contains 12 files:

- Signup tests cover underage messaging, guardian-consent messaging, eligible signup,
  and guardian invitation in
  [`signup-screen.test.tsx`](../../apps/mobile/src/features/signup/signup-screen.test.tsx).
- Guardian acceptance covers success and missing-token behavior in
  [`guardian-accept-screen.test.tsx`](../../apps/mobile/src/features/guardian/guardian-accept-screen.test.tsx).
- Guardian and teen dashboard tests cover a successful profile and consent flow
  in
  [`guardian-dashboard-screen.test.tsx`](../../apps/mobile/src/features/guardian/guardian-dashboard-screen.test.tsx)
  and
  [`teen-dashboard-screen.test.tsx`](../../apps/mobile/src/features/teen/teen-dashboard-screen.test.tsx).
- API client, generated health calls, MSW defaults, and network errors are covered
  by
  [`api-client.test.ts`](../../apps/mobile/src/lib/api-client.test.ts),
  [`api-health.test.ts`](../../apps/mobile/src/lib/api-health.test.ts), and
  [`msw-network.test.tsx`](../../apps/mobile/components/msw-network.test.tsx).
- Analytics facade and diagnostics behavior are covered by
  [`mobile-analytics.test.tsx`](../../apps/mobile/src/analytics/mobile-analytics.test.tsx)
  and
  [`mobile-analytics-diagnostics.test.ts`](../../apps/mobile/src/analytics/mobile-analytics-diagnostics.test.ts).
- Tab Two's health success and timeout fallback are covered by
  [`tab-two-screen.test.tsx`](../../apps/mobile/src/screens/tab-two-screen.test.tsx).
- Shared MonoText and external-link behavior are covered by
  [`styled-text.test.tsx`](../../apps/mobile/components/styled-text.test.tsx) and
  [`external-link.test.tsx`](../../apps/mobile/components/external-link.test.tsx).

[`components/__tests__/styled-text-test.js`](../../apps/mobile/components/__tests__/styled-text-test.js)
is a legacy JavaScript test and does not match the current Vitest include patterns.

Notable gaps include root layout and notification behavior, route parameter
integration, direct signup/guardian/user HTTP wrappers, API error states for most
screens, retry and empty states, image-picker failures, realtime fallback behavior,
auth/session behavior, and native-platform rendering.

### End-to-end tests

- [`maestro/sanity.yaml`](../../maestro/sanity.yaml) launches the app, opens the
  configured URL, switches to Tab Two, and captures a screenshot.
- [`maestro/analytics.yaml`](../../maestro/analytics.yaml) validates diagnostic
  ritual, wardrobe-upload, and alert events across both tabs.
- [`pr-mobile-e2e.yml`](../../.github/workflows/pr-mobile-e2e.yml) can build an
  Android debug APK and run either flow on an emulator, with retries and uploaded
  artifacts. It is manual-only, allowed to continue on error, and explicitly
  excluded from normal PR/main enforcement because of hosted-emulator instability.
- There are no E2E flows for signup, guardian consent, authentication, deep links,
  push notifications, dashboards, or production API integration.

## Build and deployment

Workspace scripts in [`apps/mobile/package.json`](../../apps/mobile/package.json)
build shared `@couture/utils` and `@couture/api-client` packages before typecheck,
tests, start, web, iOS, or Android commands. Available local targets are Expo start,
native `expo run`, Vitest, coverage, lint, and strict typecheck.

[`eas.json`](../../apps/mobile/eas.json) defines only a production profile. It uses
local app versions, auto-increments builds, creates Android app bundles, and defines
an empty production submit profile.

Root scripts in [`package.json`](../../package.json) expose `verify:mobile`, Android
EAS build/submit commands, Expo Go setup, and Android/iOS Maestro runners. The general
monorepo `build:apps` command builds API and web only; mobile release builds are
separate EAS operations.

[`deploy-mobile.yml`](../../.github/workflows/deploy-mobile.yml) is manual-only,
requires `EXPO_TOKEN`, and starts a non-blocking Android production build. iOS is
explicitly disabled until Apple Developer enrollment and credentials are available.
The workflow does not wait for build completion or submit a store release.

## Current gaps and brownfield priorities

1. **Replace the starter shell.** Both tabs, the modal, edit instructions, generic
   icons, palette, app identifiers, scheme, and imagery still expose Expo template
   structure rather than Couture Cast product navigation and branding.
2. **Complete authentication.** Add a real Supabase/auth session boundary, secure
   persistence and refresh, bearer-token propagation, logout, route guards, and
   role-aware navigation. Protected profile and guardian operations are not viable
   without this work.
3. **Unify API transport.** Move feature calls onto the app-local generated-client
   factory or shared API wrappers so auth, errors, retries, and contracts behave
   consistently.
4. **Finish push wiring.** Add permission UX, token registration and rotation,
   notification presentation, tap/cold-start handling, channels, routing, account
   association, and tests.
5. **Define deep-link ownership.** Align invitation URL paths and domains, configure
   universal/app links, validate incoming tokens, and preserve intended destinations
   across authentication.
6. **Create product UI primitives.** Extract accessible fields, buttons, cards,
   screen containers, feedback states, and design tokens before feature duplication
   grows.
7. **Add production navigation.** Connect signup completion, onboarding, teen and
   guardian dashboards, and consent acceptance through authenticated flows.
8. **Activate or remove dormant infrastructure.** Wire the realtime fallback into
   a real socket lifecycle when needed, and turn wardrobe selection into an upload
   or clearly isolate it as diagnostics.
9. **Raise test confidence.** Add route/layout, auth, push/deep-link, transport,
   failure-state, and feature E2E coverage. Make a stable mobile smoke gate required
   when runner infrastructure permits.
10. **Harden release delivery.** Replace placeholder identifiers, add preview/internal
    profiles, establish iOS credentials, wait on EAS outcomes, and automate store
    submission and release verification.

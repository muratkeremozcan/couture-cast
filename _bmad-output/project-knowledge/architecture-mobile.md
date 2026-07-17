# Mobile architecture

Updated: 2026-07-17 - Current-state brownfield architecture for `apps/mobile`.

<!-- markdownlint-disable MD013 -->

## Executive summary

[`apps/mobile`](../../apps/mobile) is a managed Expo 54 application using Expo Router 6,
React Native 0.81, and React 19. Its package entry point is `expo-router/entry`; route files
under [`app/`](../../apps/mobile/app) compose a root stack and a two-tab starter shell.
Product screens exist for signup, guardian invitation acceptance, guardian consent review,
and teen consent status, but they are not connected by an authenticated navigation flow.

The implemented architecture is intentionally small:

- UI and request state live in React components through `useState` and `useEffect`.
- Shared Zod contracts from `@couture/api-client` validate API requests and responses.
- API health uses the generated client; feature operations use direct `fetch` adapters.
- PostHog is installed behind a mobile-local analytics facade and tracks route changes.
- Notifications are observed only while the app is in the foreground on supported runtimes.
- Vitest, Testing Library, MSW, and two Maestro flows provide the current test layers.
- EAS configuration can produce an Android production app bundle, but release automation
  only queues a manual build and does not verify or submit it.

This is not yet the planned production mobile architecture. There is no Supabase client or
session, secure token storage, role-aware route guard, server-state cache, active Socket.io
connection, push-token registration, universal/app links, product design system, wardrobe
upload, watch/widget target, or automated store release. The older
[architecture plan](../planning-artifacts/architecture.md) describes several of those targets;
they must not be treated as current implementation.

## Evidence and authority

This document describes the current working tree, not desired architecture. Current manifests,
configuration, route files, and source code are authoritative. The lockfile is authoritative for
installed versions. Generated and synthesized references used for this scan are:

- [Mobile component inventory](component-inventory-mobile.md)
- [Integration architecture](integration-architecture.md)
- [Source tree analysis](source-tree-analysis.md)
- [Development guide](development-guide.md)
- [Deployment guide](deployment-guide.md)

Planning and roadmap documents are cited only where this document explicitly labels content as
planned. Provider-side Expo, app-store, Supabase, PostHog, and domain settings cannot be proven
from this repository.

## Exact technology stack

Core installed versions come from [`package-lock.json`](../../package-lock.json); direct mobile
dependencies and scripts are declared in
[`apps/mobile/package.json`](../../apps/mobile/package.json).

| Layer           | Current technology and version                                        |
| --------------- | --------------------------------------------------------------------- |
| Runtime/tooling | Node.js 24.x, npm 10.8.1, Turborepo 2.6.1                             |
| Language        | TypeScript 5.9.3, strict mode                                         |
| App platform    | Expo 54.0.33, managed workflow with generated native projects ignored |
| Routing         | Expo Router 6.0.23                                                    |
| UI runtime      | React 19.1.0, React Native 0.81.5                                     |
| Navigation      | React Navigation Native 7.1.20, Screens 4.16.0                        |
| Native support  | Safe Area Context 5.6.2, Reanimated 4.1.5, Worklets 0.5.1             |
| Web target      | React DOM 19.1.0, React Native Web 0.21.2, Metro static output        |
| Analytics       | PostHog React Native 4.36.1                                           |
| Testing         | Vitest 4.0.9, Testing Library React 16.3.0, MSW 2.12.10, JSDOM 27.0.1 |
| Shared code     | `@couture/api-client` and `@couture/utils` local npm workspaces       |

The app also directly declares Expo modules for application/device information, constants,
file system, fonts, image picking, linking, localization, notifications, splash screen, status
bar, and web browser. Native rendering uses Expo's new architecture
([`app.json`](../../apps/mobile/app.json)).

## Runtime and navigation architecture

### Composition root

[`app/_layout.tsx`](../../apps/mobile/app/_layout.tsx) is the runtime composition root. It:

1. Prevents the splash screen from hiding while Space Mono and Font Awesome load.
2. Selects React Navigation's default or dark theme from the device color scheme.
3. Wraps navigation in `MobileAnalyticsProvider` and `ThemeProvider`.
4. Manually records Expo Router pathname changes as PostHog screen events.
5. Installs a foreground notification listener where the runtime supports it.
6. Renders an Expo Router `Stack` with `(tabs)` as the initial route and `modal` as a modal.

The layout exports Expo Router's error boundary, but the app has no app-specific error boundary,
session provider, query provider, feature-flag provider, or notification provider.

### Route map

| Route                 | Source                                                                       | Current behavior                                      |
| --------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| `/`                   | [`app/(tabs)/index.tsx`](<../../apps/mobile/app/(tabs)/index.tsx>)           | Expo starter home, signup link, analytics diagnostics |
| `/two`                | [`app/(tabs)/two.tsx`](<../../apps/mobile/app/(tabs)/two.tsx>)               | API health and synthetic alert diagnostics            |
| `/modal`              | [`app/modal.tsx`](../../apps/mobile/app/modal.tsx)                           | Starter information modal                             |
| `/signup`             | [`app/signup.tsx`](../../apps/mobile/app/signup.tsx)                         | Signup, age gate, guardian invitation                 |
| `/guardian-accept`    | [`app/guardian-accept.tsx`](../../apps/mobile/app/guardian-accept.tsx)       | Accepts an invitation token from query parameters     |
| `/guardian-dashboard` | [`app/guardian-dashboard.tsx`](../../apps/mobile/app/guardian-dashboard.tsx) | Lists linked teens and revokes consent                |
| `/teen-dashboard`     | [`app/teen-dashboard.tsx`](../../apps/mobile/app/teen-dashboard.tsx)         | Displays guardian consent status                      |

[`app/(tabs)/_layout.tsx`](<../../apps/mobile/app/(tabs)/_layout.tsx>) creates two generic
`Tabs.Screen` entries named "Tab One" and "Tab Two", both with code icons. The first tab links to
the modal. Expo Router discovers the other routes implicitly; they do not have explicit stack
options.

Typed routes are enabled, and `.expo/types` is included by TypeScript. The `.expo` tree is generated
local state, not source. The guardian and teen dashboards are addressable but have no in-app entry
points, role redirects, or authenticated shell. Signup reports success but does not navigate to
onboarding.

### Deep-link resolution

Expo Router provides path resolution, and the app declares the custom scheme `mobile`. The
guardian acceptance screen reads `token` with `useLocalSearchParams`, so
`mobile:///guardian-accept?token=...` can resolve in principle. There is no explicit incoming-link
validation layer, auth-aware continuation, or route allowlist.

The API/web convention uses `/guardian/accept`, while mobile owns `/guardian-accept`. The repository
does not define a single invitation-link routing contract across those surfaces.

## Component architecture

Route files are thin for signup and guardian/teen features: they import screen implementations from
[`src/features`](../../apps/mobile/src/features). Starter tab and modal code remains under `app`.

Reusable UI is limited to:

- theme-aware `Text` and `View` primitives in
  [`components/themed.tsx`](../../apps/mobile/components/themed.tsx);
- a Space Mono text wrapper;
- an external-link adapter using Expo WebBrowser on native;
- color-scheme and hydration compatibility helpers; and
- the starter editing-instructions component.

Feature screens define their own `StyleSheet` objects and duplicate cards, controls, labels,
spacing, typography, status colors, loading text, and error text. There is no product component
library, token package, form abstraction, shared screen container, accessibility policy, or common
loading/error/empty-state component. [`constants/colors.ts`](../../apps/mobile/constants/colors.ts)
contains only the generic Expo light/dark palette.

## State and data architecture

Current state is local and ephemeral:

- Controlled inputs, request flags, response messages, selected consent level, and loaded profiles
  use `useState`.
- Initial dashboard requests run in `useEffect`.
- Screens use local unmount guards to avoid setting state after disposal.
- Request functions can be injected through screen props as deterministic test seams.
- Guardian revocation replaces the successful profile in component memory.
- Analytics diagnostics retain the latest 20 events in module memory.

There is no global client state, React context for domain state, Zustand/Redux store, TanStack Query
or other server-state cache, persisted local state, offline queue, cross-screen invalidation, or
session restore. The isolated
[`mobile-fallback-controller.ts`](../../apps/mobile/src/realtime/mobile-fallback-controller.ts)
can start shared polling after a socket disconnect and stop it after reconnect, but no runtime
imports it and no production mobile socket exists.

The architecture plan's Zustand coordinator, cached product surfaces, and Socket.io behavior are
planned concepts, not current mobile code.

## API and authentication

### Implemented API boundary

[`src/lib/api-client.ts`](../../apps/mobile/src/lib/api-client.ts) is the app-local factory for the
shared generated client. It:

- selects `EXPO_PUBLIC_API_BASE_URL`, then `API_BASE_URL`;
- rejects missing configuration;
- strips trailing slashes; and
- forwards `ApiClientOptions`, including an optional access-token provider.

The health adapter uses this generated client. Signup, guardian invitation/acceptance/revocation,
and user profile reads instead use direct `fetch` wrappers under
[`src/lib`](../../apps/mobile/src/lib). These wrappers still import canonical request and response
schemas from `@couture/api-client/contracts/http`, parse both sides with Zod, and normalize API
errors. They do not share the generated client's transport or attach credentials.

The mobile API boundary is therefore contract-shared but transport-split. Public signup and
guardian acceptance can work without a session, while profile and revocation endpoints require the
API's Bearer-token guard and are not viable as production mobile flows in their current form.

### Authentication status

Authentication is not implemented in `apps/mobile`. Specifically, there is no:

- Supabase client or login UI;
- credential collection during signup;
- access/refresh-token acquisition;
- Keychain/Keystore-backed secure storage dependency;
- session restore, refresh, logout, or account switching;
- production access-token provider passed to `createMobileApiClient`; or
- route guard and role/guardian-consent-aware navigation.

Server-side Supabase JWT validation, role checks, guardian-consent checks, and database RLS exist
outside this app. They do not make the mobile client authenticated. The planned Supabase Auth/JWT
architecture remains a target until the client session boundary is implemented.

## Analytics

[`src/analytics/mobile-analytics.tsx`](../../apps/mobile/src/analytics/mobile-analytics.tsx)
defines a provider-neutral `MobileAnalyticsClient` over PostHog. Feature code can capture events,
record screens, and obtain the current distinct ID without importing the vendor directly.

Current behavior:

- Root navigation changes are manually tracked as screen events.
- Touch autocapture is enabled only for captured elements exposing `testID`.
- Automatic screen capture is disabled.
- PostHog lifecycle events are enabled.
- Events batch at 20, flush every 10 seconds, and retry failed requests three times.
- Feature flags preload, but no mobile code uses a flag to branch behavior.
- A missing or placeholder key disables delivery.
- Diagnostics record and log events in memory for tests and Maestro.

Shared contract wrappers emit `ritual_created`, `wardrobe_upload_started`, and `alert_received`.
Starter surfaces also emit direct UI events such as tab views, modal opening, and external-link
taps. Event properties can include user, location, item, file-size, alert, and timestamp fields.
Because auth is absent, PostHog identify/reset is not connected to account lifecycle, and some
diagnostic flows use synthetic or anonymous identifiers.

## Notifications, realtime, and deep links

The root layout dynamically imports `expo-notifications` and registers
`addNotificationReceivedListener` except on web and Android Expo Go. Foreground messages are
normalized into an `alert_received` analytics event.

The current app does not:

- request notification permission or explain the purpose;
- configure foreground presentation behavior;
- request, register, refresh, or revoke an Expo/device push token;
- bind a token to an authenticated account;
- create Android notification channels;
- listen for notification responses or route after a tap;
- process a notification that launched the app; or
- include the `expo-notifications` config plugin in `app.json`.

The API has Expo Push delivery and persistent token concepts, but current mobile code does not join
that delivery path. Likewise, Socket.io and polling contracts exist elsewhere in the repository,
but no active mobile realtime client consumes them.

Universal links and Android app links are not configured. No associated domains, intent filters,
notification-to-route map, or preserved post-auth destination exists.

## Assets and application configuration

The checked-in assets are Expo starter assets:

- [`assets/fonts/SpaceMono-Regular.ttf`](../../apps/mobile/assets/fonts/SpaceMono-Regular.ttf)
- [`assets/images/icon.png`](../../apps/mobile/assets/images/icon.png)
- [`assets/images/adaptive-icon.png`](../../apps/mobile/assets/images/adaptive-icon.png)
- [`assets/images/splash-icon.png`](../../apps/mobile/assets/images/splash-icon.png)
- [`assets/images/favicon.png`](../../apps/mobile/assets/images/favicon.png)

Static Expo configuration currently sets:

- name `Couture Cast`, slug `couture-cast`, owner `muratkerem`, and version `1.0.0`;
- portrait orientation, automatic color scheme, and new architecture enabled;
- iPad support and `ITSAppUsesNonExemptEncryption: false`;
- Android edge-to-edge, predictive-back disabled, and version code 6;
- Metro with static output for web;
- plugins for Expo Router and localization; and
- typed Expo Router routes.

The iOS bundle identifier and Android package are both `com.anonymous.mobile`, and the custom scheme
is the generic `mobile`. These values and all artwork are placeholders for distribution.

[`app.config.ts`](../../apps/mobile/app.config.ts) loads root environment files without overriding
inherited variables, then exposes PostHog key, host, and diagnostics through Expo `extra`.
Precedence is:

1. inherited process environment;
2. root `.env.local`;
3. root `.env.prod` when `NODE_ENV=production`, otherwise root `.env.preview`; and
4. root `.env`.

The API base URL is read directly from the public/runtime environment by client code, not from
Expo `extra`. No populated environment file is committed. EAS configuration does not declare API
or PostHog values, so hosted builds depend on externally injected environment settings.

## Source tree

```text
apps/mobile/
├── app/                         Expo Router route entries
│   ├── _layout.tsx              root stack, themes, analytics, foreground notifications
│   ├── (tabs)/                  two-tab starter navigator and diagnostic screens
│   ├── signup.tsx               signup route wrapper
│   ├── guardian-accept.tsx      invitation-token route wrapper
│   ├── guardian-dashboard.tsx   guardian consent route wrapper
│   ├── teen-dashboard.tsx       teen consent-status route wrapper
│   ├── modal.tsx                starter modal
│   ├── +not-found.tsx           unmatched route
│   └── +html.tsx                static web HTML shell
├── src/
│   ├── features/                signup, guardian, and teen screen implementations
│   ├── lib/                     generated-client factory and direct HTTP adapters
│   ├── analytics/               facade, typed wrappers, diagnostics
│   ├── config/posthog.ts        PostHog client configuration
│   ├── realtime/                dormant socket-to-polling fallback controller
│   ├── screens/                 extracted Tab Two diagnostics screen
│   └── test-utils/msw/          HTTP handlers and strict test server
├── components/                  reusable and starter-derived components
├── constants/                   starter color palette
├── assets/                      font and app artwork
├── package.json                 workspace scripts and Expo Router entry
├── app.json                     static Expo/native identity
├── app.config.ts                root env loading and dynamic Expo extra
├── eas.json                     production EAS profile
├── tsconfig.json                strict TypeScript and @/* alias
├── vitest.config.ts             JSDOM component/unit tests
└── vitest.setup.ts              Testing Library and MSW lifecycle
```

Generated `.expo`, `android`, `ios`, `dist`, coverage, and dependency trees are not source. Native
projects are generated by Expo prebuild. Root [`maestro/`](../../maestro) owns packaged mobile E2E
flows.

## Development

Use Node 24 and run commands from the repository root. Mobile pre-scripts build
`@couture/utils` and `@couture/api-client` before typecheck, tests, Expo start, web, iOS,
or Android.

```bash
npm ci
npm run start --workspace mobile
npm run android --workspace mobile
npm run ios --workspace mobile
npm run web --workspace mobile
```

`start` launches Metro/Expo. `android` and `ios` use `expo run:*`, not Expo Go. The root
`npm run dev` does not start mobile. The app needs a device-reachable
`EXPO_PUBLIC_API_BASE_URL` or `API_BASE_URL` before API calls can work.

Focused validation is:

```bash
npm run verify:mobile
npm run typecheck --workspace mobile
npm run lint --workspace mobile
npm run test --workspace mobile
npm run test:coverage --workspace mobile
```

Local Maestro entry points are `npm run test:mobile:e2e:android` and
`npm run test:mobile:e2e:ios`. See the [development guide](development-guide.md) for host
prerequisites and orchestration details.

## Build and deployment

[`eas.json`](../../apps/mobile/eas.json) defines only `production`:

- app versions come from local configuration;
- native build numbers auto-increment;
- Android emits an app bundle;
- iOS requests the `m-medium` resource class; and
- the production submit profile is empty.

The manual [`deploy-mobile.yml`](../../.github/workflows/deploy-mobile.yml) workflow validates
`EXPO_TOKEN`, runs EAS from `apps/mobile`, and submits an Android production build request with
`--no-wait`. It does not wait for success, build iOS, run Maestro, submit to Google Play, verify the
store artifact, publish an EAS update, or implement rollback.

The root also has an `app.json` with a different EAS project ID. Current repository commands run
from `apps/mobile`, so the app-local project is expected to win. Running Expo/EAS at the repository
root is ambiguous and is not a supported mobile release path.

The manual [`pr-mobile-e2e.yml`](../../.github/workflows/pr-mobile-e2e.yml) workflow generates a
clean Android project, assembles a debug APK, and runs one selected Maestro flow on an emulator.
It is `continue-on-error`, allows retries, and does not test the EAS production artifact. iOS
delivery remains disabled pending Apple enrollment and credentials.

## Testing architecture

[`vitest.config.ts`](../../apps/mobile/vitest.config.ts) uses JSDOM, automatic JSX, maps
`react-native` to `react-native-web`, and resolves `@` to the app root. Tests under `components`
and `src` match `*.test.ts(x)` or `*.spec.ts(x)`. Coverage includes `app`, `components`, and `src`,
although route files themselves are not currently covered by matching test files.

The TypeScript suite covers:

- signup age bands and guardian invitation;
- guardian acceptance and guardian/teen dashboard success behavior;
- API-client configuration, health calls, and MSW network errors;
- analytics facade and diagnostics;
- Tab Two health success and timeout fallback; and
- themed text and external-link behavior.

MSW starts with strict unhandled-request behavior and is reset between tests. A legacy JavaScript
test under `components/__tests__` does not match the active Vitest include patterns.

Maestro has two flows:

- [`maestro/sanity.yaml`](../../maestro/sanity.yaml) checks app launch and tab navigation.
- [`maestro/analytics.yaml`](../../maestro/analytics.yaml) checks diagnostic analytics events.

There are no mobile E2E flows for signup, auth, guardian consent, dashboards, deep links, push
notifications, wardrobe uploads, or production API integration. Native rendering is not exercised
by JSDOM/React Native Web component tests.

## Security and privacy

### Current controls

- TypeScript strict mode and shared Zod schemas validate mobile API payloads.
- API base URL absence fails explicitly rather than silently selecting a production service.
- Under-13 signup is blocked by shared age-gate logic; ages 13-15 enter guardian-consent handling.
- The app does not currently upload a selected wardrobe image.
- PostHog delivery disables itself without a real key.
- Environment files and secrets are expected to remain outside version control.

Server-side JWT guards, role/consent authorization, RLS, and immutable consent audit records are
important system controls, but they are not mobile session controls. See the
[integration architecture](integration-architecture.md#http-and-authentication-flow).

### Current privacy exposure and gaps

- Signup sends email and birthdate to the API; guardian invitation sends guardian email, teen ID,
  and requested consent level.
- Dashboard/profile responses can contain teen/guardian relationships and consent timestamps.
- Analytics can include persistent distinct IDs and user, location, item, file-size, and alert
  properties. No authenticated identify/reset lifecycle or documented mobile minimization layer
  exists.
- Diagnostics log events locally; they must not be enabled for production with sensitive values.
- The app has no secure token storage because it has no session implementation.
- Deep-link invitation tokens have no app-local validation or redaction boundary before use.
- Notification payload data is converted to analytics without a documented payload allowlist.
- Legal review of minor-data notices, retention, deletion, and guardian consent remains open in
  [COPPA compliance](coppa-compliance.md).

Do not interpret the "COPPA-ready signup" screen label as legal approval. The compliance document
explicitly remains a draft requiring counsel review.

## Current gaps and priorities

1. **Authentication is absent.** Implement Supabase session creation, secure persistence, refresh,
   logout, bearer propagation, and auth/role/consent-aware route boundaries.
2. **Feature transport is inconsistent.** Move direct feature calls behind one app-local transport
   so token attachment, errors, timeouts, retries, and Zod validation are consistent.
3. **Navigation is still a starter shell.** Replace generic tabs/modal and connect signup,
   onboarding, invitation continuation, and role-specific dashboards.
4. **Push is receive-only.** Add permission UX, channels, token registration/rotation, user binding,
   presentation behavior, tap/cold-start routing, and tests.
5. **Deep-link ownership is unresolved.** Align `/guardian/accept` and `/guardian-accept`, configure
   associated domains/intent filters, validate tokens, and preserve destinations through auth.
6. **Realtime code is dormant.** Either wire an authorized Socket.io lifecycle and polling fallback
   or remove/isolate the unused controller until a product flow needs it.
7. **State does not scale across screens.** Introduce session and server-state boundaries before
   adding interconnected ritual, wardrobe, alert, and community features.
8. **Product UI foundations are missing.** Replace starter assets and identifiers; establish
   accessible controls, feedback states, screen patterns, and design tokens.
9. **Wardrobe selection is diagnostic only.** No upload, secure storage handoff, progress state,
   moderation result, or consent-gated media flow exists.
10. **Privacy controls need a mobile design.** Define analytics minimization, consent/notice,
    notification payload policy, token/link redaction, deletion/export UX, and diagnostics policy.
11. **Test coverage stops below production behavior.** Add layout/route, auth, transport failure,
    deep-link, push, native-rendering, and end-to-end product-flow coverage.
12. **Release delivery is incomplete.** Replace placeholder identity, add Preview/internal profiles,
    establish iOS credentials, gate EAS artifacts, automate submission, and document rollback.

## Planned architecture that is not implemented

The [architecture plan](../planning-artifacts/architecture.md) describes Expo ritual screens,
Zustand coordination, Supabase Auth/JWT, Socket.io, Expo Push, signed wardrobe uploads to Supabase
Storage, shared design tokens, watch/widgets, app-store delivery, and OTA updates. The current tree
contains foundations for only some of those directions.

In particular, database models, API modules, event schemas, installed Expo modules, or planning
language do not prove that a mobile runtime flow exists. A capability should be called implemented
only after it is reachable from the Expo Router tree, configured for supported native platforms,
connected to authenticated production boundaries where required, and covered at an appropriate
test level.

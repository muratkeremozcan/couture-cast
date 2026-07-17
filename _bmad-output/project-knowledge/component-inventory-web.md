# Web component inventory

Updated: 2026-07-17 - BMAD brownfield deep scan of `apps/web`.

## Scope and boundary legend

This inventory describes the checked-in Next.js web application, its supporting modules, and the
web-focused tests found under `playwright/`.

- **Server page/layout** means a React Server Component with no `'use client'` directive.
- **Client leaf** means an explicitly client-side component mounted beneath a server page.
- **Route handler** means a Next.js HTTP endpoint, not a React component.
- Paths in this document are relative to this file's directory.

The application uses the Next.js App Router. The current design mostly keeps route shells on the
server and pushes hooks, browser APIs, form submissions, polling, and analytics into client leaves.

## Route inventory

### `/`

- **Server page:** [`src/app/page.tsx`](../../apps/web/src/app/page.tsx).
- Renders the landing page, header, in-page navigation, hero, signup link, and a static systems
  status panel.
- Mounts two client leaves:
  [`AnalyticsEventActions`](../../apps/web/src/app/components/analytics-event-actions.tsx) and
  [`PostHogClickTracker`](../../apps/web/src/app/components/posthog-click-tracker.tsx).
- The page itself performs no server-side data fetch.

### `/signup`

- **Server page:** [`src/app/signup/page.tsx`](../../apps/web/src/app/signup/page.tsx).
- Provides explanatory signup copy and a link back to `/`.
- Mounts the **client leaf**
  [`SignupForm`](../../apps/web/src/app/signup/signup-form.tsx), which owns age-gate state, signup,
  guardian invitation, validation feedback, and pending states.

### `/guardian/accept`

- **Async server page:**
  [`src/app/guardian/accept/page.tsx`](../../apps/web/src/app/guardian/accept/page.tsx).
- Awaits `searchParams`, normalizes the first `token` value, and passes it to the client.
- Mounts the **client leaf**
  [`GuardianAcceptView`](../../apps/web/src/app/guardian/accept/guardian-accept-view.tsx), which
  submits the invitation acceptance and renders success or error feedback.

### `/guardian/dashboard`

- **Server page:**
  [`src/app/guardian/dashboard/page.tsx`](../../apps/web/src/app/guardian/dashboard/page.tsx).
- Supplies the visual page shell and back link, without loading data on the server.
- Mounts the **client leaf**
  [`GuardianDashboardView`](../../apps/web/src/app/guardian/dashboard/guardian-dashboard-view.tsx).
  The leaf loads the current profile and supports consent revocation.

### `/teen/dashboard`

- **Server page:**
  [`src/app/teen/dashboard/page.tsx`](../../apps/web/src/app/teen/dashboard/page.tsx).
- Supplies the visual page shell and back link, without loading data on the server.
- Mounts the **client leaf**
  [`TeenDashboardView`](../../apps/web/src/app/teen/dashboard/teen-dashboard-view.tsx). The leaf
  loads the current profile and derives guardian-consent status for display.

### `/api/health`

- **Route handler:** [`src/app/api/health/route.ts`](../../apps/web/src/app/api/health/route.ts).
- `GET` returns service status, environment, deployment URL, UTC timestamp, and Git SHA/branch.
- Git values come from [`git-metadata.ts`](../../apps/web/git-metadata.ts), which prefers build or
  platform environment values and falls back to local Git commands.

## Layouts and framework boundaries

- **Server root layout:** [`src/app/layout.tsx`](../../apps/web/src/app/layout.tsx) loads local
  Geist fonts, imports global Tailwind CSS, emits `<html lang="en">`, and wraps every route.
- There are no nested route layouts, route groups, templates, loading boundaries, or Suspense
  boundaries under `src/app`.
- **Client global error boundary:** [`src/app/error.tsx`](../../apps/web/src/app/error.tsx) captures
  page-view and retry analytics, exposes `reset()`, and links home. It emits its own `<html>` and
  `<body>`.
- **Server not-found boundary:** [`src/app/not-found.tsx`](../../apps/web/src/app/not-found.tsx)
  renders static 404 content and a home link. It also emits its own `<html>` and `<body>`.
- Shared styling is Tailwind-driven, with a small global color and body-font layer in
  [`src/app/globals.css`](../../apps/web/src/app/globals.css).
- No middleware file, route guard, provider tree, context provider, or app-level navigation shell
  is present in `apps/web`.

## Form and action components

### `SignupForm`

[`src/app/signup/signup-form.tsx`](../../apps/web/src/app/signup/signup-form.tsx) is a client form
with two sequential actions:

1. It validates birthdate locally with `@couture/utils`, blocks users under 13, and calls
   `submitWebSignup` for eligible users.
2. For ages requiring consent, it reveals guardian email and consent-level inputs and calls
   `inviteGuardianFromWeb`.

It uses controlled inputs and local state for values, success/error messages, returned invitation
links, and independent submission flags. Shared HTTP contract types and Zod schemas validate the
guardian email and API payloads. The form uses browser event handlers; there are no Next.js Server
Actions or native progressive-enhancement action targets.

### `GuardianAcceptView`

[`GuardianAcceptView`](../../apps/web/src/app/guardian/accept/guardian-accept-view.tsx)
is a client action panel. It requires the server-extracted invitation token, calls
`acceptGuardianInvitationFromWeb`, disables its button while pending, and presents an ARIA live
success or error message.

### `GuardianDashboardView`

[`GuardianDashboardView`](../../apps/web/src/app/guardian/dashboard/guardian-dashboard-view.tsx)
is both a display and action component. It fetches the profile after mount, renders linked teens,
and calls `revokeGuardianConsentFromWeb`. On success it updates only the selected teen in local
state to `revoked`; it does not refetch or invalidate a shared cache.

### `AnalyticsEventActions`

[`AnalyticsEventActions`](../../apps/web/src/app/components/analytics-event-actions.tsx)
provides three landing-page interactions:

- A primary CTA that records `ritual_created` and deliberately prevents navigation.
- A secondary anchor to `#wardrobe` with delegated click analytics attributes.
- A hidden image picker that records `wardrobe_upload_started`, then clears the selected file.

It also creates one generated API client and polls events immediately and every 30 seconds. Alert
channels are converted through shared typed analytics wrappers and sent to browser analytics.
Polling failures are intentionally swallowed until the next interval.

## Display components

- The landing page in [`src/app/page.tsx`](../../apps/web/src/app/page.tsx) is currently monolithic;
  its header, navigation, hero, and health panel are not extracted display components.
- [`TeenDashboardView`](../../apps/web/src/app/teen/dashboard/teen-dashboard-view.tsx) renders
  loading, load-error, empty-guardian, granted, pending, and revoked states. Consent dates are
  formatted in UTC.
- [`GuardianDashboardView`](../../apps/web/src/app/guardian/dashboard/guardian-dashboard-view.tsx)
  renders loading, load-error, empty-teen, linked-teen, mutation-error, and mutation-success states.
- [`GuardianAcceptView`](../../apps/web/src/app/guardian/accept/guardian-accept-view.tsx) combines
  explanatory display and its single action rather than delegating to a separate presentational
  component.
- No shared button, input, field, alert, card, dashboard list, header, or navigation component
  library exists in `apps/web`.

## Infrastructure modules

- [`src/lib/api-client.ts`](../../apps/web/src/lib/api-client.ts) is the app-local generated SDK
  factory. It trims `NEXT_PUBLIC_API_BASE_URL`, defaults to same-origin, and always includes
  credentials.
- [`src/lib/events-client.ts`](../../apps/web/src/lib/events-client.ts) adapts the generated raw
  events-poll operation and returns parsed JSON.
- [`src/lib/signup.ts`](../../apps/web/src/lib/signup.ts) is a handwritten `fetch` adapter for
  signup. It validates request and response bodies with shared contract schemas.
- [`src/lib/guardian.ts`](../../apps/web/src/lib/guardian.ts) contains handwritten `fetch` adapters
  for invite, accept, and revoke operations, with shared contract validation.
- [`src/lib/user.ts`](../../apps/web/src/lib/user.ts) contains the handwritten authenticated profile
  fetch and validates its response with the shared schema.
- [`src/app/lib/fallback.ts`](../../apps/web/src/app/lib/fallback.ts) switches a shared polling
  service on for socket disconnect and off on reconnect. It is not wired into an application route
  or component.
- [`src/analytics/browser-analytics.ts`](../../apps/web/src/analytics/browser-analytics.ts) wraps
  PostHog initialization, capture, distinct ID lookup, and an in-memory browser test hook.
- [`instrumentation-client.ts`](../../apps/web/instrumentation-client.ts) is the sole browser
  analytics initialization entry point.
- [`next.config.ts`](../../apps/web/next.config.ts) loads root environment files, exposes build and
  PostHog values, rewrites `/ingest/*` to PostHog, and optionally proxies `/api/v1/*` to the API.
- [`git-metadata.ts`](../../apps/web/git-metadata.ts) supplies build identity to both Next config and
  the health route.

## State and data-fetch patterns

- State is component-local React `useState`; there is no Redux, Zustand, Context state container,
  React Query, SWR, or normalized cache.
- Dashboard reads happen in `useEffect` after hydration. Both dashboards independently call the
  same profile endpoint and protect post-unmount updates with a local `isMounted` flag.
- Signup, invitation acceptance, and consent revocation are imperative client mutations.
- Mutation dependencies can be injected through component props, which makes component tests
  deterministic without mocking implementation internals.
- The guardian dashboard performs an optimistic-looking local replacement only after the server
  confirms revocation. There is no rollback need because state changes after success.
- Event polling stores its cursor and generated client in `useRef`; its interval is cleaned up on
  unmount.
- No route uses server-side fetching, Next.js request memoization, cache tags, revalidation,
  streaming, Suspense, or server prefetch/hydration.

## API integration

All user-facing API requests include cookies with `credentials: 'include'`. The browser resolves
API traffic in one of two ways:

- `NEXT_PUBLIC_API_BASE_URL` sends calls directly to an explicit origin.
- An empty public base URL sends same-origin `/api/v1/*` calls, which `next.config.ts` can rewrite
  to an API environment selected from production, Vercel, generic, or preview variables.

Current endpoint usage:

- `POST /api/v1/auth/signup` from `submitWebSignup`.
- `POST /api/v1/guardian/invitations` from `inviteGuardianFromWeb`.
- `POST /api/v1/guardian/accept` from `acceptGuardianInvitationFromWeb`.
- `POST /api/v1/guardian/revoke` from `revokeGuardianConsentFromWeb`.
- `GET /api/v1/user/profile` from `getUserProfileFromWeb`.
- `GET /api/v1/events/poll` through the generated SDK in `pollWebEvents`.

The adapters use canonical types and Zod schemas from `@couture/api-client/contracts/http`.
However, only event polling uses the generated `DefaultApi`; the other five operations duplicate
request paths and methods in app-local `fetch` wrappers.

## Analytics and feature flags

- PostHog is initialized once from
  [`instrumentation-client.ts`](../../apps/web/instrumentation-client.ts).
- The browser wrapper disables production transport when no `POSTHOG_API_KEY` is available and
  enables history-change page views, autocapture, exception capture, and batching in normal mode.
- [`PostHogClickTracker`](../../apps/web/src/app/components/posthog-click-tracker.tsx) delegates
  document clicks from `data-ph-*` attributes and converts property names to snake case.
- [`AnalyticsEventActions`](../../apps/web/src/app/components/analytics-event-actions.tsx) uses
  shared typed wrappers for `ritual_created`, `wardrobe_upload_started`, and `alert_received`.
- [`src/app/error.tsx`](../../apps/web/src/app/error.tsx) directly captures error page and retry
  events.
- `window.__enableAnalyticsTestHook`, `window.__analyticsBindingsReady`, and
  `window.__capturedAnalyticsEvents` are test instrumentation, not product feature flags.
- No application code reads a feature flag, payload, experiment assignment, or local fallback.
  PostHog may make its normal flags request, but the UI has no flag-controlled branch.

## Test coverage inventory

### Component and module tests

Vitest uses jsdom by default and can run the same suite in headed or headless Chromium. The setup
installs Testing Library, global CSS, and MSW, and fails tests on unhandled `/api/` requests:

- [`vitest.config.ts`](../../apps/web/vitest.config.ts)
- [`vitest.browser.config.ts`](../../apps/web/vitest.browser.config.ts)
- [`vitest.headless.config.ts`](../../apps/web/vitest.headless.config.ts)
- [`vitest.setup.ts`](../../apps/web/vitest.setup.ts)
- [`src/test-utils/msw/handlers.ts`](../../apps/web/src/test-utils/msw/handlers.ts)

There are 24 checked-in Vitest test cases across eight files:

- [`signup-form.test.tsx`](../../apps/web/src/app/signup/signup-form.test.tsx): age messages,
  eligible signup, and guardian invitation flow.
- [`teen-dashboard-view.test.tsx`](../../apps/web/src/app/teen/dashboard/teen-dashboard-view.test.tsx):
  granted, pending, revoked, empty, and load-error states.
- [`guardian-accept-view.test.tsx`](../../apps/web/src/app/guardian/accept/guardian-accept-view.test.tsx):
  successful acceptance and missing token.
- [`guardian dashboard tests`](../../apps/web/src/app/guardian/dashboard/guardian-dashboard-view.test.tsx):
  successful and failed revocation, load failure, and selection among multiple teens.
- [`analytics-event-actions.test.tsx`](../../apps/web/src/app/components/analytics-event-actions.test.tsx):
  ritual, upload, alert polling, and polling-failure resilience.
- [`analytics style test`](../../apps/web/src/app/components/analytics-event-actions.style.test.tsx):
  primary CTA utility classes.
- [`posthog-click-tracker.test.tsx`](../../apps/web/src/app/components/posthog-click-tracker.test.tsx):
  delegated capture and ignored unannotated clicks.
- [`api-client.test.ts`](../../apps/web/src/lib/api-client.test.ts): explicit-origin normalization,
  auth option forwarding, credentials, and same-origin fallback.

Coverage output is configured for all `src/**/*.ts(x)` files with text, JSON summary, and LCOV
reporters. No minimum line, branch, function, or statement thresholds are configured.

### Browser and end-to-end coverage

- [`playwright/tests/home.spec.ts`](../../playwright/tests/home.spec.ts) checks landing-page smoke,
  health, event polling, core visibility, and WCAG A/AA axe results.
- [`playwright/tests/home-analytics-capture.spec.ts`](../../playwright/tests/home-analytics-capture.spec.ts)
  verifies a typed `ritual_created` event through the browser test hook.
- [`analytics resilience test`](../../playwright/tests/home-analytics-resilience.spec.ts)
  verifies key home interactions during poll failure.
- [`playwright/tests/guardian-consent-ui.spec.ts`](../../playwright/tests/guardian-consent-ui.spec.ts)
  covers teen signup, guardian invite/accept, guardian dashboard, revocation, and API enforcement.
  Its write-path cases are skipped outside local runs until remote cleanup isolation exists.
- [`playwright/tests/web-health-sha.spec.ts`](../../playwright/tests/web-health-sha.spec.ts) verifies
  health metadata and expected deployment SHA.
- [`playwright/tests/realtime-fallback.spec.ts`](../../playwright/tests/realtime-fallback.spec.ts)
  exercises the otherwise-unwired socket polling fallback as an imported module.

## Concrete gaps and scan findings

### Routing and server/client architecture

- Dashboard data is fetched only after client hydration, despite server pages being available to
  load it. This adds loading flashes and gives up server rendering, streaming, and route-level
  authorization opportunities.
- No middleware or route-level authorization protects `/guardian/dashboard` or `/teen/dashboard`.
  Cookie inclusion alone does not prevent a user from opening the wrong role's page shell.
- There are no route loading files or Suspense boundaries, so asynchronous UX is implemented only
  as leaf-level text.
- Root metadata still says `Create Next App` and `Generated by create next app`.

### Product behavior and component completeness

- The landing navigation links to `#wardrobe` and `#community`, but the page defines no elements
  with those IDs. Those links change the URL without reaching corresponding content.
- The primary “Preview outfits” CTA records analytics and prevents navigation; it does not preview
  outfits or start a ritual.
- “Start wardrobe upload” records file metadata and clears the input; it does not upload a file.
- The visible systems-health panel is static copy and does not read `/api/health` or service state.
- Repeated page shells, buttons, alerts, form fields, cards, and dashboard rows have no shared
  component primitives, increasing style and accessibility drift risk.

### Data and API robustness

- Signup, guardian, and user adapters hand-code routes that are already represented by shared
  contracts. They should converge on generated SDK operations to avoid path, method, and error
  handling drift.
- `pollWebEvents` casts raw JSON to its response union without runtime schema validation and does
  not explicitly reject non-success HTTP responses before reading the body.
- Error-body readers are duplicated across three modules and only recognize a top-level `message`.
- Dashboard fetches have no abort signal, retry policy, stale-data policy, deduplication, or shared
  cache. The `isMounted` guard avoids state writes but does not cancel network work.
- Consent revocation changes local status but retains the old consent-granted date and does not
  reconcile against a refreshed profile.
- The socket fallback controller is tested but unused, while the home page always polls every
  30 seconds. There is no live socket integration that activates the fallback conditionally.

### Analytics and flags

- Typed shared event wrappers and attribute-based delegated tracking coexist; the latter has weaker
  compile-time property guarantees.
- Analytics identity falls back to the literal `web-anonymous-user`, which can collapse multiple
  tokenless visitors into one analytics identity for explicit events.
- Feature flags are not consumed anywhere in the web app, and there are no tested fallback branches
  for flag-controlled behavior.
- The client-exposed token is named `POSTHOG_API_KEY` rather than a clearly public-prefixed
  variable, even though Next config deliberately injects it into the browser bundle.

### Test gaps

- No Vitest tests directly cover route pages, the root layout, global error boundary, not-found
  boundary, health route, Git metadata, handwritten signup/guardian/user fetch adapters, event
  response parsing, or browser analytics initialization.
- There is no browser route test for `/teen/dashboard`, role mismatch, unauthenticated redirects,
  expired/invalid invitation tokens, signup API errors, or dashboard empty states.
- Guardian consent browser write tests are local-only, leaving remote preview coverage incomplete.
- Coverage is collectable but unenforced because no thresholds are configured.
- The realtime fallback test lives in the Playwright suite but does not run a browser page or prove
  that the application wires the fallback into production behavior.

## Brownfield change guidance

- Preserve server route shells and add client boundaries only where hooks or browser APIs require
  them.
- Prefer generated `@couture/api-client` operations and canonical runtime schemas for all public API
  traffic.
- Treat the dashboard routes as authorization boundaries, not merely display variants.
- Add tests at the same boundary as each change: leaf tests for interaction state, route tests for
  server behavior, and Playwright for authenticated cross-service flows.
- Keep analytics failure-tolerant and provide an explicit non-flagged fallback for every future
  feature-flagged branch.

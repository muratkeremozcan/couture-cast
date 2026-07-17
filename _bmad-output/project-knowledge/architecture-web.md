# Web application architecture

Updated: 2026-07-17 - Current-state brownfield architecture for `apps/web`.

<!-- markdownlint-disable MD013 -->

## Executive summary

`apps/web` is a small Next.js 15 App Router application in the Couture Cast npm monorepo. It
currently provides a landing page, signup and guardian-consent flows, guardian and teen dashboard
views, browser analytics, event polling, and a deployment health endpoint. Route pages and the root
layout are React Server Components by default; interactive forms, dashboard reads and mutations,
polling, browser APIs, and analytics are isolated in explicit client leaves.

The application is not yet a complete authenticated product client. It has no login, Supabase
session client, access-token refresh, logout, middleware, route guard, or role-aware navigation.
Although all API calls include cookies, protected API operations require a Bearer token in the
implemented NestJS API. Consequently, the profile, consent-revocation, and event-polling paths are
not production-complete unless undocumented external infrastructure adds authorization.

The web app is deployed as a separate Vercel project from the API. Same-origin `/api/v1/*` requests
can be rewritten to the API origin at build time. PostHog traffic is similarly proxied through
`/ingest/*`. Vercel project settings and deployment creation live outside this repository; checked-in
workflows wait for deployments and test them rather than creating or promoting them.

This document describes checked-in behavior as of the update date. Statements under
[Planned or absent architecture](#planned-or-absent-architecture) are targets or gaps, not current
capabilities. Detailed evidence is available in the
[web component inventory](component-inventory-web.md),
[integration architecture](integration-architecture.md),
[source tree analysis](source-tree-analysis.md),
[development guide](development-guide.md), and
[deployment guide](deployment-guide.md).

## Scope and authority

The scope is [`apps/web`](../../apps/web/) and the shared packages, test suites, and delivery
configuration that directly affect it. Current code, manifests, the lockfile, and generated
brownfield inventories take precedence over older planning artifacts. In particular:

- [`apps/web/package.json`](../../apps/web/package.json) defines the workspace dependencies and
  commands.
- [`package-lock.json`](../../package-lock.json) is authoritative for installed versions.
- [`src/app`](../../apps/web/src/app/) defines the App Router surface.
- [`next.config.ts`](../../apps/web/next.config.ts) defines build-time environment handling and
  rewrites.
- [`@couture/api-client`](../../packages/api-client/) owns shared HTTP and analytics contracts.
- NestJS controllers define the API routes that actually exist; generated OpenAPI and SDK output
  are derived artifacts.

## Exact technology stack

The versions below are the resolved versions in the current lockfile unless marked as a runtime
requirement.

| Layer                   | Current technology and version                                   |
| ----------------------- | ---------------------------------------------------------------- |
| Runtime                 | Node.js `>=24.0.0`; `.nvmrc` selects Node 24                     |
| Package manager         | npm `10.8.1`, using root npm workspaces                          |
| Task orchestration      | Turborepo `2.6.1`                                                |
| Language                | TypeScript `5.9.3`, strict root configuration                    |
| Web framework           | Next.js `15.5.9`, App Router                                     |
| UI runtime              | React `19.1.0`, React DOM `19.1.0`                               |
| Styling                 | Tailwind CSS `3.4.18`, PostCSS `8.4.49`, global CSS              |
| Runtime validation      | Zod `3.25.76` and shared `@couture/api-client` schemas           |
| Analytics               | PostHog JS `1.356.1`                                             |
| Unit/component tests    | Vitest `4.0.9`, Testing Library React `16.3.0`, jsdom `27.0.1`   |
| Browser component tests | `@vitest/browser` and Playwright provider `4.0.18`               |
| HTTP test mocking       | MSW `2.12.10`                                                    |
| End-to-end tests        | Playwright `1.58.2` from the root toolchain                      |
| Static analysis         | ESLint `8.57.1`, `eslint-config-next` `15.5.9`, Prettier `3.6.2` |
| Build and hosting       | `next build` and `next start`; separate Vercel web project       |

The web TypeScript configuration extends the strict root configuration and uses `ESNext` modules,
`Bundler` resolution, preserved JSX, DOM libraries, no emit, and Next's TypeScript plugin. The app
has no state-management, data-cache, component-library, authentication, or Socket.io client
dependency.

## Runtime and rendering architecture

### App Router composition

[`src/app/layout.tsx`](../../apps/web/src/app/layout.tsx) is the only layout. It is a Server
Component that loads local Geist variable fonts, imports Tailwind-backed global CSS, sets
`lang="en"`, and renders route content. There are no nested layouts, route groups, templates,
parallel routes, intercepting routes, loading files, or Suspense boundaries.

All route pages are Server Components because none has a `'use client'` directive. They either
render static markup or mount focused client leaves:

```text
Server root layout
├── Server route page
│   ├── static route shell
│   └── client leaf: hooks, events, browser APIs, HTTP calls, analytics
├── client global error boundary
└── server not-found boundary
```

This keeps most route shells server-renderable, but no route currently fetches domain data on the
server. Dashboard reads begin after hydration, producing client-only loading states and foregoing
server authorization, streaming, request memoization, cache tags, and revalidation.

### Client boundaries

The explicit client components are:

- [`SignupForm`](../../apps/web/src/app/signup/signup-form.tsx): controlled form state, age
  evaluation, signup, guardian invitation, and feedback.
- [`GuardianAcceptView`](../../apps/web/src/app/guardian/accept/guardian-accept-view.tsx):
  invitation acceptance mutation and result state.
- [`GuardianDashboardView`](../../apps/web/src/app/guardian/dashboard/guardian-dashboard-view.tsx):
  post-mount profile read, linked-teen display, and consent revocation.
- [`TeenDashboardView`](../../apps/web/src/app/teen/dashboard/teen-dashboard-view.tsx): post-mount
  profile read and derived guardian-consent status.
- [`AnalyticsEventActions`](../../apps/web/src/app/components/analytics-event-actions.tsx):
  analytics-only CTA and upload actions plus 30-second event polling.
- [`PostHogClickTracker`](../../apps/web/src/app/components/posthog-click-tracker.tsx):
  document-level delegated click capture.
- [`error.tsx`](../../apps/web/src/app/error.tsx): global retry UI and error analytics.

State is local `useState` and `useRef` state. There is no Context provider tree, Redux, Zustand,
React Query, SWR, normalized cache, or shared invalidation mechanism. HTTP dependencies are
injectable through component props in the form and dashboard views, supporting deterministic
component tests without mocking internal modules.

## Route and component architecture

| Route                 | Boundary                           | Current behavior                                                             |
| --------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| `/`                   | Server page with two client leaves | Landing copy, navigation, signup link, analytics actions, static health copy |
| `/signup`             | Server page plus `SignupForm`      | Age gate, public signup, optional guardian invitation                        |
| `/guardian/accept`    | Async server page plus client view | Normalizes `token` query value, then submits invitation acceptance           |
| `/guardian/dashboard` | Server shell plus client view      | Loads profile after hydration and can revoke teen consent                    |
| `/teen/dashboard`     | Server shell plus client view      | Loads profile after hydration and derives consent status                     |
| `/api/health`         | Next route handler                 | Returns web identity, environment, deployment metadata, and UTC time         |

The landing page is monolithic: its header, navigation, hero, and status panel are not shared
components. There is no app-level navigation shell or library of buttons, fields, alerts, cards,
or dashboard rows. Dashboard and form shells therefore repeat visual and accessibility patterns.

[`error.tsx`](../../apps/web/src/app/error.tsx) is a client global error boundary with retry and
home actions. [`not-found.tsx`](../../apps/web/src/app/not-found.tsx) is a static server fallback.
Both emit their own `<html>` and `<body>`. The root metadata remains the Create Next App default.

### Current route behavior limitations

- Navigation targets `#wardrobe` and `#community`, but those IDs do not exist on the page.
- “Preview outfits” prevents navigation and records `ritual_created`; it does not call the ritual
  endpoint or render outfits.
- “Start wardrobe upload” records file metadata and clears the input; it does not upload media.
- The visible systems panel is static copy and does not call `/api/health` or test dependencies.
- Dashboard routes render without authentication or role checks before client code runs.

## Data and state architecture

### Read flow

Both dashboards call
[`getUserProfileFromWeb`](../../apps/web/src/lib/user.ts) from `useEffect` after hydration. Each
component:

1. starts with `profile: null`;
2. renders a textual loading state;
3. invokes the same `GET /api/v1/user/profile` adapter;
4. stores validated response data or an error in local state; and
5. uses an `isMounted` flag to prevent state updates after unmount.

The flag does not cancel the request. There is no `AbortSignal`, deduplication, retry policy,
stale-data policy, shared cache, prefetch, or server-to-client hydration.

### Mutation flow

Signup, guardian invitation, invitation acceptance, and consent revocation are imperative browser
mutations. Inputs and successful responses use canonical Zod schemas. Failures become local
component messages.

The guardian dashboard updates one linked teen to `revoked` only after API success. It does not
refetch the profile and intentionally retains the previous `consentGrantedAt` value. No optimistic
rollback is needed because local state changes only after confirmation, but the resulting view can
diverge from the server's complete post-revocation state.

### Event polling

The landing page creates one generated API client after mount and immediately polls
`GET /api/v1/events/poll`, then repeats every 30 seconds. An ISO timestamp cursor is held in a ref.
Alert-channel events are converted to shared analytics events. Polling errors are swallowed until
the next interval, and the timer is cleared on unmount.

[`src/app/lib/fallback.ts`](../../apps/web/src/app/lib/fallback.ts) can toggle a shared polling
service based on Socket.io connection state, but no route creates a socket or wires this adapter.
The current landing page therefore polls continuously rather than acting as a realtime fallback.

## API and authentication integration

### Base URL and transport

[`src/lib/api-client.ts`](../../apps/web/src/lib/api-client.ts) trims trailing slashes from
`NEXT_PUBLIC_API_BASE_URL`, defaults to an empty same-origin base, and forces
`credentials: 'include'`. Browser requests resolve by one of two paths:

1. a non-empty `NEXT_PUBLIC_API_BASE_URL` sends requests directly to that origin; or
2. an empty value sends same-origin `/api/v1/*`, which Next can rewrite to a configured API origin.

Current endpoint use is:

| Method and path                     | Web adapter                       | Current purpose            |
| ----------------------------------- | --------------------------------- | -------------------------- |
| `POST /api/v1/auth/signup`          | `submitWebSignup`                 | Create account             |
| `POST /api/v1/guardian/invitations` | `inviteGuardianFromWeb`           | Create guardian invitation |
| `POST /api/v1/guardian/accept`      | `acceptGuardianInvitationFromWeb` | Accept invitation token    |
| `POST /api/v1/guardian/revoke`      | `revokeGuardianConsentFromWeb`    | Revoke teen consent        |
| `GET /api/v1/user/profile`          | `getUserProfileFromWeb`           | Read dashboard profile     |
| `GET /api/v1/events/poll`           | `pollWebEvents`                   | Poll persisted events      |

Only event polling uses the generated `DefaultApi`. Signup, guardian, and profile modules hand-code
paths, methods, headers, and error parsing while importing canonical request and response schemas
from [`@couture/api-client`](../../packages/api-client/). This gives runtime validation but still
allows transport details to drift from generated contracts.

`pollWebEvents` uses generated request construction but casts raw JSON to its response union. It
does not apply a Zod response schema or explicitly reject a non-success HTTP response before JSON
parsing. Error-body parsing is duplicated in three modules and recognizes only a top-level
`message`.

### Authentication reality

The current web app does not instantiate Supabase Auth and has no login, session persistence,
access-token provider, refresh, logout, or callback route. It sends cookies but does not attach
`Authorization: Bearer <access-token>`.

The NestJS API's protected operations use a Bearer guard that validates the token through Supabase
Auth, maps signed identity and role claims, and applies role and teen-consent checks. Cookie
inclusion alone does not satisfy this guard. Signup and invitation acceptance are public; protected
profile, revocation, and event operations are incomplete from the current browser client unless an
external proxy injects a token. No such proxy is checked in.

There is also no middleware or route-level role guard for `/guardian/dashboard` and
`/teen/dashboard`. The API remains responsible for protecting data, but any visitor can render
either page shell and trigger its client request.

## Analytics and feature flags

### Browser analytics

[`instrumentation-client.ts`](../../apps/web/instrumentation-client.ts) is the single PostHog
initialization entry. The wrapper in
[`browser-analytics.ts`](../../apps/web/src/analytics/browser-analytics.ts):

- initializes once when `POSTHOG_API_KEY` is non-empty;
- sends through same-origin `/ingest`;
- captures history-change page views, autocapture, and exceptions in normal mode;
- batches normal traffic;
- safely becomes a no-op when no token is configured; and
- exposes an in-memory browser hook for deterministic analytics tests.

Typed shared wrappers emit `ritual_created`, `wardrobe_upload_started`, and `alert_received`.
Delegated `data-ph-*` click tracking coexists with those wrappers and converts dataset property
names to snake case, but it has weaker compile-time schema guarantees. The global error boundary
directly captures error-page and retry events.

Explicit events use the PostHog distinct ID when available and otherwise use the literal
`web-anonymous-user`. That fallback can collapse unrelated unconfigured or tokenless visitors into
one analytics identity.

### Feature flags

No web code reads a feature flag, experiment assignment, or flag payload. PostHog may make its
normal provider request, but no UI behavior branches on the result. Shared flag definitions and
remote/database/default fallback logic exist in
[`@couture/config`](../../packages/config/), but the web app does not depend on that package.

Feature-flagged web behavior is therefore planned or absent. It must not be described as active,
and any future branch needs a non-flag fallback plus tests for provider failure and default
behavior. Browser globals beginning `__enableAnalytics` or `__capturedAnalytics` are test hooks,
not product flags.

## Configuration

### Environment loading and precedence

At Next configuration evaluation, inherited process variables win. Missing keys are loaded from
the first root file that defines them in this order:

1. `.env.local`;
2. `.env.prod` when `NODE_ENV=production`, otherwise `.env.preview`; and
3. `.env`.

The loader is implemented directly in
[`next.config.ts`](../../apps/web/next.config.ts), without a runtime dotenv dependency. Hosted
Preview builds commonly use `NODE_ENV=production`, so Preview/production isolation depends on
provider-injected values winning over local files. Populated `.env*` files are ignored and must not
be committed.

### Web-relevant variables

| Variable                                       | Current use                                  |
| ---------------------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`                     | Browser API origin; empty means same-origin  |
| `API_BASE_URL` and environment variants        | Build-time API rewrite target candidates     |
| `PREVIEW_API_BASE_URL`, `PROD_API_BASE_URL`    | Environment-specific API targets             |
| `VERCEL_API_BASE_URL`, `VERCEL_API_BRANCH_URL` | Vercel API target candidates                 |
| `POSTHOG_API_KEY`                              | Injected browser PostHog token               |
| `POSTHOG_HOST`                                 | PostHog ingestion host; defaults to US cloud |
| `VERCEL_ENV`, `VERCEL_URL`                     | Health environment and deployment URL        |
| Git/Vercel commit variables                    | Build SHA and branch resolution              |

`next.config.ts` injects `POSTHOG_API_KEY`, `POSTHOG_HOST`, and build Git metadata into the client
bundle through `env`. Despite its name, `POSTHOG_API_KEY` is intentionally browser-visible and is
not a server secret; the naming obscures that property.

### Rewrites and build policy

The configured rewrites are:

- `/ingest/static/:path*` to the derived PostHog asset host;
- `/ingest/:path*` to the configured PostHog ingestion host; and
- `/api/v1/:path*` to the selected API origin when one is configured.

Trailing-slash redirects are skipped for PostHog compatibility. Next is configured to ignore
TypeScript and ESLint errors during `next build`; repository CI and workspace verification are the
quality gates that must catch those failures before deployment.

## Source tree

```text
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx                 root Server Component layout
│   │   ├── page.tsx                   `/` server page
│   │   ├── signup/                    `/signup` page, client form, tests
│   │   ├── guardian/
│   │   │   ├── accept/                `/guardian/accept` page, client view, tests
│   │   │   └── dashboard/             guardian dashboard page, client view, tests
│   │   ├── teen/dashboard/            teen dashboard page, client view, tests
│   │   ├── api/health/route.ts        `GET /api/health`
│   │   ├── components/                analytics client leaves and tests
│   │   ├── lib/fallback.ts            dormant socket-to-polling adapter
│   │   ├── error.tsx                  client global error boundary
│   │   ├── not-found.tsx              server 404 boundary
│   │   └── globals.css                global Tailwind layer
│   ├── analytics/                     browser PostHog adapter
│   ├── lib/                           API factory and feature HTTP adapters
│   └── test-utils/msw/                Vitest HTTP mock boundary
├── public/
│   └── mockServiceWorker.js           generated MSW browser worker
├── instrumentation-client.ts          browser analytics initialization
├── next.config.ts                     env loader and proxy rewrites
├── git-metadata.ts                    deployment identity resolver
├── tailwind.config.ts                 style scan and theme configuration
├── vitest*.ts                         jsdom and browser test configurations
├── tsconfig.json                      Next TypeScript configuration
└── package.json                       workspace commands and dependencies
```

Generated or local state includes `.next/`, coverage output, `build/`, dependency trees, and
TypeScript build information. It is not architecture authority. Cross-service web E2E tests live
under [`playwright/`](../../playwright/), not in the app workspace.

## Development architecture

Use Node 24 and run commands from the repository root unless noted. Web lifecycle scripts build
`@couture/utils` and `@couture/api-client` first, preventing stale shared output.

```bash
npm ci
npm run dev --workspace web
npm run typecheck --workspace web
npm run lint --workspace web
npm run test --workspace web
npm run build --workspace web
```

The direct development server uses Next's default port. The repository's built local web command
uses port 3005:

```bash
npm run start:web
```

`npm run start:all` starts local Supabase, resets and seeds its database, then starts the API on
port 4000 and built web app on port 3005. It is destructive to local database contents and is not a
general-purpose development command. Root `npm run dev` currently reaches only workspaces with a
`dev` script, which at present means web.

The focused repository gate is `npm run verify:web`; the full gate is `npm run validate`. The full
gate does not include integration, Playwright, Pact, k6, or Markdown link checking, so those remain
separate boundary-specific checks.

## Deployment architecture

The web app relies on a separate Vercel project and standard Next.js detection. There is no web
`vercel.json` and no checked-in workflow that invokes a web deployment. Vercel Git integration and
provider-side project settings are expected but cannot be reconstructed from this repository.

The workspace build runs shared-package preparation and `next build`. Build configuration embeds
Git metadata, selects API and PostHog rewrite targets, and relies on provider-injected environment
variables. [`GET /api/health`](../../apps/web/src/app/api/health/route.ts) reports:

- `status: ok`;
- service name `couturecast-web`;
- environment;
- Git SHA and branch;
- deployment URL when available; and
- a UTC ISO timestamp.

This endpoint is a process and deployment-identity probe, not dependency readiness. It does not
test the NestJS API, database, Supabase Auth, Redis, workers, weather providers, or PostHog.

Preview automation resolves separate web and API deployments, waits for both health responses,
checks their commit identity, then runs Playwright. Production automation verifies the web health
SHA but only checks HTTP 200 from an API route. These workflows verify deployments after an
external system creates them; they do not promote or roll them back.

No repository-defined web rollback, traffic shift, previous-deployment selection, or provider
project provisioning exists.

## Testing architecture

### Workspace tests

Vitest uses jsdom by default. Setup installs Testing Library matchers, global CSS handling, and MSW.
Unhandled `/api/` requests fail tests. Alternate configurations run the same component suite in
headed or headless Chromium through Vitest Browser Mode.

Current colocated coverage exercises:

- signup age messages, eligible signup, and guardian invitation;
- guardian invitation acceptance and missing tokens;
- guardian profile/revocation success and failure states;
- teen consent states and profile errors;
- landing analytics actions and polling resilience;
- delegated PostHog click capture; and
- API-client base URL, credentials, and option forwarding.

Coverage collects all `src/**/*.ts` and `src/**/*.tsx` files and emits text, JSON summary, and
LCOV. No line, branch, function, or statement threshold is enforced.

### Integrated tests

Root Playwright tests cover landing smoke behavior, health, event polling, analytics capture and
resilience, accessibility, guardian-consent flows, deployment SHA, and the isolated realtime
fallback. Guardian-consent write cases are skipped outside local runs until remote cleanup is
isolated. The fallback test imports the module but does not prove production UI wiring.

Pact checks generated-client consumers against the API provider, while schema workflows generate
and lint OpenAPI. Changes to API contracts must start in shared Zod contracts, regenerate OpenAPI
and SDK output, and run the relevant contract checks.

Important uncovered web boundaries include route pages, root layout, global error and not-found
boundaries, health route, Git metadata, most handwritten HTTP adapters, event response parsing,
browser analytics initialization, unauthenticated redirects, role mismatch, and invalid or expired
invitation-token browser flows.

## Security architecture

Current positive controls are:

- canonical Zod parsing for signup, guardian, and profile request/response data;
- local age-gate feedback backed by shared age policy;
- API-side Bearer validation, role checks, and teen-consent enforcement;
- credential inclusion on all web API calls;
- ignored environment files and separate environment variable lanes;
- same-origin PostHog proxying;
- CI secret scanning; and
- Playwright accessibility and selected cross-service authorization checks.

These controls do not make the web app authenticated. The browser lacks an identity source and
Bearer-token flow, and dashboard routes lack route guards. Local age validation is a UX control;
the API must remain authoritative. Invitation tokens arrive in the URL query string and are passed
to a client component, so logs, analytics, referrers, and UI code must never capture or persist
them.

`POSTHOG_API_KEY` is exposed to browser code by design and must contain only a public project token.
Service-role keys, guardian secrets, database URLs, and other credentials must never use this
injection path. API response errors are displayed to users, so backend messages must not disclose
sensitive identity or authorization details.

Future authenticated server rendering must account for cookie/Bearer propagation without exposing
tokens to Server Component output or logs. Role checks and consent checks belong at both the API
data boundary and route UX boundary; a route redirect must not replace API authorization.

## Concrete current risks

1. **Protected web flows lack authentication.** Profile, revocation, and polling require Bearer
   tokens, but the web app supplies only cookies. These flows can fail in real deployments.
2. **Dashboard routes are unguarded.** Any visitor can render guardian or teen route shells, and no
   role-aware middleware or server check redirects them.
3. **Builds can ship type or lint failures.** Next ignores both classes of build error; safety
   depends on external CI and branch protection that the repository cannot prove.
4. **API transport is duplicated.** Five operations hand-code paths and errors instead of using
   the generated client, increasing contract and behavior drift.
5. **Polling response validation is incomplete.** Raw JSON is cast without Zod validation or an
   explicit non-success check.
6. **Dashboard reads are client-only and uncancelled.** They add loading flashes, duplicate work,
   and cannot enforce authorization before rendering; unmount guards do not stop network traffic.
7. **Realtime fallback is not integrated.** The landing page polls continuously while the
   socket-conditioned fallback remains dormant.
8. **Analytics identity can collapse users.** The literal `web-anonymous-user` fallback can group
   unrelated visitors under one explicit-event identity.
9. **Product CTAs overstate behavior.** Outfit preview, wardrobe upload, and systems health are
   analytics or static UI rather than functional product integrations.
10. **Feature flags have no web consumers.** There are no active flag branches or tested fallback
    paths despite shared flag infrastructure elsewhere in the repository.
11. **Tests leave critical boundaries uncovered.** Route authorization, HTTP adapters, health,
    analytics initialization, and remote guardian writes lack complete automated evidence.
12. **Deployment health is shallow.** A healthy web process says nothing about API, auth,
    database, Redis, worker, or provider readiness.
13. **Hosted configuration is external.** Vercel project linkage, domains, environment separation,
    deployment triggers, and rollback cannot be verified from source.
14. **No automated rollback exists.** Verification can detect a bad web rollout but cannot revert
    or shift traffic.
15. **Invitation-token handling needs care.** Tokens are query parameters delivered to client
    code, creating leakage risk if future logging, analytics, or referrer behavior captures URLs.

## Planned or absent architecture

Older planning artifacts describe broader Couture Cast capabilities and directories. The following
must not be inferred from current web code:

- no web admin or moderation route;
- no ritual route group or functional outfit-recommendation UI;
- no wardrobe upload or archive UI;
- no community, lookbook, commerce, or color-analysis UI;
- no `packages/ui-web`, design-token package, or shared web component system;
- no Supabase browser client or direct browser-to-Postgres RLS lane;
- no production Socket.io client;
- no active web feature-flag branch;
- no Server Actions, server-side domain fetches, cache tags, streaming, or Suspense data flow;
- no declarative Vercel infrastructure; and
- no checked-in deployment promotion or rollback workflow.

The API, database models, shared schemas, or planning documents may contain foundations for some of
these capabilities. Their existence does not mean the web application currently exposes or wires
them.

## Change guidance

- Preserve server route shells and add client boundaries only for hooks, browser APIs, and
  interactive state.
- Implement authentication and role-aware route boundaries before treating dashboards as
  production-complete.
- Change public REST contracts in shared Zod modules first, then regenerate and validate OpenAPI
  and SDK artifacts.
- Prefer the stable generated API client and canonical runtime schemas over app-local route
  duplication.
- Keep analytics failure-tolerant, avoid sensitive properties, and give every future flag branch a
  tested code fallback.
- Test at the changed boundary: colocated Vitest for client behavior, route tests for server
  behavior, and Playwright for authenticated cross-service flows.
- Treat Vercel configuration, environment identity, and health verification as deployment
  architecture, not assumptions encoded only in provider consoles.

# Shared packages

Updated: 2026-07-17 - BMAD brownfield deep scan of shared packages.

## Scope and workspace model

This document covers the shared workspaces under [`packages/`](../../packages/) except
`packages/db`. Database implementation details are out of scope, although the testing package's
declared Prisma boundary is documented because it is part of that package's public behavior.

The repository uses npm workspaces for `apps/*` and `packages/*`, Node.js 24 or newer, and
TypeScript 5.9.3. The root build runs the shared packages in this explicit order:
`config`, `utils`, `api-client`, `testing`, then `k6-utils`. Turbo separately models the general
quality order as lint, test, then build. See the
[root package manifest](../../package.json) and [Turbo configuration](../../turbo.json).

All six packages are private. They are internal workspace boundaries, not public registry
packages.

## Package summary

| Package                  | Purpose                                       | Emitted/runtime format | Primary consumers       |
| ------------------------ | --------------------------------------------- | ---------------------- | ----------------------- |
| `@couture/config`        | Feature-flag contract and fallback evaluation | CommonJS               | API                     |
| `@couture/utils`         | Cross-runtime age and birthdate rules         | CommonJS               | API, web, mobile        |
| `@couture/api-client`    | HTTP contracts, SDK, realtime, analytics      | CommonJS               | API, web, mobile, tests |
| `@couture/testing`       | Prisma-aware factories and cleanup            | CommonJS               | API tests               |
| `@couture/k6-utils`      | Helpers for the k6 `goja` runtime             | ESM                    | Root `k6/` suite        |
| `@couture/eslint-config` | Repository ESLint policy                      | CommonJS config        | Root ESLint config      |

## `@couture/config`

### Config purpose and format

[`packages/config`](../../packages/config/) owns the canonical feature-flag names, value types,
defaults, and request-time fallback algorithm. TypeScript compiles it as CommonJS. Its manifest
publishes the same `dist/index.js` for `import`, `require`, and `default`, with declarations at
`dist/index.d.ts`. The package has no runtime dependencies. See its
[manifest](../../packages/config/package.json) and
[TypeScript configuration](../../packages/config/tsconfig.json).

### Exports

The only public subpath is the package root. Its
[entry point](../../packages/config/src/index.ts) exports:

- `FEATURE_FLAG_KEYS` and `FEATURE_FLAG_SYNC_DISTINCT_ID`;
- `coerceFeatureFlagValue`, `getDefaultFeatureFlagValue`, and `getFeatureFlag`;
- flag key, value, record, JSON, subject, and adapter types.

The [flag implementation](../../packages/config/src/flags.ts) currently defines four Boolean
flags:

- `premium_themes_enabled`, default `false`;
- `community_feed_enabled`, default `false`;
- `color_analysis_enabled`, default `true`;
- `weather_alerts_enabled`, default `true`.

`getFeatureFlag` rejects unknown names. For known names it tries the remote adapter, accepts only
a value of the declared kind, then tries the fallback adapter, and finally uses the code default.
A thrown remote-provider error is intentionally absorbed; a thrown fallback-adapter error is not.

### Config commands and boundaries

- Build: `npm run build --workspace @couture/config`
- Watch: `npm run build:watch --workspace @couture/config`
- Typecheck: `npm run typecheck --workspace @couture/config`
- Lint: `npm run lint --workspace @couture/config`
- Test: `npm test --workspace @couture/config`
- Coverage: `npm run test:coverage --workspace @couture/config`

Only the API declares this package. PostHog supplies the remote adapter, while the feature-flag
module supplies the persisted fallback adapter. Web and mobile do not import this package
directly. Relevant consumers are the API
[PostHog service](../../apps/api/src/posthog/posthog.service.ts) and
[feature-flag service](../../apps/api/src/modules/feature-flags/feature-flags.service.ts).

Current caveat: the value model supports Boolean, string, number, and JSON definitions, but all
present definitions are Boolean literals. The inferred `FeatureFlagValue` types are therefore
the literal defaults; the implementation uses focused casts to return remotely supplied Boolean
values through those literal types.

## `@couture/utils`

### Utility purpose and format

[`packages/utils`](../../packages/utils/) is the cross-runtime home of birthdate parsing and age
gate policy. It compiles to CommonJS and exposes one root entry point with declarations. It has
no package dependencies. See the [manifest](../../packages/utils/package.json) and
[TypeScript configuration](../../packages/utils/tsconfig.json).

### Exports and behavior

The [root entry point](../../packages/utils/src/index.ts) exports:

- `parseBirthdateInput`, `calculateAge`, `evaluateAgeGate`, and
  `evaluateBirthdateInput`;
- `AGE_GATE_MESSAGES` and `INVALID_BIRTHDATE_MESSAGE`;
- `AgeGateAccountStatus`, `AgeGateResult`, and `BirthdateAgeGateEvaluation`.

The [age implementation](../../packages/utils/src/age.ts) accepts only trimmed `YYYY-MM-DD`
input, verifies that it is a real calendar date, and constructs the date at noon UTC. Age
calculation compares UTC year, month, and day:

- younger than 13 is blocked with `blocked_underage`;
- ages 13 through 15 are allowed but require `pending_guardian_consent`;
- age 16 and older is `active`.

`evaluateBirthdateInput` distinguishes empty, invalid, and valid UI input without throwing.
`parseBirthdateInput` throws for invalid input. No upper or future-date bound is applied; a future
date consequently produces a negative age and follows the under-13 branch.

### Utility commands and boundaries

Its build, watch, typecheck, lint, test, and coverage commands use the same names as
`@couture/config`, scoped to `@couture/utils`.

The API uses it for auth and guardian age decisions. Web and mobile use it for signup feedback.
Those are the only declared package consumers. Examples are the API
[auth service](../../apps/api/src/modules/auth/auth.service.ts), web
[signup form](../../apps/web/src/app/signup/signup-form.tsx), and mobile
[signup screen](../../apps/mobile/src/features/signup/signup-screen.tsx).

## `@couture/api-client`

### API client purpose and format

[`packages/api-client`](../../packages/api-client/) owns public REST contracts, generated
TypeScript Fetch code, the stable client factory, socket payload contracts, polling fallback,
analytics contracts, and test assertions. It is explicitly CommonJS. The build emits only
`src/**/*.ts` into `dist`; generation scripts and package contract tests are not emitted. See the
[manifest](../../packages/api-client/package.json),
[build configuration](../../packages/api-client/tsconfig.build.json), and package
[README](../../packages/api-client/README.md).

Runtime dependencies are Zod, `@asteasolutions/zod-to-openapi`, and `ts-node`.
`@apidevtools/swagger-parser` is a development dependency used by contract checks.

### Public exports

The package [export map](../../packages/api-client/package.json) provides:

- `@couture/api-client`: generated runtime, models, API classes, `DefaultApi`,
  `createApiClient`, analytics symbols, socket symbols, and `PollingService`;
- `@couture/api-client/contracts/http`: the combined human-authored HTTP contract barrel;
- `@couture/api-client/contracts/http/*`: individual contract modules;
- `@couture/api-client/realtime/*`: realtime implementation modules;
- `@couture/api-client/types/*`: analytics and socket type modules;
- `@couture/api-client/testing/*`: framework-neutral analytics and log assertion helpers.

The [root entry point](../../packages/api-client/src/index.ts) re-exports the generated SDK in
addition to stable wrappers. Application code uses
[`createApiClient`](../../packages/api-client/src/client.ts), which accepts an access token or
options for credentials, fetch implementation, and headers, and returns the mixed-in
`DefaultApi`. Consumers should not import `src/generated` paths.

HTTP contract modules cover alerts, auth, common envelopes and errors, event polling, guardian,
health, locations, moderation, ritual, user, and weather. Their barrel is
[`src/contracts/http/index.ts`](../../packages/api-client/src/contracts/http/index.ts).

### Zod, OpenAPI, and generated SDK pipeline

The authoring and generation flow is:

1. Human-authored Zod schemas and endpoint registrations live in
   [`src/contracts/http`](../../packages/api-client/src/contracts/http/).
2. [`openapi.ts`](../../packages/api-client/src/contracts/http/openapi.ts) registers the common
   schemas and every endpoint slice with `zod-to-openapi`, then generates OpenAPI 3.1.
3. [`generate-http-openapi.ts`](../../packages/api-client/scripts/generate-http-openapi.ts)
   writes the deterministic document to
   [`docs/http.openapi.json`](../../packages/api-client/docs/http.openapi.json) without starting
   NestJS.
4. The root `generate:api-client` command regenerates that document and invokes OpenAPI Generator
   7.21.0's `typescript-fetch` generator. Configuration is in
   [`openapitools.json`](../../openapitools.json).
5. [`postprocess-generated-sdk.ts`](../../packages/api-client/scripts/postprocess-generated-sdk.ts)
   creates a stable generated barrel and mixed-in `DefaultApi`, changes generated `Null` tokens to
   `null`, strengthens weather hourly arrays to length 48, removes unused model imports and
   generator metadata, strips TSLint headers, and runs Prettier.

The generated client is configured with `useSingleRequestParameter` and
`withoutRuntimeChecks`. Zod schemas are therefore the runtime validation boundary; generated SDK
types do not add runtime response validation. Generated files and OpenAPI JSON are outputs and
must not be edited by hand.

The package README prescribes this contract-change validation sequence:

1. `npm run generate:http-openapi`
2. `npm test --workspace @couture/api-client`
3. `npm run optic:lint`
4. `npm run optic:diff`
5. `npm run generate:api-client`

The final command deliberately regenerates HTTP OpenAPI before regenerating the SDK. Contract,
OpenAPI, and SDK changes are committed together.

Socket schemas have a separate generator:
`npm run gen:openapi:events --workspace @couture/api-client`. It writes
[`docs/socket-events.openapi.json`](../../packages/api-client/docs/socket-events.openapi.json)
from the shared socket Zod schemas. It does not feed the HTTP SDK generator.

### Realtime types and fallback

[`socket-events.ts`](../../packages/api-client/src/types/socket-events.ts) defines a common
`BaseEvent` with `version`, ISO `timestamp`, `userId`, and `data`. It provides runtime Zod schemas
and types for:

- `lookbook:new`, with post, locale, climate, and media data;
- `ritual:update`, with ritual lifecycle status;
- `alert:weather`, with alert type, location, message, and severity.

[`PollingService`](../../packages/api-client/src/realtime/polling-service.ts) is a generic
foreground fallback. It performs an immediate fetch, then defaults to a 30-second interval,
advances an optional `nextSince` cursor, and exposes activation, deactivation, event, and error
callbacks. `start` is idempotent only after its timer exists: concurrent calls during the first
awaited tick are not guarded by an in-flight flag. `stop` calls `onDeactivate` only when a timer
has already been installed.

The API publishes and validates socket payloads. Web and mobile consume the same event types and
polling fallback. Browser code can use exported subpaths; mobile also imports the root barrel.

### Analytics types and test assertions

[`analytics-events.ts`](../../packages/api-client/src/types/analytics-events.ts) is the canonical
analytics event catalog. It contains Zod schemas for camelCase domain inputs, snake_case provider
properties, inferred types, and `track*` wrappers. Each wrapper parses its input, normalizes the
property names, validates the provider payload, and returns `{ distinctId, event, properties }`.
Current events are:

- ritual creation and wardrobe upload start;
- alert receipt and alert send;
- moderation action and guardian consent;
- profile completion and first outfit generation;
- forecast view and location switch;
- API error occurrence.

The API-error wrapper uses `anonymous` when `userId` is null. Guardian consent copies the input
timestamp to both `timestamp` and `consent_timestamp`.

The `testing/*` subpath exports framework-neutral helpers. The
[analytics helper](../../packages/api-client/src/testing/analytics-event-assertions.ts) validates
captured event properties and supports cursors and count checks. The
[observability helper](../../packages/api-client/src/testing/observability-assertions.ts) checks
structured log level, message, context, cursor, and count. Callers inject an
[`ExpectLike`](../../packages/api-client/src/testing/expect-like.ts) implementation rather than
coupling these modules directly to Vitest.

### Commands and consumption boundaries

- Build/watch/typecheck/lint/test/coverage use the standard package command names.
- `gen:openapi:http` generates the HTTP document from this workspace.
- `gen:openapi:events` generates the socket schema document.
- Root `generate:http-openapi` and `generate:api-client` are the canonical repository commands.
- Root `optic:lint`, `optic:diff`, and Pact commands validate external contract boundaries.

The API consumes HTTP contracts, generated types/client exports, realtime schemas, analytics
wrappers, and test assertions. Web and mobile consume contracts, the stable client factory,
analytics, realtime, and generated public types. Playwright and Pact consume contracts and the
client; no consumer should reach into package-private source or generated directories. App
manifests build this package before direct app tools run. See the
[API](../../apps/api/package.json), [web](../../apps/web/package.json), and
[mobile](../../apps/mobile/package.json) manifests.

Current caveats:

- The package is CommonJS even though it serves Next.js, Expo, and Node consumers.
- The root barrel exposes generated classes and models; the stability rule is about avoiding
  generated file paths, not hiding every generated symbol.
- OpenAPI event generation is separate from `generate:api-client`.
- The HTTP OpenAPI document currently advertises `http://localhost:3001`; this is document
  metadata, not client base-URL configuration.

## `@couture/testing`

### Purpose, format, and exports

[`packages/testing`](../../packages/testing/) supplies fresh fixture builders, optional Prisma
persistence, entity tracking, and dependency-aware cleanup. It is CommonJS and depends at runtime
on Faker and `@prisma/client`. This makes it test-only but schema-coupled. The API declares it as
a development dependency; web and mobile do not declare it.

Its [export map](../../packages/testing/package.json) provides the root, `./cleanup`,
`./factories`, and wildcard `./factories/*`. The
[root entry point](../../packages/testing/src/index.ts) re-exports cleanup and all factories.

The factory catalog includes:

- generic, teen, and guardian users, including nested profile and comfort data;
- wardrobe items;
- outfit recommendations, named rituals in this package;
- weather snapshots with 48 forecast segments;
- saved locations;
- alert rules;
- notification preferences.

Each factory first builds a fresh object with Faker and shallow overrides. Specialized factories
compose role-specific defaults. Passing `{ persist: true, prisma }` uses a typed create-input
builder, creates the row, and registers its ID. Callers must override values used in deterministic
assertions. See the [factory barrel](../../packages/testing/src/factories/index.ts) and package
[README](../../packages/testing/README.md).

### Cleanup boundary

The [registry](../../packages/testing/src/factories/registry.ts) tracks IDs in module-level sets
for seven entity kinds. Persistence helpers register automatically; direct Prisma setup can call
`registerForCleanup`. The [cleanup helper](../../packages/testing/src/cleanup.ts) accepts a Prisma
client explicitly or through module-level configuration, snapshots the registry, deletes
dependents before parents, and clears the registry in `finally`, including after a failed delete.

Cleanup handles event envelopes, alert data, engagement, lookbook, audit, push, location,
recommendation, palette, garment, forecast, weather, guardian, preference, profile, and user
relations. Current caveats:

- the default registry and optional default Prisma client are process-global module state;
- cleanup deduplicates tracked IDs but is not transaction-wrapped;
- `alertCooldownReservation.deleteMany({})` is unscoped when tracked users trigger the
  user-dependent cleanup sequence;
- weather fixtures expose richer test fields than persistence writes; for example `locationId`,
  `feelsLike`, `windSpeed`, and `humidity` are not all copied to the weather snapshot row;
- fixture persistence requires related rows to exist when a builder connects generated user,
  garment, or forecast IDs.

### Testing commands

Build, watch, typecheck, lint, test, and coverage use the standard package command names scoped to
`@couture/testing`. The API's `prepare:shared-deps` builds this package even though production API
code does not import it.

## `@couture/k6-utils`

### Purpose and runtime boundary

[`packages/k6-utils`](../../packages/k6-utils/) is an ESM package specifically for k6's `goja`
runtime, not a general Node/browser utility library. Its TypeScript build uses ESNext plus bundler
resolution, rewrites `.ts` relative imports to emitted extensions, and publishes declarations and
JavaScript from `dist`. Engines require Node 24 or newer for development and k6 1.0 or newer for
execution. See its [manifest](../../packages/k6-utils/package.json),
[TypeScript configuration](../../packages/k6-utils/tsconfig.json), and
[README](../../packages/k6-utils/README.md).

The root `k6/` suite is the only current consumer. The root `prepare:k6` script builds this
package before local, preview, or production k6 runs.

### Exports and helpers

The root barrel and explicit subpaths export:

- [`api-request`](../../packages/k6-utils/src/api-request.ts): JSON serialization, default content
  type, k6 tags/timeout pass-through, and typed parsed response;
- [`config`](../../packages/k6-utils/src/config.ts): `SharedArray` JSON loading, environment
  overrides, and scenario cloning;
- [`crypto`](../../packages/k6-utils/src/crypto.ts): AES-CBC encryption through k6 WebCrypto;
- [`distributions`](../../packages/k6-utils/src/distributions.ts): weighted picks, Zipfian
  selection, deterministic integer mixing, and SHA-256;
- [`handle-summary`](../../packages/k6-utils/src/handle-summary.ts): terminal output plus
  schema-versioned JSON metrics and threshold results;
- [`infra-delay`](../../packages/k6-utils/src/infra-delay.ts): median health-check latency;
- [`jwt`](../../packages/k6-utils/src/jwt.ts): HMAC JWT encode/verify, decode, and RS256
  sign/verify;
- [`random-data`](../../packages/k6-utils/src/random-data.ts): unique emails and random selection;
- [`time`](../../packages/k6-utils/src/time.ts): ISO ranges, date strings, and Unix timestamps.

The package also ships smoke, constant-rate, ramp-up, soak, and spike JSON templates under
[`templates/load-profiles`](../../packages/k6-utils/templates/load-profiles/).

`getConfig` must run during k6's init phase because it calls `open()`. `TEST_CONFIG` is expected
from real entry points; its built-in `configs/dev.json` fallback intentionally does not exist.
`QPS`, `DURATION`, and `VUS` overrides apply only to the first scenario. QPS is accepted only for
arrival-rate executors, and VU allocation is capped by `MAX_VUS`, default 2000.

Current caveats:

- `lint` and `test` both run only TypeScript typechecking; there are no runtime unit tests in this
  workspace;
- the summary helper fetches `k6-summary` from `https://jslib.k6.io` at k6 runtime;
- `apiRequest` assumes a non-empty, non-204 response is JSON and lets parse failures throw;
- JWT verification checks signatures and declared algorithms, but does not enforce `exp`, `nbf`,
  issuer, or audience claims;
- HMAC comparison is ordinary string comparison, as documented for this test toolkit;
- RS256 private keys must be PKCS#8 and public keys must be SPKI;
- AES-CBC returns an IV and ciphertext but provides no authentication tag.

### k6 commands

- Build: `npm run build --workspace @couture/k6-utils`
- Typecheck: `npm run typecheck --workspace @couture/k6-utils`
- Lint: `npm run lint --workspace @couture/k6-utils` (typecheck alias)
- Test: `npm test --workspace @couture/k6-utils` (typecheck alias)
- End-to-end load entry points: root `test:k6:local`, `test:k6:preview`, and `test:k6:prod`

## `@couture/eslint-config`

[`packages/eslint-config`](../../packages/eslint-config/) is a CommonJS, legacy `.eslintrc`
shareable configuration. It has one unexported-by-map root file,
[`index.js`](../../packages/eslint-config/index.js), selected by `main`. The repository root
extends it and supplies workspace-aware TypeScript projects and overrides in
[`.eslintrc.js`](../../.eslintrc.js).

The shared policy:

- enables Node, browser, and ES2021 environments;
- uses type-aware `@typescript-eslint` parsing and TypeScript import resolution;
- extends ESLint recommended, TypeScript recommended/type-aware/stylistic, import, and Prettier
  configurations;
- requires type-only imports and exports, awaited thenables, and handled promises;
- rejects focused tests and non-kebab-case filenames;
- permits intentionally unused arguments only with an underscore prefix;
- warns at cyclomatic complexity above 15;
- enforces spaces inside object braces, Unix line endings, single quotes, and no semicolons;
- ignores generated output, dependencies, caches, coverage, and declaration files.

The root config overrides the package's default parser project and root directory. It has separate
project settings for API, web, mobile, Playwright, Pact, and k6. Test files allow known-safe
top-level `test`, `it`, and `describe` registration calls. k6 overrides permit CDN imports and
native default-import conventions and defer selected assertion/complexity checks to TypeScript.

Commands are limited to:

- `npm run lint --workspace @couture/eslint-config`;
- `npm run typecheck --workspace @couture/eslint-config`, which prints that there is no step;
- `npm test --workspace @couture/eslint-config`, which prints that no unit tests are configured.

Current caveats: the package manifest declares no direct dependencies or peer dependencies for
the parser, plugins, resolver, or extended configurations. They are supplied by the root
workspace. The package therefore is not independently installable as a complete ESLint config.

## Dependency and change boundaries

- Change feature-flag names, kinds, or defaults in `@couture/config`; keep provider and persistence
  adapters in the API.
- Change age policy in `@couture/utils`; do not duplicate thresholds in API, web, or mobile.
- Change public REST schemas first in `@couture/api-client/contracts/http`, then regenerate and
  validate OpenAPI and SDK outputs.
- Keep socket and analytics payload contracts in `@couture/api-client`; provider calls and
  transport lifecycle remain in applications.
- Keep reusable synthetic data and teardown logic in `@couture/testing`; production code must not
  consume it.
- Keep k6-native imports and globals inside `@couture/k6-utils` or the root `k6/` suite.
- Change cross-repository lint policy in `@couture/eslint-config`; workspace project mappings stay
  in the root ESLint configuration.

No shared package imports another shared package in this scan. Cross-package sequencing exists
through root scripts and application preparation hooks, while source dependencies point outward
to Zod/OpenAPI tooling, Faker/Prisma, or the k6 runtime.

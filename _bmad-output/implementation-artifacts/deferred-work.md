# Deferred Work Ledger

This ledger tracks items deferred during sprint execution and code reviews.

## Deferred from: code review of 1-1-weather-api-ingestion-service.md (2026-07-07)

- Inconsistent Database `location` Field Populated with `location_key`: The database snapshot `location` field is being set to the slugified `locationKey` rather than a descriptive location name, since `WeatherIngestionTarget` does not supply descriptive location names in Story 1.1. This will be aligned in Story 1.2 when user-managed location profile data is introduced.

## Deferred from: code review of 1-3-alert-rules-notification-pipeline.md (2026-07-13)

- Looping database queries inside transaction: `PrismaAlertsRepository.upsertRules` executes sequential upsert queries inside a `$transaction` block. This is tolerable for single user updates since the array size is small.

## Deferred from: code review of 2-1-scenario-outfit-generator.md (2026-07-16)

- Database Race Condition on Recommendations: There is no database-level unique constraint or lock on the `OutfitRecommendation` table for `(user_id, forecast_segment_id, scenario)`. Concurrent requests could insert duplicate rows.

## Deferred from: story 5.1 affiliate "Shop this look" CTA (2026-08-11)

These were identified while drafting and implementing story 5.1 and were
deliberately left out of its scope. Each records what was narrowed and why, so a
later story does not have to rediscover the reasoning.

- **No partner-facing admin console.** `CommercePartner` and `AffiliateOffer`
  rows are seed and migration managed. The operator runbook for onboarding a
  real partner is: insert the rows via migration or service-role SQL, set the
  partner's secret environment variable in the target environment, then enable
  `commerce_affiliate_enabled` in PostHog. Documented in
  `_bmad-output/project-knowledge/secrets-management.md`.

- **No weekly affiliate link validation job.** PRD NFR Integration 2 requires
  it. Story 5.1 validates the resolved URL per request only (parse, https, no
  userinfo, hostname equals or is a dot-suffix of the partner's `allowed_host`,
  `{clickToken}` present). A scheduled validation sweep over the catalog is a
  real gap, not an oversight.
  [Source: prd.md, NFR Integration 2]

- **No neutral-card fallback for an unavailable partner feed.** Also PRD NFR
  Integration 2. Story 5.1 has no feed and no validation job, so bad catalog
  data is surfaced as an operator error instead: an invalid resolved URL returns
  500 with `COMMERCE_OFFER_INVALID_MESSAGE`, creates no click row, and logs at
  `error`. A neutral card requires a feed-health signal that does not exist yet.
  [Source: prd.md, NFR Integration 2]

- **The outfit detail view CTA is not implemented.** PRD Key Interactions
  describes a "full-screen look with garment cards ... optional click-to-buy
  buttons". That surface does not exist in the codebase, on any platform.
  [Source: prd.md, Key Interactions]

- **`locale_region` is a UI-language region, not a commerce jurisdiction.** It
  is the uppercased region subtag of the locale the ritual already resolves, so
  a user physically in the US reading the app in `fr-FR` resolves to `FR` and
  sees `FR` offers. No real jurisdiction source exists in this codebase, and
  introducing one (geolocation, billing address, or a declared market) is a
  separate story with its own privacy questions.

- **Offers are per outfit, not per item.** PRD FR5.1 says "links on outfit
  **items**", which is broader than what shipped. `epics.md` CC-5.1 says
  "button" and "partner ID", both singular, and story 5.1 honoured the epic
  literally: exactly one offer per scenario outfit, one partner per card. The
  narrowing is additive to undo, because `shopThisLook` is a single object today
  and a future array field alongside it would not change the contract shape.
  [Source: prd.md FR5.1; epics.md CC-5.1]

- **Opt-out versus opt-in tension.** Epic AC 3 says "opt-out toggle" and takes
  priority over the PRD's looser "opt-in/out" phrasing, so
  `affiliate_ctas_enabled` defaults `true`. Worth restating plainly: the single
  toggle controls CTA visibility, and `AffiliateClick` rows are durable
  user-scoped commercial records retained 24 months, created only by an explicit
  tap. Nothing is recorded about a user who never taps. If a future privacy
  review wants affirmative consent before any commercial record exists, that is
  a product decision, not a bug in this implementation.
  [Source: epics.md CC-5.1 AC 3; prd.md NFR Security 4]

- **Non-English disclosure copy shipped as draft.** The `commerce.*` locale
  trees on web and mobile carry machine-drafted values for the nine non-English
  locales. The disclosure and settings-disclosure strings are compliance copy
  and require human review before release.
  [Source: prd.md, Success Criteria]

- **Integration and mobile end-to-end evidence is unprotected after merge.** No
  workflow runs `test:integration`, and `.github/workflows/pr-mobile-e2e.yml:7`
  is `workflow_dispatch` only. The click-endpoint and webhook integration specs
  and the Maestro flow therefore ran locally but do not gate a pull request.
  Adding an integration job is its own piece of work.

### Added during story 5.1 integration (2026-08-11)

- **Web carries one commerce key mobile does not.** `commerce.settings.signedOutHint`
  ("Sign in to change this") exists because decision 17 requires a localized
  signed-out hint on the web settings section and decision 16's tree has no key
  for it. Web has 13 commerce keys, mobile has 12. This is deliberate: mobile
  settings is never reachable without a session, so an unused key there would be
  dead weight added only to satisfy symmetry.

- **Pact provider verification has a pre-existing Linux flake at roughly 3 runs
  in 42.** Signature: "request was expected but not received" on any Story 4.2
  smart-tag interaction (observed on both `PATCH /api/v1/wardrobe/garments/.../tags`
  and `POST .../suggest-tags`). First seen on run 31414118678 on 2026-08-10,
  before story 5.1's second round existed, and the commits since the last green
  run touch only `apps/api/integration/*.spec.ts`, which that workflow never
  executes. Re-dispatching is the correct response to a red run with this
  signature; reverting story work is not. The proposed remedy is bumping
  `@pact-foundation/pact` from the pinned 16.4.0 to 17.1.2, which is a dependency
  change with its own blast radius and does not belong inside a commerce story.

## Deferred from: story 5.2 premium subscription lifecycle (2026-08-12)

These were identified while implementing story 5.2 and deliberately left out of
its scope. Each records what was narrowed and why.

- **No automated store-purchase E2E.** StoreKit-sandbox / Play-internal-testing
  purchase automation does not exist; the Maestro harness pins Expo Go, where
  the RevenueCat native module is absent, so mobile E2E verifies the settings
  section and the SDK-absent fallback only. The real purchase chain is proven
  by the runbook's staged smoke gate (recorded in
  `premium-release-checklist.md`), not by CI.

- **No socket push for entitlement changes.** Polling (bounded 5s/2-minute
  client poll) plus the refresh endpoint meets the 2-minute AC. A
  `premium:update` socket event would tighten UX after webhook-driven changes
  (e.g. Ask-to-Buy approvals landing hours later) but is not required by any
  AC.

- **Stripe-sourced `will_renew` display shortcut.** RevenueCat documents up to
  ~2 hours for Stripe-sourced cancellation sync. The web portal-return copy
  sets that expectation; a faster path would read our own recorded
  `customer.subscription.updated` BillingEvents to display `willRenew: false`
  early WITHOUT writing entitlement state (the one-writer rule stands). Purely
  a display optimization; deferred.

- **PRD "ad-free experience" premium benefit is moot until ads exist.**
  `prd.md:79` lists ad-free as a premium benefit; the product has no ads
  anywhere, so there is nothing to gate. Revisit if ads ever ship.

- **First-party store API migration notes.** If ADR-015 is ever reversed, the
  landing points are: Apple App Store Server API + Server Notifications V2
  (`@apple/app-store-server-library` v3.x, JWS x5c verification) and Google
  Play Developer API + RTDN (requires a Google Cloud Pub/Sub push
  subscription — a new vendor surface this repo does not have). The server
  contract (PremiumEntitlement mirror, status/refresh, guard) is
  vendor-neutral and survives; the RC SDK in shipped mobile binaries is the
  expensive half (multi-release migration; keep RC alive for old installs).

### Added during the story 5.2 test-quality review (2026-08-13)

- **Locale-parity scaffolding is duplicated across four i18n specs.** The
  `SUPPORTED_LOCALES`/catalog map, flatten, placeholder check, cognate
  allowlist, and tree selector appear nearly verbatim in
  `apps/{web,mobile}/src/i18n/{commerce,premium}-locales.spec.ts` (~80 lines
  each). A shared parity harness parameterized by subtree selector would
  collapse all four. Cross-surface harness work; no registry row; not owned by
  any single story.

- **The premium integration suites duplicate their bootstrap.** The
  `databaseUrl` fallback, `probeSchema`, and `requireSchema` trio appears in all
  four `apps/api/integration/premium-*.integration.spec.ts` files, and the
  identical `RequestAuthGuard` override (the `Bearer premium-test:<id>` parser)
  appears verbatim in three. Both belong in a shared integration-test helper.

- **The Maestro harness cannot reach the seeded premium users.**
  `scripts/run-maestro.mjs` signs up a fresh account and bakes its token into
  the Expo bundle via `EXPO_PUBLIC_E2E_ACCESS_TOKEN`; there is no token-override
  path, so a flow can only ever run as that fresh user. Story 5.2's Decision 11
  originally claimed the premium flow verifies "the seeded entitled user's
  settings section", which is not achievable without changing that shared
  script — out of scope for a billing story. The decision text was corrected
  in place on 2026-08-13 and the flow header states the real scope. Entitled
  rendering is covered by the mobile screen tests and the Playwright
  seeded-user specs. The harness change (an env-driven token override so flows
  can run as a chosen seed user) is the deferred item.

## Deferred from: story 5.3 premium theme switcher (2026-08-18)

Two kinds of entry sit below. The first five are boundaries story 5.3 drew for
itself in its own decisions. The last four are the higher test tiers and the
mobile surface, which were deliberately held back so they could be authored
separately; none of the four is blocked on a technical unknown, and none was
forgotten.

- **Watch and complication theming.** Epic AC 2 (`epics.md:443`) and PRD FR5.3
  (`prd.md:205`) both require the chosen palette to apply across mobile, web,
  and watch. Decision 5 answers both with the UX spec's wearable rule
  (`ux-design-specification.md:381`): wearable cards keep the monochrome palette
  with a gold ring indicator so a 1.5-inch screen stays glanceable whatever
  palette the wearer picked in the app. That is why no Swift file under
  `apps/mobile/targets/` and no Android widget Kotlin source was touched. The
  deferred item is the follow-up product may still want: tinting a
  complication's accent ring by the selected theme. It is small now that the
  server-side preference exists to read from, and it would read that preference
  through `WatchConnectivityManager` and the shared App Group `UserDefaults`,
  never over HTTP (story 3.4's Watch Isolation Principle). Both citations are
  recorded here so a later reader sees a requirement that was answered by a
  cited design decision rather than one that was missed.

- **Broader-UI token adoption beyond the settings surface.** Decision 4. This
  story builds the token primitive and demonstrates it on exactly one surface:
  the theme gallery re-colors its own swatch cards, selected-state indicator,
  and preview card. Hero canvas, Lookbook Prism, the chip system, and the button
  hierarchy still carry hardcoded brand colors (web Tailwind arbitrary values,
  e.g. `lookbook-prism-layout.tsx:191,229,251,295-364`; mobile raw hex inside
  `StyleSheet.create`). Retrofitting them all inside a feature story is the
  unbounded, high-regression scope CC-5.2 Decision 2 already refused, and
  ownership sits with each surface. The carrier is in place for whoever takes
  one: five custom properties under `[data-theme]` in
  `apps/web/src/app/globals.css`, so a surface adopts the palette by replacing
  color literals with `var(--theme-*)`. One trap to avoid on mobile:
  `constants/colors.ts` and `hero-theme.ts` are OS light/dark plumbing, a
  different axis from premium palettes, and must not be folded into this work.

- **`packages/tokens` consolidation of the duplicated palette hex values.**
  Decision 12 pins every surface to the same `refs/ux/ux-color-themes.html`
  values and accepts duplicate copies of them because no shared token package
  exists; `architecture.md:85-88` describes `packages/tokens` but it was never
  built, and building it inside a feature story is an unscoped structural
  change. Today the web copy lives in the `[data-theme]` blocks of
  `apps/web/src/app/globals.css`, and the audited pairings are re-pinned as
  regression fixtures in `packages/utils/src/contrast.spec.ts`. The mobile copy
  (`apps/mobile/src/theme/theme-palettes.ts`) arrives with the deferred mobile
  surface below, which is the point at which the duplication becomes genuinely
  cross-surface. Whoever takes it: one exported palette table consumed by the
  web CSS layer and the mobile StyleSheet, with the contrast specs kept as the
  drift detector.

- **Winter Metallic's real two-stop gradient.** Decision 2.
  `ux-color-themes.html:57` renders that card preview as
  `linear-gradient(135deg,#F7FBFF,#E9EDF6)`. Neither carrier can hold a
  gradient: web's `--theme-card-bg` is a single custom property, mobile's
  `cardBg` is a single `StyleSheet` color, and `expo-linear-gradient` is not an
  installed mobile dependency. The solid Ice `#E9EDF6` end is therefore the
  value shipped on web today and the value the deferred mobile surface below
  should carry. That is the darker of the two stops, so it is the worst case for
  contrast against Gunmetal `#2F333D` text and is the value already audited at
  10.78:1; the Glacier end `#F7FBFF` would measure 12.15:1, so nothing is lost
  accessibility-wise. A future story that wants the real gradient owns adding a
  gradient renderer on mobile and reshaping `cardBg` into a stop list on both
  surfaces.

- **The last inline `contrastRatio` duplicate in
  `playwright/tests/accessibility-hardening.spec.ts:131`.** The docblock at
  `playwright/support/helpers/accessibility.ts:80-82` records why it was left
  alone before this story: that spec gates every primary route, so it was not
  refactored in a change that could not run it. The same reason holds here,
  because the Playwright tier is out of scope for this change (see the adapter
  entry below). Collapsing it into `@couture/utils` is a Playwright-tier change
  and belongs with a run of that suite.

### Deliberately deferred so the higher test tiers could be authored separately

- **The Maestro locked-state flow.** Held back deliberately for separate
  authoring. **No longer blocked** as of 2026-08-20: the mobile surface above
  shipped, so `premium-theme-section` and `premium-theme-locked` are real
  testIDs a flow can drive. When it is written it carries the same
  reachability limit story 5.2's premium flow already documents.
  `setupMobileE2EIdentity` in `scripts/run-maestro.mjs` signs up a fresh
  `mobile-e2e-<uuid>@example.com` account and bakes its token into the Expo
  bundle through `EXPO_PUBLIC_E2E_ACCESS_TOKEN`, with no override path, so a
  flow runs as that fresh non-entitled user and the locked state is the only one
  it reaches for free. Say that plainly in the flow header rather than implying
  gallery coverage. Reaching the entitled gallery needs a harness change, and
  there are two candidates rather than one: the env-driven token override 5.2
  already filed above, or seeding a `PremiumEntitlement` row for the fresh
  user through the Prisma connection the runner already opens on
  `MOBILE_E2E_DATABASE_URL` for its garment and location fixtures. Whoever takes
  it should pick deliberately; the second is narrower but puts entitlement
  seeding into a shared script every flow runs. Ordering for whoever picks these
  up: mobile surface first, then the flow.

- **`preserveNullableEnumValues` mutates the ZodEnum's shared values array, and
  nine nodes in the published OpenAPI document are invalid because of it.** The
  defect predates this branch and is documented in full at
  `packages/api-client/src/contracts/http/openapi.ts`'s docblock. The pass
  appends `null` to `schema.enum`, but the array it appends to is the ZodEnum's
  own `_def.values`, which `zod-to-openapi` hands out by reference, so one
  nullable publication of an enum leaks `null` into every other publication of
  that same enum. `ScenarioOutfit`, `RitualResponse` and `ShopThisLook`'s
  `garmentCategory`, `SuggestGarmentTagsResponse`'s three `suggestions.*.value`
  nodes, `UpdateGarmentTagsInput`'s `category` and `comfortRange`, and the
  `comfortRange` query parameter of `GET /api/v1/wardrobe/{ownerUserId}/capsules`
  each publish as `{"type": "string", "enum": [..., null]}` — a schema that
  rejects the value its own type permits — and none of those properties has ever
  accepted `null` at the boundary. The correction is one line,
  `schema.enum = [...enumValues, null]` in place of `schema.enum.push(null)`.
  It is not shipped here because it cannot pass the pull-request gate: it
  rewrites those nine nodes and `optic diff` reads three of them as breaking enum
  removals, and Optic's documented escape hatch closes only one of the three
  (`createRequestPropertyResult` in `@useoptic/rulesets-base` 1.0.9 builds its
  result without copying the `exempted` flag, and 1.0.9 is the last published
  release). Landing it needs an owner decision this story cannot make: patch or
  vendor `@useoptic/rulesets-base` so request-body property exemptions survive,
  or merge the corrected baseline past the gate once. Story 5.3's own contract
  dodges the hazard rather than relying on the pass —
  `nullablePremiumThemeKeySchema` publishes a finished `enum` array of its own —
  so new contracts have a pattern to copy in the meantime.

- **The web section's `load_failed` state has no retry control.** A transient
  failure on the initial GET leaves an entitled subscriber unable to reach their
  palettes again without a full page reload: the effect's only dependency is the
  translated error string, which is fixed for the session. `SubscriptionSection`
  has exactly the same shape, so this is a convention to change on both surfaces
  at once rather than a divergence to fix on one, and changing it needs a retry
  affordance designed and translated across ten catalogs.

- **Two OpenAPI components are registered and referenced by nothing, so the SDK
  carries four spellings of one palette enum.** `packages/api-client/src/contracts/http/premium-theme.ts`
  registers `PremiumThemeKey` and `PremiumTheme`, but `PremiumThemeResponse` and
  `UpdatePremiumThemeResponse` inline their own copy of the object rather than
  `$ref`-ing the registered handle, so the generated models hold
  `PremiumThemeThemeEnum`, `PremiumThemeResponseDataThemeEnum`,
  `UpdatePremiumThemeInputThemeEnum` and a standalone `PremiumThemeKey`. Nothing
  is wrong on the wire and `5.3-CONTRACT-15` still pins the published enum, but
  the assertion guards a component no operation consumes. Deferred because the
  fix regenerates the SDK and reshapes published nodes, which is an `optic diff`
  conversation of its own and has nothing to do with this story's behaviour.

- **Two `apps/api` integration runs against one PostgreSQL fail each other.**
  Recorded in `_bmad-output/project-knowledge/development-guide.md` with the
  remedy "run one at a time", which leaves a live false-failure source for anyone
  who forgets. The affected specs (`commerce-affiliate-offers`,
  `commerce-affiliate-clicks`, `commerce-affiliate-webhook`) assert on rows and
  counts in shared tables; the durable fix is to scope those assertions to a
  per-run prefix, the pattern `weather-alert-cooldown.integration.spec.ts`
  already uses, or to give each run its own schema.

- **`GRANT DELETE` and `authenticated_delete_own_user_data` on
  `PremiumThemePreference` sit against Decision 8's never-delete rule.** Both
  review layers raised it. Kept deliberately: the four-verb grant plus the four
  named policies are the `selfOnlyTables` category contract that
  `packages/db/test/rls/premium-theme.spec.ts` asserts for every member of the
  category, so narrowing this one table would fail the shared assertion and make
  it the only exception in the matrix. Never-deleting is a service-layer
  invariant, and the API is the only writer any client has. Recorded so the
  tension is on the record rather than rediscovered.

### Two local Playwright harness defects, found while proving the story 5.3 tests green locally (2026-08-19), both fixed rather than left as caveats

Neither is caused by story 5.3, neither reaches CI (a fresh CI checkout has no
`.env.local`, so both dormant code paths never fire there), and both were
silently making local `npm run test:pw-local` runs of
`premium-theme-switcher.spec.ts` diverge from what CI would actually see.
Recorded here because they were found in the course of this story's own local
verification and fixed on the spot rather than filed as "local env issue,
someone else's problem."

- **`db:seed`, run bare inside `scripts/start-api-e2e-with-workers.mjs`, silently
  seeded the wrong local Postgres.** With no `DATABASE_URL` in the child's env,
  Prisma's own `.env` auto-load resolved it to `packages/db/.env` (a second,
  unrelated `localhost:5432` database some contributors keep for standalone
  `prisma studio`/`migrate dev` work), not the `127.0.0.1:54322` Supabase-style
  instance the rest of the stack (and `scripts/prisma-migrate-deploy.mjs`,
  which explicitly forces `.env.local`) actually runs against. The seed step
  reported success and left the real target database on stale fixture data,
  `premium_themes_enabled` included. Fixed by loading the same root env files
  `load-env.ts` loads directly into the orchestrator's own `env` object before
  any child spawns, so `db:seed`, the API process, and the worker process all
  get one explicit, agreed-upon `DATABASE_URL` instead of three independent
  resolutions.

- **`load-env.ts`'s `.env.local` override silently re-enabled live PostHog for
  local E2E runs.** `playwright/config/local.config.ts`'s `webServer.env` sets
  `POSTHOG_API_KEY: ''` on purpose, to keep feature-flag reads on the
  deterministic seeded/cached fallback (Decision 9's whole reason
  `premium_themes_enabled` is seeded `true` rather than flipped on by default).
  But `load-env.ts` forces every key `.env.local` defines to win, for any
  `TEST_ENV=local` run, and `.env.local` carries a real `POSTHOG_API_KEY` for
  ordinary local dev — so it silently overrode the disable, `PostHogService`
  came back up with a live client, and `premium_themes_enabled` resolved
  against whatever PostHog's dashboard actually says today (`false`, at the
  time this was found) instead of the seed, `??`-outranking the correct cached
  value because a live `false` is not the `undefined` the fallback logic is
  written to defer to. This is exactly the failure this story's own
  `5.3-E2E-010` and `5.3-E2E-012` caught locally: `themesEnabled: false` where
  the seeded fixture said `true`. Fixed by having `load-env.ts` (and the same
  guard, mirrored, in the orchestrator's own env-loading) snapshot any var a
  caller already set to the empty string before the `.env.local` override runs,
  and restore it afterward — an explicit empty string is a deliberate "off,"
  not an "unset" the file is free to fill in. Covered by a new case in
  `apps/api/src/load-env.spec.ts`.

## Deferred from: test-review reconciliation on PR #133, story 5.3 (2026-08-20)

Murat (bmad-tea) ran `test-review` against the Story 5.3 Pact/Playwright/integration
set, then cross-checked it against an independently-run Codex TeA review on the same
PR. Both real findings each caught that the other missed are fixed on the branch
(the fixes are in the PR diff, not repeated here). Two items surfaced that are
deliberately not fixed in this pass, plus one already-flagged item worth
cross-referencing:

- **`api-contract-interactions.ts` (3985 lines) and `provider-helper.ts` (1711
  lines) are both well past the 1000-line maintainability ceiling.** Real, and
  `test-review`'s own H5 finding recommends splitting both along their existing
  domain-section boundaries (`api-contract-interactions.ts` already carries
  `/* --- Story X.Y --- */` dividers; `provider-helper.ts`'s ~1150-line
  `startLocalPactProvider` is dominated by per-domain mock-service literals).
  Not done here: a second, concurrently-running session (`couture-cast-a9`,
  working `bmad-build` against this same ledger's backlog) had already claimed
  exactly this split as a planned later wave on this same branch before this
  review landed. Splitting it here too would have raced that work rather than
  helped it. Left for that wave.

- **The `requireSchema()`/`context.skip()` pattern silently turns a missing or
  unmigrated schema into a green, assertion-free suite.** Codex's review flagged
  this correctly on `premium-theme.integration.spec.ts:92-98`: `beforeAll` probes
  the schema, and every test does `if (!requireSchema(context)) return` before
  its first assertion, so a database that predates a migration reports as
  passing rather than as blocked. That is a real evidence-integrity gap on its
  own. Not fixed here because it is not this file's pattern: the identical
  `probeSchema`/`schemaReady`/`requireSchema`/`context.skip()` shape is already
  in thirteen other files under `apps/api/integration/` (`commerce-affiliate-*`,
  `wardrobe-*`, `premium-subscription`, `premium-stripe-rail`,
  `premium-revenuecat-webhook`, `premium-reconciliation`,
  `weather-alert-cooldown`), all pre-existing and all sharing the same
  hollow-green risk. Patching only the newest file would make it the one
  inconsistent file in the tier; patching all fourteen is a repo-wide behavior
  change (fail loud on missing schema vs. skip quietly) that deserves its own
  reviewable decision, not a rider on a test-review reconciliation. Whoever
  takes it should decide once for the whole `apps/api/integration/` tier and
  apply it uniformly.

- **Priority markers (`[P#]`) are a Playwright-only convention today, not a
  Vitest one.** `test-review`'s own L2 finding already covers this (0 of 40
  sampled Vitest files carry the marker, versus 12 of 40 sampled Playwright
  files); noted here only so a future reader searching this ledger for the
  premium-theme test set finds the pointer. Same shape as the two items above:
  a repo-wide convention question, not a defect in any one file.

## Added during the deferred-backlog burn-down, wave 1 (2026-08-20)

Found while fixing the three API-runtime items above. None is caused by that
work; each was in the way of verifying it.

- **The wardrobe retention purge depended on the whole `RitualService` to clear a
  cache key.** `WardrobeRetentionService` called `ritualService.invalidateUserCache(userId)`
  and nothing else, but taking `RitualService` as a constructor dependency drags
  in weather, saved locations, commerce and a Redis client, which is why the
  sweep could not run anywhere the full request graph was not already standing.
  Fixed rather than deferred, because the `@Cron` migration above could not land
  without it: the SCAN/DEL and the `ritual:<userId>:*` key prefix moved to
  `modules/personalization/ritual-cache.ts`, `RitualService.invalidateUserCache`
  delegates to it and keeps its signature, and `WardrobeRetentionService` now
  injects the narrow `RITUAL_CACHE_INVALIDATOR` token (`useExisting: RitualService`
  in `personalization.module.ts`). The key prefix having exactly one definition
  is the point: a second copy that drifted would leave deleted garments visible
  in cached outfits, silently, with every other test still green.

- **`FeatureFlagsCron` was renamed to `FeatureFlagsWarmup`.** Once the periodic
  refresh moved to the worker, the only thing left in that class was
  `onModuleInit`, which is a cold-start cache warm and not a schedule. It stays
  registered in `FeatureFlagsModule` and stays in the request app, because a
  populated fallback cache before the first request is exactly what it is for.
  The name is the whole change; five `apps/api/integration/*.spec.ts` files that
  override the provider were updated with it.

- **`npm run start:workers` cannot start from this repository's env files alone.**
  Three separate values block it, and each has to be discovered by running into
  it: `ANALYTICS_ID_SECRET` is required at ≥32 characters and appears in
  `.env.example` only, so a worker outside a `NODE_ENV=test` / `TEST_ENV=local`
  shell cannot construct `TelemetryService` at all; `WEATHER_REFRESH_MINUTES` is
  validated `min(1).max(5)` while the value carried locally was `30`; and
  `WEATHER_INGESTION_TARGETS_JSON` needs a `locationName` per target that the
  local value omits. The API's own E2E orchestrator never hits these because it
  supplies its own environment. The fix is a documented worker env contract, or
  defaults that make a local worker start without a scavenger hunt. Filed rather
  than fixed because the values live in developer-local files this change should
  not be reaching into.

- **Nest DI does not work under `tsx`, anywhere in this repository.** Recorded
  separately from the `@Cron` entry because it is not specific to it: esbuild
  emits no `design:paramtypes`, so `NestFactory.createApplicationContext` in any
  tsx-executed entrypoint hangs indefinitely rather than erroring. Verified
  against unmodified `main` code, on `AppModule` itself, so this is a property of
  the toolchain and not of any one module. It costs nothing today because both
  worker entrypoints hand-wire, but it is a trap with no error message, and the
  cheap guard would be a comment at the top of each tsx-executed entrypoint
  saying so.

## Deferred from: story 5.4 colour palette & beauty/accessory advisor (2026-08-25)

Everything below is a deliberate limit of the shipped story, recorded so a later
reader can tell a decision from an omission. Nothing here is a known defect in
what shipped.

**Status after the 2026-08-26 closing pass, on the same PR.** Six entries are
resolved and struck through below, two of them because the entry itself was
wrong rather than because the work was hard: the integration tier was already
running in CI, and a retired rules version does not empty the card list. The
product-scope entries — guardian visibility, moderation records on a flagged
teen selfie, re-analysis without re-upload, the beauty-partner console, watch
and widget surfaces, `recommendation_id`'s dual meaning, and Maestro's
locked-state-only advisor coverage — are decisions rather than debt and are left
exactly as they were.

What remains open is three CI-plumbing items, and they share a reason: each
needs a RUNNER rather than a checkout, and the standing rule is that a change to
shared CI plumbing is proven under `workflow_dispatch` before it gates anything.
Fixing them from a laptop would mean shipping an unverified guess about
infrastructure other workstreams depend on. They are the per-attempt Maestro
artifact fix, the Linux-only Pact consumer flake, and the `open-settings.yaml`
emulator flake; each entry states what a fix needs and who can do it. Updated
2026-09-04: story 5.5 closed the `open-settings.yaml` flake and mitigated the
Pact one, both from real CI failures on PR #141. Two remain, and the Pact
entry's own port question is one of them.

- **A guardian cannot see a teen's derived palette, and no planning document says
  whether they should.** `PaletteProfile` and `AdvisorRecommendationState` are
  registered in `selfOnlyTables`, not `guardianSharedTables` (Decision 11), even
  though the adjacent `PaletteInsights` is guardian-shared. The reasoning: guardian
  consent already gates **whether** an under-16 account may upload at all, through
  the unchanged `WardrobeUploadGuard` → `GuardianService.assertWardrobeUploadAllowed`,
  and exposing a derived body characteristic to a guardian is a different mandate
  that no PRD, epic or UX line grants. `PaletteInsights` being guardian-shared is
  about garment colours, not skin. Product should revisit this deliberately; the
  reversal is a category move in `packages/db/test/rls/harness.ts` plus a
  migration, not a redesign.

- **A flagged teen selfie notifies nobody and leaves no reviewable record.** Story
  4.4 writes a `ModerationEvent` plus one guardian `EventEnvelope` per active
  consent inside its terminal transaction. This story writes neither, and the
  reason has to be stated rather than discovered: `ModerationEvent` has relations
  to `LookbookPost`, `GarmentItem` and `SilhouetteProfile` and none to
  `PaletteProfile`, and a moderation row is a pointer to evidence a human can
  review — evidence Decision 8 has just deleted on purpose. A selfie that trips
  the privacy check terminates `failed` / `privacy_violation`, purges, and tells
  the user. If guardian notification on a flagged teen selfie turns out to be
  required, it needs either a retention carve-out or a notification that carries
  no image, and both are policy calls no planning document has made.

- **There is no re-analysis without re-upload.** Decision 8 purges the selfie the
  moment the analysis terminates, success or failure, so there are no bytes to
  re-read. A future story that wants "re-run with a better model" owns
  re-prompting for a photo. This is the direct cost of the retention posture and
  is worth paying; it is recorded so nobody plans a background re-classification
  sweep that cannot exist.

- **There is no beauty-partner admin console**, inheriting story 5.1's catalog
  posture exactly. Advisor offers are seed- and migration-managed
  (`seedAdvisorOfferCatalog`, `packages/db/prisma/seeds/commerce.ts`), behind the
  same `allowsCommerceSeeding()` guard that keeps commerce seeding out of
  production. Onboarding a real beauty partner is an operator task with no UI.

- **`AffiliateClick.recommendation_id` now has two meanings.** For a garment click
  it is the `ScenarioOutfit.id` the CTA was rendered on; for an advisor click it
  is the acting user's `PaletteProfile.id` (Decision 7). The column comment states
  both. Renaming it would be a migration on a shipped table for no behavioural
  gain, so the dual meaning stands. One thing was tightened rather than accepted:
  the advisor value is resolved server-side from the session
  (`CommerceRepository.findPaletteProfileId`) rather than taken from the request
  body, because the 60-second dedupe index is `(user_id, offer_id,
recommendation_id, minute)` and a client that can choose the third column can
  mint unlimited attributed clicks for one offer inside one minute. The garment
  path derives its key the same way, from a lookup it was already making:
  `findRecommendationScenario` is scoped to `user_id`, so hoisting it above the
  dedupe check lets its answer gate the key as well as the `scenario` column. An
  id that resolves is stored as sent, which keeps the impression-to-click join
  the PRD's click-through metric depends on; an id that does not collapses onto a
  single sentinel.

  A sentinel rather than a rejection, deliberately. A forged id and one whose
  `OutfitRecommendation` row rotated behind the Redis and on-device ritual
  caches are indistinguishable from the service, and Decision 7 forbids failing
  the second — so the tap still mints, into one bucket, while a forger gets one
  bucket instead of an unbounded supply. `5.4-INT-036` proves the collapse
  against the real unique index over HTTP, `5.4-INT-037` proves an owned id
  survives untouched, and `5.4-INT-034` proves the rotated tap still mints.
  The `affiliate_cta_clicked` event now reports the STORED id rather than the
  one sent, so the event and the click row stay joinable (`5.4-INT-035`).

  The column's dual meaning stands, unchanged and still not worth a migration.

- **Watch and widget advisor surfaces are out of scope**, unchanged from story
  5.3's Decision 5 and story 5.1's reasoning. No file under `apps/mobile/targets/`
  or the Android widget sources is touched. Neither surface has room for a
  sponsorship disclosure, and an undisclosed affiliate tap target would breach the
  PRD guardrail at `prd.md:47`.

- **The advisor's Maestro coverage is the locked state only.** The harness signs
  up a fresh public-API user, so the entitled advisor, the consent journey and the
  `expo-image-picker` capture path are all out of a Maestro run's reach. Both
  limits are stated in `maestro/palette-advisor.yaml`'s own docblock and in the
  story's "explicitly untested" section, and both are covered at other tiers
  (`palette-advisor-screen.test.tsx` through MSW,
  `playwright/tests/palette-advisor.spec.ts` against the seeded entitled user with
  the worker live).

- **A pre-existing Pact consumer flake is still unfixed**, and it failed two CI
  runs on this branch. Both failures are in `web-api-client.pacttest.ts`,
  reporting `The following request was expected but not received`, and both are
  on `/api/v1/personalization/comfort` — but on DIFFERENT interactions and
  different run indices: "updates user comfort preferences" (`PUT`) on run 3 of
  the three-run determinism check, then "reads user comfort preferences" (`GET`)
  on run 1. Different test failing each time is the signature of an environment
  race rather than a code defect, and both interactions belong to story 2's
  ritual-comfort surface, untouched here.

  What has been ruled out. It did not reproduce in 37 local suite runs: 12
  direct, 5 full three-run determinism cycles, and 10 more under deliberate CPU
  saturation (28 busy loops on 14 cores). The consumer config already serialises
  everything it could race against — `fileParallelism: false`,
  `singleFork: true` — so parallel mock servers are not the cause. The
  interactions immediately preceding the failures (`events/poll`, the invalid
  cursor payload, the ritual read) all `await` their requests inside
  `executeTest`, so no earlier interaction leaves a request in flight to land on
  a later mock server.

  The leading hypothesis is undici connection reuse across mock servers. All 161
  interactions run in ONE process against 161 short-lived servers on ephemeral
  ports, sharing one global dispatcher; a pooled keep-alive socket to a port the
  OS has since reassigned to a new mock server would produce exactly this
  symptom. It would also explain why it is Linux-only in practice: Linux recycles
  ephemeral ports from a lower, narrower range than macOS, which is likely why
  saturating a Mac reproduces nothing.

  **UPDATE 2026-08-26: it reproduced on macOS, and that reading of it is wrong.**
  `npm run test:pact` failed on run 3 of the determinism check on an M-series
  Mac, in `mobile-api-client.pacttest.ts` this time, on `a request to poll
realtime fallback events` — a third distinct interaction, in a third file, with
  the identical "The following request was expected but not received" signature.
  So it is not Linux-only, and the ephemeral-port-range argument for why it
  should be Linux-only does not survive. It remains rare: 20 further local runs,
  8 of them beside a full `apps/web` coverage run for realistic I/O load,
  reproduced nothing.

  **The undici hypothesis is refuted by the failure's own shape, and this is the
  useful part.** Read `executeTest` in
  `node_modules/@pact-foundation/pact/src/v4/http/index.js:34-58`: it captures a
  callback error, and where BOTH a callback error and a mismatch exist it
  RETHROWS THE CALLBACK ERROR, reaching the "test didn't throw, so we need to
  ensure the test fails" branch only when the callback succeeded. We got the
  mismatch error. So the client received a response that parsed against
  `eventsPollResponseSchema` and satisfied a `toEqual` on the whole body — in
  14ms — while the mock server being verified reported no request at all. Every
  transport-level story fails on that: a socket pooled to a closed server throws,
  and a socket reaching a DIFFERENT pact mock server gets that server's 500 for
  an unmatched route, which throws too. A successful, correct response is not
  something the wrong endpoint can produce.

  What can produce it is the verification query resolving to the wrong server.
  `executeTest` takes `pact.createMockServer(host, 0, false)`'s return value —
  a PORT — and uses that port as the identity in `mockServerMismatches(port)` and
  `mockServerMatchedSuccessfully(port)`. Servers are created and torn down once
  per interaction, 161 times in one process, so port numbers are recycled hard.
  If a torn-down server has not fully deregistered from the FFI's registry when
  a new one is handed the same port, the request is received and matched by the
  right server while the verification reads the stale entry. The position fits:
  the failing interaction was the SECOND in its file, immediately after a
  17ms one, which is the tightest create-teardown-create window in the run.

  **What a fix needs now.** Not a dispatcher. Either an explicit distinct
  `opts.port` per interaction so no two mock servers in a process can share a
  port number, or an upstream fix in `pact-foundation` if the registry race is
  confirmed there. Neither should be shipped on this one observation: it is a
  single failure against a hypothesis formed from it, which is exactly the shape
  of reasoning that produced the refuted one above. The next person should
  instrument `createMockServer`'s returned port per interaction, log the
  sequence, and look for a repeat within one process — that turns the guess into
  a measurement. Until then, a failed Pact job on this signature should be re-run
  rather than treated as a regression, and this entry is why it stays visible
  behind the green tick.

  **Updated 2026-09-04 by story 5.5, commit `f95c09fa`: reproduced, characterised
  and mitigated. The open question above is untouched.** Saturating 12 to 13 of
  14 local cores while running the consumer suite repeatedly turned this from
  unreproducible into a roughly 33% per-run failure (2 of 6 stressed runs, each a
  single different interaction), which is the reproduction this entry was waiting
  for. It identified the cause as a PactV4 FFI mock-server timing race:
  `.addInteraction()...executeTest()` tears down the previous interaction's mock
  server and stands a fresh one up for every single test, hundreds of times per
  file, and under contention that teardown and startup pair can overlap, so
  whichever interaction is mid-registration fails with "The following request was
  expected but not received" while its own request and response pair is correct.
  That clears every individual interaction, including the two comfort ones this
  entry names. `pact/http/vitest.consumer.config.mts` now carries a bounded retry
  against exactly that signature, with the reasoning in its own comment.

  A retry is a mitigation. What closes this entry is still the fix named above:
  an explicit distinct `opts.port` per interaction so no two mock servers in one
  process can share a port number, or an upstream fix in `pact-foundation`. The
  instrumentation step is now cheaper than it was, because the stressed-run
  recipe reproduces the failure on demand.

- **`gh run rerun --failed` can never turn the Maestro workflow green**, which
  makes recovering a single flaked shard more expensive than it should be. The
  `mobile-e2e-report-comment` action ends with an integrity check that refuses a
  green suite the reports do not support, and one of its conditions is
  `SHARDS_SEEN < EXPECTED`. That check is correct and worth keeping — it is what
  stops a matrix from reporting success while half the suite never ran. But
  `actions/download-artifact@v4` is scoped to the CURRENT run attempt, so after a
  partial re-run the report job can only see the artifacts of the shards that
  re-ran. On this PR all seven shards genuinely passed (six on attempt 1, shard 7
  on attempt 2) and the report job still failed with "only 1 of 3 shards left
  reports". The only ways out are a FULL re-run of the workflow or a new push.

  A fix would mean naming shard artifacts per attempt and having the report job
  fetch across attempts through the API rather than through
  `download-artifact`'s default scope, which is a change to shared CI plumbing
  and wants its own proving run under `workflow_dispatch` before it gates
  anything.

## Deferred from: story 5.5 premium 7-day outfit planner (2026-09-04)

These were identified while drafting and implementing story 5.5 and were
deliberately left out of its scope, or are limits the story's own test plan
already names. Each records what was narrowed and why, so a later story does
not have to rediscover the reasoning.

- **Whole-week reshuffle, and the rest of the epic's planner surface beyond
  this story.** The story's own scope line is explicit: it delivers the
  generated seven-day planner, per-day reshuffle, the web drawer, and the
  mobile screen; calendar sync, manual slot editing, share/export, planner
  widgets, watch surfaces, whole-week reshuffle, occasion selection, and
  planner affiliate CTAs all remain deferred. Each reshuffle control (Decision
  7, AC 4) regenerates exactly one date; there is no "reshuffle the whole
  week" control anywhere in the contract or either surface.

- **No planner affiliate CTAs.** Decision 4 is explicit: the stored payload
  omits affiliate offers, and every planner scenario returns
  `shopThisLook: null` at the response layer regardless of what a real
  `ritual`/`palette-advisor` scenario would carry. This preserves the shared
  scenario contract shape while keeping planner affiliate behavior out of this
  story. Wiring real offers into planner cards is new product surface, not a
  test-plan gap.

- **WeatherAPI deployed forecast depth is an operator verification, not a
  test.** Decision 3 adds a validated `WEATHERAPI_FORECAST_DAYS` config,
  defaulting to `3` and capped at `8`; the story's open questions and its own
  "Explicit test limits" section both say the deployed value should only move
  to `8` after confirming the provisioned WeatherAPI plan actually supports
  that depth. Provider plan depth itself is covered by configured fixtures in
  the provider mapper specs (Task 1); nothing in this codebase's automated
  suite can prove what a _production_ WeatherAPI subscription is entitled to
  return, so that confirmation stays an operator step, recorded here rather
  than simulated.

- **The story's own explicit test limits, restated.** From the story's Test
  plan section, so they are not only inside the implementation artifact: the
  Maestro harness proves the planner's locked state and navigation, because
  its standard account has no Premium entitlement (`maestro/premium-planner.yaml`
  is the same honest-scope shape as `palette-advisor.yaml` and
  `premium-subscription.yaml` — see that file's own header for the full
  reasoning); long-term pruning is tested at the window boundary and through
  cascades (`apps/api/integration/planner.integration.spec.ts`), not by
  advancing real wall-clock time across a retention period; and the story adds
  no k6 scenario because planner reads are Premium-only, user-scoped, and
  outside the existing hot-path performance budget.

- **Manual VoiceOver and TalkBack verification was never performed for this
  story.** AC 7 asks for native evidence covering semantic component assertions
  plus manual VoiceOver and TalkBack checks. The semantic half shipped:
  `apps/mobile/src/screens/planner-screen.test.tsx` and
  `apps/web/src/app/components/planner-rail.test.tsx` assert roles, accessible
  names, and live-region politeness versus alert semantics, and
  `playwright/tests/planner.spec.ts` drives real `Escape` and `Tab` keypresses
  through Chromium and scans both variants with axe. The manual half did not:
  the implementing session had no physical iOS or Android device and no real
  screen reader. Its Dev Agent Record says so plainly, following the disclosure
  pattern stories 4.4 and 5.1 established for the same limitation.
  **What a fix needs:** a person with a physical device running VoiceOver on the
  `/planner` route and TalkBack on the same screen, walking the seven day cards,
  the reshuffle controls, and the locked and error states, and recording the
  result in the story's Dev Agent Record. No automated tier in this repository
  can substitute for it, so it belongs in the operator runbook or a session with
  real hardware.

- **None of this story's test files carry the searchable `Learning path Step`
  cross-link comment.** The learning path's own contract
  (`_bmad-output/project-knowledge/learning-path-step-by-step.md`, instruction 8
  under "Instructions for LLMs updating this file") requires a Step cross-link
  comment in every test file a numbered step lists, and Step 37 lists eighteen
  of them: `apps/api/src/modules/personalization/ritual-generation.engine.spec.ts`,
  `ritual.service.spec.ts`, `planner.service.spec.ts`,
  `planner.controller.spec.ts`, `apps/api/integration/planner.integration.spec.ts`,
  `packages/api-client/testing/planner-contract.spec.ts`,
  `packages/api-client/testing/planner-analytics.spec.ts`,
  `packages/db/test/planner-schema.spec.ts`, `packages/db/test/rls/planner.spec.ts`,
  `packages/testing/test/planner.factory.spec.ts`,
  `apps/web/src/app/components/planner-rail.test.tsx`,
  `apps/web/src/app/components/lookbook-prism-layout.test.tsx`,
  `apps/web/src/lib/planner.test.ts`, `apps/web/src/i18n/planner-locales.spec.ts`,
  `apps/mobile/src/screens/planner-screen.test.tsx`,
  `apps/mobile/src/lib/planner.test.ts`,
  `apps/mobile/src/i18n/planner-locales.spec.ts`, and
  `playwright/tests/planner.spec.ts`. Story 5.3 added these comments to every
  file Step 35 lists, so the convention is live and has been honoured once.
  **What a fix needs:** one comment line per file, in that file's own header
  comment style, naming Step 37. It is an eighteen-file mechanical edit under
  `apps/`, `packages/` and `playwright/`, which is why it is recorded here
  rather than folded into the documentation pass that found it.

## Added during documentation work on story 5.5 (2026-09-05)

Found while writing Step 37 of the learning path. This is process debt: it
belongs to the story template every future story is drafted from, so recording
it under a story number would hide it.

- **A story file's `status` is a second copy of a value only
  `sprint-status.yaml` actually owns, and it drifts.** Three pieces of
  evidence. The field is already optional: stories 5.1, 4.3 and 4.4 carry no
  `status:` frontmatter key at all, only a body `Status:` line, so nothing
  structural depends on it. It drifted in four of the five most recent stories:
  on 2026-09-05, `5-2` read `in-progress`, `5-3` read `in-progress`, and `5-4`
  and `5-5` read `review`, while `sprint-status.yaml` recorded all five of
  5.1 through 5.5 as `done`. And nothing automated reads it: no script under
  `scripts/` and no workflow under `.github/` references `sprint-status.yaml`
  or story frontmatter, so the only readers are the BMAD skills, which read
  both files anyway. A field that is wrong more often than right costs a reader
  a wrong call. The concrete cost here: the first draft of Step 37 had to carry
  a caveat sentence explaining which of the two records wins, which is a
  documentation workaround for a data problem.

  **What a fix needs.** The preferred fix is to delete the field, leave
  `sprint-status.yaml` as the single live record, and have the story template
  emit a pointer line naming that file. The fallback, if the BMAD skills need
  the frontmatter key to write at hand-off, is to keep it and add a consistency
  check to the quality gate asserting that every story file's status equals its
  `sprint-status.yaml` entry, so drift fails a build. Either way the
  repository-side lever is a `_bmad/custom/*.toml` override.
  `project-context.md:138-139` states that installer-managed BMAD configuration
  changes through that path because a direct edit to `_bmad/config.toml` is
  overwritten on installation, so the config file is the wrong one to reach for.
  The story template itself is not checked into this repository: the `_bmad/`
  tree here carries `config.toml`, `config.user.toml` and the `custom/`
  overrides, so whoever picks this up starts from the override and from whatever
  BMAD skill drafts the story. That is a workflow change with its own blast
  radius, which is why it is recorded here rather than folded into the story
  that found it. The four drifted files were corrected in place on 2026-09-05;
  whatever produces the drift was not touched.

## Deferred from: story 6.1 community feed by climate band (2026-09-05)

Recorded while story 6.1 is still in flight, so a reader of this ledger sees the
open item without waiting for the story to close.

- **Nine of the ten community locale catalogs are machine-translation drafts
  that no native speaker has read.** Story 6.1 localized the whole community
  surface: a `community.*` tree of 135 leaf keys, shipped identically on web
  (`apps/web/src/i18n/locales/`) and mobile (`apps/mobile/assets/locales/`)
  across all ten supported locales.

  What is proven, and it is a stronger floor than most localization passes
  ship with. `apps/web/src/i18n/community-locales.spec.ts` (8 tests,
  `6.1-I18N-WEB-01` through `-08`) and
  `apps/mobile/src/i18n/community-locales.spec.ts` (9 tests, `6.1-I18N-MOB-01`
  through `-09`) both pass, and between them they hold: a non-empty
  `community` tree in every locale, an identical key tree across all ten,
  identical `{{token}}` sets, no English text left in a non-English catalog, a
  label for every `CLIMATE_BANDS` member, every community post status, every
  report reason and every band-unresolved reason, and, in `6.1-I18N-MOB-09`,
  the two surfaces value-identical in all ten locales so a string cannot drift
  on one surface alone. Three of those key sets derive from the contract's own
  enums rather than a hand-written list, so a seventh climate band or a new
  report reason fails the spec, which catches it before a raw `temperate_wet`
  renders on a pill in front of a member.

  What no test can prove is that any of it reads well to a native speaker, or
  that the tone matches the brand in nine languages. Both spec files carry a
  header comment saying the non-English values are machine-translation drafts
  pending human review, so the code does not overstate what it holds either.

  **What a fix needs.** A native speaker per locale reading the rendered
  surface, not another automated pass: every automated check this repository
  can run is already green here, and none of them reads for register, idiom or
  brand voice. This is one of the eight named signatures on the Community Beta
  release gate. The story's own acceptance criteria keep production `off` until
  moderation staffing, SLA alerts, privacy, deletion, localization,
  accessibility, model and rollback evidence are signed, and the same eight are
  recorded at `_bmad-output/project-knowledge/couturecast_roadmap.md:155` with
  both production read and write rollout controls held off until every one is
  signed. So this entry is a named blocker on opening Community Beta.

- **Four local paths that answer confidently about state nobody intended.**
  The shape is the finding; each instance on its own reads as a one-off.
  1. `npm run db:seed` from the repository root seeded the WRONG DATABASE. It
     passed no `DATABASE_URL`, so `prisma db seed` fell through to Prisma's
     dotenv auto-load, resolved `packages/db/.env`, and connected to
     `localhost:5432/couture_cast`. The intended target is the local Supabase
     container.
     FIXED: root `db:reset` and `db:seed` now route through
     `scripts/run-with-local-db-env.mjs` (verified in the root `package.json`).
     The part worth keeping is how it surfaced. It failed loudly only because
     the two schemas had drifted far enough to produce `P2022`, "the column
     LookbookPost.status does not exist". Before that divergence it seeded the
     other database and reported success.

     The same `packages/db/.env` is a live trap for anyone writing a probe, and
     not only for `db:seed`. `apps/api/vitest.config.ts:10-34` carries a
     thirty-line warning that importing `@prisma/client` loads that file as a
     side effect and silently overwrites `process.env.DATABASE_URL` inside the
     worker. On 2026-09-05 the test architect read that warning, quoted the same
     config in its own review, then wrote a probe that resolved
     `process.env.DATABASE_URL` after importing `@prisma/client`, measured
     `localhost:5432/couture_cast`, and reported the pre-6.1 schema it found
     there as a finding. Its own diagnosis is the useful part: the probe had no
     could-not-measure state for "connected to a database I did not name", so it
     printed a row count and a column set and read agreement with its own
     expectation of failure as evidence. A probe that logged its resolved
     connection string would have ended it in one line. (The probe itself is
     reported; `apps/api/vitest.config.ts`'s warning and the `.env` mechanism
     are in the repository and were checked.)

  2. `apps/api`'s `pretest:cov` hook never fires for the script that is actually
     run. `apps/api/package.json` declares `pretest:cov` and `test:cov`, and
     `test:cov` simply delegates to `test:coverage`, which has no
     `pretest:coverage` of its own. CI and every documented invocation call
     `test:coverage`, so a local coverage run reads whatever `dist` happens to
     be on disk. CI is unaffected: `.github/workflows/pr-checks.yml` runs an
     explicit "Build packages" step before `npm run test:coverage`. NOT FIXED,
     because it is build tooling and does not belong in a feature branch.
  3. `apps/api/dist` lags its source and returns `undefined` for anything added
     since the last build. On 2026-09-05 the two new
     `FIXTURE_TEXT_ENGINE_VERSION` and `FIXTURE_IMAGE_ENGINE_VERSION` constants
     read as `undefined` from built output while the source had them, which is
     the same shape as the other two: a build artefact silently lagging its
     source does not fail, it answers, and the caller cannot tell `undefined`
     from a value. Read the source when a constant is new. (Reported by the
     session that hit it; the constants are in
     `apps/api/src/modules/community/community-moderation.engine.ts:14-15` and
     were checked there.)
  4. A live verification mutated the one database every other tier reads,
     leaving eight rows behind including a published post, which made the feed
     six items where every suite expects five. Nothing on those rows marked
     which were fixtures and which were somebody's experiment. (Reported by the
     session that ran the verification; the row count is not re-checkable from
     the repository.)

  None of the four fails. Each answers confidently about state nobody
  intended, and two were caught only because a schema had drifted far enough to
  make them loud. **What a fix needs:** the second is a `package.json` change
  plus a check that no script declares a pre-hook for a name nothing calls; the
  third is a habit, which is to read the source when a constant is new; the
  fourth is the fixture-identification entry below.

- **Test fixture rows are not identifiable, so "whose row is this" is a guess.**
  Today the only way to separate a seeded row from a leaked one was reading
  `image_byte_size` off it: `102400` is the factory default
  (`packages/testing/src/factories/community.factory.ts:123`), and other values
  trace to a specific spec's own literal or to the byte size of a particular
  fixture PNG. Even the session that created rows could not reliably identify
  its own.

  **What a fix needs.** Mark the ACTORS and find rows by join. Rows are created
  through half a dozen code paths that would each have to remember a marker,
  while an account is created in exactly one place per suite. So the shape of
  the fix is a reserved namespace on the account, the existing prefixes kept as
  the sub-tier label, and one repository-level sweep that deletes every row
  owned by an account inside it. No schema change and no per-row discipline, and
  a human doing manual verification opts in for free by signing up inside the
  namespace, which is what would have prevented the incident above.

  **Amended 2026-09-05 by measurement, and the first draft of this entry had it
  backwards.** That draft proposed a reserved namespace that separated fixture
  accounts from real ones, keyed on `@example.com` being the fake domain. On a
  development machine everything is fake, and the seed itself sits in
  `@example.com`: `packages/db/prisma/seeds/commerce.ts:396` creates
  `premium-active@example.com`, and a query for posts owned by any
  `@example.com` account returns 5, which is every post in the database and
  exactly the five the seed is there to preserve. A sweep written to that
  proposal would have deleted the seed. The discriminator has to separate
  DURABLE fixtures from EPHEMERAL ones, so the seed keeps its own namespace and
  everything throwaway sits under one suffix that is safe to sweep wholesale.

  The same measurement found that this machine already carries three fixture
  domains that do not agree with each other, so a cleanup scoped to any one of
  them misses the other two:

      @example.com            the seed and the older probes
      @synthetic.test         the API integration specs
      @k6.couturecast.test    the load tier

  `@k6.couturecast.test` is minted at `k6/helpers/config.ts:173`;
  `@synthetic.test` is built inline by the integration specs, for example
  `apps/api/integration/community-challenges.integration.spec.ts:96`; the
  Playwright helpers mint `@example.com`, for example
  `playwright/support/helpers/community-session.ts:99`. That changes what the
  work IS: converge the probes and the ephemeral tiers onto `@synthetic.test`,
  which already exists and is unambiguous, and leave the seed where it is.
  Inventing a fourth convention is the thing to avoid.

  One population that fits none of the three, and has to be part of the same
  convergence: `@couture/testing`'s own user factory mints
  `faker.internet.email()`
  (`packages/testing/src/factories/user.factory.ts:101`), which produces
  ordinary-looking consumer domains. Those accounts are collected today only
  because `cleanup()` deletes the ids a test registered
  (`packages/testing/src/cleanup.ts:704`); nothing can find them by domain if a
  registration is ever missed.

  The population the marker most has to reach is the one easiest to miss:
  throwaway scripts. The single unattributable report row found on 2026-09-05
  came from `probe3.sh`, a shell script in a session's scratchpad that was never
  a committed fixture. It signed accounts up as `p3-$1-$SUF@example.com` with
  `SUF` set to `$(date +%s)$RANDOM`, which is why a repository-wide search for a
  generator producing that address shape found nothing: the generator was never
  in the repository. Provenance came from decomposing the address itself.
  `178864027315009` splits as the epoch `1788640273`, which is
  2026-09-05T20:31:13Z, plus a bash `$RANDOM` of `15009`, and the row's
  `created_at` was 20:31:13.580Z. Sub-second agreement is what turned
  resemblance into evidence; without it the honest answer would have been to
  leave a row nobody could account for. (Reported by the session that ran the
  probe: the script lives in a scratchpad, so nothing here is checkable from the
  repository except the epoch arithmetic, which is.)

  A committed fixture can be made to follow a convention by review. A script
  written mid-investigation has no reason to know the convention exists, and it
  is the population that produces residue nobody can attribute afterwards. It is
  also the population every session was in on 2026-09-05, which is worth saying
  plainly. This is where the reserved namespace earns its keep over a per-fixture
  prefix or a cleanup registry: signing up inside the namespace is ONE STRING in
  a curl body, a cost a human or an agent writing a five-line probe will actually
  pay, where "register your account with the cleanup helper" is not.

  The honest limit: this does not cover a row created against a SEEDED account.
  A namespace would have caught that report row and it would not have caught the
  published post a probe created against a seed user. There the rule is a
  convention rather than a mechanism. Verification work should not publish onto
  seed users, and a session that does it anyway sweeps before handing the
  database on. The orphaned-storage entry below is the other
  end of this same problem: an account nobody can identify is also an account
  nobody can sweep, and its allocated objects outlive it.

  A second property of the same helper decides whether an arm-sensitive
  assertion fails stably or intermittently, and it differs between two fixtures
  in one file. `communityTest` hands a test a single account for its whole run,
  so every request inside that test carries one experiment arm. `communityApiTest`
  is per test as well, and a test that mints a second actor through `trackUser`
  gives that actor its own arm; `buildUniqueId` folds a per-run stamp into the
  address (`playwright/support/helpers/api-test.ts:83-93`), so an account is new
  on every run and its arm is redrawn at roughly 50/50. One cursor test became a
  coin flip on exactly that, which would have read as an intermittent cursor
  defect: close to the worst available disguise for a deliberate behaviour
  change. The general rule is what to keep: an assertion that depends on a
  per-viewer assignment must DERIVE the assignment rather than assume it, and
  "is this fixture stable?" is a question with two different answers inside one
  helper. (The coin-flip test is reported by the session that hit it; the two
  fixtures and the per-run stamp are in the repository and were checked.)

  One concrete leak of this shape was found and FIXED today, and it shows the
  failure mode. The Playwright community fixture's teardown was correctly scoped
  to the throwaway account it created, and one spec creates a SECOND account and
  allocates under it, so exactly one orphan draft survived every full-suite run.
  `playwright/support/helpers/community-session.ts` now exposes `trackUser` and
  tears down every account a test registers. `POST /posts/allocate` creates a
  `draft` row and there is no public way to remove one, since `withdrawPost`
  deliberately rejects anything outside `WITHDRAWABLE_STATUSES`, so a spec that
  allocates without publishing leaks a row per call forever.

- **The feed's keyset page sorts a materialised set where it could seek.**
  Prisma expresses the cursor condition as an OR of two predicates, and
  PostgreSQL plans that differently from the row-comparison form. Measured on
  2000 seeded rows with identical parameters under `EXPLAIN ANALYZE`, and
  recorded in `community-feed-query-plan.integration.spec.ts` beside the
  assertion it explains:

      row-comparison   Limit -> Index Scan using
                       LookbookPost_climate_band_status_published_at_id_idx,
                       Index Cond including ROW(published_at, id) < ROW($3, $4),
                       no Sort node, shared hit=5
      OR form          Limit -> Sort (published_at DESC, id DESC)
                         -> Bitmap Heap Scan with Recheck
                           -> BitmapOr over both feed indexes, shared hit=8

  Both use the band index and neither scans the table, which is what the
  assertions check and both satisfy. The structural difference is what the
  numbers do next: the row-comparison seeks once and the index supplies the
  ordering, while the OR form materialises the matched set across two bitmap
  scans and then sorts it, so its cost tracks the size of the matched set where
  the other stays bounded by `LIMIT`.

  **Why this is recorded and not fixed.** It is not a regression this story
  introduced; Prisma has emitted the keyset this way throughout. Fixing it means
  hand-written SQL in the feed's hot path, and doing that on the final
  verification pass of a 204-file branch is a worse risk than a scaling property
  with a known trigger. And `6.1-PLAN-04` now pins the emitted shape, so a
  rewrite of the cursor condition is detectable rather than silent.

  **The limit of the measurement, stated so nobody over-reads it.** One band,
  2000 rows, fresh statistics. The shape difference is structural and will hold.
  The magnitude at production scale is unmeasured. The k6 result is not evidence
  about this: p95 91.68ms was measured at seed scale, where the two plans are
  equivalent at roughly 0.03ms each, and a measurement taken while the matched
  set is small says nothing about the matched set growing.

  **The trigger.** The matched set here is every published post in one band. It
  stays small through a 1,000-viewer beta and stops being small when production
  rollout opens, so re-run this `EXPLAIN` at production-representative row
  counts before the read rollout advances. The Community Beta gate already
  carries performance criteria, which is what this attaches to, so it is
  scheduled work rather than something someone has to remember.

- **Orphaned storage objects have no reconciliation path.** Two of the three
  community maintenance sweeps purge objects, and each covers one route:
  `sweepErasureRequests` purges objects for posts carrying
  `erasure_requested_at`, and `sweepExpiredUploads` purges drafts past
  `upload_expires_at`, both in
  `apps/api/src/modules/community/community-maintenance.service.ts` (the third,
  `sweepStalePendingReview`, raises alerts rather than deleting).
  Every OTHER route to removing a post takes the row and leaves the bytes: an
  operator, a test cleanup, a `deleteMany` in a fixture teardown. Today's
  concrete case was eight rows deleted and eight objects orphaned. Every draft
  carries an allocated object from its upload session, so an allocate that never
  publishes already leaves bytes behind before any delete path is involved.

  **What a fix needs.** A reconciliation sweep over the bucket rather than a
  hope that every delete path remembers. The schema already hints at that
  answer: `image_object_path` is denormalized onto `ModerationEvent` and onto
  `CommunityPostReport` (migration lines 306-308) precisely so an orphaned
  object stays findable after its post row is gone. Explicitly outside story
  6.1's scope and deliberately not added now.

  **Amended 2026-09-05: the unbounded thing is accounts, and it is arithmetic.**
  Measured on this machine by the session that ran the gate, and reported here
  rather than re-run: one full `npm run validate` added 38 accounts and zero
  durable posts. The user count moved 1296 to 1325 while `@example.com` stayed
  at exactly 593, because the 38 were 29 `@synthetic.test` and 9
  `@k6.couturecast.test`. Current scale is 1325 users against the five posts
  anyone wants.

  Nothing collects those accounts. Both community sweeps key on POSTS, and
  `@couture/testing`'s `cleanup()` deletes only the ids a test registered
  (`packages/testing/src/cleanup.ts:704`), which cannot reach an account created
  outside the registry: the integration specs build users directly through
  Prisma, and the Playwright and k6 tiers sign up through the API. So at one
  gate run per pull request the account table grows without bound on any
  long-lived environment, and the object store grows with it, because every
  allocate leaves bytes owned by an account nobody will ever collect. That is
  the same problem the fixture-identification entry above describes, seen from
  the other end: without a namespace to sweep by, there is nothing to key an
  account sweep on.

  What bounds the problem, stated because it is the good half of the finding:
  the integration tier collects its own content correctly. A mid-gate
  measurement caught twelve posts, including one `consent_suspended` and three
  `withdrawn`, and the count was back to the seed's five once the gate finished,
  with `CommunityPostReport` flat at 1. The tier that runs on every pull request
  creates and collects its own posts and reports. The leak is accounts.

## Open decisions from the Prisma drift cleanup (2026-09-05)

Five pre-existing Prisma drift items were closed in this pass, all on the
datamodel side with no migration written and no data touched, so
`prisma migrate diff` on a clean checkout now reports no difference. Four were
plain cleanups. The fifth left a decision behind that belongs to whoever owns
the schema's conventions, and it is recorded here because it changes nothing
today and blocks nothing. This section is a sibling of the story sections above
because the question is schema-wide.

- **Should `feature_flags.updated_at` be normalised from `timestamptz(6)` to
  `timestamp(3) without time zone`?** The column was written by hand in
  `packages/db/prisma/migrations/20260314160000_add_feature_flags/migration.sql`
  as `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`, and the live column is
  `timestamp with time zone` at precision 6. Every other Prisma-generated
  timestamp in this schema is `timestamp(3)` without a time zone, which is what
  a bare `DateTime @updatedAt` means. The drift was two facts at once: a missing
  default and a genuinely different type.

  What the cleanup did. `packages/db/prisma/schema.prisma` now carries
  `@default(now()) @updatedAt @db.Timestamptz(6)` on that field, which describes
  the column that already exists. No value moved and no client behaviour
  differs, because the query engine reads the column's real type off the wire
  whatever the annotation says. The field also carries a docblock stating the
  same reasoning at the point a reader meets it.

  Why nothing forces the question today. The table holds one row per flag key.
  The column is written only by `packages/db/prisma/seeds/feature-flags.ts`'s
  upsert and by the API's flag sync through
  `apps/api/src/modules/feature-flags/feature-flags.repository.ts`, and nothing
  reads it for logic: the only read is a `findUnique` by key, and no query in
  the repository filters or orders by it.

  The trade, stated both ways. Normalising costs a data-touching migration and
  a full table rewrite, which is trivial at this row count, and buys schema
  consistency plus one fewer annotation. Leaving it costs the annotation and an
  inconsistency that a future reader trips over once. What makes this a decision
  and not a cleanup: `timestamptz` is arguably the more correct type for a
  timestamp, and the rest of the schema is the odd one out, so normalising to
  match the others could be normalising toward the wrong answer.

  **What a fix needs.** Someone to decide which direction is right for the
  schema as a whole. The answer is a convention and this column is one instance
  of it: either every timestamp moves to `timestamptz`, or this one moves to
  `timestamp(3)` and the convention is written down so the next hand-authored
  migration follows it. Leaving it
  exactly as it stands is safe and keeps `prisma migrate diff` quiet either way,
  so nothing degrades while the decision waits.

## Developer tooling found during the Prisma drift cleanup (2026-09-05)

Unlike most of this ledger, this entry is a recipe. Every step below was run
end to end. It is recorded here because the fix belongs in its own pull
request.

- **`prisma migrate dev` has been unusable in this repository since April, and
  the fix is two lines of setup.** The command dies at `P3006` on
  `packages/db/prisma/migrations/20260420113000_add_guardian_shared_rls_policies/migration.sql`.
  No `shadowDatabaseUrl` is configured, so Prisma creates a temporary shadow
  database with no Supabase `auth` schema, and that migration's
  `private.current_app_user_id()` and `private.current_app_role()` are
  `LANGUAGE sql` functions whose bodies call `auth.jwt()`. PostgreSQL validates
  a sql function body at CREATE FUNCTION time, so it raises
  `schema "auth" does not exist` and the replay stops.

  **The fix, proven end to end.** First, add
  `shadowDatabaseUrl = env("SHADOW_DATABASE_URL")` to the datasource block in
  `packages/db/prisma/schema.prisma`. Second, prepare a shadow database
  containing the one thing Prisma cannot create for itself:

      CREATE SCHEMA auth;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
        SELECT coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb
      $$;

  No bootstrap migration is needed.

  **Evidence, which is what makes this actionable.**
  `prisma migrate diff --from-migrations ... --shadow-database-url <prepared db>`
  returns "No difference detected": all 38 migrations replay from empty and
  match the datamodel, which is also the from-migrations drift proof that was
  previously unobtainable. `prisma migrate dev` against a throwaway main
  database with that shadow configured returns "Your database is now in sync
  with your schema." Running the diff a second time against the now-populated
  shadow still returns no difference and `auth` survives, because Prisma's reset
  drops only the schemas the migrations own (`public`, `private`). Preparing the
  database is one-time setup, so it costs nothing per run.

  **Why nothing else is needed. Every claim here was checked.** `auth.` appears
  in exactly one migration and only inside those two function bodies. `storage.`
  appears in two migrations, `20260804180000_add_garment_capture_lifecycle` and
  `20260905120000_add_community_feed_and_challenges`, and both are already
  guarded by `IF to_regclass('storage.buckets') IS NOT NULL THEN`, so a shadow
  database without a storage schema skips them correctly. `private` is created
  by that same April migration, so it is self-supplying. There are zero hits for
  `supabase_functions`, `extensions.`, `realtime.` and `graphql.`. Roles
  (`anon`, `authenticated`, `service_role`) are cluster-wide, so a shadow
  database on the same server inherits them; a shadow on a server WITHOUT those
  roles needs them created, which is a second setup line worth stating in
  whatever document ends up carrying the recipe.

  **Blast radius, measured with the variable deliberately unset.**
  `migrate status`, `migrate diff` and `generate` all exit 0 unchanged, and
  `migrate dev` produces the same `P3006` it produces today. The config line is
  inert for anyone who does not set `SHADOW_DATABASE_URL`, so it cannot regress
  CI or `migrate deploy`, and it is opt-in.

  **Caveat that has to travel with the recipe.** `auth.jwt()` in the shadow
  database is a STUB returning whatever `request.jwt.claims` holds, and it
  behaves nothing like Supabase's real function. That is correct for a shadow
  database, whose only job is replaying migrations to compute a diff, because
  nothing there evaluates a JWT. The shadow database is neither seeded nor
  authoritative, and no test may ever be pointed at it.

  **Why this matters more than an annoyance.** It is the likely upstream cause
  of two defects fixed on 2026-09-05. When `migrate dev` works, Prisma authors
  the migration and applies its own identifier truncation consistently on both
  sides, which is the property that keeps
  `AffiliateClick_user_id_offer_id_recommendation_id_created_a_idx`
  (`20260811090000_add_commerce_affiliate/migration.sql:124`) honest at 63
  bytes. When it does not work, migrations get hand-written, and hand-written
  SQL is where both of those defects lived: a 64-byte index name PostgreSQL
  silently truncated, and a partial index declared in the datamodel as a plain
  `@@index` whose derived name would have collided with the real object. The
  limit of that claim: several hand-written migrations here do things Prisma
  cannot express at all, including RLS policies, triggers and storage buckets,
  and would have been hand-written regardless. The claim covers those two defect
  classes only.

  **Physical evidence that someone already hit this wall.** The local server
  carries a database called `postgres_shadow_cc` with exactly one non-system
  schema, `public`, holding 16 tables. It has no `private` schema, no `auth`,
  and `SELECT to_regclass('public._prisma_migrations')` returns empty, so it
  carries no migration history at all. That is precisely the state immediately
  before `20260420113000_add_guardian_shared_rls_policies`, the migration that
  creates `private` and first calls `auth.jwt()`. Somebody in April pointed
  `migrate dev` at it, watched it die at exactly the migration that still dies
  today, and left it.

  To re-check this in one line without a `psql` client on the PATH, which is the
  route that works on these machines:

      docker exec supabase_db_couture-cast psql -U postgres

  The same listing shows a second stray database, `cc_rls_review_20260420`,
  whose name carries the same April date as the guardian RLS migration.
  (Excluding templates, the server holds `_supabase`, `cc_rls_review_20260420`,
  `postgres` and `postgres_shadow_cc`.) Nobody in the sessions working on this
  knows what created it and nobody has opened it. Whoever picks up the pull
  request below has two stray databases to account for.

  **What a fix needs.** Its own pull request. It is dev tooling, nothing in
  story 6.1 depends on it, and it wants a reviewer whose attention is on
  developer setup. Scope: the config line; the prepare
  snippet; a README or CONTRIBUTING note; a decision on whether CI prepares a
  shadow database too; the cluster-roles caveat; whether an executable
  `npm run db:shadow:prepare` script belongs in `package.json` so the setup is
  runnable prose-free; and dropping or repurposing `postgres_shadow_cc`, plus
  identifying `cc_rls_review_20260420`, so two half-applied fossils are not left
  sitting on developer machines as their own traps.

## Shared build tooling, found while running story 6.1's suites (2026-09-05)

This is cross-cutting: it costs every session on the repository, and four of
them lost runs to it in one day.

- **`verify:api` rebuilds the shared packages on every step, and the rebuild is
  destructive.** `scripts/verify-workspace.mjs` runs lint, typecheck, test and
  build for the workspace, and `apps/api/package.json` declares `prelint`,
  `pretypecheck`, `pretest` and `prebuild` as `npm run prepare:shared-deps`.
  That script builds `@couture/config`, `@couture/utils`, `@couture/api-client`
  and `@couture/testing` in turn, and each of those four `build` scripts opens
  with `rm -rf dist tsconfig.build.tsbuildinfo`. So one `verify:api` is at least
  four full teardown-and-rebuild cycles across four packages, and the session
  that measured it counted eight `prepare:shared-deps` invocations in a single
  command's log.

  Any other session compiling or linting during one of those windows fails while
  the `dist` directories are missing, and the failure does not look like a build
  race. Four shapes were seen today, and the last two are the ones that mislead,
  because neither points at a build:

      Cannot find module '.../packages/api-client/dist/contracts/http/index.js'
      Cannot find module '.prisma/client/default'
      ENOENT ... packages/testing/dist/index.d.ts
      Failed to resolve entry for package "@couture/utils"

  the third reported by eslint's `import/no-unresolved` on a file nobody was
  editing, and the fourth raised by vite's `packageEntryFailure`. The fourth is
  the least recognisable of the set: it names a PACKAGE rather than a file and
  comes from the module resolver rather than the test runner, so it reads as a
  broken dependency declaration.

  **What a fix needs.** Make `prepare:shared-deps` idempotent or cached, so a
  repeated invocation is cheap and non-destructive when the outputs are already
  current. Removing the pre-hooks is the wrong direction: each one is
  individually correct, and dropping them puts every workspace back to compiling
  against whatever `dist` happens to be on disk, which is the same defect the
  `pretest:cov` entry above describes.

## Tests that construct their own subject, found across story 6.1 (2026-09-06)

Four defects on this branch had the same shape, and naming the shape is worth
more than the four fixes, because it is cheap to spot once stated.

In each case a schema element landed, a test asserted the behaviour that element
was supposed to drive, and no production code ever produced it. The test built
the row, the status, the timestamp or the payload in its own arrange block and
then asserted that the reader handled it correctly. That is a true statement
about the reader. It says nothing about whether anything in the system ever
creates that input.

The four:

- `consent_suspended` was a valid post status with no producer.
- `erasure_requested_at` was a column with no producer.
- The card-open event had a payload and no route to emit it.
- `overridden_engine_version` landed on `ModerationEvent`, `6.1-DB-037` pinned
  its shape, and `community-moderation.actions.ts` kept concatenating the engine
  version into the free-text `reason` and left the new column NULL on every real
  operator release.

The tell: **if the arrange block writes the thing under test, the test cannot
tell you the feature exists.** A green suite over all four looked identical to a
green suite over a working feature. Every layer reported success while the
behaviour being tested was absent from production code.

The check that catches it is to ask, for any test whose fixture writes a row or
a payload directly, which production code path writes that same shape, and to
be able to name the file. Where no such path exists, the test is pinning a
contract that nothing honours.

## Deferred from: code review of 6-1-community-feed-by-climate-band (2026-09-06)

These came out of the `/bmad-code-review` pass over the story 6.1 branch. Each
one is real and none of them blocks the story. They are separated from the
findings that are being fixed on the branch, which are recorded in the story
file's own Code Review Findings section.

- **Text moderation matches whole tokens against a fixed word list.**
  `apps/api/src/modules/community/community-moderation.engine.ts:183-198` uses
  `tokens.includes(term)` for single words, and `normalizeTextForModeration`
  strips diacritics only. Repeated characters, internal punctuation and spaced
  variants all pass. This is presented as "multilingual text safety filtering",
  and obfuscation handling was never specified, so widening it is a product
  decision rather than a defect fix. Worth pairing with the decision about the
  five supported locales that have no dictionary at all.

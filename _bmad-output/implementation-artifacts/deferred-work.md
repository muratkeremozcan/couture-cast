# Deferred Work Ledger

This ledger tracks items deferred during sprint execution and code reviews.

## Deferred from: code review of 1-1-weather-api-ingestion-service.md (2026-07-07)

- Inconsistent Database `location` Field Populated with `location_key`: The database snapshot `location` field is being set to the slugified `locationKey` rather than a descriptive location name, since `WeatherIngestionTarget` does not supply descriptive location names in Story 1.1. This will be aligned in Story 1.2 when user-managed location profile data is introduced.

## Deferred from: code review of 1-3-alert-rules-notification-pipeline.md (2026-07-13)

- Looping database queries inside transaction: `PrismaAlertsRepository.upsertRules` executes sequential upsert queries inside a `$transaction` block. This is tolerable for single user updates since the array size is small.

## Deferred from: code review of 2-1-scenario-outfit-generator.md (2026-07-16)

- Database Race Condition on Recommendations: There is no database-level unique constraint or lock on the `OutfitRecommendation` table for `(user_id, forecast_segment_id, scenario)`. Concurrent requests could insert duplicate rows.
- Tight Coupling and DI Violation on Redis Client: `RitualService` instantiates a new Redis client in the constructor rather than utilizing NestJS Dependency Injection.

## Deferred from: code review of 2-2-comfort-calibration-settings.md (2026-07-21)

- [x] Weak type safety in helper functions: Helper functions `getWindThreshold`, `getRainProbThreshold`, and `getRainAmountThreshold` in `ritual.service.ts` accept loose `string` parameters instead of using strongly-typed enums.
- [x] Implicit Weather Units: Wind and rain threshold calculations use undocumented numerical limits without explicit constants or comments indicating what units are expected.

## Deferred from: code review of 4-3-outfit-capsule-builder.md (2026-08-07)

- _Resolved 2026-08-08._ Both items originally deferred here were implemented at the reviewer's request. The synthetic `default-<category>` garment IDs can no longer reach a capsule recommendation because the capsule's own evaluated garment set is what gets persisted, and the capsule surfaces now report pagination totals so a truncated list is visible.

## Deferred from: story 5.1 affiliate "Shop this look" CTA (2026-08-11)

These were identified while drafting and implementing story 5.1 and were
deliberately left out of its scope. Each records what was narrowed and why, so a
later story does not have to rediscover the reasoning.

- **Web `Sponsored` disclosure copy defect.**
  `apps/web/src/app/components/lookbook-prism-layout.tsx:41-47` defines a
  hardcoded `HERO_RECOMMENDATIONS.Sponsored` entry whose `eyebrow` field reads
  `'Sponsored Selection'`. It is reachable in the UI:
  `CHIP_DEFAULT_FILTER.Sponsored` is set at line 20 and
  `apps/web/src/app/lib/deep-link-handler.ts:39` routes the `evening` deep link
  to that chip. It is story 3.5 placeholder copy with no partner behind it.
  Rewriting it inside a commerce story risked implying a sponsorship that does
  not exist, so it was left alone. It should be corrected on its own.

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

- **`api/index.ts` installs no `ApiExceptionFilter`, so `api_error_occurred`
  telemetry has never been emitted in preview or production.** `NestFactory.create`
  is called in three places and the deployed one is `apps/api/api/index.ts`, which
  installs none of the filter, CORS, or request-context middleware that
  `src/main.ts:64-73` installs. Error response bodies are unaffected, because
  Nest's built-in filter produces the same `{ statusCode, message, error }`
  envelope. The consequence is that every dashboard built on `api_error_occurred`
  since story 1.4 has seen local traffic only, on every route. This predates
  story 5.1 and is much wider than it; it is recorded here because story 5.1's
  webhook work is what surfaced it.

- **Mobile reuses `commerce.settings.error` for a failed preference READ.** The
  string reads "Unable to update shopping preferences.", which is slightly wrong
  when the failure was a load rather than a save. Decision 16 locks the key tree
  and web shares it, so adding a `settings.loadError` key is a cross-surface
  change across twenty catalog files. Cosmetic, deferred deliberately.

- **Web carries one commerce key mobile does not.** `commerce.settings.signedOutHint`
  ("Sign in to change this") exists because decision 17 requires a localized
  signed-out hint on the web settings section and decision 16's tree has no key
  for it. Web has 13 commerce keys, mobile has 12. This is deliberate: mobile
  settings is never reachable without a session, so an unused key there would be
  dead weight added only to satisfy symmetry.

- **The mobile vitest browser run is flaky on a cold `node_modules/.vite`.**
  Roughly 23 suites fail with "does not provide an export named 'default'" while
  the Vite dependency optimizer rebundles; the second run is always green. This
  reproduces on commits that predate story 5.1. The likely fix is widening
  `optimizeDeps.include` in `apps/mobile/vitest.config.ts`, which every surface
  inherits, so it was not changed inside a commerce story.

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

- **The remaining `@Cron` consumers sit on a substrate that never fires in
  production.** Story 5.2 verified the deploy-target facts: the API ships as
  one Vercel serverless function (`apps/api/vercel.json`), no Vercel `crons`
  config exists, and `ScheduleModule.forRoot()` lives only in the request app —
  so a NestJS `@Cron` in this API has never provably fired in production.
  Story 5.2 moved its own periodic work (billing reconciliation, commerce
  retention) onto BullMQ Job Schedulers in the standalone worker runtime
  (ADR-012's substrate) and took `CommerceRetentionService` off `@Cron` with
  it. The remaining consumers — `feature-flags.cron`, `admin.cron`,
  `guardian.cron` — share the dead-substrate defect but belong to other epics'
  features; unverifiable cross-feature changes do not belong in a billing PR.
  Owner ask: whoever owns flags/admin/guardian operations should re-host these
  onto worker Job Schedulers the same way. Evidence: story 5.2 Decision 4a.

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

- **~~`packages/db/test/rls-policies.spec.ts` is 2868 lines and grows with every
  story.~~ Resolved 2026-08-20.** The TEA review scored it the only HIGH
  maintainability violation in the 34-file story-5.2 review set (limit: 1000
  lines). It carried the RLS matrices of stories 4.3, 4.4, 5.1, and 5.2 plus the
  guardian-consent, telemetry, and alert-delivery suites in a single describe,
  and its ~110-line `SeededScenario` type and ~410-line
  `seedScenario`/`cleanupScenario` pair had to grow for each new story, so every
  story raised the cost of touching any older one.

  Split as its own change into `packages/db/test/rls/`: one shared
  `harness.ts` holding the category arrays, `SeededScenario`, `withRole`,
  `seedScenario`/`cleanupScenario`, the `scenarioTest` fixture, and a
  `useRlsDatabase()` that owns the per-file database lifecycle, plus ten
  per-subject spec files (`policy-matrix`, `guardian-wardrobe`,
  `identity-and-admin`, `capsules`, `onboarding-silhouette`,
  `alerts-notifications`, `telemetry`, `commerce`, `premium-theme`, `billing`),
  the longest 475 lines. Behaviour preservation was proved three ways: 58 test
  blocks in and 58 out, 57 of them byte-identical and the 58th differing only in
  a comment that named the old path; `npm run test -w packages/db` reporting 131
  tests before and 131 after with an identical sorted list of full test names;
  and a probe confirming Vitest's `isolate: true` gives each spec file its own
  module registry, and therefore its own `adminPool`, despite the workspace's
  `fileParallelism: false`. A new story now adds its actor matrix as a new file
  and touches the harness only for the rows it seeds.

- **Two shared Pact files have grown past the length limit the same way.**
  `pact/http/consumer/api-contract-interactions.ts` is 3589 lines and
  `pact/http/provider/provider-helper.ts` is 1583 lines. Neither is a story-5.2
  artefact: both are cross-story accumulators that every story appends its
  interactions and provider doubles to (5.2 added 393 and 162 lines
  respectively). This is the identical pattern to the RLS spec above and should
  be solved the same way and at the same time — per-domain modules behind one
  registry, with the three-run Pact determinism gate as the proof the split
  changed nothing. Filed together so whoever takes one takes both.

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

- **The entire mobile surface of story 5.3 (Task 6).** Nothing under
  `apps/mobile` was created or changed. Missing: `src/theme/theme-palettes.ts`,
  `src/theme/theme-context.tsx` (`AppThemeProvider` / `useAppTheme()`), its
  mount in `app/_layout.tsx`, `src/lib/premium-theme.ts`, the inline
  `PremiumThemeSection` in `app/(tabs)/settings.tsx`, the ten mobile locale
  catalogs' `commerce.premium.theme.*` keys, and
  `src/i18n/premium-theme-locales.spec.ts`. With it go the mobile halves of
  AC 4 (instant apply through the context), AC 6 (fallback rendering on the
  mobile surface), and AC 7 (mobile catalog parity). This is a deliberate
  narrowing, not an oversight or a blocked task: the server primitive is
  surface-agnostic and already shipped:
  `GET`/`PUT /api/v1/commerce/premium/theme` resolves entitlement inline
  (Decision 7), so the mobile work is a client of an API that exists. Decision 12 holds the exact
  shape it should take, including the `AppThemeProvider` naming (React
  Navigation's `ThemeProvider` is already imported in `_layout.tsx:2`) and the
  mount slot inside `AccessibilityAnnouncerProvider` and outside the navigation
  `ThemeProvider`.

- **Pact interactions and the Playwright spec (Task 7).** Held back
  deliberately for separate authoring. No consumer interactions were added to
  `pact/http/consumer/api-contract-interactions.ts`, no provider states
  (`'The user has premium theme access'`,
  `'The user does not have premium theme access'`,
  `'Premium themes are disabled'`), and no
  `playwright/tests/premium-theme-switcher.spec.ts`. What exists instead is
  unit-tier proof: the contract module's own suite
  (`packages/api-client/testing/premium-theme-contract.spec.ts`) and the
  supertest specs colocated beside the controller and service in
  `apps/api/src/modules/commerce/`. What is therefore unproven is
  consumer-driven compatibility between each client and the provider, and
  browser-level behavior of the locked state (with axe), the gallery, select
  then reload persistence, and the Default fallback for a stale or unknown
  stored key seeded directly.

- **The Maestro locked-state flow.** Held back deliberately for separate
  authoring, and blocked behind the mobile surface above in any case: there is
  no mobile UI for a flow to drive yet. When it is written it carries the same
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

- **The `playwright/support/helpers/accessibility.ts` adapter rewrite
  (Decision 3).** Held back deliberately with the rest of the Playwright tier;
  the file is byte-identical to its state before this story. The planned change
  is to keep its exported `contrastRatio(left, right)` signature over CSS
  `rgb()` strings, parse to hex with the `parseRgb` it already has, and delegate
  to `@couture/utils`, leaving its caller
  (`playwright/tests/commerce-affiliate-preferences.spec.ts:239`) untouched;
  plus one test proving both entry points return the same number for the same
  color, for which `5.3-UTIL-007` is reserved in
  `packages/utils/src/contrast.spec.ts`. State the consequence plainly: the
  repository now holds three copies of the WCAG luminance maths rather than the
  two Decision 3 intended, and this entry together with the
  `accessibility-hardening.spec.ts` entry above are what close it back to one.
  The delegation needs no build wiring; `@couture/utils` is symlinked into root
  `node_modules` and `prepare:playwright` already builds it ahead of
  `@couture/api-client`.

### Added during the story 5.3 code review (2026-08-18)

Raised by the three review layers (Blind Hunter, Edge Case Hunter, Acceptance
Auditor) over the whole story diff. Everything the review found that could be
fixed inside the story's scope was fixed; these are the items that could not,
each with the reason.

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

- **`5.3-INT-001` and `5.3-INT-002` have no test.** The story's coverage matrix
  names `5.3-INT-001` (persist, reload, same theme, over HTTP) as P0 evidence for
  AC 3 and `5.3-INT-002` (a web-selected palette visible on a mobile GET) as P1.
  Both are integration tier, which is outside the unit-only scope this story was
  narrowed to, so neither exists. What does exist is the service and controller
  proof at unit tier over an in-memory store, which cannot show a row surviving a
  reconnect or the real unique index. The follow-up is
  `apps/api/integration/premium-theme.integration.spec.ts`: PUT a palette, drop
  the app, re-GET against real PostgreSQL, assert exactly one row with
  `updated_at` moved. Recorded rather than left implicit because the other four
  scope cuts below are all named and this one was not.

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

- **`commerce.premium.theme.locked.body` and `.signedOutBody` hardcode the three
  palette names inside ten translated sentences.** Adding or retiring a palette
  now means editing twenty localized strings by hand, and
  `5.3-I18N-WEB-08` fails until every current name appears in each of them. The
  catalogs already carry `names.*` keys that could be interpolated as a
  `{{palettes}}` placeholder built from `PREMIUM_THEME_KEYS`. Deferred because
  list formatting is locale-specific (serial comma, `und`/`et`/`ve`, conjunction
  placement) and doing it properly means `Intl.ListFormat`, not string joining.

- **~~`apps/web/src/lib/premium.ts` bakes untranslated English into the errors the
  subscription section renders.~~ Fixed 2026-08-19, not deferred.** This entry was
  originally filed as out of scope because it is story 5.2's surface and its own
  tests pinned the English literals. That is not a reason to leave it: debt gets
  handled when it is found, whichever story introduced it. `premium.ts` now
  classifies failures the same way `premium-theme.ts` does
  (`PremiumFailureReason`), the subscription section maps each reason onto a
  `commerce.premium.*` key, and the two tests that asserted server English now
  assert the catalog copy. Three new keys ship in all ten catalogs
  (`errorAlreadySubscribed`, `errorNoWebSubscription`, `errorSubscribeDisabled`)
  and the already-translated `manageInStore` finally renders on the path it was
  written for. Kept here as a record rather than deleted, since the original
  deferral was the wrong call and the reversal is the useful part.

- **A `PUT` racing account erasure answers 500.** `PremiumThemeService.setTheme`'s
  upsert violates `PremiumThemePreference_user_id_fkey` (P2003) if the `User` row
  is deleted while the request is in flight, and nothing catches it. The window
  is one request wide and the caller is an account that no longer exists, so the
  500 is survivable; the tidy answer is to map P2003 onto the same not-found
  shape the other commerce writes use.

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

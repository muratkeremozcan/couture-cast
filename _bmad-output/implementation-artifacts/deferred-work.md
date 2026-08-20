# Deferred Work Ledger

This ledger tracks items deferred during sprint execution and code reviews.

## Deferred from: code review of 1-1-weather-api-ingestion-service.md (2026-07-07)

- Inconsistent Database `location` Field Populated with `location_key`: The database snapshot `location` field is being set to the slugified `locationKey` rather than a descriptive location name, since `WeatherIngestionTarget` does not supply descriptive location names in Story 1.1. This will be aligned in Story 1.2 when user-managed location profile data is introduced.

## Deferred from: code review of 1-3-alert-rules-notification-pipeline.md (2026-07-13)

- Looping database queries inside transaction: `PrismaAlertsRepository.upsertRules` executes sequential upsert queries inside a `$transaction` block. This is tolerable for single user updates since the array size is small.

## Deferred from: code review of 2-1-scenario-outfit-generator.md (2026-07-16)

- Database Race Condition on Recommendations: There is no database-level unique constraint or lock on the `OutfitRecommendation` table for `(user_id, forecast_segment_id, scenario)`. Concurrent requests could insert duplicate rows.
- [x] _Already fixed; entry was stale when checked on 2026-08-20._ Tight Coupling and DI Violation on Redis Client: `RitualService` instantiates a new Redis client in the constructor rather than utilizing NestJS Dependency Injection. The client now arrives through the `RITUAL_REDIS_CLIENT` provider in `personalization.module.ts` and `RitualService` takes it by injection, so the violation described here no longer exists in the code.

## Deferred from: code review of 2-2-comfort-calibration-settings.md (2026-07-21)

- [x] Weak type safety in helper functions: Helper functions `getWindThreshold`, `getRainProbThreshold`, and `getRainAmountThreshold` in `ritual.service.ts` accept loose `string` parameters instead of using strongly-typed enums.
- [x] Implicit Weather Units: Wind and rain threshold calculations use undocumented numerical limits without explicit constants or comments indicating what units are expected.

## Deferred from: code review of 4-3-outfit-capsule-builder.md (2026-08-07)

- _Resolved 2026-08-08._ Both items originally deferred here were implemented at the reviewer's request. The synthetic `default-<category>` garment IDs can no longer reach a capsule recommendation because the capsule's own evaluated garment set is what gets persisted, and the capsule surfaces now report pagination totals so a truncated list is visible.

## Deferred from: story 5.1 affiliate "Shop this look" CTA (2026-08-11)

These were identified while drafting and implementing story 5.1 and were
deliberately left out of its scope. Each records what was narrowed and why, so a
later story does not have to rediscover the reasoning.

- _Resolved 2026-08-20._ **Web `Sponsored` disclosure copy defect.**
  `apps/web/src/app/components/lookbook-prism-layout.tsx:41-47` defines a
  hardcoded `HERO_RECOMMENDATIONS.Sponsored` entry whose `eyebrow` field reads
  `'Sponsored Selection'`. It is reachable in the UI:
  `CHIP_DEFAULT_FILTER.Sponsored` is set at line 20 and
  `apps/web/src/app/lib/deep-link-handler.ts:39` routes the `evening` deep link
  to that chip. It is story 3.5 placeholder copy with no partner behind it.
  Rewriting it inside a commerce story risked implying a sponsorship that does
  not exist, so it was left alone. It should be corrected on its own.

  Corrected. The eyebrow now reads "Brand Picks" over copy that describes
  brand-forward pairings, which is what the chip's own `Brands` filter selects;
  nothing in it asserts that anyone paid for the placement. The vocabulary for
  genuine paid placement stays where story 5.1 put it, in
  `commerce.shopThisLook.disclosure` and `.partnerLabel`, rendered only beside an
  offer that exists — `prd.md:192` requires sponsored content to be labeled, and
  placeholder copy borrowing that language is the inverse failure: a disclosure
  with nothing to disclose. `lookbook-prism-layout.test.tsx` asserts the negative
  (no "sponsored", "paid partnership", "presented by", or "commission" anywhere
  in the hero card), because nothing about the page looks wrong when placeholder
  copy claims a sponsorship, so only a test that refuses the words catches it
  returning.

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

- _Resolved 2026-08-20._ **`api/index.ts` installs no `ApiExceptionFilter`, so `api_error_occurred`
  telemetry has never been emitted in preview or production.** `NestFactory.create`
  is called in three places and the deployed one is `apps/api/api/index.ts`, which
  installs none of the filter, CORS, or request-context middleware that
  `src/main.ts:64-73` installs. Error response bodies are unaffected, because
  Nest's built-in filter produces the same `{ statusCode, message, error }`
  envelope. The consequence is that every dashboard built on `api_error_occurred`
  since story 1.4 has seen local traffic only, on every route. This predates
  story 5.1 and is much wider than it; it is recorded here because story 5.1's
  webhook work is what surfaced it.

  Fixed by extracting the four wirings into `apps/api/src/bootstrap/configure-app.ts`,
  which both `src/main.ts` and `api/index.ts` now call and neither re-implements.
  In `api/index.ts` the call sits before `app.init()`, deliberately: Express
  middleware registered after initialization never joins the stack and fails
  open, which is the same silent shape as the original defect. The extraction is
  what makes the fix durable — the previous arrangement let a second entrypoint
  be written without any of it and nothing looked wrong, because Nest's built-in
  filter produces the same response envelope. `configure-app.spec.ts` asserts all
  four wirings and that the filter resolves its dependencies from the container,
  so a future entrypoint that skips one turns a test red instead of a dashboard
  empty.

- _Resolved 2026-08-20._ **Mobile reuses `commerce.settings.error` for a failed preference READ.** The
  string reads "Unable to update shopping preferences.", which is slightly wrong
  when the failure was a load rather than a save. Decision 16 locks the key tree
  and web shares it, so adding a `settings.loadError` key is a cross-surface
  change across twenty catalog files. Cosmetic, deferred deliberately.

  Done, across all twenty. `commerce.settings.loadError` mirrors each catalog's
  own register for the sibling `error` key rather than being translated afresh,
  so the two strings read as a pair in every locale. Both read paths use it.

  Fixing it surfaced a larger defect on the web side.
  `commerce-preferences-section.tsx` rendered `commerceErrorMessage(error, fallback)`,
  and `commerceError` in `lib/commerce.ts` prefers the API's own error body —
  which is English on every locale — so the catalog string would almost never
  have shown. This is the same defect `premium.ts` was corrected for on
  2026-08-19, in the entry further down this file that records the original
  deferral as the wrong call. Both paths now use catalog copy unconditionally.
  Nothing is lost by dropping the server text: these two endpoints have no
  actionable failure to distinguish, a preferences read either worked or did not,
  and the developer-facing message survives on the thrown `CommerceRequestError`
  for logs. `5.1-WEB-SETTINGS-07` and `-09` now pin the save and load strings
  separately.

- **Web carries one commerce key mobile does not.** `commerce.settings.signedOutHint`
  ("Sign in to change this") exists because decision 17 requires a localized
  signed-out hint on the web settings section and decision 16's tree has no key
  for it. Web has 13 commerce keys, mobile has 12. This is deliberate: mobile
  settings is never reachable without a session, so an unused key there would be
  dead weight added only to satisfy symmetry.

- _Resolved 2026-08-20._ **The mobile vitest browser run is flaky on a cold `node_modules/.vite`.**
  Roughly 23 suites fail with "does not provide an export named 'default'" while
  the Vite dependency optimizer rebundles; the second run is always green. This
  reproduces on commits that predate story 5.1. The likely fix is widening
  `optimizeDeps.include` in `apps/mobile/vitest.config.ts`, which every surface
  inherits, so it was not changed inside a commerce story.

  Checked on 2026-08-20 and found already fixed: this entry was stale rather than
  outstanding. `apps/mobile/vitest.config.ts` carries exactly the widening this
  entry proposed, with a docblock recording that naming `expo-router` removed ten
  cold-run failures on its own and that `msw` and the native-only Expo modules
  must never join the list. Two runs against a deleted `node_modules/.vite` came
  back clean at 61 files and 595 tests, where this entry describes roughly 23
  suites failing. No change was needed; the verification is the useful part.

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

- _Resolved 2026-08-20._ **The remaining `@Cron` consumers sit on a substrate that never fires in
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

  Done, and the count in the paragraph above was wrong: there were **five**
  consumers, not three. `wardrobe-retention.service.ts` (hourly garment purge)
  and `telemetry.service.ts` (hourly telemetry-event prune) also carried
  `@Cron(CronExpression.EVERY_HOUR)` and are not named anywhere above, so
  reading this entry alone would have left two dead sweeps behind. All five now
  run as Job Schedulers on a new `maintenance` queue, registered by
  `workers/maintenance.scheduler.ts` and dispatched by
  `workers/maintenance.processor.ts`. `grep -rn "@Cron" apps/api/src` returns
  comment lines only and `ScheduleModule.forRoot()` is gone from `app.module.ts`.

  Three things worth knowing for anyone touching this next.

  Every cadence is transcribed, not re-chosen, and `maintenance.scheduler.spec.ts`
  pins each one to the expression its decorator carried, including the UTC
  timezone on guardian emancipation — a teen turning 16 is evaluated against a
  UTC calendar day, so a host-local schedule would emancipate on a different date
  depending on where the worker runs.

  The sweeps are hand-wired in `workers/bootstrap.ts` rather than resolved from a
  Nest application context, and that is not a style preference. The worker runs
  under `tsx` (`npm run start:workers`), whose esbuild transform does not emit the
  `design:paramtypes` metadata Nest's DI reads. A `NestFactory.createApplicationContext`
  there does not fail — it stalls forever resolving constructor parameters, with
  no error and no log, while the same code works once `nest build` has run. This
  was found the expensive way: an earlier revision of this change used a
  `MaintenanceModule`, and it hung. Anyone reaching for Nest DI inside a
  tsx-executed entrypoint should expect the same and should not spend the
  afternoon re-deriving it.

  `AdminCron` and `GuardianCron` swallowed their sweep errors, and their own tests
  said why: an unhandled rejection inside a `@Cron` handler takes down the
  process. That reason belonged to the substrate. On BullMQ a thrown error is the
  correct outcome — it marks the job failed, retries under the queue's
  `attempts: 3` backoff, and leaves a `JobFailure` row an operator can see — so
  the processor rethrows after logging. The `*_failed` log event names are
  unchanged, so any log-based alerting keeps matching. The two sweeps that already
  swallowed inside their own service bodies (`purgeExpiredAndDeletedGarments`,
  `pruneOldTelemetryEvents`) were left exactly as they were: this change moved
  triggers, not service internals.

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

- **`packages/db/test/rls-policies.spec.ts` is 2868 lines and grows with every
  story.** The TEA review scored it the only HIGH maintainability violation in
  the 34-file story-5.2 review set (limit: 1000 lines). It now carries the RLS
  matrices of stories 4.3, 4.4, 5.1, and 5.2 plus the guardian-consent,
  telemetry, and alert-delivery suites in a single describe, and its ~110-line
  `SeededScenario` type and ~410-line `seedScenario`/`cleanupScenario` pair must
  both grow for each new story, so every story raises the cost of touching any
  older one. Story 5.2 added roughly 90 lines.

  Deliberately not fixed inside the billing story: this is the repo's most
  security-critical test file, and a botched split weakens RLS coverage silently
  rather than loudly. The safe recipe, for whoever takes it: split into
  per-story spec files over one shared seeded-scenario harness, and prove the
  split is behaviour-preserving by asserting the total test count and the full
  actor matrix are identical before and after (`npm run test -w packages/db`
  reported 112 tests at the time of this entry). Do it as its own change, not
  as a rider on a feature story.

- _Resolved 2026-08-20._ **Two shared Pact files have grown past the length limit the same way.**
  `pact/http/consumer/api-contract-interactions.ts` is 3589 lines and
  `pact/http/provider/provider-helper.ts` is 1583 lines. Neither is a story-5.2
  artefact: both are cross-story accumulators that every story appends its
  interactions and provider doubles to (5.2 added 393 and 162 lines
  respectively). This is the identical pattern to the RLS spec above and should
  be solved the same way and at the same time — per-domain modules behind one
  registry, with the three-run Pact determinism gate as the proof the split
  changed nothing. Filed together so whoever takes one takes both.

  Both done, together, as this entry asked. The line counts above were stale by
  the time anyone read them: PR #133 added 533 and 140 lines, so the real
  starting sizes were 3982 and 1724.

  `api-contract-interactions.ts` is a 33-line barrel over eleven per-domain
  modules under `interactions/`, largest 738 lines. `provider-helper.ts` is 374
  lines: its seventeen inline service doubles moved into ten factory modules
  under `doubles/`, the `PACT_*` identifiers into `fixtures.ts`, and the
  scenario state into `state.ts`. Nothing under `pact/` exceeds 1000 lines now.

  The doubles used to be consts inside `startLocalPactProvider`, closing over
  its locals. They read `state.ts`'s exported getters instead, which is why the
  state had to become its own module rather than staying put and being exported:
  `provider-helper.ts` imports the doubles, so a double importing state back out
  of it would be a cycle. Each factory returns only what the Nest fixture
  registers; the scenario readers and response shapers stay private to their
  module.

  Both public entry points kept their names and their exports, so
  `web-api-client.pacttest.ts`, `mobile-api-client.pacttest.ts`,
  `api-provider.pacttest.ts` and `state-handlers.ts` are untouched, and every
  `*.md` that references either path still resolves.

  Proof, in increasing order of strength. The determinism gate reports the same
  68 and 77 interactions, stable across three runs. The generated pact JSON was
  captured before the split and compared with `diff -r` after: **byte-identical**,
  which the counts alone could not have shown, because a renamed interaction and
  a dropped one cancel out in a total. Provider verification passes 547 `(OK)`
  assertions across both pacts. `tsc -p pact/tsconfig.json` and `eslint pact`
  are clean, and `npm run test:pact` — the exact command
  `.github/workflows/contract-testing.yml` runs — exits 0.

  Two notes for whoever splits the next accumulator. Generating each module's
  imports by scanning its text for referenced names pulls in imports that exist
  only because a docblock mentions another module's helper; strip comments
  first. And an owner-anchor comment sitting on a boundary line follows the
  wrong side of the split — `Story 2.3 Task 3 step 2 owner` landed above the
  identity doubles instead of the ritual ones and had to be moved back by hand.

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

- _Resolved 2026-08-19._ **Pact interactions and the Playwright spec (Task
  7).** Both authored, run for real, and green. `pact/http/consumer/api-contract-interactions.ts`
  gained a "Story 5.3 premium theme switcher" section (7 interaction
  functions covering GET entitled/Default/not-entitled, PUT update/reset, and
  a table-driven 403/503 error pair), wired into both
  `web-api-client.pacttest.ts` and `mobile-api-client.pacttest.ts` — unlike
  5.2's asymmetric split, both consumers call both operations here. The three
  provider states named above are registered in `state-handlers.ts` verbatim,
  and `provider-helper.ts` gained scenario-driven `mockPremiumThemeService`/
  `mockPremiumEntitlementService` doubles plus `PremiumThemeController`
  registered in the verifier's Nest fixture — the first Pact provider wiring
  of `PremiumEntitlementGuard`, left un-overridden so its real 403-before-503
  precedence runs for real rather than being asserted only in the API unit
  tier. `npm run test:pact:consumer` reports both pact files stable across 3
  determinism runs (67 and 76 interactions); `npm run test:pact:provider`
  verifies all 14 new interactions `OK`, including the inherited
  `Cache-Control: private, no-store` header on the error responses too.
  `playwright/tests/premium-theme-switcher.spec.ts` (4 tests, IDs
  `5.3-E2E-010` through `5.3-E2E-013`) proves the locked state signed out
  (+axe) and signed-in-non-entitled, the gallery (exactly 3 named palettes +
  Default, Spring Bloom absent), select-then-reload persistence via the real
  `<html data-theme>` attribute, and the Default fallback for an unrecognized
  stored theme — the last one via a stubbed GET rather than a seeded DB row,
  because `PremiumThemeKey` is a real Postgres enum with no code path that can
  insert an out-of-enum value, which makes true DB-level staleness physically
  unreachable; stubbing is what actually exercises `resolvePremiumThemeKey`'s
  client-side fallback, the real AC 6 code path at this tier. All four tests
  passed twice over (`--repeat-each=2`), including the serialized
  seeded-active-user write journey, with no flakiness. Consumer-driven
  compatibility between each client and the provider, and browser-level
  locked/gallery/persistence/fallback behavior, are no longer unproven.

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

- _Resolved 2026-08-19._ **The `playwright/support/helpers/accessibility.ts`
  adapter rewrite (Decision 3).** `contrastRatio(left, right)` keeps its exported
  signature over CSS `rgb()` strings; `parseRgb` still does the parsing, a new
  `toHex` re-encodes the three channels, and the function delegates to
  `@couture/utils`'s `contrastRatio`, which now holds the only luminance/gamma
  maths this helper runs. Its caller
  (`playwright/tests/commerce-affiliate-preferences.spec.ts:239`) is unchanged
  and its `[P1] 5.1-E2E-WEB-04` test (the one asserting
  `contrastRatio(ring.outlineColor, DARK_SURFACE_RGB)`) was run for real against
  the local stack and still passes. The both-entry-points-agree test could not
  live at the reserved `5.3-UTIL-007` id in `packages/utils/src/contrast.spec.ts`
  after all: `packages/utils` is an isolated npm workspace package whose
  `tsconfig.typecheck.json` pins `rootDir` to the package directory, so a
  relative import reaching out to the Playwright tier would violate that rootDir
  and pull `@playwright/test` types into a package with no reason to depend on
  Playwright. It lives instead in the new
  `playwright/support/helpers/accessibility.spec.ts`, run via the root `vitest`
  binary since `playwright/` is not an npm workspace and has no
  Playwright-runner-discoverable test tier of its own for pure-logic specs
  (`playwright/config/base.config.ts`'s `testDir` only scans `playwright/tests`).
  Wired into `npm run test:playwright-unit`, which `prepare:playwright` runs
  before every Playwright entrypoint, so it isn't a file someone has to
  remember to invoke by hand: the first version of this entry shipped without
  that wiring, silently orphaned from every CI job, and only surfaced when
  asked directly why a spec lived under `helpers/`.
  `contrast.spec.ts`'s own comment reserving the id now points here. The
  repository is back down to two copies of the WCAG luminance maths: the
  canonical one in `@couture/utils`, and the inline duplicate in
  `accessibility-hardening.spec.ts`, which stays deliberately untouched for the
  reason given above.

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

- _Resolved 2026-08-19._ **`5.3-INT-001` and `5.3-INT-002` have no test.**
  Both now exist in `apps/api/integration/premium-theme.integration.spec.ts`
  (5 tests total), run for real against the local PostgreSQL stack rather than
  the in-memory doubles the unit tier uses. `5.3-INT-001` PUTs a palette
  through one Nest app/Prisma connection and re-GETs it through a second,
  independently-compiled app with its own `PrismaClient`, proving persistence
  survives a real reconnect. `5.3-INT-002` proves a palette written by one
  request context is read correctly by a different, independent one for the
  same user — documented in the test itself as a server-side-consistency
  proof, not mobile-client wiring, since Task 6 was cancelled and no mobile
  client exists to actually prove the cross-device half. The suite also pins
  the reset-never-deletes rule from Decision 8 at the repository level
  (`PUT { theme: null }` leaves exactly one row with `theme = null`) and
  confirms `updated_at` moves on every PUT, including one that resubmits the
  already-stored value — there is no server-side unchanged-value
  short-circuit; that guard is client-only (`5.3-WEB-115`). Ran in isolation
  (5/5 passed) and as part of the full `apps/api` integration suite (201
  passed, 2 pre-existing unrelated skips, no collisions with the sibling
  `commerce-affiliate-*`/`premium-*` suites sharing the database).

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

- _Resolved 2026-08-20._ **`commerce.premium.theme.locked.body` and `.signedOutBody` hardcode the three
  palette names inside ten translated sentences.** Adding or retiring a palette
  now means editing twenty localized strings by hand, and
  `5.3-I18N-WEB-08` fails until every current name appears in each of them. The
  catalogs already carry `names.*` keys that could be interpolated as a
  `{{palettes}}` placeholder built from `PREMIUM_THEME_KEYS`. Deferred because
  list formatting is locale-specific (serial comma, `und`/`et`/`ve`, conjunction
  placement) and doing it properly means `Intl.ListFormat`, not string joining.

  Done with `Intl.ListFormat`, as this entry proposed. A `usePaletteNameList`
  hook builds the list from `PREMIUM_THEME_KEYS` and the `names.*` catalog keys
  and passes it as `{{palettes}}`, so the gallery and the upsell copy read from
  one source and a palette added to the contract appears in twenty sentences
  without any of them being touched.

  Nine of the ten locales' formatted output is byte-identical to the sentence the
  catalog previously spelled out, which is what makes this behaviour-preserving.
  The tenth is a correction worth naming rather than burying: CLDR drops the
  serial comma in Canadian English, so `en-CA` moves from
  "Jewel Radiance, Autumn Umber, and Winter Metallic" to
  "…Autumn Umber and Winter Metallic". The hand-written catalog was following US
  convention; CLDR is the authority on that punctuation, and deferring to it is
  the whole reason to use the formatter.

  Turkish keeps working because its case suffix attaches to the end of the list
  (`{{palettes}}'in`) and the formatter puts the final name last in every locale.
  `5.3-I18N-WEB-08` now asserts the placeholder is present and that no palette
  name is hardcoded — the stronger check, because it also catches a translator
  who resolves the list into their own prose and freezes today's three palettes
  back into the catalog.

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

- _Resolved 2026-08-20._ **A `PUT` racing account erasure answers 500.** `PremiumThemeService.setTheme`'s
  upsert violates `PremiumThemePreference_user_id_fkey` (P2003) if the `User` row
  is deleted while the request is in flight, and nothing catches it. The window
  is one request wide and the caller is an account that no longer exists, so the
  500 is survivable; the tidy answer is to map P2003 onto the same not-found
  shape the other commerce writes use.

  Done as described. The upsert moved into a `writePreference` helper that
  catches `P2003` and raises `NotFoundException(PREMIUM_THEME_OWNER_NOT_FOUND_MESSAGE)`,
  matching `affiliate-click.service.ts` and `stripe-billing.service.ts`. The guard
  is narrow on the code for the same reason `isEnumConversionError` next to it is:
  every other Prisma failure is an infrastructure fault and must keep propagating.
  Three unit tests pin the mapping, the message, and that a `P1017` still
  propagates untouched.

  The 404 is documented on the PUT operation and covered by Pact. An earlier
  revision of this entry said the opposite — that publishing it would reshape
  nodes and drag an `optic diff` conversation into a defect fix — and a
  CodeRabbit review on PR #133 pushed back. The review was right and the
  deferral was wrong on both counts. Adding a response to an operation is
  additive: `optic diff` against `origin/main` reports
  `PUT /api/v1/commerce/premium/theme: response 404: added` and passes, the
  published document grows by ten lines, and the generated SDK does not change
  at all. Beyond that, a status a client can actually receive belongs in the
  contract whether or not documenting it is convenient.

  A third error row now sits alongside the 403/503 pair in
  `pact/http/consumer/api-contract-interactions.ts`, driven by a new
  `The premium theme owner account no longer exists` provider state and an
  `owner-erased` scenario on `mockPremiumThemeService`. Both consumer pacts
  verify it green with the inherited `Cache-Control: private, no-store` header
  (68 and 77 interactions, stable across the three determinism runs).

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
  `packages/db/test/rls-policies.spec.ts` asserts for every member of the
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

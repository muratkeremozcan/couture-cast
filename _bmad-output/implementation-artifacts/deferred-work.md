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

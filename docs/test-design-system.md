# System-Level Test Design

**Date:** 2025-11-13  
**Author:** BMad-user  
**Status:** Draft - Solutioning Phase (Gate Prep)

---

## Table of Contents

1. [Testability Assessment](#testability-assessment)
2. [Architecturally Significant Requirements (ASRs)](#architecturally-significant-requirements-asrs)
3. [Architecture Decision Records (ADRs) → Test Coverage Mapping](#architecture-decision-records-adrs--test-coverage-mapping)
4. [Test Levels Strategy](#test-levels-strategy)
5. [NFR Testing Approach](#nfr-testing-approach)
6. [Deployment & Environment Strategy](#deployment--environment-strategy)
7. [Cross-Cutting Concerns Testing](#cross-cutting-concerns-testing)
8. [External Dependency Testing Strategy](#external-dependency-testing-strategy)
9. [Mobile-Specific Testing Strategy](#mobile-specific-testing-strategy)
10. [Performance Testing Architecture](#performance-testing-architecture)
11. [Test Environment Requirements](#test-environment-requirements)
12. [Testability Concerns](#testability-concerns)
13. [Recommendations for Sprint 0](#recommendations-for-sprint-0)

---

## Testability Assessment

- **Controllability - PASS:** Turborepo + Prisma seeds allow repeatable state resets across Expo, Next.js, and NestJS apps, and BullMQ queues can be drained via CLI. We still need a deterministic weather provider stub plus Supabase fixtures for guardian consent flows, but dependency injection hooks already exist in the NestJS modules, so the gap is procedural rather than architectural.
- **Observability - PASS:** Pino + OTLP logging, PostHog analytics, immutable `audit_log`, and uptime monitors (Playwright synthetic runs) provide the signals needed for both functional and NFR validation. Extend Grafana dashboards to surface queue depth, personalization cache hit rate, and Socket.io disconnects before the solutioning gate review.
- **Reliability - CONCERNS:** Multi-surface delivery (Expo, widgets, watch, responsive web) relies on cached personalization payloads, Socket.io streams, and third-party weather APIs. Without a replayable fixture service, cross-surface tests and chaos drills will remain flaky. Rate-limit handling and worker retries must be proved under load before gate approval.

---

## Architecturally Significant Requirements (ASRs)

| Risk ID | Category | Description                                                                                     | Prob. | Impact | Score | Mitigation Plan                                                                                                                                                   | Owner                    | Timeline |
| ------- | -------- | ----------------------------------------------------------------------------------------------- | ----- | ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------- |
| R-001   | SEC      | Guardian consent/RLS enforcement could regress, exposing under-16 wardrobe data.                | 2     | 3      | 6     | Playwright + API contract suite for teen/guardian signup, Supabase policy tests, audit-log assertions, and secret scanning during CI.                             | Platform Security        | Sprint 0 |
| R-002   | PERF/OPS | Weather ingestion + alert fan-out must stay <60 s despite provider rate limits.                 | 2     | 3      | 6     | k6 load model of `/api/v1/ritual` + alert workers, BullMQ burn-in with synthetic weather payloads, and chaos toggle that simulates upstream 429s.                 | Platform & Notifications | Sprint 0 |
| R-003   | DATA/SEC | Wardrobe upload + color worker could leak assets or stall without user feedback.                | 2     | 3      | 6     | Worker integration tests using sanitized fixtures, storage permission probes, and Maestro visual checks for failure codes; enforce auto-expiring signed URLs.     | Media Pipeline           | Sprint 1 |
| R-004   | BUS/TECH | Personalization payloads may diverge between API, BFF, and mobile cache, eroding trust metrics. | 2     | 2      | 4     | Snapshot/contract suite comparing NestJS responses, Next.js SSR payloads, and Expo clients per scenario; add hash comparisons to synthetic monitors.              | Personalization Core     | Sprint 1 |
| R-005   | OPS      | Moderation SLA (24 h) and audit trail could break under community spikes.                       | 2     | 3      | 6     | Queue load tests with lookbook fixtures, PostHog metric alarms for backlog growth, and Playwright admin flows that verify escalation plus immutable audit writes. | Community Ops            | Sprint 1 |
| R-006   | BUS      | Localization & disclosure rules (units, sponsorship labels) may desync across surfaces.         | 2     | 2      | 4     | Locale snapshot tests (Playwright + Storybook), translation pipeline linting, and automated checks for disclosure components before release.                      | Localization & Growth    | Sprint 1 |

High-risk items (score >=6) require mitigation evidence before the solutioning gate check proceeds.

---

## Architecture Decision Records (ADRs) → Test Coverage Mapping

This section maps key architectural patterns to their required test strategies, ensuring every significant design decision has validation coverage.

| ADR / Pattern                                 | Architectural Decision                                                                                       | Test Strategy                                                                                                                                                                                                                                                  | Test Location                                                                                             | Priority |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| **ADR-001: Socket.io Event Streaming**        | Real-time weather alerts + personalization updates pushed via Socket.io; fallback to polling if disconnected | 1. Connection lifecycle tests (connect, disconnect, reconnect with exponential backoff)<br>2. Event delivery verification (weather alert received within 5s)<br>3. Fallback polling activation after 30s disconnect<br>4. Message ordering/deduplication tests | Integration: `packages/api/src/websocket/__tests__/`<br>E2E: `apps/e2e/tests/real-time-alerts.spec.ts`    | P0       |
| **ADR-002: Personalization Cache Strategy**   | Redis cache (60s TTL) with database fallback; cache invalidation on preference changes                       | 1. Cache hit/miss behavior tests<br>2. TTL expiration validation<br>3. Fallback degradation tests (Redis down → DB query succeeds)<br>4. Cache invalidation trigger tests (preference update → cache cleared)                                                  | Integration: `packages/personalization/__tests__/cache.test.ts`<br>Load: `k6/scenarios/cache-pressure.js` | P0       |
| **ADR-003: BullMQ Job Processing**            | Weather ingestion + color extraction as async jobs; 3x retry with exponential backoff (1s, 5s, 25s)          | 1. Job enqueue/process/complete cycle<br>2. Retry logic validation (fail 2x, succeed on 3rd)<br>3. Dead-letter queue handling<br>4. Concurrency limits (max 5 color jobs in parallel)                                                                          | Integration: `packages/workers/__tests__/job-lifecycle.test.ts`<br>Burn-in: CI repeat 10x                 | P0       |
| **ADR-004: Supabase RLS Policies**            | Row-level security enforces guardian consent checks; teens can only access own wardrobe unless shared        | 1. Policy enforcement per persona (teen, guardian, admin)<br>2. Cross-account access denial tests<br>3. Shared wardrobe permission tests<br>4. RLS bypass attempts (SQL injection, JWT tampering)                                                              | Integration: `packages/db/__tests__/rls-policies.test.ts`<br>Security: OWASP probe suite                  | P0       |
| **ADR-005: Multi-Tenant Data Isolation**      | `user_id` column on all tables; application-level checks + RLS double-layer                                  | 1. Data isolation verification (user A cannot see user B data)<br>2. Audit log coverage (all user_id queries logged)<br>3. Migration safety (new tables must have user_id + RLS)                                                                               | Integration: per-package DB tests<br>Migration: pre-merge schema validation                               | P0       |
| **ADR-006: Weather Provider Adapter Pattern** | Abstract `IWeatherProvider` interface; OpenWeather implementation swappable with stub/mock                   | 1. Interface contract tests (all implementations return same shape)<br>2. Provider-specific error handling (429 rate limit, 500 server error)<br>3. Stub implementation for deterministic tests                                                                | Unit: `packages/weather/__tests__/provider-interface.test.ts`<br>Integration: Stub used in all E2E tests  | P1       |
| **ADR-007: Media Pipeline (Sharp + ONNX)**    | Color extraction via Sharp (resize) → ONNX (inference); results cached in `wardrobe_items.color_palette`     | 1. Pipeline stages (upload → resize → inference → store)<br>2. Failure handling at each stage (corrupted image, ONNX crash)<br>3. Performance validation (<5s per image)<br>4. GPU fallback to CPU                                                             | Integration: `packages/media/__tests__/color-extraction.test.ts`<br>Perf: k6 image upload scenario        | P1       |
| **ADR-008: Feature Flag Service**             | LaunchDarkly for gradual rollouts; fallback to hardcoded defaults if LD unavailable                          | 1. Flag evaluation tests (enabled/disabled states)<br>2. Targeting rule tests (user attributes → flag value)<br>3. Fallback behavior (LD down → default values used)<br>4. Flag cleanup enforcement (flags >90 days → alert)                                   | Unit: per-feature flag tests<br>Integration: `packages/flags/__tests__/service.test.ts`                   | P2       |

**Action Items:**

- Document any missing ADRs in `docs/architecture/decisions/` before gate review
- For each new ADR, add corresponding row to this mapping table
- Ensure test locations exist or are planned in Sprint 0

---

## Test Levels Strategy

| Level              | Target Mix                                                                                                      | Focus Areas                                                                                                                                                 | Tooling & Notes |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Unit (45%)         | Prisma models, personalization rules, feature-flag helpers, and utility hooks.                                  | Vitest + ts-mockito; enforce <300 lines and seed factories per Test Quality DoD.                                                                            |
| Integration (35%)  | NestJS modules <-> Supabase/Postgres, BullMQ workers, Next.js BFF contracts, Supabase RLS.                      | Vitest + Testcontainers/Supabase CLI, Pact-like schema checks, Playwright API tests for auth + policies.                                                    |
| E2E / System (20%) | Ritual journey across web/mobile/watch, guardian consent, wardrobe uploads, moderation console, locale toggles. | Playwright (web/widgets), Maestro (Expo), synthetic cron monitors, and selective test tags (@p0 smoke, @p1 regression) from the selective-testing fragment. |

The 45/35/20 split keeps most validation at deterministic layers while reserving full-stack coverage for couture-critical rituals, moderation, and compliance.

### E2E smoke playbook

- **Playwright (web/widget)**: use for hero/ritual/UI sanity, API health pings, accessibility scans, and localization snapshots. Default tag for smoke is `@p0`; keep flows <90s and no hard waits. Env: `WEB_E2E_BASE_URL` (default http://localhost:3005), `API_BASE_URL` if needed.
- **Maestro (mobile sanity only)**: minimal launch check via Expo Go (dev URL load + screenshot). Env: `MOBILE_E2E_APP_URL` (default `exp://127.0.0.1:8081/--/`), `MOBILE_E2E_HEALTH_URL` if overriding. Treat Maestro as a lightweight availability check, not deep UX validation.
- **Artifacts**: Playwright HTML/trace under `playwright/playwright-report` and `test-results/`; Maestro screenshots/logs under `maestro/artifacts`. Always upload on CI failure.
- **Tagging**: `@p0` for smoke (CI gating), `@p1` for broader regression. Keep @p0 limited to critical journeys and quick to run; push deeper cases to @p1 or lower.

---

## NFR Testing Approach

- **Security:** Automate auth/RLS tests (risk-governance + probability-impact guidance), OWASP probes on `/api/v1` routes, signed-URL expiry checks, and audit-log immutability assertions. Add dependency scanning for TensorFlow/Sharp workers and verify Doppler secrets per environment.
- **Performance:** k6 scenarios for weather ingestion, personalization cache refresh, and alert fan-out; Playwright synthetic monitors on Ritual pages to enforce <2 s FCP (per PRD). Track Redis cache hit rates, queue latency, and Supabase query plans in Grafana.
- **Reliability:** Chaos toggles that simulate provider outages, Socket.io disconnects, and Redis eviction; resiliency tests confirm fallback banners, cached payload use, and recovery timers. Maestro flows validate offline/low-bandwidth states for mobile/watch.
- **Maintainability:** Enforce Test Quality Definition of Done (no hard waits, <1.5 min runtime, explicit assertions). Turborepo pipeline already runs lint -> unit -> schema diff -> e2e; add coverage thresholds and snapshot discipline per package.

---

## Deployment & Environment Strategy

### Environment Promotion Pipeline

| Environment        | Purpose                                    | Data Strategy                                                                                                     | Test Strategy                                                                                       | Promotion Criteria                       |
| ------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Local**          | Developer workstations                     | Docker Compose (Postgres, Redis, Supabase local); Prisma seed scripts reset on demand                             | Unit + Integration tests run pre-commit; Playwright smoke tests run manually                        | N/A (individual dev flow)                |
| **CI (Ephemeral)** | GitHub Actions per-PR                      | Testcontainers (Postgres, Redis); Supabase CLI for local instance; weather provider stub; no real external APIs   | Full test suite: unit (45%) → integration (35%) → E2E (20%); burn-in for @p0 tests (3x repeat)      | All tests pass + coverage thresholds met |
| **Dev (Shared)**   | Integration testing; bleeding-edge deploys | Supabase dev project (wiped weekly); seeded with factories; real OpenWeather (test API key)                       | Synthetic Playwright monitors (hourly cron); E2E smoke suite post-deploy                            | Deploy succeeds + smoke tests pass       |
| **Staging**        | Pre-production validation; client demos    | Anonymized prod-like data (refreshed weekly); full RLS enforcement; real third-party integrations (non-prod keys) | Full regression suite (smoke + extended E2E); k6 load tests; Maestro mobile flows                   | Regression passes + load tests meet SLA  |
| **Production**     | Live user traffic                          | Real user data; backups + PITR enabled                                                                            | Synthetic monitors (5 min intervals); real user monitoring (RUM) via PostHog; Sentry error tracking | N/A (deployment target)                  |

### Database Migration Testing Strategy

**Pre-Merge Validation:**

1. **Schema Diff Review:** Turborepo task `db:migrate:check` runs on every PR; fails if migration would break existing queries
2. **RLS Policy Validation:** New tables must include `user_id` column + RLS policies; enforced via `db:lint` script
3. **Backward Compatibility:** Migrations must be additive (no breaking `ALTER TABLE DROP COLUMN` without deprecation period)
4. **Rollback Testing:** Every migration has a verified rollback script; tested in CI against seed data

**Post-Deploy Validation:**

1. **Smoke Tests:** Playwright suite hits all major endpoints post-migration to confirm no runtime breakage
2. **Performance Checks:** Grafana alerts if query times spike >2x baseline after migration
3. **Audit Log:** All migrations logged to `schema_migrations` table with timestamp + author

### Secrets & Configuration Management

**Per-Environment Config Testing:**

| Secret/Config          | Local          | CI             | Dev              | Staging          | Production       | Test Strategy                                                     |
| ---------------------- | -------------- | -------------- | ---------------- | ---------------- | ---------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`         | Docker Compose | Testcontainers | Supabase Dev     | Supabase Staging | Supabase Prod    | Connection pooling tests (max connections); failover tests        |
| `WEATHER_API_KEY`      | Stub (no key)  | Stub           | OpenWeather Test | OpenWeather Test | OpenWeather Prod | Rate limit handling (429); invalid key error handling (401)       |
| `REDIS_URL`            | Docker Compose | Testcontainers | Upstash Dev      | Upstash Staging  | Upstash Prod     | Eviction policy tests; connection timeout handling                |
| `LAUNCHDARKLY_SDK_KEY` | Offline mode   | Offline mode   | LD Test          | LD Test          | LD Prod          | Fallback to defaults when LD unavailable; flag evaluation tests   |
| `SUPABASE_SERVICE_KEY` | Local CLI      | Local CLI      | Supabase Dev     | Supabase Staging | Supabase Prod    | RLS bypass validation (service key should bypass); rotation tests |

**Doppler Integration:**

- **Test Strategy:** Validate Doppler sync on deploy via healthcheck endpoint (`/api/health?check=secrets`)
- **Secret Rotation:** Quarterly rotation enforced; tests must pass with rotated secrets before prod deployment
- **Leak Prevention:** Pre-commit hooks scan for hardcoded secrets; CI fails if `WEATHER_API_KEY` pattern found in code

---

## Cross-Cutting Concerns Testing

### Accessibility (a11y) Strategy

**WCAG Compliance Level:** AA (minimum); AAA aspirational for critical flows (guardian consent, ritual creation)

| Test Type               | Tooling                                                  | Coverage                                                                                          | Automated?         | Priority |
| ----------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------ | -------- |
| **Automated Scans**     | Playwright + axe-core                                    | All pages scanned during E2E suite; fails on critical violations (missing alt text, low contrast) | Yes (CI)           | P0       |
| **Keyboard Navigation** | Playwright keyboard interactions                         | Tab order, Enter/Space activation, Escape dismissal for modals                                    | Yes (E2E suite)    | P0       |
| **Screen Reader**       | Manual testing with VoiceOver (iOS) + TalkBack (Android) | Guardian consent flow, ritual creation, wardrobe upload                                           | No (manual QA)     | P1       |
| **Color Contrast**      | Storybook + contrast checker plugin                      | All UI components meet 4.5:1 contrast ratio                                                       | Yes (Storybook CI) | P1       |
| **Focus Management**    | Playwright assertions on `document.activeElement`        | Focus moves logically after modal open/close, form submission                                     | Yes (E2E suite)    | P1       |

**Acceptance Criteria:**

- Zero critical axe-core violations in CI (blocking)
- Keyboard navigation completes ritual flow without mouse (smoke test)
- VoiceOver testing completed for guardian consent before Sprint 1 gate

### Internationalization (i18n) Edge Cases

**Beyond Basic Locale Testing:**

| Concern                  | Test Scenarios                                                                        | Tooling                                                                   | Priority                  |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------- |
| **RTL Languages**        | Arabic/Hebrew: layout flips correctly, text alignment, scrollbar position             | Playwright + Storybook RTL mode                                           | P2 (if not launch target) |
| **Date/Time Formatting** | User in Tokyo (UTC+9) sees local time for ritual reminders; DST transitions handled   | Vitest with mocked timezones; Playwright with device geolocation override | P0                        |
| **Currency Formatting**  | Premium features display correct currency symbol (€, £, ¥) and decimal separators     | Vitest with Intl.NumberFormat mocks                                       | P2 (future monetization)  |
| **Text Expansion**       | German strings 30% longer than English; UI doesn't overflow or truncate critical info | Storybook with longest-locale plugin; visual regression tests             | P1                        |
| **Pluralization Rules**  | "1 item" vs "2 items" in Slavic languages (complex plural rules)                      | i18next testing utilities; unit tests per locale                          | P1                        |

**Translation Pipeline Testing:**

- **Lint Checks:** CI enforces all translation keys present in all locales; fails on missing keys
- **Disclosure Labels:** Sponsored content labels must appear in all locales (legal requirement); automated assertions
- **Fallback Strategy:** Missing translation → English fallback → log warning (not crash)

### Analytics Validation Strategy

**PostHog Event Testing:**

| Event Name                 | Trigger                        | Required Properties                           | Test Type                         | Priority |
| -------------------------- | ------------------------------ | --------------------------------------------- | --------------------------------- | -------- |
| `ritual_created`           | User completes ritual flow     | `user_id`, `ritual_type`, `weather_context`   | Integration (mock PostHog client) | P0       |
| `wardrobe_upload_started`  | User initiates upload          | `user_id`, `item_count`, `upload_source`      | Integration                       | P1       |
| `alert_received`           | Push notification delivered    | `user_id`, `alert_type`, `weather_severity`   | E2E (PostHog test project)        | P1       |
| `moderation_action`        | Admin approves/rejects content | `admin_id`, `action`, `content_type`          | Integration                       | P0       |
| `guardian_consent_granted` | Guardian approves teen account | `guardian_id`, `teen_id`, `consent_timestamp` | E2E                               | P0       |

**Testing Approach:**

- **Unit/Integration:** Mock PostHog client; assert events called with correct properties (no network calls)
- **E2E:** PostHog test project receives events; Playwright assertions verify event appears in PostHog UI or via API
- **Privacy:** Verify PII redaction (email/phone not sent unless explicitly consented)

### Error Tracking & Monitoring Strategy

**Sentry Integration Testing:**

| Error Scenario             | Expected Behavior                                                  | Test Strategy                                                          | Priority |
| -------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------- |
| **Unhandled Exception**    | Error logged to Sentry with stack trace, user context, breadcrumbs | Integration test throws error → verify Sentry mock received payload    | P0       |
| **API 5xx Error**          | NestJS logs error + Sentry alert; user sees friendly error message | E2E test forces 500 response → assert Sentry event + UI fallback       | P0       |
| **Worker Failure**         | BullMQ job fails → Sentry alert with job context; retry triggered  | Integration test simulates job failure → verify Sentry payload + retry | P0       |
| **Performance Regression** | Slow transaction (>2s) logged to Sentry Performance                | k6 load test → assert Sentry Performance trace captured                | P1       |
| **User-Reported Feedback** | Feedback form sends to Sentry User Feedback API                    | E2E test submits feedback → verify Sentry UI shows feedback            | P2       |

**Test vs Production Sentry Projects:**

- CI/Dev/Staging → Sentry Test Project (separate from prod)
- Production → Sentry Production Project
- Test Strategy: Verify error grouping works correctly (similar errors grouped, not duplicated)

---

## External Dependency Testing Strategy

### Third-Party Service Contract Validation

**OpenWeather API Contract Tests:**

**Strategy:** Consumer-driven contract tests (Pact-style) ensure our integration doesn't break when OpenWeather changes their API

| Test Scenario                | Expected Response                                      | Failure Handling                                         | Test Type                         | Priority |
| ---------------------------- | ------------------------------------------------------ | -------------------------------------------------------- | --------------------------------- | -------- |
| **Successful Weather Fetch** | `{ temp: number, condition: string, alerts: Alert[] }` | N/A (happy path)                                         | Contract test (Pact or snapshot)  | P0       |
| **Rate Limit (429)**         | `{ error: "rate limit exceeded" }`                     | Exponential backoff (5s, 15s, 45s); cached weather used  | Integration test with mocked 429  | P0       |
| **Server Error (500)**       | `{ error: "internal server error" }`                   | Fallback to cached weather; Sentry alert                 | Integration test with mocked 500  | P0       |
| **Invalid API Key (401)**    | `{ error: "unauthorized" }`                            | Hard failure (config error); alert on-call               | Integration test with invalid key | P1       |
| **Schema Change**            | OpenWeather adds new field or renames existing         | Contract test fails in CI; manual review before adapting | Weekly contract verification job  | P1       |

**Implementation:**

- **Stub Service:** `packages/weather/src/providers/stub-provider.ts` returns fixtures for deterministic tests
- **Contract Fixtures:** `packages/weather/__fixtures__/openweather-responses.json` contains real API snapshots
- **Versioning:** Track OpenWeather API version (`v2.5` currently); tests fail if version changes without review

### Supabase Auth Provider Testing

**Magic Link Flow Testing:**

| Test Case                     | Scenario                                                          | Validation                                                             | Test Type                | Priority |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------ | -------- |
| **Happy Path**                | User enters email → receives magic link → clicks → authenticated  | Assert JWT token received; user session created                        | E2E (email stub service) | P0       |
| **Link Expiration**           | Magic link expires after 1 hour; user clicks expired link → error | Assert error message shown; user prompted to request new link          | E2E (time manipulation)  | P0       |
| **Link Reuse Prevention**     | User clicks same magic link twice → second click fails            | Assert 401 on second click; Sentry logs suspicious activity            | E2E                      | P1       |
| **Multi-Device Session**      | User authenticates on mobile, then web → both sessions valid      | Assert session tokens independent; logout on mobile doesn't affect web | E2E (multi-browser)      | P1       |
| **Session Expiration**        | JWT expires after 7 days; refresh token renews session            | Assert refresh token flow triggered; new JWT issued                    | Integration test         | P0       |
| **Guardian <-> Teen Linking** | Guardian invites teen → teen accepts → linked accounts            | Assert RLS policies grant guardian access to teen wardrobe             | E2E                      | P0       |

**Email Delivery Testing:**

- **Local/CI:** Email stub service captures emails in memory; tests extract magic link from email body
- **Staging:** Real email (test addresses like `test+{uuid}@couture-cast.dev`); automated inbox polling
- **Production:** Real email; monitor delivery rates via SendGrid/Postmark metrics

### Email Delivery Testing

**Alert Email Regression:**

| Test Case               | Scenario                                                      | Validation                                                                   | Tooling                                       | Priority |
| ----------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- | -------- |
| **Weather Alert Email** | Severe weather triggers alert → email sent within 60s         | Assert email received; content includes weather details + ritual suggestions | Playwright + email stub (Mailhog/MailCatcher) | P0       |
| **Template Rendering**  | Email uses correct locale; personalized with user name        | Assert email body contains `Hola, {{user.firstName}}` (Spanish locale)       | Integration test with template engine         | P1       |
| **Unsubscribe Link**    | User clicks unsubscribe → preference updated → no more emails | E2E test clicks link → assert DB `email_preferences.alerts = false`          | E2E                                           | P1       |
| **Attachment Handling** | Wardrobe sharing email includes preview image                 | Assert email contains `<img src="...">` with signed URL                      | Integration test                              | P2       |

**Tooling:**

- **CI/Local:** [Mailhog](https://github.com/mailhog/MailHog) captures SMTP; Playwright queries Mailhog API
- **Staging:** Real email provider (SendGrid test account); automated inbox polling via IMAP

---

## Mobile-Specific Testing Strategy

### Device Matrix & Platform Coverage

**Supported Devices (MVP):**

| Platform         | Versions                    | Devices                                            | Test Coverage            | Tooling                     |
| ---------------- | --------------------------- | -------------------------------------------------- | ------------------------ | --------------------------- |
| **iOS**          | 16.0+                       | iPhone 13/14/15 (simulators); iPad Pro (optional)  | Smoke + P0 scenarios     | Maestro + iOS Simulator     |
| **Android**      | 12+ (API 31+)               | Pixel 5/6/7 (emulators); Samsung Galaxy (optional) | Smoke + P0 scenarios     | Maestro + Android Emulator  |
| **Apple Watch**  | watchOS 9+                  | Series 7/8/9 (simulators)                          | Ritual quick-glance only | Maestro + Watch Simulator   |
| **Web (Mobile)** | iOS Safari 16+, Chrome 110+ | Responsive breakpoints (375px, 414px)              | Full E2E suite           | Playwright mobile emulation |

**Test Execution Strategy:**

- **CI:** Single device per platform (iPhone 14, Pixel 6) for smoke tests (5 min)
- **Nightly:** Full matrix (all devices) for regression (30 min)
- **Pre-Release:** Manual QA on physical devices (top 3 user devices from analytics)

### Platform-Specific Edge Cases

**iOS-Specific Tests:**

| Test Case                         | Scenario                                                                      | Validation                                                                  | Priority |
| --------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| **Push Notification Permissions** | App requests permission on first launch → user grants/denies                  | Assert permission state stored; denied users see in-app fallback            | P0       |
| **Background App Refresh**        | Weather updates while app in background → notification badge updates          | Assert badge count correct on app open                                      | P1       |
| **Biometric Auth (Face ID)**      | User enables Face ID for app lock → Face ID prompt on open                    | Maestro visual assertion on Face ID UI (simulator limitation: auto-succeed) | P2       |
| **Low Power Mode**                | iOS low power mode disables background refresh → app shows stale data warning | Assert warning banner visible; manual refresh button works                  | P1       |

**Android-Specific Tests:**

| Test Case                          | Scenario                                                                 | Validation                                                             | Priority |
| ---------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------- |
| **Background Task Restrictions**   | Android 12+ restricts background workers → weather sync delayed          | Assert sync resumes when app foregrounded; fallback notification shown | P0       |
| **Battery Optimization**           | App added to battery optimization whitelist → background sync works      | Assert sync happens on schedule; Doze mode doesn't block               | P1       |
| **Per-App Language (Android 13+)** | User sets Spanish for app, English for system → app displays Spanish     | Assert locale override works; translations correct                     | P1       |
| **Notification Channels**          | Separate channels for alerts, social, system → user can mute alerts only | Assert channel configuration; mute alerts → no alert notifications     | P1       |

### Offline & Low-Bandwidth Testing

**Network Resilience Scenarios:**

| Scenario                    | Expected Behavior                                                      | Validation                                               | Tooling                       | Priority |
| --------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------- | -------- |
| **Airplane Mode**           | App opens with cached data; shows "offline" banner; sync queued        | Assert cached ritual visible; upload queued until online | Maestro + network toggle      | P0       |
| **Slow 3G**                 | Images load progressively; skeleton screens shown; timeout after 30s   | Assert loading states; timeout triggers fallback         | Playwright network throttling | P1       |
| **Intermittent Connection** | Upload retries automatically; user sees progress indicator             | Assert retry logic (3x attempts); progress bar updates   | Maestro + flaky network sim   | P1       |
| **Socket.io Reconnection**  | Connection drops → app switches to polling → reconnects when available | Assert exponential backoff (1s, 3s, 9s); max 5 retries   | Integration + E2E             | P0       |

**Implementation:**

- **Maestro:** Use `network` command to toggle airplane mode, throttle bandwidth
- **Playwright:** Use `context.route()` to simulate network conditions (slow responses, timeouts)

### App Update & Backward Compatibility

**Version Migration Testing:**

| Test Case                  | Scenario                                                                   | Validation                                                                | Priority |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| **Force Update**           | User on v1.0.0; v1.1.0 required → force update modal shown                 | Assert modal blocks app; "Update" button opens App Store/Play Store       | P0       |
| **Optional Update**        | User on v1.0.0; v1.0.1 available → banner shown; dismissible               | Assert banner shown once per session; dismiss persists                    | P1       |
| **Data Migration**         | User upgrades from v1.0.0 to v2.0.0 → local DB schema migrates             | Assert migration runs on app open; data preserved                         | P0       |
| **Rollback Compatibility** | User on v2.0.0 API; server rolled back to v1.9.0 → app gracefully degrades | Assert fallback to compatible API version; non-critical features disabled | P1       |

---

## Performance Testing Architecture

### Performance Baselines & SLA Targets

**Current Performance Metrics (Baseline TBD - Measure in Sprint 0):**

| Metric                  | Target (PRD)                    | Baseline (Current) | Threshold (Alert) | Measurement Tool              | Priority |
| ----------------------- | ------------------------------- | ------------------ | ----------------- | ----------------------------- | -------- |
| **Ritual Page FCP**     | <2s                             | TBD                | >2.5s (P95)       | Playwright Performance API    | P0       |
| **Weather Ingestion**   | <60s end-to-end                 | TBD                | >90s (P99)        | k6 custom metric              | P0       |
| **Alert Fan-Out**       | <5s per user                    | TBD                | >10s (P95)        | BullMQ job duration           | P0       |
| **Wardrobe Upload**     | <10s (image resize + inference) | TBD                | >15s (P95)        | Worker job duration           | P1       |
| **API Response Time**   | <200ms (P95)                    | TBD                | >500ms (P95)      | Grafana dashboard             | P1       |
| **Database Query Time** | <50ms (P95)                     | TBD                | >100ms (P95)      | Supabase Performance Insights | P1       |

**Action:** Run baseline measurement suite in Sprint 0; document results before gate review

### Load Profile Modeling

**Expected Concurrent Users (Launch Target):**

| Time Window                    | Concurrent Users | Requests/Second | Data Volume                             | Test Scenario                    |
| ------------------------------ | ---------------- | --------------- | --------------------------------------- | -------------------------------- |
| **Peak Morning (6-9 AM)**      | 500              | 50 req/s        | Weather ingestion spike                 | k6 scenario: morning_ritual_rush |
| **Steady Daytime (9 AM-6 PM)** | 200              | 20 req/s        | Wardrobe uploads + browsing             | k6 scenario: steady_state        |
| **Evening Peak (6-9 PM)**      | 400              | 40 req/s        | Social features (lookbook sharing)      | k6 scenario: evening_engagement  |
| **Weather Event Spike**        | 1000             | 100 req/s       | Alert fan-out (severe weather triggers) | k6 scenario: weather_alert_storm |

**k6 Test Scenarios:**

- `k6/scenarios/morning-ritual-rush.js` - Ramp up to 500 VUs over 5 min; hold 10 min; ramp down
- `k6/scenarios/weather-alert-storm.js` - Sudden spike to 1000 VUs; hold 2 min (stress test)
- **Success Criteria:** All scenarios meet SLA targets; no 5xx errors; database CPU <70%

### Resource Utilization Testing

**Infrastructure Limits:**

| Resource                 | Current Capacity    | Test Strategy                                                             | Alert Threshold            | Priority |
| ------------------------ | ------------------- | ------------------------------------------------------------------------- | -------------------------- | -------- |
| **Database Connections** | 100 (Supabase pool) | k6 scenario holds 100 connections for 5 min → assert no connection errors | >80 connections (80%)      | P0       |
| **Redis Memory**         | 1 GB (Upstash)      | Cache pressure test (10k keys written) → assert LRU eviction works        | >800 MB (80%)              | P0       |
| **BullMQ Concurrency**   | 5 workers/queue     | Flood queue with 500 jobs → assert max 5 concurrent; others queued        | >100 queued jobs (backlog) | P1       |
| **Worker Memory Leak**   | N/A                 | Run color extraction 1000x → assert memory stable (no growth >10%)        | Memory growth >10%         | P1       |
| **CPU Profiling**        | N/A                 | k6 load test → capture CPU flame graph → identify hotspots                | CPU >80% sustained         | P2       |

---

## Test Environment Requirements

1. **Supabase Test Project** with anonymized wardrobe assets, guardian consent fixtures, and RLS parity (no bypass).
2. **Weather Provider Harness** that replays OpenWeather payloads, emits 429/500 codes on demand, and feeds both NestJS and Next.js BFF for diff testing.
3. **BullMQ/Redis Sandbox** seeded with synthetic alert + personalization jobs to validate retry/backoff logic without touching production queues.
4. **Media Pipeline Lab** containing Sharp/ONNX dependencies plus GPU fallback toggles so worker tests run headless in CI.
5. **Cross-Surface Device Matrix** (Playwright browsers, Expo simulators, watch emulator) wired into selective-testing scripts for smoke/regression tiers.
6. **Localization Snapshot Suite** with locale bundles and disclosure templates to catch unit/label drift early.

---

## Testability Concerns

1. **Weather API Stubbing Gap (CONCERNS):** No dedicated stub exists, forcing flaky live calls during regression. Action: build reusable fixture service + contract tests before \*ci workflow runs.
2. **Wardrobe Worker Dependency Weight (CONCERNS):** Color extraction stack (Sharp + TensorFlow) is heavy for CI; create lightweight mock pipeline or container image with cached models.
3. **Multi-Locale Regression Coverage (CONCERNS):** Locale-aware disclosure and sponsorship labels currently rely on manual review. Add automated snapshot checks and enforce translation linting in CI.

---

## Test Data Management Strategy

### Test Data Lifecycle & Ownership

**Data Creation Strategies:**

| Strategy                      | When to Use                                             | Ownership                                                    | Versioning                     | Example                                              |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------- |
| **Factory Functions**         | Unit + Integration tests; create minimal valid entities | Dev team; factories live with source code (`__factories__/`) | Git versioned; reviewed in PRs | `createUser({ role: 'teen', age: 15 })`              |
| **Prisma Seed Scripts**       | Local dev + CI; baseline data for E2E tests             | Platform team; seeds in `prisma/seeds/`                      | Git versioned; migration-aware | `npm run db:seed` → 10 users, 50 wardrobe items      |
| **API Setup Calls**           | E2E tests needing specific scenarios                    | Test authors; setup in test files or fixtures                | Git versioned test code        | `await api.setupGuardianWithTeen({ consent: true })` |
| **Anonymized Prod Snapshots** | Staging only; realistic data shapes                     | Data team; refreshed weekly                                  | Timestamped snapshots          | `staging-snapshot-2025-11-13.sql`                    |

**Data Cleanup Discipline:**

```typescript
// REQUIRED PATTERN: Every test cleans up what it creates
describe("Wardrobe Upload", () => {
  let testUserId: string;
  let uploadedItemIds: string[] = [];

  beforeEach(async () => {
    testUserId = await createTestUser(); // Factory
  });

  afterEach(async () => {
    // Clean up in reverse order of creation
    await deleteWardrobeItems(uploadedItemIds);
    await deleteUser(testUserId);
    uploadedItemIds = []; // Reset
  });

  it("should upload image and extract colors", async () => {
    const item = await uploadWardrobeItem(testUserId, "shirt.jpg");
    uploadedItemIds.push(item.id); // Track for cleanup

    expect(item.colorPalette).toBeDefined();
  });
});
```

**Parallel Execution Safety:**

| Challenge            | Solution                         | Implementation                                                                   |
| -------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| **Data Collisions**  | Unique identifiers per test run  | Use `test-${Date.now()}-${Math.random()}` for emails; UUID for user IDs          |
| **Shared Resources** | Partition or pool resources      | Dedicated test database per CI worker; BullMQ queue prefixes (`test-worker-1-*`) |
| **Race Conditions**  | Atomic operations + transactions | Use database transactions for multi-step setup; cleanup in finally blocks        |
| **Flaky Cleanup**    | Idempotent cleanup scripts       | `DELETE WHERE user_id LIKE 'test-%'` safe to run multiple times                  |

**Test Data Versioning:**

- **Factories:** Bump version when entity schema changes (e.g., `createUser v2` after adding `guardianId` field)
- **Seed Data:** Migrations auto-update seeds; CI fails if seed incompatible with schema
- **Fixtures:** JSON fixtures tagged with schema version; tests skip if version mismatch

### PII & GDPR Compliance for Test Data

**Data Classification:**

| Data Type                | Allowed in Tests?   | Anonymization Strategy                         | Storage                        |
| ------------------------ | ------------------- | ---------------------------------------------- | ------------------------------ |
| **Production User Data** | ❌ NEVER            | N/A - use synthetic only                       | N/A                            |
| **Anonymized Snapshots** | ✅ Staging only     | Hash emails; mask names; shuffle relationships | Encrypted S3; 30-day retention |
| **Synthetic Data**       | ✅ All environments | Faker.js; realistic but fake                   | Git (factories); DB (seeds)    |
| **Test Account Data**    | ✅ Dev/Staging/CI   | `test+uuid@example.com`; obvious test names    | Cleaned up after 7 days        |

**GDPR Test Scenarios:**

| Test Case              | Scenario                                                | Validation                                                                        | Priority |
| ---------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| **Right to Erasure**   | User requests data deletion → all records purged        | Assert user, wardrobe, audit logs deleted (except immutable audit trail metadata) | P0       |
| **Data Portability**   | User exports data → JSON includes all personal data     | Assert export contains user profile, wardrobe, ritual history                     | P1       |
| **Consent Withdrawal** | Guardian revokes teen consent → teen account restricted | Assert teen can't create rituals; wardrobe hidden                                 | P0       |
| **Data Minimization**  | System doesn't collect unnecessary data                 | Assert no PII in logs, analytics, or error reports unless explicitly needed       | P1       |

### Seed Data Synchronization

**Maintenance Strategy:**

1. **Ownership:** Platform team owns `prisma/seeds/`; changes reviewed in PRs
2. **Migration Coupling:** Every schema migration triggers seed update review; CI enforces compatibility
3. **Environment Parity:** Same seed scripts run in Local, CI, Dev; Staging uses anonymized snapshots
4. **Refresh Cadence:**
   - Local: On-demand (`npm run db:reset`)
   - CI: Every test run (ephemeral DB)
   - Dev: Weekly automated wipe + reseed
   - Staging: Weekly snapshot refresh

**Seed Data Coverage:**

| Entity                | Count | Rationale                                        | Relationships             |
| --------------------- | ----- | ------------------------------------------------ | ------------------------- |
| **Users (Teens)**     | 5     | Cover age range (13-17); various consent states  | Each linked to guardian   |
| **Users (Guardians)** | 3     | 1:1, 1:2, 1:3 guardian-teen ratios               | Linked to teens           |
| **Wardrobe Items**    | 50    | Mix of clothing types; some shared, some private | Distributed across teens  |
| **Rituals**           | 20    | Various weather contexts; different time slots   | Linked to users + weather |
| **Weather Snapshots** | 10    | Sunny, rainy, snow, extreme heat, alerts         | Referenced by rituals     |
| **Feature Flags**     | 8     | Mix of enabled/disabled; targeting rules         | N/A                       |

---

## Flakiness Prevention & Test Stability

### Timing & Race Condition Debugging

**Common Patterns & Fixes:**

| Pattern                             | Symptom                                             | Root Cause                                 | Fix                                                       | Example                                                                                                           |
| ----------------------------------- | --------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Element Appears Then Disappears** | `expect(button).toBeVisible()` fails intermittently | Animation timing; React re-render          | Use `waitFor` with retry logic                            | `await waitFor(() => expect(button).toBeVisible(), { timeout: 5000 })`                                            |
| **State Update Race**               | Assertion on updated data fails                     | API call completes, but UI not updated yet | Wait for network idle or specific element                 | `await page.waitForResponse('/api/user'); await page.waitForSelector('[data-testid="updated-badge"]')`            |
| **Worker Job Timing**               | E2E test expects job result too early               | BullMQ job not processed yet               | Poll for expected state or use test event hooks           | `await pollUntil(() => db.wardrobeItem.findUnique({ where: { id } }), item => item.colorPalette !== null, 10000)` |
| **Socket.io Event Delivery**        | Real-time update not received                       | Event emitted before listener registered   | Ensure listener set up before triggering action           | `await page.evaluate(() => window.socket.once('alert')); await triggerAlert(); await page.waitForEvent('alert')`  |
| **Database Transaction Isolation**  | Test sees stale data from previous test             | Transaction not committed before next test | Use `afterEach` cleanup + explicit transaction management | `await db.$transaction([...], { isolationLevel: 'ReadCommitted' })`                                               |

**Deterministic Wait Strategies:**

```typescript
// ❌ BAD: Hard wait (flaky + slow)
await page.waitForTimeout(3000);

// ✅ GOOD: Wait for specific condition
await page.waitForSelector('[data-testid="upload-complete"]');
await page.waitForLoadState("networkidle");

// ✅ GOOD: Poll with timeout
await waitFor(
  async () => {
    const status = await getJobStatus(jobId);
    expect(status).toBe("completed");
  },
  { timeout: 10000, interval: 500 }
);

// ✅ GOOD: Wait for network request
await Promise.all([
  page.waitForResponse(
    (resp) => resp.url().includes("/api/wardrobe") && resp.status() === 201
  ),
  page.click('[data-testid="upload-button"]'),
]);
```

**Playwright Configuration (No Hard Waits Enforcement):**

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    // Global timeout prevents infinite waits
    actionTimeout: 10_000, // 10s max per action
    navigationTimeout: 30_000, // 30s max for page navigation
  },
  expect: {
    timeout: 5_000, // 5s max for assertions
  },
  // CRITICAL: Fail tests that use waitForTimeout
  forbid: [
    {
      pattern: /waitForTimeout|sleep/,
      message:
        "Hard waits forbidden - use waitForSelector or waitForResponse instead",
    },
  ],
});
```

### Test Healing & Failure Diagnosis

**Automated Failure Pattern Recognition:**

| Failure Pattern        | Detection                                       | Auto-Heal Action                                | Manual Follow-Up                                           |
| ---------------------- | ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| **Selector Not Found** | `Error: Locator not found: [data-testid="foo"]` | Retry with fallback selectors (text, role, CSS) | Update test to use more resilient selector                 |
| **Network Timeout**    | `Error: Timeout waiting for response`           | Retry test once; log network conditions         | Investigate API latency; add timeout override if justified |
| **Stale Element**      | `Error: Element is not attached to DOM`         | Re-query element before interaction             | Add explicit wait for element stability                    |
| **Flaky Assertion**    | Test passes on retry without code change        | Flag as flaky; require 3x pass before merge     | Investigate timing issue; add deterministic wait           |

**Flaky Test Quarantine Process:**

1. **Detection:** CI marks test as flaky after 2+ failures in 10 runs (20% flake rate)
2. **Quarantine:** Test tagged `@flaky`; runs separately; doesn't block CI
3. **Investigation:** Assigned to test author; deadline 5 business days
4. **Resolution:** Fix + prove stability (10x burn-in pass) OR delete test if not fixable
5. **Release:** Remove `@flaky` tag; monitor for regression

**Test Observability (Trace Viewer Integration):**

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    trace: "retain-on-failure", // Capture trace only on failure
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Upload artifacts to S3 for team review
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "results.xml" }], // For CI parsing
    ["@playwright/test/reporter", { uploadArtifacts: true }], // Custom S3 uploader
  ],
});
```

---

## CI/CD Pipeline Architecture

### Pipeline Stages & Failure Triage

**Multi-Stage Pipeline Design:**

```yaml
# .github/workflows/test.yml (conceptual)
stages:
  - name: "Smoke Tests (@p0)"
    parallelism: 1
    timeout: 5 min
    on_failure: BLOCK (no further stages run)
    tests: "@p0 @smoke"

  - name: "Unit + Integration (45% + 35%)"
    parallelism: 4 (4 shards)
    timeout: 15 min
    on_failure: BLOCK
    tests: "unit/**/*.test.ts integration/**/*.test.ts"

  - name: "E2E Regression (@p1)"
    parallelism: 2
    timeout: 20 min
    on_failure: BLOCK
    tests: "@p1 @regression"

  - name: "Burn-In (@p0 3x repeat)"
    parallelism: 1
    timeout: 15 min
    on_failure: WARN (doesn't block merge, but alerts team)
    tests: "@p0 --repeat-each=3"

  - name: "k6 Load Tests"
    parallelism: 1
    timeout: 10 min
    on_failure: WARN
    tests: "k6/scenarios/*.js"
```

**Failure Triage & Ownership:**

| Failure Type             | Alert Mechanism                    | SLA to Fix       | Owner            | Escalation                       |
| ------------------------ | ---------------------------------- | ---------------- | ---------------- | -------------------------------- |
| **Smoke Test Failure**   | Slack @channel + PagerDuty         | <1 hour          | On-call engineer | CTO if not resolved in 2 hours   |
| **Regression Failure**   | Slack #test-failures + JIRA ticket | <4 hours         | PR author        | Tech lead if not resolved by EOD |
| **Burn-In Flake**        | Slack #flaky-tests + GitHub issue  | <5 business days | Test author      | Test architect reviews weekly    |
| **Load Test Regression** | Slack #performance + Grafana alert | <1 business day  | Platform team    | Architect if SLA breach imminent |

### Selective Test Execution Strategy

**Tag Taxonomy:**

| Tag      | Meaning                        | Execution Context          | Coverage      | Avg Runtime |
| -------- | ------------------------------ | -------------------------- | ------------- | ----------- |
| `@p0`    | Smoke; critical user journeys  | Every PR + pre-deploy      | ~20 tests     | 5 min       |
| `@p1`    | Regression; important features | Every PR (after @p0)       | ~100 tests    | 20 min      |
| `@p2`    | Extended; edge cases           | Nightly cron               | ~200 tests    | 45 min      |
| `@p3`    | Nice-to-have; exploratory      | Weekly cron                | ~50 tests     | 15 min      |
| `@smoke` | Fast sanity checks             | Post-deploy verification   | Subset of @p0 | 2 min       |
| `@flaky` | Quarantined tests              | Separate job; non-blocking | Variable      | Variable    |

**Diff-Based Test Selection (Future Enhancement):**

| Change Type                 | Tests Triggered                                          | Rationale                      |
| --------------------------- | -------------------------------------------------------- | ------------------------------ |
| **API Route Modified**      | All tests tagged with that route (e.g., `@api-wardrobe`) | Direct impact                  |
| **Database Schema Changed** | All integration + E2E tests                              | Wide impact; data dependencies |
| **UI Component Changed**    | Component tests + E2E flows using component              | Direct + indirect impact       |
| **Config/Env Changed**      | Full test suite                                          | Unknown blast radius           |

**Promotion Rules:**

- **PR Merge:** @p0 + @p1 must pass; @p2/@p3 don't block
- **Deploy to Dev:** @p0 smoke tests run post-deploy; rollback if fail
- **Deploy to Staging:** @p0 + @p1 + load tests must pass
- **Deploy to Production:** All staging tests + manual QA sign-off

### Artifact Retention & Storage Budget

**Retention Policy:**

| Artifact Type               | Retention Period | Storage Location         | Max Size        | Cleanup               |
| --------------------------- | ---------------- | ------------------------ | --------------- | --------------------- |
| **Test Traces (Pass)**      | 7 days           | S3 (lifecycle policy)    | 50 MB/trace     | Auto-delete after 7d  |
| **Test Traces (Fail)**      | 30 days          | S3                       | 50 MB/trace     | Auto-delete after 30d |
| **Videos (Fail only)**      | 14 days          | S3                       | 20 MB/video     | Auto-delete after 14d |
| **Screenshots (Fail only)** | 14 days          | S3                       | 2 MB/screenshot | Auto-delete after 14d |
| **Test Reports (HTML)**     | 90 days          | S3 + GitHub Pages        | 10 MB/report    | Auto-delete after 90d |
| **JUnit XML**               | 365 days         | GitHub Actions artifacts | 1 MB/file       | Auto-delete after 1y  |

**Storage Budget:** ~100 GB/month; alerts if exceeds 120 GB

---

## Compliance & Security Testing Depth

### Guardian Consent Flow Edge Cases

**Comprehensive Test Matrix:**

| Test Case                                | Scenario                                               | Validation                                                                      | Priority |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- | -------- |
| **Single Guardian Happy Path**           | Guardian creates account → invites teen → teen accepts | Assert teen account created; RLS grants guardian access                         | P0       |
| **Guardian Revokes Consent Mid-Session** | Teen logged in; guardian revokes → session invalidated | Assert teen logged out immediately; wardrobe inaccessible                       | P0       |
| **Multiple Guardians (Divorced)**        | Two guardians both link to same teen                   | Assert both guardians have access; either can revoke (requires both to restore) | P1       |
| **Teen Turns 18**                        | Teen birthday passes 18th → auto-emancipate            | Assert guardian access revoked; teen gains full control                         | P1       |
| **Guardian Deletes Account**             | Guardian deletes account → teen consent status         | Assert teen account preserved; consent marked "guardian removed"                | P1       |
| **Consent Audit Trail**                  | All consent changes logged immutably                   | Assert audit_log records all grant/revoke events; tamper-proof                  | P0       |
| **Age Verification Failure**             | Teen enters age >18 or <13 during signup               | Assert account creation blocked; clear error message                            | P0       |

### RLS Policy Coverage & Mutation Testing

**Policy Test Coverage Metrics:**

| Policy               | Personas Tested                  | Attack Scenarios                                   | Coverage              | Status                 |
| -------------------- | -------------------------------- | -------------------------------------------------- | --------------------- | ---------------------- |
| `wardrobe_items_rls` | Teen, Guardian, Admin, Anonymous | SQL injection, JWT tampering, cross-account access | 95% (19/20 scenarios) | ✅ PASS                |
| `rituals_rls`        | Teen, Guardian, Admin            | Shared ritual access, private ritual protection    | 90% (9/10 scenarios)  | ✅ PASS                |
| `audit_log_rls`      | Admin only                       | Unauthorized read attempts, write attempts         | 100% (5/5 scenarios)  | ✅ PASS                |
| `user_profiles_rls`  | User self, Guardian, Admin       | Profile enumeration, cross-user reads              | 85% (17/20 scenarios) | ⚠️ GAPS (3 edge cases) |

**Mutation Testing for RLS Policies:**

```sql
-- Original Policy (correct)
CREATE POLICY "Users can only see own wardrobe"
  ON wardrobe_items FOR SELECT
  USING (auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM guardian_links WHERE teen_id = user_id AND guardian_id = auth.uid()
  ));

-- Mutation 1: Remove guardian check (should FAIL tests)
-- USING (auth.uid() = user_id); -- Tests must catch this!

-- Mutation 2: OR instead of AND (should FAIL tests)
-- USING (auth.uid() = user_id OR teen_id = auth.uid()); -- Tests must catch this!
```

**Mutation Testing Process:**

1. Automated tool mutates RLS policies (remove clauses, swap operators)
2. Run full RLS test suite against mutated policy
3. If tests still pass → gap in coverage; add test case
4. Goal: 100% mutation kill rate (all mutations caught by tests)

### Audit Log Verification & Immutability

**Immutability Test Strategy:**

| Test Case                        | Attack Vector                                             | Expected Behavior                                           | Validation                                |
| -------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| **Direct SQL UPDATE**            | `UPDATE audit_log SET action = 'approved' WHERE id = X`   | PostgreSQL trigger blocks UPDATE; returns error             | Integration test: assert UPDATE fails     |
| **Direct SQL DELETE**            | `DELETE FROM audit_log WHERE user_id = X`                 | PostgreSQL trigger blocks DELETE; returns error             | Integration test: assert DELETE fails     |
| **Service Key Bypass Attempt**   | Use Supabase service key to bypass RLS → modify audit log | Service key can read but not write/update/delete            | Integration test: service key write fails |
| **Retention Policy Enforcement** | Old audit logs (>7 years) auto-archived to cold storage   | Archival job runs monthly; production table stays <10M rows | Scheduled job test: verify archive logic  |

**Completeness Testing:**

| Sensitive Operation         | Audit Log Entry         | Required Fields                                          | Test Coverage   |
| --------------------------- | ----------------------- | -------------------------------------------------------- | --------------- |
| **Guardian Grants Consent** | `consent_granted`       | `guardian_id`, `teen_id`, `timestamp`, `ip_address`      | ✅ P0 test      |
| **Wardrobe Item Shared**    | `item_shared`           | `user_id`, `item_id`, `shared_with`, `timestamp`         | ✅ P1 test      |
| **Admin Moderation Action** | `moderation_action`     | `admin_id`, `target_id`, `action`, `reason`, `timestamp` | ✅ P0 test      |
| **User Data Export**        | `data_export_requested` | `user_id`, `timestamp`, `export_type`                    | ⚠️ Missing test |
| **Account Deletion**        | `account_deleted`       | `user_id`, `timestamp`, `reason`, `deleted_by`           | ✅ P0 test      |

---

## Team & Process Guidelines

### Test Ownership Model

**Roles & Responsibilities:**

| Role                       | Writes Tests                                         | Reviews Tests           | Maintains Tests     | Coverage Goals                |
| -------------------------- | ---------------------------------------------------- | ----------------------- | ------------------- | ----------------------------- |
| **Backend Devs**           | Unit (models, services) + Integration (API, DB)      | All backend tests       | Own package tests   | 80% line coverage             |
| **Frontend Devs**          | Unit (components, hooks) + Integration (API clients) | All frontend tests      | Own package tests   | 75% branch coverage           |
| **QA Engineers**           | E2E (Playwright, Maestro) + Load (k6)                | E2E + Load tests        | E2E test suite      | 90% critical journey coverage |
| **Test Architect (Murat)** | Framework + patterns                                 | All test PRs (sampling) | Test infrastructure | N/A (advisory role)           |
| **Platform Team**          | Infrastructure tests (CI, deployments)               | Infrastructure tests    | CI/CD pipelines     | 100% pipeline coverage        |

**Test Code Review Checklist:**

- [ ] No hard waits (`waitForTimeout`, `sleep`)
- [ ] Explicit assertions (not just "didn't crash")
- [ ] Cleanup in `afterEach` or `finally` blocks
- [ ] Test isolation (no dependencies between tests)
- [ ] Appropriate test level (unit vs integration vs E2E)
- [ ] Follows naming convention: `describe('Component/Feature', () => it('should X when Y'))`
- [ ] Test data uses factories (not hardcoded)
- [ ] Runtime <1.5 min (E2E) or <10s (unit/integration)

### Test Documentation Standards

**Test Case Naming Convention:**

```typescript
// ✅ GOOD: Descriptive, outcome-focused
describe('Wardrobe Upload', () => {
  it('should extract color palette when valid image uploaded', async () => { ... });
  it('should show error message when corrupted image uploaded', async () => { ... });
  it('should retry upload when network fails temporarily', async () => { ... });
});

// ❌ BAD: Vague, implementation-focused
describe('Upload Tests', () => {
  it('test1', async () => { ... }); // What does this test?
  it('should call extractColors()', async () => { ... }); // Tests implementation, not behavior
});
```

**Comment Requirements:**

- **Complex Setup:** Explain WHY data is structured a certain way
- **Timing Workarounds:** Document WHY a specific wait is needed (link to issue)
- **Flaky Test Fixes:** Document what was flaky and how fix addresses root cause
- **No Comments Needed:** Happy path tests with obvious intent

**Runbook for Reproducing Failures Locally:**

```markdown
## Reproducing CI Failures Locally

### Prerequisites

- Docker Desktop running (for Testcontainers)
- Node 20+, npm 10+
- Supabase CLI: `npx supabase start`

### Steps

1. **Checkout failing branch:**
   git checkout <branch-name>
   git pull origin <branch-name>

2. **Install dependencies:**
   npm install

3. **Start local services:**
   docker-compose up -d
   npx supabase start
   npm run db:seed

4. **Run failing test:**
   npx playwright test <test-file> --headed --debug

   # Or for specific test:

   npx playwright test --grep "should extract color palette"

5. **Inspect trace (if test fails):**
   npx playwright show-report
   # Click on failed test → View Trace

### Common Issues

- **"Timeout waiting for Supabase":** Ensure `npx supabase status` shows all services healthy
- **"Database connection error":** Check `DATABASE_URL` in `.env.test`
- **"Flaky test passes locally":** Run 10x: `npx playwright test <test-file> --repeat-each=10`
```

### Test Metrics & KPIs

**Coverage Thresholds (Enforced in CI):**

| Package / Level                             | Line Coverage              | Branch Coverage | Function Coverage | Blocking?                        |
| ------------------------------------------- | -------------------------- | --------------- | ----------------- | -------------------------------- |
| **Unit Tests**                              | 80%                        | 75%             | 85%               | ✅ Yes (blocks merge)            |
| **Integration Tests**                       | 70%                        | 65%             | 75%               | ✅ Yes                           |
| **E2E Tests**                               | N/A (not measured by line) | N/A             | N/A               | ❌ No (journey coverage instead) |
| **Critical Packages** (auth, RLS, payments) | 90%                        | 85%             | 90%               | ✅ Yes                           |

**Flakiness Rate SLA:**

- **Target:** <5% flake rate across all tests
- **Measurement:** Track last 100 runs per test; flag if >5 failures
- **Enforcement:** Flaky tests quarantined; don't block CI but require fix within 5 days

**Test Execution Time Budgets:**

| Test Level      | Per-Test Target | Suite Target                    | Current (Baseline TBD) | Alert Threshold |
| --------------- | --------------- | ------------------------------- | ---------------------- | --------------- |
| **Unit**        | <1s             | <5 min (all unit tests)         | TBD                    | >10 min         |
| **Integration** | <10s            | <15 min (all integration tests) | TBD                    | >25 min         |
| **E2E**         | <1.5 min        | <20 min (@p0 + @p1)             | TBD                    | >30 min         |
| **Load (k6)**   | N/A             | <10 min (all scenarios)         | TBD                    | >15 min         |

**Test-to-Code Ratio:**

- **Target:** 1:1.2 (test code : production code)
- **Measurement:** `cloc src/ __tests__/ --json`
- **Rationale:** Ensures adequate test coverage without over-testing

---

## Recommendations for Sprint 0

### Critical Path (Must Complete Before Gate Review)

**Architecture & Environment Setup:**

1. **Document ADRs:** Create missing Architecture Decision Records in `docs/architecture/decisions/` for all 8 patterns documented in ADR mapping table
2. **Stand Up Test Environments:** Provision Supabase test project, weather provider harness, BullMQ/Redis sandbox, and media pipeline lab per Test Environment Requirements section
3. **Configure Environment Promotion:** Implement environment promotion pipeline (Local → CI → Dev → Staging → Prod) with documented promotion criteria
4. **Secrets Management:** Configure Doppler integration with per-environment testing strategy; implement pre-commit hooks for secret scanning

**Test Data & Fixtures (BLOCKERS):** 5. **Build Fixture Factories:** Implement factory pattern for all core entities (User, WardrobeItem, Ritual, Weather) using `fixture-architecture` knowledge fragment 6. **Seed Data Creation:** Create Prisma seed scripts with coverage per Seed Data Coverage table (5 teens, 3 guardians, 50 wardrobe items, etc.) 7. **Weather API Stub:** Implement `IWeatherProvider` adapter pattern with stub implementation for deterministic E2E tests 8. **Cleanup Discipline:** Establish cleanup patterns in test templates; enforce in code review checklist

**Test Framework Scaffold:** 9. **Run `*framework` Workflow:** Initialize Playwright + Vitest + Maestro with configurations per Playwright Configuration section (no hard waits enforcement, trace retention, etc.) 10. **Implement Smoke Suites:** Create @p0 smoke tests for guardian consent, ritual creation, wardrobe upload; tag for selective execution 11. **Network-First Safeguards:** Implement intercept-before-navigate workflow and HAR capture per `network-first` knowledge fragment 12. **Selector Resilience:** Standardize data-testid usage across React/Expo components per `selector-resilience` fragment

**CI/CD Pipeline:** 13. **Run `*ci` Workflow:** Scaffold multi-stage pipeline per CI/CD Pipeline Architecture section (Smoke → Unit+Integration → E2E → Burn-In → Load) 14. **Burn-In Configuration:** Configure 3x repeat for @p0 tests; implement flaky test quarantine process 15. **Artifact Retention:** Set up S3 bucket with lifecycle policies per Artifact Retention policy (7d/30d/14d retention) 16. **Failure Triage Setup:** Configure Slack alerts (#test-failures, #flaky-tests) and PagerDuty integration per Failure Triage table

**Observability & Monitoring:** 17. **Grafana Dashboards:** Wire dashboards for queue depth, cache hit rate, Socket.io disconnects with alert thresholds matching PRD SLA/SLO 18. **Performance Baselines:** Run baseline measurement suite for all metrics in Performance Baselines table; document TBD values 19. **Sentry Integration:** Configure test vs production Sentry projects; implement error tracking test strategy 20. **PostHog Test Project:** Set up PostHog test project for analytics validation in E2E tests

### High Priority (Sprint 0 or Early Sprint 1)

**Cross-Cutting Concerns:** 21. **Accessibility Setup:** Integrate axe-core with Playwright; configure critical violation blocking in CI 22. **i18n Testing:** Implement locale snapshot tests; add translation pipeline linting to CI 23. **Contract Testing:** Decide Pact vs schema validation for NestJS ↔ Next.js BFF boundary (R-004 mitigation); implement file-based pacts if proceeding

**Security & Compliance:** 24. **RLS Policy Tests:** Implement comprehensive RLS test suite per Policy Test Coverage Metrics table (target: 95%+ coverage) 25. **Audit Log Immutability:** Create PostgreSQL triggers to enforce immutability; write integration tests per Immutability Test Strategy 26. **GDPR Test Scenarios:** Implement Right to Erasure and Consent Withdrawal tests (P0 priority)

**Mobile Testing:** 27. **Device Matrix:** Configure Maestro with iOS Simulator (iPhone 14) and Android Emulator (Pixel 6) for CI smoke tests 28. **Offline Testing:** Implement airplane mode and slow 3G scenarios per Offline & Low-Bandwidth Testing table

**Load & Performance:** 29. **k6 Scenarios:** Create `morning-ritual-rush.js` and `weather-alert-storm.js` load test scenarios per Load Profile Modeling 30. **Resource Utilization Tests:** Implement database connection pooling, Redis memory, and BullMQ concurrency tests per Resource Utilization Testing table

### Medium Priority (Can Defer to Sprint 1)

31. **Email Testing:** Set up Mailhog for local/CI; implement magic link extraction and alert email regression tests
32. **Feature Flag Testing:** Implement LaunchDarkly offline mode for tests; add fallback behavior validation
33. **App Update Scenarios:** Create force update and data migration tests for mobile apps
34. **Visual Regression:** Consider Playwright visual comparison for critical UI components (optional)

### Process & Team Alignment

35. **Test Ownership:** Assign roles per Test Ownership Model table; communicate coverage goals to teams
36. **Code Review Checklist:** Add Test Code Review Checklist to PR template; train team on standards
37. **Runbook Documentation:** Document "Reproducing CI Failures Locally" runbook in project wiki
38. **Metrics Dashboard:** Set up test metrics tracking (coverage, flakiness rate, execution time) with weekly reviews

---

## Next Steps

1. **Architecture Review:** Winston and product team review ADR → Test Mapping; finalize missing ADRs before gate
2. **Test Strategy Approval:** Present this comprehensive test design document to stakeholders; get sign-off on Sprint 0 priorities
3. **Mitigation Evidence:** Complete mitigations for R-001 (guardian consent/RLS), R-002 (weather latency), R-003 (wardrobe pipeline), R-005 (moderation SLA) per Critical Path recommendations
4. **Gap Closure Verification:** Cross-check that all 12 gap categories identified in party-mode review are addressed by Sprint 0 recommendations
5. **Solutioning Gate Check:** Once Critical Path items (1-20) are complete, proceed to `*workflow-status` + `*solutioning-gate-check` with documented evidence
6. **Implementation Kickoff:** Queue `*framework` and `*ci` workflows to scaffold test automation aligned with this strategy

---

## Document Change History

| Date       | Version | Author                                       | Changes                                                                                                                                                                                                                                                                      |
| ---------- | ------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-11-13 | 1.0     | BMad-user                                    | Initial draft - Testability assessment, ASRs, test levels, NFR approach                                                                                                                                                                                                      |
| 2025-11-13 | 2.0     | Winston (Architect) + Murat (Test Architect) | Comprehensive gap analysis and remediation: Added ADR mapping, deployment strategy, cross-cutting concerns, external dependencies, mobile testing, performance architecture, test data management, flakiness prevention, CI/CD pipeline, compliance testing, team guidelines |

---

**Status:** Draft v2.0 - Ready for Stakeholder Review and Sprint 0 Planning

**Reviewers:** Architecture Team, Product Management, Platform Engineering, Test Engineering

**Approval Required From:** Tech Lead, Product Owner, Test Architect (Murat)

**Gate Criteria:** All high-risk ASRs (score >=6) mitigated; Critical Path items 1-20 completed; Architecture and test strategy alignment confirmed

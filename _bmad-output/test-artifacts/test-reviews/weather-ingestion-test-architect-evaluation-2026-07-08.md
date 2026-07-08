# Weather ingestion Test Architect evaluation

Updated: 2026-07-08 - Story 1.1 Task 8 evaluation for E2E, contract,
and performance coverage.

## Scope

Story 1.1 implements backend weather ingestion, persistence, latest-weather
API publication, operational telemetry, and worker scheduling. There is no
user-facing weather UI in this story.

## Evidence reviewed

- Provider adapter tests for OpenWeather and WeatherAPI fixture success,
  validation, failures, and network blocking.
- Orchestration tests for retry/failover, rate-limit failover, secondary
  fallback, abort handling, and telemetry privacy.
- Freshness tests for `fresh`, `cached`, `stale`, and `unavailable`, including
  the exact 60-minute boundary.
- Scheduler and processor tests for `upsertJobScheduler`, interval-bucketed job
  IDs, duplicate target coalescing, and location job processing.
- API integration tests for transactional persistence, duplicate provider
  update idempotency, latest-location reads, auth, and shared latest-weather
  response validation.
- OpenAPI generation, Optic lint, Optic diff, API-client tests, API tests,
  lint, typecheck, and build gates.

## Current guidance cross-check

- Playwright API testing guidance supports direct backend API validation and
  using API requests to set preconditions or verify server state. Because Story
  1.1 has no weather UI, API/integration coverage is the correct primary level.
- Pact guidance frames consumer-driven contracts as valuable when consumer code
  defines expectations against a provider and provider verification protects
  independent release flows. Story 1.1 has a canonical OpenAPI/SDK contract and
  no committed web/mobile weather consumer yet, so Pact would be premature
  duplication for this story.
- k6 guidance uses thresholds as pass/fail quality gates for load and
  reliability goals. A weather ingestion k6 scenario is useful once deployment
  target, target count, quota budget, and SLOs are finalized, but it is not
  required to prove this backend story.

## Decision

- E2E: defer. No user-facing weather flow exists in Story 1.1. Add Playwright
  E2E when mobile/web surfaces consume `GET /api/v1/weather/{locationKey}` and
  display freshness/fallback states.
- Contract: satisfied for Story 1.1. Canonical Zod/OpenAPI schemas, generated
  SDK, OpenAPI parity tests, and Optic diff cover the provider-owned REST
  contract. Add Pact only when an independently versioned consumer needs
  consumer-driven guarantees.
- Performance: defer with planned k6 target. Current story has bounded provider
  retries, worker concurrency, provider-call budgeting, and Grafana error-rate
  alerting. Add k6 once target count and SLO thresholds are agreed for deployed
  worker load.

## Recommended follow-ups

- Story 1.2 or first UI consumer: add Playwright API/UI E2E for fresh, stale,
  unavailable, and cached messaging once a user-facing weather card exists.
- Story 1.2 or SDK consumer adoption: add consumer-driven contract tests only
  if web/mobile release independently from the API and need Pact-style provider
  verification.
- Story 1.4 or performance hardening: add a k6 weather ingestion scenario that
  models configured target count, 30-minute cadence burst, provider failure
  mix, and thresholds for worker completion latency plus provider error rate.

## Gate recommendation

PASS for Story 1.1 testing scope. The remaining E2E, Pact, and k6 work is
appropriately deferred to consumer UI, independent-release, or performance
hardening stories.

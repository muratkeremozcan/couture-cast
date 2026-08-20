---
title: 'Deferred backlog wave 1 — API runtime defects'
type: 'bugfix'
created: '2026-08-20'
status: 'in-review'
baseline_commit: '08112aa671847cac854eb4b6b9a4ba000139126e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Three defects in the deployed API runtime, all recorded in the deferred-work ledger and all invisible locally. `apps/api/api/index.ts` is the only bootstrap Vercel ever runs, and it installs none of the `ApiExceptionFilter`, CORS, request-context binding, or request logging that `src/main.ts` installs, so `api_error_occurred` telemetry has never been emitted outside a developer's laptop. `PremiumThemeService.setTheme` answers 500 when its upsert hits `PremiumThemePreference_user_id_fkey`. And five `@Cron` consumers still sit on `ScheduleModule` in a serverless function that has no long-lived process, so none of them has ever provably fired in production.

**Approach:** Extract the shared bootstrap wiring `src/main.ts` performs into one function both entrypoints call, so the deployed path cannot drift from the local one again. Catch Prisma `P2003` in `setTheme` and map it onto the `NotFoundException` shape the other commerce writes already use. Re-host the five periodic sweeps onto BullMQ Job Schedulers in the worker runtime, following the substrate story 5.2 established for billing reconciliation and commerce retention.

## Boundaries & Constraints

**Always:**

- One `configureApp(app)` helper is the single owner of filter/CORS/context/logger wiring; both `src/main.ts` and `api/index.ts` call it and neither re-implements any part.
- `rawBody: true` stays set on every `NestFactory.create` call — the webhook HMAC depends on it.
- Job Schedulers are registered by the worker bootstrap only, never by the request app, and every sweep keeps its existing cadence and its existing log event name.
- `FeatureFlagsCron.onModuleInit` startup warmup stays in the request app. Only the periodic `@Cron` refresh moves; the warmup is what makes the first requests after a cold start correct.
- A sweep's business logic stays in its owning service. The migration moves the trigger, never the behaviour.

**Ask First:**

- Any change to a sweep's cadence, or to `TELEMETRY_EXCLUDED_ROUTES`.
- Removing `ScheduleModule.forRoot()` from `app.module.ts` if some non-`@Cron` consumer turns out to depend on it.

**Never:**

- Do not add a Vercel `crons` config. The worker runtime is the agreed substrate (ADR-012, story 5.2 Decision 4a).
- Do not change any error response body shape. Nest's built-in filter already produces the same `{ statusCode, message, error }` envelope, so the fix must be observable in telemetry only.
- Do not touch the `premium-theme` contract, the OpenAPI document, or the generated SDK in this wave.

## I/O & Edge-Case Matrix

| Scenario                                | Input / State                                                  | Expected Output / Behavior                                                                             | Error Handling                                    |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Deployed request raises HttpException   | Request to any non-excluded route through `api/index.ts`       | Same `{ statusCode, message, error }` body as before, plus one `api_error_occurred` TelemetryEvent row | Telemetry failure must not alter the response     |
| Deployed request to an excluded webhook | POST `/api/v1/commerce/affiliate/webhook` with a bad signature | Response unchanged, no TelemetryEvent row written                                                      | Webhook service logs the rejection                |
| Cross-origin browser request in preview | Origin in `HTTP_CORS_ORIGIN`                                   | CORS headers present with credentials allowed                                                          | Origin absent from list → no CORS headers         |
| PUT theme while the User row is erased  | `setTheme` upsert raises Prisma `P2003`                        | 404 with a not-found message, no row written                                                           | Any other Prisma code keeps propagating unchanged |
| PUT theme, normal path                  | Entitled caller, flag on                                       | Unchanged: upsert then resolved `PremiumTheme`                                                         | Unchanged                                         |
| Worker starts                           | Redis reachable                                                | Five Job Schedulers upserted on the `maintenance` queue, idempotent across restarts                    | Registration failure fails worker startup loudly  |
| Sweep job runs                          | Scheduler fires `telemetry-event-prune`                        | `TelemetryService.pruneOldTelemetryEvents()` runs, logs `Pruned old telemetry events`                  | Existing per-service try/catch retained           |

</frozen-after-approval>

## Code Map

- `apps/api/api/index.ts` -- the deployed bootstrap; `vercel.json` maps `functions: { "api/index.ts" }` and rewrites `/(.*)` to `/api/index`. Currently `NestFactory.create` + `app.init()` and nothing else.
- `apps/api/src/main.ts:64-96` -- the local bootstrap that installs CORS from `HTTP_CORS_ORIGIN`/`GUARDIAN_INVITE_WEB_BASE_URL`, `bindRequestContext`, `createRequestLoggerMiddleware()`, and `new ApiExceptionFilter(adapterHost, telemetryService)`. This block is what gets extracted. Its OTEL init and `configureOpenApi` stay behind — OTEL must run before Nest imports and the serverless path has its own reasons not to publish docs.
- `apps/api/src/filters/api-exception.filter.ts` -- constructor is `(HttpAdapterHost, TelemetryService)`; `TELEMETRY_EXCLUDED_ROUTES` holds the three unauthenticated webhooks.
- `apps/api/src/modules/commerce/premium-theme.service.ts:123-146` -- `setTheme`; the `upsert` is the P2003 site. `isEnumConversionError` at the top of the file is the precedent for a narrow Prisma-code guard.
- `apps/api/src/modules/commerce/affiliate-click.service.ts:137` and `stripe-billing.service.ts:117` -- the `NotFoundException` convention to match; messages are exported constants in `packages/api-client/src/contracts/http/{commerce,subscription}.ts`.
- `apps/api/src/config/queues.ts:20-25,46-77` -- `QueueName` union and `queueConfigs`; the new `maintenance` queue is added here.
- `apps/api/src/modules/commerce/billing-reconciliation.scheduler.ts` -- the exact Job Scheduler registration pattern to copy: exported job-name constants, exported cadence constants, one `registerXSchedulers(queue)` taking `Pick<Queue, 'upsertJobScheduler'>`.
- `apps/api/src/workers/bootstrap.ts:60-80,140-205` -- queue lookup + null check, scheduler registration, then one `createWorker(queueName, handler, defaultWorkerOptions(n))` dispatching on `job.name`. The billing worker at :186-205 is the dispatch shape to copy.
- Sweep sources (decorator removed, method kept): `apps/api/src/admin/admin.cron.ts:16` (`pruneFailedJobs(30)`, daily 03:00), `apps/api/src/modules/feature-flags/feature-flags.cron.ts:31` (`syncFlags()`, every 5 min), `apps/api/src/modules/guardian/guardian.cron.ts:26` (`emancipateEligibleTeens()`, `5 0 * * *` UTC), `apps/api/src/modules/wardrobe/wardrobe-retention.service.ts:81` (`purgeExpiredAndDeletedGarments()`, hourly), `apps/api/src/modules/telemetry/telemetry.service.ts:755` (`pruneOldTelemetryEvents()`, hourly).
- `apps/api/src/app.module.ts:2,32,51` -- `ScheduleModule.forRoot()` and the `AdminCron` provider registration; `feature-flags.module.ts:11` and `guardian.module.ts:13` register the other two.

## Tasks & Acceptance

**Execution:**

- [x] `apps/api/src/bootstrap/configure-app.ts` -- new file exporting `configureApp(app, deps)` that installs CORS, `bindRequestContext`, the request logger, and `ApiExceptionFilter` -- one owner so the deployed and local paths cannot drift again.
- [x] `apps/api/src/main.ts` -- replace the inlined wiring block with a `configureApp` call, leaving OTEL init and `configureOpenApi` in place -- proves the extraction is behaviour-preserving locally.
- [x] `apps/api/api/index.ts` -- call `configureApp` before `app.init()` -- this is the fix; it is what makes `api_error_occurred` fire in preview and production.
- [x] `apps/api/src/bootstrap/configure-app.spec.ts` -- assert all four wirings are applied, and that the filter is constructed with the resolved `HttpAdapterHost`/`TelemetryService` -- the regression guard against a future entrypoint skipping one.
- [x] `apps/api/src/modules/commerce/premium-theme.service.ts` -- add an `isForeignKeyViolation` guard alongside `isEnumConversionError` and wrap the `setTheme` upsert so P2003 raises `NotFoundException` -- matches the commerce not-found convention.
- [x] `packages/api-client/src/contracts/http/premium-theme.ts` -- export the not-found message constant used above -- keeps the string out of the service body like every other commerce message.
- [x] `apps/api/src/modules/commerce/premium-theme.service.spec.ts` -- cover P2003 → 404 and "any other Prisma code still propagates" -- pins the narrowness of the guard.
- [x] `apps/api/src/config/queues.ts` -- add `maintenance` to `QueueName` and `queueConfigs` -- the substrate for the five sweeps.
- [x] `apps/api/src/workers/maintenance.scheduler.ts` -- new file: five job-name constants, five cadence constants, `registerMaintenanceSchedulers(queue)` -- mirrors `billing-reconciliation.scheduler.ts`.
- [x] `apps/api/src/workers/maintenance.processor.ts` + spec -- dispatch one job name to one sweep, log the event names the cron wrappers logged, rethrow for BullMQ -- added during execution; the cron wrappers' logging had to land somewhere and inlining it in `bootstrap.ts` would have left it uncovered.
- [x] `apps/api/src/modules/personalization/ritual-cache.ts` + spec -- extract the SCAN/DEL and key prefix; `WardrobeRetentionService` injects the narrow `RITUAL_CACHE_INVALIDATOR` instead of `RitualService` -- added during execution; the purge could not be composed in the worker while it depended on the whole ritual graph.
- [x] `apps/api/src/modules/feature-flags/feature-flags.warmup.ts` (renamed from `feature-flags.cron.ts`) + five `apps/api/integration/*.spec.ts` provider overrides -- the class has no schedule left, so the name was a lie.
- [x] `apps/api/src/workers/maintenance.scheduler.spec.ts` -- assert every scheduler is upserted with the cadence the `@Cron` expression carried -- the proof the migration preserved timing.
- [x] `apps/api/src/workers/bootstrap.ts` -- construct the five services, register the schedulers, add a `maintenance` worker dispatching on `job.name` -- concurrency 1; these are DB-bound sweeps.
- [x] `apps/api/src/admin/admin.cron.ts`, `apps/api/src/modules/guardian/guardian.cron.ts` -- delete; both are pure `@Cron` wrappers whose logging moves into the worker dispatch -- no behaviour lives in them.
- [x] `apps/api/src/app.module.ts`, `apps/api/src/modules/guardian/guardian.module.ts` -- drop the deleted providers; drop `ScheduleModule.forRoot()` only if no consumer remains -- dead wiring.
- [x] `apps/api/src/modules/feature-flags/feature-flags.cron.ts` -- remove the `@Cron` decorator, keep `onModuleInit` and `syncFeatureFlags` -- the startup warmup is request-path correctness and stays.
- [x] `apps/api/src/modules/wardrobe/wardrobe-retention.service.ts`, `apps/api/src/modules/telemetry/telemetry.service.ts` -- remove the `@Cron` decorators, keep the methods public -- the worker now owns the trigger.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the three items resolved, and correct the `@Cron` entry to name all five consumers -- the ledger listed three.

**Acceptance Criteria:**

- Given a deployed-shape bootstrap built through `api/index.ts`, when any handler throws an `HttpException` on a non-excluded route, then a TelemetryEvent row is written and the response body is byte-identical to what the built-in filter produced before.
- Given the same bootstrap, when a request arrives, then `bindRequestContext` has run so the request logger emits a correlated line.
- Given the worker runtime starts twice against the same Redis, when `registerMaintenanceSchedulers` runs on both, then exactly five Job Schedulers exist — registration is idempotent.
- Given `grep -rn "@Cron" apps/api/src` after the change, when the results are read, then no `@Cron` decorator remains outside comments.
- Given `ScheduleModule` is dropped from `app.module.ts`, when the API boots, then no provider fails to resolve.

## Design Notes

`configureApp` takes the app plus already-resolved dependencies rather than resolving them itself, so the spec file can assert wiring without standing up a container:

```ts
export type ConfigureAppDeps = {
  adapterHost: HttpAdapterHost
  telemetry: TelemetryService
  corsOrigins: string[]
}
export function configureApp(app: INestApplication, deps: ConfigureAppDeps): void
```

The five sweeps share one `maintenance` queue rather than getting one queue each: BullMQ splits jobs across every Worker subscribed to a queue name, so more queues means more connections for no isolation gain when concurrency is 1 anyway. The `billing-reconciliation` queue is deliberately not reused — its worker comment pins it to billing-bound sweeps with RevenueCat rate-limit reasoning that does not apply here.

## Verification

**Commands:**

- `npm run test -w apps/api` -- expected: all pass, including the new `configure-app` and `maintenance.scheduler` specs
- `npm run test -w packages/api-client` -- expected: pass after the new message constant
- `npm run verify:changed` -- expected: typecheck, lint, and changed-workspace tests green
- `grep -rn "@Cron" apps/api/src | grep -v spec` -- expected: comment lines only, no decorators

**Manual checks (if no CLI):**

- Read `apps/api/api/index.ts` and `apps/api/src/main.ts` side by side: both must reach the same wiring through one `configureApp` call, with no duplicated CORS or filter construction.

## Execution Notes

Verified 2026-08-20 against the local stack (PostgreSQL on 127.0.0.1:54322, Redis
on localhost:6379), in the isolated worktree, rebased onto `0525b305`.

- `npx tsc --noEmit` in `apps/api`: clean.
- `npm run lint -w api`: clean.
- `apps/api` unit tier: 128 files, 1610 tests, all passing.
- `apps/api` integration tier: 24 files, 201 passing, 2 pre-existing skips —
  the same counts the ledger recorded before this change, which is what proves
  the new `RITUAL_CACHE_INVALIDATOR` token resolves inside the real `AppModule`.
- Worker started for real (`npx tsx src/workers/bootstrap.ts`). It reported
  `Workers started for queues` including `maintenance`, and
  `feature_flags_sync_completed` fired from a scheduler tick rather than from a
  test double. Reading the queue back off Redis showed exactly five job
  schedulers with the cadences their decorators carried:
  `admin-job-failure-prune 0 3 * * *`, `guardian-emancipation 5 0 * * * tz=UTC`,
  `wardrobe-retention-purge 0 * * * *`, `telemetry-event-prune 0 * * * *`,
  `feature-flags-sync */5 * * * *`.

Not verified here, and worth stating plainly: the `api/index.ts` fix cannot be
exercised locally, because the Vercel function bootstrap is only reached in a
deployed environment. What is verified is that both entrypoints now reach the
same wiring through one call, and that `configure-app.spec.ts` fails if any of
the four is dropped. The first preview deployment carrying this should be checked
for `api_error_occurred` rows appearing on a route that previously produced none.

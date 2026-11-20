---
title: 'Host the wardrobe, My Form and palette processors and the wardrobe maintenance scheduler'
type: 'feature'
ticket: ''
created: '2026-11-19'
status: 'in-progress'
baseline_revision: '6e027e2fd5dbbdb6a39ea717734e5492c15c5f02'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing hosted consumes `color-extraction` (garment colour and tagging), `moderation-review`
(My Form photo), `palette-analysis` (selfie and wardrobe palette) or `maintenance`, so after PR #260 a
member's upload commits and then stays in `processing` forever, and the deletion outbox, staging sweep and
job handoff never run in production. Only `community-worker` runs on Northflank (free project: 0.2 vCPU,
512 MB; larger plans are payment-gated), and the 605 MB FashionCLIP model cannot fit that.

**Approach:** One dedicated hosted wardrobe worker service on Northflank (a second free service) runs the
three upload consumers and a wardrobe-only maintenance worker with its two schedulers, with the same idle
Redis backoff as the community worker. A new `GARMENT_TAGGING_ENGINE=manual` mode skips the model: the
garment reaches `awaiting_tags` with no suggestions and the member chooses the tags, and the web and mobile
UI say so. `fashion-clip` stays selectable by environment.

## Boundaries & Constraints

**Always:** exactly one consumer per queue per Redis (the hosted worker must not start weather, alert
fan-out, billing, community moderation or the general maintenance jobs); concurrency one for each
consumer; manual mode loads no model and imports no onnxruntime or transformers at startup; fixture engines
stay refused outside test environments; the scheduler registers only `wardrobe-retention-purge` and
`wardrobe-deletion-drain`; every new poller or scheduler takes the community worker's idle backoff values
(`drainDelay` 300000, `stalledInterval` 120000, `lockDuration` 30000, `maxStalledCount` 1) and adds no
idle database loop; manual mode copy never shows a spinner that does not end and never mentions
suggestions; all UI strings go through the ten-locale catalogs on web and mobile.

**Never:** paste or type secrets into the Northflank dashboard (the service is duplicated from
`community-worker`, which already carries them); change the community worker, its Dockerfile, its
launcher or the files its input-set hash covers (`.dockerignore`, `apps/api/package.json` dependencies,
the prune script) in a way that changes that hash; build the quantized model in this PR; run local test
suites.

## I/O & Edge-Case Matrix

| Scenario               | Input / State                                     | Expected Output / Behavior                                                          | Error Handling                               |
| ---------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------- |
| Garment, manual engine | committed upload, `GARMENT_TAGGING_ENGINE=manual` | colours extracted, status `awaiting_tags`, suggestions flagged manual               | none                                         |
| Garment, fashion-clip  | engine env set to `fashion-clip`                  | unchanged suggestions flow                                                          | engine failure keeps today's manual fallback |
| My Form and selfie     | committed upload                                  | processed to `ready`                                                                | unchanged                                    |
| Idle service           | no jobs                                           | no Redis command rate above the community worker's                                  | none                                         |
| Scheduler              | hosted service up                                 | purge hourly, deletion drain every 15 minutes, handoff re-enqueue runs inside purge | a failed step does not skip the others       |
| Duplicate consumer     | general bootstrap also running                    | refused by documentation and env guard                                              | startup log names the queues it consumes     |

</frozen-after-approval>

## Code Map

- `apps/api/src/workers/wardrobe.bootstrap.ts` -- starts the three consumers (:168, :204, :252); add the wardrobe-only maintenance worker and scheduler registration behind `WARDROBE_MAINTENANCE_ENABLED=true`, idle backoff options, concurrency one, readiness logs.
- `apps/api/src/workers/maintenance.scheduler.ts`, `maintenance.processor.ts` -- `registerMaintenanceSchedulers` registers all jobs; add a wardrobe-only registration (purge :48, drain :61) and a processor that handles only those two names.
- `apps/api/src/workers/bootstrap.ts:372-421` -- how `WardrobeRetentionService` and the three handoff producers are wired; reuse.
- `apps/api/src/workers/base.worker.ts:60-69`, `apps/api/src/modules/community/community-moderation.worker.ts:55-157` -- default worker options and the community backoff values to reuse.
- `apps/api/src/modules/wardrobe/garment-tagging.engine.ts`, `fashion-clip-tagging.engine.ts`, `wardrobe.bootstrap.ts:40-73` -- engine selection (`fashion-clip` | `fixture`); add `manual`.
- `apps/api/src/modules/wardrobe/wardrobe-color.processor.ts` -- tagging failure path `manual_confirmation_required`; manual mode must reach it without logging an error.
- API contract for suggest-tags (`packages/api-client/src/contracts/http/wardrobe.ts`) and the web and mobile tag-confirmation screens (`apps/web/src/app/wardrobe/page.tsx`, garment tag panel components, `apps/mobile/components/wardrobe/*`) -- the UI learns the mode from the API response, never from env; catalogs `apps/web/src/i18n/locales/*.json`, `apps/mobile/assets/locales/*.json`.
- `apps/api/Dockerfile.community-worker`, `scripts/start-community-worker-production.mjs`, `scripts/prune-community-worker-deps.mjs` -- template for `apps/api/Dockerfile.wardrobe-worker` and a launcher; keep the community files byte for byte.
- `apps/api/integration/community-worker-release-gate.spec.ts`, `scripts/lib/community-screening-input-set.mjs` -- pins to avoid disturbing; `wardrobe.bootstrap.spec.ts:36` asserts which file registers the wardrobe workers.
- `_bmad-output/project-knowledge/deployment-guide.md` (worker sections, lines 640-668, 766-769, 913-935), `moderation-sla-runbook.md` -- docs to update; `_bmad-output/implementation-artifacts/deferred-work.md` and learning path Step 58 follow-ups.

## Tasks & Acceptance

**Execution:**

- [ ] manual engine and processor path -- API, contract, unit tests.
- [ ] web and mobile tag-confirmation copy for manual mode in all ten locales -- no spinner, no suggestion copy; tests.
- [ ] `wardrobe.bootstrap.ts` maintenance worker, wardrobe-only scheduler, idle backoff, concurrency one, readiness log -- specs.
- [ ] `Dockerfile.wardrobe-worker` and launcher (non-root, tini, pinned base, graceful shutdown), image small enough for 512 MB with sharp and Prisma and no model -- spec pinning its text.
- [ ] docs: deployment guide hosted wardrobe worker section (service creation by duplicating `community-worker`, env names, sizing, manual mode, egress notes), runbook line, learning path Step 58 follow-up entry with test cross-links, deferred-work entry for the quantized FashionCLIP follow-up (int8 ONNX, under about 300 MB resident, measured accuracy against the existing tagging eval before it is trusted).

**Acceptance Criteria:**

- Given the hosted service and a committed garment upload, when the worker runs, then the garment reaches `awaiting_tags` and the member can confirm tags to `ready`.
- Given manual mode, when a member opens the tag step on web or mobile, then the screen says the member chooses the tags and shows no spinner and no suggestion text.
- Given an idle service, then its Redis and database command rate stays at the community worker's idle level.
- Given the community worker image inputs, then their hash and the release-gate spec are unchanged.

## Implementation Notes

Decisions made while implementing (2026-11-19). Items marked (R) were changed by the review round
(Plan Change Log 1, `upload-codex-review-23.md`).

1. **How the API tells the client the mode (R4).** Only a `manual` answer carries `mode`. The wire
   schema (`suggestGarmentTagsWireDataSchema`, what the controller validates and OpenAPI publishes)
   is a union: the original suggested shape byte for byte (`mode: 'suggested'` accepted but never
   sent) or `{ mode: 'manual', garmentId }`. The client schema (`suggestGarmentTagsResponseSchema`)
   is that union normalized: a missing `mode` reads as `suggested`, so old tabs and clients keep
   parsing suggested answers and a new client reads an older API. The worker records manual mode as
   `tagging_failure_code = 'TAGGING_MANUAL_MODE'` (no migration; the column already holds state
   codes such as `LEGACY_TAGS_REQUIRED`), and `WardrobeService.suggestGarmentTags` answers 200
   `mode: 'manual'` for an empty snapshot with that code. Every other empty or malformed snapshot
   still answers 503 `TAGGING_INFERENCE_UNAVAILABLE`. OpenAPI and the client were regenerated with
   `npm run generate:http-openapi` and `npm run generate:api-client`; `optic diff` passed 18/18.
   Fixtures: `createSuggestGarmentTagsWireFixture` (no mode), `createSuggestGarmentTagsDataFixture`
   (normalized) and `createManualSuggestGarmentTagsDataFixture`.
2. **Manual engine.** `ManualGarmentTaggingEngine.inferTags` throws `GarmentTaggingManualModeError`;
   `WardrobeColorProcessor` maps it to `TAGGING_MANUAL_MODE` and logs outcome `manual_mode` at info
   (no error, no warning; the spec asserts it).
3. **Heavy-import isolation.** `createTaggingEngine` imports `fashion-clip-tagging.engine.js` with a
   dynamic `import()` only on the `fashion-clip` path. The wardrobe bootstrap's static graph reaches
   no onnxruntime, transformers, TensorFlow or OpenTelemetry SDK package; `wardrobe.bootstrap.spec.ts`
   asserts that with the TypeScript parser, the prune script fails the build if the closure reaches
   a forbidden package, and the launcher self-test fails if a model runtime is in `require.cache`.
4. **Idle backoff values.** BullMQ's `drainDelay` is in seconds. The plan's `300000` is the
   millisecond figure of the community worker's 300 seconds, so the hosted consumers use 300
   (`workers/idle-worker-options.ts`), with `stalledInterval` 120000, `lockDuration` 30000 and
   `maxStalledCount` 1, pinned to the community exports by a spec. The existing consumers dropped
   from concurrency 10 (moderation-review, with its limiter) and 4 (palette) to 1.
5. **Maintenance (R1, R2, R6).** No BullMQ queue or scheduler for wardrobe maintenance on the hosted
   worker. `WardrobeMaintenanceLoop` (`workers/wardrobe-maintenance.ts`), started when
   `WARDROBE_MAINTENANCE_ENABLED=true` after readiness, runs `wardrobe-deletion-drain` every 15
   minutes and `wardrobe-retention-purge` hourly from process timers (jitter, one tick at a time,
   first tick 30 to 180 seconds after start), each behind `SET wardrobe-maintenance:<task> <holder>
NX PX <interval minus margin>`; a failing task logs `wardrobe_retention_purge_failed` or
   `wardrobe_deletion_drain_failed` and the loop goes on; a lock the loop cannot take skips the tick.
   On start the worker removes the two wardrobe schedulers from the shared `maintenance` queue
   (`removeWardrobeMaintenanceSchedulers`) and consumes that queue never. The general bootstrap keeps
   its two wardrobe jobs for development, now behind the same lock (`lockedWardrobeRetention`), and
   refuses to start where `WARDROBE_MAINTENANCE_ENABLED=true`. The first-draft wardrobe-only
   processor and scheduler registration were removed, with their specs. Northflank: one instance and
   a `Recreate` rollout (deployment guide).
6. **Hosted configuration and readiness (R3, R5).** `assertHostedWardrobeConfig`
   (`workers/hosted-wardrobe-config.ts`) is the one check; the launcher loads the compiled module,
   and `startWardrobeWorker({ hosted: true })` asserts it again before anything connects. It refuses
   any `TEST_ENV`, any fixture selector, an engine other than `manual` (the image has no model),
   missing `DATABASE_URL`, `REDIS_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or engine
   selector, and a maintenance flag that is not `true`. The `--drill-child` exemption applies only
   to the exact isolated drill configuration (`ISOLATED_DRILL_ENV`). Hosted start then runs
   bounded one-shot checks (`SELECT 1`, Redis `PING`, a `wardrobe-images` list through
   `SupabaseWardrobeStorageAdapter.checkReadable`, ten seconds each) before any queue or consumer,
   and logs `wardrobe_worker_ready` apart from the `started` line. A hosted canary (upload a garment
   to `awaiting_tags`) is in the deployment guide.
7. **Dockerfile layout and launcher.** `apps/api/Dockerfile.wardrobe-worker` copies the community
   Dockerfile's three stages and pinned base digest, with its own prune script
   (`scripts/prune-wardrobe-worker-deps.mjs`: entries are the compiled wardrobe bootstrap and both
   launchers; forbidden-package guard; 150 MB budget) and launcher
   (`scripts/start-wardrobe-worker-production.mjs`: imports `databaseTlsRefusal` from the community
   launcher, 25 s shutdown deadline, `--self-test` with a start and SIGTERM drill). The bootstrap
   exports `startWardrobeWorker` and `shutdownWardrobeWorker` for the launcher and shuts down within
   20 s.
8. **Community hash (R7, approved by the coordinator).** `scripts/lib/community-screening-input-set.mjs`
   hashes the whole `apps/api/src/workers` directory and the API-client contract, generated models
   and index its graph reaches, so the Code Map's own edits change the community input-set hash by
   construction. No file the community image builds from (Dockerfile, launcher, prune script,
   `.dockerignore`, `apps/api/package.json`, lockfile) changed, and the release-gate spec pins no
   literal hash and is unchanged. The readiness evidence was already stale before this work; the
   community owner regenerates it.
9. **Measurement provenance (R8).** The 66.1 MB and 147 MiB figures are from a macOS arm64 tree
   assembled outside Docker; the Linux image build has not run, and the self-test's 64x64 decode and
   no-service drill do not bound peak memory with job types overlapping. The deployment guide
   requires a constrained Linux build, a representative simultaneous workload and Northflank memory
   metrics before the 512 MB limit is signed off, and a measurement of the whole service's idle Redis
   rate before it is called inside the community worker's budget.
10. **UI (R9).** Web and mobile learn the mode from the response. Until it names the mode (and on an
    error) both show neutral copy: web `pending_desc` and the neutral loading line, mobile
    `pending_title` and `pending_desc` (also the accessibility hint), and mobile moves screen-reader
    focus to the title only after the request settled. Suggestion wording appears only with
    suggestions; manual mode shows `manual_desc` (web description, mobile notice and hint) and, on
    mobile, `manual_title`. The mobile close label is neutral in every state. Keys are in all ten
    catalogs on both platforms; tests hold the response to assert the pending and settled states.
11. **Test changes forced by the review round.** Removed with the code they covered: the wardrobe-only
    processor and scheduler registration specs (their failure-path and restart-idempotence
    assertions now live in the loop specs: a failing purge keeps the loop and still runs the drain,
    and `start()` twice does not double-schedule). Reversed on purpose: the web client test that
    rejected an answer with no mode now asserts it reads as suggested (R4), while an incomplete
    answer still rejects with a `ZodError`. Adjusted: the mobile title assertion (neutral while
    pending), the launcher spec (the configuration module is injected; an unset engine now reads
    "is required"), and the consumer count (three BullMQ consumers). A grep of `playwright/`,
    `scripts/e2e-real-session` and `maestro/` finds nothing to change there; the committed
    `wardrobe-smart-tagging.spec.ts` step parses the response with `suggestGarmentTagsResponseSchema`,
    which now normalizes a missing `mode` to `suggested`, so its assertion holds unchanged.

## Plan Change Log

1. Review (upload-codex-review-23.md on bb2627de), the PR's single round; every finding is addressed in this PR and not re-reviewed. Triggering findings: the one-consumer guard is per process only; the wardrobe consumer would acknowledge foreign maintenance jobs on the shared queue; hosted config can enable fixture moderation; the new suggest-tags `mode` field breaks old tabs and mixed deploys; process start is not readiness; BullMQ delayed-job schedulers keep a 10 s Redis poll, so the idle budget is missed; the community input-set hash changes; the runbook attributes macOS measurements to a Linux image; manual-mode screens can show suggestions while the mode is pending. Amended: Design Notes (round design below). Frozen intent kept in effect: the service still purges hourly and drains deletions every 15 minutes with no foreign job, but through an in-process Redis-locked loop instead of BullMQ schedulers, because that is the only way to meet the community worker's idle Redis rate. The community input-set hash deviation is approved by the coordinator (no gate enforces it; the stale readiness evidence is the community owner's to regenerate).

## Review Triage Log

| Finding                                  | Verdict | Route     | Action                                                                                                                                                               |
| ---------------------------------------- | ------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 queue ownership across processes      | high    | bad_plan  | no shared maintenance queue at all (loop below); Northflank replica 1 and Recreate rollout; Redis locks keep two copies from double-running                          |
| R2 foreign maintenance jobs acknowledged | high    | bad_plan  | the hosted worker consumes no maintenance queue; the loop runs only the two wardrobe tasks; remove the two old schedulers from the shared queue on startup           |
| R3 fixture bypass                        | high    | bad_plan  | launcher and hosted bootstrap reject TEST_ENV and every fixture selector; CI case with TEST_ENV=local; drill exemption limited to the isolated drill configuration   |
| R4 mixed deploy tagging compatibility    | medium  | bad_plan  | suggested responses keep the original wire shape; only manual responses carry `mode: 'manual'`; new client treats a missing mode as suggested; tests both directions |
| R5 readiness                             | medium  | bad_plan  | bounded one-shot DB, Redis, storage and required-config checks before consuming; log `wardrobe_worker_ready` apart from `started`; hosted canary                     |
| R6 Redis idle budget                     | medium  | bad_plan  | in-process timers with a Redis SET NX lock per tick, no BullMQ delayed jobs; measure on the hosted service                                                           |
| R7 community hash                        | medium  | deviation | approved by coordinator; documented                                                                                                                                  |
| R8 provenance of measurements            | medium  | patch     | docs say macOS pruned tree; require constrained Linux build and Northflank metrics under a representative workload before the host limit is signed off               |
| R9 pending-mode UI                       | low     | bad_plan  | neutral localized copy and no focus move until the mode is known; neutral close label; tests hold the manual response                                                |

## Design Notes

Hosting: duplicate `community-worker` in Northflank (free project, second service slot) so runtime secrets
carry over, change the Dockerfile path to `/apps/api/Dockerfile.wardrobe-worker`, set only non-secret
config (`GARMENT_TAGGING_ENGINE=manual`, `WARDROBE_MAINTENANCE_ENABLED=true`, engine selectors) and remove
`COMMUNITY_*` variables. FashionCLIP suggestions return when a larger plan or a quantized model exists, by
changing `GARMENT_TAGGING_ENGINE` and the plan.

Review design (Plan Change Log 1):

- Maintenance loop: `WardrobeMaintenanceLoop` in the hosted worker process, started after readiness. A deletion-drain tick every 15 minutes and a purge tick every hour (purge runs held capture, release, staging sweep and handoff re-enqueue as before), each guarded by `SET wardrobe-maintenance:<task> NX PX <interval - margin>` so a second copy skips the tick; ticks have jitter, run sequentially, and a failing task logs `wardrobe_retention_purge_failed` or the drain equivalent and never stops the loop. No BullMQ queue or scheduler for wardrobe maintenance in the hosted worker; on startup it removes the two old wardrobe schedulers from the shared `maintenance` queue so no stale job reaches a foreign consumer. The general bootstrap keeps registering them for local development only.
- Hosting config: Northflank pod rollout `Recreate`, one instance, documented in the deployment guide with the other service settings.
- Fixture bypass: the launcher and the hosted bootstrap call one `assertHostedWardrobeConfig` that rejects `TEST_ENV`, `GARMENT_TAGGING_ENGINE=fixture`, `SILHOUETTE_MODERATION_ENGINE=fixture`, `PALETTE_ANALYSIS_ENGINE=fixture` and anything but `manual|fashion-clip` and `heuristic`.
- Readiness: required env (DATABASE_URL, REDIS_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, engine selectors) validated before any connection; then bounded `SELECT 1`, Redis `PING`, and a storage bucket read for `wardrobe-images`; only then consumers start and `wardrobe_worker_ready` is logged.
- Contract: `suggested` responses are byte-compatible with the previous version (no `mode`); `manual` adds `mode: 'manual'`; the client schema is a union and normalizes a missing mode to `suggested`.
- UI pending state: web and mobile tag steps show neutral localized loading copy (no AI or Smart Tags wording, no title focus) until the response names the mode; the mobile close label is neutral; tests hold a manual-mode response and assert both pending and settled states.
- Docs: Linux image numbers marked as not measured; require a constrained Linux build and Northflank memory metrics under a simultaneous workload before calling 512 MB enough.

## Verification

**Commands:**

- `tsc --noEmit` in apps/api, apps/web, apps/mobile and packages/api-client, and `eslint --max-warnings=0` on touched files; no test suites locally (owner rule 2026-11-19), CI is the proof.
  </content>

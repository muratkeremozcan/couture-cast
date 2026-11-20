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

Decisions made while implementing (2026-11-19):

1. **How the API tells the client the mode.** `suggestGarmentTagsDataSchema` in
   `packages/api-client/src/contracts/http/wardrobe.ts` is now a `z.discriminatedUnion('mode', ...)`:
   `{ mode: 'suggested', garmentId, analysisVersion, suggestions }` (the old shape plus `mode`) or
   `{ mode: 'manual', garmentId }`. The worker records manual mode on the garment as
   `tagging_failure_code = 'TAGGING_MANUAL_MODE'` (no migration; the column already holds state
   codes such as `LEGACY_TAGS_REQUIRED`), and `WardrobeService.suggestGarmentTags` answers 200
   `mode: 'manual'` for an empty snapshot with that code. Every other empty or malformed snapshot
   still answers 503 `TAGGING_INFERENCE_UNAVAILABLE` (the engine-failure fallback is unchanged).
   OpenAPI regenerated with `npm run generate:http-openapi` and `npm run generate:api-client`;
   `optic diff` against `origin/main` passed 18/18. Contract fixtures gained `mode`, and
   `createManualSuggestGarmentTagsDataFixture` was added. No store build ships yet, so no old client
   meets the new union.
2. **Manual engine.** `ManualGarmentTaggingEngine.inferTags` throws `GarmentTaggingManualModeError`;
   `WardrobeColorProcessor` maps it to `TAGGING_MANUAL_MODE` and logs outcome `manual_mode` at info
   (the processor never logged inference failures as errors; the spec asserts no error or warn).
3. **Heavy-import isolation.** `createTaggingEngine` imports `fashion-clip-tagging.engine.js` with a
   dynamic `import()` only on the `fashion-clip` path. The wardrobe bootstrap's static graph (47
   files) reaches no onnxruntime, transformers, TensorFlow or OpenTelemetry SDK package;
   `wardrobe.bootstrap.spec.ts` asserts that with the TypeScript parser, the prune script fails the
   build if the closure reaches a forbidden package, and the launcher self-test fails if a model
   runtime is in `require.cache` after the manual engine is created.
4. **Idle backoff values.** BullMQ's `drainDelay` is in seconds. The plan's `300000` is the
   millisecond figure of the community worker's 300 seconds, so the hosted consumers use 300
   (`workers/idle-worker-options.ts`), with `stalledInterval` 120000, `lockDuration` 30000 and
   `maxStalledCount` 1. A spec pins them to the community exports. The new module does not import
   `community-moderation.worker.ts`, which would bring the screening graph in. The existing
   consumers dropped from concurrency 10 (moderation-review, with its limiter) and 4 (palette) to 1.
5. **Maintenance worker.** `WARDROBE_MAINTENANCE_ENABLED=true` (only the literal `true`) starts a
   `maintenance` worker with `createWardrobeMaintenanceProcessor`, which routes only
   `wardrobe-retention-purge` and `wardrobe-deletion-drain` and drops and logs any other name
   (`wardrobe_maintenance_foreign_job_dropped`). `registerWardrobeMaintenanceSchedulers` upserts
   those two schedulers under the general worker's ids and patterns (hourly; minutes 7, 22, 37 and
   52). The handoff re-enqueue runs inside the purge, whose steps are already independent. Env
   guard for the duplicate-consumer row: the general bootstrap throws at startup when the flag is
   true (`workers/wardrobe-maintenance.ts`), and the startup log names the consumed queues.
6. **Dockerfile layout and launcher.** `apps/api/Dockerfile.wardrobe-worker` copies the community
   Dockerfile's three stages and pinned base digest. It has its own prune script
   (`scripts/prune-wardrobe-worker-deps.mjs`, entries: the compiled wardrobe bootstrap and both
   launchers, no model manifest, no policies; forbidden-package guard; 150 MB budget) and launcher
   (`scripts/start-wardrobe-worker-production.mjs`: refuses any engine but `manual`, refuses a start
   without `WARDROBE_MAINTENANCE_ENABLED=true`, imports `databaseTlsRefusal` from the community
   launcher, 25 s shutdown deadline, `--self-test` with a start and SIGTERM drill whose child runs
   with maintenance off because it has no Redis). The bootstrap now exports `startWardrobeWorker`
   and `shutdownWardrobeWorker` for the launcher and shuts down within 20 s. A local run on the
   pruned tree: 66.1 MB `node_modules`, self-test and drill passed.
7. **Community hash (plan inconsistency).** `scripts/lib/community-screening-input-set.mjs` hashes
   the whole `apps/api/src/workers` directory, so the Code Map's own edits there change the
   community input-set hash by construction (`node scripts/lib/community-screening-input-set.mjs`
   gave `4406c841...` before this work against `26e38f3f...` in the committed readiness evidence,
   which was already stale). No file the community image builds from (Dockerfile, launcher, prune
   script, `.dockerignore`, `apps/api/package.json`, lockfile) changed, and the release-gate spec
   pins no literal hash and is unchanged.
8. **UI.** Web and mobile learn the mode from the response. The pre-response state uses neutral
   copy (`wardrobe.tagging.loading`, "Loading your garment...") because the mode is not known yet;
   in manual mode the spinner ends and the screen shows `manual_desc` (web description, mobile
   notice and accessibility hint) and, on mobile, `manual_title`. No suggestion text renders, and
   nothing is preselected. Keys were added to all ten catalogs on both platforms; the mobile
   `loading_suggestions` key was replaced by `loading`. The rest of the web tagging modal keeps its
   existing English strings (not in this plan's scope).
9. **Tests changed or added without running them** (owner rule): see the learning path Step 58
   follow-up `Hosted wardrobe workers and manual tagging`. A grep of `playwright/`,
   `scripts/e2e-real-session` and `maestro/` found no spec that reads the suggest-tags response or
   the old loading and title copy, so the test architect has nothing to change there.

## Plan Change Log

## Review Triage Log

## Design Notes

Hosting: duplicate `community-worker` in Northflank (free project, second service slot) so runtime secrets
carry over, change the Dockerfile path to `/apps/api/Dockerfile.wardrobe-worker`, set only non-secret
config (`GARMENT_TAGGING_ENGINE=manual`, `WARDROBE_MAINTENANCE_ENABLED=true`, engine selectors) and remove
`COMMUNITY_*` variables. FashionCLIP suggestions return when a larger plan or a quantized model exists, by
changing `GARMENT_TAGGING_ENGINE` and the plan.

## Verification

**Commands:**

- `tsc --noEmit` in apps/api, apps/web, apps/mobile and packages/api-client, and `eslint --max-warnings=0` on touched files; no test suites locally (owner rule 2026-11-19), CI is the proof.
  </content>

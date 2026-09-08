---
title: 'Story 6.2: Production content-screening readiness'
type: 'feature'
created: '2026-09-07'
status: 'in-progress'
baseline_commit: '18f95595f3419f114629edec0c43ba13c8459e38'
story_key: '6-2-production-content-screening-readiness'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<!-- markdownlint-disable MD013 MD024 MD036 -->

## Story 6.2: Production content-screening readiness

Status: in-progress

**Story key:** `6-2-production-content-screening-readiness`
**Epic:** 6, Community & Moderation Loop, Phase 2
**Baseline commit:** `18f95595`
**Prepared:** 2026-09-07

## Story

As a trust and safety operator,
I want production-grade image and text screening
so that Community Beta can publish safe content without routing every submission to manual review.

Source: `_bmad-output/planning-artifacts/epics.md:484-495`.

## Source contract and scope

| Source requirement                                                                          | Story coverage         |
| ------------------------------------------------------------------------------------------- | ---------------------- |
| ADR-013 image screening in the standalone worker with pinned identity and bounded execution | AC 1, AC 2, AC 5, AC 8 |
| Caption and confirmed alt-text screening for every enabled Community Beta locale            | AC 3, AC 4             |
| Human review for unsafe, uncertain, mismatched, or degraded results                         | AC 2, AC 4, AC 5       |
| Startup, retry, latency, false-positive, false-negative, and degraded-mode proof            | AC 6, AC 7, AC 8, AC 9 |
| Signed model-readiness evidence for the Community Beta gate                                 | AC 10                  |
| Existing post, outbox, audit, consent, erasure, and rollout invariants                      | AC 5, AC 6, AC 10      |

This story builds the screening implementation. Story 6.2b deploys it and closes the model-readiness
signature; the other seven gate signatures stay open after both: moderation staffing, SLA alerts,
privacy, deletion, localization, accessibility, and rollback. Both production rollout controls remain
disabled throughout.

The current ten locale IDs map to seven screening languages:

| Language   | Enabled locale IDs |
| ---------- | ------------------ |
| English    | `en-US`, `en-CA`   |
| Spanish    | `es-419`           |
| French     | `fr-CA`, `fr-FR`   |
| German     | `de-DE`            |
| Italian    | `it-IT`            |
| Portuguese | `pt-BR`, `pt-PT`   |
| Turkish    | `tr-TR`            |

This story owns screening infrastructure and evidence. Story 6.4 consumes the reusable text
screening boundary for comments. Story 6.5 owns `lookbook:new`, Socket.io publication, engagement
notifications, reconnect behavior, and focused deep links. Stories 6.10 through 6.13 own the
moderator console, decisions, SLA automation, and database-enforced immutable history.

## Acceptance Criteria

1. **Pinned, local-only image model and policy identity.** The standalone community moderation
   worker loads the ADR-013 TensorFlow.js NSFW model from the model bundles that ship inside the
   pinned `nsfwjs` package, so the story adds no model download, no model cache directory, and no
   remote model host. A committed manifest pins the model family, the `nsfwjs` version that carries
   it, required file paths, SHA-256 hashes, input dimensions, class names, dependency versions,
   backend, thresholds, and policy version. The
   manifest also pins every TensorFlow.js WASM binary. Runtime inference performs zero network
   access. `engineVersion` identifies the model artifact and policy hash that actually ran. Startup
   rejects a missing file, changed hash, unknown selector, invalid threshold, incompatible runtime,
   unexpected class-name set, or unapproved policy before the BullMQ consumer begins.

2. **Three-way image disposition with fail-closed publication.** The image screener returns
   `pass`, `review`, or `block` plus the five ADR-013 class probabilities (`Drawing`, `Hentai`,
   `Neutral`, `Porn`, `Sexy`, the exact `NSFW_CLASSES` names in `nsfwjs@4.3.0`), policy identity, and
   stable reason codes. The adapter validates the exact class-name set, finite probabilities in `[0,1]`, and
   a configured sum tolerance. It applies the manifest's canonical class names to the model's output
   vector positionally, and asserts the vector length before doing so. Only `pass` can
   contribute to automatic publication. Threshold-boundary results, invalid output, class mismatch,
   and low confidence route to `review`. Unsafe results route to `block`. Both `review` and `block`
   keep the post unpublished and create a moderation event. Missing or unhealthy model
   infrastructure can never produce `pass`.

3. **All enabled locales and both text fields are screened.** Caption and confirmed alt text pass
   through one reusable `CommunityTextScreener`. Its canonical locale map is derived from
   `packages/api-client/src/contracts/http/supported-locales.json`. Versioned term and allow lists
   cover English, Spanish, French, German, Italian, Portuguese, and Turkish. Every dictionary runs
   for every submission so a client-controlled locale cannot bypass another language's terms. That
   all-dictionary rule already exists in `DefaultCommunityModerationEngine.screenText`, which also
   adds `LOCALE_UNSCREENABLE_REASON` for a locale it holds no dictionary for; preserve both behaviors
   rather than rebuilding them. Each
   result retains field provenance, declared locale, observed Unicode scripts, policy version,
   category, severity, and disposition.

4. **Obfuscation and script uncertainty fail closed.** Text normalization covers Unicode NFKC,
   case and diacritic folding, default-ignorable and zero-width characters, common Latin and Cyrillic
   confusables, leetspeak substitutions, repeated characters, internal punctuation, and spaced-letter
   forms. Tests include each family in all applicable languages. Exact allow-list and word-boundary
   rules protect ordinary fashion copy from substring matches. Mixed scripts and unsupported scripts
   route to human review. The implementation performs no probabilistic language detection. Matched
   raw terms stay out of logs, metrics, and generated readiness evidence.

5. **Existing durable workflow semantics survive.** Stored bytes are downloaded, checked against
   their declaration, oriented, decoded, metadata-stripped, re-encoded, and checksum-persisted before
   inference. The post leaves `pending_review` once through the existing guarded transaction. A clean
   text result and clean image result publish the post. A policy refusal flags it. Transient storage
   or inference faults throw for the existing three total BullMQ attempts with exponential backoff.
   Final exhaustion produces `review_failed` and stamps the outbox. Deterministic job IDs, replay
   behavior, consent suspension, withdrawal, erasure, challenge participation, and telemetry
   isolation remain intact. The shared worker foundation continues writing one `JobFailure` record
   on each BullMQ `failed` event, including retryable attempts. Tests assert this per-attempt behavior
   and the final post state separately.

6. **Privacy-safe screening evidence is truthful.** Existing post and moderation-event fields store
   the terminal disposition, stable reason code, and combined model and policy identity. This story
   adds no moderation database column. Detailed bounded scores and per-field categories live in the
   access-controlled evaluation payload and privacy-safe operational metrics. They exclude user IDs,
   signed URLs, image bytes, raw matched terms, and duplicated caption or alt text. Passing, review,
   block, and exhausted-retry branches preserve their current transactional audit and outbox
   guarantees. `LookbookPost.moderation_engine_version` remains truthful and fixture executions
   retain a visible `fixture` marker.

7. **The policy is versioned, hashed, and provably wired.** The image thresholds, text categories,
   severity-to-disposition map, and list provenance live in one versioned policy file that is hashed
   into the engine identity. A deterministic evaluation proves the disposition function itself: no
   class-probability vector reaches `pass` without a confident `Neutral`, every threshold boundary is
   exercised from both sides, and malformed model output routes to `review`. Story 6.2b owns the
   corpus-backed measurements, the statistical release gates, and the signed evidence that consume
   this policy, so this story ships the policy and its wiring proof rather than the release verdict.

8. **Execution is genuinely bounded and measured.** Model work runs in a supervised worker thread or
   child process so a CPU-bound inference cannot defeat the timeout. The controller terminates a
   wedged inference runtime, rejects the active request, and recreates one verified model instance
   after a bounded cooldown. Community model concurrency defaults to one per process and scales by
   adding worker replicas. The deployment owner names the target, CPU architecture, CPU allocation,
   memory limit, and replica topology before performance collection. Two limits apply on that
   production worker size. The absolute ceilings, which exist to bound a pathological run, are cold
   startup within 30 seconds, warm p95 at most 3 seconds, warm p99 at most 5 seconds, termination of
   any single inference by 10 seconds, an unchanged 30-second outer screening ceiling, and peak
   resident memory at or below 512 MiB. Those ceilings are far above what this stack actually costs
   (see "Verified runtime baseline"), so they cannot detect a regression on their own. The release
   run therefore also records the measured warm p95, p99, cold startup, and peak RSS and commits them
   to the manifest as the regression gate, set at three times the measured value. A later run that
   exceeds the committed gate fails even while it stays inside the absolute ceiling. A measured warm
   p95 above 500 ms for a single 224x224 inference is itself a defect signal and must be explained
   before signing. Evidence includes at least 1,000 warm inferences after warmup and records
   hardware, image, runtime, and replica count.

9. **Real paths prove startup, retries, degradation, and publication.** Fast unit and integration
   suites retain explicit fixture and unavailable modes. A separately gated real-model suite verifies
   manifest verification, startup handshake, warmup, safe pass, unsafe flag, low-confidence review,
   timeout termination, crash recovery, retry success, retry exhaustion, truthful persisted identity,
   and resource bounds. A browser journey uploads a safe image, confirms alt text, publishes, waits
   through the real HTTP, storage, outbox, BullMQ, model, and PostgreSQL path, and observes the
   terminal author state. A paired unsafe journey proves the post never appears in another user's
   feed. The restricted journey runs on an isolated access-controlled runner with Playwright trace,
   screenshot, and video capture disabled. Guaranteed teardown deletes uploaded objects and database
   rows. Tests assert non-empty corpora and branch counts so an empty fixture set cannot pass.

10. **Screening identity is truthful and rollout stays closed.** Every persisted engine identity
    names the model artifact and policy hash that actually ran, and a fixture execution keeps its
    visible `fixture` marker so no test run can be mistaken for a real screening. The story emits the
    machine-readable measurements that Story 6.2b's evidence payload consumes, and it emits no
    verdict of its own. Story 6.2b owns the generated artifact, its hash, and the single recorded
    signature. `community_read_enabled` and `community_write_enabled` remain disabled in production
    throughout.

## Implementation decisions

### Decision 1: Keep the architecture-pinned TensorFlow.js version

The implementation uses TensorFlow.js on the server with NSFWJS's five-class MobileNetV2 Mid model.
Pin exact versions in `apps/api/package.json` and `package-lock.json`:

- `nsfwjs@4.3.0`
- `@tensorflow/tfjs-core@4.16.0`
- `@tensorflow/tfjs-converter@4.16.0`
- `@tensorflow/tfjs-backend-wasm@4.16.0`
- `bad-words@4.1.5`
- `buffer@6.0.3`

Architecture ADR-013 pins TensorFlow.js 4.16.0. Keep that version. Any TensorFlow.js version change
requires an architecture amendment and fresh compatibility evidence. Use the WASM backend inside the
supervised inference process. Sharp supplies deterministic decode and resize before tensor creation.
NSFWJS 4.3.0 accepts TensorFlow.js 4.x and has no exact Node engine declaration. NSFWJS 4.4.0 declares
Node 22.13.0, which conflicts with this repository's Node 24 baseline. The five class names come
from the manifest and are applied to the model's output vector in canonical order.

This version set was executed, not assumed. See "Verified runtime baseline" for the probe, its
numbers, and the exact model artifacts it loaded.

Do not install the union `@tensorflow/tfjs` package. It also pulls `tfjs-backend-webgl`,
`tfjs-layers`, and `tfjs-data`, which this worker never uses; with the three model families `nsfwjs`
ships, that is roughly 325 MB of `node_modules`. Installing `tfjs-core`, `tfjs-converter`, and the
WASM backend instead, and pruning the two unused model families, measures 98 MB and produces
identical class probabilities. See "Verified runtime baseline" for both runs side by side. The
smaller tree is what keeps the worker inside a free hosting tier in Story 6.2b.

Three consequences follow from dropping the union package, all found by running it:

- `nsfwjs`'s own `load` imports `@tensorflow/tfjs`, so this story does not call it. Load the bundled
  graph directly with `loadGraphModel` from `@tensorflow/tfjs-converter` and apply the five class
  names from the manifest.
- `@tensorflow/tfjs-core` does not register the chained tensor API. `tensor.toFloat()` and
  `tensor.div()` throw; use `tf.cast`, `tf.div`, and `tf.reshape`, or import the chained-ops
  registration explicitly.
- Reach the model bundles through the exported `nsfwjs/models/mobilenet_v2_mid` subpath. The package's
  `exports` map blocks deep `dist/` paths, so importing one fails with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- `nsfwjs` declares `@tensorflow/tfjs` as a peer dependency, which this story deliberately does not
  install, so npm reports an unmet peer. Record that as an intentional override in
  `package.json` rather than silencing it globally, and keep a test asserting the union package is
  absent, so a later `npm install` cannot quietly triple the image.

Treat the version set as a reviewed compatibility decision. Upgrading any model, runtime package,
backend, class-name set, or threshold creates a new policy identity and requires the full readiness
suite plus fresh signatures. A runtime that misses the latency or memory gate requires an ADR-013
amendment before a different inference technology is introduced.

### Decision 2: Separate model execution from BullMQ orchestration

Add a supervised inference controller and an isolated inference entrypoint. Load the model from the
bundles that ship inside `nsfwjs`, reached through its exported `nsfwjs/models/mobilenet_v2_mid`
subpath: that module exposes `modelJson()` and a `weightBundles` array of base64 strings. Decode the
bundles, concatenate them in `weightsManifest` path order, flatten the weight specs, and pass an
in-memory `tf.io.IOHandler` to `loadGraphModel` from `@tensorflow/tfjs-converter`. This touches no
network, no `file://` handler, and no model directory. Verify the three artifact files against the
manifest with `node:fs` before loading, and fail startup on a hash mismatch; that verification, plus
the `package-lock.json` integrity hash, is the supply-chain control.

The package ships base64 bundles rather than a raw `model.json` with binary shards, so there is
nothing on disk for a filesystem `IOHandler` to read and no upstream download to add.

Call `setWasmPaths(fileMap, false)` before backend selection. The file map contains verified absolute
paths for the vanilla, SIMD, and threaded SIMD WASM binaries resolved out of
`@tensorflow/tfjs-backend-wasm/dist`. The process has no remote URL fallback. The isolated process:

1. verifies the manifest against the installed model bundles and WASM binaries;
2. enables TensorFlow.js production mode;
3. selects and awaits the pinned WASM backend;
4. loads one model instance;
5. performs a warmup classification;
6. validates the five class names and probabilities, then maps them into canonical order;
7. emits one readiness message with the full policy identity;
8. serves one bounded inference at a time; and
9. disposes tensors and the model on shutdown.

Each BullMQ attempt performs one image inference. A crash, timeout, malformed response, or unhealthy
circuit rejects that attempt. The controller terminates the child and permits one bounded respawn
after cooldown for the next BullMQ attempt. BullMQ alone owns the three job attempts. A timed-out
computation must stop consuming CPU before BullMQ retries. The existing `withModerationTimeout`
remains an outer pipeline ceiling. The worker passes `job.attemptsMade + 1` into processor context for
metrics and evidence.

### Decision 3: Make production readiness explicit at process startup

`COMMUNITY_NSFW_SCREENER` accepts `tensorflow`, `fixture`, or `unavailable`.

- Normal production requires `tensorflow`. There is no model-directory variable, because the model
  travels with the pinned dependency.
- `fixture` remains double-gated through `allowsTestOnlySecrets()`.
- `unavailable` in production requires the explicit `COMMUNITY_NSFW_INCIDENT_MODE=unavailable` and a
  non-empty incident reference. It starts queue consumption, returns the deterministic
  `screening_unavailable` refusal, routes submissions to human review, emits a critical signal, and
  performs no futile model retry. The incident runbook covers authorization, restoration, retained
  job replay, and review-queue drain.
- An absent or unknown production selector exits before queue consumption.
- Tests may retain the absent-selector behavior where they explicitly assert the unavailable adapter.

Make the shared community worker runtime asynchronous. Both worker entrypoints await `ensureReady()`
before creating the BullMQ worker and retain its close function. The general worker shutdown must
close the community runtime. Readiness logs include policy identity, backend, startup duration, and
model hash. They exclude local absolute paths in hosted logs.

### Decision 4: Use one reusable text policy boundary

Create `CommunityTextScreener` as a field-aware boundary with `screen({ text, field, locale })`.
Keep locale-to-language mapping, dictionaries, allow lists, severity, obfuscation transforms, and
policy version under `apps/api/policies/community-screening`. Validate each file at startup.
`bad-words` supplies the filtering primitive required by ADR-013. Repository-owned lists supply the
seven-language vocabulary and allow-list policy. Run every language list against bounded canonical
representations of the input. Unicode script inspection is deterministic. This story introduces no
language-detection model.

Bound text length at the existing contract before expansion. Cap generated representations and
matching work so crafted input cannot amplify CPU or memory without limit. Return reason codes and
matched categories. Retain raw matched tokens only in process memory for the current decision, then
discard them.

### Decision 5: Keep the existing moderation persistence boundary

Persist the terminal action, stable reason code, controlled content snapshot, and combined model and
policy identity through the current `LookbookPost` and `ModerationEvent` fields. Story 6.10 owns any
future case-detail projection. Story 6.13 owns database-enforced immutable history. Story 6.2 adds no
database column, public REST endpoint, or generated API-client change.

### Decision 6: Keep fast functional tests separate from real-model evidence

Normal unit, coverage, integration, and Playwright runs use truthful fixture or unavailable modes.
The real model runs only through explicit commands, and Story 6.2b's corpora run only through its own
release workflow. A fixture-backed browser test proves user-visible pipeline wiring. A real-model browser
test is part of the signed evidence run. Every report labels which path produced it.

### Decision 7: Emit measurements, leave the verdict to Story 6.2b

This story's commands emit structured measurements and label the path that produced each one. They
render no verdict and carry no signature, because the gates that a verdict would test are measured in
Story 6.2b against corpora and hosted hardware that do not exist here. Keeping the verdict out of this
story is what stops a green fixture run from reading as a release decision.

## Tasks / Subtasks

- [ ] Task 0: Write the versioned policy file (AC: 1, 2, 7)
  - [ ] Encode the image thresholds, boundary behavior, text categories, severity-to-disposition map,
        and list provenance in one versioned, hashed policy file, with the reasoning for each
        threshold recorded next to it.
  - [ ] Default the policy to conservative: automatic publication requires a confident `Neutral`, and
        every other outcome, uncertainty included, routes to a human.
  - [ ] Do not wait on an external approval. Story 6.2b measures this policy against corpora and
        records the single owner signature.

- [ ] Task 1: Pin the model, text library, policy, and artifact supply chain (AC: 1, 3, 7)
  - [ ] Add the exact ADR-013 dependencies to `apps/api/package.json` through npm and commit the
        generated `package-lock.json` changes.
  - [ ] Add a model manifest naming the `nsfwjs` version that carries the model, the three
        `dist/models/mobilenet_v2_mid` artifact paths and their SHA-256 hashes, the three WASM binary
        paths and hashes, class names, input dimensions, backend, thresholds, and policy identity.
  - [ ] Add one verify command that resolves those paths from the installed package, hashes them,
        compares them to the manifest, and exits nonzero on any mismatch. There is nothing to
        download, extract, or atomically replace.
  - [ ] Assert in test that the inference process opens no socket, and that no model-directory or
        remote-model-host variable exists.
  - [ ] Add environment documentation for the selector and incident variables.

- [ ] Task 2: Implement supervised production image inference (AC: 1, 2, 8)
  - [ ] Add the TensorFlow.js NSFW screener behind the existing `NsfwImageScreener` seam.
  - [ ] Add the isolated inference entrypoint, typed message protocol, readiness handshake, warmup,
        class-name mapping, probability and sum validation, tensor disposal, timeout termination,
        cooldown, respawn, and close.
  - [ ] Add three-way policy evaluation with stable reason codes and a manifest-derived version.
  - [ ] Keep the unavailable and fixture adapters truthful and fail closed.
  - [ ] Set worker concurrency to one per model process unless signed evidence supports a higher
        value within the same memory and latency gates.

- [ ] Task 3: Implement reusable multilingual text screening (AC: 3, 4, 7)
  - [ ] Add `CommunityTextScreener` and versioned dictionaries plus allow lists for all seven enabled
        languages.
  - [ ] Derive locale coverage from the canonical supported-locale JSON and add set-equality tests.
  - [ ] Implement bounded canonical representations for every required obfuscation family.
  - [ ] Preserve field provenance and define stable pass, review, and block reason codes.
  - [ ] Give each list a provenance record naming its source, version, and licence, and fail startup
        when a list is missing one. Story 6.2b vendors the pinned upstream lists that fill it.
  - [ ] Expose the boundary for Story 6.4 without adding comment behavior in this story.

- [ ] Task 4: Wire the combined policy into the durable post pipeline (AC: 2, 5, 6)
  - [ ] Extend result types while preserving the rule that both engine verdicts must explicitly pass.
  - [ ] Keep image validation and metadata removal before inference.
  - [ ] Persist the combined engine and policy version plus stable terminal reason through the
        existing post and moderation-event fields.
  - [ ] Preserve guarded terminal transitions, audit and outbox atomicity, telemetry isolation,
        deterministic job IDs, and retry exhaustion.
  - [ ] Pass `job.attemptsMade + 1` into processor context and add privacy-safe operational metrics
        for readiness, duration, disposition, retries, termination, and model health.

- [ ] Task 5: Harden worker startup, deployment, and shutdown (AC: 1, 5, 8, 10)
  - [ ] Make the process correct locally. The repository deploys no long-running BullMQ consumer at
        all today: `_bmad-output/project-knowledge/deployment-guide.md:302-305` states that no Docker
        image, Vercel function, GitHub workflow, or process manifest starts `start:workers`, and the
        same is true of the wardrobe FashionCLIP worker from Epic 4. Story 6.2b builds and deploys the
        container. This story makes the process it will run correct, and proves it against the local
        Docker Compose stack.
  - [ ] Make runtime construction await model readiness before queue consumption.
  - [ ] Update both bootstraps and retain every close hook during graceful shutdown. This is a live
        defect, not a refactor: `apps/api/src/workers/bootstrap.ts` pushes `community.worker` onto the
        shutdown list but discards `community.close`, so the community moderation queue and its Redis
        connection are never closed on `SIGTERM` in the production worker process.
  - [ ] Add production scripts that verify the model before starting the community-capable worker.
  - [ ] Document the incident-mode authorization, restoration, retained-job replay, and review-queue
        drain procedure. Story 6.2b adds the container image, the hosted target, the canary, and the
        rollback runbook.
  - [ ] Prove the whole worker path against the local Docker Compose Redis and PostgreSQL, including a
        clean `SIGTERM` shutdown, before handing the process to Story 6.2b.

- [ ] Task 6: Add versioned fixtures and local measurement (AC: 4, 7, 8)
  - [ ] Add manifest-backed synthetic safe fixtures to the repository, with non-vacuity,
        duplicate-hash, and manifest-integrity checks.
  - [ ] Measure startup, warm latency, timeout behavior, throughput, and peak RSS on the development
        machine, and commit those numbers as the provisional regression gate that AC 8 requires.
  - [ ] Make every threshold failure return a nonzero exit code.
  - [ ] Leave the licensed corpora, the statistical release gates, and the production-hardware
        measurement to Story 6.2b.

- [ ] Task 7: Expand unit, integration, and lifecycle tests (AC: 1 through 9)
  - [ ] Extend engine tests for all dispositions, classes, fields, languages, obfuscations, allow-list
        cases, and empty-reason fail-closed behavior.
  - [ ] Add inference lifecycle tests for startup failure, hash mismatch, malformed output, crash,
        timeout termination, cooldown, respawn, shutdown, and compiled worker-path resolution.
  - [ ] Extend worker tests for three attempts, eventual success, exhaustion, concurrency,
        per-attempt `JobFailure` rows, final post transition, and truthful identities.
  - [ ] Extend the real PostgreSQL pipeline suite for passing, review, block, timeout, retry, and
        idempotent redelivery. Assert that the suite executed against a migrated database.
  - [ ] Preserve the explicit unavailable-mode degraded test.

- [ ] Task 8: Add end-to-end publication evidence (AC: 5, 9)
  - [ ] Update `scripts/start-api-e2e-with-workers.mjs`, root `package.json`,
        `playwright/tests/community-feed.spec.ts`, and
        `playwright/support/helpers/community-session.ts` for an explicit double-gated real-model
        mode. Caller-selected real mode must survive environment loading.
  - [ ] Extend the web journey to upload bytes, confirm alt text, publish, poll the author state, and
        verify a safe terminal state through the fixture-backed full stack.
  - [ ] Add the separate real-model command that runs the safe journey and paired unsafe
        non-publication journey on an isolated access-controlled runner.
  - [ ] Assert cross-user feed absence, stable localized recovery state, and no raw safety data in
        client responses.
  - [ ] Disable trace, screenshot, and video capture for restricted cases. Guaranteed teardown must
        delete uploaded storage objects and database rows after pass or failure.
  - [ ] Record production dispatch cadence. The one-second local dispatcher is not latency evidence
        for the production one-minute scheduler.

- [ ] Task 9: Emit machine-readable measurements for the release gate (AC: 7, 8, 9)
  - [ ] Emit the local measurements, hashes, environment, and commands as structured JSON that Story
        6.2b's evidence generator consumes without re-deriving them.
  - [ ] Label every report with the path that produced it, so a fixture run can never be read as a
        real-model run.
  - [ ] Keep both production Community flags disabled. Story 6.2b owns the verdict and the
        signature.

- [ ] Task 10: Run all applicable quality gates (AC: 1 through 10)
  - [ ] Run model verify, smoke, evaluation, and real-model end-to-end commands.
  - [ ] Run focused API unit and PostgreSQL integration suites.
  - [ ] Run `npm run verify:changed` and `npm run validate`.
  - [ ] Run `npm audit --omit=dev --audit-level=high` and
        `npm run verify:community-screening-supply-chain --workspace api`. The supply-chain command
        validates dependency SPDX data plus model-weight license and redistribution clearance, then
        emits machine-readable evidence.
  - [ ] Confirm generated REST artifacts have no diff because this story adds no public operation.

## Dev Notes

### Current state of files this story updates

| File or area                                                                   | Current state                                                                                         | Required change                                                                                                      | Preserve                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `community-moderation.engine.ts`                                               | Three text languages and an unavailable image adapter; combined verdict uses explicit `passed` values | Extract reusable text policy, add all languages and dispositions, retain the image seam                              | Empty-reason fail-closed rule, truthful fixture versions          |
| `community-moderation.processor.ts`                                            | 20-second download and 30-second screening Promise races; guarded terminal writes                     | Use supervised model timeout, pass attempt context, persist truthful identity and reason, emit bounded metrics       | Image normalization, transactions, outbox stamp, privacy          |
| `community-moderation.worker.ts`                                               | Three-attempt exhaustion handling; concurrency five                                                   | Use evidence-backed model concurrency and preserve retry taxonomy                                                    | Zod job parsing, final `review_failed`, DLQ listener              |
| `community-worker-runtime.ts`                                                  | Synchronous selection; absent selector returns unavailable; fixture only configured value             | Await real readiness, manage lifecycle, make production configuration explicit                                       | Shared composition across production and E2E, fixture double gate |
| `workers/bootstrap.ts`                                                         | Starts community consumer and maintenance sweeps; drops the runtime close hook                        | Await readiness and close all community resources                                                                    | Existing weather, alert, billing, and maintenance workers         |
| `workers/community.bootstrap.ts`                                               | Narrow E2E process with one-second dispatch interval                                                  | Await readiness and support explicit evidence mode                                                                   | Shared runtime and honest cadence documentation                   |
| `apps/api/package.json` and `package-lock.json`                                | No ADR-013 runtime or model commands                                                                  | Add exact dependencies and canonical prepare, verify, supply-chain, smoke, evidence, and production prestart scripts | Existing workspace preparation and FashionCLIP scripts            |
| `package.json` and `scripts/start-api-e2e-with-workers.mjs`                    | E2E launcher forces fixture screening                                                                 | Add an explicit double-gated real-model command whose selector survives env loading                                  | Fixture default and shared preparation flow                       |
| Community unit and integration specs                                           | Cover fixture, unavailable, and current durable pipeline                                              | Add real adapter lifecycle, policy, attempt, and PostgreSQL branches                                                 | Existing 66-test focused baseline                                 |
| `playwright.config.ts`, `community-feed.spec.ts`, and community session helper | Community journey uses fixture mode and ordinary failure artifacts                                    | Add isolated restricted mode, safe and unsafe journeys, artifact suppression, and complete teardown                  | Existing fixture journey and user-visible assertions              |
| `.env.example`                                                                 | Documents garment model only; `COMMUNITY_NSFW_SCREENER` is undocumented                               | Add selector, incident mode, policy, timeout, and evidence corpus variables; no model directory                      | Neutral placeholders and environment separation                   |
| `deployment-guide.md`                                                          | Describes worker commands and states that no hosted worker target exists                              | Add community model process, canary, readiness, shutdown, incident mode, and rollback runbook                        | Honest statement of deployed versus repository-only evidence      |

### Files expected to be added

- `apps/api/src/modules/community/tensorflow-nsfw-image-screener.ts`
- `apps/api/src/modules/community/tensorflow-nsfw-image-screener.spec.ts`
- `apps/api/src/modules/community/community-nsfw-inference.worker.ts`
- `apps/api/src/modules/community/community-nsfw-inference.lifecycle.spec.ts`
- `apps/api/src/modules/community/community-text-screener.ts`
- `apps/api/src/modules/community/community-text-screener.spec.ts`
- `apps/api/src/modules/community/community-screening-policy.ts`
- `apps/api/src/modules/community/community-screening-policy.spec.ts`
- `apps/api/src/modules/community/community-moderation.telemetry.ts`
- `apps/api/src/modules/community/community-moderation.telemetry.spec.ts`
- `apps/api/policies/community-screening/policy-v1.json`
- `apps/api/policies/community-screening/terms-v1/*.json`
- `apps/api/model-manifests/community-nsfw-*.json`
- `apps/api/src/modules/community/community-content-screening.smoke.spec.ts`
- `apps/api/src/modules/community/community-content-screening.readiness.spec.ts`
- `apps/api/test/fixtures/community-moderation/v1/manifest.json`
- `scripts/verify-community-screening-supply-chain.mjs`
- `_bmad-output/test-artifacts/community-content-screening-measurements.json`

These paths are canonical. Keep runtime code inside the community module, production policy under
`apps/api/policies`, model manifests under `apps/api/model-manifests`, process artifacts at the named
paths, and generated evidence under `_bmad-output/test-artifacts`.

### Architecture compliance

- Use the current package manifests and lockfile as version authority.
- Keep NestJS transport, service, repository, and worker responsibilities separated.
- Validate external model, policy, and measurement data with Zod.
- Use `.js` suffixes for relative imports in the NodeNext API workspace.
- Keep public REST contracts in `@couture/api-client`; this story creates no public operation.
- Keep community and moderation tables unavailable to direct authenticated database clients.
- Store UTC timestamps and emit ISO 8601.
- Keep retries and cleanup idempotent.
- Keep test fixtures synthetic, namespaced, deterministic, and production-safe.
- Keep secrets, restricted imagery, signed URLs, and identifiable wardrobe data out of Git and logs.
- Keep `community_read_enabled` and `community_write_enabled` false in production.

### Regression guardrails from Story 6.1

- Use the existing `NsfwImageScreener` injection seam. Rewriting post orchestration adds needless
  risk.
- Preserve the explicit engine verdict check. A reason array can be empty on refusal.
- Preserve fixture labels in persisted engine identity. Test output cannot claim a real model ran.
- Preserve one shared production and E2E composition factory.
- Preserve deterministic `postId__uploadSessionId` job IDs and seven-day BullMQ retention.
- A genuine re-screen within that retention window removes the retained job or uses a new upload
  session. Re-arming the outbox alone is a silent no-op.
- Preserve `pending_review` conditional updates on every terminal branch.
- Preserve private opaque media paths, metadata stripping, checksums, and API-only RLS.
- Keep current rollout flags off. Model readiness authorizes one gate signature.
- Treat the Story 6.1 note assigning realtime publication to Story 6.2 as stale. The 2026-09-06
  re-slice assigns that work to Story 6.5.

### Testing requirements

Baseline captured during story preparation:

```text
npm run test --workspace api -- \
  src/modules/community/community-moderation.engine.spec.ts \
  src/modules/community/fixture-nsfw-image-screener.spec.ts \
  src/modules/community/community-worker-runtime.spec.ts \
  src/modules/community/community-moderation.worker.spec.ts

Result: 4 files passed, 66 tests passed.
```

Required focused commands after implementation:

```bash
npm run verify:community-screening-model --workspace api
npm run verify:community-screening-supply-chain --workspace api
npm run test:community-screening-model:smoke --workspace api
npm run test:community-screening-readiness --workspace api
npm run test:integration --workspace api -- \
  integration/community-moderation-pipeline.integration.spec.ts
npm run test:community-screening:e2e
npm audit --omit=dev --audit-level=high
npm run verify:changed
npm run validate
npm ls nsfwjs @tensorflow/tfjs-core @tensorflow/tfjs-converter @tensorflow/tfjs-backend-wasm bad-words --all
```

These script names are canonical. Record every final command in the readiness payload. The PostgreSQL
suite must report executed cases. A skipped integration suite supplies no release evidence.

### Verified runtime baseline

The pinned stack was executed during story review rather than inferred from documentation. Both
candidate TensorFlow.js lines were run on this repository's Node baseline, in a throwaway install
outside the repository.

| Measurement                          | Union `tfjs@4.16.0` | Union `tfjs@4.22.0` | **Slim `tfjs-core@4.16.0`** |
| ------------------------------------ | ------------------- | ------------------- | --------------------------- |
| Installed `node_modules`             | 325 MB              | 325 MB              | **98 MB**                   |
| Backend selected                     | `wasm`              | `wasm`              | `wasm`                      |
| `setBackend` + `ready`               | 3 ms                | 3 ms                | 3 ms                        |
| Graph model load                     | under 200 ms        | 125 ms              | 11 ms                       |
| Warm p50 / p95 over 30 inferences    | 21 / 24 ms          | 21 / 22 ms          | 24 / 26 ms                  |
| Peak RSS                             | 223 MiB             | 232 MiB             | 205 MiB                     |
| Probabilities on the reference input | `Neutral` 0.9063    | `Neutral` 0.9063    | `Neutral` 0.9063            |

Environment: Node v24.20.0, macOS on Apple Silicon, `nsfwjs@4.3.0`, WASM backend,
`setWasmPaths(fileMap, false)` with absolute paths, input built as
`tf.tensor3d(uint8, [224, 224, 3], 'int32')` in place of Sharp's raw output. The slim column also had
the two unused NSFWJS model families pruned. Full probability vector, identical across all three:
`Drawing` 0.0484, `Hentai` 0.0421, `Neutral` 0.9063, `Porn` 0.0015, `Sexy` 0.0016.

What this establishes:

- The pinned 4.16.0 line and the current 4.22.0 line both run on Node 24 and produce identical
  probabilities, so the architecture's 4.16.0 pin costs nothing measurable here.
- The slim dependency set produces identical probabilities at a third of the install size, which is
  what makes free hosting reachable in Story 6.2b.
- The model loads with no network access, because the artifacts ship inside the package.
- The measured artifact hashes for `nsfwjs@4.3.0`, for the manifest AC 1 requires:

```text
a7a9e701491e2449b221dab7c424957f853e700602b5575da33cfd745616f964  nsfwjs/dist/models/mobilenet_v2_mid/model.min.js
f2e79a209e44d668220ec5f1533a98f2be954e3953685bf074d201b82fefc29a  nsfwjs/dist/models/mobilenet_v2_mid/group1-shard1of2.min.js
f291df992a0131741372506a6072fb9f1645bff7c973c983fd6276f5f9625d5e  nsfwjs/dist/models/mobilenet_v2_mid/group1-shard2of2.min.js
```

Re-verify these hashes at implementation time against the version actually installed, and treat any
difference as a supply-chain event rather than a transcription error.

Two cautions. These numbers come from a developer laptop, so they are a sanity floor and not the
release evidence: the production worker will be slower, and AC 8 still requires the real measurement
on the named target. And a single-image probe says nothing about accuracy; only the corpus run in
AC 7 does.

### Latest technical information

- NSFWJS 4.4.0 is the latest release as of 2026-09-07, and `npm view nsfwjs@4.4.0 engines` returns
  `{ node: '22.13.0', npm: '>=10 <12' }`, which an `npm install` on this repository's Node 24
  baseline rejects. `npm view nsfwjs@4.3.0 engines` returns nothing, and both releases declare the
  same peer dependencies, `@tensorflow/tfjs@^4.0.0` and `buffer@^6.0.3`. Source:
  <https://github.com/infinitered/nsfwjs/releases>.
- NSFWJS ships the model weights inside the npm package, under
  `dist/models/{mobilenet_v2,mobilenet_v2_mid,inception_v3}` as base64 bundles rather than as a
  `model.json` with binary shards, so they load through an in-memory `IOHandler` rather than from
  disk. The three families total about 38 MB installed, of which
  `mobilenet_v2_mid` is 5.6 MB. This is why the story has no model download. Source:
  <https://github.com/infinitered/nsfwjs>.
- The class names are fixed by `NSFW_CLASSES` in the package: `Drawing`, `Hentai`, `Neutral`, `Porn`,
  `Sexy`. Source: `nsfwjs/dist/esm/nsfw_classes.js`.
- TensorFlow.js 4.22.0 is the latest stable line. Architecture pins 4.16.0 for this repository, so
  this story keeps 4.16.0. An open upstream issue reports a Node 24 failure in the native
  `@tensorflow/tfjs-node@4.22.0` package. Source: <https://github.com/tensorflow/tfjs/issues/8609>.
- `bad-words@4.1.5` is the current stable package as of 2026-09-07. Its default vocabulary is
  insufficient for this story's seven-language promise, so repository-owned reviewed lists remain
  required. Source: <https://www.npmjs.com/package/bad-words>.

### Project structure notes

- Keep all runtime screening code under `apps/api/src/modules/community`.
- Keep approved production policy under `apps/api/policies/community-screening`.
- Keep model manifests under `apps/api/model-manifests` and cache model assets under
  `apps/api/.cache`, which is already ignored.
- Keep restricted evaluation assets outside the repository. Commit their versioned manifest and
  hashes only.
- Keep release evidence under `_bmad-output/test-artifacts`.
- Keep deployment and model operation instructions in the existing project knowledge documents.
- Production component work stays in the API worker. Web changes are limited to E2E selectors or a
  localized recovery-copy defect exposed by the real journey. Mobile production files stay unchanged.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md:469-495`]
- [Source: `_bmad-output/planning-artifacts/epics.md:689-705`]
- [Source: `_bmad-output/planning-artifacts/prd.md:183-190`]
- [Source: `_bmad-output/planning-artifacts/prd.md:221-228`]
- [Source: `_bmad-output/planning-artifacts/prd.md:253-275`]
- [Source: `_bmad-output/planning-artifacts/architecture.md:59-70`]
- [Source: `_bmad-output/planning-artifacts/architecture.md:140-159`]
- [Source: `_bmad-output/planning-artifacts/architecture.md:193-197`]
- [Source: `_bmad-output/planning-artifacts/architecture.md:232-247`]
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:194-214`]
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:288-304`]
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:383-395`]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-06.md:19-52`]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-06.md:120-154`]
- [Source: `_bmad-output/implementation-artifacts/epic-6-context.md:14-19`]
- [Source: `_bmad-output/implementation-artifacts/epic-6-context.md:50-79`]
- [Source: `_bmad-output/implementation-artifacts/epic-6-context.md:119-133`]
- [Source: `_bmad-output/implementation-artifacts/6-1-community-feed-by-climate-band.md:28-59`]
- [Source: `_bmad-output/implementation-artifacts/6-1-community-feed-by-climate-band.md:191-209`]
- [Source: `_bmad-output/project-context.md:27-100`]
- [Source: `_bmad-output/project-context.md:131-174`]
- [Source: `packages/api-client/src/contracts/http/supported-locales.json:1-42`]
- [Source: `apps/api/src/modules/community/community-moderation.engine.ts:6-25`]
- [Source: `apps/api/src/modules/community/community-moderation.engine.ts:89-96`]
- [Source: `apps/api/src/modules/community/community-moderation.engine.ts:158-219`]
- [Source: `apps/api/src/modules/community/community-moderation.engine.ts:221-371`]
- [Source: `apps/api/src/modules/community/community-moderation.processor.ts:28-163`]
- [Source: `apps/api/src/modules/community/community-moderation.processor.ts:227-429`]
- [Source: `apps/api/src/modules/community/community-worker-runtime.ts:42-113`]
- [Source: `apps/api/src/modules/community/community-moderation.queue.ts:31-102`]
- [Source: `apps/api/src/workers/base.worker.ts:25-58`]
- [Source: `apps/api/src/workers/bootstrap.ts:244-332`]
- [Source: `apps/api/src/workers/community.bootstrap.ts:10-140`]
- [Source: `scripts/start-api-e2e-with-workers.mjs:1-35`]
- [Source: `_bmad-output/project-knowledge/deployment-guide.md:266-308`]

## Previous story intelligence

Story 6.1 created the complete upload, validation, outbox, BullMQ, post transition, audit, author
state, and rollout foundation. Commit `0d7dab05` delivered it. Commit `18f95595` then closed five
review leftovers and documented the exact Story 6.2 text gaps. The Story 6.1 review table still shows
some pass-two findings as assigned; the final commit and current code contain those repairs. Use the
current code and Git history as authority.

The strongest reusable model precedent is the garment-tagging pipeline:
`scripts/prepare-garment-tagging-model.mjs` pins files and hashes,
`fashion-clip-inference.worker.ts` isolates model execution, and
`wardrobe.bootstrap.ts` requires eager readiness before queue consumption. Reuse these lifecycle and
supply-chain patterns while keeping community policy and model assets separate.

## Git intelligence summary

- `18f95595`: closes five deferred Story 6.1 findings, strengthens validation, and records text
  obfuscation plus locale coverage as Story 6.2 work.
- `0d7dab05`: delivers the Community feed and moderation pipeline baseline.
- `55ab7998`: sprint bookkeeping around the Story 6.1 delivery.
- `f95c09fa`: Story 5.5 planner implementation; useful for model-gated test and evidence patterns.
- `e7e94a75`: Story 5.4 palette advisor; useful for worker lifecycle and privacy patterns.

## Human actions required for completion

None. This story is implementable end to end from this repository.

The items that once sat here, a licensed evaluation corpus, named reviewers, a deployment target, and
three role signatures, moved to Story 6.2b, which replaces each of them with something this project
can actually produce. See that story's substitution table for the reasoning. Both production Community
rollout flags stay disabled throughout.

## Dev Agent Record

### Agent model used

GPT-5 Codex

### Debug log references

- Baseline focused moderation suite: 4 files passed, 66 tests passed on 2026-09-07.

### Completion notes list

- Story status set to `ready-for-dev`.
- Independent review pass on 2026-09-07 executed the pinned stack instead of trusting the registry
  and the docs. It replaced the model download and model-directory design with the package-bundled
  model, pinned the class names and artifact hashes, added the measured runtime baseline and the
  regression gate that the absolute ceilings could not provide, recorded the missing hosted-worker
  reality behind Task 5, and marked which engine behaviors already exist and must be preserved.
- Story file now passes `prettier --check` and `markdownlint-cli2`; it previously failed the
  repository's `npm run lint` because `_bmad-output` is not in `.prettierignore`.
- Task 0 blocks policy constants and production measurements until human-owned inputs are approved.
- Checklist corrections resolve version, local loading, class mapping, evaluation, signing, retry,
  deployment, and restricted E2E requirements.

### File list

- `_bmad-output/implementation-artifacts/6-2-production-content-screening-readiness.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (updated)

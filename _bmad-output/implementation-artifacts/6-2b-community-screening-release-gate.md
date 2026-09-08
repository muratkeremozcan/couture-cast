---
title: 'Story 6.2b: Community screening release gate and worker deployment'
type: 'feature'
created: '2026-09-07'
status: 'ready-for-dev'
baseline_commit: '18f95595f3419f114629edec0c43ba13c8459e38'
story_key: '6-2b-community-screening-release-gate'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/6-2-production-content-screening-readiness.md'
---

<!-- markdownlint-disable MD013 MD024 MD036 -->

## Story 6.2b: Community screening release gate and worker deployment

Status: ready-for-dev

**Story key:** `6-2b-community-screening-release-gate`
**Epic:** 6, Community & Moderation Loop, Phase 2
**Baseline commit:** `18f95595`
**Depends on:** Story 6.2 (screening implementation)
**Prepared:** 2026-09-07

## Story

As the operator of couture-cast,
I want the community screening pipeline running on real hosted infrastructure behind a release gate I
can actually satisfy,
so that Community Beta can open without waiting on assets and approvals this project cannot obtain.

## Why this story exists

Story 6.2 builds the screening code. Its release gate, as first written, could not be closed by this
project: it required a licensed corpus of 400 unsafe images, seven qualified native-language
reviewers, three separate role signatures, and a hosted long-running worker that has never existed in
this repository. Those requirements describe a company with a trust and safety department. This is a
solo project with two nominal beta moderators.

This story replaces each of those requirements with something equivalent in safety value and
achievable here, and it stands up the deployment the gate depends on. It does not lower the bar for
what reaches a reader's feed. It moves the proof from assets this project cannot hold to properties
this project can measure.

Story 6.2 keeps the implementation and its fast tests. This story owns hosting, corpora, evaluation,
and the signed gate.

## The four substitutions

| Story 6.2 as first written                                   | This story                                                                                                                                    | Why it is equivalent or better                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400 licensed unsafe images prove recall                      | Exhaustive policy-surface evaluation over the class-probability simplex, plus a recorded vendor-recall limitation and conservative thresholds | Auto-publication requires a confident `Neutral`; every other vector routes to a human. Recall against real unsafe imagery is the upstream model's property, not this repository's. What this repository can break, and therefore must test, is the disposition logic, and a synthetic sweep covers it completely instead of sampling it |
| 600+ safe images prove the false-positive rate               | 250 openly licensed real fashion photographs, bytes outside Git, hashes and license in Git                                                    | This is the number that governs beta viability: it is the human review load two moderators inherit. It is measurable here, and it is measured on real photographs rather than synthetic ones                                                                                                                                            |
| Seven qualified native reviewers approve term lists          | LDNOOBW pinned at one commit under CC-BY-4.0, plus a repository-owned fashion allow list, plus recorded provenance and an open limitation     | A pinned, attributed, widely used community list is checkable. A fabricated claim of native-speaker review is not                                                                                                                                                                                                                       |
| Engineering, Test/Quality, and Trust and Safety attestations | One repository-owner verdict bound to the evidence payload hash                                                                               | Three signatures from one person is theatre. One honest signature against an immutable hash is an audit trail                                                                                                                                                                                                                           |

Both production rollout flags stay disabled at the end of this story. Closing this gate authorizes
the Community Beta model-readiness signature and nothing else.

## Acceptance Criteria

1. **The community worker runs on real hosted infrastructure.** A container image builds from this
   repository, installs production dependencies, verifies the model artifacts, and starts the
   community-capable BullMQ consumer as an unprivileged user with init handling and graceful
   `SIGTERM` shutdown. The dependency tree is the slim one from Decision 1, measured at 98 MB
   installed rather than 325 MB. The image deploys to a free always-on container host, Northflank
   first, with Oracle Cloud Always Free and Railway as the recorded fallbacks. Vercel is excluded for
   the worker because it runs no long-running process. The deployed worker connects to the production
   Redis and PostgreSQL instances, logs its readiness line with the model and policy identity, and
   survives a restart without losing queued jobs.

2. **A canary job proves the deployment end to end.** A repeatable command enqueues one screening job
   with a synthetic safe fixture against the deployed worker, then polls until the post reaches its
   terminal state. It reports the queue latency, the inference duration, the disposition, and the
   engine identity that the worker actually persisted. The canary fails loudly when the worker is
   absent, when the model is a fixture, or when the terminal state is not reached inside a bounded
   wait. The canary is part of the deploy runbook and part of the release evidence.

3. **The policy surface is proven exhaustively without unsafe imagery.** A deterministic evaluation
   sweeps the five-class probability simplex against the pinned policy: every threshold boundary from
   both sides, every single-class maximum, uniform and near-uniform vectors, ties between a safe and
   an unsafe class, vectors that sum outside the configured tolerance, non-finite and out-of-range
   values, missing and duplicated class names, and the empty result. Every generated vector maps to
   exactly one of `pass`, `review`, or `block` with a stable reason code, the sweep asserts that no
   vector reaches `pass` without a confident `Neutral`, and it asserts full branch coverage of the
   disposition function. The evaluation is committed, deterministic, and runs in ordinary CI.

4. **The safe-content false-positive rate is measured on real photographs.** A corpus of at least 250
   fashion photographs under a licence that permits commercial use is assembled through a committed
   fetch script, sourced from Openverse with `license_type=commercial`. Unsplash is excluded: its
   dataset licence permits machine-learning use for non-commercial purposes only, and couture-cast
   sells premium subscriptions. The repository
   stores each entry's opaque ID, source, photographer, license, URL, and SHA-256; the bytes live in
   the access-controlled test store and never enter Git. The release run reports the review-or-block
   rate over that corpus with counts, denominator, and a Wilson 95% interval. The gate is a Wilson
   95% upper bound at or below 5%. The report converts that rate into the projected daily human
   review load at the beta's expected submission volume, because that number, not the percentage, is
   what the moderator rota has to absorb.

5. **Text screening lists have pinned, attributable provenance.** The seven language term lists are
   vendored from LDNOOBW at one pinned commit, stored with their CC-BY-4.0 attribution, and covered
   by a verify command that fails when the vendored content drifts from the pinned commit. A
   repository-owned allow list protects ordinary fashion vocabulary, and every allow-list entry
   carries the reason it exists. A text corpus of at least 200 clean fashion captions and 100
   obfuscated disallowed cases per language exercises every obfuscation family from AC 4 of Story
   6.2. The clean-copy false-positive gate is a Wilson 95% upper bound at or below 1% per language.
   The absence of native-speaker review is recorded as a named limitation with its residual risk, not
   omitted.

6. **The evidence payload is generated, immutable, and signed once.** One command produces the JSON
   evidence payload and its rendered Markdown view from the same run. The payload records the commit
   SHA, dependency lock hash, image digest, model and policy manifest hashes, corpus manifest hashes,
   deployed target and resource profile, canary result, policy-surface results, safe-corpus and text
   results with their intervals, measured latency and memory distributions with the committed
   regression gates, every command that produced them, the named limitations, the rollback procedure,
   and a single `verdict` that is `pass` only when every gate passed. A separate sign command records
   one verdict by the repository owner against the payload's SHA-256. Changing the payload invalidates
   the signature. Generated code cannot sign on the owner's behalf.

7. **The limitations are stated, not buried.** The evidence artifact carries a limitations section
   that names, at minimum: recall against real unsafe imagery is inherited from the upstream NSFWJS
   model and is not measured in this repository; term lists have pinned community provenance but no
   native-speaker review; the safe corpus is drawn from stock photography and may not match the
   distribution of user submissions; and the beta operates with two moderators. Each limitation
   carries its mitigation and the condition that would require revisiting it.

8. **Rollout stays closed and the remaining gates stay visible.** `community_read_enabled` and
   `community_write_enabled` remain disabled in production. The artifact records which Community Beta
   gate signatures this story closes and which remain open, so that no reader mistakes a
   model-readiness signature for a launch decision.

## Implementation decisions

### Decision 1: Shrink the dependency tree first, because it changes every hosting option

The 325 MB figure that ruled out serverless hosting came from the union `@tensorflow/tfjs` package
plus all three model families NSFWJS ships. Neither is needed. A probe run on 2026-09-07 replaced the
union package with `@tensorflow/tfjs-core`, `@tensorflow/tfjs-converter`, and
`@tensorflow/tfjs-backend-wasm`, loaded the bundled `mobilenet_v2_mid` graph directly rather than
through NSFWJS's wrapper, and deleted the two unused model families:

|                                            | Union package, all models | Slim core plus one model                     |
| ------------------------------------------ | ------------------------- | -------------------------------------------- |
| Installed `node_modules`                   | 325 MB                    | 98 MB                                        |
| Graph model load                           | 125 ms                    | 11 ms                                        |
| Warm p50 / p95 over 30 inferences          | 21 / 22 ms                | 24 / 26 ms                                   |
| Peak RSS                                   | 232 MiB                   | 205 MiB                                      |
| Class probabilities on the reference input | `Neutral` 0.9063          | `Neutral` 0.9063, identical to four decimals |

Take the slim path. It produces identical numbers, it fits inside every free hosting tier considered
below, and it fits under Vercel's 250 MB unzipped function limit, which the union package did not.

Two consequences the implementation must handle. `@tensorflow/tfjs-core` does not register the
chained tensor API, so `tensor.toFloat()` and `tensor.div()` throw; use the functional forms
`tf.cast`, `tf.div`, and `tf.reshape`, or import the chained-ops registration explicitly. And
`loadGraphModel` lives in `@tensorflow/tfjs-converter`, not in core. Both were found by running it,
and both fail loudly rather than silently.

The model artifacts still come from the `nsfwjs` package, reached through its exported
`nsfwjs/models/mobilenet_v2_mid` subpath. Its deep `dist/` paths are blocked by the package's
`exports` map, so do not import them directly.

### Decision 2: Prefer a free always-on container, and name the paid fallback honestly

Every other service in this project is freemium: Vercel, Supabase, and Upstash all sit on free tiers
until they scale. The worker should match that, so the options were checked rather than assumed. As
of September 2026:

| Option                              | Free?                                                                                            | Verdict for this worker                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Northflank Developer Sandbox        | Yes, free forever; 2 services, always-on, no sleeping; card held for anti-abuse only             | **Chosen.** Measured 205 MiB RSS fits the roughly 512 MB sandbox envelope, and it runs a plain container, so Story 6.2's BullMQ design is unchanged                       |
| Oracle Cloud Always Free            | Yes, genuinely free, 4 ARM cores and 24 GB RAM                                                   | Most headroom, most operations burden: it is an unmanaged VM needing patching, Docker, and a process supervisor. Keep as the fallback if the sandbox proves too small     |
| Vercel Function plus Upstash QStash | Yes: 98 MB fits the 250 MB limit, QStash free tier is 1,000 messages a day with built-in retries | Real, and it adds no vendor, but it replaces BullMQ's retry and stalled-job semantics, which Story 6.2 AC 5 requires preserving. Documented as an alternative, not chosen |
| Fly.io                              | No                                                                                               | Free tier withdrawn for new accounts                                                                                                                                      |
| Render                              | No                                                                                               | Background workers are paid only, from 7 USD a month; the free tier covers web services, which sleep                                                                      |
| Koyeb                               | No                                                                                               | Free Starter tier closed to new users in early 2026, and it excluded worker services anyway                                                                               |
| Railway                             | No, 5 USD a month minimum, realistically more with usage                                         | Simplest deploy of the set. Keep as the paid fallback if a free tier fails                                                                                                |

So: Northflank first, Oracle Always Free if the sandbox is too small, Railway if neither is worth the
time. Nothing in the application code knows which host it runs on, and the runbook records the
substitutions, so switching later is a configuration change rather than a rewrite.

Vercel remains unsuitable for the worker itself on one ground rather than two: it runs no
long-running process. The size objection is gone now that the tree is 98 MB.

Size the instance from the measured baseline: peak RSS 205 MiB for one model instance, so 512 MiB is
a working limit. One replica at concurrency one is the starting topology.

### Decision 3: Prove the policy surface, and inherit model recall as a stated limitation

The unsafe-image corpus was meant to answer "does the model catch unsafe content". That is a property
of the upstream NSFWJS model, fixed at the version this project pins, and no evaluation performed
here changes it. Measuring it would require this project to acquire, store, and process a licensed
corpus of sexual imagery, which it cannot responsibly do.

What this repository can break is the code between the model's output and the publication decision.
That surface is small, fully enumerable, and is where a mistake would silently publish something
unsafe. A boundary error, an inverted comparison, a class-order bug, or an unhandled non-finite value
would all pass an image-based evaluation that happened not to sample the affected region, and all of
them fail a simplex sweep. So the sweep is the stronger test of the thing this story controls.

The safety argument that carries the beta is the disposition policy itself, not model recall.
Auto-publication requires a confident `Neutral`. Every other outcome, including uncertainty, routes
to a human. Under that policy a model recall failure degrades into review load rather than into a
published unsafe post, and review load is exactly what AC 4 measures.

Record the residual risk honestly: an unsafe image that the upstream model confidently labels
`Neutral` publishes automatically, and this repository has not measured how often that happens.
Mitigations are the conservative threshold, the report action shipping in Story 6.4, and both rollout
flags staying closed until the moderator rota is real.

### Decision 4: Vendor a pinned public list rather than invent reviewer approval

LDNOOBW ("List of Dirty Naughty Obscene and Otherwise Bad Words") carries all seven enabled
languages, is CC-BY-4.0, and is widely used. Vendor it at one pinned commit with its attribution
file, add a verify command that detects drift, and record the commit in the policy manifest.

Term counts at the pinned commit are English 403, Turkish 142, Italian 168, French 91, Portuguese 76,
Spanish 68, German 66. The smaller lists are thinner than the English one; that asymmetry belongs in
the limitations section rather than being smoothed over.

The repository-owned allow list is the half that matters most for this product, because a fashion
corpus contains ordinary words that a profanity list will flag. Every allow-list entry records why it
is there, so a later reader can tell a deliberate exemption from an accident.

### Decision 5: One honest signature

Three role attestations from one person do not create three independent reviews. Generate an
immutable JSON payload, hash it, and record one verdict by the repository owner against that hash.
Re-generating the payload after any change invalidates the recorded signature, which is the property
that made the three-signature scheme worth having in the first place.

## Tasks / Subtasks

- [ ] Task 1: Build and prove the worker container (AC: 1)
  - [ ] Confirm Story 6.2 installed the slim inference dependencies rather than the union package, and
        fail this task early if it did not. The image budget below depends on it.
  - [ ] Add `apps/api/Dockerfile.community-worker` building from the repository root, installing
        production dependencies, running the Story 6.2 model verification during build, pruning the
        two unused NSFWJS model families, and starting the compiled community worker bootstrap as an
        unprivileged user with `tini`-style init handling.
  - [ ] Assert the installed image stays under 150 MB of `node_modules`, so a dependency change that
        would push the worker off a free tier fails the build instead of the bill.
  - [ ] Add `scripts/start-community-worker-production.mjs` that verifies model artifacts, refuses to
        start on `fixture` or on an unset selector, and forwards `SIGTERM` to a graceful shutdown.
  - [ ] Build the image locally, run it against the local Docker Compose Redis and PostgreSQL, and
        confirm the readiness line, one processed job, and a clean `SIGTERM` shutdown before touching
        any hosted target.
  - [ ] Document the required environment variables and the resource profile once, then the
        host-specific steps for Northflank, with Oracle Cloud Always Free and Railway as the recorded
        fallbacks.

- [ ] Task 2: Deploy the worker and wire the canary (AC: 1, 2)
  - [ ] Deploy the image to Northflank, pointed at production Redis and PostgreSQL, at one replica
        with concurrency one inside the sandbox memory envelope. Fall back to Oracle Cloud Always Free
        if the measured RSS does not fit, and to Railway if neither is worth the setup time.
  - [ ] Add `scripts/community-screening-canary.mjs` that enqueues one synthetic safe job, polls the
        post to its terminal state within a bounded wait, and prints queue latency, inference
        duration, disposition, and the persisted engine identity.
  - [ ] Make the canary exit nonzero when the worker is absent, when the persisted identity carries a
        `fixture` marker, or when the wait expires.
  - [ ] Add the deploy, canary, readiness-log, rollback, and incident-mode procedure to
        `_bmad-output/project-knowledge/deployment-guide.md`, and correct the standing statement that
        the repository deploys no long-running consumer.

- [ ] Task 3: Sweep the policy surface (AC: 3)
  - [ ] Add a deterministic generator over the five-class simplex covering both sides of every
        threshold, single-class maxima, uniform and near-uniform vectors, safe-versus-unsafe ties, and
        sum-tolerance boundaries.
  - [ ] Add malformed-input cases: non-finite values, out-of-range values, missing class names,
        duplicated class names, wrong class-name set, and the empty result.
  - [ ] Assert one stable disposition and reason code per vector, assert that no vector reaches `pass`
        without a confident `Neutral`, and assert full branch coverage of the disposition function.
  - [ ] Keep the sweep in the ordinary CI suite; it needs no model and no restricted asset.

- [ ] Task 4: Assemble and measure the safe-content corpus (AC: 4)
  - [ ] Add `scripts/fetch-community-safe-corpus.mjs` pulling at least 250 fashion photographs from
        the Openverse API with `license_type=commercial`, writing bytes to the access-controlled test
        store and a manifest of opaque ID, source, creator, licence, URL, and SHA-256 to the
        repository.
  - [ ] Make the script resumable and rate-limit aware. Anonymous Openverse access allows 5 requests
        an hour and 100 a day; a free registered token raises that. The script must checkpoint, honour
        `Retry-After`, and be safe to re-run until the corpus is complete.
  - [ ] Record the licence of every image in the manifest and fail the build on any entry whose
        licence does not permit commercial use.
  - [ ] Add manifest integrity, duplicate-hash, non-vacuity, and minimum-count checks that fail the
        release run rather than passing an empty corpus.
  - [ ] Measure the review-or-block rate with counts, denominator, and a Wilson 95% interval, and gate
        on an upper bound at or below 5%.
  - [ ] Convert the measured rate into projected daily human review load at the expected beta
        submission volume and put that number in the artifact.

- [ ] Task 5: Vendor, verify, and measure the text lists (AC: 5)
  - [ ] Vendor LDNOOBW at one pinned commit for the seven enabled languages with its CC-BY-4.0
        attribution, and record the commit in the policy manifest.
  - [ ] Add a verify command that fails when vendored content drifts from the pinned commit.
  - [ ] Build the repository-owned fashion allow list, with a recorded reason per entry.
  - [ ] Add at least 200 clean fashion captions and 100 obfuscated disallowed cases per language,
        covering every obfuscation family Story 6.2 AC 4 requires.
  - [ ] Gate the per-language clean-copy false-positive rate at a Wilson 95% upper bound of 1%.

- [ ] Task 6: Generate and sign the evidence (AC: 6, 7, 8)
  - [ ] Add `scripts/generate-community-screening-readiness.mjs` emitting the JSON payload and the
        rendered Markdown view from one run, with every field AC 6 lists.
  - [ ] Add a sign command recording one owner verdict bound to the payload SHA-256, and a verify
        command that reports a signature as stale once the payload changes.
  - [ ] Write the limitations section with a mitigation and a revisit condition for each entry.
  - [ ] Record which Community Beta gate signatures close here and which remain open, and confirm both
        rollout flags are still disabled.

- [ ] Task 7: Run all applicable quality gates (AC: 1 through 8)
  - [ ] Run the policy sweep, safe-corpus evaluation, text evaluation, canary, and evidence generation
        end to end.
  - [ ] Run `npm run verify:changed` and `npm run validate`.
  - [ ] Confirm the story's own documents pass `prettier --check` and `markdownlint-cli2`, because
        `_bmad-output` is not in `.prettierignore` and a malformed story file breaks `npm run lint`.

## Dev Notes

### What this story inherits from Story 6.2

Story 6.2 delivers the screener, the supervised inference process, the text screening boundary, the
policy manifest, and the fast test suites. This story does not modify that code. It consumes the
policy identity, the disposition function, and the readiness handshake, and it fails if any of them
is missing.

The measured runtime baseline recorded in Story 6.2 sizes this story's infrastructure: one model
instance is roughly 223 MiB resident, cold start is about one second, and a warm 224x224 inference is
about 22 ms on a developer laptop. Expect a container host to be slower and record what it actually
does.

### Files expected to be added

- `apps/api/Dockerfile.community-worker`
- `scripts/start-community-worker-production.mjs`
- `scripts/community-screening-canary.mjs`
- `scripts/fetch-community-safe-corpus.mjs`
- `scripts/generate-community-screening-readiness.mjs`
- `scripts/sign-community-screening-readiness.mjs`
- `scripts/verify-community-screening-lists.mjs`
- `apps/api/policies/community-screening/vendor/ldnoobw/{en,es,fr,de,it,pt,tr}`
- `apps/api/policies/community-screening/vendor/ldnoobw/ATTRIBUTION.md`
- `apps/api/policies/community-screening/allow-list-v1.json`
- `apps/api/src/modules/community/community-screening-policy.sweep.spec.ts`
- `apps/api/test/fixtures/community-safe-corpus/manifest.json`
- `apps/api/test/fixtures/community-text-corpus/{en,es,fr,de,it,pt,tr}.json`
- `_bmad-output/test-artifacts/community-content-screening-model-readiness.json`
- `_bmad-output/test-artifacts/community-content-screening-model-readiness.md`
- `_bmad-output/test-artifacts/community-content-screening-signature.json`

### Files expected to change

| File                                                 | Current state                                                                                                                        | Required change                                                                                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_bmad-output/project-knowledge/deployment-guide.md` | States at lines 302-305 that no Docker image, Vercel function, workflow, or process manifest starts a long-running consumer          | Replace that statement for the community worker, add the deploy, canary, readiness, rollback, and incident runbook, and keep the honest statement for the wardrobe worker, which still has no hosted target |
| `.env.example`                                       | Documents the garment model and Redis                                                                                                | Add the community worker's hosted variables and the safe-corpus fetch credential, with neutral placeholders                                                                                                 |
| `package.json`                                       | No screening evidence commands                                                                                                       | Add the canary, corpus, evaluation, generate, sign, and verify scripts                                                                                                                                      |
| `_bmad-output/planning-artifacts/architecture.md`    | ADR-013 at line 246 describes vendor selection and a two-moderator staffing plan, with no deployment target and no evidence standard | Amend ADR-013 with the container target, the measured resource profile, the substituted evidence standard, and the recorded limitations                                                                     |

### What still requires a human, step by step

Three items need a person. Each one is listed with the actual clicks, because "create an account" is
where a story like this usually stalls. Everything else in this story is implementable without
external approval.

#### 1. Stand up the free worker host (about 15 minutes, 0 USD)

Northflank's Developer Sandbox is free forever and runs an always-on container, which is what a
BullMQ consumer needs. A card is requested at signup as anti-abuse verification and is not charged
unless the plan is upgraded.

1. Go to <https://northflank.com> and sign up with the GitHub account that owns this repository.
   Choose the free Developer Sandbox plan. Enter the card when asked; nothing recurring is billed on
   this tier.
2. Authorise the Northflank GitHub app against `couture-cast` only, not the whole account.
3. Create a project. Pick the region closest to the Supabase project so database round trips stay
   short.
4. Inside the project, create a **combined service**, which builds from the repository and deploys
   the result. Point it at `couture-cast`, branch `main`.
5. Set the build to **Dockerfile**, with the Dockerfile path
   `/apps/api/Dockerfile.community-worker` and the build context `/`. Both fields take paths relative
   to the repository root.
6. Leave the port configuration empty. This service serves no HTTP; a port would only add a health
   check that can never pass.
7. Add these environment variables, values taken from the same places the Vercel project already uses
   them:

   | Variable                    | Value                          |
   | --------------------------- | ------------------------------ |
   | `NODE_ENV`                  | `production`                   |
   | `DATABASE_URL`              | the Supabase connection string |
   | `REDIS_URL`                 | the Upstash `rediss://` URL    |
   | `REDIS_TLS`                 | `true`                         |
   | `SUPABASE_URL`              | the Supabase project URL       |
   | `SUPABASE_SERVICE_ROLE_KEY` | the Supabase service role key  |
   | `COMMUNITY_NSFW_SCREENER`   | `tensorflow`                   |

8. Deploy, and watch the build log. Success looks like the readiness line this story adds, naming the
   model hash, the policy version, and the startup duration.
9. Tell the agent the service is up. The canary in Task 2 is what actually proves it, and that is
   scripted.

If the sandbox turns out to be too small for the measured 205 MiB resident set, the fallbacks in
Decision 2 are Oracle Cloud Always Free, which is genuinely free but an unmanaged VM, and Railway at
5 USD a month, which is the least work of the three.

#### 2. Raise the Openverse rate limit (about 5 minutes, 0 USD, and skippable)

The safe corpus comes from Openverse, which needs no key at all. Anonymous access is capped at 5
requests an hour and 100 a day, so 250 images take about three days of background fetching. A free
token removes that wait.

1. Follow the "Register and Authenticate" section at <https://api.openverse.org/v1/>. It registers an
   application by name and email and returns an OAuth2 client ID and secret. There is no dashboard,
   no approval queue, and no card. The exact request shape was not verified from this machine, so
   read it off that page rather than trusting a path quoted here.
2. Confirm the verification email.
3. Put the client ID and secret in `.env.local` as `OPENVERSE_CLIENT_ID` and
   `OPENVERSE_CLIENT_SECRET`. The fetch script exchanges them for a bearer token with
   `grant_type=client_credentials`.

Skipping this is fine. The fetch script is resumable and rate-limit aware by AC 4, so without a token
it simply takes longer.

Unsplash and Pexels were considered and rejected. Unsplash grants machine-learning use of its
imagery for non-commercial purposes only, and couture-cast sells premium subscriptions, so that
licence does not cover this use. Openverse filters directly on `license_type=commercial`, which is
the property this corpus actually needs.

#### 3. Sign the evidence (about 20 minutes, 0 USD)

1. Run the generator. It writes the JSON payload, its SHA-256, and the rendered Markdown view.
2. Read the rendered view, in particular the limitations section and the safe-corpus review rate
   converted into projected daily review load. That number is the beta's real operating cost.
3. Run the sign command. It records the verdict against the payload hash.
4. If any later change regenerates the payload, the signature is reported stale and step 3 repeats.
   That staleness is the point of hashing it.

This one stays human on purpose. The agent can produce the evidence and can refuse to emit a passing
verdict, but it should not be the thing that says the evidence was read.

### Architecture compliance

- Keep runtime screening code inside `apps/api/src/modules/community`; this story adds scripts,
  policy data, corpora manifests, and deployment artifacts, not new runtime behavior.
- Keep restricted and licensed bytes outside Git; commit manifests, hashes, and licenses only.
- Keep secrets, signed URLs, and identifiable wardrobe data out of logs and generated evidence.
- Keep generated release evidence under `_bmad-output/test-artifacts`.
- Store UTC timestamps and emit ISO 8601.
- Keep `community_read_enabled` and `community_write_enabled` false in production.

### References

- [Source: `_bmad-output/implementation-artifacts/6-2-production-content-screening-readiness.md`]
- [Source: `_bmad-output/planning-artifacts/architecture.md:246`] ADR-013 moderation tooling selection
- [Source: `_bmad-output/planning-artifacts/architecture.md:66`] TensorFlow.js 4.16.0 pin
- [Source: `_bmad-output/project-knowledge/deployment-guide.md:266-308`] Worker deployment and the
  standing statement that no hosted consumer exists
- [Source: `_bmad-output/implementation-artifacts/epic-6-context.md:119-133`] Cross-story dependencies
- [Source: `apps/api/src/workers/bootstrap.ts:244-332`] General worker bootstrap and shutdown
- [Source: `apps/api/src/modules/community/community-worker-runtime.ts:42-113`] Shared composition
- [Source: <https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words>]
  CC-BY-4.0, all seven enabled languages present

## Dev Agent Record

### Agent model used

Claude Opus 5

### Debug log references

- LDNOOBW coverage and licence checked against the GitHub API on 2026-09-07: CC-BY-4.0, and all of
  `en`, `es`, `fr`, `de`, `it`, `pt`, `tr` present.
- Dependency size measured from throwaway installs on 2026-09-07: union `@tensorflow/tfjs` plus all
  three NSFWJS model families is 325 MB; `tfjs-core` plus `tfjs-converter` plus the WASM backend with
  two model families pruned is 98 MB. The slim build was executed and returned identical class
  probabilities at 24 ms warm p50 and 205 MiB RSS.
- Free-tier hosting checked on 2026-09-07: Northflank Developer Sandbox free forever with always-on
  services; Fly.io free tier withdrawn for new accounts; Render background workers paid only from 7
  USD a month; Koyeb free Starter closed to new users in early 2026; Railway 5 USD a month minimum.
- Vercel Hobby limits checked on 2026-09-07: 250 MB unzipped function size, 30 second function
  duration, and cron restricted to 2 jobs running once a day, which is why the serverless alternative
  pairs with Upstash QStash rather than a cron drain.
- Openverse checked on 2026-09-07: no API key required, anonymous throttle of 5 requests an hour and
  100 a day, free tokens raise it, and `license_type=commercial` filters to licences that permit
  commercial use. Unsplash's dataset licence permits machine-learning use for non-commercial purposes
  only.

### Completion notes list

- Story created on 2026-09-07 to carry the parts of Story 6.2 that could not be closed by this
  project as originally specified.
- Each removed requirement is replaced rather than dropped; the substitution table records the
  reasoning so a later reader can challenge it.

### File list

- `_bmad-output/implementation-artifacts/6-2b-community-screening-release-gate.md` (new)
